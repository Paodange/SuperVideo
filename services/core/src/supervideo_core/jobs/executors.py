"""Deterministic, side-effect-free A07 executors."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from .errors import JobError
from .models import JobSmokeInput


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
