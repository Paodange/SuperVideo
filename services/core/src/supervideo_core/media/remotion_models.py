"""Strict D03 Remotion runtime contracts."""

from __future__ import annotations

import json
import hashlib
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from supervideo_core.timeline.models import TimelineProject, validate_timeline_size

REMOTION_CONTRACT_VERSION = "remotion-runtime-v1"
REMOTION_RENDER_VERSION = "remotion-render-v1"
REMOTION_RESULT_VERSION = "remotion-render-result-v1"
REMOTION_BUNDLE_VERSION = "remotion-bundle-v1"
REMOTION_TEMPLATE_ID = "timeline-preview"
REMOTION_TEMPLATE_VERSION = "timeline-preview-v1"
REMOTION_RUNTIME_MODE = "offline-contract"
REMOTION_JOB_TYPE = "remotion.render"
REMOTION_MAX_INPUT_BYTES = 768 * 1024
REMOTION_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SOURCE_URI_PATTERN = re.compile(r"^supervideo://(?:asset|generated|external)/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?:\?[A-Za-z0-9._=&:-]{0,256})?$")


class RemotionModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class RemotionRenderInputProps(RemotionModel):
    contract_version: Literal[REMOTION_CONTRACT_VERSION] = Field(alias="contractVersion")
    project_id: str = Field(alias="projectId")
    template_id: Literal[REMOTION_TEMPLATE_ID] = Field(alias="templateId")
    template_version: Literal[REMOTION_TEMPLATE_VERSION] = Field(alias="templateVersion")
    bundle_version: Literal[REMOTION_BUNDLE_VERSION] = Field(alias="bundleVersion")
    timeline: TimelineProject

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid project id")
        return value

    @model_validator(mode="after")
    def validate_runtime_timeline(self) -> "RemotionRenderInputProps":
        validate_timeline_size(self.timeline)
        _reject_forbidden_keys(self.timeline.model_dump(by_alias=True))
        for source in self.timeline.sources:
            if SOURCE_URI_PATTERN.fullmatch(source.uri) is None:
                raise ValueError("Timeline source URI is not a controlled SuperVideo reference")
        for provenance in self.timeline.provenance:
            if provenance.uri is not None and SOURCE_URI_PATTERN.fullmatch(provenance.uri) is None:
                raise ValueError("Timeline provenance URI is not a controlled SuperVideo reference")
        if _encoded_size(self.model_dump(by_alias=True)) > REMOTION_MAX_INPUT_BYTES:
            raise ValueError("Remotion input props exceed the size limit")
        return self


class RemotionRenderParams(RemotionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    render_version: Literal[REMOTION_RENDER_VERSION] = Field(alias="renderVersion")
    project_id: str = Field(alias="projectId")
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=256)
    input_props: RemotionRenderInputProps = Field(alias="inputProps")

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid project id")
        return value

    @model_validator(mode="after")
    def validate_project_binding(self) -> "RemotionRenderParams":
        if self.input_props.project_id != self.project_id:
            raise ValueError("inputProps projectId must match projectId")
        return self


class RemotionRenderOutput(RemotionModel):
    artifact_kind: Literal["render-contract"] = Field(alias="artifactKind")
    relative_path: str = Field(alias="relativePath", min_length=1, max_length=512)
    manifest_path: str = Field(alias="manifestPath", min_length=1, max_length=512)
    size_bytes: int = Field(alias="sizeBytes", strict=True, ge=1, le=REMOTION_MAX_OUTPUT_BYTES)
    sha256: str

    @field_validator("sha256")
    @classmethod
    def validate_sha256(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid output SHA-256")
        return value

    @model_validator(mode="after")
    def validate_paths(self) -> "RemotionRenderOutput":
        for value in (self.relative_path, self.manifest_path):
            if not re.fullmatch(r"^(?:generated/remotion-v1|exports/remotion-v1)/[A-Za-z0-9._/-]+$", value) or ".." in value.split("/") or "\\" in value:
                raise ValueError("Remotion output path is outside the controlled boundary")
        return self


class RemotionPlayerContract(RemotionModel):
    availability: Literal["contract-only"]
    composition_id: Literal["timeline-preview-v1"] = Field(alias="compositionId")
    playback_uri: str = Field(alias="playbackUri", min_length=1, max_length=256)

    @field_validator("playback_uri")
    @classmethod
    def validate_playback_uri(cls, value: str) -> str:
        if re.fullmatch(r"supervideo://remotion/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{64}", value) is None:
            raise ValueError("invalid Remotion playback URI")
        return value


class RemotionRenderResult(RemotionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    result_version: Literal[REMOTION_RESULT_VERSION] = Field(alias="resultVersion")
    project_id: str = Field(alias="projectId")
    runtime_mode: Literal[REMOTION_RUNTIME_MODE] = Field(alias="runtimeMode")
    template_id: Literal[REMOTION_TEMPLATE_ID] = Field(alias="templateId")
    template_version: Literal[REMOTION_TEMPLATE_VERSION] = Field(alias="templateVersion")
    bundle_version: Literal[REMOTION_BUNDLE_VERSION] = Field(alias="bundleVersion")
    cache_status: Literal["created", "cache-hit"] = Field(alias="cacheStatus")
    cache_key: str = Field(alias="cacheKey")
    bundle_cache_key: str = Field(alias="bundleCacheKey")
    timeline_digest: str = Field(alias="timelineDigest")
    output: RemotionRenderOutput
    player: RemotionPlayerContract

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid project id")
        return value

    @field_validator("cache_key", "bundle_cache_key", "timeline_digest")
    @classmethod
    def validate_digests(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid Remotion digest")
        return value

    @model_validator(mode="after")
    def validate_player_uri(self) -> "RemotionRenderResult":
        expected = f"supervideo://remotion/{self.project_id}/{self.cache_key}"
        if self.player.playback_uri != expected:
            raise ValueError("player playback URI does not match render cache")
        expected_output = f"generated/remotion-v1/renders/{self.cache_key}.json"
        expected_manifest = f"generated/remotion-v1/renders/{self.cache_key}.manifest.json"
        if self.output.relative_path != expected_output or self.output.manifest_path != expected_manifest:
            raise ValueError("Remotion output paths do not match render cache")
        return self


def compute_remotion_timeline_digest(params: RemotionRenderParams) -> str:
    timeline = params.input_props.timeline.model_dump(by_alias=True, exclude_none=True)
    return hashlib.sha256(_canonical_json(timeline)).hexdigest()


def compute_remotion_cache_key(params: RemotionRenderParams) -> str:
    timeline_digest = compute_remotion_timeline_digest(params)
    value = {
        "contractVersion": params.input_props.contract_version,
        "renderVersion": REMOTION_RENDER_VERSION,
        "projectId": params.project_id,
        "templateId": REMOTION_TEMPLATE_ID,
        "templateVersion": REMOTION_TEMPLATE_VERSION,
        "bundleVersion": REMOTION_BUNDLE_VERSION,
        "timelineDigest": timeline_digest,
    }
    return hashlib.sha256(_canonical_json(value)).hexdigest()


def _encoded_size(value: object) -> int:
    return len(_canonical_json(value))


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _reject_forbidden_keys(value: Any, depth: int = 0) -> None:
    if depth > 16:
        raise ValueError("Remotion input nesting is too deep")
    if isinstance(value, dict):
        for key, item in value.items():
            if re.search(r"secret|credential|token|password|command|executable|rendererpath", str(key), re.IGNORECASE):
                raise ValueError("secret or executable fields are not allowed in Remotion input")
            _reject_forbidden_keys(item, depth + 1)
    elif isinstance(value, list):
        if len(value) > 2_048:
            raise ValueError("Remotion input array is too large")
        for item in value:
            _reject_forbidden_keys(item, depth + 1)


__all__ = [
    "REMOTION_BUNDLE_VERSION", "REMOTION_CONTRACT_VERSION", "REMOTION_JOB_TYPE", "REMOTION_MAX_INPUT_BYTES", "REMOTION_MAX_OUTPUT_BYTES",
    "REMOTION_RENDER_VERSION", "REMOTION_RESULT_VERSION", "REMOTION_RUNTIME_MODE", "REMOTION_TEMPLATE_ID", "REMOTION_TEMPLATE_VERSION",
    "RemotionRenderInputProps", "RemotionRenderParams", "RemotionRenderOutput", "RemotionRenderResult",
    "compute_remotion_cache_key", "compute_remotion_timeline_digest",
]
