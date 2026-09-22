from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from supervideo_core.jobs import JobError, JobManager
from supervideo_core.media.image import ImageGenerationService
from supervideo_core.media.image_models import ImageJobStartParams, ImageJobInput
from supervideo_core.project import ProjectCreateRequest, ProjectService
from supervideo_core.rpc.registry import RpcRegistry
from supervideo_core.storage import JobCreate, JobRepository, new_id


class D06ImageTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="supervideo d06 image "))
        self.project = ProjectService()
        self.summary = self.project.create(ProjectCreateRequest(name="D06 image", targetPlatform="douyin", projectRoot=str(self.root)))

    def tearDown(self) -> None:
        self.project.close()
        shutil.rmtree(self.root, ignore_errors=True)

    def request(self, key: str, *, prompt: str = "A clean factory dormitory for a recruitment shot.", model: str = "fake-image-v1", shot: str = "shot-1", source_id: str = "d05-shot-1") -> ImageJobStartParams:
        return ImageJobStartParams(
            projectId=self.summary.project_id,
            idempotencyKey=key,
            providerId="fake",
            model=model,
            shotId=shot,
            prompt=prompt,
            parameters={"width": 128, "height": 128, "steps": 8, "seed": 7},
            source={"kind": "d05-shot", "id": source_id},
            provenance=[{"kind": "script", "id": "d05:script:shot-1"}, {"kind": "fact", "id": "fact:verified-1"}],
        )

    def test_contract_rejects_unknown_secret_path_and_credential_fields(self) -> None:
        fixture = json.loads((Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "d06_image_generation_v1.json").read_text(encoding="utf-8"))
        ImageJobStartParams.model_validate(fixture)
        base = self.request("contract")
        for update in (
            {"credentialRef": "cred-fake"},
            {"prompt": "https://example.invalid/image"},
            {"prompt": "use api_key=FAKE_SENTINEL"},
            {"prompt": "C:\\outside\\secret.png"},
            {"parameters": {"width": 128, "height": 128, "steps": 8, "seed": 7, "command": "curl"}},
        ):
            with self.subTest(update=update):
                payload = base.model_dump(by_alias=True)
                payload.update(update)
                with self.assertRaises(ValidationError):
                    ImageJobStartParams.model_validate(payload)

    def test_fake_png_cache_manifest_tamper_and_selection_binding(self) -> None:
        async def scenario() -> None:
            manager = JobManager(self.project)
            await manager.activate(self.summary.project_id)
            first = await manager.start_image(self.request("image-1"))
            await wait_for_status(manager, first.job_id, "succeeded")
            result = manager.get_image_result(self.summary.project_id, first.job_id)
            self.assertEqual(result.cache_status, "created")
            output = self.root / result.output.relative_path
            manifest = output.with_suffix(".json")
            self.assertTrue(output.is_file())
            self.assertTrue(output.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(), result.output.output_fingerprint)
            manifest_payload = json.loads(manifest.read_text(encoding="utf-8"))
            self.assertEqual(manifest_payload["cacheKey"], result.cache_key)
            self.assertEqual(manifest_payload["result"]["prompt"], result.prompt)
            self.assertNotIn("credentialRef", manifest.read_text(encoding="utf-8"))

            second = await manager.start_image(self.request("image-2"))
            await wait_for_status(manager, second.job_id, "succeeded")
            self.assertEqual(manager.get_image_result(self.summary.project_id, second.job_id).cache_status, "cache-hit")
            for index, changed in enumerate((
                {"prompt": "A warehouse loading dock, recruitment shot."},
                {"model": "fake-image-v2"},
                {"shot_id": "shot-2"},
                {"source": {"kind": "fact", "id": "fact:other"}},
                {"parameters": {"width": 128, "height": 128, "steps": 9, "seed": 7}},
            ), start=3):
                payload = self.request(f"image-{index}").model_copy(update=changed)
                job = await manager.start_image(payload)
                await wait_for_status(manager, job.job_id, "succeeded")
                self.assertNotEqual(manager.get_image_result(self.summary.project_id, job.job_id).cache_key, result.cache_key)

            manifest_payload["result"]["output"]["outputFingerprint"] = "0" * 64
            manifest.write_text(json.dumps(manifest_payload), encoding="utf-8")
            repaired = await manager.start_image(self.request("image-repair-manifest"))
            await wait_for_status(manager, repaired.job_id, "succeeded")
            self.assertEqual(manager.get_image_result(self.summary.project_id, repaired.job_id).cache_status, "created")
            output.write_bytes(b"tampered")
            repaired_again = await manager.start_image(self.request("image-repair-bytes"))
            await wait_for_status(manager, repaired_again.job_id, "succeeded")
            self.assertEqual(manager.get_image_result(self.summary.project_id, repaired_again.job_id).cache_status, "created")

            duplicate = await manager.start_image(self.request("image-1"))
            self.assertEqual(duplicate.job_id, first.job_id)
            with self.assertRaises(JobError) as conflict:
                await manager.start_image(self.request("image-1", prompt="conflicting prompt"))
            self.assertEqual(conflict.exception.code, "IDEMPOTENCY_CONFLICT")
            durable = JobRepository(self.project.active_database).get(first.job_id, self.summary.project_id)  # type: ignore[arg-type]
            self.assertNotIn("secret", durable.input_json)
            self.assertNotIn("credentialRef", durable.input_json)
            self.assertEqual(durable.input_json["prompt"], result.prompt)
            await manager.shutdown()

        asyncio.run(scenario())

    def test_retry_and_checkpoint_cache_binding(self) -> None:
        async def scenario() -> None:
            manager = JobManager(self.project)
            await manager.activate(self.summary.project_id)
            failed = await manager.start_image(self.request("image-retry", model="fake-retry-once"))
            await wait_for_status(manager, failed.job_id, "failed")
            retried = await manager.retry(self.summary.project_id, failed.job_id)
            self.assertEqual(retried.status, "retrying")
            await wait_for_status(manager, failed.job_id, "succeeded")
            self.assertEqual(manager.get(self.summary.project_id, failed.job_id).attempt, 2)
            events = JobRepository(self.project.active_database).list_events(self.summary.project_id, failed.job_id)  # type: ignore[arg-type]
            self.assertEqual(events[-1].event_type, "succeeded")
            self.assertNotIn("prompt", events[-1].payload_json)
            await manager.shutdown()

        asyncio.run(scenario())

    def test_core_rpc_image_start_and_result_are_callable(self) -> None:
        async def scenario() -> None:
            registry = RpcRegistry(service=self.project)
            await registry.job_manager.activate(self.summary.project_id)
            params = self.request("rpc-image").model_dump(by_alias=True)
            started = await registry.invoke("job.image.start", params, lambda *_args: asyncio.sleep(0), asyncio.Event())
            await wait_for_status(registry.job_manager, started["jobId"], "succeeded")
            result = await registry.invoke("job.image.result", {"projectId": self.summary.project_id, "jobId": started["jobId"]}, lambda *_args: asyncio.sleep(0), asyncio.Event())
            self.assertEqual(result["projectId"], self.summary.project_id)
            self.assertEqual(result["output"]["relativePath"].startswith("generated/images-v1/"), True)
            await registry.shutdown()

        asyncio.run(scenario())

    def test_cancelled_queued_job_and_reopen_running_checkpoint_converge(self) -> None:
        async def scenario() -> None:
            manager = JobManager(self.project)
            await manager.activate(self.summary.project_id)
            input_model = ImageJobInput(
                providerId="fake", model="fake-image-v1", shotId="shot-reopen", prompt="A verified recruitment scene.",
                parameters={"width": 128, "height": 128, "steps": 8, "seed": 9},
                source={"kind": "d05-shot", "id": "d05:shot:reopen"}, provenance=[{"kind": "script", "id": "script:reopen"}],
            )
            repository = JobRepository(self.project.active_database)  # type: ignore[arg-type]
            queued = JobCreate(id=new_id(), project_id=self.summary.project_id, job_type="image.generate", status="queued", progress=0.0, stage="queued", input_json=input_model.model_dump(), idempotency_key="queued-cancel", created_at_ms=1, updated_at_ms=1, executor_version=1)
            queued_record, _ = repository.create_job_with_event(queued)
            cancelled = await manager.cancel(self.summary.project_id, queued_record.id)
            self.assertEqual(cancelled.status, "cancelled")

            cache_key = manager.image_executor.service.cache_key(self.summary.project_id, input_model)
            running = JobCreate(id=new_id(), project_id=self.summary.project_id, job_type="image.generate", status="running", progress=1.0, stage="image-prepared", input_json=input_model.model_dump(), idempotency_key="running-reopen", created_at_ms=2, updated_at_ms=2, attempt=1, executor_version=1, checkpoint_version=1, checkpoint_json={"executor": "image.generate", "executorVersion": 1, "checkpointVersion": 1, "cacheKey": cache_key, "completed": 0, "nextStep": 1})
            running_record, _ = repository.create_job_with_event(running)
            await manager.shutdown()
            reopened = JobManager(self.project)
            await reopened.activate(self.summary.project_id)
            await wait_for_status(reopened, running_record.id, "succeeded")
            self.assertEqual(reopened.get(self.summary.project_id, running_record.id).attempt, 2)
            await reopened.shutdown()

        asyncio.run(scenario())


async def wait_for_status(manager: JobManager, job_id: str, status: str):
    for _ in range(10_000):
        current = manager.get(manager.active_project_id or "", job_id)
        if current.status == status:
            return current
        if current.status in {"needs_attention", "cancelled"}:
            raise AssertionError(f"job ended in {current.status}")
        await asyncio.sleep(0.001)
    raise AssertionError(f"job did not reach {status}")


if __name__ == "__main__":
    unittest.main()
