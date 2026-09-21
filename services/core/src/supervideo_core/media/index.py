"""B07 deterministic, local-only sentence indexing over a B05 result."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import stat
import tempfile
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from supervideo_core.storage import AssetRepository

from .errors import MediaError
from .index_models import (
    SENTENCE_INDEX_ADAPTER_VERSION,
    SENTENCE_INDEX_MAX_RESULT_BYTES,
    SENTENCE_INDEX_SCHEMA_VERSION,
    SENTENCE_INDEX_VERSION,
    SENTENCE_INDEX_VECTOR_DIMENSION,
    SENTENCE_INDEX_VECTOR_PROVIDER,
    SentenceIndexEntry,
    SentenceIndexParams,
    SentenceIndexResult,
    validate_sentence_index_size,
)
from .sentence_models import SENTENCE_MAX_RESULT_BYTES, SentenceResult, validate_sentence_result_size
from .sentences import SentenceService


_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9_-]{1,31}|\d{1,16}|[\u3400-\u9fff]+")
_CJK = re.compile(r"[\u3400-\u9fff]")
_STOPWORDS = frozenset("这是用于的了和与及在是有一个一种我们你我他她它其就都也而但如果因为所以可以能够需要进行这个那个以及没有不是非常比较关于通过根据里面里面现在已经然后他们她们自己".split())
_TOPIC_RULES = (
    ("招聘就业", frozenset(("招聘", "求职", "岗位", "工作", "员工", "工厂", "薪资", "工资", "福利"))),
    ("求职面试", frozenset(("简历", "面试", "应聘", "候选人", "经验", "学历"))),
    ("视频制作", frozenset(("视频", "剪辑", "素材", "字幕", "镜头", "成片"))),
    ("软件技术", frozenset(("软件", "系统", "代码", "技术", "数据", "接口", "项目"))),
)


class SentenceIndexService:
    """Index only trusted B05 data and write only inside the active project."""

    def __init__(self) -> None:
        self._project_root: Path | None = None
        self._database: Any | None = None

    def bind_session(self, project_root: Path, database: Any) -> None:
        self._project_root = project_root
        self._database = database

    async def build(self, request: SentenceIndexParams, cancelled: asyncio.Event) -> SentenceIndexResult:
        project_root, asset_path, asset_record = self._asset(request.project_id, request.asset_id)
        source = self._read_sentence_result(project_root, asset_path, request)
        target = self._index_path(project_root, request)
        cached = self._read_index_cache(target, request, source)
        if cached is not None:
            return cached.model_copy(update={"cache_status": "cache-hit"})

        task = asyncio.create_task(asyncio.to_thread(self._compute, project_root, request, source))
        cancel_wait = asyncio.create_task(cancelled.wait())
        try:
            done, _ = await asyncio.wait(
                {task, cancel_wait}, timeout=request.timeout_ms / 1_000, return_when=asyncio.FIRST_COMPLETED,
            )
            if cancel_wait in done and cancelled.is_set():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("SENTENCE_INDEX_CANCELLED")
            if task not in done:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("SENTENCE_INDEX_TIMEOUT")
            result, manifest = await task
        except MediaError:
            raise
        except asyncio.CancelledError:
            raise
        except Exception as error:
            raise MediaError("SENTENCE_INDEX_OUTPUT_INVALID", cause=error) from error
        finally:
            cancel_wait.cancel()
            await asyncio.gather(cancel_wait, return_exceptions=True)

        self._ensure_asset_unchanged(asset_path, asset_record)
        self._atomic_json_write(target, manifest)
        return result

    def _compute(self, project_root: Path, request: SentenceIndexParams, source: SentenceResult) -> tuple[SentenceIndexResult, dict[str, Any]]:
        previous = self._previous_entries(project_root, request, source)
        entries: list[SentenceIndexEntry] = []
        reused = 0
        for sentence in source.sentences:
            sentence_id = self._sentence_id(request.project_id, request.asset_id, sentence)
            old = previous.get(sentence_id)
            if old is not None:
                entry = old.model_copy(update={"source_sentence_cache_key": source.cache_key})
                reused += 1
            else:
                keywords = _keywords(sentence.text)
                entries.append(self._entry(request, source, sentence, sentence_id, keywords))
                continue
            entries.append(entry)

        result_value = {
            "schemaVersion": SENTENCE_INDEX_SCHEMA_VERSION,
            "indexVersion": SENTENCE_INDEX_VERSION,
            "projectId": request.project_id,
            "assetId": request.asset_id,
            "cacheStatus": "created",
            "cacheKey": self._index_cache_key(request, source),
            "sourceSentenceCacheKey": source.cache_key,
            "sourceSentenceResultDigest": self._sentence_digest(source),
            "adapterVersion": SENTENCE_INDEX_ADAPTER_VERSION,
            "vectorProvider": SENTENCE_INDEX_VECTOR_PROVIDER,
            "vectorDimension": SENTENCE_INDEX_VECTOR_DIMENSION,
            "reusedCount": reused,
            "rebuiltCount": len(entries) - reused,
            "entries": [entry.model_dump(by_alias=True) for entry in entries],
        }
        try:
            result = validate_sentence_index_size(SentenceIndexResult.model_validate(result_value))
        except (TypeError, ValueError, ValidationError) as error:
            raise MediaError("SENTENCE_INDEX_OUTPUT_INVALID", cause=error) from error
        manifest = {
            "schemaVersion": SENTENCE_INDEX_SCHEMA_VERSION,
            "indexVersion": SENTENCE_INDEX_VERSION,
            "cacheKey": result.cache_key,
            "sourceSentenceCacheKey": source.cache_key,
            "sourceSentenceResultDigest": result.source_sentence_result_digest,
            "resultDigest": self._digest(result.model_dump(by_alias=True)),
            "result": result.model_dump(by_alias=True),
        }
        if len(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > SENTENCE_INDEX_MAX_RESULT_BYTES:
            raise MediaError("SENTENCE_INDEX_OUTPUT_INVALID")
        return result, manifest

    def _entry(self, request: SentenceIndexParams, source: SentenceResult, sentence: Any, sentence_id: str, keywords: list[str]) -> SentenceIndexEntry:
        try:
            return SentenceIndexEntry(
                sentenceId=sentence_id,
                sourceAssetId=request.asset_id,
                sentenceIndex=sentence.index,
                sourceSentenceCacheKey=source.cache_key,
                startMs=sentence.start_ms,
                endMs=sentence.end_ms,
                text=sentence.text,
                keywords=keywords,
                topics=_topics(sentence.text, keywords),
                vector=_vector(sentence.text),
                confidence=sentence.confidence,
                quality=sentence.quality,
                qualityReasons=list(sentence.quality_reasons),
            )
        except (TypeError, ValueError, ValidationError) as error:
            raise MediaError("SENTENCE_INDEX_OUTPUT_INVALID", cause=error) from error

    def _read_sentence_result(self, project_root: Path, asset_path: Path, request: SentenceIndexParams) -> SentenceResult:
        target = self._safe_path(project_root, ("cache", "sentence-cache-v1", "sentences", f"{request.sentence_cache_key}.json"), "SENTENCE_INDEX_SOURCE_INVALID", allow_missing=True)
        if not target.exists():
            raise MediaError("SENTENCE_INDEX_SOURCE_NOT_FOUND")
        try:
            if target.stat().st_size > SENTENCE_MAX_RESULT_BYTES:
                raise ValueError("B05 result is too large")
            value = json.loads(target.read_text(encoding="utf-8"))
            if not isinstance(value, dict) or set(value) != {"schemaVersion", "cacheKey", "resultDigest", "result"}:
                raise ValueError("invalid B05 manifest")
            if value["schemaVersion"] != 1 or value["cacheKey"] != request.sentence_cache_key or value["resultDigest"] != self._digest(value.get("result")):
                raise ValueError("invalid B05 digest")
            result = validate_sentence_result_size(SentenceResult.model_validate(value["result"]))
            if result.project_id != request.project_id or result.asset_id != request.asset_id or result.cache_key != request.sentence_cache_key or result.cache_status != "created":
                raise ValueError("B05 identity mismatch")
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError, ValidationError) as error:
            raise MediaError("SENTENCE_INDEX_SOURCE_INVALID", cause=error) from error

        try:
            signature, fingerprint = SentenceService._asset_signature(asset_path)
            expected = SentenceService._cache_key(request.project_id, asset_path, signature, fingerprint, result.config)
        except Exception as error:
            raise MediaError("SENTENCE_INDEX_SOURCE_STALE", cause=error) from error
        if expected != request.sentence_cache_key:
            raise MediaError("SENTENCE_INDEX_SOURCE_STALE")
        return result

    def _read_index_cache(self, target: Path, request: SentenceIndexParams, source: SentenceResult) -> SentenceIndexResult | None:
        if not target.exists():
            return None
        try:
            if target.stat().st_size > SENTENCE_INDEX_MAX_RESULT_BYTES:
                return None
            value = json.loads(target.read_text(encoding="utf-8"))
            if not isinstance(value, dict) or set(value) != {"schemaVersion", "indexVersion", "cacheKey", "sourceSentenceCacheKey", "sourceSentenceResultDigest", "resultDigest", "result"}:
                return None
            if value["schemaVersion"] != SENTENCE_INDEX_SCHEMA_VERSION or value["indexVersion"] != SENTENCE_INDEX_VERSION:
                return None
            if value["sourceSentenceCacheKey"] != source.cache_key or value["sourceSentenceResultDigest"] != self._sentence_digest(source):
                return None
            if value["resultDigest"] != self._digest(value.get("result")):
                return None
            result = validate_sentence_index_size(SentenceIndexResult.model_validate(value["result"]))
            if value["cacheKey"] != result.cache_key or value["sourceSentenceCacheKey"] != result.source_sentence_cache_key or value["sourceSentenceResultDigest"] != result.source_sentence_result_digest:
                return None
            if result.project_id != request.project_id or result.asset_id != request.asset_id or result.source_sentence_cache_key != source.cache_key or result.source_sentence_result_digest != self._sentence_digest(source) or result.cache_status != "created":
                return None
            return result
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError, ValidationError):
            return None

    def _previous_entries(self, project_root: Path, request: SentenceIndexParams, source: SentenceResult) -> dict[str, SentenceIndexEntry]:
        directory = self._safe_path(project_root, ("cache", SENTENCE_INDEX_VERSION, "indexes"), "SENTENCE_INDEX_STORAGE_INVALID", allow_missing=True, expect_directory=True)
        if not directory.exists():
            return {}
        previous: dict[str, SentenceIndexEntry] = {}
        try:
            children = list(directory.iterdir())[:128]
        except OSError:
            return previous
        for child in children:
            if child.suffix != ".json" or child.name == f"{source.cache_key}.json":
                continue
            try:
                child_stat = os.lstat(child)
                if stat.S_ISLNK(child_stat.st_mode) or not stat.S_ISREG(child_stat.st_mode) or child_stat.st_size > SENTENCE_INDEX_MAX_RESULT_BYTES:
                    continue
                value = json.loads(child.read_text(encoding="utf-8"))
                if not isinstance(value, dict) or value.get("indexVersion") != SENTENCE_INDEX_VERSION or value.get("resultDigest") != self._digest(value.get("result")):
                    continue
                candidate = validate_sentence_index_size(SentenceIndexResult.model_validate(value["result"]))
                if candidate.project_id != request.project_id or candidate.asset_id != request.asset_id:
                    continue
                for entry in candidate.entries:
                    previous.setdefault(entry.sentence_id, entry)
            except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError, ValidationError):
                continue
        return previous

    def _index_path(self, project_root: Path, request: SentenceIndexParams) -> Path:
        return self._safe_path(project_root, ("cache", SENTENCE_INDEX_VERSION, "indexes", f"{request.sentence_cache_key}.json"), "SENTENCE_INDEX_STORAGE_INVALID", allow_missing=True)

    def _asset(self, project_id: str, asset_id: str) -> tuple[Path, Path, Any]:
        from supervideo_core.project.errors import ProjectError
        from supervideo_core.project.paths import canonical_asset_path

        if self._database is None or self._project_root is None:
            raise ProjectError("PROJECT_NOT_ACTIVE")
        try:
            asset = AssetRepository(self._database).get(asset_id, project_id)
            path, _ = canonical_asset_path(asset.absolute_path)
            self._ensure_asset_unchanged(path, asset)
        except ProjectError:
            raise
        except Exception as error:
            if getattr(error, "code", None) == "RECORD_NOT_FOUND":
                raise ProjectError("ASSET_NOT_FOUND") from error
            raise
        return self._project_root, path, asset

    @staticmethod
    def _ensure_asset_unchanged(path: Path, asset: Any) -> None:
        from supervideo_core.project.paths import sampled_fingerprint, stat_signature
        from supervideo_core.project.errors import ProjectError

        try:
            before = path.stat()
            fingerprint = sampled_fingerprint(path, before)
            after = path.stat()
        except OSError as error:
            raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error
        if stat_signature(before) != stat_signature(after):
            raise ProjectError("ASSET_CHANGED_DURING_REFERENCE")
        if (int(after.st_size), int(after.st_mtime_ns // 1_000_000)) != (asset.size_bytes, asset.modified_at_ms) or fingerprint != asset.content_fingerprint:
            raise ProjectError("ASSET_CHANGED")

    @staticmethod
    def _sentence_id(project_id: str, asset_id: str, sentence: Any) -> str:
        value = {"projectId": project_id, "assetId": asset_id, "sentenceIndex": sentence.index, "startMs": sentence.start_ms, "endMs": sentence.end_ms, "text": sentence.text, "sourceSegmentIndexes": sentence.source_segment_indexes}
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _index_cache_key(request: SentenceIndexParams, source: SentenceResult) -> str:
        value = {"version": SENTENCE_INDEX_VERSION, "projectId": request.project_id, "assetId": request.asset_id, "sourceSentenceCacheKey": source.cache_key, "sourceSentenceResultDigest": SentenceIndexService._sentence_digest(source), "adapterVersion": SENTENCE_INDEX_ADAPTER_VERSION}
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _sentence_digest(result: SentenceResult) -> str:
        return SentenceIndexService._digest(result.model_dump(by_alias=True))

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
                if expect_directory:
                    if not stat.S_ISDIR(target_stat.st_mode):
                        raise MediaError(error_code)
                elif not stat.S_ISREG(target_stat.st_mode):
                    raise MediaError(error_code)
            if not allow_missing and not target.exists():
                raise MediaError(error_code)
        except MediaError:
            raise
        except OSError as error:
            raise MediaError(error_code, cause=error) from error
        return target

    @staticmethod
    def _atomic_json_write(path: Path, value: dict[str, Any]) -> None:
        try:
            project_root = path.parents[3]
            SentenceIndexService._safe_path(project_root, ("cache", SENTENCE_INDEX_VERSION, "indexes", path.name), "SENTENCE_INDEX_STORAGE_INVALID", allow_missing=True)
            path.parent.mkdir(parents=True, exist_ok=True)
            SentenceIndexService._safe_path(project_root, ("cache", SENTENCE_INDEX_VERSION, "indexes", path.name), "SENTENCE_INDEX_STORAGE_INVALID", allow_missing=True)
            fd, temporary = tempfile.mkstemp(prefix=f".{path.name}-", suffix=".tmp", dir=str(path.parent))
            try:
                with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                    json.dump(value, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, path)
            finally:
                Path(temporary).unlink(missing_ok=True)
        except MediaError:
            raise
        except OSError as error:
            raise MediaError("SENTENCE_INDEX_STORAGE_INVALID", cause=error) from error


def _keywords(text: str) -> list[str]:
    counts: dict[str, tuple[int, int]] = {}
    for match in _TOKEN.finditer(text.lower()):
        token = match.group(0)
        if _CJK.fullmatch(token):
            candidates = [token] if len(token) <= 6 else []
            candidates.extend(token[index:index + 2] for index in range(max(0, len(token) - 1)))
            if len(token) >= 3:
                candidates.extend(token[index:index + 3] for index in range(len(token) - 2))
        else:
            candidates = [token]
        for candidate in candidates:
            if candidate in _STOPWORDS or len(candidate) == 1 and _CJK.fullmatch(candidate):
                continue
            count, first = counts.get(candidate, (0, match.start()))
            counts[candidate] = (count + 1, min(first, match.start()))
    ordered = sorted(counts, key=lambda item: (-counts[item][0], -len(item), counts[item][1], item))
    return ordered[:32] or ["语句"]


def _topics(text: str, keywords: list[str]) -> list[str]:
    topics = [name for name, terms in _TOPIC_RULES if any(term in text or term in keywords for term in terms)]
    if not topics:
        topics = [f"主题:{keywords[0]}"]
    return topics[:8]


def _vector(text: str) -> list[float]:
    seed = hashlib.sha256(f"{SENTENCE_INDEX_VECTOR_PROVIDER}\0{text}".encode("utf-8")).digest()
    digest = seed + hashlib.sha256(seed).digest()
    raw = [int.from_bytes(digest[index:index + 2], "big", signed=False) / 32_767.5 - 1 for index in range(0, 64, 2)]
    magnitude = math.sqrt(sum(item * item for item in raw)) or 1.0
    return [float(round(item / magnitude, 8)) for item in raw]
