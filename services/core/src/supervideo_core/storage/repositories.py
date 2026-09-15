"""Small, parameterized repositories for the A05 storage foundation."""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from .database import Database
from .errors import StorageError, map_sqlite_error
from .models import (
    AssetCreate,
    AssetRecord,
    JobCreate,
    JobRecord,
    MessageCreate,
    MessageRecord,
    ProjectCreate,
    ProjectRecord,
    TimelineVersionCreate,
    TimelineVersionRecord,
    STORAGE_DEFAULT_LIST_LIMIT,
    STORAGE_MAX_LIST_LIMIT,
    deserialize_json_value,
    serialize_json_value,
    validate_id,
)


ModelT = TypeVar("ModelT", bound=BaseModel)
_SECRET_KEY_PARTS = ("api_key", "apikey", "access_token", "refresh_token", "secret", "password", "token", "dpapi", "ciphertext")


def _require_model(value: object, model_type: type[ModelT]) -> ModelT:
    if not isinstance(value, BaseModel):
        raise StorageError("INVALID_RECORD")
    try:
        return model_type.model_validate(value.model_dump())
    except (TypeError, ValueError, ValidationError) as error:
        raise StorageError("INVALID_RECORD", cause=error) from error


def _record_id(value: str) -> str:
    try:
        return validate_id(value)
    except (TypeError, ValueError) as error:
        raise StorageError("INVALID_RECORD", cause=error) from error


def _project_id(value: str) -> str:
    return _record_id(value)


def _limit(value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1 or value > STORAGE_MAX_LIST_LIMIT:
        raise StorageError("INVALID_RECORD")
    return value


def _write_error(error: sqlite3.Error) -> StorageError:
    if isinstance(error, sqlite3.IntegrityError):
        return StorageError("CONSTRAINT_VIOLATION", cause=error)
    return map_sqlite_error(error)


def _stored_json(value: object) -> str:
    try:
        return serialize_json_value(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise StorageError("INVALID_RECORD", cause=error) from error


def _json_from_row(value: object) -> Any:
    try:
        return deserialize_json_value(value)  # type: ignore[arg-type]
    except (TypeError, ValueError, OverflowError) as error:
        raise StorageError("INVALID_RECORD", cause=error) from error


def _model_from_row(model_type: type[ModelT], values: dict[str, object]) -> ModelT:
    try:
        return model_type.model_validate(values)
    except (TypeError, ValueError, ValidationError) as error:
        raise StorageError("INVALID_RECORD", cause=error) from error


def _ensure_no_secret_keys(value: object) -> None:
    if isinstance(value, list):
        for item in value:
            _ensure_no_secret_keys(item)
        return
    if not isinstance(value, dict):
        return
    for key, nested in value.items():
        if not isinstance(key, str):
            raise StorageError("INVALID_RECORD")
        normalized_key = key.lower().replace("-", "_")
        if any(part in normalized_key for part in _SECRET_KEY_PARTS):
            raise StorageError("INVALID_RECORD")
        if isinstance(nested, dict):
            _ensure_no_secret_keys(nested)
        elif isinstance(nested, list):
            _ensure_no_secret_keys(nested)


class ProjectRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(self, project: ProjectCreate) -> ProjectRecord:
        value = _require_model(project, ProjectRecord)
        _ensure_no_secret_keys(value.config_json)
        try:
            with self.database.transaction() as connection:
                connection.execute(
                    """
                    INSERT INTO projects(
                        id, name, project_root, target_platform, config_json,
                        created_at_ms, updated_at_ms, revision
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        value.id,
                        value.name,
                        value.project_root,
                        value.target_platform,
                        _stored_json(value.config_json),
                        value.created_at_ms,
                        value.updated_at_ms,
                        value.revision,
                    ),
                )
        except StorageError:
            raise
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return value

    def get(self, project_id: str) -> ProjectRecord:
        record_id = _record_id(project_id)
        try:
            row = self.database.connection.execute(
                """
                SELECT id, name, project_root, target_platform, config_json,
                       created_at_ms, updated_at_ms, revision
                FROM projects WHERE id = ?
                """,
                (record_id,),
            ).fetchone()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        if row is None:
            raise StorageError("RECORD_NOT_FOUND")
        return _project_from_row(row)

    def list(self, limit: int = STORAGE_DEFAULT_LIST_LIMIT) -> list[ProjectRecord]:
        bounded_limit = _limit(limit)
        try:
            rows = self.database.connection.execute(
                """
                SELECT id, name, project_root, target_platform, config_json,
                       created_at_ms, updated_at_ms, revision
                FROM projects ORDER BY created_at_ms ASC, id ASC LIMIT ?
                """,
                (bounded_limit,),
            ).fetchall()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return [_project_from_row(row) for row in rows]


class AssetRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(self, asset: AssetCreate) -> AssetRecord:
        value = _require_model(asset, AssetRecord)
        try:
            with self.database.transaction() as connection:
                connection.execute(
                    """
                    INSERT INTO assets(
                        id, project_id, absolute_path, kind, size_bytes,
                        modified_at_ms, content_fingerprint, source_type,
                        license_json, metadata_json, created_at_ms, updated_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        value.id,
                        value.project_id,
                        value.absolute_path,
                        value.kind,
                        value.size_bytes,
                        value.modified_at_ms,
                        value.content_fingerprint,
                        value.source_type,
                        _stored_json(value.license_json),
                        _stored_json(value.metadata_json),
                        value.created_at_ms,
                        value.updated_at_ms,
                    ),
                )
        except StorageError:
            raise
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return value

    def get(self, asset_id: str, project_id: str | None = None) -> AssetRecord:
        record_id = _record_id(asset_id)
        scope = None if project_id is None else _project_id(project_id)
        try:
            if scope is None:
                row = self.database.connection.execute(
                    """
                    SELECT id, project_id, absolute_path, kind, size_bytes,
                           modified_at_ms, content_fingerprint, source_type,
                           license_json, metadata_json, created_at_ms, updated_at_ms
                    FROM assets WHERE id = ?
                    """,
                    (record_id,),
                ).fetchone()
            else:
                row = self.database.connection.execute(
                    """
                    SELECT id, project_id, absolute_path, kind, size_bytes,
                           modified_at_ms, content_fingerprint, source_type,
                           license_json, metadata_json, created_at_ms, updated_at_ms
                    FROM assets WHERE id = ? AND project_id = ?
                    """,
                    (record_id, scope),
                ).fetchone()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        if row is None:
            raise StorageError("RECORD_NOT_FOUND")
        return _asset_from_row(row)

    def list_for_project(self, project_id: str, limit: int = STORAGE_DEFAULT_LIST_LIMIT) -> list[AssetRecord]:
        scope = _project_id(project_id)
        bounded_limit = _limit(limit)
        try:
            rows = self.database.connection.execute(
                """
                SELECT id, project_id, absolute_path, kind, size_bytes,
                       modified_at_ms, content_fingerprint, source_type,
                       license_json, metadata_json, created_at_ms, updated_at_ms
                FROM assets WHERE project_id = ?
                ORDER BY created_at_ms ASC, id ASC LIMIT ?
                """,
                (scope, bounded_limit),
            ).fetchall()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return [_asset_from_row(row) for row in rows]


class JobRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(self, job: JobCreate) -> JobRecord:
        value = _require_model(job, JobRecord)
        try:
            with self.database.transaction() as connection:
                connection.execute(
                    """
                    INSERT INTO jobs(
                        id, project_id, job_type, status, progress, stage,
                        input_json, result_json, error_code, idempotency_key,
                        attempt, created_at_ms, updated_at_ms, started_at_ms,
                        finished_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        value.id,
                        value.project_id,
                        value.job_type,
                        value.status,
                        value.progress,
                        value.stage,
                        _stored_json(value.input_json),
                        None if value.result_json is None else _stored_json(value.result_json),
                        value.error_code,
                        value.idempotency_key,
                        value.attempt,
                        value.created_at_ms,
                        value.updated_at_ms,
                        value.started_at_ms,
                        value.finished_at_ms,
                    ),
                )
        except StorageError:
            raise
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return value

    def get(self, job_id: str, project_id: str | None = None) -> JobRecord:
        record_id = _record_id(job_id)
        scope = None if project_id is None else _project_id(project_id)
        try:
            if scope is None:
                row = self.database.connection.execute(_JOB_SELECT + " WHERE id = ?", (record_id,)).fetchone()
            else:
                row = self.database.connection.execute(
                    _JOB_SELECT + " WHERE id = ? AND project_id = ?", (record_id, scope)
                ).fetchone()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        if row is None:
            raise StorageError("RECORD_NOT_FOUND")
        return _job_from_row(row)

    def list_for_project(self, project_id: str, limit: int = STORAGE_DEFAULT_LIST_LIMIT) -> list[JobRecord]:
        scope = _project_id(project_id)
        bounded_limit = _limit(limit)
        try:
            rows = self.database.connection.execute(
                _JOB_SELECT + " WHERE project_id = ? ORDER BY created_at_ms ASC, id ASC LIMIT ?",
                (scope, bounded_limit),
            ).fetchall()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return [_job_from_row(row) for row in rows]


class MessageRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def append(self, message: MessageCreate) -> MessageRecord:
        value = _require_model(message, MessageCreate)
        try:
            with self.database.transaction() as connection:
                sequence = value.sequence
                if sequence is None:
                    row = connection.execute(
                        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM messages WHERE project_id = ? AND conversation_id = ?",
                        (value.project_id, value.conversation_id),
                    ).fetchone()
                    sequence = int(row[0])
                record = MessageRecord.model_validate({**value.model_dump(), "sequence": sequence})
                connection.execute(
                    """
                    INSERT INTO messages(
                        id, project_id, conversation_id, sequence, role,
                        message_type, content_json, created_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        record.id,
                        record.project_id,
                        record.conversation_id,
                        record.sequence,
                        record.role,
                        record.message_type,
                        _stored_json(record.content_json),
                        record.created_at_ms,
                    ),
                )
        except ValidationError as error:
            raise StorageError("INVALID_RECORD", cause=error) from error
        except StorageError:
            raise
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return record

    def list_for_conversation(
        self,
        project_id: str,
        conversation_id: str,
        limit: int = STORAGE_DEFAULT_LIST_LIMIT,
    ) -> list[MessageRecord]:
        scope = _project_id(project_id)
        if not isinstance(conversation_id, str) or not conversation_id or len(conversation_id) > 256:
            raise StorageError("INVALID_RECORD")
        bounded_limit = _limit(limit)
        try:
            rows = self.database.connection.execute(
                """
                SELECT id, project_id, conversation_id, sequence, role,
                       message_type, content_json, created_at_ms
                FROM messages
                WHERE project_id = ? AND conversation_id = ?
                ORDER BY sequence ASC, id ASC LIMIT ?
                """,
                (scope, conversation_id, bounded_limit),
            ).fetchall()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return [_message_from_row(row) for row in rows]


class TimelineVersionRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def append(self, version: TimelineVersionCreate) -> TimelineVersionRecord:
        value = _require_model(version, TimelineVersionCreate)
        try:
            with self.database.transaction() as connection:
                version_number = value.version_number
                if version_number is None:
                    row = connection.execute(
                        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM timeline_versions WHERE project_id = ?",
                        (value.project_id,),
                    ).fetchone()
                    version_number = int(row[0])
                record = TimelineVersionRecord.model_validate({**value.model_dump(), "version_number": version_number})
                connection.execute(
                    """
                    INSERT INTO timeline_versions(
                        id, project_id, version_number, parent_version_id,
                        schema_version, timeline_json, edit_intent_json,
                        diff_summary_json, created_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        record.id,
                        record.project_id,
                        record.version_number,
                        record.parent_version_id,
                        record.schema_version,
                        _stored_json(record.timeline_json),
                        _stored_json(record.edit_intent_json),
                        _stored_json(record.diff_summary_json),
                        record.created_at_ms,
                    ),
                )
        except ValidationError as error:
            raise StorageError("INVALID_RECORD", cause=error) from error
        except StorageError:
            raise
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return record

    def get(self, version_id: str, project_id: str | None = None) -> TimelineVersionRecord:
        record_id = _record_id(version_id)
        scope = None if project_id is None else _project_id(project_id)
        try:
            if scope is None:
                row = self.database.connection.execute(
                    _TIMELINE_SELECT + " WHERE id = ?", (record_id,)
                ).fetchone()
            else:
                row = self.database.connection.execute(
                    _TIMELINE_SELECT + " WHERE id = ? AND project_id = ?", (record_id, scope)
                ).fetchone()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        if row is None:
            raise StorageError("RECORD_NOT_FOUND")
        return _timeline_from_row(row)

    def list_for_project(self, project_id: str, limit: int = STORAGE_DEFAULT_LIST_LIMIT) -> list[TimelineVersionRecord]:
        scope = _project_id(project_id)
        bounded_limit = _limit(limit)
        try:
            rows = self.database.connection.execute(
                _TIMELINE_SELECT + " WHERE project_id = ? ORDER BY version_number ASC, id ASC LIMIT ?",
                (scope, bounded_limit),
            ).fetchall()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return [_timeline_from_row(row) for row in rows]


_JOB_SELECT = """
SELECT id, project_id, job_type, status, progress, stage,
       input_json, result_json, error_code, idempotency_key, attempt,
       created_at_ms, updated_at_ms, started_at_ms, finished_at_ms
FROM jobs
"""

_TIMELINE_SELECT = """
SELECT id, project_id, version_number, parent_version_id, schema_version,
       timeline_json, edit_intent_json, diff_summary_json, created_at_ms
FROM timeline_versions
"""


def _project_from_row(row: Sequence[object]) -> ProjectRecord:
    config = _json_from_row(row[4])
    try:
        _ensure_no_secret_keys(config)
    except StorageError as error:
        raise StorageError("INVALID_RECORD", cause=error) from error
    return _model_from_row(
        ProjectRecord,
        {
            "id": row[0],
            "name": row[1],
            "project_root": row[2],
            "target_platform": row[3],
            "config_json": config,
            "created_at_ms": row[5],
            "updated_at_ms": row[6],
            "revision": row[7],
        },
    )


def _asset_from_row(row: Sequence[object]) -> AssetRecord:
    return _model_from_row(
        AssetRecord,
        {
            "id": row[0],
            "project_id": row[1],
            "absolute_path": row[2],
            "kind": row[3],
            "size_bytes": row[4],
            "modified_at_ms": row[5],
            "content_fingerprint": row[6],
            "source_type": row[7],
            "license_json": _json_from_row(row[8]),
            "metadata_json": _json_from_row(row[9]),
            "created_at_ms": row[10],
            "updated_at_ms": row[11],
        },
    )


def _job_from_row(row: Sequence[object]) -> JobRecord:
    return _model_from_row(
        JobRecord,
        {
            "id": row[0],
            "project_id": row[1],
            "job_type": row[2],
            "status": row[3],
            "progress": row[4],
            "stage": row[5],
            "input_json": _json_from_row(row[6]),
            "result_json": None if row[7] is None else _json_from_row(row[7]),
            "error_code": row[8],
            "idempotency_key": row[9],
            "attempt": row[10],
            "created_at_ms": row[11],
            "updated_at_ms": row[12],
            "started_at_ms": row[13],
            "finished_at_ms": row[14],
        },
    )


def _message_from_row(row: Sequence[object]) -> MessageRecord:
    return _model_from_row(
        MessageRecord,
        {
            "id": row[0],
            "project_id": row[1],
            "conversation_id": row[2],
            "sequence": row[3],
            "role": row[4],
            "message_type": row[5],
            "content_json": _json_from_row(row[6]),
            "created_at_ms": row[7],
        },
    )


def _timeline_from_row(row: Sequence[object]) -> TimelineVersionRecord:
    return _model_from_row(
        TimelineVersionRecord,
        {
            "id": row[0],
            "project_id": row[1],
            "version_number": row[2],
            "parent_version_id": row[3],
            "schema_version": row[4],
            "timeline_json": _json_from_row(row[5]),
            "edit_intent_json": _json_from_row(row[6]),
            "diff_summary_json": _json_from_row(row[7]),
            "created_at_ms": row[8],
        },
    )
