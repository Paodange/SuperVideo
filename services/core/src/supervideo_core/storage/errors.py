"""Stable, redacted errors for the Python Core storage boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal


StorageErrorCode = Literal[
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
class StorageErrorDefinition:
    message: str


ERRORS: Final[dict[str, StorageErrorDefinition]] = {
    "DATABASE_OPEN_FAILED": StorageErrorDefinition("Database could not be opened."),
    "DATABASE_READ_ONLY": StorageErrorDefinition("Database is read-only."),
    "DATABASE_BUSY": StorageErrorDefinition("Database is busy."),
    "DATABASE_CORRUPT": StorageErrorDefinition("Database is corrupt."),
    "MIGRATION_FAILED": StorageErrorDefinition("Database migration failed."),
    "MIGRATION_CHECKSUM_MISMATCH": StorageErrorDefinition("Database migration checksum mismatch."),
    "SCHEMA_TOO_NEW": StorageErrorDefinition("Database schema is newer than supported."),
    "CONSTRAINT_VIOLATION": StorageErrorDefinition("Storage constraint was violated."),
    "RECORD_NOT_FOUND": StorageErrorDefinition("Storage record was not found."),
    "INVALID_RECORD": StorageErrorDefinition("Storage record is invalid."),
}


class StorageError(Exception):
    """An error whose normal string form is safe for RPC and user-facing logs.

    ``cause`` is retained only for local diagnostics.  It is intentionally not
    included in the exception message because SQLite exceptions can contain SQL
    fragments, absolute paths, and machine-specific details.
    """

    def __init__(self, code: StorageErrorCode, *, cause: BaseException | None = None) -> None:
        if code not in ERRORS:
            code = "INVALID_RECORD"
        self.code: StorageErrorCode = code
        self.error_code: StorageErrorCode = code
        self.cause = cause
        super().__init__(ERRORS[code].message)

    @property
    def message(self) -> str:
        return ERRORS[self.code].message


def storage_error(code: StorageErrorCode, cause: BaseException | None = None) -> StorageError:
    """Create a stable error while keeping an optional internal cause."""

    return StorageError(code, cause=cause)


def map_sqlite_error(error: BaseException, *, opening: bool = False, migrating: bool = False) -> StorageError:
    """Map a SQLite/OS failure without exposing its diagnostic text."""

    detail = str(error).lower()
    if "locked" in detail or "busy" in detail:
        code: StorageErrorCode = "DATABASE_BUSY"
    elif "readonly" in detail or "read-only" in detail or "read only" in detail or "permission denied" in detail:
        code = "DATABASE_READ_ONLY"
    elif "malformed" in detail or "not a database" in detail or "disk image" in detail:
        code = "DATABASE_CORRUPT"
    elif migrating:
        code = "MIGRATION_FAILED"
    elif opening:
        code = "DATABASE_OPEN_FAILED"
    else:
        code = "DATABASE_OPEN_FAILED"
    return StorageError(code, cause=error)
