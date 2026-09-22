"""Versioned, bounded contracts for C03 whole-sentence duration optimization."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .index_models import SENTENCE_INDEX_MAX_TEXT_LENGTH
from .narrative_planner_models import (
    NARRATIVE_PLAN_MAX_AUDIENCE_LENGTH,
    NARRATIVE_PLAN_MAX_OUTLINE_LENGTH,
    NARRATIVE_PLAN_MAX_REASON_LENGTH,
    NARRATIVE_PLAN_MAX_SEGMENTS,
    NARRATIVE_PLAN_MAX_THEME_LENGTH,
    NarrativePlanGap,
    NarrativePlanResult,
    NarrativePlanSource,
)
from .slot_alignment_models import SlotAlignmentResult

DURATION_OPTIMIZATION_SCHEMA_VERSION = 1
DURATION_OPTIMIZATION_VERSION = "duration-optimization-v1"
DURATION_OPTIMIZATION_POLICY = "bounded-whole-sentence-knapsack-v1"
DURATION_OPTIMIZATION_MAX_CHANGES = 64
DURATION_OPTIMIZATION_MAX_INPUT_BYTES = 120 * 1024
DURATION_OPTIMIZATION_MAX_RESULT_BYTES = 60 * 1024


class DurationOptimizationModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def _validate_id(value: str) -> str:
    if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
        raise ValueError("invalid duration optimization identity")
    return value


def _validate_digest(value: str) -> str:
    if re.fullmatch(r"^[0-9a-f]{64}$", value) is None:
        raise ValueError("invalid duration optimization digest")
    return value


def _validate_text(value: str, maximum: int) -> str:
    if not value.strip() or len(value) > maximum or any(ord(character) < 32 for character in value):
        raise ValueError("invalid duration optimization text")
    return value


class DurationOptimizationParams(DurationOptimizationModel):
    """C02 plan plus the B10 candidate pool used to optimize it."""

    project_id: str = Field(alias="projectId")
    source_plan: NarrativePlanResult = Field(alias="sourcePlan")
    alignment: SlotAlignmentResult
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    _validate_project_id = field_validator("project_id")(_validate_id)

    @model_validator(mode="after")
    def validate_sources(self) -> "DurationOptimizationParams":
        if self.source_plan.project_id != self.project_id or self.alignment.project_id != self.project_id:
            raise ValueError("duration optimization sources must use one project")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > DURATION_OPTIMIZATION_MAX_INPUT_BYTES:
            raise ValueError("duration optimization input is too large")
        return self


class DurationOptimizationSentence(DurationOptimizationModel):
    sentence_id: str = Field(alias="sentenceId", min_length=64, max_length=64)
    sentence_text: str = Field(alias="sentenceText", min_length=1, max_length=SENTENCE_INDEX_MAX_TEXT_LENGTH)
    source: NarrativePlanSource
    duration_ms: int = Field(alias="durationMs", strict=True, gt=0, le=86_400_000)
    candidate_rank: int = Field(alias="candidateRank", strict=True, ge=1, le=8)

    _validate_sentence_id = field_validator("sentence_id")(_validate_digest)

    @field_validator("sentence_text")
    @classmethod
    def validate_sentence_text(cls, value: str) -> str:
        return _validate_text(value, SENTENCE_INDEX_MAX_TEXT_LENGTH)

    @model_validator(mode="after")
    def validate_duration_accounting(self) -> "DurationOptimizationSentence":
        if self.duration_ms != self.source.timecode.end_ms - self.source.timecode.start_ms:
            raise ValueError("duration optimization sentence duration mismatch")
        return self


class DurationOptimizationSegment(DurationOptimizationModel):
    segment_id: str = Field(alias="segmentId", min_length=1, max_length=64)
    order: int = Field(strict=True, ge=1, le=NARRATIVE_PLAN_MAX_SEGMENTS)
    role: Literal["hook", "body", "cta"]
    slot_id: str = Field(alias="slotId", min_length=1, max_length=32)
    slot_kind: Literal["hook", "context", "claim", "evidence", "benefit", "requirement", "process", "cta", "closing", "other"] = Field(alias="slotKind")
    source_text: str = Field(alias="sourceText", min_length=1, max_length=512)
    status: Literal["matched", "gap"]
    operation: Literal["keep", "replace", "add"]
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
        return None if value is None else _validate_digest(value)

    @field_validator("sentence_text")
    @classmethod
    def validate_sentence_text(cls, value: str | None) -> str | None:
        return None if value is None else _validate_text(value, SENTENCE_INDEX_MAX_TEXT_LENGTH)

    @field_validator("selection_reason")
    @classmethod
    def validate_selection_reason(cls, value: str | None) -> str | None:
        return None if value is None else _validate_text(value, NARRATIVE_PLAN_MAX_REASON_LENGTH)

    @model_validator(mode="after")
    def validate_segment_state(self) -> "DurationOptimizationSegment":
        if self.status == "matched":
            if self.operation not in {"keep", "replace", "add"} or self.candidate_sentence_id is None or self.candidate_rank is None or self.sentence_text is None or self.source is None or self.duration_ms <= 0 or not self.selection_reason or self.gap_reason is not None:
                raise ValueError("matched optimized segment accounting is invalid")
        elif self.operation != "keep" or self.candidate_sentence_id is not None or self.candidate_rank is not None or self.sentence_text is not None or self.source is not None or self.duration_ms != 0 or self.selection_reason is not None or self.gap_reason is None:
            raise ValueError("gap optimized segment accounting is invalid")
        return self


class DurationOptimizationChange(DurationOptimizationModel):
    segment_id: str = Field(alias="segmentId", min_length=1, max_length=64)
    slot_id: str = Field(alias="slotId", min_length=1, max_length=32)
    role: Literal["hook", "body", "cta"]
    operation: Literal["keep", "replace", "add", "remove"]
    before: DurationOptimizationSentence | None = None
    after: DurationOptimizationSentence | None = None
    selection_reason: str = Field(alias="selectionReason", min_length=1, max_length=NARRATIVE_PLAN_MAX_REASON_LENGTH)

    @field_validator("segment_id", "slot_id")
    @classmethod
    def validate_identity_text(cls, value: str) -> str:
        return _validate_text(value, 64)

    @field_validator("selection_reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        return _validate_text(value, NARRATIVE_PLAN_MAX_REASON_LENGTH)

    @model_validator(mode="after")
    def validate_change_state(self) -> "DurationOptimizationChange":
        valid = {
            "keep": self.before is not None and self.after is not None and self.before == self.after,
            "replace": self.before is not None and self.after is not None and self.before.sentence_id != self.after.sentence_id,
            "add": self.before is None and self.after is not None,
            "remove": self.before is not None and self.after is None,
        }
        if not valid[self.operation]:
            raise ValueError("duration optimization change accounting is invalid")
        return self


class DurationOptimizationResult(DurationOptimizationModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    optimization_version: Literal["duration-optimization-v1"] = Field(alias="optimizationVersion")
    project_id: str = Field(alias="projectId")
    source_plan_digest: str = Field(alias="sourcePlanDigest", min_length=64, max_length=64)
    target_duration_ms: int = Field(alias="targetDurationMs", strict=True, ge=1_000, le=600_000)
    tolerance_lower_ms: int = Field(alias="toleranceLowerMs", strict=True, ge=800, le=600_000)
    tolerance_upper_ms: int = Field(alias="toleranceUpperMs", strict=True, ge=800, le=720_000)
    selected_duration_ms: int = Field(alias="selectedDurationMs", strict=True, ge=0, le=86_400_000)
    duration_status: Literal["within-tolerance", "outside-tolerance"] = Field(alias="durationStatus")
    status: Literal["optimized", "unchanged", "gaps", "needs-duration-optimization"]
    selection_policy: Literal["bounded-whole-sentence-knapsack-v1"] = Field(alias="selectionPolicy")
    segments: list[DurationOptimizationSegment] = Field(max_length=NARRATIVE_PLAN_MAX_SEGMENTS)
    changes: list[DurationOptimizationChange] = Field(max_length=DURATION_OPTIMIZATION_MAX_CHANGES)
    gaps: list[NarrativePlanGap] = Field(max_length=NARRATIVE_PLAN_MAX_SEGMENTS + 1)

    _validate_project_id = field_validator("project_id")(_validate_id)
    _validate_source_plan_digest = field_validator("source_plan_digest")(_validate_digest)

    @model_validator(mode="after")
    def validate_result(self) -> "DurationOptimizationResult":
        if self.tolerance_lower_ms != int(self.target_duration_ms * 0.8) or self.tolerance_upper_ms != int(self.target_duration_ms * 1.2):
            raise ValueError("duration optimization tolerance mismatch")
        if [segment.order for segment in self.segments] != list(range(1, len(self.segments) + 1)):
            raise ValueError("duration optimization segment order is not stable")
        if self.selected_duration_ms != sum(segment.duration_ms for segment in self.segments):
            raise ValueError("duration optimization duration accounting mismatch")
        expected_status = "within-tolerance" if self.tolerance_lower_ms <= self.selected_duration_ms <= self.tolerance_upper_ms else "outside-tolerance"
        if self.duration_status != expected_status:
            raise ValueError("duration optimization duration status mismatch")
        if len(self.changes) > DURATION_OPTIMIZATION_MAX_CHANGES:
            raise ValueError("too many duration optimization changes")
        if self.gaps and self.status != "gaps":
            raise ValueError("duration optimization gaps require gaps status")
        expected_status = "gaps" if self.gaps else "unchanged" if self.duration_status == "within-tolerance" and not any(change.operation != "keep" for change in self.changes) else "optimized" if self.duration_status == "within-tolerance" else "needs-duration-optimization"
        if self.status != expected_status:
            raise ValueError("duration optimization status mismatch")
        return self


def validate_duration_optimization_size(result: DurationOptimizationResult) -> DurationOptimizationResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > DURATION_OPTIMIZATION_MAX_RESULT_BYTES:
        raise ValueError("duration optimization result is too large")
    return result
