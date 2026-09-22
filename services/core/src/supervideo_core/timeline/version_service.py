"""Deterministic C10 Timeline version storage and navigation."""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from supervideo_core.media.edit_models import TimelineEditParams
from supervideo_core.media.edit_service import TimelineEditService
from supervideo_core.storage import StorageError, TimelineVersionCreate, TimelineVersionRecord, TimelineVersionRepository, utc_now_ms

from .version_errors import TimelineVersionError
from .version_models import (
    TimelineVersionActivateParams,
    TimelineVersionApplyEditParams,
    TimelineVersionCreateParams,
    TimelineVersionDiffParams,
    TimelineVersionDiffResult,
    TimelineVersionListParams,
    TimelineVersionListResult,
    TimelineVersionRedoParams,
    TimelineVersionReferenceParams,
    TimelineVersionResult,
    TimelineVersionSnapshot,
    TimelineVersionUndoParams,
)


class TimelineVersionService:
    """Owns the active pointer; Timeline rows remain append-only."""

    def __init__(self, edit_service: TimelineEditService | None = None) -> None:
        self.edit_service = edit_service or TimelineEditService()

    def create(self, params: TimelineVersionCreateParams, database: Any) -> TimelineVersionResult:
        repository = TimelineVersionRepository(database)
        existing = self._idempotent(repository, params.project_id, params.idempotency_key)
        if existing is not None:
            self._ensure_same_timeline(existing, params.timeline.id)
            return self._result(repository, params.project_id, "created", existing)
        active = repository.get_active(params.project_id)
        if params.expected_active_version_id is not None and (active is None or active.id != params.expected_active_version_id):
            raise TimelineVersionError("TIMELINE_VERSION_CONFLICT")
        source_type = "root" if active is None else "edit"
        parent_id = active.id if active is not None else None
        try:
            record = repository.append(TimelineVersionCreate(
                project_id=params.project_id,
                parent_version_id=parent_id,
                source_version_id=parent_id,
                schema_version=params.timeline.schema_version,
                timeline_id=params.timeline.id,
                timeline_json=params.timeline.model_dump(by_alias=True),
                source_type=source_type,
                idempotency_key=params.idempotency_key,
                created_at_ms=utc_now_ms(),
            ))
        except StorageError as error:
            if params.idempotency_key is not None:
                existing = self._idempotent(repository, params.project_id, params.idempotency_key)
                if existing is not None:
                    self._ensure_same_timeline(existing, params.timeline.id)
                    return self._result(repository, params.project_id, "created", existing)
            raise TimelineVersionError("TIMELINE_VERSION_CONFLICT") from error
        return self._activate_created(repository, params.project_id, record, params.expected_active_version_id)

    def apply_edit(self, params: TimelineVersionApplyEditParams, database: Any) -> TimelineVersionResult:
        repository = TimelineVersionRepository(database)
        existing = self._idempotent(repository, params.project_id, params.idempotency_key)
        if existing is not None:
            return self._result(repository, params.project_id, "applied", existing)
        active = repository.get_active(params.project_id)
        source = self._get(repository, params.project_id, params.source_version_id) if params.source_version_id else active
        if source is None:
            raise TimelineVersionError("TIMELINE_ACTIVE_VERSION_MISSING")
        if params.expected_active_version_id is not None and (active is None or active.id != params.expected_active_version_id):
            raise TimelineVersionError("TIMELINE_VERSION_CONFLICT")
        try:
            edit_params = TimelineEditParams(
                schemaVersion=1,
                editVersion="timeline-edit-v1",
                policy="deterministic-natural-language-v1",
                projectId=params.project_id,
                timeline=source.timeline_json,
                **({"instruction": params.instruction} if params.instruction is not None else {"intent": params.intent}),
            )
            edit_result = self.edit_service.edit(edit_params)
        except (ValidationError, ValueError) as error:
            raise TimelineVersionError("TIMELINE_VERSION_INVALID") from error
        if edit_result.status == "rejected":
            return TimelineVersionResult(
                schemaVersion=1, versioningVersion="timeline-version-v1", projectId=params.project_id,
                operation="applied", activeVersionId=source.id, activeRevision=self._revision(database, params.project_id),
                version=None, editResult=edit_result,
            )
        result_timeline = edit_result.result_timeline
        try:
            record = repository.append(TimelineVersionCreate(
                project_id=params.project_id,
                parent_version_id=source.id,
                source_version_id=source.id,
                schema_version=result_timeline.schema_version,
                timeline_id=result_timeline.id,
                timeline_json=result_timeline.model_dump(by_alias=True),
                edit_intent_json=edit_result.intent.model_dump(by_alias=True),
                diff_summary_json=edit_result.diff.model_dump(by_alias=True),
                source_type="edit",
                determinism_digest=edit_result.determinism_digest,
                idempotency_key=params.idempotency_key,
                created_at_ms=utc_now_ms(),
            ))
        except StorageError as error:
            if params.idempotency_key is not None:
                existing = self._idempotent(repository, params.project_id, params.idempotency_key)
                if existing is not None:
                    return self._result(repository, params.project_id, "applied", existing)
            raise TimelineVersionError("TIMELINE_VERSION_CONFLICT") from error
        activated = self._activate_created(repository, params.project_id, record, params.expected_active_version_id)
        return activated.model_copy(update={"edit_result": edit_result})

    def list(self, params: TimelineVersionListParams, database: Any) -> TimelineVersionListResult:
        repository = TimelineVersionRepository(database)
        active = repository.get_active(params.project_id)
        active_id = active.id if active else None
        items = [self._snapshot(item, item.id == active_id) for item in repository.list_for_project(params.project_id, params.limit)]
        return TimelineVersionListResult(schemaVersion=1, versioningVersion="timeline-version-v1", projectId=params.project_id, activeVersionId=active_id, items=items)

    def get(self, params: TimelineVersionReferenceParams, database: Any) -> TimelineVersionResult:
        repository = TimelineVersionRepository(database)
        record = self._get(repository, params.project_id, params.version_id)
        return self._result(repository, params.project_id, "created", record)

    def activate(self, params: TimelineVersionActivateParams, database: Any) -> TimelineVersionResult:
        repository = TimelineVersionRepository(database)
        record = self._get(repository, params.project_id, params.version_id)
        self._check_expected(repository, params.project_id, params.expected_active_version_id)
        try:
            activated, _revision = repository.activate(params.project_id, record.id, self._revision(database, params.project_id))
        except StorageError as error:
            if error.code == "CONSTRAINT_VIOLATION":
                raise TimelineVersionError("TIMELINE_VERSION_CONFLICT") from error
            raise
        return self._result(repository, params.project_id, "activated", activated)

    def undo(self, params: TimelineVersionUndoParams, database: Any) -> TimelineVersionResult:
        repository = TimelineVersionRepository(database)
        active = self._current(repository, params.project_id, params.expected_active_version_id)
        if active.parent_version_id is None:
            raise TimelineVersionError("TIMELINE_NO_UNDO")
        parent = self._get(repository, params.project_id, active.parent_version_id)
        try:
            activated, _revision = repository.activate(params.project_id, parent.id, self._revision(database, params.project_id))
        except StorageError as error:
            if error.code == "CONSTRAINT_VIOLATION":
                raise TimelineVersionError("TIMELINE_VERSION_CONFLICT") from error
            raise
        return self._result(repository, params.project_id, "undo", activated)

    def redo(self, params: TimelineVersionRedoParams, database: Any) -> TimelineVersionResult:
        repository = TimelineVersionRepository(database)
        active = self._current(repository, params.project_id, params.expected_active_version_id)
        children = repository.children(params.project_id, active.id)
        if params.version_id is not None:
            children = [item for item in children if item.id == params.version_id]
            if not children:
                raise TimelineVersionError("TIMELINE_NO_REDO")
        elif len(children) == 0:
            raise TimelineVersionError("TIMELINE_NO_REDO")
        elif len(children) > 1:
            raise TimelineVersionError("TIMELINE_REDO_AMBIGUOUS")
        try:
            activated, _revision = repository.activate(params.project_id, children[0].id, self._revision(database, params.project_id))
        except StorageError as error:
            if error.code == "CONSTRAINT_VIOLATION":
                raise TimelineVersionError("TIMELINE_VERSION_CONFLICT") from error
            raise
        return self._result(repository, params.project_id, "redo", activated)

    def diff(self, params: TimelineVersionDiffParams, database: Any) -> TimelineVersionDiffResult:
        repository = TimelineVersionRepository(database)
        left = self._get(repository, params.project_id, params.from_version_id)
        right = self._get(repository, params.project_id, params.to_version_id)
        summary = _diff_timelines(left.timeline_json, right.timeline_json)
        return TimelineVersionDiffResult(schemaVersion=1, versioningVersion="timeline-version-v1", projectId=params.project_id, fromVersionId=left.id, toVersionId=right.id, summary=summary)

    @staticmethod
    def _idempotent(repository: TimelineVersionRepository, project_id: str, key: str | None) -> TimelineVersionRecord | None:
        return None if key is None else repository.get_by_idempotency(project_id, key)

    @staticmethod
    def _get(repository: TimelineVersionRepository, project_id: str, version_id: str) -> TimelineVersionRecord:
        try:
            return repository.get(version_id, project_id)
        except StorageError as error:
            if error.code == "RECORD_NOT_FOUND":
                try:
                    other_project_record = repository.get(version_id)
                except StorageError as lookup_error:
                    if lookup_error.code == "RECORD_NOT_FOUND":
                        raise TimelineVersionError("TIMELINE_VERSION_NOT_FOUND") from error
                    raise TimelineVersionError("TIMELINE_VERSION_INVALID") from lookup_error
                if other_project_record.project_id != project_id:
                    raise TimelineVersionError("TIMELINE_VERSION_PROJECT_MISMATCH") from error
                raise TimelineVersionError("TIMELINE_VERSION_NOT_FOUND") from error
            raise TimelineVersionError("TIMELINE_VERSION_INVALID") from error

    @staticmethod
    def _ensure_same_timeline(record: TimelineVersionRecord, timeline_id: str) -> None:
        if (record.timeline_id or record.timeline_json.get("id")) != timeline_id:
            raise TimelineVersionError("TIMELINE_VERSION_INVALID")

    def _activate_created(self, repository: TimelineVersionRepository, project_id: str, record: TimelineVersionRecord, expected: str | None) -> TimelineVersionResult:
        self._check_expected(repository, project_id, expected)
        try:
            activated, revision = repository.activate(project_id, record.id, self._revision(repository.database, project_id))
        except StorageError as error:
            if error.code == "CONSTRAINT_VIOLATION":
                raise TimelineVersionError("TIMELINE_VERSION_CONFLICT") from error
            raise
        return TimelineVersionResult(schemaVersion=1, versioningVersion="timeline-version-v1", projectId=project_id, operation="created", activeVersionId=activated.id, activeRevision=revision, version=self._snapshot(activated, True))

    @staticmethod
    def _check_expected(repository: TimelineVersionRepository, project_id: str, expected: str | None) -> None:
        current = repository.get_active(project_id)
        if expected is not None and (current is None or current.id != expected):
            raise TimelineVersionError("TIMELINE_VERSION_CONFLICT")

    @staticmethod
    def _current(repository: TimelineVersionRepository, project_id: str, expected: str | None) -> TimelineVersionRecord:
        current = repository.get_active(project_id)
        if current is None:
            raise TimelineVersionError("TIMELINE_ACTIVE_VERSION_MISSING")
        if expected is not None and expected != current.id:
            raise TimelineVersionError("TIMELINE_VERSION_CONFLICT")
        return current

    @staticmethod
    def _revision(database: Any, project_id: str) -> int:
        row = database.connection.execute("SELECT revision FROM timeline_active WHERE project_id = ?", (project_id,)).fetchone()
        return 0 if row is None else int(row[0])

    def _result(self, repository: TimelineVersionRepository, project_id: str, operation: str, record: TimelineVersionRecord) -> TimelineVersionResult:
        active = repository.get_active(project_id)
        return TimelineVersionResult(schemaVersion=1, versioningVersion="timeline-version-v1", projectId=project_id, operation=operation, activeVersionId=active.id if active else None, activeRevision=self._revision(repository.database, project_id), version=self._snapshot(record, active is not None and active.id == record.id))

    @staticmethod
    def _snapshot(record: TimelineVersionRecord, is_active: bool) -> TimelineVersionSnapshot:
        return TimelineVersionSnapshot(
            schemaVersion=1, versioningVersion="timeline-version-v1", projectId=record.project_id,
            versionId=record.id, timelineId=record.timeline_id or str(record.timeline_json.get("id", "")),
            versionNumber=record.version_number, parentVersionId=record.parent_version_id,
            sourceType=record.source_type, createdAtMs=record.created_at_ms, isActive=is_active,
            editIntent=record.edit_intent_json, diffSummary=record.diff_summary_json,
            timeline=record.timeline_json,
        )


def _diff_timelines(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    left_clips = {clip.get("id"): clip for track in left.get("tracks", []) for clip in track.get("clips", []) if isinstance(clip, dict) and isinstance(clip.get("id"), str)}
    right_clips = {clip.get("id"): clip for track in right.get("tracks", []) for clip in track.get("clips", []) if isinstance(clip, dict) and isinstance(clip.get("id"), str)}
    added = sorted(set(right_clips) - set(left_clips))[:64]
    removed = sorted(set(left_clips) - set(right_clips))[:64]
    changed = sorted(key for key in set(left_clips) & set(right_clips) if left_clips[key] != right_clips[key])[:64]
    return {
        "diffVersion": "timeline-diff-v1",
        "addedClipIds": added,
        "removedClipIds": removed,
        "changedClipIds": changed,
        "durationDeltaMs": int(right.get("durationMs", 0)) - int(left.get("durationMs", 0)),
        "sourceIdsChanged": sorted(set(item.get("id") for item in left.get("sources", []) if isinstance(item, dict)) ^ set(item.get("id") for item in right.get("sources", []) if isinstance(item, dict)))[:64],
        "provenanceIdsChanged": sorted(set(item.get("id") for item in left.get("provenance", []) if isinstance(item, dict)) ^ set(item.get("id") for item in right.get("provenance", []) if isinstance(item, dict)))[:64],
        "summary": f"{len(added)} added, {len(removed)} removed, {len(changed)} changed clip(s).",
    }
