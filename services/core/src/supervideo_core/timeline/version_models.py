"""Versioned C10 Timeline persistence and RPC contracts."""

from __future__ import annotations

import json
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from supervideo_core.media.edit_models import EditIntent, TimelineEditResult
from supervideo_core.timeline.models import ID_PATTERN, TimelineProject

C10_VERSION_SCHEMA_VERSION = 1
C10_VERSION = "timeline-version-v1"
C10_MAX_LIST_LIMIT = 100
C10_MAX_DIFF_ITEMS = 64
C10_MAX_DIFF_BYTES = 16 * 1024
C10_MAX_TIMELINE_BYTES = 220 * 1024
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class VersionModel(BaseModel):
    """Use the same strict/alias configuration as the other Core contracts."""

    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


def _uuid(value: str) -> str:
    if UUID_PATTERN.fullmatch(value) is None:
        raise ValueError("invalid UUID")
    return value


def _optional_uuid(value: str | None) -> str | None:
    return None if value is None else _uuid(value)


def _timeline_identifier(value: str) -> str:
    if ID_PATTERN.fullmatch(value) is None:
        raise ValueError("invalid timeline identifier")
    return value


def _timeline_size(value: TimelineProject) -> TimelineProject:
    if len(value.model_dump_json(by_alias=True).encode("utf-8")) > C10_MAX_TIMELINE_BYTES:
        raise ValueError("timeline is too large for C10 RPC")
    return value


class TimelineVersionCreateParams(VersionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    versioning_version: Literal["timeline-version-v1"] = Field(alias="versioningVersion")
    project_id: str = Field(alias="projectId")
    timeline: TimelineProject
    expected_active_version_id: str | None = Field(default=None, alias="expectedActiveVersionId")
    idempotency_key: str | None = Field(default=None, alias="idempotencyKey", min_length=1, max_length=128)

    _project = field_validator("project_id")(_uuid)
    _expected = field_validator("expected_active_version_id")(_uuid)
    _timeline = field_validator("timeline")(_timeline_size)


class TimelineVersionListParams(VersionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    versioning_version: Literal["timeline-version-v1"] = Field(alias="versioningVersion")
    project_id: str = Field(alias="projectId")
    limit: int = Field(default=50, strict=True, ge=1, le=C10_MAX_LIST_LIMIT)

    _project = field_validator("project_id")(_uuid)


class TimelineVersionReferenceParams(VersionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    versioning_version: Literal["timeline-version-v1"] = Field(alias="versioningVersion")
    project_id: str = Field(alias="projectId")
    version_id: str = Field(alias="versionId")

    _project = field_validator("project_id")(_uuid)
    _version = field_validator("version_id")(_uuid)


class TimelineVersionActivateParams(TimelineVersionReferenceParams):
    expected_active_version_id: str | None = Field(default=None, alias="expectedActiveVersionId")

    _expected = field_validator("expected_active_version_id")(_uuid)


class TimelineVersionUndoParams(VersionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    versioning_version: Literal["timeline-version-v1"] = Field(alias="versioningVersion")
    project_id: str = Field(alias="projectId")
    expected_active_version_id: str | None = Field(default=None, alias="expectedActiveVersionId")

    _project = field_validator("project_id")(_uuid)
    _expected = field_validator("expected_active_version_id")(_uuid)


class TimelineVersionRedoParams(TimelineVersionUndoParams):
    version_id: str | None = Field(default=None, alias="versionId")

    _version = field_validator("version_id")(_uuid)


class TimelineVersionApplyEditParams(VersionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    versioning_version: Literal["timeline-version-v1"] = Field(alias="versioningVersion")
    project_id: str = Field(alias="projectId")
    source_version_id: str | None = Field(default=None, alias="sourceVersionId")
    expected_active_version_id: str | None = Field(default=None, alias="expectedActiveVersionId")
    instruction: str | None = Field(default=None, min_length=1, max_length=2_048)
    intent: EditIntent | None = None
    idempotency_key: str | None = Field(default=None, alias="idempotencyKey", min_length=1, max_length=128)

    _project = field_validator("project_id")(_uuid)
    _source = field_validator("source_version_id")(_uuid)
    _expected = field_validator("expected_active_version_id")(_uuid)

    @field_validator("instruction")
    @classmethod
    def validate_instruction(cls, value: str | None) -> str | None:
        if value is not None and any(ord(character) < 32 and character not in "\t\n\r" for character in value):
            raise ValueError("instruction contains a control character")
        return value

    @model_validator(mode="after")
    def exactly_one_edit_input(self) -> "TimelineVersionApplyEditParams":
        if (self.instruction is None) == (self.intent is None):
            raise ValueError("provide exactly one of instruction or intent")
        return self


class TimelineVersionDiffParams(VersionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    versioning_version: Literal["timeline-version-v1"] = Field(alias="versioningVersion")
    project_id: str = Field(alias="projectId")
    from_version_id: str = Field(alias="fromVersionId")
    to_version_id: str = Field(alias="toVersionId")

    _project = field_validator("project_id")(_uuid)
    _from = field_validator("from_version_id")(_uuid)
    _to = field_validator("to_version_id")(_uuid)


class TimelineVersionSnapshot(VersionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    versioning_version: Literal["timeline-version-v1"] = Field(alias="versioningVersion")
    project_id: str = Field(alias="projectId")
    version_id: str = Field(alias="versionId")
    timeline_id: str = Field(alias="timelineId")
    version_number: int = Field(alias="versionNumber", strict=True, ge=1)
    parent_version_id: str | None = Field(default=None, alias="parentVersionId")
    source_type: Literal["root", "edit"] = Field(alias="sourceType")
    created_at_ms: int = Field(alias="createdAtMs", strict=True, ge=0)
    is_active: bool = Field(alias="isActive")
    edit_intent: dict[str, Any] = Field(default_factory=dict, alias="editIntent")
    diff_summary: dict[str, Any] = Field(default_factory=dict, alias="diffSummary")
    timeline: TimelineProject

    _project = field_validator("project_id")(_uuid)
    _version = field_validator("version_id")(_uuid)
    _timeline_id = field_validator("timeline_id")(_timeline_identifier)
    _parent = field_validator("parent_version_id")(_optional_uuid)
    _timeline = field_validator("timeline")(_timeline_size)


class TimelineVersionListResult(VersionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    versioning_version: Literal["timeline-version-v1"] = Field(alias="versioningVersion")
    project_id: str = Field(alias="projectId")
    active_version_id: str | None = Field(alias="activeVersionId")
    items: list[TimelineVersionSnapshot] = Field(max_length=C10_MAX_LIST_LIMIT)


class TimelineVersionResult(VersionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    versioning_version: Literal["timeline-version-v1"] = Field(alias="versioningVersion")
    project_id: str = Field(alias="projectId")
    operation: Literal["created", "applied", "activated", "undo", "redo"]
    active_version_id: str | None = Field(alias="activeVersionId")
    active_revision: int = Field(alias="activeRevision", strict=True, ge=0)
    version_record: TimelineVersionSnapshot | None = Field(alias="version")
    edit_result: TimelineEditResult | None = Field(default=None, alias="editResult")


class TimelineVersionDiffResult(VersionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    versioning_version: Literal["timeline-version-v1"] = Field(alias="versioningVersion")
    project_id: str = Field(alias="projectId")
    from_version_id: str = Field(alias="fromVersionId")
    to_version_id: str = Field(alias="toVersionId")
    summary: dict[str, Any]

    @field_validator("summary")
    @classmethod
    def bounded_summary(cls, value: dict[str, Any]) -> dict[str, Any]:
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if len(encoded) > C10_MAX_DIFF_BYTES:
            raise ValueError("diff summary is too large")
        return value
