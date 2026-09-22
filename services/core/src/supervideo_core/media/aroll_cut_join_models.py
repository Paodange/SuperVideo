"""Versioned C04 A-roll cut/join plan and execution boundary."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from supervideo_core.timeline.models import TimelineProject, validate_timeline_size

AROLL_CUT_JOIN_SCHEMA_VERSION = 1
AROLL_CUT_JOIN_VERSION = "aroll-cut-join-plan-v1"
AROLL_CUT_JOIN_SELECTION_POLICY = "ordered-complete-sentence-v1"
AROLL_CUT_JOIN_GAP_POLICY = "concatenate-without-timeline-gaps-v1"
AROLL_CUT_JOIN_MAX_CLIPS = 64
AROLL_CUT_JOIN_MAX_INPUT_BYTES = 512 * 1024
AROLL_CUT_JOIN_MAX_RESULT_BYTES = 128 * 1024
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
ASSET_URI_PATTERN = re.compile(r"^supervideo://asset/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ASSET_URI_PATTERN = re.compile(r"^supervideo://asset/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class ArollCutJoinModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class ArollCutJoinParams(ArollCutJoinModel):
    project_id: str = Field(alias="projectId")
    timeline: TimelineProject
    mode: Literal["audio", "video"]
    track_id: str | None = Field(default=None, alias="trackId")
    execution_mode: Literal["plan", "ffmpeg"] = Field(default="plan", alias="executionMode")
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid A-roll project id")
        return value

    @field_validator("track_id")
    @classmethod
    def validate_track_id(cls, value: str | None) -> str | None:
        if value is not None and ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid A-roll track id")
        return value

    @model_validator(mode="after")
    def validate_input_size(self) -> "ArollCutJoinParams":
        validate_timeline_size(self.timeline)
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > AROLL_CUT_JOIN_MAX_INPUT_BYTES:
            raise ValueError("A-roll cut/join input is too large")
        return self


class ArollSourceRef(ArollCutJoinModel):
    source_id: str = Field(alias="sourceId")
    uri: str = Field(min_length=1, max_length=32_767)
    media_type: Literal["audio", "video"] = Field(alias="mediaType")
    duration_ms: int = Field(alias="durationMs", strict=True, ge=1, le=86_400_000)
    fingerprint: str | None = Field(default=None, min_length=64, max_length=64)

    @field_validator("source_id")
    @classmethod
    def validate_source_id(cls, value: str) -> str:
        if ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid A-roll source id")
        return value

    @field_validator("uri")
    @classmethod
    def validate_uri(cls, value: str) -> str:
        if ASSET_URI_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid A-roll asset URI")
        return value

    @field_validator("fingerprint")
    @classmethod
    def validate_fingerprint(cls, value: str | None) -> str | None:
        if value is not None and SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid A-roll source fingerprint")
        return value


class ArollCutJoinSegment(ArollCutJoinModel):
    order: int = Field(strict=True, ge=1, le=AROLL_CUT_JOIN_MAX_CLIPS)
    clip_id: str = Field(alias="clipId", min_length=1, max_length=128)
    sentence_id: str = Field(alias="sentenceId", min_length=1, max_length=128)
    source: ArollSourceRef
    source_in_ms: int = Field(alias="sourceInMs", strict=True, ge=0, le=86_400_000)
    source_out_ms: int = Field(alias="sourceOutMs", strict=True, ge=1, le=86_400_000)
    duration_ms: int = Field(alias="durationMs", strict=True, gt=0, le=86_400_000)
    timeline_start_ms: int = Field(alias="timelineStartMs", strict=True, ge=0, le=86_400_000)
    output_start_ms: int = Field(alias="outputStartMs", strict=True, ge=0, le=86_400_000)
    output_end_ms: int = Field(alias="outputEndMs", strict=True, gt=0, le=86_400_000)

    @model_validator(mode="after")
    def validate_ranges(self) -> "ArollCutJoinSegment":
        if self.source_out_ms - self.source_in_ms != self.duration_ms:
            raise ValueError("A-roll source span must equal clip duration")
        if self.output_end_ms - self.output_start_ms != self.duration_ms:
            raise ValueError("A-roll output span must equal clip duration")
        if self.output_start_ms + self.duration_ms > 86_400_000:
            raise ValueError("A-roll output exceeds duration bound")
        return self


class ArollCutJoinGap(ArollCutJoinModel):
    code: Literal["timeline-gap"]
    before_clip_id: str | None = Field(default=None, alias="beforeClipId")
    after_clip_id: str | None = Field(default=None, alias="afterClipId")
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=86_400_000)
    end_ms: int = Field(alias="endMs", strict=True, gt=0, le=86_400_000)
    duration_ms: int = Field(alias="durationMs", strict=True, gt=0, le=86_400_000)

    @model_validator(mode="after")
    def validate_gap(self) -> "ArollCutJoinGap":
        if self.end_ms - self.start_ms != self.duration_ms:
            raise ValueError("A-roll gap duration mismatch")
        if self.before_clip_id is None and self.after_clip_id is None:
            raise ValueError("A-roll gap must touch a clip")
        return self


class ArollCutJoinOutput(ArollCutJoinModel):
    kind: Literal["audio", "video"]
    relative_path: str = Field(alias="relativePath", min_length=1, max_length=512)
    size_bytes: int = Field(alias="sizeBytes", strict=True, gt=0)

    @field_validator("relative_path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        if value.startswith(("/", "\\")) or "\\" in value or ":" in value or ".." in value.split("/"):
            raise ValueError("A-roll output path must be relative")
        return value


class ArollCutJoinResult(ArollCutJoinModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    plan_version: Literal["aroll-cut-join-plan-v1"] = Field(alias="planVersion")
    project_id: str = Field(alias="projectId")
    timeline_id: str = Field(alias="timelineId")
    track_id: str = Field(alias="trackId")
    mode: Literal["audio", "video"]
    execution_mode: Literal["plan", "ffmpeg"] = Field(alias="executionMode")
    execution_status: Literal["not-run", "completed"] = Field(alias="executionStatus")
    status: Literal["ready", "gaps"]
    selection_policy: Literal["ordered-complete-sentence-v1"] = Field(alias="selectionPolicy")
    gap_policy: Literal["concatenate-without-timeline-gaps-v1"] = Field(alias="gapPolicy")
    plan_digest: str = Field(alias="planDigest", min_length=64, max_length=64)
    selected_duration_ms: int = Field(alias="selectedDurationMs", strict=True, gt=0, le=86_400_000)
    segments: list[ArollCutJoinSegment] = Field(min_length=1, max_length=AROLL_CUT_JOIN_MAX_CLIPS)
    gaps: list[ArollCutJoinGap] = Field(max_length=AROLL_CUT_JOIN_MAX_CLIPS + 1)
    output: ArollCutJoinOutput | None = None

    @field_validator("project_id")
    @classmethod
    def validate_result_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid A-roll result project id")
        return value

    @field_validator("timeline_id", "track_id")
    @classmethod
    def validate_result_id(cls, value: str) -> str:
        if ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid A-roll result id")
        return value

    @field_validator("plan_digest")
    @classmethod
    def validate_plan_digest(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid A-roll plan digest")
        return value

    @model_validator(mode="after")
    def validate_result(self) -> "ArollCutJoinResult":
        if [segment.order for segment in self.segments] != list(range(1, len(self.segments) + 1)):
            raise ValueError("A-roll segment order is not stable")
        timeline_cursor = 0
        for segment in self.segments:
            if segment.timeline_start_ms < timeline_cursor:
                raise ValueError("A-roll timeline spans overlap")
            timeline_cursor = segment.timeline_start_ms + segment.duration_ms
        if self.selected_duration_ms != sum(segment.duration_ms for segment in self.segments):
            raise ValueError("A-roll selected duration accounting mismatch")
        if self.status != ("gaps" if self.gaps else "ready"):
            raise ValueError("A-roll gap status mismatch")
        if self.execution_mode == "plan" and (self.execution_status != "not-run" or self.output is not None):
            raise ValueError("plan-only A-roll result cannot contain an output")
        if self.execution_mode == "ffmpeg" and (self.execution_status != "completed" or self.output is None or self.output.kind != self.mode):
            raise ValueError("executed A-roll result must contain a matching output")
        return self


def validate_aroll_cut_join_size(result: ArollCutJoinResult) -> ArollCutJoinResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > AROLL_CUT_JOIN_MAX_RESULT_BYTES:
        raise ValueError("A-roll cut/join result is too large")
    return result
