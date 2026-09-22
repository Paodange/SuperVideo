"""Strict public models for job RPC results and fixed job inputs."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from supervideo_core.media.tts_models import TtsJobInput, TtsJobStartParams, TtsSynthesisResult


class JobModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


JobStatus = Literal[
    "queued", "running", "succeeded", "failed", "retrying", "cancelling", "cancelled", "needs_attention",
]


class JobSmokeInput(JobModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)
    steps: int = Field(default=8, strict=True, ge=3, le=8)
    delay_ms: int = Field(default=150, alias="delayMs", strict=True, ge=1, le=1_000)
    fail_attempts: int = Field(default=0, alias="failAttempts", strict=True, ge=0, le=1)


class JobSummary(JobModel):
    job_id: str = Field(alias="jobId")
    project_id: str = Field(alias="projectId")
    job_type: Literal["smoke.countdown", "tts.synthesize"] = Field(alias="jobType")
    status: JobStatus
    progress: float = Field(strict=True, ge=0, le=1)
    stage: str | None = None
    attempt: int = Field(strict=True, ge=0)
    revision: int = Field(strict=True, ge=0)
    last_event_sequence: int = Field(alias="lastEventSequence", strict=True, ge=0)
    created_at_ms: int = Field(alias="createdAtMs", strict=True, ge=0)
    updated_at_ms: int = Field(alias="updatedAtMs", strict=True, ge=0)
    started_at_ms: int | None = Field(alias="startedAtMs", default=None, strict=True, ge=0)
    finished_at_ms: int | None = Field(alias="finishedAtMs", default=None, strict=True, ge=0)
    error_code: str | None = Field(alias="errorCode", default=None, max_length=128)

    @field_validator("job_id", "project_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        import re
        if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
            raise ValueError("invalid job id")
        return value


__all__ = ["JobStatus", "JobSmokeInput", "JobSummary", "JobEventSummary", "JobPage", "JobEventPage", "TtsJobInput", "TtsJobStartParams", "TtsSynthesisResult"]


class JobEventSummary(JobModel):
    project_id: str = Field(alias="projectId")
    job_id: str = Field(alias="jobId")
    sequence: int = Field(strict=True, ge=1)
    event_type: str = Field(alias="eventType", min_length=1, max_length=64)
    status: JobStatus
    progress: float = Field(strict=True, ge=0, le=1)
    stage: str | None = None
    attempt: int = Field(strict=True, ge=0)
    timestamp: int = Field(strict=True, ge=0)
    payload: Any


class JobPage(JobModel):
    project_id: str = Field(alias="projectId")
    items: list[JobSummary] = Field(max_length=1_000)
    next_cursor: str | None = Field(alias="nextCursor", default=None, max_length=512)
    has_more: bool = Field(alias="hasMore", default=False)


class JobEventPage(JobModel):
    project_id: str = Field(alias="projectId")
    job_id: str = Field(alias="jobId")
    items: list[JobEventSummary] = Field(max_length=1_000)
    next_cursor: str | None = Field(alias="nextCursor", default=None, max_length=512)
    has_more: bool = Field(alias="hasMore", default=False)
