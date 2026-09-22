"""Strict cross-process D07 generated-video assembly contracts."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from supervideo_core.media.image_models import ImageGenerationResult
from supervideo_core.media.recruitment_template_models import RecruitmentTemplateRenderPlan
from supervideo_core.media.script_storyboard_models import ScriptStoryboardResult
from supervideo_core.media.tts_models import TtsSynthesisResult
from supervideo_core.timeline.models import TimelineProject, validate_timeline_size

VIDEO_ASSEMBLY_SCHEMA_VERSION = 1
VIDEO_ASSEMBLY_CONTRACT_VERSION = "video-assembly-v1"
VIDEO_ASSEMBLY_RUNTIME_MODE = "offline-deterministic"
VIDEO_ASSEMBLY_MAX_DURATION_MS = 60_000
VIDEO_ASSEMBLY_MAX_SHOTS = 32
VIDEO_ASSEMBLY_MAX_MATERIALS = 32
VIDEO_ASSEMBLY_MAX_INPUT_BYTES = 768 * 1024
VIDEO_ASSEMBLY_MAX_RESULT_BYTES = 768 * 1024
VIDEO_ASSEMBLY_OUTPUT_PATTERN = re.compile(r"^generated/video-assembly-v1/[0-9a-f]{64}\.json$")
VIDEO_ASSEMBLY_USER_URI_PATTERN = re.compile(r"^supervideo://asset/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
VIDEO_ASSEMBLY_CONTROLLED_URI_PATTERN = re.compile(r"^supervideo://(?:asset|generated|external)/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?:\?[A-Za-z0-9._=&:-]{0,256})?$")
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
FORBIDDEN_KEYS = frozenset({"secret", "credential", "credentialref", "token", "command", "executable", "authorization", "password", "apikey", "provider"})


class VideoAssemblyModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class VideoAssemblyRemotionPlan(VideoAssemblyModel):
    contract_version: Literal["remotion-runtime-v1"] = Field(alias="contractVersion")
    render_version: Literal["remotion-render-v1"] = Field(alias="renderVersion")
    runtime_mode: Literal["offline-contract"] = Field(alias="runtimeMode")
    template_id: Literal["timeline-preview"] = Field(alias="templateId")
    template_version: Literal["timeline-preview-v1"] = Field(alias="templateVersion")
    bundle_version: Literal["remotion-bundle-v1"] = Field(alias="bundleVersion")
    composition_id: Literal["timeline-preview-v1"] = Field(alias="compositionId")


class VideoAssemblyUserMaterial(VideoAssemblyModel):
    source_id: str = Field(alias="sourceId")
    shot_id: str = Field(alias="shotId")
    uri: str = Field(min_length=1, max_length=256)
    media_type: Literal["video", "image"] = Field(alias="mediaType")
    duration_ms: int | None = Field(default=None, alias="durationMs", strict=True, ge=1, le=VIDEO_ASSEMBLY_MAX_DURATION_MS)
    fingerprint: str = Field(min_length=64, max_length=64)
    provenance_id: str = Field(alias="provenanceId")

    @field_validator("source_id", "shot_id", "provenance_id")
    @classmethod
    def validate_ids(cls, value: str) -> str:
        if ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid D07 material identifier")
        return value

    @field_validator("uri")
    @classmethod
    def validate_uri(cls, value: str) -> str:
        if VIDEO_ASSEMBLY_USER_URI_PATTERN.fullmatch(value) is None:
            raise ValueError("user material URI must be a controlled asset reference")
        return value

    @field_validator("fingerprint")
    @classmethod
    def validate_fingerprint(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid user material fingerprint")
        return value

    @model_validator(mode="after")
    def validate_binding(self) -> "VideoAssemblyUserMaterial":
        if self.uri != f"supervideo://asset/{self.source_id}":
            raise ValueError("user material URI must match sourceId")
        if self.media_type == "video" and self.duration_ms is None:
            raise ValueError("video material requires durationMs")
        return self


class VideoAssemblyParams(VideoAssemblyModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal[VIDEO_ASSEMBLY_CONTRACT_VERSION] = Field(alias="contractVersion")
    runtime_mode: Literal[VIDEO_ASSEMBLY_RUNTIME_MODE] = Field(alias="runtimeMode")
    project_id: str = Field(alias="projectId")
    timeline_id: str = Field(alias="timelineId")
    assembly_id: str = Field(alias="assemblyId")
    storyboard: ScriptStoryboardResult
    tts: TtsSynthesisResult
    image_results: list[ImageGenerationResult] = Field(alias="imageResults", max_length=VIDEO_ASSEMBLY_MAX_SHOTS)
    d04_plan: RecruitmentTemplateRenderPlan = Field(alias="d04Plan")
    d03_plan: VideoAssemblyRemotionPlan = Field(alias="d03Plan")
    user_materials: list[VideoAssemblyUserMaterial] = Field(default_factory=list, alias="userMaterials", max_length=VIDEO_ASSEMBLY_MAX_MATERIALS)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid D07 project id")
        return value

    @field_validator("timeline_id", "assembly_id")
    @classmethod
    def validate_timeline_ids(cls, value: str) -> str:
        if ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid D07 timeline or assembly id")
        return value

    @model_validator(mode="after")
    def validate_bounded_input(self) -> "VideoAssemblyParams":
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > VIDEO_ASSEMBLY_MAX_INPUT_BYTES:
            raise ValueError("D07 input exceeds the size limit")
        return self


class VideoAssemblyPreview(VideoAssemblyModel):
    availability: Literal["contract-only"]
    composition_id: Literal["timeline-preview-v1"] = Field(alias="compositionId")
    playback_uri: str = Field(alias="playbackUri", min_length=1, max_length=256)
    timeline_digest: str = Field(alias="timelineDigest")


class VideoAssemblyImageCacheKey(VideoAssemblyModel):
    shot_id: str = Field(alias="shotId")
    cache_key: str = Field(alias="cacheKey")

    _shot_id = field_validator("shot_id")(lambda value: _identifier(value, "imageCacheKeys.shotId"))
    _cache_key = field_validator("cache_key")(lambda value: _digest(value, "imageCacheKeys.cacheKey"))


class VideoAssemblyProvenanceSummary(VideoAssemblyModel):
    storyboard_source_plan_digest: str = Field(alias="storyboardSourcePlanDigest")
    tts_cache_key: str = Field(alias="ttsCacheKey")
    image_cache_keys: list[VideoAssemblyImageCacheKey] = Field(alias="imageCacheKeys", max_length=VIDEO_ASSEMBLY_MAX_SHOTS)
    user_material_source_ids: list[str] = Field(alias="userMaterialSourceIds", max_length=VIDEO_ASSEMBLY_MAX_MATERIALS)

    _storyboard_digest = field_validator("storyboard_source_plan_digest")(lambda value: _digest(value, "provenance.storyboardSourcePlanDigest"))
    _tts_digest = field_validator("tts_cache_key")(lambda value: _digest(value, "provenance.ttsCacheKey"))

    @field_validator("user_material_source_ids")
    @classmethod
    def validate_source_ids(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or any(ID_PATTERN.fullmatch(item) is None for item in value):
            raise ValueError("userMaterialSourceIds must be unique bounded identifiers")
        return value


class VideoAssemblyOutput(VideoAssemblyModel):
    kind: Literal["timeline-ir"]
    relative_path: str = Field(alias="relativePath")
    duration_ms: int = Field(alias="durationMs", strict=True, ge=1, le=VIDEO_ASSEMBLY_MAX_DURATION_MS)
    digest: str

    @field_validator("relative_path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        if VIDEO_ASSEMBLY_OUTPUT_PATTERN.fullmatch(value) is None:
            raise ValueError("D07 output must be a project-relative plan reference")
        return value

    _digest = field_validator("digest")(lambda value: _digest(value, "output.digest"))


class VideoAssemblyResult(VideoAssemblyModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal[VIDEO_ASSEMBLY_CONTRACT_VERSION] = Field(alias="contractVersion")
    runtime_mode: Literal[VIDEO_ASSEMBLY_RUNTIME_MODE] = Field(alias="runtimeMode")
    project_id: str = Field(alias="projectId")
    timeline_id: str = Field(alias="timelineId")
    assembly_id: str = Field(alias="assemblyId")
    status: Literal["assembled"]
    content_status: Literal["ready", "needs-user-confirmation"] = Field(alias="contentStatus")
    duration_ms: int = Field(alias="durationMs", strict=True, ge=1, le=VIDEO_ASSEMBLY_MAX_DURATION_MS)
    timeline_digest: str = Field(alias="timelineDigest")
    output: VideoAssemblyOutput
    preview: VideoAssemblyPreview
    provenance: VideoAssemblyProvenanceSummary
    timeline: TimelineProject

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid D07 result project id")
        return value

    @field_validator("timeline_id", "assembly_id")
    @classmethod
    def validate_result_ids(cls, value: str) -> str:
        return _identifier(value, "D07 result identity")

    _timeline_digest = field_validator("timeline_digest")(lambda value: _digest(value, "timelineDigest"))

    @model_validator(mode="after")
    def validate_result_binding(self) -> "VideoAssemblyResult":
        _reject_forbidden(self.model_dump(by_alias=True, exclude_none=True), "$")
        validate_timeline_size(self.timeline)
        expected_digest = hashlib.sha256(_canonical_json(self.timeline.model_dump(by_alias=True, exclude_none=True))).hexdigest()
        if expected_digest != self.timeline_digest:
            raise ValueError("D07 timeline digest does not match the canonical Timeline IR")
        if self.timeline.id != self.timeline_id or self.timeline.duration_ms != self.duration_ms:
            raise ValueError("D07 result timeline identity or duration does not match")
        if self.output.duration_ms != self.duration_ms or self.output.digest != self.timeline_digest or self.output.relative_path != f"generated/video-assembly-v1/{self.timeline_digest}.json":
            raise ValueError("D07 output does not match timeline digest")
        if self.preview.timeline_digest != self.timeline_digest or self.preview.playback_uri != f"supervideo://remotion/{self.project_id}/{self.timeline_digest}":
            raise ValueError("D07 preview seam does not match timeline digest")
        for source in self.timeline.sources:
            _validate_controlled_uri(source.uri, "timeline source URI")
        for provenance in self.timeline.provenance:
            if provenance.uri is not None:
                _validate_controlled_uri(provenance.uri, "timeline provenance URI")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > VIDEO_ASSEMBLY_MAX_RESULT_BYTES:
            raise ValueError("D07 result exceeds the size limit")
        return self


def _identifier(value: str, path: str) -> str:
    if ID_PATTERN.fullmatch(value) is None:
        raise ValueError(f"invalid identifier at {path}")
    return value


def _digest(value: str, path: str) -> str:
    if SHA256_PATTERN.fullmatch(value) is None:
        raise ValueError(f"invalid SHA-256 digest at {path}")
    return value


def _validate_controlled_uri(value: str, path: str) -> None:
    if ".." in value or "\\" in value or VIDEO_ASSEMBLY_CONTROLLED_URI_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{path} must be a controlled project reference")


def _reject_forbidden(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key).lower().replace("_", "").replace("-", "")
            if normalized in FORBIDDEN_KEYS:
                raise ValueError(f"forbidden sensitive or executable field at {path}.{key}")
            _reject_forbidden(item, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _reject_forbidden(item, f"{path}[{index}]")


def _canonical_json(value: Any) -> bytes:
    return json.dumps(_normalize_numbers(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _normalize_numbers(value: Any) -> Any:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: _normalize_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalize_numbers(item) for item in value]
    return value


__all__ = [
    "VIDEO_ASSEMBLY_CONTRACT_VERSION", "VIDEO_ASSEMBLY_MAX_DURATION_MS", "VIDEO_ASSEMBLY_MAX_INPUT_BYTES",
    "VIDEO_ASSEMBLY_MAX_RESULT_BYTES", "VIDEO_ASSEMBLY_MAX_SHOTS", "VIDEO_ASSEMBLY_RUNTIME_MODE",
    "VIDEO_ASSEMBLY_SCHEMA_VERSION", "VideoAssemblyImageCacheKey", "VideoAssemblyParams",
    "VideoAssemblyPreview", "VideoAssemblyProvenanceSummary", "VideoAssemblyRemotionPlan",
    "VideoAssemblyResult", "VideoAssemblyOutput", "VideoAssemblyUserMaterial",
]
