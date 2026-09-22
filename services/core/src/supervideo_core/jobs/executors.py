"""Deterministic, side-effect-free A07 executors."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from .errors import JobError
from .models import JobSmokeInput
from supervideo_core.media.tts import TtsExecutionCancelled, TtsExecutionShutdown, TtsSynthesisService
from supervideo_core.media.tts_models import TtsJobInput
from supervideo_core.media.remotion import RemotionRuntime, RemotionRuntimeError, RemotionRuntimeShutdown
from supervideo_core.media.remotion_models import compute_remotion_cache_key
from supervideo_core.jobs.models import RemotionJobInput
from supervideo_core.media.image import ImageExecutionCancelled, ImageExecutionShutdown, ImageGenerationService
from supervideo_core.media.image_models import ImageJobInput


class JobCancelled(Exception):
    pass


class JobShutdown(Exception):
    pass


class SmokeCountdownExecutor:
    name = "smoke.countdown"
    executor_version = 1
    checkpoint_version = 1

    async def run(
        self,
        params: JobSmokeInput,
        *,
        attempt: int,
        checkpoint: dict[str, Any] | None,
        cancel_event: asyncio.Event,
        shutdown_event: asyncio.Event,
        persist: Callable[[int, str, dict[str, Any]], Awaitable[None]],
        sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> dict[str, object]:
        completed = 0
        if checkpoint is not None:
            self.validate_checkpoint(checkpoint, params)
            completed = int(checkpoint["completedSteps"])
        failure_step = max(1, params.steps // 2)
        for step in range(completed + 1, params.steps + 1):
            if shutdown_event.is_set():
                raise JobShutdown()
            if cancel_event.is_set():
                raise JobCancelled()
            await sleeper(params.delay_ms / 1_000)
            if shutdown_event.is_set():
                raise JobShutdown()
            if cancel_event.is_set():
                raise JobCancelled()
            if params.fail_attempts and attempt == 1 and step == failure_step:
                raise JobError("JOB_EXECUTION_FAILED")
            checkpoint_value = {
                "executor": self.name,
                "executorVersion": self.executor_version,
                "checkpointVersion": self.checkpoint_version,
                "steps": params.steps,
                "completedSteps": step,
                "nextStep": step + 1,
            }
            await persist(step, f"step-{step}", checkpoint_value)
        return {"status": "completed", "steps": params.steps}

    def validate_checkpoint(self, value: dict[str, Any], params: JobSmokeInput) -> None:
        if (
            value.get("executor") != self.name
            or value.get("executorVersion") != self.executor_version
            or value.get("checkpointVersion") != self.checkpoint_version
            or value.get("steps") != params.steps
            or not isinstance(value.get("completedSteps"), int)
            or not 0 <= value["completedSteps"] <= params.steps
            or value.get("nextStep") != value["completedSteps"] + 1
        ):
            raise JobError("JOB_CHECKPOINT_INVALID")


class TtsSynthesisExecutor:
    """A07 executor wrapper for the Core-owned offline D02 adapter."""

    name = "tts.synthesize"
    executor_version = 1
    checkpoint_version = 1

    def __init__(self, service: TtsSynthesisService | None = None) -> None:
        self.service = service or TtsSynthesisService()

    async def run(
        self,
        project_id: str,
        params: TtsJobInput,
        *,
        attempt: int,
        checkpoint: dict[str, Any] | None,
        cancel_event: asyncio.Event,
        shutdown_event: asyncio.Event,
        persist: Callable[[int, str, dict[str, Any]], Awaitable[None]],
    ) -> dict[str, object]:
        # A deterministic one-shot failure keeps the offline smoke path able
        # to exercise A07 retry semantics without a network or provider.
        if params.model == "fake-retry-once" and attempt == 1:
            raise JobError("JOB_EXECUTION_FAILED")
        completed = 0 if checkpoint is None else int(checkpoint["completedSentences"])
        try:
            result = await self.service.synthesize(
                project_id,
                params,
                cancel_event=cancel_event,
                shutdown_event=shutdown_event,
                completed_sentences=completed,
                persist=persist,
            )
        except TtsExecutionCancelled as error:
            raise JobCancelled() from error
        except TtsExecutionShutdown as error:
            raise JobShutdown() from error
        except ValueError as error:
            raise JobError("JOB_EXECUTION_FAILED", cause=error) from error
        return result.model_dump(by_alias=True)

    def validate_checkpoint(self, value: dict[str, Any], params: TtsJobInput) -> None:
        if (
            value.get("executor") != self.name
            or value.get("executorVersion") != self.executor_version
            or value.get("checkpointVersion") != self.checkpoint_version
            or value.get("sentenceCount") != len(params.sentences)
            or not isinstance(value.get("cacheKey"), str)
            or not isinstance(value.get("completedSentences"), int)
            or not 0 <= value["completedSentences"] <= len(params.sentences)
            or value.get("nextSentence") != value["completedSentences"] + 1
        ):
            raise JobError("JOB_CHECKPOINT_INVALID")


class RemotionRenderExecutor:
    """A fixed-template, offline D03 executor; no user command or path is run."""

    name = "remotion.render"
    executor_version = 1
    checkpoint_version = 1

    async def run(
        self,
        project_id: str,
        params: RemotionJobInput,
        *,
        project_root: Any,
        checkpoint: dict[str, Any] | None,
        cancel_event: asyncio.Event,
        shutdown_event: asyncio.Event,
        persist: Callable[[int, str, dict[str, Any]], Awaitable[None]],
    ) -> dict[str, object]:
        if checkpoint is not None:
            self.validate_checkpoint(checkpoint, params)
        if shutdown_event.is_set():
            raise JobShutdown()
        if cancel_event.is_set():
            raise JobCancelled()
        try:
            result = await RemotionRuntime(project_root).renderMedia(params.render, cancel_event=cancel_event, shutdown_event=shutdown_event, persist=persist)
        except asyncio.CancelledError as error:
            raise JobCancelled() from error
        except RemotionRuntimeShutdown as error:
            raise JobShutdown() from error
        except RemotionRuntimeError as error:
            raise JobError("REMOTION_OUTPUT_INVALID", cause=error) from error
        except OSError as error:
            raise JobError("REMOTION_OUTPUT_INVALID", cause=error) from error
        except ValueError as error:
            raise JobError("REMOTION_INPUT_INVALID", cause=error) from error
        return result

    def validate_checkpoint(self, value: dict[str, Any], params: RemotionJobInput) -> None:
        if (
            value.get("executor") != self.name
            or value.get("executorVersion") != self.executor_version
            or value.get("checkpointVersion") != self.checkpoint_version
            or value.get("cacheKey") != compute_remotion_cache_key(params.render)
        ):
            raise JobError("JOB_CHECKPOINT_INVALID")


class ImageGenerationExecutor:
    """A07 wrapper for the Core-owned offline D06 image adapter."""

    name = "image.generate"
    executor_version = 1
    checkpoint_version = 1

    def __init__(self, service: ImageGenerationService | None = None) -> None:
        self.service = service or ImageGenerationService()

    async def run(
        self,
        project_id: str,
        params: ImageJobInput,
        *,
        attempt: int,
        checkpoint: dict[str, Any] | None,
        cancel_event: asyncio.Event,
        shutdown_event: asyncio.Event,
        persist: Callable[[int, str, dict[str, Any]], Awaitable[None]],
    ) -> dict[str, object]:
        if params.model == "fake-retry-once" and attempt == 1:
            raise JobError("JOB_EXECUTION_FAILED")
        try:
            result = await self.service.generate(
                project_id, params, cancel_event=cancel_event, shutdown_event=shutdown_event, persist=persist,
            )
        except ImageExecutionCancelled as error:
            raise JobCancelled() from error
        except ImageExecutionShutdown as error:
            raise JobShutdown() from error
        except ValueError as error:
            raise JobError("JOB_EXECUTION_FAILED", cause=error) from error
        return result.model_dump(by_alias=True)

    def validate_checkpoint(self, value: dict[str, Any], params: ImageJobInput, expected_cache_key: str) -> None:
        if (
            value.get("executor") != self.name
            or value.get("executorVersion") != self.executor_version
            or value.get("checkpointVersion") != self.checkpoint_version
            or value.get("cacheKey") != expected_cache_key
            or value.get("completed") != 0
            or value.get("nextStep") != 1
        ):
            raise JobError("JOB_CHECKPOINT_INVALID")
