"""B08 deterministic hybrid retrieval over validated B07 sentence indexes."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import stat
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from supervideo_core.storage import AssetRepository, StorageError

from .errors import MediaError
from .index import SentenceIndexService, _CJK, _STOPWORDS, _TOKEN, _topics, _vector
from .index_models import (
    SENTENCE_INDEX_MAX_RESULT_BYTES,
    SENTENCE_INDEX_SCHEMA_VERSION,
    SENTENCE_INDEX_VERSION,
    SENTENCE_INDEX_VECTOR_PROVIDER,
    SentenceIndexParams,
    SentenceIndexResult,
    validate_sentence_index_size,
)
from .retrieval_models import (
    RETRIEVAL_SCHEMA_VERSION,
    RETRIEVAL_VERSION,
    RetrievalCandidate,
    RetrievalExplanation,
    RetrievalParams,
    RetrievalResult,
    RetrievalTimecode,
    validate_retrieval_size,
)


def _retrieval_keywords(text: str) -> list[str]:
    """Use the B07 token policy with the CJK n-gram branch corrected for search."""

    counts: dict[str, tuple[int, int]] = {}
    for match in _TOKEN.finditer(text.lower()):
        token = match.group(0)
        if token and _CJK.fullmatch(token[0]):
            candidates = [token] if len(token) <= 6 else []
            candidates.extend(token[index:index + 2] for index in range(max(0, len(token) - 1)))
            if len(token) >= 3:
                candidates.extend(token[index:index + 3] for index in range(len(token) - 2))
        else:
            candidates = [token]
        for candidate in candidates:
            if candidate in _STOPWORDS or (len(candidate) == 1 and _CJK.fullmatch(candidate)):
                continue
            count, first = counts.get(candidate, (0, match.start()))
            counts[candidate] = (count + 1, min(first, match.start()))
    ordered = sorted(counts, key=lambda item: (-counts[item][0], -len(item), counts[item][1], item))
    return ordered[:32] or ["语句"]


class SentenceRetrievalService:
    """Read-only retrieval. It never accepts or resolves a caller path."""

    def __init__(self) -> None:
        self._project_root: Path | None = None
        self._database: Any | None = None

    def bind_session(self, project_root: Path, database: Any) -> None:
        self._project_root = project_root
        self._database = database

    async def search(self, request: RetrievalParams, cancelled: asyncio.Event) -> RetrievalResult:
        from supervideo_core.project.errors import ProjectError

        if self._project_root is None or self._database is None:
            raise ProjectError("PROJECT_NOT_ACTIVE")
        assets = self._resolve_assets(request)
        task = asyncio.create_task(asyncio.to_thread(self._search_sync, request, assets))
        cancel_wait = asyncio.create_task(cancelled.wait())
        try:
            done, _ = await asyncio.wait(
                {task, cancel_wait}, timeout=request.timeout_ms / 1_000, return_when=asyncio.FIRST_COMPLETED,
            )
            if cancel_wait in done and cancelled.is_set():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("RETRIEVAL_CANCELLED")
            if task not in done:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("RETRIEVAL_TIMEOUT")
            return await task
        except (MediaError, ProjectError, asyncio.CancelledError):
            raise
        except Exception as error:
            raise MediaError("RETRIEVAL_OUTPUT_INVALID", cause=error) from error
        finally:
            cancel_wait.cancel()
            await asyncio.gather(cancel_wait, return_exceptions=True)

    def _search_sync(self, request: RetrievalParams, assets: dict[str, tuple[Path, Any]]) -> RetrievalResult:
        from supervideo_core.project.errors import ProjectError

        project_root = self._project_root
        database = self._database
        if project_root is None or database is None:
            raise ProjectError("PROJECT_NOT_ACTIVE")
        indexes, invalid, stale = self._load_indexes(project_root, request, assets)
        if invalid:
            raise MediaError("RETRIEVAL_INDEX_INVALID")
        if stale:
            raise MediaError("RETRIEVAL_INDEX_STALE")
        if not indexes:
            raise MediaError("RETRIEVAL_INDEX_NOT_FOUND")

        query_keywords = _retrieval_keywords(request.query)
        query_topics = _topics(request.query, query_keywords)
        query_vector = _vector(request.query)
        candidates: list[RetrievalCandidate] = []
        for index in indexes:
            for entry in index.entries:
                if not self._matches_filters(entry, request):
                    continue
                matched_keywords = sorted(set(query_keywords).intersection(_retrieval_keywords(entry.text)))
                matched_topics = sorted(set(query_topics).intersection(entry.topics))
                lexical = self._lexical_score(query_keywords, matched_keywords, matched_topics)
                vector = self._vector_score(query_vector, entry.vector)
                hybrid = round(lexical * 0.6 + vector * 0.4, 8)
                score = lexical if request.mode == "lexical" else vector if request.mode == "vector" else hybrid
                formula = (
                    "lexical-keyword-overlap-v1" if request.mode == "lexical"
                    else "vector-cosine-v1" if request.mode == "vector"
                    else "hybrid-0.6-0.4-v1"
                )
                candidates.append(RetrievalCandidate(
                    rank=1,
                    sentenceId=entry.sentence_id,
                    sourceAssetId=entry.source_asset_id,
                    sourceSentenceCacheKey=entry.source_sentence_cache_key,
                    sentenceIndex=entry.sentence_index,
                    timecode=RetrievalTimecode(startMs=entry.start_ms, endMs=entry.end_ms),
                    text=entry.text,
                    lexicalScore=round(lexical, 8),
                    vectorScore=round(vector, 8),
                    hybridScore=hybrid,
                    score=round(score, 8),
                    explanation=RetrievalExplanation(
                        queryKeywords=query_keywords,
                        matchedKeywords=matched_keywords,
                        matchedTopics=matched_topics,
                        vectorProvider=SENTENCE_INDEX_VECTOR_PROVIDER,
                        scoreFormula=formula,
                    ),
                    confidence=entry.confidence,
                    quality=entry.quality,
                    qualityReasons=list(entry.quality_reasons),
                    previewUri=f"supervideo://asset/{entry.source_asset_id}?kind=audio&startMs={entry.start_ms}&endMs={entry.end_ms}",
                ))

        candidates.sort(key=lambda item: (-item.score, item.sentence_id, item.source_asset_id, item.sentence_index))
        selected = [candidate.model_copy(update={"rank": rank}) for rank, candidate in enumerate(candidates[:request.limit], start=1)]
        try:
            return validate_retrieval_size(RetrievalResult(
                schemaVersion=RETRIEVAL_SCHEMA_VERSION,
                retrievalVersion=RETRIEVAL_VERSION,
                projectId=request.project_id,
                query=request.query,
                mode=request.mode,
                limit=request.limit,
                candidateCount=len(selected),
                candidates=selected,
            ))
        except (TypeError, ValueError, ValidationError) as error:
            raise MediaError("RETRIEVAL_OUTPUT_INVALID", cause=error) from error

    def _resolve_assets(self, request: RetrievalParams) -> dict[str, tuple[Path, Any]]:
        from supervideo_core.project.errors import ProjectError

        if self._database is None:
            raise ProjectError("PROJECT_NOT_ACTIVE")
        repository = AssetRepository(self._database)
        try:
            if request.asset_ids is None:
                records = repository.list_for_project(request.project_id, limit=1_000)
            else:
                records = [repository.get(asset_id, request.project_id) for asset_id in request.asset_ids]
        except StorageError as error:
            if getattr(error, "code", None) == "RECORD_NOT_FOUND":
                raise ProjectError("ASSET_NOT_FOUND") from error
            raise
        resolved: dict[str, tuple[Path, Any]] = {}
        from supervideo_core.project.paths import canonical_asset_path

        for asset in records:
            try:
                path, _ = canonical_asset_path(asset.absolute_path)
                SentenceIndexService._ensure_asset_unchanged(path, asset)
            except ProjectError:
                raise
            except Exception as error:
                raise ProjectError("ASSET_CHANGED", cause=error) from error
            resolved[asset.id] = (path, asset)
        return resolved

    def _load_indexes(
        self,
        project_root: Path,
        request: RetrievalParams,
        assets: dict[str, tuple[Path, Any]],
    ) -> tuple[list[SentenceIndexResult], bool, bool]:
        directory = self._safe_path(project_root, ("cache", SENTENCE_INDEX_VERSION, "indexes"), "RETRIEVAL_STORAGE_INVALID", allow_missing=True, expect_directory=True)
        if not directory.exists():
            return [], False, False
        manifests: list[tuple[str, dict[str, Any]]] = []
        invalid = False
        try:
            children = sorted(directory.iterdir(), key=lambda item: item.name)[:2_048]
        except OSError as error:
            raise MediaError("RETRIEVAL_STORAGE_INVALID", cause=error) from error
        for child in children:
            if child.suffix != ".json":
                continue
            value: Any = None
            in_scope = False
            try:
                child_stat = os.lstat(child)
                if stat.S_ISLNK(child_stat.st_mode) or not stat.S_ISREG(child_stat.st_mode):
                    continue
                if child_stat.st_size > SENTENCE_INDEX_MAX_RESULT_BYTES:
                    continue
                value = json.loads(child.read_text(encoding="utf-8"))
                in_scope = self._manifest_in_scope(value, request, assets)
                if not isinstance(value, dict) or set(value) != {"schemaVersion", "indexVersion", "cacheKey", "sourceSentenceCacheKey", "sourceSentenceResultDigest", "resultDigest", "result"}:
                    invalid = invalid or in_scope
                    continue
                if value["schemaVersion"] != SENTENCE_INDEX_SCHEMA_VERSION or value["indexVersion"] != SENTENCE_INDEX_VERSION:
                    invalid = invalid or in_scope
                    continue
                if value["resultDigest"] != self._digest(value.get("result")):
                    invalid = invalid or in_scope
                    continue
                result = validate_sentence_index_size(SentenceIndexResult.model_validate(value["result"]))
                if result.cache_status != "created" or value["cacheKey"] != result.cache_key or value["sourceSentenceCacheKey"] != result.source_sentence_cache_key or value["sourceSentenceResultDigest"] != result.source_sentence_result_digest:
                    invalid = invalid or (result.project_id == request.project_id and result.asset_id in assets)
                    continue
                if result.project_id != request.project_id or result.asset_id not in assets:
                    continue
                manifests.append((result.source_sentence_cache_key, value))
            except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError, ValidationError):
                # Do not disclose filenames. Only a manifest that can be
                # attributed to the requested project/assets affects the
                # request; unrelated project caches cannot poison this scope.
                invalid = invalid or in_scope

        by_asset: dict[str, list[SentenceIndexResult]] = {}
        stale = False
        source_service = SentenceIndexService()
        for source_cache_key, manifest in manifests:
            try:
                result = validate_sentence_index_size(SentenceIndexResult.model_validate(manifest["result"]))
                asset_path, _asset = assets[result.asset_id]
                source = source_service._read_sentence_result(
                    project_root,
                    asset_path,
                    SentenceIndexParams(projectId=request.project_id, assetId=result.asset_id, sentenceCacheKey=source_cache_key),
                )
                if source.cache_key != result.source_sentence_cache_key or source.project_id != request.project_id or source.asset_id != result.asset_id:
                    raise MediaError("RETRIEVAL_INDEX_INVALID")
                if result.source_sentence_result_digest != self._sentence_digest(source):
                    raise MediaError("RETRIEVAL_INDEX_STALE")
                by_asset.setdefault(result.asset_id, []).append(result)
            except MediaError as error:
                if error.code == "RETRIEVAL_INDEX_STALE" or error.code == "SENTENCE_INDEX_SOURCE_STALE":
                    stale = True
                else:
                    invalid = True

        selected: list[SentenceIndexResult] = []
        for asset_id in sorted(assets):
            options = by_asset.get(asset_id, [])
            if options:
                selected.append(sorted(options, key=lambda item: item.source_sentence_cache_key)[-1])
        return selected, invalid, stale

    @staticmethod
    def _manifest_in_scope(value: Any, request: RetrievalParams, assets: dict[str, tuple[Path, Any]]) -> bool:
        if not isinstance(value, dict) or not isinstance(value.get("result"), dict):
            return False
        result = value["result"]
        return result.get("projectId") == request.project_id and result.get("assetId") in assets

    @staticmethod
    def _matches_filters(entry: Any, request: RetrievalParams) -> bool:
        filters = request.filters
        if filters.topics and not set(filters.topics).intersection(entry.topics):
            return False
        if filters.quality is not None and entry.quality != filters.quality:
            return False
        if filters.min_confidence is not None and (entry.confidence is None or entry.confidence < filters.min_confidence):
            return False
        if filters.start_ms is not None and entry.end_ms <= filters.start_ms:
            return False
        if filters.end_ms is not None and entry.start_ms >= filters.end_ms:
            return False
        return True

    @staticmethod
    def _lexical_score(query_keywords: list[str], matched_keywords: list[str], matched_topics: list[str]) -> float:
        if not query_keywords:
            return 0.0
        coverage = len(matched_keywords) / len(query_keywords)
        topic_bonus = 0.2 if matched_topics else 0.0
        return min(1.0, round(coverage * 0.8 + topic_bonus, 8))

    @staticmethod
    def _vector_score(query_vector: list[float], candidate_vector: list[float]) -> float:
        cosine = sum(left * right for left, right in zip(query_vector, candidate_vector, strict=True))
        return max(0.0, min(1.0, round(cosine, 8)))

    @staticmethod
    def _sentence_digest(result: Any) -> str:
        return SentenceRetrievalService._digest(result.model_dump(by_alias=True))

    @staticmethod
    def _digest(value: Any) -> str:
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _safe_path(root: Path, parts: tuple[str, ...], error_code: str, *, allow_missing: bool = False, expect_directory: bool = False) -> Path:
        target = root.joinpath(*parts)
        try:
            current = root
            for part in parts[:-1]:
                current = current / part
                if current.exists() or current.is_symlink():
                    current_stat = os.lstat(current)
                    if stat.S_ISLNK(current_stat.st_mode) or not stat.S_ISDIR(current_stat.st_mode):
                        raise MediaError(error_code)
            if target.exists() or target.is_symlink():
                target_stat = os.lstat(target)
                if stat.S_ISLNK(target_stat.st_mode):
                    raise MediaError(error_code)
                if expect_directory and not stat.S_ISDIR(target_stat.st_mode):
                    raise MediaError(error_code)
                if not expect_directory and not stat.S_ISREG(target_stat.st_mode):
                    raise MediaError(error_code)
            if not allow_missing and not target.exists():
                raise MediaError(error_code)
        except MediaError:
            raise
        except OSError as error:
            raise MediaError(error_code, cause=error) from error
        return target
