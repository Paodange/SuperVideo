"""Stable project-layer errors with no machine-specific details."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from supervideo_core.storage.errors import StorageError

ProjectErrorCode = Literal[
    "DIALOG_CANCELLED",
    "INVALID_PROJECT_NAME",
    "INVALID_PROJECT_ROOT",
    "UNSUPPORTED_PROJECT_LOCATION",
    "PROJECT_DIRECTORY_NOT_EMPTY",
    "PROJECT_ALREADY_EXISTS",
    "PROJECT_NOT_FOUND",
    "PROJECT_MANIFEST_INVALID",
    "PROJECT_SCHEMA_TOO_NEW",
    "PROJECT_DATABASE_MISSING",
    "PROJECT_ID_MISMATCH",
    "PROJECT_PATH_CONFLICT",
    "PROJECT_NOT_ACTIVE",
    "ASSET_NOT_FOUND",
    "UNSUPPORTED_ASSET_TYPE",
    "TOO_MANY_ASSETS",
    "ASSET_CHANGED",
    "ASSET_CHANGED_DURING_REFERENCE",
    "FILE_ACCESS_DENIED",
    "OPERATION_TIMEOUT",
    "CORE_UNAVAILABLE",
    "DATABASE_OPEN_FAILED",
    "DATABASE_READ_ONLY",
    "DATABASE_BUSY",
    "DATABASE_CORRUPT",
    "MIGRATION_FAILED",
    "MIGRATION_CHECKSUM_MISMATCH",
    "SCHEMA_TOO_NEW",
    "CONSTRAINT_VIOLATION",
    "RECORD_NOT_FOUND",
    "INVALID_RECORD",
]


@dataclass(frozen=True)
class ProjectErrorDefinition:
    message: str


ERRORS: Final[dict[str, ProjectErrorDefinition]] = {
    "DIALOG_CANCELLED": ProjectErrorDefinition("The dialog was cancelled."),
    "INVALID_PROJECT_NAME": ProjectErrorDefinition("The project name is invalid."),
    "INVALID_PROJECT_ROOT": ProjectErrorDefinition("The project location is invalid."),
    "UNSUPPORTED_PROJECT_LOCATION": ProjectErrorDefinition("The project location is not supported."),
    "PROJECT_DIRECTORY_NOT_EMPTY": ProjectErrorDefinition("The project directory is not empty."),
    "PROJECT_ALREADY_EXISTS": ProjectErrorDefinition("A SuperVideo project already exists there."),
    "PROJECT_NOT_FOUND": ProjectErrorDefinition("The project was not found."),
    "PROJECT_MANIFEST_INVALID": ProjectErrorDefinition("The project manifest is invalid."),
    "PROJECT_SCHEMA_TOO_NEW": ProjectErrorDefinition("The project schema is newer than supported."),
    "PROJECT_DATABASE_MISSING": ProjectErrorDefinition("The project database is missing."),
    "PROJECT_ID_MISMATCH": ProjectErrorDefinition("The project identity does not match."),
    "PROJECT_PATH_CONFLICT": ProjectErrorDefinition("The project location conflicts with another project."),
    "PROJECT_NOT_ACTIVE": ProjectErrorDefinition("No project is currently active."),
    "ASSET_NOT_FOUND": ProjectErrorDefinition("The asset was not found."),
    "UNSUPPORTED_ASSET_TYPE": ProjectErrorDefinition("The asset type is not supported."),
    "TOO_MANY_ASSETS": ProjectErrorDefinition("Too many assets were selected."),
    "ASSET_CHANGED": ProjectErrorDefinition("The asset has changed since it was referenced."),
    "ASSET_CHANGED_DURING_REFERENCE": ProjectErrorDefinition("The asset changed while it was being referenced."),
    "FILE_ACCESS_DENIED": ProjectErrorDefinition("The selected file could not be accessed."),
    "OPERATION_TIMEOUT": ProjectErrorDefinition("The project operation timed out."),
    "CORE_UNAVAILABLE": ProjectErrorDefinition("The Python Core is unavailable."),
    "DATABASE_OPEN_FAILED": ProjectErrorDefinition("Database could not be opened."),
    "DATABASE_READ_ONLY": ProjectErrorDefinition("Database is read-only."),
    "DATABASE_BUSY": ProjectErrorDefinition("Database is busy."),
    "DATABASE_CORRUPT": ProjectErrorDefinition("Database is corrupt."),
    "MIGRATION_FAILED": ProjectErrorDefinition("Database migration failed."),
    "MIGRATION_CHECKSUM_MISMATCH": ProjectErrorDefinition("Database migration checksum mismatch."),
    "SCHEMA_TOO_NEW": ProjectErrorDefinition("Database schema is newer than supported."),
    "CONSTRAINT_VIOLATION": ProjectErrorDefinition("Storage constraint was violated."),
    "RECORD_NOT_FOUND": ProjectErrorDefinition("Storage record was not found."),
    "INVALID_RECORD": ProjectErrorDefinition("Storage record is invalid."),
}


class ProjectError(Exception):
    def __init__(self, code: ProjectErrorCode, *, cause: BaseException | None = None) -> None:
        if code not in ERRORS:
            code = "INVALID_RECORD"
        self.code: ProjectErrorCode = code
        self.cause = cause
        super().__init__(ERRORS[code].message)


def from_storage_error(error: StorageError) -> ProjectError:
    return ProjectError(error.code, cause=error)
