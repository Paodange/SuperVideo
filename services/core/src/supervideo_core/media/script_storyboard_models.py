"""Versioned, bounded contracts for the deterministic D05 script/storyboard planner."""

from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .duration_optimizer_models import DurationOptimizationResult
from .narrative_planner_models import (
    NARRATIVE_PLAN_MAX_REASON_LENGTH,
    NarrativePlanResult,
    NarrativePlanSegment,
    NarrativePlanSource,
    narrative_plan_digest,
)

SCRIPT_STORYBOARD_SCHEMA_VERSION = 1
SCRIPT_STORYBOARD_CONTRACT_VERSION = "script-storyboard-v1"
SCRIPT_STORYBOARD_PLANNER_VERSION = "deterministic-offline-script-storyboard-v1"
SCRIPT_STORYBOARD_MAX_INPUT_BYTES = 160 * 1024
SCRIPT_STORYBOARD_MAX_OUTPUT_BYTES = 160 * 1024
SCRIPT_STORYBOARD_MAX_FACTS = 64
SCRIPT_STORYBOARD_MAX_PROVENANCE = 128
SCRIPT_STORYBOARD_MAX_SEGMENTS = 32
SCRIPT_STORYBOARD_MAX_SHOTS = 32
SCRIPT_STORYBOARD_MAX_FORBIDDEN_INFERENCES = 32
SCRIPT_STORYBOARD_MAX_TEXT = 512
SCRIPT_STORYBOARD_MAX_LABEL = 160
SCRIPT_STORYBOARD_MIN_DURATION_MS = 1_000
SCRIPT_STORYBOARD_MAX_DURATION_MS = 60_000
SCRIPT_STORYBOARD_VISUAL_SOURCES = (
    "user-material",
    "licensed-stock",
    "ai-image",
    "remotion-template",
    "text-card",
)
SCRIPT_STORYBOARD_FORBIDDEN_KEYS = {
    "secret", "token", "credentialref", "credential", "apikey", "password",
    "command", "path", "provider", "prompt", "authorization", "bearer",
}
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_ABSOLUTE_PATH = re.compile(r"(?:^[A-Za-z]:[\\/]|^\\\\|^/)")
_SECRET_TEXT = re.compile(r"(?:sk-[A-Za-z0-9]{16,}|(?:api[_-]?key|access[_-]?token|bearer)\s*[:=]|https?://)", re.IGNORECASE)


class ScriptStoryboardModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def _bounded_text(value: str, maximum: int, *, allow_newlines: bool = False) -> str:
    if not value.strip() or len(value) > maximum:
        raise ValueError("invalid script/storyboard text")
    for character in value:
        if ord(character) < 32 and (not allow_newlines or character not in "\r\n\t"):
            raise ValueError("invalid script/storyboard control character")
    if _ABSOLUTE_PATH.search(value) or _SECRET_TEXT.search(value):
        raise ValueError("script/storyboard text contains a forbidden path or secret")
    return value


def _id(value: str) -> str:
    if _ID.fullmatch(value) is None:
        raise ValueError("invalid script/storyboard identifier")
    return value


def _uuid(value: str) -> str:
    if _UUID.fullmatch(value) is None:
        raise ValueError("invalid script/storyboard project identifier")
    return value


def _reject_forbidden(value: object) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
            if normalized in SCRIPT_STORYBOARD_FORBIDDEN_KEYS:
                raise ValueError("script/storyboard payload contains a forbidden key")
            _reject_forbidden(item)
    elif isinstance(value, list):
        for item in value:
            _reject_forbidden(item)
    elif isinstance(value, str) and (_ABSOLUTE_PATH.search(value) or _SECRET_TEXT.search(value)):
        raise ValueError("script/storyboard payload contains a forbidden path or secret")


class ScriptStoryboardBrief(ScriptStoryboardModel):
    theme: str = Field(min_length=1, max_length=256)
    audience: str = Field(min_length=1, max_length=256)
    objective: str = Field(min_length=1, max_length=512)
    language: Literal["zh-CN"] = "zh-CN"

    _validate_theme = field_validator("theme")(lambda value: _bounded_text(value, 256))
    _validate_audience = field_validator("audience")(lambda value: _bounded_text(value, 256))
    _validate_objective = field_validator("objective")(lambda value: _bounded_text(value, 512))


class ScriptStoryboardTarget(ScriptStoryboardModel):
    platform: Literal["douyin"]
    aspect_ratio: Literal["9:16"] = Field(alias="aspectRatio")
    duration_ms: int = Field(alias="durationMs", strict=True, ge=SCRIPT_STORYBOARD_MIN_DURATION_MS, le=SCRIPT_STORYBOARD_MAX_DURATION_MS)
    tolerance_percent: Literal[20] = Field(default=20, alias="tolerancePercent")


class ScriptStoryboardVisualContext(ScriptStoryboardModel):
    has_user_material: bool = Field(alias="hasUserMaterial")


class ScriptStoryboardProvenance(ScriptStoryboardModel):
    id: str = Field(min_length=1, max_length=96)
    kind: Literal["user-brief", "source-record", "c02-segment", "c03-selection"]
    label: str = Field(min_length=1, max_length=SCRIPT_STORYBOARD_MAX_LABEL)
    source_segment_id: str | None = Field(default=None, alias="sourceSegmentId", max_length=96)
    verified: bool = True

    _validate_id = field_validator("id")(_id)
    _validate_label = field_validator("label")(lambda value: _bounded_text(value, SCRIPT_STORYBOARD_MAX_LABEL))
    _validate_segment_id = field_validator("source_segment_id")(
        lambda value: None if value is None else _id(value)
    )

    @model_validator(mode="after")
    def validate_binding(self) -> "ScriptStoryboardProvenance":
        if self.kind in {"c02-segment", "c03-selection"} and self.source_segment_id is None:
            raise ValueError("source provenance must bind a segment")
        if self.kind not in {"c02-segment", "c03-selection"} and self.source_segment_id is not None:
            raise ValueError("non-source provenance cannot bind a segment")
        return self


class ScriptStoryboardFact(ScriptStoryboardModel):
    id: str = Field(min_length=1, max_length=64)
    field: Literal["jobTitle", "salary", "location", "benefit", "qualification", "workContent", "other"]
    value: str = Field(min_length=1, max_length=256)
    provenance_ids: list[str] = Field(alias="provenanceIds", min_length=1, max_length=8)
    verification: Literal["verified", "unverified", "needs-user-confirmation"]

    _validate_id = field_validator("id")(_id)
    _validate_value = field_validator("value")(lambda value: _bounded_text(value, 256))
    @field_validator("provenance_ids")
    @classmethod
    def validate_provenance_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)) or any(_ID.fullmatch(item) is None for item in value):
            raise ValueError("invalid fact provenance ids")
        return value


class ScriptStoryboardFactBinding(ScriptStoryboardModel):
    segment_id: str = Field(alias="segmentId", min_length=1, max_length=96)
    fact_ids: list[str] = Field(alias="factIds", min_length=1, max_length=16)

    _validate_segment_id = field_validator("segment_id")(_id)
    @field_validator("fact_ids")
    @classmethod
    def validate_fact_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)) or any(_ID.fullmatch(item) is None for item in value):
            raise ValueError("invalid fact binding ids")
        return value


class ScriptStoryboardParams(ScriptStoryboardModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal["script-storyboard-v1"] = Field(alias="contractVersion")
    project_id: str = Field(alias="projectId")
    brief: ScriptStoryboardBrief
    facts: list[ScriptStoryboardFact] = Field(max_length=SCRIPT_STORYBOARD_MAX_FACTS)
    forbidden_inferences: list[str] = Field(alias="forbiddenInferences", max_length=SCRIPT_STORYBOARD_MAX_FORBIDDEN_INFERENCES)
    target: ScriptStoryboardTarget
    visual_context: ScriptStoryboardVisualContext = Field(alias="visualContext")
    provenance: list[ScriptStoryboardProvenance] = Field(max_length=SCRIPT_STORYBOARD_MAX_PROVENANCE)
    fact_bindings: list[ScriptStoryboardFactBinding] = Field(alias="factBindings", max_length=SCRIPT_STORYBOARD_MAX_SEGMENTS)
    source_plan: NarrativePlanResult = Field(alias="sourcePlan")
    duration_plan: DurationOptimizationResult | None = Field(default=None, alias="durationPlan")

    _validate_project_id = field_validator("project_id")(_uuid)

    @field_validator("forbidden_inferences")
    @classmethod
    def validate_forbidden_inferences(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("forbidden inferences must be unique")
        return [_bounded_text(item, SCRIPT_STORYBOARD_MAX_TEXT) for item in value]

    @model_validator(mode="after")
    def validate_input(self) -> "ScriptStoryboardParams":
        if len(self.facts) != len({fact.id for fact in self.facts}):
            raise ValueError("facts must have unique ids")
        if len(self.provenance) != len({item.id for item in self.provenance}):
            raise ValueError("provenance must have unique ids")
        provenance_ids = {item.id for item in self.provenance}
        fact_ids = {fact.id for fact in self.facts}
        segment_ids = {segment.segment_id for segment in self.source_plan.segments}
        if any(item not in provenance_ids for fact in self.facts for item in fact.provenance_ids):
            raise ValueError("facts must reference declared provenance")
        for binding in self.fact_bindings:
            if binding.segment_id not in segment_ids or any(item not in fact_ids for item in binding.fact_ids):
                raise ValueError("fact binding must reference declared facts and source segments")
        if self.source_plan.project_id != self.project_id or narrative_plan_digest(self.source_plan) != self.source_plan.plan_digest:
            raise ValueError("source plan is stale or belongs to another project")
        if self.source_plan.target_duration_ms != self.target.duration_ms:
            raise ValueError("D05 target duration must match C02 target duration")
        if self.duration_plan is not None:
            if self.duration_plan.source_plan_digest != self.source_plan.plan_digest:
                raise ValueError("C03 duration plan must bind the C02 plan digest")
            if self.duration_plan.project_id != self.project_id or self.duration_plan.target_duration_ms != self.target.duration_ms:
                raise ValueError("C03 duration plan must use the D05 project and target duration")
        payload = self.model_dump_json(by_alias=True).encode("utf-8")
        if len(payload) > SCRIPT_STORYBOARD_MAX_INPUT_BYTES:
            raise ValueError("script/storyboard input is too large")
        _reject_forbidden(json.loads(payload))
        return self


class ScriptStoryboardFactAudit(ScriptStoryboardModel):
    fact_id: str = Field(alias="factId")
    status: Literal["bound", "unbound", "needs-user-confirmation"]
    provenance_ids: list[str] = Field(alias="provenanceIds", min_length=1, max_length=8)
    segment_ids: list[str] = Field(alias="segmentIds", max_length=SCRIPT_STORYBOARD_MAX_SEGMENTS)

    _validate_fact_id = field_validator("fact_id")(_id)
    @field_validator("provenance_ids")
    @classmethod
    def validate_provenance_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)) or any(_ID.fullmatch(item) is None for item in value):
            raise ValueError("invalid audit provenance ids")
        return value

    @field_validator("segment_ids")
    @classmethod
    def validate_segment_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)) or any(_ID.fullmatch(item) is None for item in value):
            raise ValueError("invalid audit segment ids")
        return value


class ScriptStoryboardSegment(ScriptStoryboardModel):
    segment_id: str = Field(alias="segmentId")
    source_segment_id: str = Field(alias="sourceSegmentId")
    order: int = Field(strict=True, ge=1, le=SCRIPT_STORYBOARD_MAX_SEGMENTS)
    role: Literal["hook", "body", "cta"]
    status: Literal["matched", "gap"]
    sentence_id: str | None = Field(default=None, alias="sentenceId", max_length=64)
    text: str | None = Field(default=None, max_length=512)
    source: NarrativePlanSource | None = None
    duration_ms: int = Field(alias="durationMs", strict=True, ge=0, le=SCRIPT_STORYBOARD_MAX_DURATION_MS)
    provenance_ids: list[str] = Field(alias="provenanceIds", min_length=1, max_length=16)
    fact_ids: list[str] = Field(alias="factIds", max_length=16)
    confirmation: Literal["not-required", "verified", "needs-user-confirmation"]

    _validate_segment_id = field_validator("segment_id", "source_segment_id")(_id)
    _validate_sentence_id = field_validator("sentence_id")(
        lambda value: None if value is None else (value if _DIGEST.fullmatch(value) else (_ for _ in ()).throw(ValueError("invalid sentence id")))
    )
    _validate_text = field_validator("text")(
        lambda value: None if value is None else _bounded_text(value, 512)
    )

    @field_validator("provenance_ids", "fact_ids")
    @classmethod
    def validate_id_arrays(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)) or any(_ID.fullmatch(item) is None for item in value):
            raise ValueError("invalid script/storyboard references")
        return value

    @model_validator(mode="after")
    def validate_state(self) -> "ScriptStoryboardSegment":
        if self.status == "matched":
            if self.sentence_id is None or self.text is None or self.source is None or self.duration_ms <= 0:
                raise ValueError("matched storyboard segment must retain a complete sentence and source")
            if self.duration_ms != self.source.timecode.end_ms - self.source.timecode.start_ms:
                raise ValueError("storyboard sentence duration mismatch")
        elif self.sentence_id is not None or self.text is not None or self.source is not None or self.duration_ms != 0 or self.fact_ids:
            raise ValueError("gap storyboard segment cannot contain source or duration")
        return self


class ScriptStoryboardShot(ScriptStoryboardModel):
    shot_id: str = Field(alias="shotId")
    order: int = Field(strict=True, ge=1, le=SCRIPT_STORYBOARD_MAX_SHOTS)
    segment_id: str = Field(alias="segmentId")
    duration_ms: int = Field(alias="durationMs", strict=True, ge=0, le=SCRIPT_STORYBOARD_MAX_DURATION_MS)
    visual_source_priority: list[Literal["user-material", "licensed-stock", "ai-image", "remotion-template", "text-card"]] = Field(alias="visualSourcePriority", min_length=1, max_length=5)
    fallback_reason: Literal["planned", "no-user-material", "source-gap"] = Field(alias="fallbackReason")
    visual_intent: str = Field(alias="visualIntent", min_length=1, max_length=160)

    _validate_shot_id = field_validator("shot_id", "segment_id")(_id)
    _validate_visual_intent = field_validator("visual_intent")(lambda value: _bounded_text(value, 160))

    @field_validator("visual_source_priority")
    @classmethod
    def validate_priority(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("visual source priority must not contain duplicates")
        return value

    @model_validator(mode="after")
    def validate_priority_for_fallback(self) -> "ScriptStoryboardShot":
        expected = {
            "planned": ["user-material", "licensed-stock", "ai-image", "remotion-template", "text-card"],
            "no-user-material": ["licensed-stock", "ai-image", "remotion-template", "text-card"],
            "source-gap": ["remotion-template", "ai-image", "text-card"],
        }[self.fallback_reason]
        if self.visual_source_priority != expected:
            raise ValueError("visual source priority does not match fallback reason")
        return self


class ScriptStoryboardScript(ScriptStoryboardModel):
    hook: ScriptStoryboardSegment
    body: list[ScriptStoryboardSegment] = Field(max_length=SCRIPT_STORYBOARD_MAX_SEGMENTS)
    cta: ScriptStoryboardSegment


class ScriptStoryboardResult(ScriptStoryboardModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal["script-storyboard-v1"] = Field(alias="contractVersion")
    planner_version: Literal["deterministic-offline-script-storyboard-v1"] = Field(alias="plannerVersion")
    project_id: str = Field(alias="projectId")
    source_plan_digest: str = Field(alias="sourcePlanDigest")
    duration_plan_source_digest: str | None = Field(default=None, alias="durationPlanSourceDigest")
    target_duration_ms: int = Field(alias="targetDurationMs", strict=True, ge=SCRIPT_STORYBOARD_MIN_DURATION_MS, le=SCRIPT_STORYBOARD_MAX_DURATION_MS)
    tolerance_lower_ms: int = Field(alias="toleranceLowerMs", strict=True, ge=800, le=SCRIPT_STORYBOARD_MAX_DURATION_MS)
    tolerance_upper_ms: int = Field(alias="toleranceUpperMs", strict=True, ge=800, le=72_000)
    selected_duration_ms: int = Field(alias="selectedDurationMs", strict=True, ge=0, le=SCRIPT_STORYBOARD_MAX_DURATION_MS)
    duration_status: Literal["within-tolerance", "outside-tolerance"] = Field(alias="durationStatus")
    duration_policy: Literal["c02-complete-sentence-v1", "c03-bounded-whole-sentence-knapsack-v1"] = Field(alias="durationPolicy")
    status: Literal["ready", "gaps", "needs-user-confirmation", "needs-duration-optimization"]
    brief: ScriptStoryboardBrief
    forbidden_inferences: list[str] = Field(alias="forbiddenInferences", max_length=SCRIPT_STORYBOARD_MAX_FORBIDDEN_INFERENCES)
    provenance: list[ScriptStoryboardProvenance] = Field(max_length=SCRIPT_STORYBOARD_MAX_PROVENANCE)
    facts: list[ScriptStoryboardFactAudit] = Field(max_length=SCRIPT_STORYBOARD_MAX_FACTS)
    script: ScriptStoryboardScript
    shots: list[ScriptStoryboardShot] = Field(max_length=SCRIPT_STORYBOARD_MAX_SHOTS)

    _validate_project_id = field_validator("project_id")(_uuid)
    _validate_digest_fields = field_validator("source_plan_digest", "duration_plan_source_digest")(
        lambda value: None if value is None else (value if _DIGEST.fullmatch(value) else (_ for _ in ()).throw(ValueError("invalid plan digest")))
    )

    @field_validator("forbidden_inferences")
    @classmethod
    def validate_forbidden_inferences(cls, value: list[str]) -> list[str]:
        return [_bounded_text(item, SCRIPT_STORYBOARD_MAX_TEXT) for item in value]

    @model_validator(mode="after")
    def validate_result(self) -> "ScriptStoryboardResult":
        if self.tolerance_lower_ms != int(self.target_duration_ms * 0.8) or self.tolerance_upper_ms != int(self.target_duration_ms * 1.2):
            raise ValueError("storyboard duration tolerance mismatch")
        segments = [self.script.hook, *self.script.body, self.script.cta]
        if not segments or len(segments) > SCRIPT_STORYBOARD_MAX_SEGMENTS:
            raise ValueError("storyboard must contain bounded segments")
        if [segment.order for segment in segments] != list(range(1, len(segments) + 1)):
            raise ValueError("storyboard segment order is not stable")
        if len({segment.segment_id for segment in segments}) != len(segments):
            raise ValueError("storyboard segment ids must be unique")
        if len({segment.source_segment_id for segment in segments}) != len(segments):
            raise ValueError("storyboard source segment ids must be unique")
        if segments[0].role != "hook" or segments[-1].role != "cta" or any(item.role != "body" for item in segments[1:-1]):
            raise ValueError("storyboard role order is invalid")
        if self.selected_duration_ms != sum(item.duration_ms for item in segments):
            raise ValueError("storyboard duration accounting mismatch")
        expected_status = "within-tolerance" if self.tolerance_lower_ms <= self.selected_duration_ms <= self.tolerance_upper_ms else "outside-tolerance"
        if self.duration_status != expected_status:
            raise ValueError("storyboard duration status mismatch")
        if len(self.shots) != len(segments) or [shot.order for shot in self.shots] != list(range(1, len(segments) + 1)):
            raise ValueError("storyboard shots must map one-to-one to segments")
        if len({shot.shot_id for shot in self.shots}) != len(self.shots) or len({shot.segment_id for shot in self.shots}) != len(self.shots):
            raise ValueError("storyboard shot ids and segment ids must be unique")
        for segment, shot in zip(segments, self.shots, strict=True):
            if shot.segment_id != segment.segment_id or shot.duration_ms != segment.duration_ms:
                raise ValueError("storyboard shot binding mismatch")
            if segment.status == "gap" and shot.fallback_reason != "source-gap":
                raise ValueError("gap storyboard segment requires a source-gap fallback")
            if segment.status == "matched" and shot.fallback_reason == "source-gap":
                raise ValueError("matched storyboard segment cannot use a source-gap fallback")
        provenance_ids = {item.id for item in self.provenance}
        for segment in segments:
            if any(item not in provenance_ids for item in segment.provenance_ids):
                raise ValueError("storyboard segment references undeclared provenance")
        fact_ids = {item.fact_id for item in self.facts}
        if len(fact_ids) != len(self.facts):
            raise ValueError("storyboard facts must be unique")
        if any(item not in fact_ids for segment in segments for item in segment.fact_ids):
            raise ValueError("storyboard segment references undeclared fact")
        segment_by_id = {segment.segment_id: segment for segment in segments}
        audit_by_fact = {item.fact_id: item for item in self.facts}
        for audit in self.facts:
            if len(audit.segment_ids) != len(set(audit.segment_ids)):
                raise ValueError("storyboard fact audit segment ids must be unique")
            if any(segment_id not in segment_by_id for segment_id in audit.segment_ids):
                raise ValueError("storyboard fact audit references an unknown segment")
            if audit.status == "unbound" and audit.segment_ids:
                raise ValueError("unbound fact audit cannot reference segments")
            if audit.status != "unbound" and not audit.segment_ids:
                raise ValueError("bound fact audit must reference at least one segment")
        for segment in segments:
            referenced = [audit_by_fact[fact_id] for fact_id in segment.fact_ids]
            expected_confirmation = (
                "not-required" if not referenced else
                "verified" if all(audit.status == "bound" for audit in referenced) else
                "needs-user-confirmation"
            )
            if segment.confirmation != expected_confirmation:
                raise ValueError("storyboard segment confirmation does not match fact audits")
            for audit in referenced:
                if segment.segment_id not in audit.segment_ids:
                    raise ValueError("storyboard fact audit and segment binding are inconsistent")
        for audit in self.facts:
            for segment_id in audit.segment_ids:
                if audit.fact_id not in segment_by_id[segment_id].fact_ids:
                    raise ValueError("storyboard segment and fact audit binding are inconsistent")
        expected_status = (
            "gaps" if any(segment.status == "gap" for segment in segments) else
            "needs-user-confirmation" if any(audit.status != "bound" for audit in self.facts) else
            "needs-duration-optimization" if self.duration_status == "outside-tolerance" else
            "ready"
        )
        if self.status != expected_status:
            raise ValueError("storyboard status does not match gaps, fact, and duration state")
        payload = self.model_dump_json(by_alias=True).encode("utf-8")
        if len(payload) > SCRIPT_STORYBOARD_MAX_OUTPUT_BYTES:
            raise ValueError("script/storyboard result is too large")
        _reject_forbidden(json.loads(payload))
        return self


def source_provenance_id(segment: NarrativePlanSegment, plan_digest: str, kind: str = "c02") -> str:
    prefix = "c03" if kind == "c03" else "c02"
    return _id(f"{prefix}:{plan_digest[:16]}:{segment.segment_id}")
