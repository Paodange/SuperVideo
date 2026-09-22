"""Strict D08 generation-failure fallback models.

The models deliberately describe failures and choices, not provider credentials or
filesystem artifacts.  A TTS fallback is therefore an auditable silence
placeholder with no audio output claim.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .image_models import ImageGenerationResult
from .recruitment_template_models import RecruitmentTemplateRenderPlan
from .script_storyboard_models import ScriptStoryboardResult
from .tts_models import TtsSynthesisResult
from .video_assembly_models import (
    VideoAssemblyParams,
    VideoAssemblyRemotionPlan,
    VideoAssemblyUserMaterial,
)

GENERATION_FALLBACK_SCHEMA_VERSION = 1
GENERATION_FALLBACK_CONTRACT_VERSION = "generation-fallback-v1"
GENERATION_FALLBACK_POLICY_VERSION = "deterministic-generation-fallback-v1"
GENERATION_FALLBACK_RUNTIME_MODE = "offline-deterministic"
GENERATION_FALLBACK_MAX_SHOTS = 32
GENERATION_FALLBACK_MAX_FAILURES = 64
GENERATION_FALLBACK_MAX_RESULT_BYTES = 768 * 1024
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class GenerationFallbackModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class GenerationFallbackFailure(GenerationFallbackModel):
    project_id: str = Field(alias="projectId")
    component: Literal["tts", "image", "animation"]
    stage: Literal["tts", "image", "animation"]
    shot_id: str | None = Field(alias="shotId")
    code: Literal["PROVIDER_UNAVAILABLE", "GENERATION_FAILED", "OUTPUT_INVALID", "TIMEOUT", "CANCELLED"]
    retryable: bool

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid D08 failure project id")
        return value

    @field_validator("shot_id")
    @classmethod
    def validate_shot_id(cls, value: str | None) -> str | None:
        if value is not None and ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid D08 failure shot id")
        return value

    @model_validator(mode="after")
    def validate_stage_binding(self) -> "GenerationFallbackFailure":
        if self.stage != self.component:
            raise ValueError("D08 failure stage must match component")
        if self.component == "tts" and self.shot_id is not None:
            raise ValueError("TTS failure cannot bind to a shot")
        if self.component != "tts" and self.shot_id is None:
            raise ValueError("image and animation failures require a shot")
        return self


class GenerationFallbackDiagnostic(GenerationFallbackModel):
    code: Literal[
        "FALLBACK_SOURCE_UNAVAILABLE",
        "FALLBACK_SOURCE_GAP",
        "FALLBACK_CANDIDATES_EXHAUSTED",
        "FALLBACK_D07_SOURCE_UNSUPPORTED",
        "FALLBACK_TTS_AUDIO_UNAVAILABLE",
        "FALLBACK_D07_INPUT_INVALID",
    ]
    stage: Literal["selection", "storyboard", "d07-binding", "tts"]

    @model_validator(mode="after")
    def validate_code_stage(self) -> "GenerationFallbackDiagnostic":
        expected = {
            "FALLBACK_SOURCE_UNAVAILABLE": "selection",
            "FALLBACK_SOURCE_GAP": "storyboard",
            "FALLBACK_CANDIDATES_EXHAUSTED": "selection",
            "FALLBACK_D07_SOURCE_UNSUPPORTED": "d07-binding",
            "FALLBACK_TTS_AUDIO_UNAVAILABLE": "tts",
            "FALLBACK_D07_INPUT_INVALID": "d07-binding",
        }
        if expected[self.code] != self.stage:
            raise ValueError("D08 diagnostic code/stage pair is invalid")
        return self


VisualSource = Literal["user-material", "licensed-stock", "ai-image", "remotion-template", "text-card"]


class GenerationFallbackAttempt(GenerationFallbackModel):
    source: VisualSource
    outcome: Literal["selected", "failed", "unavailable"]
    error: GenerationFallbackFailure | GenerationFallbackDiagnostic | None
    provenance: list[str] = Field(max_length=16)

    @field_validator("provenance")
    @classmethod
    def validate_provenance(cls, value: list[str]) -> list[str]:
        _validate_ids(value, "D08 attempt provenance")
        return value


class GenerationFallbackShot(GenerationFallbackModel):
    shot_id: str = Field(alias="shotId")
    order: int = Field(strict=True, ge=1, le=GENERATION_FALLBACK_MAX_SHOTS)
    segment_id: str = Field(alias="segmentId")
    status: Literal["resolved", "unresolved"]
    chosen_source: VisualSource | None = Field(alias="chosenSource")
    fallback_reason: Literal["none", "generation-failed", "source-unavailable", "source-gap", "candidates-exhausted"] = Field(alias="fallbackReason")
    d05_fallback_reason: Literal["planned", "no-user-material", "source-gap"] = Field(alias="d05FallbackReason")
    d07_binding: Literal["user-material", "d06-image"] | None = Field(alias="d07Binding")
    attempts: list[GenerationFallbackAttempt] = Field(min_length=1, max_length=5)
    provenance: list[str] = Field(max_length=16)
    diagnostic: GenerationFallbackDiagnostic | None

    _shot_id = field_validator("shot_id", "segment_id")(lambda value: _identifier(value, "D08 shot identity"))
    _provenance = field_validator("provenance")(lambda value: _identifiers(value, "D08 shot provenance"))


class GenerationFallbackTts(GenerationFallbackModel):
    status: Literal["available", "fallback"]
    chosen_source: Literal["d02-tts", "silence-placeholder"] = Field(alias="chosenSource")
    fallback_reason: Literal["none", "generation-failed"] = Field(alias="fallbackReason")
    d07_binding: Literal["d02-tts"] | None = Field(alias="d07Binding")
    failure: GenerationFallbackFailure | None
    provenance: list[str] = Field(max_length=8)
    diagnostic: GenerationFallbackDiagnostic | None

    _provenance = field_validator("provenance")(lambda value: _identifiers(value, "D08 TTS provenance"))

    @model_validator(mode="after")
    def validate_state(self) -> "GenerationFallbackTts":
        if self.status == "available":
            if (self.chosen_source, self.fallback_reason, self.d07_binding, self.failure, self.diagnostic) != ("d02-tts", "none", "d02-tts", None, None):
                raise ValueError("successful D02 TTS has invalid D08 accounting")
        else:
            if self.chosen_source != "silence-placeholder" or self.fallback_reason != "generation-failed" or self.d07_binding is not None or self.failure is None or self.failure.component != "tts" or self.diagnostic != GenerationFallbackDiagnostic(code="FALLBACK_TTS_AUDIO_UNAVAILABLE", stage="tts"):
                raise ValueError("failed TTS must be an auditable silence placeholder without an audio binding")
        return self


class GenerationFallbackParams(GenerationFallbackModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal[GENERATION_FALLBACK_CONTRACT_VERSION] = Field(alias="contractVersion")
    policy_version: Literal[GENERATION_FALLBACK_POLICY_VERSION] = Field(alias="policyVersion")
    runtime_mode: Literal[GENERATION_FALLBACK_RUNTIME_MODE] = Field(alias="runtimeMode")
    project_id: str = Field(alias="projectId")
    timeline_id: str = Field(alias="timelineId")
    assembly_id: str = Field(alias="assemblyId")
    storyboard: ScriptStoryboardResult
    tts: TtsSynthesisResult | None
    tts_failure: GenerationFallbackFailure | None = Field(alias="ttsFailure")
    image_results: list[ImageGenerationResult] = Field(alias="imageResults", max_length=GENERATION_FALLBACK_MAX_SHOTS)
    image_failures: list[GenerationFallbackFailure] = Field(alias="imageFailures", max_length=GENERATION_FALLBACK_MAX_FAILURES)
    animation_failures: list[GenerationFallbackFailure] = Field(alias="animationFailures", max_length=GENERATION_FALLBACK_MAX_FAILURES)
    text_card_unavailable_shot_ids: list[str] = Field(alias="textCardUnavailableShotIds", max_length=GENERATION_FALLBACK_MAX_SHOTS)
    d04_plan: RecruitmentTemplateRenderPlan = Field(alias="d04Plan")
    d03_plan: VideoAssemblyRemotionPlan = Field(alias="d03Plan")
    user_materials: list[VideoAssemblyUserMaterial] = Field(alias="userMaterials", max_length=GENERATION_FALLBACK_MAX_SHOTS)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        return _uuid(value, "D08 project id")

    _timeline_id = field_validator("timeline_id", "assembly_id")(lambda value: _identifier(value, "D08 timeline identity"))

    @model_validator(mode="after")
    def validate_bindings(self) -> "GenerationFallbackParams":
        if self.storyboard.project_id != self.project_id or self.d04_plan.project_id != self.project_id:
            raise ValueError("D08 project binding mismatch")
        if self.tts is None and self.tts_failure is None or self.tts is not None and self.tts_failure is not None:
            raise ValueError("D08 requires exactly one TTS success or failure")
        if self.tts is not None and self.tts.project_id != self.project_id:
            raise ValueError("D02 TTS result belongs to another project")
        shots = {shot.shot_id: shot for shot in self.storyboard.shots}
        if len(shots) != len(self.storyboard.shots):
            raise ValueError("D08 storyboard shot identities must be unique")
        if any(item.project_id != self.project_id for item in self.image_results):
            raise ValueError("D06 image result belongs to another project")
        if len({item.shot_id for item in self.image_results}) != len(self.image_results):
            raise ValueError("D06 image results must be unique per shot")
        if any(item.shot_id not in shots for item in self.image_results):
            raise ValueError("D06 image result references an unknown D05 shot")
        _validate_failures(self.image_failures, self.project_id, shots, "image")
        _validate_failures(self.animation_failures, self.project_id, shots, "animation")
        if self.tts_failure is not None:
            _validate_failures([self.tts_failure], self.project_id, {}, "tts")
        if any(item.shot_id in {failure.shot_id for failure in self.image_failures} for item in self.image_results):
            raise ValueError("a D06 image cannot be both successful and failed")
        if len({failure.shot_id for failure in self.animation_failures}) != len(self.animation_failures):
            raise ValueError("animation failures must be unique per shot")
        if len(set(self.text_card_unavailable_shot_ids)) != len(self.text_card_unavailable_shot_ids) or any(item not in shots for item in self.text_card_unavailable_shot_ids):
            raise ValueError("text-card unavailable shot identities must be unique and known")
        for material in self.user_materials:
            shot = shots.get(material.shot_id)
            if shot is None or shot.visual_source_priority[0] != "user-material":
                raise ValueError("user material is only allowed for a D05 user-material priority shot")
        if len({item.shot_id for item in self.user_materials}) != len(self.user_materials) or len({item.source_id for item in self.user_materials}) != len(self.user_materials):
            raise ValueError("D08 user materials must have unique shot and source identities")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > GENERATION_FALLBACK_MAX_RESULT_BYTES:
            raise ValueError("D08 input exceeds the size limit")
        return self


class GenerationFallbackResult(GenerationFallbackModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal[GENERATION_FALLBACK_CONTRACT_VERSION] = Field(alias="contractVersion")
    policy_version: Literal[GENERATION_FALLBACK_POLICY_VERSION] = Field(alias="policyVersion")
    runtime_mode: Literal[GENERATION_FALLBACK_RUNTIME_MODE] = Field(alias="runtimeMode")
    project_id: str = Field(alias="projectId")
    timeline_id: str = Field(alias="timelineId")
    assembly_id: str = Field(alias="assemblyId")
    status: Literal["ready", "partial", "blocked"]
    d07_eligible: bool = Field(alias="d07Eligible")
    input_digest: str = Field(alias="inputDigest")
    result_digest: str = Field(alias="resultDigest")
    storyboard: ScriptStoryboardResult
    resolved_storyboard: ScriptStoryboardResult = Field(alias="resolvedStoryboard")
    tts: GenerationFallbackTts
    shots: list[GenerationFallbackShot] = Field(max_length=GENERATION_FALLBACK_MAX_SHOTS)
    d07_diagnostic: GenerationFallbackDiagnostic | None = Field(alias="d07Diagnostic")
    video_assembly_request: VideoAssemblyParams | None = Field(alias="videoAssemblyRequest")

    _project = field_validator("project_id")(lambda value: _uuid(value, "D08 result project id"))
    _identity = field_validator("timeline_id", "assembly_id")(lambda value: _identifier(value, "D08 result identity"))
    _input_digest = field_validator("input_digest", "result_digest")(lambda value: _digest(value, "D08 digest"))

    @model_validator(mode="after")
    def validate_result(self) -> "GenerationFallbackResult":
        if self.storyboard.project_id != self.project_id or self.resolved_storyboard.project_id != self.project_id:
            raise ValueError("D08 result storyboard project binding mismatch")
        if len(self.shots) != len(self.storyboard.shots):
            raise ValueError("D08 result must preserve one resolution per storyboard shot")
        for output, source, resolved in zip(self.shots, self.storyboard.shots, self.resolved_storyboard.shots, strict=True):
            if output.shot_id != source.shot_id or output.segment_id != source.segment_id or output.order != source.order or output.d05_fallback_reason != source.fallback_reason or resolved.segment_id != source.segment_id:
                raise ValueError("D08 shot result does not preserve source identity")
            expected_prefix = source.visual_source_priority[: len(output.attempts)]
            if [attempt.source for attempt in output.attempts] != expected_prefix or len({attempt.source for attempt in output.attempts}) != len(output.attempts):
                raise ValueError("D08 fallback attempts must be a non-looping prefix of the D05 priority")
        if self.d07_eligible != (self.video_assembly_request is not None):
            raise ValueError("D08 D07 eligibility does not match the request binding")
        expected_status = "ready" if self.d07_eligible or self.video_assembly_request is not None else "blocked" if self.tts.status == "fallback" or any(item.status == "unresolved" for item in self.shots) else "partial"
        if self.status != expected_status:
            raise ValueError("D08 result status does not match D07 eligibility and fallback outcomes")
        if self.video_assembly_request is not None:
            if self.video_assembly_request.project_id != self.project_id or self.video_assembly_request.storyboard != self.resolved_storyboard:
                raise ValueError("D08 D07 request is not bound to the resolved storyboard")
        expected_digest = fallback_result_digest(self)
        if self.result_digest != expected_digest:
            raise ValueError("D08 result digest mismatch")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > GENERATION_FALLBACK_MAX_RESULT_BYTES:
            raise ValueError("D08 result exceeds the size limit")
        return self


def fallback_input_digest(params: GenerationFallbackParams) -> str:
    value = {
        "schemaVersion": params.schema_version,
        "contractVersion": params.contract_version,
        "policyVersion": params.policy_version,
        "projectId": params.project_id,
        "timelineId": params.timeline_id,
        "assemblyId": params.assembly_id,
        "storyboardDigest": params.storyboard.source_plan_digest,
        "storyboard": storyboard_digest_projection(params.storyboard),
        "d04Plan": recruitment_plan_digest_projection(params.d04_plan),
        "d03Plan": remotion_plan_digest_projection(params.d03_plan),
        "tts": (
            {"cacheKey": params.tts.cache_key, "durationMs": params.tts.duration_ms, "outputFingerprint": params.tts.output.output_fingerprint}
            if params.tts is not None
            else {"failure": failure_digest(params.tts_failure)}
        ),
        "imageResults": [
            {"shotId": item.shot_id, "cacheKey": item.cache_key, "outputFingerprint": item.output.output_fingerprint}
            for item in sorted(params.image_results, key=lambda item: item.shot_id)
        ],
        "imageFailures": [failure_digest(item) for item in sorted(params.image_failures, key=lambda item: item.shot_id or "")],
        "animationFailures": [failure_digest(item) for item in sorted(params.animation_failures, key=lambda item: item.shot_id or "")],
        "textCardUnavailableShotIds": sorted(params.text_card_unavailable_shot_ids),
        "userMaterials": [
            {"shotId": item.shot_id, "sourceId": item.source_id, "mediaType": item.media_type, "durationMs": item.duration_ms, "fingerprint": item.fingerprint}
            for item in sorted(params.user_materials, key=lambda item: item.shot_id)
        ],
    }
    return hashlib.sha256(_canonical_json(value)).hexdigest()


def fallback_result_digest(result: GenerationFallbackResult) -> str:
    value = {
        "schemaVersion": result.schema_version,
        "contractVersion": result.contract_version,
        "policyVersion": result.policy_version,
        "projectId": result.project_id,
        "timelineId": result.timeline_id,
        "assemblyId": result.assembly_id,
        "status": result.status,
        "d07Eligible": result.d07_eligible,
        "inputDigest": result.input_digest,
        "storyboardDigest": result.storyboard.source_plan_digest,
        "tts": tts_digest(result.tts),
        "shots": [shot_digest(item) for item in result.shots],
        "d07Diagnostic": result.d07_diagnostic.model_dump(by_alias=True) if result.d07_diagnostic is not None else None,
        "resolvedStoryboard": storyboard_digest_projection(result.resolved_storyboard),
        "videoAssemblyRequest": video_assembly_digest_projection(result.video_assembly_request) if result.video_assembly_request is not None else None,
    }
    return hashlib.sha256(_canonical_json(value)).hexdigest()


def storyboard_digest_projection(value: ScriptStoryboardResult) -> dict[str, Any]:
    def segment_projection(segment: Any) -> dict[str, Any]:
        return {
            "segmentId": segment.segment_id,
            "sourceSegmentId": segment.source_segment_id,
            "order": segment.order,
            "role": segment.role,
            "status": segment.status,
            "sentenceId": segment.sentence_id,
            "text": segment.text,
            "source": segment.source.model_dump(by_alias=True, exclude_none=True) if segment.source is not None else None,
            "durationMs": segment.duration_ms,
            "provenanceIds": segment.provenance_ids,
            "factIds": segment.fact_ids,
            "confirmation": segment.confirmation,
        }

    return {
        "schemaVersion": value.schema_version,
        "contractVersion": value.contract_version,
        "plannerVersion": value.planner_version,
        "projectId": value.project_id,
        "sourcePlanDigest": value.source_plan_digest,
        "durationPlanSourceDigest": value.duration_plan_source_digest,
        "targetDurationMs": value.target_duration_ms,
        "toleranceLowerMs": value.tolerance_lower_ms,
        "toleranceUpperMs": value.tolerance_upper_ms,
        "selectedDurationMs": value.selected_duration_ms,
        "durationStatus": value.duration_status,
        "durationPolicy": value.duration_policy,
        "status": value.status,
        "brief": {"theme": value.brief.theme, "audience": value.brief.audience, "objective": value.brief.objective, "language": value.brief.language},
        "forbiddenInferences": value.forbidden_inferences,
        "provenance": [
            {**{"id": item.id, "kind": item.kind, "label": item.label}, **({"sourceSegmentId": item.source_segment_id} if item.source_segment_id is not None else {}), "verified": item.verified}
            for item in value.provenance
        ],
        "facts": [{"factId": item.fact_id, "status": item.status, "provenanceIds": item.provenance_ids, "segmentIds": item.segment_ids} for item in value.facts],
        "script": {"hook": segment_projection(value.script.hook), "body": [segment_projection(item) for item in value.script.body], "cta": segment_projection(value.script.cta)},
        "shots": [
            {"shotId": item.shot_id, "order": item.order, "segmentId": item.segment_id, "durationMs": item.duration_ms, "visualSourcePriority": item.visual_source_priority, "fallbackReason": item.fallback_reason, "visualIntent": item.visual_intent}
            for item in value.shots
        ],
    }


def recruitment_plan_digest_projection(value: RecruitmentTemplateRenderPlan) -> dict[str, Any]:
    return {
        "schemaVersion": value.schema_version,
        "contractVersion": value.contract_version,
        "runtimeMode": value.runtime_mode,
        "projectId": value.project_id,
        "timelineId": value.timeline_id,
        "templateId": value.template_id,
        "templateVersion": value.template_version,
        "canvas": value.canvas,
        "safeArea": value.safe_area,
        "components": [item.model_dump(by_alias=True, exclude_none=True) for item in value.components],
        "sourceIds": value.source_ids,
        "provenanceIds": value.provenance_ids,
        "overlapRule": value.overlap_rule,
    }


def remotion_plan_digest_projection(value: VideoAssemblyRemotionPlan) -> dict[str, Any]:
    return {
        "contractVersion": value.contract_version,
        "renderVersion": value.render_version,
        "runtimeMode": value.runtime_mode,
        "templateId": value.template_id,
        "templateVersion": value.template_version,
        "bundleVersion": value.bundle_version,
        "compositionId": value.composition_id,
    }


def video_assembly_digest_projection(value: VideoAssemblyParams) -> dict[str, Any]:
    projection = value.model_dump(by_alias=True, exclude_none=True)
    projection["storyboard"] = storyboard_digest_projection(value.storyboard)
    projection["userMaterials"] = [
        {"sourceId": item.source_id, "shotId": item.shot_id, "uri": item.uri, "mediaType": item.media_type, **({"durationMs": item.duration_ms} if item.duration_ms is not None else {}), "fingerprint": item.fingerprint, "provenanceId": item.provenance_id}
        for item in value.user_materials
    ]
    return projection


def failure_digest(value: GenerationFallbackFailure | None) -> dict[str, object] | None:
    if value is None:
        return None
    return {"projectId": value.project_id, "component": value.component, "stage": value.stage, "shotId": value.shot_id, "code": value.code, "retryable": value.retryable}


def tts_digest(value: GenerationFallbackTts) -> dict[str, object]:
    return {"status": value.status, "chosenSource": value.chosen_source, "fallbackReason": value.fallback_reason, "d07Binding": value.d07_binding, "failure": failure_digest(value.failure), "provenance": value.provenance, "diagnostic": value.diagnostic.model_dump(by_alias=True) if value.diagnostic is not None else None}


def shot_digest(value: GenerationFallbackShot) -> dict[str, object]:
    return {"shotId": value.shot_id, "order": value.order, "segmentId": value.segment_id, "status": value.status, "chosenSource": value.chosen_source, "fallbackReason": value.fallback_reason, "d05FallbackReason": value.d05_fallback_reason, "d07Binding": value.d07_binding, "attempts": [{"source": item.source, "outcome": item.outcome, "error": item.error.model_dump(by_alias=True) if item.error is not None else None, "provenance": item.provenance} for item in value.attempts], "provenance": value.provenance, "diagnostic": value.diagnostic.model_dump(by_alias=True) if value.diagnostic is not None else None}


def _validate_failures(values: list[GenerationFallbackFailure], project_id: str, shots: dict[str, Any], component: Literal["tts", "image", "animation"]) -> None:
    seen: set[str | None] = set()
    for item in values:
        if item.project_id != project_id or item.component != component:
            raise ValueError("D08 failure project/component binding mismatch")
        if component != "tts" and item.shot_id not in shots:
            raise ValueError("D08 failure references an unknown shot")
        if item.shot_id in seen:
            raise ValueError("D08 failures must be unique per component and shot")
        seen.add(item.shot_id)


def _validate_ids(values: list[str], label: str) -> list[str]:
    if len(values) != len(set(values)) or any(ID_PATTERN.fullmatch(item) is None for item in values):
        raise ValueError(f"invalid {label}")
    return values


def _identifiers(value: list[str], label: str) -> list[str]:
    return _validate_ids(value, label)


def _identifier(value: str, label: str) -> str:
    if ID_PATTERN.fullmatch(value) is None:
        raise ValueError(f"invalid {label}")
    return value


def _uuid(value: str, label: str) -> str:
    if UUID_PATTERN.fullmatch(value) is None:
        raise ValueError(f"invalid {label}")
    return value


def _digest(value: str, label: str) -> str:
    if SHA256_PATTERN.fullmatch(value) is None:
        raise ValueError(f"invalid {label}")
    return value


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


__all__ = [
    "GENERATION_FALLBACK_CONTRACT_VERSION", "GENERATION_FALLBACK_MAX_RESULT_BYTES", "GENERATION_FALLBACK_POLICY_VERSION",
    "GENERATION_FALLBACK_RUNTIME_MODE", "GENERATION_FALLBACK_SCHEMA_VERSION", "GenerationFallbackAttempt",
    "GenerationFallbackDiagnostic", "GenerationFallbackFailure", "GenerationFallbackParams", "GenerationFallbackResult",
    "GenerationFallbackShot", "GenerationFallbackTts", "fallback_input_digest", "fallback_result_digest",
]
