from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from supervideo_core.jobs import JobManager
from supervideo_core.jobs.models import RemotionJobInput
from supervideo_core.media.remotion import RemotionRuntime, RemotionRuntimeError
from supervideo_core.media.remotion_models import RemotionRenderParams, RemotionRenderResult, compute_remotion_cache_key
from supervideo_core.storage import Database, JobCreate, JobRepository, ProjectCreate, ProjectRepository, new_id


ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "tests" / "fixtures" / "c01_timeline_ir_v1.json"
PROJECT_ID = "11111111-1111-4111-8111-111111111111"


def make_params() -> RemotionRenderParams:
    timeline = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return RemotionRenderParams.model_validate({
        "schemaVersion": 1,
        "renderVersion": "remotion-render-v1",
        "projectId": PROJECT_ID,
        "idempotencyKey": "remotion-test-key",
        "inputProps": {
            "contractVersion": "remotion-runtime-v1",
            "projectId": PROJECT_ID,
            "templateId": "timeline-preview",
            "templateVersion": "timeline-preview-v1",
            "bundleVersion": "remotion-bundle-v1",
            "timeline": timeline,
        },
    })


class _ActiveProject:
    def __init__(self, project_id: str, database: Database, root: Path) -> None:
        self.active_project_id = project_id
        self.active_database = database
        self.active_project_root = root


class RemotionRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="supervideo d03 "))

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def test_contract_rejects_secrets_and_unknown_template(self) -> None:
        value = make_params().model_dump(by_alias=True)
        value["inputProps"]["timeline"]["sources"][0]["metadata"]["credentialRef"] = "never"
        with self.assertRaises(ValidationError):
            RemotionRenderParams.model_validate(value)
        value = make_params().model_dump(by_alias=True)
        value["inputProps"]["templateVersion"] = "attacker"
        with self.assertRaises(ValidationError):
            RemotionRenderParams.model_validate(value)

    def test_runtime_is_offline_atomic_bounded_and_cacheable(self) -> None:
        async def scenario() -> None:
            service = RemotionRuntime(self.root)
            params = make_params()
            async def persist(_step: int, _stage: str, _checkpoint: dict[str, object]) -> None: pass
            first = await service.render(params, cancel_event=asyncio.Event(), shutdown_event=asyncio.Event(), persist=persist)
            second = await service.render(params, cancel_event=asyncio.Event(), shutdown_event=asyncio.Event(), persist=persist)
            self.assertEqual(first["cacheStatus"], "created")
            self.assertEqual(second["cacheStatus"], "cache-hit")
            self.assertTrue((self.root / first["output"]["relativePath"]).is_file())
            self.assertNotIn(str(self.root), json.dumps(second))
            with self.assertRaises(RemotionRuntimeError):
                service._safe_path("generated/remotion-v1/../outside.json")
        asyncio.run(scenario())

    def test_result_paths_are_bound_to_cache_key(self) -> None:
        async def scenario() -> None:
            service = RemotionRuntime(self.root)
            async def persist(_step: int, _stage: str, _checkpoint: dict[str, object]) -> None: pass
            result = await service.render(make_params(), cancel_event=asyncio.Event(), shutdown_event=asyncio.Event(), persist=persist)
            self.assertIsInstance(RemotionRenderResult.model_validate(result), RemotionRenderResult)
            for field, suffix in (("relativePath", ".json"), ("manifestPath", ".manifest.json")):
                invalid = dict(result)
                invalid["output"] = dict(result["output"])
                invalid["output"][field] = f"generated/remotion-v1/renders/{'e' * 64}{suffix}"
                with self.assertRaises(ValidationError):
                    RemotionRenderResult.model_validate(invalid)
        asyncio.run(scenario())

    def test_mismatched_remotion_checkpoint_recovers_to_needs_attention(self) -> None:
        database = Database.open(self.root / "project.db")
        database.migrate()
        project_root = self.root / "project"
        project_root.mkdir()
        ProjectRepository(database).create(ProjectCreate(id=PROJECT_ID, name="D03", project_root=str(project_root), target_platform="douyin", created_at_ms=1, updated_at_ms=1))
        params = make_params()
        input_json = RemotionJobInput(render=params).model_dump(by_alias=True)
        checkpoint = {
            "executor": "remotion.render", "executorVersion": 1, "checkpointVersion": 1,
            "cacheKey": "e" * 64, "timelineDigest": "c" * 64,
        }
        job, _ = JobRepository(database).create_job_with_event(JobCreate(
            id=new_id(), project_id=PROJECT_ID, job_type="remotion.render", status="running", progress=1.0,
            stage="bundle-validated", input_json=input_json, idempotency_key="recovery-key", attempt=1,
            checkpoint_json=checkpoint, checkpoint_version=1, executor_version=1, created_at_ms=1, updated_at_ms=1,
        ))
        self.assertNotEqual(checkpoint["cacheKey"], compute_remotion_cache_key(params))
        async def scenario() -> None:
            manager = JobManager(_ActiveProject(PROJECT_ID, database, project_root))
            await manager.activate(PROJECT_ID)
            current = manager.get(PROJECT_ID, job.id)
            self.assertEqual(current.status, "needs_attention")
            self.assertEqual(current.error_code, "JOB_CHECKPOINT_INVALID")
            await manager.shutdown()
        try:
            asyncio.run(scenario())
        finally:
            database.close()

    def test_filesystem_error_does_not_leave_remotion_job_running(self) -> None:
        database = Database.open(self.root / "project.db")
        database.migrate()
        project_root = self.root / "project"
        project_root.mkdir()
        ProjectRepository(database).create(ProjectCreate(id=PROJECT_ID, name="D03", project_root=str(project_root), target_platform="douyin", created_at_ms=1, updated_at_ms=1))
        original_write = RemotionRuntime._atomic_bytes_write

        def fail_write(_path: Path, _data: bytes) -> None:
            raise PermissionError("test filesystem failure")

        RemotionRuntime._atomic_bytes_write = staticmethod(fail_write)
        async def scenario() -> None:
            manager = JobManager(_ActiveProject(PROJECT_ID, database, project_root))
            await manager.activate(PROJECT_ID)
            job = await manager.start_remotion(make_params())
            for _ in range(100):
                current = manager.get(PROJECT_ID, job.job_id)
                if current.status in {"needs_attention", "failed"}:
                    break
                await asyncio.sleep(0.01)
            current = manager.get(PROJECT_ID, job.job_id)
            self.assertEqual(current.status, "needs_attention")
            self.assertEqual(current.error_code, "REMOTION_OUTPUT_INVALID")
            await manager.shutdown()
        try:
            asyncio.run(scenario())
        finally:
            RemotionRuntime._atomic_bytes_write = staticmethod(original_write)
            database.close()

    def test_persistent_job_uses_sqlite_and_is_idempotent(self) -> None:
        database = Database.open(self.root / "project.db")
        database.migrate()
        project_root = self.root / "project"
        project_root.mkdir()
        ProjectRepository(database).create(ProjectCreate(id=PROJECT_ID, name="D03", project_root=str(project_root), target_platform="douyin", created_at_ms=1, updated_at_ms=1))
        async def scenario() -> None:
            manager = JobManager(_ActiveProject(PROJECT_ID, database, project_root))
            await manager.activate(PROJECT_ID)
            first = await manager.start_remotion(make_params())
            duplicate = await manager.start_remotion(make_params())
            self.assertEqual(first.job_id, duplicate.job_id)
            for _ in range(100):
                current = manager.get(PROJECT_ID, first.job_id)
                if current.status == "succeeded":
                    break
                await asyncio.sleep(0.01)
            self.assertEqual(manager.get(PROJECT_ID, first.job_id).status, "succeeded")
            result = manager.get_remotion_result(PROJECT_ID, first.job_id)
            self.assertEqual(result.runtime_mode, "offline-contract")
            await manager.shutdown()
        try:
            asyncio.run(scenario())
        finally:
            database.close()


if __name__ == "__main__":
    unittest.main()
