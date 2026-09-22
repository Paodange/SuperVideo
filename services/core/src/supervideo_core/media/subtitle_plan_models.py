"""Versioned, bounded subtitle plan contract for C05."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from supervideo_core.timeline.models import TimelineProject, validate_timeline_size


SUBTITLE_PLAN_SCHEMA_VERSION = 1
SUBTITLE_PLAN_VERSION = "subtitle-plan-v1"
SUBTITLE_PLAN_MAX_CUES = 2_048
SUBTITLE_PLAN_MAX_GAPS = 2_048
SUBTITLE_PLAN_MAX_TEXT_LENGTH = 256
SUBTITLE_PLAN_MAX_TOTAL_TEXT_LENGTH = 180_000
SUBTITLE_PLAN_MAX_RESULT_BYTES = 256 * 1024
SUBTITLE_PLAN_MAX_INPUT_BYTES = 512 * 1024
SUBTITLE_PLAN_MAX_DURATION_MS = 86_400_000
SUBTITLE_PLAN_DEFAULT_MAX_LINES = 2
SUBTITLE_PLAN_DEFAULT_MAX_LINE_WIDTH = 32
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class SubtitlePlanModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class SubtitleSentenceSource(SubtitlePlanModel):
    """A B03 sentence made addressable by a C01 timeline clip."""

    sentence_id: str = Field(alias="sentenceId")
    source_id: str | None = Field(default=None, alias="sourceId")
    source_in_ms: int = Field(alias="sourceInMs", strict=True, ge=0, le=SUBTITLE_PLAN_MAX_DURATION_MS)
    source_out_ms: int = Field(alias="sourceOutMs", strict=True, gt=0, le=SUBTITLE_PLAN_MAX_DURATION_MS)
    text: str = Field(min_length=1, max_length=SUBTITLE_PLAN_MAX_TEXT_LENGTH)
    language: str | None = Field(default=None, max_length=32)
    provenance_ids: list[str] = Field(default_factory=list, alias="provenanceIds", max_length=32)

    @field_validator("sentence_id")
    @classmethod
    def validate_sentence_id(cls, value: str) -> str:
        if ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid subtitle sentence id")
        return value

    @field_validator("source_id")
    @classmethod
    def validate_source_id(cls, value: str | None) -> str | None:
        if value is not None and ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid subtitle source id")
        return value

    @field_validator("provenance_ids")
    @classmethod
    def validate_provenance_ids(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or any(ID_PATTERN.fullmatch(item) is None for item in value):
            raise ValueError("invalid subtitle provenance ids")
        return value

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 and character not in "\n\r\t" for character in value):
            raise ValueError("invalid subtitle text")
        return value.replace("\r\n", "\n").replace("\r", "\n").strip()

    @model_validator(mode="after")
    def validate_range(self) -> "SubtitleSentenceSource":
        if self.source_out_ms <= self.source_in_ms:
            raise ValueError("subtitle sentence source range must be positive")
        return self


class SubtitlePlanParams(SubtitlePlanModel):
    project_id: str = Field(alias="projectId")
    timeline: TimelineProject
    sentence_sources: list[SubtitleSentenceSource] = Field(default_factory=list, alias="sentenceSources", max_length=SUBTITLE_PLAN_MAX_CUES)
    track_id: str | None = Field(default=None, alias="trackId")
    max_lines: int = Field(default=SUBTITLE_PLAN_DEFAULT_MAX_LINES, alias="maxLines", strict=True, ge=1, le=4)
    max_line_width: int = Field(default=SUBTITLE_PLAN_DEFAULT_MAX_LINE_WIDTH, alias="maxLineWidth", strict=True, ge=8, le=64)
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid subtitle project id")
        return value

    @field_validator("track_id")
    @classmethod
    def validate_track_id(cls, value: str | None) -> str | None:
        if value is not None and ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid subtitle track id")
        return value

    @model_validator(mode="after")
    def validate_input_size(self) -> "SubtitlePlanParams":
        validate_timeline_size(self.timeline)
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > SUBTITLE_PLAN_MAX_INPUT_BYTES:
            raise ValueError("subtitle plan input is too large")
        return self


class SubtitlePlanGap(SubtitlePlanModel):
    code: Literal["missing-sentence-source", "missing-subtitle-text"]
    clip_id: str = Field(alias="clipId")
    sentence_id: str | None = Field(default=None, alias="sentenceId")
    detail: str = Field(min_length=1, max_length=256)


class SubtitleCue(SubtitlePlanModel):
    order: int = Field(strict=True, ge=1, le=SUBTITLE_PLAN_MAX_CUES)
    cue_id: str = Field(alias="cueId")
    clip_id: str = Field(alias="clipId")
    sentence_id: str | None = Field(default=None, alias="sentenceId")
    source_id: str | None = Field(default=None, alias="sourceId")
    source_in_ms: int | None = Field(default=None, alias="sourceInMs", strict=True, ge=0, le=SUBTITLE_PLAN_MAX_DURATION_MS)
    source_out_ms: int | None = Field(default=None, alias="sourceOutMs", strict=True, gt=0, le=SUBTITLE_PLAN_MAX_DURATION_MS)
    provenance_ids: list[str] = Field(default_factory=list, alias="provenanceIds", max_length=32)
    text: str = Field(min_length=1, max_length=SUBTITLE_PLAN_MAX_TEXT_LENGTH)
    language: str | None = Field(default=None, max_length=32)
    timeline_start_ms: int = Field(alias="timelineStartMs", strict=True, ge=0, le=SUBTITLE_PLAN_MAX_DURATION_MS)
    duration_ms: int = Field(alias="durationMs", strict=True, gt=0, le=SUBTITLE_PLAN_MAX_DURATION_MS)
    timeline_end_ms: int = Field(alias="timelineEndMs", strict=True, gt=0, le=SUBTITLE_PLAN_MAX_DURATION_MS)

    @field_validator("cue_id", "clip_id")
    @classmethod
    def validate_ids(cls, value: str) -> str:
        if ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid subtitle cue id")
        return value

    @field_validator("sentence_id", "source_id")
    @classmethod
    def validate_optional_ids(cls, value: str | None) -> str | None:
        if value is not None and ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid subtitle reference id")
        return value

    @field_validator("provenance_ids")
    @classmethod
    def validate_cue_provenance(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or any(ID_PATTERN.fullmatch(item) is None for item in value):
            raise ValueError("invalid subtitle provenance ids")
        return value

    @field_validator("text")
    @classmethod
    def validate_cue_text(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 and character not in "\n\r\t" for character in value):
            raise ValueError("invalid subtitle text")
        return value.replace("\r\n", "\n").replace("\r", "\n").strip()

    @model_validator(mode="after")
    def validate_cue_ranges(self) -> "SubtitleCue":
        if self.timeline_end_ms - self.timeline_start_ms != self.duration_ms:
            raise ValueError("subtitle cue duration mismatch")
        if (self.source_in_ms is None) != (self.source_out_ms is None):
            raise ValueError("subtitle source timecode must be a pair")
        if self.source_in_ms is not None and self.source_out_ms is not None and self.source_out_ms <= self.source_in_ms:
            raise ValueError("subtitle source timecode must be ordered")
        return self


class SubtitlePlanResult(SubtitlePlanModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    plan_version: Literal["subtitle-plan-v1"] = Field(alias="planVersion")
    project_id: str = Field(alias="projectId")
    timeline_id: str = Field(alias="timelineId")
    status: Literal["ready", "gaps"]
    selection_policy: Literal["timeline-subtitles-or-sentence-clips-v1"] = Field(alias="selectionPolicy")
    layout_policy: Literal["bounded-display-width-v1"] = Field(alias="layoutPolicy")
    max_lines: int = Field(alias="maxLines", strict=True, ge=1, le=4)
    max_line_width: int = Field(alias="maxLineWidth", strict=True, ge=8, le=64)
    total_duration_ms: int = Field(alias="totalDurationMs", strict=True, ge=0, le=SUBTITLE_PLAN_MAX_DURATION_MS)
    cue_count: int = Field(alias="cueCount", strict=True, ge=0, le=SUBTITLE_PLAN_MAX_CUES)
    plan_digest: str = Field(alias="planDigest", min_length=64, max_length=64)
    cues: list[SubtitleCue] = Field(max_length=SUBTITLE_PLAN_MAX_CUES)
    gaps: list[SubtitlePlanGap] = Field(max_length=SUBTITLE_PLAN_MAX_GAPS)

    @field_validator("project_id")
    @classmethod
    def validate_result_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid subtitle result project id")
        return value

    @field_validator("timeline_id")
    @classmethod
    def validate_timeline_id(cls, value: str) -> str:
        if ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid subtitle timeline id")
        return value

    @field_validator("plan_digest")
    @classmethod
    def validate_plan_digest(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid subtitle plan digest")
        return value

    @model_validator(mode="after")
    def validate_result(self) -> "SubtitlePlanResult":
        if self.cue_count != len(self.cues):
            raise ValueError("subtitle cue count mismatch")
        if not self.cues and not self.gaps:
            raise ValueError("subtitle plan must contain a cue or an explainable gap")
        if sum(len(cue.text) for cue in self.cues) > SUBTITLE_PLAN_MAX_TOTAL_TEXT_LENGTH:
            raise ValueError("subtitle text is too large")
        if self.status != ("gaps" if self.gaps else "ready"):
            raise ValueError("subtitle gap status mismatch")
        if self.total_duration_ms != sum(cue.duration_ms for cue in self.cues):
            raise ValueError("subtitle duration accounting mismatch")
        if [cue.order for cue in self.cues] != list(range(1, len(self.cues) + 1)):
            raise ValueError("subtitle cue order is not stable")
        cursor = 0
        for cue in self.cues:
            if cue.timeline_start_ms < cursor:
                raise ValueError("subtitle cues overlap")
            cursor = cue.timeline_end_ms
        return self


def validate_subtitle_plan_size(result: SubtitlePlanResult) -> SubtitlePlanResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > SUBTITLE_PLAN_MAX_RESULT_BYTES:
        raise ValueError("subtitle plan result is too large")
    return result
