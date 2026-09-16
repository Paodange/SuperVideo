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
    JobEventCreate,
    JobEventRecord,
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

    def get_by_root(self, project_root: str) -> ProjectRecord | None:
        try:
            normalized_root = ProjectRecord(project_root=project_root, name="root lookup").project_root
        except (TypeError, ValueError, ValidationError) as error:
            raise StorageError("INVALID_RECORD", cause=error) from error
        try:
            row = self.database.connection.execute(
                """
                SELECT id, name, project_root, target_platform, config_json,
                       created_at_ms, updated_at_ms, revision
                FROM projects WHERE project_root = ?
                """,
                (normalized_root,),
            ).fetchone()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return None if row is None else _project_from_row(row)

    def update_location(self, project_id: str, project_root: str, updated_at_ms: int) -> ProjectRecord:
        record_id = _record_id(project_id)
        try:
            normalized_root = ProjectRecord(project_root=project_root, name="root update").project_root
        except (TypeError, ValueError, ValidationError) as error:
            raise StorageError("INVALID_RECORD", cause=error) from error
        if not isinstance(updated_at_ms, int) or isinstance(updated_at_ms, bool) or updated_at_ms < 0:
            raise StorageError("INVALID_RECORD")
        try:
            with self.database.transaction() as connection:
                connection.execute(
                    """
                    UPDATE projects
                    SET project_root = ?, updated_at_ms = ?, revision = revision + 1
                    WHERE id = ?
                    """,
                    (normalized_root, updated_at_ms, record_id),
                )
                if connection.execute("SELECT changes()").fetchone()[0] != 1:
                    raise StorageError("RECORD_NOT_FOUND")
        except StorageError:
            raise
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return self.get(record_id)

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

    def create_many(self, assets: Sequence[AssetCreate]) -> list[AssetRecord]:
        values = [_require_model(asset, AssetRecord) for asset in assets]
        try:
            with self.database.transaction() as connection:
                for value in values:
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
        return values

    def get_by_path(self, project_id: str, absolute_path: str) -> AssetRecord | None:
        scope = _project_id(project_id)
        try:
            normalized_path = AssetRecord(
                project_id=scope,
                absolute_path=absolute_path,
                kind="video",
                size_bytes=0,
                modified_at_ms=0,
                content_fingerprint="lookup",
                source_type="external",
            ).absolute_path
        except (TypeError, ValueError, ValidationError) as error:
            raise StorageError("INVALID_RECORD", cause=error) from error
        try:
            row = self.database.connection.execute(
                """
                SELECT id, project_id, absolute_path, kind, size_bytes,
                       modified_at_ms, content_fingerprint, source_type,
                       license_json, metadata_json, created_at_ms, updated_at_ms
                FROM assets WHERE project_id = ? AND absolute_path = ?
                """,
                (scope, normalized_path),
            ).fetchone()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return None if row is None else _asset_from_row(row)

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
                        finished_at_ms, checkpoint_json, checkpoint_version,
                        executor_version, revision, last_event_sequence,
                        cancel_requested_at_ms, recovery_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        None if value.checkpoint_json is None else _stored_json(value.checkpoint_json),
                        value.checkpoint_version,
                        value.executor_version,
                        value.revision,
                        value.last_event_sequence,
                        value.cancel_requested_at_ms,
                        value.recovery_count,
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
                # Also accept the task-oriented (project_id, job_id) spelling
                # without weakening project isolation. The legacy A05
                # (job_id, project_id) spelling remains the fast path.
                if row is None:
                    row = self.database.connection.execute(
                        _JOB_SELECT + " WHERE id = ? AND project_id = ?", (scope, record_id)
                    ).fetchone()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        if row is None:
            raise StorageError("RECORD_NOT_FOUND")
        return _job_from_row(row)

    def list_for_project(
        self,
        project_id: str,
        limit: int = STORAGE_DEFAULT_LIST_LIMIT,
        *,
        statuses: Sequence[str] | None = None,
        cursor: str | None = None,
    ) -> list[JobRecord]:
        scope = _project_id(project_id)
        bounded_limit = _limit(limit)
        try:
            clauses = ["project_id = ?"]
            params: list[object] = [scope]
            if statuses is not None:
                if not statuses or any(status not in _JOB_STATUSES for status in statuses):
                    raise StorageError("INVALID_RECORD")
                clauses.append(f"status IN ({','.join('?' for _ in statuses)})")
                params.extend(statuses)
            if cursor is not None:
                if not isinstance(cursor, str) or len(cursor) > 512:
                    raise StorageError("INVALID_RECORD")
                try:
                    cursor_created, cursor_id = cursor.split("/", 1)
                    cursor_created_ms = int(cursor_created)
                    _record_id(cursor_id)
                except (ValueError, TypeError):
                    raise StorageError("INVALID_RECORD")
                clauses.append("(created_at_ms > ? OR (created_at_ms = ? AND id > ?))")
                params.extend([cursor_created_ms, cursor_created_ms, cursor_id])
            params.append(bounded_limit)
            rows = self.database.connection.execute(
                _JOB_SELECT + f" WHERE {' AND '.join(clauses)} ORDER BY created_at_ms ASC, id ASC LIMIT ?",
                tuple(params),
            ).fetchall()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return [_job_from_row(row) for row in rows]

    def create_job_with_event(self, job: JobCreate, event_type: str = "created", payload: Any = None) -> tuple[JobRecord, JobEventRecord]:
        value = _require_model(job, JobRecord)
        if value.last_event_sequence != 0:
            raise StorageError("INVALID_RECORD")
        if not isinstance(event_type, str) or not event_type or len(event_type) > 64:
            raise StorageError("INVALID_RECORD")
        payload_value = {} if payload is None else payload
        try:
            with self.database.transaction() as connection:
                connection.execute(
                    """
                    INSERT INTO jobs(
                        id, project_id, job_type, status, progress, stage,
                        input_json, result_json, error_code, idempotency_key,
                        attempt, created_at_ms, updated_at_ms, started_at_ms,
                        finished_at_ms, checkpoint_json, checkpoint_version,
                        executor_version, revision, last_event_sequence,
                        cancel_requested_at_ms, recovery_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        value.id, value.project_id, value.job_type, value.status,
                        value.progress, value.stage, _stored_json(value.input_json),
                        None if value.result_json is None else _stored_json(value.result_json),
                        value.error_code, value.idempotency_key, value.attempt,
                        value.created_at_ms, value.updated_at_ms, value.started_at_ms,
                        value.finished_at_ms,
                        None if value.checkpoint_json is None else _stored_json(value.checkpoint_json),
                        value.checkpoint_version, value.executor_version, 1,
                        1, value.cancel_requested_at_ms, value.recovery_count,
                    ),
                )
                event = _insert_job_event(
                    connection, value, sequence=1, event_type=event_type,
                    payload=payload_value, created_at_ms=value.created_at_ms,
                )
        except StorageError:
            raise
        except sqlite3.Error as error:
            raise _write_error(error) from error
        record = value.model_copy(update={"revision": 1, "last_event_sequence": 1})
        return record, event

    def find_by_idempotency_key(self, project_id: str, job_type: str, key: str) -> JobRecord | None:
        scope = _project_id(project_id)
        if not isinstance(job_type, str) or not job_type or len(job_type) > 128 or not isinstance(key, str) or not key or len(key) > 256:
            raise StorageError("INVALID_RECORD")
        try:
            row = self.database.connection.execute(
                _JOB_SELECT + " WHERE project_id = ? AND job_type = ? AND idempotency_key = ?",
                (scope, job_type, key),
            ).fetchone()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return None if row is None else _job_from_row(row)

    def transition(
        self,
        job_id: str,
        project_id: str,
        expected_revision: int,
        from_statuses: Sequence[str],
        to_status: str,
        *,
        progress: float | None = None,
        stage: str | None = None,
        attempt: int | None = None,
        error_code: str | None = None,
        result_json: dict[str, Any] | None = None,
        checkpoint_json: dict[str, Any] | None = None,
        checkpoint_version: int | None = None,
        cancel_requested_at_ms: int | None = None,
        recovery_count: int | None = None,
        event_type: str,
        payload: Any = None,
        timestamp_ms: int,
    ) -> tuple[JobRecord, JobEventRecord]:
        record_id = _record_id(job_id)
        scope = _project_id(project_id)
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool) or expected_revision < 0:
            raise StorageError("INVALID_RECORD")
        allowed = tuple(from_statuses)
        if not allowed or any(status not in _JOB_STATUSES for status in allowed) or to_status not in _JOB_STATUSES:
            raise StorageError("INVALID_RECORD")
        if progress is not None and (not isinstance(progress, (int, float)) or isinstance(progress, bool) or not 0 <= progress <= 1):
            raise StorageError("INVALID_RECORD")
        if attempt is not None and (not isinstance(attempt, int) or isinstance(attempt, bool) or attempt < 0):
            raise StorageError("INVALID_RECORD")
        try:
            with self.database.transaction() as connection:
                row = connection.execute(_JOB_SELECT + " WHERE id = ? AND project_id = ?", (record_id, scope)).fetchone()
                if row is None:
                    raise StorageError("RECORD_NOT_FOUND")
                current = _job_from_row(row)
                if current.revision != expected_revision or current.status not in allowed:
                    raise StorageError("CONSTRAINT_VIOLATION")
                next_progress = current.progress if progress is None else float(progress)
                next_attempt = current.attempt if attempt is None else attempt
                if next_attempt == current.attempt and next_progress < current.progress:
                    raise StorageError("CONSTRAINT_VIOLATION")
                sequence = current.last_event_sequence + 1
                finished = timestamp_ms if to_status in _TERMINAL_JOB_STATUSES else None
                next_stage = current.stage if stage is None else stage
                next_checkpoint = current.checkpoint_json if checkpoint_json is None else checkpoint_json
                stored_checkpoint = None if next_checkpoint is None else _stored_json(next_checkpoint)
                connection.execute(
                    f"""
                    UPDATE jobs SET status = ?, progress = ?, stage = ?,
                        result_json = ?, error_code = ?, attempt = ?,
                        updated_at_ms = ?, started_at_ms = ?, finished_at_ms = ?,
                        checkpoint_json = ?, checkpoint_version = ?,
                        cancel_requested_at_ms = ?, recovery_count = ?,
                        revision = revision + 1, last_event_sequence = ?
                    WHERE id = ? AND project_id = ? AND revision = ?
                      AND status IN ({','.join('?' for _ in allowed)})
                    """,
                    (
                        to_status, next_progress, next_stage,
                        None if result_json is None else _stored_json(result_json), error_code,
                        next_attempt, timestamp_ms,
                        current.started_at_ms if current.started_at_ms is not None else (timestamp_ms if to_status in {"running", "retrying"} else None),
                        finished,
                        stored_checkpoint,
                        current.checkpoint_version if checkpoint_version is None else checkpoint_version,
                        current.cancel_requested_at_ms if cancel_requested_at_ms is None else cancel_requested_at_ms,
                        current.recovery_count if recovery_count is None else recovery_count,
                        sequence, record_id, scope, expected_revision, *allowed,
                    ),
                )
                if connection.execute("SELECT changes()").fetchone()[0] != 1:
                    raise StorageError("CONSTRAINT_VIOLATION")
                candidate = current.model_copy(update={
                    "status": to_status, "progress": next_progress, "stage": next_stage,
                    "result_json": result_json, "error_code": error_code, "attempt": next_attempt,
                    "updated_at_ms": timestamp_ms,
                    "started_at_ms": current.started_at_ms if current.started_at_ms is not None else (timestamp_ms if to_status in {"running", "retrying"} else None),
                    "finished_at_ms": finished,
                    "checkpoint_json": current.checkpoint_json if checkpoint_json is None else checkpoint_json,
                    "checkpoint_version": current.checkpoint_version if checkpoint_version is None else checkpoint_version,
                    "cancel_requested_at_ms": current.cancel_requested_at_ms if cancel_requested_at_ms is None else cancel_requested_at_ms,
                    "recovery_count": current.recovery_count if recovery_count is None else recovery_count,
                    "revision": expected_revision + 1, "last_event_sequence": sequence,
                })
                event = _insert_job_event(connection, candidate, sequence=sequence, event_type=event_type,
                                          payload={} if payload is None else payload, created_at_ms=timestamp_ms)
        except (StorageError, ValidationError):
            raise
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return candidate, event

    def append_progress_and_checkpoint(
        self,
        job_id: str,
        project_id: str,
        expected_revision: int,
        progress: float,
        stage: str,
        checkpoint_json: dict[str, Any],
        checkpoint_version: int = 1,
        *,
        event_type: str = "progress",
        payload: Any = None,
        timestamp_ms: int,
    ) -> tuple[JobRecord, JobEventRecord]:
        return self.transition(
            job_id, project_id, expected_revision, ("running",), "running",
            progress=progress, stage=stage, checkpoint_json=checkpoint_json,
            checkpoint_version=checkpoint_version, event_type=event_type,
            payload=payload if payload is not None else {"checkpointVersion": checkpoint_version},
            timestamp_ms=timestamp_ms,
        )

    def find_incomplete(self, project_id: str) -> list[JobRecord]:
        return self.list_for_project(project_id, STORAGE_MAX_LIST_LIMIT,
                                     statuses=("queued", "running", "retrying", "cancelling"))

    def list_events(self, project_id: str, job_id: str, after_sequence: int = 0, limit: int = STORAGE_DEFAULT_LIST_LIMIT) -> list[JobEventRecord]:
        scope = _project_id(project_id)
        record_id = _record_id(job_id)
        if not isinstance(after_sequence, int) or isinstance(after_sequence, bool) or after_sequence < 0:
            raise StorageError("INVALID_RECORD")
        bounded_limit = _limit(limit)
        try:
            rows = self.database.connection.execute(
                """SELECT id, project_id, job_id, sequence, event_type, status,
                          progress, stage, attempt, payload_json, created_at_ms
                   FROM job_events
                   WHERE project_id = ? AND job_id = ? AND sequence > ?
                   ORDER BY sequence ASC LIMIT ?""",
                (scope, record_id, after_sequence, bounded_limit),
            ).fetchall()
        except sqlite3.Error as error:
            raise _write_error(error) from error
        return [_job_event_from_row(row) for row in rows]


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
       created_at_ms, updated_at_ms, started_at_ms, finished_at_ms,
       checkpoint_json, checkpoint_version, executor_version, revision,
       last_event_sequence, cancel_requested_at_ms, recovery_count
FROM jobs
"""

_JOB_STATUSES = {
    "queued", "running", "succeeded", "failed", "retrying", "cancelling", "cancelled", "needs_attention",
}
_TERMINAL_JOB_STATUSES = {"succeeded", "failed", "cancelled", "needs_attention"}

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
            "checkpoint_json": None if row[15] is None else _json_from_row(row[15]),
            "checkpoint_version": row[16],
            "executor_version": row[17],
            "revision": row[18],
            "last_event_sequence": row[19],
            "cancel_requested_at_ms": row[20],
            "recovery_count": row[21],
        },
    )


def _insert_job_event(
    connection: sqlite3.Connection,
    job: JobRecord,
    *,
    sequence: int,
    event_type: str,
    payload: Any,
    created_at_ms: int,
) -> JobEventRecord:
    event = JobEventCreate(
        project_id=job.project_id,
        job_id=job.id,
        sequence=sequence,
        event_type=event_type,
        status=job.status,
        progress=job.progress,
        stage=job.stage,
        attempt=job.attempt,
        payload_json=payload,
        created_at_ms=created_at_ms,
    )
    connection.execute(
        """INSERT INTO job_events(
             id, project_id, job_id, sequence, event_type, status,
             progress, stage, attempt, payload_json, created_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            event.id, event.project_id, event.job_id, event.sequence,
            event.event_type, event.status, event.progress, event.stage,
            event.attempt, _stored_json(event.payload_json), event.created_at_ms,
        ),
    )
    return event


def _job_event_from_row(row: Sequence[object]) -> JobEventRecord:
    return _model_from_row(
        JobEventRecord,
        {
            "id": row[0],
            "project_id": row[1],
            "job_id": row[2],
            "sequence": row[3],
            "event_type": row[4],
            "status": row[5],
            "progress": row[6],
            "stage": row[7],
            "attempt": row[8],
            "payload_json": _json_from_row(row[9]),
            "created_at_ms": row[10],
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
