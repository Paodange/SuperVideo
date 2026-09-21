"""Local, deterministic sentence-boundary QA over a B05 SentenceResult."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import tempfile
import uuid
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from supervideo_core.storage import AssetRepository

from .errors import MediaError
from .qa_models import (
    SENTENCE_QA_MAX_MARKERS,
    SENTENCE_QA_MAX_RESULT_BYTES,
    SENTENCE_QA_SCHEMA_VERSION,
    SENTENCE_QA_VERSION,
    SentencePlaybackAddress,
    SentenceQaContextItem,
    SentenceQaContextResult,
    SentenceQaMarker,
    SentenceQaMarkerInput,
    SentenceQaParams,
    SentenceQaSaveParams,
    SentenceQaSaveResult,
    validate_sentence_qa_size,
)
from .sentence_models import SentenceResult, validate_sentence_result_size


class SentenceQaService:
    """Read B05's immutable cache and atomically persist bounded QA markers."""

    def __init__(self) -> None:
        self._project_root: Path | None = None
        self._database: Any | None = None

    def bind_session(self, project_root: Path, database: Any) -> None:
        self._project_root = project_root
        self._database = database

    def inspect(self, request: SentenceQaParams) -> SentenceQaContextResult:
        project_root, _asset_path, asset_record = self._asset(request.project_id, request.asset_id)
        result = self._read_sentence_result(project_root, request)
        if request.sentence_index >= len(result.sentences):
            raise MediaError("SENTENCE_QA_INDEX_INVALID")
        markers = self._read_markers(project_root, request)
        items: list[SentenceQaContextItem] = []
        first = max(0, request.sentence_index - request.context_before)
        last = min(len(result.sentences), request.sentence_index + request.context_after + 1)
        for index in range(first, last):
            candidate = result.sentences[index]
            relation = "selected" if index == request.sentence_index else "before" if index < request.sentence_index else "after"
            items.append(SentenceQaContextItem(
                relation=relation,
                sentence=candidate,
                playback=self._playback(request.asset_id, asset_record.kind, candidate.start_ms, candidate.end_ms),
            ))
        try:
            return validate_sentence_qa_size(SentenceQaContextResult(
                schemaVersion=SENTENCE_QA_SCHEMA_VERSION,
                qaVersion=SENTENCE_QA_VERSION,
                projectId=request.project_id,
                assetId=request.asset_id,
                sentenceCacheKey=request.sentence_cache_key,
                selectedIndex=request.sentence_index,
                items=items,
                markers=markers,
            ))
        except (TypeError, ValueError, ValidationError) as error:
            raise MediaError("SENTENCE_QA_OUTPUT_INVALID", cause=error) from error

    def save(self, request: SentenceQaSaveParams) -> SentenceQaSaveResult:
        project_root, _asset_path, asset_record = self._asset(request.project_id, request.asset_id)
        sentence_result = self._read_sentence_result(project_root, request)
        now = _utc_now_ms()
        existing = self._read_markers(project_root, request)
        existing_by_key = {self._marker_key(item): item for item in existing}
        markers: list[SentenceQaMarker] = []
        for item in request.markers:
            if item.sentence_index >= len(sentence_result.sentences):
                raise MediaError("SENTENCE_QA_INDEX_INVALID")
            key = self._marker_key(item)
            previous = existing_by_key.get(key)
            marker_id = previous.marker_id if previous is not None else str(uuid.uuid5(uuid.NAMESPACE_URL, f"supervideo:{request.project_id}:{request.asset_id}:{request.sentence_cache_key}:{key}"))
            created_at = previous.created_at_ms if previous is not None else now
            try:
                markers.append(SentenceQaMarker(
                    markerId=marker_id,
                    sentenceIndex=item.sentence_index,
                    issueType=item.issue_type,
                    status=item.status,
                    source=item.source,
                    note=item.note,
                    expectedText=item.expected_text,
                    createdAtMs=created_at,
                    updatedAtMs=now,
                ))
            except (TypeError, ValueError, ValidationError) as error:
                raise MediaError("SENTENCE_QA_OUTPUT_INVALID", cause=error) from error
        markers.sort(key=lambda item: (item.sentence_index, item.issue_type, item.marker_id))
        revision = self._read_revision(project_root, request) + 1
        result = SentenceQaSaveResult(
            schemaVersion=SENTENCE_QA_SCHEMA_VERSION,
            qaVersion=SENTENCE_QA_VERSION,
            projectId=request.project_id,
            assetId=request.asset_id,
            sentenceCacheKey=request.sentence_cache_key,
            revision=revision,
            markers=markers,
        )
        validate_sentence_qa_size(result)
        target = self._marker_path(project_root, request)
        self._atomic_json_write(target, {
            "schemaVersion": SENTENCE_QA_SCHEMA_VERSION,
            "qaVersion": SENTENCE_QA_VERSION,
            "projectId": request.project_id,
            "assetId": request.asset_id,
            "sentenceCacheKey": request.sentence_cache_key,
            "revision": revision,
            "markers": [item.model_dump(by_alias=True) for item in markers],
            "resultDigest": self._digest(result.model_dump(by_alias=True)),
        })
        self._ensure_asset_unchanged(request.asset_id, _asset_path, asset_record)
        return result

    def _read_sentence_result(self, project_root: Path, request: SentenceQaParams) -> SentenceResult:
        target = project_root / "cache" / "sentence-cache-v1" / "sentences" / f"{request.sentence_cache_key}.json"
        try:
            value = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise MediaError("SENTENCE_QA_RESULT_NOT_FOUND", cause=error) from error
        if not isinstance(value, dict) or set(value) != {"schemaVersion", "cacheKey", "resultDigest", "result"} or value.get("schemaVersion") != 1 or value.get("cacheKey") != request.sentence_cache_key:
            raise MediaError("SENTENCE_QA_RESULT_INVALID")
        if not isinstance(value.get("resultDigest"), str) or value["resultDigest"] != self._digest(value.get("result")):
            raise MediaError("SENTENCE_QA_RESULT_INVALID")
        try:
            result = validate_sentence_result_size(SentenceResult.model_validate(value["result"]))
        except (TypeError, ValueError, ValidationError) as error:
            raise MediaError("SENTENCE_QA_RESULT_INVALID", cause=error) from error
        if result.project_id != request.project_id or result.asset_id != request.asset_id or result.cache_key != request.sentence_cache_key or result.cache_status != "created":
            raise MediaError("SENTENCE_QA_RESULT_INVALID")
        return result

    def _read_markers(self, project_root: Path, request: SentenceQaParams) -> list[SentenceQaMarker]:
        target = self._marker_path(project_root, request)
        if not target.exists():
            return []
        try:
            if target.stat().st_size > SENTENCE_QA_MAX_RESULT_BYTES:
                raise ValueError("QA manifest is too large")
            raw = target.read_bytes()
            if len(raw) > SENTENCE_QA_MAX_RESULT_BYTES:
                raise ValueError("QA manifest is too large")
            value = json.loads(raw.decode("utf-8"))
            if not isinstance(value, dict) or set(value) != {"schemaVersion", "qaVersion", "projectId", "assetId", "sentenceCacheKey", "revision", "markers", "resultDigest"}:
                raise ValueError("invalid QA manifest")
            if not isinstance(value["markers"], list) or len(value["markers"]) > SENTENCE_QA_MAX_MARKERS:
                raise ValueError("invalid QA marker count")
            digest_value = {key: value[key] for key in ("schemaVersion", "qaVersion", "projectId", "assetId", "sentenceCacheKey", "revision", "markers")}
            if value["resultDigest"] != self._digest(digest_value):
                raise ValueError("invalid QA digest")
            parsed = [SentenceQaMarker.model_validate(item) for item in value["markers"]]
            if value["schemaVersion"] != SENTENCE_QA_SCHEMA_VERSION or value["qaVersion"] != SENTENCE_QA_VERSION or value["projectId"] != request.project_id or value["assetId"] != request.asset_id or value["sentenceCacheKey"] != request.sentence_cache_key:
                raise ValueError("QA identity mismatch")
            return parsed
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError, ValidationError) as error:
            raise MediaError("SENTENCE_QA_STORAGE_INVALID", cause=error) from error

    def _read_revision(self, project_root: Path, request: SentenceQaParams) -> int:
        target = self._marker_path(project_root, request)
        if not target.exists():
            return 0
        try:
            value = json.loads(target.read_text(encoding="utf-8"))
            revision = value.get("revision")
            if not isinstance(revision, int) or revision < 0 or revision >= 2_000_000_000:
                raise ValueError("invalid QA revision")
            return revision
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as error:
            raise MediaError("SENTENCE_QA_STORAGE_INVALID", cause=error) from error

    @staticmethod
    def _marker_key(item: SentenceQaMarker | SentenceQaMarkerInput) -> str:
        return json.dumps({"sentenceIndex": item.sentence_index, "issueType": item.issue_type, "source": item.source, "note": item.note, "expectedText": item.expected_text}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    @staticmethod
    def _playback(asset_id: str, asset_kind: str, start_ms: int, end_ms: int) -> SentencePlaybackAddress:
        kind = "audio" if asset_kind == "audio" else "video"
        return SentencePlaybackAddress(assetId=asset_id, kind=kind, startMs=start_ms, endMs=end_ms, uri=f"supervideo://asset/{asset_id}?kind={kind}&startMs={start_ms}&endMs={end_ms}")

    @staticmethod
    def _digest(value: Any) -> str:
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _atomic_json_write(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=f".{path.name}-", suffix=".tmp", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(value, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def _marker_path(self, project_root: Path, request: SentenceQaParams) -> Path:
        target = project_root / "data" / "qa" / SENTENCE_QA_VERSION / request.asset_id / f"{request.sentence_cache_key}.json"
        try:
            for parent in (target.parent.parent.parent.parent, target.parent.parent.parent, target.parent.parent, target.parent):
                if parent.exists() and (parent.is_symlink() or not stat.S_ISDIR(os.lstat(parent).st_mode)):
                    raise MediaError("SENTENCE_QA_STORAGE_INVALID")
            target_stat = os.lstat(target) if target.exists() or target.is_symlink() else None
            if target_stat is not None and (stat.S_ISLNK(target_stat.st_mode) or not stat.S_ISREG(target_stat.st_mode)):
                raise MediaError("SENTENCE_QA_STORAGE_INVALID")
        except MediaError:
            raise
        except OSError as error:
            raise MediaError("SENTENCE_QA_STORAGE_INVALID", cause=error) from error
        return target

    def _asset(self, project_id: str, asset_id: str) -> tuple[Path, Path, Any]:
        from supervideo_core.project.errors import ProjectError
        from supervideo_core.project.paths import canonical_asset_path

        if self._project_root is None or self._database is None:
            raise ProjectError("PROJECT_NOT_ACTIVE")
        try:
            asset = AssetRepository(self._database).get(asset_id, project_id)
            path, _ = canonical_asset_path(asset.absolute_path)
            self._ensure_asset_unchanged(asset_id, path, asset)
        except ProjectError:
            raise
        except Exception as error:
            if getattr(error, "code", None) == "RECORD_NOT_FOUND":
                raise ProjectError("ASSET_NOT_FOUND") from error
            raise
        return self._project_root, path, asset

    def _ensure_asset_unchanged(self, asset_id: str, path: Path, asset: Any | None = None) -> None:
        from supervideo_core.project.errors import ProjectError
        from supervideo_core.project.paths import sampled_fingerprint, stat_signature

        try:
            before = path.stat()
            fingerprint = sampled_fingerprint(path, before)
            after = path.stat()
        except OSError as error:
            raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error
        if stat_signature(before) != stat_signature(after):
            raise ProjectError("ASSET_CHANGED_DURING_REFERENCE")
        if asset is None:
            raise ProjectError("ASSET_CHANGED")
        if (int(after.st_size), int(after.st_mtime_ns // 1_000_000)) != (asset.size_bytes, asset.modified_at_ms) or fingerprint != asset.content_fingerprint:
            raise ProjectError("ASSET_CHANGED")

def _utc_now_ms() -> int:
    import time
    return int(time.time() * 1_000)
