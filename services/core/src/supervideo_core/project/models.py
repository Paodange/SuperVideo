"""Strict request and bounded response models for project RPC methods."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from supervideo_core.storage.models import STORAGE_DEFAULT_LIST_LIMIT, STORAGE_MAX_LIST_LIMIT


MAX_ASSET_REFERENCE_BATCH = 100


class ProjectRequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ProjectCreateRequest(ProjectRequestModel):
    name: str = Field(min_length=1, max_length=200)
    target_platform: str = Field(default="douyin", alias="targetPlatform", min_length=1, max_length=64)
    project_root: str = Field(alias="projectRoot", min_length=1, max_length=32_767)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("project name is invalid")
        return value

    @field_validator("target_platform")
    @classmethod
    def validate_target_platform(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("target platform is invalid")
        return value

    @field_validator("project_root")
    @classmethod
    def validate_project_root(cls, value: str) -> str:
        if "\x00" in value or not _is_absolute_path(value):
            raise ValueError("project root must be absolute")
        return value


class ProjectOpenRequest(ProjectRequestModel):
    project_root: str = Field(alias="projectRoot", min_length=1, max_length=32_767)

    @field_validator("project_root")
    @classmethod
    def validate_project_root(cls, value: str) -> str:
        if "\x00" in value or not _is_absolute_path(value):
            raise ValueError("project root must be absolute")
        return value


class ProjectInspectRequest(ProjectOpenRequest):
    pass


class AssetReferenceRequest(ProjectRequestModel):
    project_id: str = Field(alias="projectId")
    paths: list[str] = Field(min_length=1, max_length=MAX_ASSET_REFERENCE_BATCH)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if not _UUID_PATTERN.fullmatch(value):
            raise ValueError("project id must be a UUID")
        return value

    @field_validator("paths")
    @classmethod
    def validate_paths(cls, value: list[str]) -> list[str]:
        if any("\x00" in path or not _is_absolute_path(path) for path in value):
            raise ValueError("asset paths must be absolute")
        return value


class AssetScanRequest(ProjectRequestModel):
    project_id: str = Field(alias="projectId")
    directory: str = Field(min_length=1, max_length=32_767)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if not _UUID_PATTERN.fullmatch(value):
            raise ValueError("project id must be a UUID")
        return value

    @field_validator("directory")
    @classmethod
    def validate_directory(cls, value: str) -> str:
        if "\x00" in value or not _is_absolute_path(value):
            raise ValueError("asset scan directory must be absolute")
        return value


class AssetListRequest(ProjectRequestModel):
    project_id: str = Field(alias="projectId")
    limit: int = Field(default=STORAGE_DEFAULT_LIST_LIMIT, strict=True, ge=1, le=STORAGE_MAX_LIST_LIMIT)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if not _UUID_PATTERN.fullmatch(value):
            raise ValueError("project id must be a UUID")
        return value


class ProjectSummary(ProjectRequestModel):
    project_id: str = Field(alias="projectId")
    name: str
    target_platform: str = Field(alias="targetPlatform")
    project_root: str = Field(alias="projectRoot")
    manifest_schema_version: int = Field(alias="manifestSchemaVersion", strict=True)
    database_schema_version: int = Field(alias="databaseSchemaVersion", strict=True)
    asset_count: int = Field(alias="assetCount", strict=True, ge=0)
    created_at_ms: int = Field(alias="createdAtMs", strict=True, ge=0)
    updated_at_ms: int = Field(alias="updatedAtMs", strict=True, ge=0)


class AssetSummary(ProjectRequestModel):
    asset_id: str = Field(alias="assetId")
    project_id: str = Field(alias="projectId")
    file_name: str = Field(alias="fileName")
    absolute_path: str = Field(alias="absolutePath")
    kind: str
    size_bytes: int = Field(alias="sizeBytes", strict=True, ge=0)
    modified_at_ms: int = Field(alias="modifiedAtMs", strict=True, ge=0)
    fingerprint_algorithm: str = Field(alias="fingerprintAlgorithm")
    reference_status: Literal["added", "existing"] = Field(alias="referenceStatus")


class AssetReferenceBatchResult(ProjectRequestModel):
    project_id: str = Field(alias="projectId")
    items: list[AssetSummary] = Field(max_length=MAX_ASSET_REFERENCE_BATCH)


class AssetScanResult(ProjectRequestModel):
    project_id: str = Field(alias="projectId")
    directory: str
    items: list[AssetSummary] = Field(max_length=MAX_ASSET_REFERENCE_BATCH)


class AssetListResult(ProjectRequestModel):
    project_id: str = Field(alias="projectId")
    items: list[AssetSummary] = Field(max_length=STORAGE_MAX_LIST_LIMIT)


def _is_absolute_path(value: str) -> bool:
    return bool(re.match(r"^(?:[A-Za-z]:[\\/]|[\\\\/])", value))


_UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
