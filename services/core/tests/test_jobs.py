from __future__ import annotations

import asyncio
import shutil
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from supervideo_core.jobs import JobError, JobManager, JobSmokeInput, can_transition
from supervideo_core.storage import Database, JobCreate, JobRepository, ProjectCreate, ProjectRepository, StorageError, new_id


class _ActiveProject:
    def __init__(self, project_id: str, database: Database) -> None:
        self.active_project_id = project_id
        self.active_database = database


class JobsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_root = Path(tempfile.mkdtemp(prefix="supervideo jobs test "))
        self.database = Database.open(self.temp_root / "project.db")
        self.database.migrate()
        self.project_id = "11111111-1111-4111-8111-111111111111"
        ProjectRepository(self.database).create(
            ProjectCreate(
                id=self.project_id,
                name="Jobs test",
                project_root=str(self.temp_root / "project-root"),
                target_platform="douyin",
                created_at_ms=1_700_000_000_000,
                updated_at_ms=1_700_000_000_000,
            )
        )
        self.jobs = JobRepository(self.database)

    def tearDown(self) -> None:
        self.database.close()
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def make_job(self, *, status: str = "queued", **updates: object) -> JobCreate:
        values: dict[str, object] = {
            "id": new_id(),
            "project_id": self.project_id,
            "job_type": "smoke.countdown",
            "status": status,
            "progress": 0.0,
            "stage": "queued",
            "input_json": {"steps": 4, "delayMs": 1, "failAttempts": 0},
            "created_at_ms": 1_700_000_000_001,
            "updated_at_ms": 1_700_000_000_001,
        }
        values.update(updates)
        return JobCreate.model_validate(values)

    def test_fresh_defaults_and_create_event_are_atomic(self) -> None:
        job, created = self.jobs.create_job_with_event(self.make_job(), payload={"kind": "created"})
        self.assertEqual((job.revision, job.last_event_sequence), (1, 1))
        self.assertEqual(created.sequence, 1)
        self.assertEqual(self.jobs.list_events(self.project_id, job.id)[0].event_type, "created")
        with self.assertRaises(ValueError):
            self.jobs.create_job_with_event(self.make_job(), payload=object())
        self.assertEqual(self.database.connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 1)
        self.assertEqual(self.database.connection.execute("SELECT COUNT(*) FROM job_events").fetchone()[0], 1)

    def test_transition_cas_monotonic_progress_and_event_sequence(self) -> None:
        job, _ = self.jobs.create_job_with_event(self.make_job())
        running, started = self.jobs.transition(
            job.id, self.project_id, job.revision, ("queued",), "running",
            attempt=1, event_type="started", payload={}, timestamp_ms=2,
        )
        updated, progress = self.jobs.append_progress_and_checkpoint(
            running.id, self.project_id, running.revision, 0.25, "step-1",
            {"executor": "smoke.countdown", "completedSteps": 1, "nextStep": 2}, timestamp_ms=3,
        )
        self.assertEqual([started.sequence, progress.sequence], [2, 3])
        self.assertEqual(updated.last_event_sequence, 3)
        with self.assertRaises(StorageError) as stale:
            self.jobs.transition(running.id, self.project_id, running.revision, ("running",), "succeeded", progress=1.0, event_type="succeeded", timestamp_ms=4)
        self.assertEqual(stale.exception.code, "CONSTRAINT_VIOLATION")
        with self.assertRaises(StorageError) as backwards:
            self.jobs.append_progress_and_checkpoint(updated.id, self.project_id, updated.revision, 0.1, "bad", {"x": 1}, timestamp_ms=4)
        self.assertEqual(backwards.exception.code, "CONSTRAINT_VIOLATION")

    def test_event_pagination_and_project_isolation(self) -> None:
        job, _ = self.jobs.create_job_with_event(self.make_job())
        current = job
        for sequence in range(2, 5):
            current, _ = self.jobs.transition(current.id, self.project_id, current.revision, ("queued",) if sequence == 2 else ("running",), "running" if sequence < 4 else "succeeded", progress=(sequence - 1) / 4, attempt=1 if sequence == 2 else None, event_type=f"event-{sequence}", timestamp_ms=sequence)
        first_page = self.jobs.list_events(self.project_id, current.id, after_sequence=1, limit=2)
        second_page = self.jobs.list_events(self.project_id, current.id, after_sequence=first_page[-1].sequence, limit=10)
        self.assertEqual([event.sequence for event in first_page + second_page], [2, 3, 4])
        other_project = "22222222-2222-4222-8222-222222222222"
        self.assertEqual(self.jobs.list_for_project(other_project), [])
        self.assertEqual(self.jobs.list_events(other_project, current.id), [])

    def test_state_machine_rejects_terminal_and_unknown_edges(self) -> None:
        self.assertTrue(can_transition("queued", "running"))
        self.assertTrue(can_transition("running", "cancelling"))
        self.assertTrue(can_transition("failed", "retrying"))
        self.assertFalse(can_transition("running", "cancelled"))
        self.assertFalse(can_transition("succeeded", "retrying"))
        self.assertFalse(can_transition("unknown", "running"))

    def test_manager_success_cancel_retry_and_idempotency(self) -> None:
        async def scenario() -> None:
            manager = JobManager(_ActiveProject(self.project_id, self.database))
            await manager.activate(self.project_id)
            first = await manager.start_smoke(self.project_id, "same-key", JobSmokeInput(steps=3, delayMs=1))
            duplicate = await manager.start_smoke(self.project_id, "same-key", JobSmokeInput(steps=3, delayMs=1))
            self.assertEqual(first.job_id, duplicate.job_id)
            with self.assertRaises(JobError) as conflict:
                await manager.start_smoke(self.project_id, "same-key", JobSmokeInput(steps=4, delayMs=1))
            self.assertEqual(conflict.exception.code, "IDEMPOTENCY_CONFLICT")
            await _wait_for(lambda: self.jobs.get(first.job_id, self.project_id).status == "succeeded")
            queued = await manager.start_smoke(self.project_id, "cancel-key", JobSmokeInput(steps=8, delayMs=10))
            await _wait_for(lambda: self.jobs.get(queued.job_id, self.project_id).status == "running")
            await manager.cancel(self.project_id, queued.job_id)
            await _wait_for(lambda: self.jobs.get(queued.job_id, self.project_id).status == "cancelled")
            failed = await manager.start_smoke(self.project_id, "fail-key", JobSmokeInput(steps=4, delayMs=1, failAttempts=1))
            await _wait_for(lambda: self.jobs.get(failed.job_id, self.project_id).status == "failed")
            retried = await manager.retry(self.project_id, failed.job_id)
            self.assertEqual(retried.status, "retrying")
            await _wait_for(lambda: self.jobs.get(failed.job_id, self.project_id).status == "succeeded")
            self.assertEqual(self.jobs.get(failed.job_id, self.project_id).attempt, 2)
            await manager.shutdown()

        asyncio.run(scenario())

    def test_shutdown_reopen_resumes_checkpoint_and_cancelling_converges(self) -> None:
        async def scenario() -> None:
            first_manager = JobManager(_ActiveProject(self.project_id, self.database))
            await first_manager.activate(self.project_id)
            job = await first_manager.start_smoke(self.project_id, "reopen-key", JobSmokeInput(steps=8, delayMs=10))
            await _wait_for(lambda: self.jobs.get(job.job_id, self.project_id).status == "running" and self.jobs.get(job.job_id, self.project_id).progress > 0)
            checkpoint = self.jobs.get(job.job_id, self.project_id).checkpoint_json
            self.assertIsNotNone(checkpoint)
            await first_manager.shutdown()
            paused = self.jobs.get(job.job_id, self.project_id)
            self.assertEqual(paused.status, "retrying")
            second_manager = JobManager(_ActiveProject(self.project_id, self.database))
            await second_manager.activate(self.project_id)
            await _wait_for(lambda: self.jobs.get(job.job_id, self.project_id).status == "succeeded")
            events = self.jobs.list_events(self.project_id, job.job_id)
            self.assertEqual([event.sequence for event in events], list(range(1, len(events) + 1)))
            self.assertEqual(sum(event.status == "succeeded" for event in events), 1)
            await second_manager.shutdown()

            cancelling, _ = self.jobs.create_job_with_event(self.make_job(status="cancelling"))
            third_manager = JobManager(_ActiveProject(self.project_id, self.database))
            await third_manager.activate(self.project_id)
            self.assertEqual(self.jobs.get(cancelling.id, self.project_id).status, "cancelled")
            await third_manager.shutdown()

        asyncio.run(scenario())

    def test_invalid_checkpoint_becomes_needs_attention(self) -> None:
        async def scenario() -> None:
            job, _ = self.jobs.create_job_with_event(
                self.make_job(status="running", attempt=1, checkpoint_json={"executor": "unknown"}, checkpoint_version=99)
            )
            manager = JobManager(_ActiveProject(self.project_id, self.database))
            await manager.activate(self.project_id)
            current = self.jobs.get(job.id, self.project_id)
            self.assertEqual(current.status, "needs_attention")
            with self.assertRaises(JobError) as retry_error:
                await manager.retry(self.project_id, job.id)
            self.assertEqual(retry_error.exception.code, "JOB_NOT_RETRYABLE")
            await manager.shutdown()

        asyncio.run(scenario())


async def _wait_for(predicate, timeout: float = 2.0) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.001)
    raise AssertionError("condition was not reached before timeout")


if __name__ == "__main__":
    unittest.main()
