"""Persistent, project-scoped job state and deterministic executors."""

from .errors import JobError, JobErrorCode
from .manager import JobManager
from .models import (
    JobEventSummary,
    JobPage,
    JobSmokeInput,
    JobSummary,
    TtsJobInput,
    TtsJobStartParams,
    TtsSynthesisResult,
    ImageJobInput,
    ImageJobStartParams,
    ImageGenerationResult,
)
from .state_machine import ALLOWED_TRANSITIONS, TERMINAL_STATUSES, can_transition

__all__ = [
    "ALLOWED_TRANSITIONS",
    "JobError",
    "JobErrorCode",
    "JobEventSummary",
    "JobManager",
    "JobPage",
    "JobSmokeInput",
    "JobSummary",
    "TtsJobInput",
    "TtsJobStartParams",
    "TtsSynthesisResult",
    "ImageJobInput",
    "ImageJobStartParams",
    "ImageGenerationResult",
    "TERMINAL_STATUSES",
    "can_transition",
]
