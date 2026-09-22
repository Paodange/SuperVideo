from __future__ import annotations

import asyncio
import shutil
import tempfile
import unittest
import wave
from pathlib import Path

from supervideo_core.jobs import JobError, JobManager
from supervideo_core.media.tts import DeterministicFakeTtsAdapter, TtsAdapterRegistry, TtsSynthesisService
from supervideo_core.media.tts_models import TtsJobStartParams
from supervideo_core.project import ProjectCreateRequest, ProjectService
from supervideo_core.storage import JobRepository


class D02TtsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="supervideo d02 tts "))
        self.project = ProjectService()
        self.summary = self.project.create(ProjectCreateRequest(name="D02 TTS", targetPlatform="douyin", projectRoot=str(self.root)))

    def tearDown(self) -> None:
        self.project.close()
        shutil.rmtree(self.root, ignore_errors=True)

    def request(self, key: str, *, voice: str = "alloy", model: str = "fake-tts-v1", provider: str = "fake") -> TtsJobStartParams:
        return TtsJobStartParams(
            projectId=self.summary.project_id,
            idempotencyKey=key,
            providerId=provider,
            model=model,
            voice=voice,
            sentences=[
                {"sentenceId": "s-1", "text": "Hello SuperVideo.", "provenanceIds": ["script-1"]},
                {"sentenceId": "s-2", "text": "Deterministic audio is easy to verify.", "provenanceIds": ["script-2"]},
            ],
        )

    def test_fake_tts_is_cached_by_selection_and_voice(self) -> None:
        async def scenario() -> None:
            manager = JobManager(self.project)
            await manager.activate(self.summary.project_id)
            first = await manager.start_tts(self.request("first"))
            await wait_for_status(manager, self.summary.project_id, first.job_id, "succeeded")
            result = manager.get_tts_result(self.summary.project_id, first.job_id)
            self.assertEqual(result.cache_status, "created")
            self.assertEqual(result.duration_ms, result.sentences[-1].end_ms)
            same_submission = await manager.start_tts(self.request("first"))
            self.assertEqual(same_submission.job_id, first.job_id)
            with self.assertRaises(JobError) as conflict:
                await manager.start_tts(self.request("first", voice="nova"))
            self.assertEqual(conflict.exception.code, "IDEMPOTENCY_CONFLICT")
            output = self.root / result.output.relative_path
            self.assertTrue(output.is_file())
            with wave.open(str(output), "rb") as handle:
                self.assertEqual(handle.getnchannels(), 1)
                self.assertGreater(handle.getnframes(), 0)

            second = await manager.start_tts(self.request("second"))
            await wait_for_status(manager, self.summary.project_id, second.job_id, "succeeded")
            cached = manager.get_tts_result(self.summary.project_id, second.job_id)
            self.assertEqual(cached.cache_status, "cache-hit")
            self.assertEqual(cached.cache_key, result.cache_key)

            different_voice = await manager.start_tts(self.request("third", voice="nova"))
            await wait_for_status(manager, self.summary.project_id, different_voice.job_id, "succeeded")
            different = manager.get_tts_result(self.summary.project_id, different_voice.job_id)
            self.assertNotEqual(different.cache_key, result.cache_key)
            self.assertNotEqual(different.output.relative_path, result.output.relative_path)

            durable = JobRepository(self.project.active_database).get(first.job_id, self.summary.project_id)  # type: ignore[arg-type]
            self.assertNotIn("secret", durable.input_json)
            self.assertNotIn("credentialRef", durable.input_json)
            events = JobRepository(self.project.active_database).list_events(self.summary.project_id, first.job_id)  # type: ignore[arg-type]
            self.assertEqual(events[-1].event_type, "succeeded")
            self.assertNotIn("Hello SuperVideo.", str(events[-1].payload_json))
            await manager.shutdown()

        asyncio.run(scenario())

    def test_retry_and_restart_resume_are_durable(self) -> None:
        async def scenario() -> None:
            manager = JobManager(self.project)
            await manager.activate(self.summary.project_id)
            class TinyFake(DeterministicFakeTtsAdapter):
                provider_id = "tiny"

                def synthesize_sentence(self, text: str, *, model: str, voice: str) -> tuple[bytes, int]:
                    return b"\x00\x00" * 100, 10

            manager.tts_executor.service = TtsSynthesisService(registry=TtsAdapterRegistry((TinyFake(),)))
            retryable = await manager.start_tts(self.request("retry", model="fake-retry-once", provider="tiny"))
            await wait_for_status(manager, self.summary.project_id, retryable.job_id, "failed")
            await manager.retry(self.summary.project_id, retryable.job_id)
            await wait_for_status(manager, self.summary.project_id, retryable.job_id, "succeeded")
            self.assertEqual(manager.get(self.summary.project_id, retryable.job_id).attempt, 2)
            await manager.shutdown()

            class SlowFake(DeterministicFakeTtsAdapter):
                provider_id = "slow"

                def synthesize_sentence(self, text: str, *, model: str, voice: str) -> tuple[bytes, int]:
                    import time
                    time.sleep(0.003)
                    return b"\x00\x00" * 100, 10

            recovering = JobManager(self.project)
            recovering.tts_executor.service = TtsSynthesisService(registry=TtsAdapterRegistry((SlowFake(),)))
            await recovering.activate(self.summary.project_id)
            params = self.request("restart", provider="slow")
            params = params.model_copy(update={"sentences": [
                {"sentenceId": f"s-{index}", "text": "A recoverable sentence.", "provenanceIds": [f"p-{index}"]}
                for index in range(24)
            ]})
            running = await recovering.start_tts(params)
            await wait_for_progress(recovering, self.summary.project_id, running.job_id)
            checkpoint = JobRepository(self.project.active_database).get(running.job_id, self.summary.project_id).checkpoint_json  # type: ignore[arg-type]
            self.assertIsNotNone(checkpoint)
            await recovering.shutdown()
            self.assertEqual(JobRepository(self.project.active_database).get(running.job_id, self.summary.project_id).status, "retrying")  # type: ignore[arg-type]

            reopened = JobManager(self.project)
            reopened.tts_executor.service = TtsSynthesisService(registry=TtsAdapterRegistry((SlowFake(),)))
            await reopened.activate(self.summary.project_id)
            await wait_for_status(reopened, self.summary.project_id, running.job_id, "succeeded")
            self.assertEqual(len(reopened.get_tts_result(self.summary.project_id, running.job_id).sentences), 24)
            await reopened.shutdown()

        asyncio.run(scenario())


async def wait_for_status(manager: JobManager, project_id: str, job_id: str, status: str):
    for _ in range(10_000):
        current = manager.get(project_id, job_id)
        if current.status == status:
            return current
        if current.status in {"needs_attention", "cancelled"}:
            raise AssertionError(f"job ended in {current.status}")
        await asyncio.sleep(0.001)
    raise AssertionError(f"job did not reach {status}")


async def wait_for_progress(manager: JobManager, project_id: str, job_id: str):
    for _ in range(10_000):
        current = manager.get(project_id, job_id)
        if current.status == "running" and current.progress > 0:
            return current
        if current.status in {"failed", "needs_attention", "cancelled", "succeeded"}:
            raise AssertionError(f"job did not pause while running: {current.status}")
        await asyncio.sleep(0.001)
    raise AssertionError("job did not report progress")


if __name__ == "__main__":
    unittest.main()
