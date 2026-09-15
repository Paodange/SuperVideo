"""Strict versioned project manifest with atomic filesystem writes."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .errors import ProjectError
from .paths import DATABASE_RELATIVE_PATH, PROJECT_MANIFEST_FILENAME

PROJECT_MANIFEST_SCHEMA_VERSION = 1
MAX_MANIFEST_BYTES = 64 * 1024


class ProjectManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: int = Field(alias="schemaVersion", strict=True)
    project_id: str = Field(alias="projectId")
    name: str = Field(min_length=1, max_length=200)
    target_platform: str = Field(alias="targetPlatform", min_length=1, max_length=64)
    database: str
    created_at_ms: int = Field(alias="createdAtMs", strict=True, ge=0)
    updated_at_ms: int = Field(alias="updatedAtMs", strict=True, ge=0)

    @field_validator("schema_version")
    @classmethod
    def validate_schema_version(cls, value: int) -> int:
        if value < 1:
            raise ValueError("invalid manifest schema")
        return value

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        try:
            parsed = UUID(value)
        except (ValueError, TypeError, AttributeError) as error:
            raise ValueError("invalid project id") from error
        normalized = str(parsed)
        if value != normalized:
            raise ValueError("project id must be lowercase")
        return value

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("invalid project name")
        return value

    @field_validator("target_platform")
    @classmethod
    def validate_target_platform(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("invalid target platform")
        return value

    @field_validator("database")
    @classmethod
    def validate_database(cls, value: str) -> str:
        if value != DATABASE_RELATIVE_PATH or value.startswith(("/", "\\")) or ".." in value.split("/"):
            raise ValueError("invalid database path")
        return value


def manifest_path(root: Path) -> Path:
    return root / PROJECT_MANIFEST_FILENAME


def read_manifest(root: Path) -> ProjectManifest:
    path = manifest_path(root)
    try:
        with path.open("rb") as handle:
            payload = handle.read(MAX_MANIFEST_BYTES + 1)
    except FileNotFoundError as error:
        raise ProjectError("PROJECT_NOT_FOUND", cause=error) from error
    except OSError as error:
        raise ProjectError("PROJECT_MANIFEST_INVALID", cause=error) from error
    if len(payload) > MAX_MANIFEST_BYTES:
        raise ProjectError("PROJECT_MANIFEST_INVALID")
    try:
        value = json.loads(payload.decode("utf-8"))
        if isinstance(value, dict) and value.get("schemaVersion") not in (None, PROJECT_MANIFEST_SCHEMA_VERSION):
            if isinstance(value.get("schemaVersion"), int) and value["schemaVersion"] > PROJECT_MANIFEST_SCHEMA_VERSION:
                raise ProjectError("PROJECT_SCHEMA_TOO_NEW")
        manifest = ProjectManifest.model_validate(value)
    except ProjectError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as error:
        raise ProjectError("PROJECT_MANIFEST_INVALID", cause=error) from error
    if manifest.schema_version > PROJECT_MANIFEST_SCHEMA_VERSION:
        raise ProjectError("PROJECT_SCHEMA_TOO_NEW")
    return manifest


def atomic_write_manifest(root: Path, manifest: ProjectManifest, *, must_not_exist: bool = False) -> None:
    destination = manifest_path(root)
    payload = json.dumps(
        manifest.model_dump(by_alias=True),
        ensure_ascii=False,
        sort_keys=False,
        indent=2,
        separators=(",", ": "),
    ).encode("utf-8") + b"\n"
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=".project.supervideo.",
            suffix=".tmp",
            dir=root,
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if must_not_exist:
            if destination.exists():
                raise ProjectError("PROJECT_ALREADY_EXISTS")
            try:
                os.link(temporary_path, destination)
            except FileExistsError as error:
                raise ProjectError("PROJECT_ALREADY_EXISTS", cause=error) from error
            except OSError:
                if destination.exists():
                    raise ProjectError("PROJECT_ALREADY_EXISTS")
                os.rename(temporary_path, destination)
            else:
                temporary_path.unlink(missing_ok=True)
                temporary_path = None
        else:
            os.replace(temporary_path, destination)
            temporary_path = None
    except ProjectError:
        raise
    except (OSError, TypeError, ValueError) as error:
        raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
