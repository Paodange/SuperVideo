"""Versioned C06 preview render contract."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .aroll_cut_join_models import ArollCutJoinResult
from .subtitle_plan_models import SubtitlePlanResult

PREVIEW_RENDER_SCHEMA_VERSION = 1
PREVIEW_RENDER_VERSION = "preview-render-plan-v1"
PREVIEW_RENDER_POLICY = "ffmpeg-low-bitrate-subtitle-overlay-v1"
PREVIEW_RENDER_MAX_CUES = 2_048
PREVIEW_RENDER_MAX_GAPS = 2_048
PREVIEW_RENDER_MAX_INPUT_BYTES = 512 * 1024
PREVIEW_RENDER_MAX_RESULT_BYTES = 256 * 1024
PREVIEW_RENDER_MAX_OUTPUT_BYTES = 512 * 1024 * 1024
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class PreviewRenderModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class PreviewRenderParams(PreviewRenderModel):
    project_id: str = Field(alias="projectId")
    aroll_plan: ArollCutJoinResult = Field(alias="arollPlan")
    subtitle_plan: SubtitlePlanResult = Field(alias="subtitlePlan")
    execution_mode: Literal["plan", "ffmpeg"] = Field(default="plan", alias="executionMode")
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid preview project id")
        return value

    @model_validator(mode="after")
    def validate_input(self) -> "PreviewRenderParams":
        if self.aroll_plan.project_id != self.project_id or self.subtitle_plan.project_id != self.project_id:
            raise ValueError("preview plans belong to another project")
        if self.aroll_plan.timeline_id != self.subtitle_plan.timeline_id:
            raise ValueError("preview plans belong to different timelines")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > PREVIEW_RENDER_MAX_INPUT_BYTES:
            raise ValueError("preview render input is too large")
        return self


class PreviewSourceBinding(PreviewRenderModel):
    source_id: str = Field(alias="sourceId")
    uri: str = Field(min_length=1, max_length=32_767)
    fingerprint: str | None = Field(default=None, min_length=64, max_length=64)
    segment_count: int = Field(alias="segmentCount", strict=True, ge=1, le=64)

    @field_validator("source_id")
    @classmethod
    def validate_source_id(cls, value: str) -> str:
        if ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid preview source id")
        return value

    @field_validator("fingerprint")
    @classmethod
    def validate_fingerprint(cls, value: str | None) -> str | None:
        if value is not None and SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid preview source fingerprint")
        return value


class PreviewRenderCue(PreviewRenderModel):
    order: int = Field(strict=True, ge=1, le=PREVIEW_RENDER_MAX_CUES)
    cue_id: str = Field(alias="cueId")
    clip_id: str = Field(alias="clipId")
    sentence_id: str | None = Field(default=None, alias="sentenceId")
    source_id: str | None = Field(default=None, alias="sourceId")
    provenance_ids: list[str] = Field(default_factory=list, alias="provenanceIds", max_length=32)
    text: str = Field(min_length=1, max_length=256)
    timeline_start_ms: int = Field(alias="timelineStartMs", strict=True, ge=0, le=86_400_000)
    duration_ms: int = Field(alias="durationMs", strict=True, gt=0, le=86_400_000)
    output_start_ms: int = Field(alias="outputStartMs", strict=True, ge=0, le=86_400_000)
    output_end_ms: int = Field(alias="outputEndMs", strict=True, gt=0, le=86_400_000)

    @field_validator("cue_id", "clip_id")
    @classmethod
    def validate_ids(cls, value: str) -> str:
        if ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid preview cue id")
        return value

    @field_validator("sentence_id", "source_id")
    @classmethod
    def validate_optional_ids(cls, value: str | None) -> str | None:
        if value is not None and ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid preview reference id")
        return value

    @field_validator("provenance_ids")
    @classmethod
    def validate_provenance_ids(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or any(ID_PATTERN.fullmatch(item) is None for item in value):
            raise ValueError("invalid preview provenance ids")
        return value

    @model_validator(mode="after")
    def validate_ranges(self) -> "PreviewRenderCue":
        if self.output_end_ms - self.output_start_ms != self.duration_ms:
            raise ValueError("preview cue output range mismatch")
        return self


class PreviewRenderGap(PreviewRenderModel):
    code: Literal["subtitle-plan-gap", "subtitle-cue-unmapped", "subtitle-cue-range-invalid"]
    clip_id: str | None = Field(default=None, alias="clipId")
    cue_id: str | None = Field(default=None, alias="cueId")
    detail: str = Field(min_length=1, max_length=256)


class PreviewRenderLog(PreviewRenderModel):
    status: Literal["not-run", "cache-hit", "completed"]
    stdout: str = Field(default="", max_length=4_096)
    stderr: str = Field(default="", max_length=4_096)


class PreviewRenderOutput(PreviewRenderModel):
    kind: Literal["video"]
    relative_path: str = Field(alias="relativePath", min_length=1, max_length=512)
    playback_uri: str = Field(alias="playbackUri", min_length=1, max_length=256)
    size_bytes: int = Field(alias="sizeBytes", strict=True, gt=0, le=PREVIEW_RENDER_MAX_OUTPUT_BYTES)
    duration_ms: int = Field(alias="durationMs", strict=True, gt=0, le=86_400_000)
    output_fingerprint: str = Field(alias="outputFingerprint", min_length=64, max_length=64)

    @field_validator("relative_path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        if value.startswith(("/", "\\")) or "\\" in value or ":" in value:
            raise ValueError("preview output path must be relative")
        if any(part in {"", ".", ".."} for part in value.split("/")):
            raise ValueError("preview output path contains an unsafe segment")
        if not value.startswith("previews/preview-render-v1/"):
            raise ValueError("preview output is outside the preview boundary")
        return value

    @field_validator("output_fingerprint")
    @classmethod
    def validate_output_fingerprint(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid preview output fingerprint")
        return value


class PreviewRenderResult(PreviewRenderModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    plan_version: Literal["preview-render-plan-v1"] = Field(alias="planVersion")
    project_id: str = Field(alias="projectId")
    timeline_id: str = Field(alias="timelineId")
    aroll_plan_digest: str = Field(alias="arollPlanDigest", min_length=64, max_length=64)
    subtitle_plan_digest: str = Field(alias="subtitlePlanDigest", min_length=64, max_length=64)
    execution_mode: Literal["plan", "ffmpeg"] = Field(alias="executionMode")
    execution_status: Literal["not-run", "completed"] = Field(alias="executionStatus")
    status: Literal["ready", "gaps"]
    render_policy: Literal["ffmpeg-low-bitrate-subtitle-overlay-v1"] = Field(alias="renderPolicy")
    selected_duration_ms: int = Field(alias="selectedDurationMs", strict=True, gt=0, le=86_400_000)
    timeline_duration_ms: int = Field(alias="timelineDurationMs", strict=True, gt=0, le=86_400_000)
    cue_count: int = Field(alias="cueCount", strict=True, ge=0, le=PREVIEW_RENDER_MAX_CUES)
    plan_digest: str = Field(alias="planDigest", min_length=64, max_length=64)
    source_bindings: list[PreviewSourceBinding] = Field(alias="sourceBindings", max_length=64)
    cues: list[PreviewRenderCue] = Field(max_length=PREVIEW_RENDER_MAX_CUES)
    gaps: list[PreviewRenderGap] = Field(max_length=PREVIEW_RENDER_MAX_GAPS)
    log: PreviewRenderLog
    output: PreviewRenderOutput | None = None

    @field_validator("project_id")
    @classmethod
    def validate_result_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid preview result project id")
        return value

    @field_validator("timeline_id")
    @classmethod
    def validate_timeline_id(cls, value: str) -> str:
        if ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid preview timeline id")
        return value

    @field_validator("aroll_plan_digest", "subtitle_plan_digest", "plan_digest")
    @classmethod
    def validate_digest(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid preview digest")
        return value

    @model_validator(mode="after")
    def validate_result(self) -> "PreviewRenderResult":
        if self.cue_count != len(self.cues):
            raise ValueError("preview cue count mismatch")
        if self.selected_duration_ms != self.timeline_duration_ms:
            raise ValueError("preview duration accounting mismatch")
        if self.status != ("gaps" if self.gaps else "ready"):
            raise ValueError("preview gap status mismatch")
        if [cue.order for cue in self.cues] != list(range(1, len(self.cues) + 1)):
            raise ValueError("preview cue order is not stable")
        cursor = 0
        for cue in self.cues:
            if cue.output_start_ms < cursor or cue.output_end_ms > self.selected_duration_ms:
                raise ValueError("preview cues overlap or exceed output")
            cursor = cue.output_end_ms
        if self.execution_mode == "plan" and (self.execution_status != "not-run" or self.output is not None or self.log.status != "not-run"):
            raise ValueError("preview plan cannot contain output")
        if self.execution_mode == "ffmpeg" and (self.execution_status != "completed" or self.output is None or self.log.status not in {"cache-hit", "completed"}):
            raise ValueError("executed preview must contain output")
        return self


def validate_preview_render_size(result: PreviewRenderResult) -> PreviewRenderResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > PREVIEW_RENDER_MAX_RESULT_BYTES:
        raise ValueError("preview render result is too large")
    return result
