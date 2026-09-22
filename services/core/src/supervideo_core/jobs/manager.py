"""SQLite-backed scheduler for one active project."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import ValidationError

from supervideo_core.project.service import ProjectService
from supervideo_core.storage import JobCreate, JobEventRecord, JobRepository, JobRecord, StorageError, new_id, serialize_json_value, utc_now_ms

from .errors import JobError
from .executors import JobCancelled, JobShutdown, RemotionRenderExecutor, SmokeCountdownExecutor, TtsSynthesisExecutor
from .models import JobEventPage, JobEventSummary, JobPage, JobSmokeInput, JobSummary, RemotionJobInput, RemotionRenderParams, RemotionRenderResult, TtsJobInput, TtsJobStartParams, TtsSynthesisResult
from supervideo_core.media.tts_models import TTS_JOB_TYPE
from supervideo_core.media.remotion_models import REMOTION_JOB_TYPE
from .state_machine import can_transition, require_transition

JobEventListener = Callable[[JobEventRecord], None]


class JobManager:
    """Owns runtime tasks; SQLite remains the sole source of job truth."""

    def __init__(
        self,
        project_service: ProjectService,
        *,
        on_event: JobEventListener | None = None,
        max_concurrency: int = 1,
        max_queue: int = 32,
        clock: Callable[[], int] = utc_now_ms,
        sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
        shutdown_timeout_ms: int = 1_000,
    ) -> None:
        self.project_service = project_service
        self.on_event = on_event
        self.max_concurrency = max(1, min(max_concurrency, 1))
        self.max_queue = max(1, min(max_queue, 128))
        self.clock = clock
        self.sleeper = sleeper
        self.shutdown_timeout_ms = max(100, min(shutdown_timeout_ms, 5_000))
        self.executor = SmokeCountdownExecutor()
        self.tts_executor = TtsSynthesisExecutor()
        self.remotion_executor = RemotionRenderExecutor()
        self._project_id: str | None = None
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._shutting_down = False
        self._pausing = False
        self._pump_lock = asyncio.Lock()
        self._shutdown_event = asyncio.Event()

    @property
    def active_project_id(self) -> str | None:
        return self._project_id

    async def activate(self, project_id: str) -> None:
        if self._shutting_down:
            raise JobError("JOB_SHUTTING_DOWN")
        if self.project_service.active_project_id != project_id:
            raise JobError("JOB_NOT_FOUND")
        self._project_id = project_id
        self._pausing = False
        self._recover_incomplete()
        await self._pump()

    async def pause_for_project_change(self) -> None:
        self._pausing = True
        self._shutdown_event.set()
        for event in self._cancel_events.values():
            event.set()
        await self._wait_tasks()
        self._project_id = None
        self._pausing = False
        self._shutdown_event = asyncio.Event()

    async def shutdown(self) -> None:
        if self._shutting_down:
            await self._wait_tasks()
            return
        self._shutting_down = True
        self._pausing = True
        self._shutdown_event.set()
        for event in self._cancel_events.values():
            event.set()
        await self._wait_tasks()
        self._project_id = None

    async def start_smoke(self, project_id: str, idempotency_key: str, params: JobSmokeInput) -> JobSummary:
        self._require_active(project_id)
        if self._shutting_down:
            raise JobError("JOB_SHUTTING_DOWN")
        if not isinstance(idempotency_key, str) or not idempotency_key or len(idempotency_key) > 256:
            raise JobError("IDEMPOTENCY_CONFLICT")
        input_json = params.model_dump(by_alias=False)
        repository = self._repository()
        existing = repository.find_by_idempotency_key(project_id, "smoke.countdown", idempotency_key)
        if existing is not None:
            if serialize_json_value(existing.input_json) != serialize_json_value(input_json):
                raise JobError("IDEMPOTENCY_CONFLICT")
            return self._summary(existing)
        if len(repository.find_incomplete(project_id)) >= self.max_queue:
            raise JobError("JOB_QUEUE_FULL")
        now = self.clock()
        job = JobCreate(
            id=new_id(), project_id=project_id, job_type="smoke.countdown", status="queued",
            progress=0.0, stage="queued", input_json=input_json, idempotency_key=idempotency_key,
            created_at_ms=now, updated_at_ms=now,
        )
        try:
            created, event = repository.create_job_with_event(job, "created", {"jobType": job.job_type})
        except StorageError as error:
            if error.code == "CONSTRAINT_VIOLATION":
                existing = repository.find_by_idempotency_key(project_id, "smoke.countdown", idempotency_key)
                if existing is not None and serialize_json_value(existing.input_json) == serialize_json_value(input_json):
                    return self._summary(existing)
                raise JobError("IDEMPOTENCY_CONFLICT") from error
            raise JobError("JOB_STATE_CONFLICT") from error
        self._publish(event)
        await self._pump()
        return self._summary(created)

    async def start_tts(self, params: TtsJobStartParams) -> JobSummary:
        self._require_active(params.project_id)
        if self._shutting_down:
            raise JobError("JOB_SHUTTING_DOWN")
        input_model = TtsJobInput(
            providerId=params.provider_id,
            model=params.model,
            voice=params.voice,
            sentences=params.sentences,
        )
        input_json = input_model.model_dump(by_alias=False)
        repository = self._repository()
        existing = repository.find_by_idempotency_key(params.project_id, TTS_JOB_TYPE, params.idempotency_key)
        if existing is not None:
            if serialize_json_value(existing.input_json) != serialize_json_value(input_json):
                raise JobError("IDEMPOTENCY_CONFLICT")
            return self._summary(existing)
        if len(repository.find_incomplete(params.project_id)) >= self.max_queue:
            raise JobError("JOB_QUEUE_FULL")
        now = self.clock()
        job = JobCreate(
            id=new_id(), project_id=params.project_id, job_type=TTS_JOB_TYPE, status="queued",
            progress=0.0, stage="queued", input_json=input_json, idempotency_key=params.idempotency_key,
            created_at_ms=now, updated_at_ms=now, executor_version=self.tts_executor.executor_version,
        )
        try:
            created, event = repository.create_job_with_event(job, "created", {"jobType": TTS_JOB_TYPE})
        except StorageError as error:
            if error.code == "CONSTRAINT_VIOLATION":
                existing = repository.find_by_idempotency_key(params.project_id, TTS_JOB_TYPE, params.idempotency_key)
                if existing is not None and serialize_json_value(existing.input_json) == serialize_json_value(input_json):
                    return self._summary(existing)
                raise JobError("IDEMPOTENCY_CONFLICT") from error
            raise JobError("JOB_STATE_CONFLICT") from error
        self._publish(event)
        await self._pump()
        return self._summary(created)

    async def start_remotion(self, params: RemotionRenderParams) -> JobSummary:
        self._require_active(params.project_id)
        if self._shutting_down:
            raise JobError("JOB_SHUTTING_DOWN")
        input_model = RemotionJobInput(render=params)
        input_json = input_model.model_dump(by_alias=True)
        repository = self._repository()
        existing = repository.find_by_idempotency_key(params.project_id, REMOTION_JOB_TYPE, params.idempotency_key)
        if existing is not None:
            if serialize_json_value(existing.input_json) != serialize_json_value(input_json):
                raise JobError("IDEMPOTENCY_CONFLICT")
            return self._summary(existing)
        if len(repository.find_incomplete(params.project_id)) >= self.max_queue:
            raise JobError("JOB_QUEUE_FULL")
        now = self.clock()
        job = JobCreate(
            id=new_id(), project_id=params.project_id, job_type=REMOTION_JOB_TYPE, status="queued",
            progress=0.0, stage="queued", input_json=input_json, idempotency_key=params.idempotency_key,
            created_at_ms=now, updated_at_ms=now, executor_version=self.remotion_executor.executor_version,
        )
        try:
            created, event = repository.create_job_with_event(job, "created", {"jobType": REMOTION_JOB_TYPE})
        except StorageError as error:
            if error.code == "CONSTRAINT_VIOLATION":
                existing = repository.find_by_idempotency_key(params.project_id, REMOTION_JOB_TYPE, params.idempotency_key)
                if existing is not None and serialize_json_value(existing.input_json) == serialize_json_value(input_json):
                    return self._summary(existing)
                raise JobError("IDEMPOTENCY_CONFLICT") from error
            raise JobError("JOB_STATE_CONFLICT") from error
        self._publish(event)
        await self._pump()
        return self._summary(created)

    def get(self, project_id: str, job_id: str) -> JobSummary:
        self._require_active(project_id)
        try:
            return self._summary(self._repository().get(job_id, project_id))
        except StorageError as error:
            if error.code == "RECORD_NOT_FOUND":
                raise JobError("JOB_NOT_FOUND") from error
            raise JobError("JOB_STATE_CONFLICT") from error

    def get_tts_result(self, project_id: str, job_id: str) -> TtsSynthesisResult:
        self._require_active(project_id)
        current = self._get_record(self._repository(), project_id, job_id)
        if current.job_type != TTS_JOB_TYPE or current.status != "succeeded" or current.result_json is None:
            raise JobError("JOB_STATE_CONFLICT")
        try:
            return TtsSynthesisResult.model_validate(current.result_json)
        except ValidationError as error:
            raise JobError("JOB_CHECKPOINT_INVALID") from error

    def get_remotion_result(self, project_id: str, job_id: str) -> RemotionRenderResult:
        self._require_active(project_id)
        current = self._get_record(self._repository(), project_id, job_id)
        if current.job_type != REMOTION_JOB_TYPE or current.status != "succeeded" or current.result_json is None:
            raise JobError("JOB_STATE_CONFLICT")
        try:
            return RemotionRenderResult.model_validate(current.result_json)
        except ValidationError as error:
            raise JobError("JOB_CHECKPOINT_INVALID") from error

    def list(self, project_id: str, statuses: list[str] | None, cursor: str | None, limit: int) -> JobPage:
        self._require_active(project_id)
        if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > 100:
            raise JobError("JOB_STATE_CONFLICT")
        rows = self._repository().list_for_project(project_id, limit + 1, statuses=statuses, cursor=cursor)
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = f"{rows[-1].created_at_ms}/{rows[-1].id}" if has_more and rows else None
        return JobPage(projectId=project_id, items=[self._summary(row) for row in rows], nextCursor=next_cursor, hasMore=has_more)

    def events(self, project_id: str, job_id: str, after_sequence: int, cursor: str | None, limit: int) -> JobEventPage:
        self._require_active(project_id)
        try:
            self._repository().get(job_id, project_id)
            if cursor is not None:
                try:
                    after_sequence = max(after_sequence, int(cursor))
                except (ValueError, TypeError):
                    raise JobError("JOB_EVENT_GAP")
            rows = self._repository().list_events(project_id, job_id, after_sequence, limit + 1)
        except StorageError as error:
            if error.code == "RECORD_NOT_FOUND":
                raise JobError("JOB_NOT_FOUND") from error
            raise JobError("JOB_EVENT_GAP") from error
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = str(rows[-1].sequence) if has_more and rows else None
        return JobEventPage(
            projectId=project_id, jobId=job_id,
            items=[self._event_summary(row) for row in rows], nextCursor=next_cursor, hasMore=has_more,
        )

    async def cancel(self, project_id: str, job_id: str) -> JobSummary:
        self._require_active(project_id)
        repository = self._repository()
        current = self._get_record(repository, project_id, job_id)
        if current.status in {"succeeded", "failed", "cancelled", "needs_attention"}:
            if current.status == "cancelled":
                return self._summary(current)
            raise JobError("JOB_NOT_CANCELLABLE")
        if current.status == "queued":
            updated, event = self._transition(repository, current, "cancelled", event_type="cancelled", payload={"reason": "user"})
            self._publish(event)
            return self._summary(updated)
        if current.status == "cancelling":
            return self._summary(current)
        if current.status != "running":
            raise JobError("JOB_NOT_CANCELLABLE")
        updated, event = self._transition(
            repository, current, "cancelling", event_type="cancel-requested", payload={"reason": "user"},
            cancel_requested_at_ms=self.clock(),
        )
        self._publish(event)
        cancel_event = self._cancel_events.get(job_id)
        if cancel_event is not None:
            cancel_event.set()
        return self._summary(updated)

    async def retry(self, project_id: str, job_id: str) -> JobSummary:
        self._require_active(project_id)
        repository = self._repository()
        current = self._get_record(repository, project_id, job_id)
        if current.status == "needs_attention" and not self._checkpoint_is_valid(current):
            raise JobError("JOB_NOT_RETRYABLE")
        if current.status != "failed" and current.status != "needs_attention":
            raise JobError("JOB_NOT_RETRYABLE")
        if current.attempt >= 3:
            raise JobError("JOB_RETRY_LIMIT")
        updated, event = self._transition(repository, current, "retrying", event_type="retrying", payload={"previousAttempt": current.attempt})
        self._publish(event)
        await self._pump()
        return self._summary(updated)

    async def _pump(self) -> None:
        async with self._pump_lock:
            if self._project_id is None or self._pausing or self._shutting_down:
                return
            repository = self._repository()
            while len(self._tasks) < self.max_concurrency:
                candidates = repository.list_for_project(
                    self._project_id, self.max_queue,
                    statuses=("queued", "retrying"),
                )
                current = next((item for item in candidates if item.id not in self._tasks), None)
                if current is None:
                    return
                next_attempt = current.attempt + 1
                try:
                    running, event = self._transition(
                        repository, current, "running", attempt=next_attempt,
                        event_type="started", payload={"attempt": next_attempt},
                    )
                except JobError:
                    continue
                self._publish(event)
                cancel_event = asyncio.Event()
                self._cancel_events[running.id] = cancel_event
                task = asyncio.create_task(self._run(running, cancel_event), name=f"job-{running.id}")
                self._tasks[running.id] = task

    async def _run(self, job: JobRecord, cancel_event: asyncio.Event) -> None:
        repository = self._repository()
        async def persist(step: int, stage: str, checkpoint: dict[str, Any]) -> None:
            nonlocal job
            current = self._get_record(repository, job.project_id, job.id)
            if current.status != "running":
                raise JobCancelled()
            if job.job_type == TTS_JOB_TYPE:
                total = max(1, len(job.input_json.get("sentences", [])))
                progress = step / total
                payload: dict[str, object] = {"sentenceIndex": step - 1}
            elif job.job_type == REMOTION_JOB_TYPE:
                progress = min(1.0, float(step))
                payload = {"renderStep": step}
            else:
                progress = step / int(job.input_json["steps"])
                payload = {"step": step}
            updated, event = repository.append_progress_and_checkpoint(
                job.id, job.project_id, current.revision, progress, stage,
                checkpoint, timestamp_ms=self.clock(), payload=payload,
            )
            self._publish(event)
            job = updated

        try:
            if not self._checkpoint_is_valid(job):
                raise JobError("JOB_CHECKPOINT_INVALID")
            if job.job_type == self.executor.name:
                params = JobSmokeInput.model_validate(job.input_json)
                await self.executor.run(
                    params, attempt=job.attempt, checkpoint=job.checkpoint_json,
                    cancel_event=cancel_event, shutdown_event=self._shutdown_event,
                    persist=persist, sleeper=self.sleeper,
                )
                result_json: dict[str, Any] = {"status": "completed", "steps": params.steps}
                event_payload: dict[str, object] = {"steps": params.steps}
            elif job.job_type == self.tts_executor.name:
                params = TtsJobInput.model_validate(job.input_json)
                project_root = self.project_service.active_project_root
                if project_root is None:
                    raise JobError("JOB_EXECUTOR_UNAVAILABLE")
                self.tts_executor.service.bind_session(project_root)
                result_json = await self.tts_executor.run(
                    job.project_id, params, attempt=job.attempt, checkpoint=job.checkpoint_json,
                    cancel_event=cancel_event, shutdown_event=self._shutdown_event, persist=persist,
                )
                event_payload = {
                    "cacheKey": result_json.get("cacheKey"),
                    "durationMs": result_json.get("durationMs"),
                    "sentenceCount": len(params.sentences),
                }
            elif job.job_type == self.remotion_executor.name:
                params = RemotionJobInput.model_validate(job.input_json)
                project_root = self.project_service.active_project_root
                if project_root is None:
                    raise JobError("JOB_EXECUTOR_UNAVAILABLE")
                result_json = await self.remotion_executor.run(
                    job.project_id, params, project_root=project_root, checkpoint=job.checkpoint_json,
                    cancel_event=cancel_event, shutdown_event=self._shutdown_event, persist=persist,
                )
                event_payload = {"cacheKey": result_json.get("cacheKey"), "runtimeMode": result_json.get("runtimeMode")}
            else:
                raise JobError("JOB_EXECUTOR_UNAVAILABLE")
            current = self._get_record(repository, job.project_id, job.id)
            if current.status == "running":
                updated, event = self._transition(
                    repository, current, "succeeded", progress=1.0, stage="completed",
                    result_json=result_json, event_type="succeeded", payload=event_payload,
                )
                self._publish(event)
        except JobCancelled:
            current = self._safe_get(repository, job.project_id, job.id)
            if current is not None and current.status == "cancelling":
                updated, event = self._transition(repository, current, "cancelled", event_type="cancelled", payload={"reason": "user"})
                self._publish(event)
        except JobShutdown:
            current = self._safe_get(repository, job.project_id, job.id)
            if current is not None and current.status == "running":
                updated, event = self._transition(repository, current, "retrying", event_type="paused-for-shutdown", payload={"recoverable": True})
                self._publish(event)
        except JobError as error:
            current = self._safe_get(repository, job.project_id, job.id)
            if current is not None and current.status == "running":
                target = "failed" if error.code == "JOB_EXECUTION_FAILED" else "needs_attention"
                updated, event = self._transition(repository, current, target, error_code=error.code, event_type=target, payload={"errorCode": error.code})
                self._publish(event)
        except (StorageError, ValidationError):
            current = self._safe_get(repository, job.project_id, job.id)
            if current is not None and current.status == "running":
                updated, event = self._transition(repository, current, "needs_attention", error_code="JOB_CHECKPOINT_INVALID", event_type="needs_attention", payload={"errorCode": "JOB_CHECKPOINT_INVALID"})
                self._publish(event)
        finally:
            self._tasks.pop(job.id, None)
            self._cancel_events.pop(job.id, None)
            if not self._shutting_down and not self._pausing:
                await self._pump()

    def _recover_incomplete(self) -> None:
        repository = self._repository()
        for current in repository.find_incomplete(self._project_id or ""):
            if current.status == "cancelling":
                updated, event = self._transition(repository, current, "cancelled", event_type="recovered-cancelled", payload={"reason": "previous-process"})
                self._publish(event)
            elif current.status == "running":
                if not self._checkpoint_is_valid(current):
                    updated, event = self._transition(repository, current, "needs_attention", error_code="JOB_CHECKPOINT_INVALID", event_type="needs_attention", payload={"errorCode": "JOB_CHECKPOINT_INVALID"}, recovery_count=current.recovery_count + 1)
                else:
                    updated, event = self._transition(repository, current, "retrying", event_type="recovered", payload={"recoveryCount": current.recovery_count + 1}, recovery_count=current.recovery_count + 1)
                self._publish(event)
            elif not self._checkpoint_is_valid(current):
                updated, event = self._transition(repository, current, "needs_attention", error_code="JOB_CHECKPOINT_INVALID", event_type="needs_attention", payload={"errorCode": "JOB_CHECKPOINT_INVALID"})
                self._publish(event)

    def _checkpoint_is_valid(self, job: JobRecord) -> bool:
        if job.job_type == self.executor.name:
            executor = self.executor
            params_type = JobSmokeInput
        elif job.job_type == self.tts_executor.name:
            executor = self.tts_executor
            params_type = TtsJobInput
        elif job.job_type == self.remotion_executor.name:
            executor = self.remotion_executor
            params_type = RemotionJobInput
        else:
            return False
        if job.executor_version != executor.executor_version:
            return False
        if job.checkpoint_json is None:
            return True
        try:
            params = params_type.model_validate(job.input_json)
            if job.job_type == TTS_JOB_TYPE:
                adapter = self.tts_executor.service.registry.get(params.provider_id)
                if adapter is None or job.checkpoint_json.get("cacheKey") != self.tts_executor.service.cache_key(job.project_id, params, adapter.adapter_version):
                    return False
            executor.validate_checkpoint(job.checkpoint_json, params)
        except (JobError, ValidationError, TypeError, ValueError):
            return False
        return job.checkpoint_version == executor.checkpoint_version

    def _transition(self, repository: JobRepository, current: JobRecord, target: str, **kwargs: Any) -> tuple[JobRecord, JobEventRecord]:
        require_transition(current.status, target)
        try:
            return repository.transition(
                current.id, current.project_id, current.revision, (current.status,), target,
                timestamp_ms=self.clock(), **kwargs,
            )
        except StorageError as error:
            if error.code == "RECORD_NOT_FOUND":
                raise JobError("JOB_NOT_FOUND") from error
            raise JobError("JOB_STATE_CONFLICT") from error

    def _repository(self) -> JobRepository:
        database = self.project_service.active_database
        if database is None or self._project_id is None:
            raise JobError("JOB_NOT_FOUND")
        return JobRepository(database)

    def _require_active(self, project_id: str) -> None:
        if self._project_id != project_id or self.project_service.active_project_id != project_id:
            raise JobError("JOB_NOT_FOUND")

    @staticmethod
    def _get_record(repository: JobRepository, project_id: str, job_id: str) -> JobRecord:
        try:
            return repository.get(job_id, project_id)
        except StorageError as error:
            if error.code == "RECORD_NOT_FOUND":
                raise JobError("JOB_NOT_FOUND") from error
            raise JobError("JOB_STATE_CONFLICT") from error

    @staticmethod
    def _safe_get(repository: JobRepository, project_id: str, job_id: str) -> JobRecord | None:
        try:
            return repository.get(job_id, project_id)
        except StorageError:
            return None

    def _publish(self, event: JobEventRecord) -> None:
        if self.on_event is not None:
            try:
                self.on_event(event)
            except Exception:
                pass

    @staticmethod
    def _summary(job: JobRecord) -> JobSummary:
        return JobSummary(
            jobId=job.id, projectId=job.project_id, jobType=job.job_type, status=job.status,
            progress=job.progress, stage=job.stage, attempt=job.attempt,
            revision=job.revision, lastEventSequence=job.last_event_sequence,
            createdAtMs=job.created_at_ms, updatedAtMs=job.updated_at_ms,
            startedAtMs=job.started_at_ms, finishedAtMs=job.finished_at_ms, errorCode=job.error_code,
        )

    @staticmethod
    def _event_summary(event: JobEventRecord) -> JobEventSummary:
        return JobEventSummary(
            projectId=event.project_id, jobId=event.job_id, sequence=event.sequence,
            eventType=event.event_type, status=event.status, progress=event.progress,
            stage=event.stage, attempt=event.attempt, timestamp=event.created_at_ms,
            payload=event.payload_json,
        )

    async def _wait_tasks(self) -> None:
        tasks = list(self._tasks.values())
        if not tasks:
            return
        try:
            await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), self.shutdown_timeout_ms / 1_000)
        except asyncio.TimeoutError:
            # Leave durable running rows for the next open to recover. Never
            # manufacture a successful or cancelled terminal state on timeout.
            return
