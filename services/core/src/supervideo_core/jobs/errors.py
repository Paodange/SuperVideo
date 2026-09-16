"""Stable errors for the persistent job boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

JobErrorCode = Literal[
    "JOB_NOT_FOUND",
    "JOB_STATE_CONFLICT",
    "JOB_NOT_CANCELLABLE",
    "JOB_NOT_RETRYABLE",
    "JOB_RETRY_LIMIT",
    "JOB_QUEUE_FULL",
    "JOB_EXECUTOR_UNAVAILABLE",
    "JOB_CHECKPOINT_INVALID",
    "JOB_EVENT_GAP",
    "IDEMPOTENCY_CONFLICT",
    "JOB_SHUTTING_DOWN",
    "JOB_EXECUTION_FAILED",
]


@dataclass(frozen=True)
class JobErrorDefinition:
    message: str


ERRORS: Final[dict[str, JobErrorDefinition]] = {
    "JOB_NOT_FOUND": JobErrorDefinition("The job was not found."),
    "JOB_STATE_CONFLICT": JobErrorDefinition("The job state changed concurrently."),
    "JOB_NOT_CANCELLABLE": JobErrorDefinition("The job cannot be cancelled."),
    "JOB_NOT_RETRYABLE": JobErrorDefinition("The job cannot be retried."),
    "JOB_RETRY_LIMIT": JobErrorDefinition("The job retry limit was reached."),
    "JOB_QUEUE_FULL": JobErrorDefinition("The job queue is full."),
    "JOB_EXECUTOR_UNAVAILABLE": JobErrorDefinition("The job executor is unavailable."),
    "JOB_CHECKPOINT_INVALID": JobErrorDefinition("The job checkpoint is invalid."),
    "JOB_EVENT_GAP": JobErrorDefinition("The job event sequence has a gap."),
    "IDEMPOTENCY_CONFLICT": JobErrorDefinition("The idempotency key conflicts with another job."),
    "JOB_SHUTTING_DOWN": JobErrorDefinition("The job service is shutting down."),
    "JOB_EXECUTION_FAILED": JobErrorDefinition("The simulated job failed."),
}


class JobError(Exception):
    def __init__(self, code: JobErrorCode, *, cause: BaseException | None = None) -> None:
        self.code = code if code in ERRORS else "JOB_STATE_CONFLICT"
        self.error_code = self.code
        self.cause = cause
        super().__init__(ERRORS[self.code].message)

    @property
    def message(self) -> str:
        return ERRORS[self.code].message
