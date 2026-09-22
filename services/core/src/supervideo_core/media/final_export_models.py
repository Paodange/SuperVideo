"""Versioned C08 final MP4 export contracts."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from .preview_render_models import PreviewRenderModel, PreviewRenderResult
from .quality_check_models import PreviewQualityCheckResult

FINAL_EXPORT_SCHEMA_VERSION = 1
FINAL_EXPORT_VERSION = "final-mp4-export-v1"
FINAL_EXPORT_POLICY = "verified-preview-copy-v1"
FINAL_EXPORT_MAX_INPUT_BYTES = 512 * 1024
FINAL_EXPORT_MAX_RESULT_BYTES = 64 * 1024
FINAL_EXPORT_MAX_MANIFEST_BYTES = 32 * 1024
FINAL_EXPORT_MAX_OUTPUT_BYTES = 512 * 1024 * 1024
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
OUTPUT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.mp4$")
FINAL_OUTPUT_PATTERN = re.compile(r"^exports/videos/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.mp4$")
FINAL_MANIFEST_PATTERN = re.compile(r"^exports/videos/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.manifest\.json$")


class FinalExportModel(PreviewRenderModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class FinalMp4ExportParams(FinalExportModel):
    project_id: str = Field(alias="projectId")
    preview_result: PreviewRenderResult = Field(alias="previewResult")
    quality_result: PreviewQualityCheckResult = Field(alias="qualityResult")
    output_name: str | None = Field(default=None, alias="outputName")
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid final export project id")
        return value

    @field_validator("output_name")
    @classmethod
    def validate_output_name(cls, value: str | None) -> str | None:
        if value is not None and OUTPUT_NAME_PATTERN.fullmatch(value) is None:
            raise ValueError("final export name must be a single safe mp4 filename")
        return value

    @model_validator(mode="after")
    def validate_input(self) -> "FinalMp4ExportParams":
        if self.preview_result.project_id != self.project_id or self.quality_result.project_id != self.project_id:
            raise ValueError("final export inputs belong to another project")
        if self.quality_result.plan_digest != self.preview_result.plan_digest:
            raise ValueError("final export quality result belongs to another plan")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > FINAL_EXPORT_MAX_INPUT_BYTES:
            raise ValueError("final export input is too large")
        return self


class FinalMp4Container(FinalExportModel):
    format_name: str = Field(alias="formatName", min_length=1, max_length=128)
    video_codec: str = Field(alias="videoCodec", min_length=1, max_length=64)
    audio_codec: str | None = Field(default=None, alias="audioCodec", max_length=64)
    width: int = Field(strict=True, ge=1, le=100_000)
    height: int = Field(strict=True, ge=1, le=100_000)
    frame_rate: float | None = Field(default=None, alias="frameRate", strict=True, ge=0, le=1_000)


class FinalMp4Output(FinalExportModel):
    kind: Literal["video"]
    relative_path: str = Field(alias="relativePath", min_length=1, max_length=512)
    manifest_relative_path: str = Field(alias="manifestRelativePath", min_length=1, max_length=512)
    size_bytes: int = Field(alias="sizeBytes", strict=True, gt=0, le=FINAL_EXPORT_MAX_OUTPUT_BYTES)
    duration_ms: int = Field(alias="durationMs", strict=True, gt=0, le=86_400_000)
    output_fingerprint: str = Field(alias="outputFingerprint", min_length=64, max_length=64)
    container: FinalMp4Container

    @field_validator("relative_path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        if FINAL_OUTPUT_PATTERN.fullmatch(value) is None:
            raise ValueError("final output path is outside the export boundary")
        return value

    @field_validator("manifest_relative_path")
    @classmethod
    def validate_manifest_relative_path(cls, value: str) -> str:
        if FINAL_MANIFEST_PATTERN.fullmatch(value) is None:
            raise ValueError("final manifest path is outside the export boundary")
        return value

    @field_validator("output_fingerprint")
    @classmethod
    def validate_output_fingerprint(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid final output fingerprint")
        return value

    @model_validator(mode="after")
    def validate_paths(self) -> "FinalMp4Output":
        expected = self.relative_path.removesuffix(".mp4") + ".manifest.json"
        if self.manifest_relative_path != expected:
            raise ValueError("final manifest path does not match output path")
        return self


class FinalMp4Manifest(FinalExportModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    export_version: Literal["final-mp4-export-v1"] = Field(alias="exportVersion")
    export_policy: Literal["verified-preview-copy-v1"] = Field(alias="exportPolicy")
    status: Literal["completed"]
    project_id: str = Field(alias="projectId")
    timeline_id: str = Field(alias="timelineId", min_length=1, max_length=128)
    plan_digest: str = Field(alias="planDigest", min_length=64, max_length=64)
    preview_output_fingerprint: str = Field(alias="previewOutputFingerprint", min_length=64, max_length=64)
    quality_version: Literal["preview-quality-v1"] = Field(alias="qualityVersion")
    quality_digest: str = Field(alias="qualityDigest", min_length=64, max_length=64)
    quality_status: Literal["pass"] = Field(alias="qualityStatus")
    relative_path: str = Field(alias="relativePath")
    manifest_relative_path: str = Field(alias="manifestRelativePath")
    size_bytes: int = Field(alias="sizeBytes", strict=True, gt=0, le=FINAL_EXPORT_MAX_OUTPUT_BYTES)
    duration_ms: int = Field(alias="durationMs", strict=True, gt=0, le=86_400_000)
    output_fingerprint: str = Field(alias="outputFingerprint", min_length=64, max_length=64)
    container: FinalMp4Container

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid final manifest project id")
        return value

    @field_validator("plan_digest", "preview_output_fingerprint", "quality_digest", "output_fingerprint")
    @classmethod
    def validate_digest(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid final manifest digest")
        return value

    @model_validator(mode="after")
    def validate_manifest_paths(self) -> "FinalMp4Manifest":
        if FINAL_OUTPUT_PATTERN.fullmatch(self.relative_path) is None or FINAL_MANIFEST_PATTERN.fullmatch(self.manifest_relative_path) is None:
            raise ValueError("final manifest path is outside the export boundary")
        if self.manifest_relative_path != self.relative_path.removesuffix(".mp4") + ".manifest.json":
            raise ValueError("final manifest path does not match output path")
        return self


class FinalMp4ExportResult(FinalExportModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    export_version: Literal["final-mp4-export-v1"] = Field(alias="exportVersion")
    export_policy: Literal["verified-preview-copy-v1"] = Field(alias="exportPolicy")
    project_id: str = Field(alias="projectId")
    timeline_id: str = Field(alias="timelineId", min_length=1, max_length=128)
    plan_digest: str = Field(alias="planDigest", min_length=64, max_length=64)
    quality_digest: str = Field(alias="qualityDigest", min_length=64, max_length=64)
    status: Literal["completed", "cache-hit"]
    output: FinalMp4Output

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid final export result project id")
        return value

    @field_validator("plan_digest", "quality_digest")
    @classmethod
    def validate_digest(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid final export digest")
        return value


def validate_final_export_size(result: FinalMp4ExportResult) -> FinalMp4ExportResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > FINAL_EXPORT_MAX_RESULT_BYTES:
        raise ValueError("final export result is too large")
    return result
