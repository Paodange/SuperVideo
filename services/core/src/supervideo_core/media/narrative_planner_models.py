"""Versioned, bounded contracts for the deterministic C02 narrative planner."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .index_models import SENTENCE_INDEX_MAX_TEXT_LENGTH

NARRATIVE_PLAN_SCHEMA_VERSION = 1
NARRATIVE_PLAN_VERSION = "narrative-remix-plan-v1"
NARRATIVE_PLAN_INPUT_VERSION = "deterministic-narrative-input-v1"
NARRATIVE_PLAN_MAX_THEME_LENGTH = 512
NARRATIVE_PLAN_MAX_AUDIENCE_LENGTH = 256
NARRATIVE_PLAN_MAX_OUTLINE_LENGTH = 8_192
NARRATIVE_PLAN_MAX_SEGMENTS = 32
NARRATIVE_PLAN_MAX_GAPS = 32
NARRATIVE_PLAN_MAX_RESULT_BYTES = 60 * 1024
NARRATIVE_PLAN_MAX_REASON_LENGTH = 160


class NarrativePlanModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def _validate_id(value: str) -> str:
    if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
        raise ValueError("invalid narrative plan identity")
    return value


def _validate_text(value: str, maximum: int, *, multiline: bool = False) -> str:
    if not value.strip() or len(value) > maximum:
        raise ValueError("invalid narrative plan text")
    for character in value:
        code = ord(character)
        if code < 32 and (not multiline or character not in "\r\n\t"):
            raise ValueError("invalid narrative plan control character")
    return value


class NarrativePlanParams(NarrativePlanModel):
    project_id: str = Field(alias="projectId")
    theme: str = Field(min_length=1, max_length=NARRATIVE_PLAN_MAX_THEME_LENGTH)
    audience: str = Field(min_length=1, max_length=NARRATIVE_PLAN_MAX_AUDIENCE_LENGTH)
    target_duration_ms: int = Field(alias="targetDurationMs", strict=True, ge=1_000, le=600_000)
    outline: str | None = Field(default=None, max_length=NARRATIVE_PLAN_MAX_OUTLINE_LENGTH)
    asset_ids: list[str] | None = Field(default=None, alias="assetIds", max_length=100)
    candidate_limit: int = Field(default=5, alias="candidateLimit", strict=True, ge=1, le=8)
    use_rerank: bool = Field(default=True, alias="useRerank")
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    _validate_project_id = field_validator("project_id")(_validate_id)

    @field_validator("theme")
    @classmethod
    def validate_theme(cls, value: str) -> str:
        return _validate_text(value, NARRATIVE_PLAN_MAX_THEME_LENGTH)

    @field_validator("audience")
    @classmethod
    def validate_audience(cls, value: str) -> str:
        return _validate_text(value, NARRATIVE_PLAN_MAX_AUDIENCE_LENGTH)

    @field_validator("outline")
    @classmethod
    def validate_outline(cls, value: str | None) -> str | None:
        return None if value is None else _validate_text(value, NARRATIVE_PLAN_MAX_OUTLINE_LENGTH, multiline=True)

    @field_validator("asset_ids")
    @classmethod
    def validate_asset_ids(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        if not value or len(value) != len(set(value)):
            raise ValueError("narrative plan assets must be non-empty and unique")
        return [_validate_id(item) for item in value]


class NarrativePlanTimecode(NarrativePlanModel):
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=86_400_000)
    end_ms: int = Field(alias="endMs", strict=True, ge=1, le=86_400_000)

    @model_validator(mode="after")
    def validate_duration(self) -> "NarrativePlanTimecode":
        if self.end_ms <= self.start_ms:
            raise ValueError("narrative plan timecode must have positive duration")
        return self


class NarrativePlanSource(NarrativePlanModel):
    source_asset_id: str = Field(alias="sourceAssetId")
    source_sentence_cache_key: str = Field(alias="sourceSentenceCacheKey", min_length=64, max_length=64)
    sentence_index: int = Field(alias="sentenceIndex", strict=True, ge=0, lt=2_000)
    timecode: NarrativePlanTimecode
    preview_uri: str = Field(alias="previewUri", min_length=1, max_length=256)

    _validate_asset_id = field_validator("source_asset_id")(_validate_id)

    @field_validator("source_sentence_cache_key")
    @classmethod
    def validate_digest(cls, value: str) -> str:
        if re.fullmatch(r"^[0-9a-f]{64}$", value) is None:
            raise ValueError("invalid narrative plan source digest")
        return value

    @model_validator(mode="after")
    def validate_preview(self) -> "NarrativePlanSource":
        expected = f"supervideo://asset/{self.source_asset_id}?kind=audio&startMs={self.timecode.start_ms}&endMs={self.timecode.end_ms}"
        if self.preview_uri != expected:
            raise ValueError("narrative plan preview URI does not match source")
        return self


class NarrativePlanGap(NarrativePlanModel):
    segment_id: str = Field(alias="segmentId", min_length=1, max_length=64)
    slot_id: str = Field(alias="slotId", min_length=1, max_length=32)
    role: Literal["hook", "body", "cta"]
    code: Literal[
        "alignment-gap",
        "missing-narrative-role",
        "duration-outside-tolerance",
    ]
    detail: str = Field(min_length=1, max_length=NARRATIVE_PLAN_MAX_REASON_LENGTH)

    @field_validator("segment_id", "slot_id")
    @classmethod
    def validate_gap_identity(cls, value: str) -> str:
        return _validate_text(value, 64)

    @field_validator("detail")
    @classmethod
    def validate_gap_detail(cls, value: str) -> str:
        return _validate_text(value, NARRATIVE_PLAN_MAX_REASON_LENGTH)


class NarrativePlanSegment(NarrativePlanModel):
    segment_id: str = Field(alias="segmentId", min_length=1, max_length=64)
    order: int = Field(strict=True, ge=1, le=NARRATIVE_PLAN_MAX_SEGMENTS)
    role: Literal["hook", "body", "cta"]
    slot_id: str = Field(alias="slotId", min_length=1, max_length=32)
    slot_kind: Literal["hook", "context", "claim", "evidence", "benefit", "requirement", "process", "cta", "closing", "other"] = Field(alias="slotKind")
    source_text: str = Field(alias="sourceText", min_length=1, max_length=512)
    status: Literal["matched", "gap"]
    candidate_sentence_id: str | None = Field(default=None, alias="candidateSentenceId", max_length=64)
    candidate_rank: int | None = Field(default=None, alias="candidateRank", strict=True, ge=1, le=8)
    sentence_text: str | None = Field(default=None, alias="sentenceText", max_length=SENTENCE_INDEX_MAX_TEXT_LENGTH)
    source: NarrativePlanSource | None = None
    duration_ms: int = Field(alias="durationMs", strict=True, ge=0, le=86_400_000)
    selection_reason: str | None = Field(default=None, alias="selectionReason", max_length=NARRATIVE_PLAN_MAX_REASON_LENGTH)
    gap_reason: NarrativePlanGap | None = Field(default=None, alias="gapReason")

    @field_validator("segment_id", "slot_id", "source_text")
    @classmethod
    def validate_segment_text(cls, value: str) -> str:
        return _validate_text(value, 512)

    @field_validator("candidate_sentence_id")
    @classmethod
    def validate_candidate_id(cls, value: str | None) -> str | None:
        if value is not None and re.fullmatch(r"^[0-9a-f]{64}$", value) is None:
            raise ValueError("invalid narrative plan candidate identity")
        return value

    @field_validator("sentence_text")
    @classmethod
    def validate_sentence_text(cls, value: str | None) -> str | None:
        return None if value is None else _validate_text(value, SENTENCE_INDEX_MAX_TEXT_LENGTH)

    @field_validator("selection_reason")
    @classmethod
    def validate_selection_reason(cls, value: str | None) -> str | None:
        return None if value is None else _validate_text(value, NARRATIVE_PLAN_MAX_REASON_LENGTH)

    @model_validator(mode="after")
    def validate_segment_state(self) -> "NarrativePlanSegment":
        if self.status == "matched":
            if self.candidate_sentence_id is None or self.candidate_rank != 1 or self.sentence_text is None or self.source is None or self.duration_ms <= 0 or not self.selection_reason or self.gap_reason is not None:
                raise ValueError("matched narrative segment accounting is invalid")
        elif self.candidate_sentence_id is not None or self.candidate_rank is not None or self.sentence_text is not None or self.source is not None or self.duration_ms != 0 or self.selection_reason is not None or self.gap_reason is None:
            raise ValueError("gap narrative segment accounting is invalid")
        return self


class NarrativePlanResult(NarrativePlanModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    plan_version: Literal["narrative-remix-plan-v1"] = Field(alias="planVersion")
    input_version: Literal["deterministic-narrative-input-v1"] = Field(alias="inputVersion")
    project_id: str = Field(alias="projectId")
    theme: str = Field(min_length=1, max_length=NARRATIVE_PLAN_MAX_THEME_LENGTH)
    audience: str = Field(min_length=1, max_length=NARRATIVE_PLAN_MAX_AUDIENCE_LENGTH)
    outline: str | None = Field(default=None, max_length=NARRATIVE_PLAN_MAX_OUTLINE_LENGTH)
    target_duration_ms: int = Field(alias="targetDurationMs", strict=True, ge=1_000, le=600_000)
    tolerance_lower_ms: int = Field(alias="toleranceLowerMs", strict=True, ge=800, le=600_000)
    tolerance_upper_ms: int = Field(alias="toleranceUpperMs", strict=True, ge=800, le=720_000)
    selected_duration_ms: int = Field(alias="selectedDurationMs", strict=True, ge=0, le=86_400_000)
    duration_status: Literal["within-tolerance", "outside-tolerance"] = Field(alias="durationStatus")
    status: Literal["ready", "gaps", "needs-duration-optimization"]
    selection_policy: Literal["b10-first-complete-candidate-v1"] = Field(alias="selectionPolicy")
    alignment_version: Literal["information-slot-alignment-v1"] = Field(alias="alignmentVersion")
    plan_digest: str = Field(alias="planDigest", min_length=64, max_length=64)
    segments: list[NarrativePlanSegment] = Field(max_length=NARRATIVE_PLAN_MAX_SEGMENTS)
    gaps: list[NarrativePlanGap] = Field(max_length=NARRATIVE_PLAN_MAX_GAPS)

    _validate_project_id = field_validator("project_id")(_validate_id)

    @field_validator("theme")
    @classmethod
    def validate_result_theme(cls, value: str) -> str:
        return _validate_text(value, NARRATIVE_PLAN_MAX_THEME_LENGTH)

    @field_validator("audience")
    @classmethod
    def validate_result_audience(cls, value: str) -> str:
        return _validate_text(value, NARRATIVE_PLAN_MAX_AUDIENCE_LENGTH)

    @field_validator("outline")
    @classmethod
    def validate_result_outline(cls, value: str | None) -> str | None:
        return None if value is None else _validate_text(value, NARRATIVE_PLAN_MAX_OUTLINE_LENGTH, multiline=True)

    @field_validator("plan_digest")
    @classmethod
    def validate_plan_digest(cls, value: str) -> str:
        if re.fullmatch(r"^[0-9a-f]{64}$", value) is None:
            raise ValueError("invalid narrative plan digest")
        return value

    @model_validator(mode="after")
    def validate_result(self) -> "NarrativePlanResult":
        if self.tolerance_lower_ms != int(self.target_duration_ms * 0.8) or self.tolerance_upper_ms != int(self.target_duration_ms * 1.2):
            raise ValueError("narrative plan duration tolerance mismatch")
        if len(self.segments) == 0 or len(self.segments) > NARRATIVE_PLAN_MAX_SEGMENTS:
            raise ValueError("narrative plan must contain segments")
        if [segment.order for segment in self.segments] != list(range(1, len(self.segments) + 1)):
            raise ValueError("narrative plan segment order is not stable")
        if self.selected_duration_ms != sum(segment.duration_ms for segment in self.segments):
            raise ValueError("narrative plan duration accounting mismatch")
        expected_duration_status = "within-tolerance" if self.tolerance_lower_ms <= self.selected_duration_ms <= self.tolerance_upper_ms else "outside-tolerance"
        if self.duration_status != expected_duration_status:
            raise ValueError("narrative plan duration status mismatch")
        expected_gaps = [segment.gap_reason for segment in self.segments if segment.gap_reason is not None]
        if len(self.gaps) != len(expected_gaps) or any(gap != expected for gap, expected in zip(self.gaps, expected_gaps, strict=True)):
            raise ValueError("narrative plan gap accounting mismatch")
        expected_status = "gaps" if self.gaps else "ready" if self.duration_status == "within-tolerance" else "needs-duration-optimization"
        if self.status != expected_status:
            raise ValueError("narrative plan status mismatch")
        return self


def narrative_plan_digest(result: NarrativePlanResult) -> str:
    payload = result.model_dump(by_alias=True, exclude={"planDigest"})
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_narrative_plan_size(result: NarrativePlanResult) -> NarrativePlanResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > NARRATIVE_PLAN_MAX_RESULT_BYTES:
        raise ValueError("narrative plan result is too large")
    return result
