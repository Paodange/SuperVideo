"""Deterministic V1 complete-sentence segmentation over ASR and VAD results."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from supervideo_core.storage import AssetRepository

from .errors import MediaError
from .sentence_models import (
    SENTENCE_ADAPTER_VERSION,
    SENTENCE_CACHE_VERSION,
    SENTENCE_MAX_DURATION_MS,
    SENTENCE_SCHEMA_VERSION,
    SentenceCandidate,
    SentenceConfig,
    SentenceParams,
    SentenceResult,
    validate_sentence_result_size,
)
from .transcription_models import (
    TRANSCRIPTION_ADAPTER_VERSION,
    TRANSCRIPTION_SCHEMA_VERSION,
    TranscriptionResult,
)
from .vad_models import VAD_ADAPTER_VERSION, VAD_SCHEMA_VERSION, VadResult


END_PUNCTUATION = frozenset("。！？!?；;．")
LOW_CONFIDENCE = 0.6
_SPACE = re.compile(r"\s+")
_REPEATED_PUNCTUATION = re.compile(r"([，,。！？!?；;：:])\1+")
_SENTENCE_SPLIT = re.compile(r"(.+?[。！？!?；;．](?:[”’'\"）)】》]*)|.+$)", re.S)
_TRAILING_PUNCTUATION = re.compile(r"([。！？!?；;．]+[”’'\"）)】》]*)$")


@dataclass
class _Piece:
    start_ms: int
    end_ms: int
    text: str
    segment_indexes: set[int] = field(default_factory=set)
    confidence: float | None = None
    punctuated: bool = False


@dataclass
class _Group:
    pieces: list[_Piece] = field(default_factory=list)
    reasons: set[str] = field(default_factory=set)

    @property
    def start_ms(self) -> int:
        return self.pieces[0].start_ms

    @property
    def end_ms(self) -> int:
        return self.pieces[-1].end_ms

    @property
    def text(self) -> str:
        return normalize_text("".join(piece.text for piece in self.pieces))

    @property
    def confidence(self) -> float | None:
        values = [piece.confidence for piece in self.pieces if piece.confidence is not None]
        return None if not values else sum(values) / len(values)

    @property
    def punctuated(self) -> bool:
        return self.pieces[-1].punctuated


class SentenceService:
    """Build complete-sentence candidates using only local structured results."""

    def __init__(self, *, transcription_service: Any, vad_service: Any) -> None:
        self.transcription_service = transcription_service
        self.vad_service = vad_service
        self._project_root: Path | None = None
        self._database: Any | None = None

    def bind_session(self, project_root: Path, database: Any) -> None:
        self._project_root = project_root
        self._database = database

    async def split(self, request: SentenceParams, cancelled: asyncio.Event) -> SentenceResult:
        project_root, asset_path, _asset = self._asset(request.project_id, request.asset_id)
        signature, fingerprint = self._asset_signature(asset_path)
        key = self._cache_key(request.project_id, asset_path, signature, fingerprint, request.config)
        target = project_root / "cache" / SENTENCE_CACHE_VERSION / "sentences" / f"{key}.json"
        cached = self._read_cache(target, key, request.project_id, request.asset_id, request.config)
        if cached is not None:
            return cached.model_copy(update={"cache_status": "cache-hit"})

        task = asyncio.create_task(self._compute(request, cancelled, key))
        cancel_wait = asyncio.create_task(cancelled.wait())
        try:
            done, _ = await asyncio.wait(
                {task, cancel_wait}, timeout=request.timeout_ms / 1_000, return_when=asyncio.FIRST_COMPLETED,
            )
            if cancel_wait in done and cancelled.is_set():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("SENTENCE_CANCELLED")
            if task not in done:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("SENTENCE_TIMEOUT")
            result = await task
        finally:
            cancel_wait.cancel()
            await asyncio.gather(cancel_wait, return_exceptions=True)

        self._ensure_unchanged(asset_path, signature, fingerprint)
        result_value = result.model_dump(by_alias=True)
        self._atomic_json_write(target, {"schemaVersion": SENTENCE_SCHEMA_VERSION, "cacheKey": key, "resultDigest": self._result_digest(result_value), "result": result_value})
        return result

    async def _compute(self, request: SentenceParams, cancelled: asyncio.Event, key: str) -> SentenceResult:
        from .transcription_models import TranscriptionParams
        from .vad_models import VadParams

        if cancelled.is_set():
            raise MediaError("SENTENCE_CANCELLED")
        try:
            transcription_task = asyncio.create_task(self.transcription_service.transcribe(
                TranscriptionParams(projectId=request.project_id, assetId=request.asset_id, timeoutMs=request.timeout_ms), cancelled,
            ))
            vad_task = asyncio.create_task(self.vad_service.detect(
                VadParams(projectId=request.project_id, assetId=request.asset_id, timeoutMs=request.timeout_ms), cancelled,
            ))
            transcription, vad = await asyncio.gather(transcription_task, vad_task)
        except asyncio.CancelledError:
            raise
        except MediaError as error:
            if error.code in {"TRANSCRIPTION_CANCELLED", "VAD_CANCELLED"}:
                raise MediaError("SENTENCE_CANCELLED", cause=error) from error
            if error.code in {"TRANSCRIPTION_TIMEOUT", "VAD_TIMEOUT"}:
                raise MediaError("SENTENCE_TIMEOUT", cause=error) from error
            if error.code in {"TRANSCRIPTION_OUTPUT_INVALID", "VAD_OUTPUT_INVALID"}:
                raise MediaError("SENTENCE_PREREQUISITE_INVALID", cause=error) from error
            raise MediaError("SENTENCE_PREREQUISITE_UNAVAILABLE", cause=error) from error
        except Exception as error:
            raise MediaError("SENTENCE_PREREQUISITE_UNAVAILABLE", cause=error) from error

        try:
            transcription = TranscriptionResult.model_validate(transcription.model_dump(by_alias=True) if isinstance(transcription, TranscriptionResult) else transcription)
            vad = VadResult.model_validate(vad.model_dump(by_alias=True) if isinstance(vad, VadResult) else vad)
            if transcription.project_id != request.project_id or transcription.asset_id != request.asset_id or transcription.schema_version != TRANSCRIPTION_SCHEMA_VERSION:
                raise ValueError("transcription identity or schema mismatch")
            if vad.project_id != request.project_id or vad.asset_id != request.asset_id or vad.schema_version != VAD_SCHEMA_VERSION:
                raise ValueError("VAD identity or schema mismatch")
            if vad.adapter_version != VAD_ADAPTER_VERSION or transcription.model.adapter_version != TRANSCRIPTION_ADAPTER_VERSION:
                raise ValueError("unsupported prerequisite adapter")
            return self._build_result(request, transcription, vad, key)
        except (TypeError, ValueError, ValidationError, AttributeError) as error:
            raise MediaError("SENTENCE_PREREQUISITE_INVALID", cause=error) from error

    def _build_result(self, request: SentenceParams, transcription: TranscriptionResult, vad: VadResult, key: str) -> SentenceResult:
        duration_ms = vad.duration_ms
        if transcription.duration_ms is not None and transcription.duration_ms > duration_ms:
            raise MediaError("SENTENCE_PREREQUISITE_INVALID")
        pieces = self._pieces(transcription, duration_ms)
        groups = self._groups(pieces, request.config)
        sentences: list[SentenceCandidate] = []
        speech = [item for item in vad.intervals if item.is_speech]
        for group in groups:
            if not group.text:
                continue
            start = max(0, group.start_ms)
            end = min(duration_ms, group.end_ms)
            if end <= start:
                raise MediaError("SENTENCE_OUTPUT_INVALID")
            reasons = set(group.reasons)
            overlap = [item for item in speech if item.end_ms > start and item.start_ms < end]
            if not overlap:
                reasons.add("no-speech-overlap")
            else:
                if any(item.end_ms < end and next_start.start_ms > item.end_ms for item, next_start in zip(overlap, overlap[1:])):
                    reasons.add("crosses-speech-gap")
                if any(item.quality == "boundary-clipped" for item in overlap):
                    reasons.add("boundary-clipped")
                start = max(overlap[0].start_ms, start - request.config.pre_roll_ms)
                end = min(overlap[-1].end_ms, end + request.config.post_roll_ms)
            confidence = group.confidence
            if confidence is not None and confidence < LOW_CONFIDENCE:
                reasons.add("low-confidence")
            if not group.punctuated:
                reasons.add("missing-punctuation")
            quality = "complete" if not reasons else "needs_review"
            try:
                sentences.append(SentenceCandidate(
                    index=len(sentences), sourceAssetId=request.asset_id, startMs=start, endMs=end,
                    text=group.text, confidence=confidence, quality=quality, qualityReasons=sorted(reasons),
                    sourceSegmentIndexes=sorted(group.pieces[0].segment_indexes.union(*(piece.segment_indexes for piece in group.pieces[1:]))),
                ))
            except (TypeError, ValueError, ValidationError) as error:
                raise MediaError("SENTENCE_OUTPUT_INVALID", cause=error) from error
        try:
            return validate_sentence_result_size(SentenceResult(
                schemaVersion=SENTENCE_SCHEMA_VERSION, projectId=request.project_id, assetId=request.asset_id,
                cacheStatus="created", cacheKey=key,
                adapterVersion=SENTENCE_ADAPTER_VERSION, durationMs=duration_ms, config=request.config, sentences=sentences,
            ))
        except (TypeError, ValueError, ValidationError) as error:
            raise MediaError("SENTENCE_OUTPUT_INVALID", cause=error) from error

    @classmethod
    def _pieces(cls, transcription: TranscriptionResult, duration_ms: int) -> list[_Piece]:
        output: list[_Piece] = []
        expected_index = 0
        previous_segment_end = 0
        for segment in transcription.segments:
            if segment.index != expected_index:
                raise MediaError("SENTENCE_PREREQUISITE_INVALID")
            expected_index += 1
            if segment.end_ms <= segment.start_ms or segment.start_ms < previous_segment_end or segment.end_ms > duration_ms:
                raise MediaError("SENTENCE_PREREQUISITE_INVALID")
            previous_segment_end = segment.end_ms
            text = normalize_text(segment.text)
            if not text:
                continue
            confidence = segment.confidence
            if segment.words:
                previous_end = segment.start_ms
                words = []
                for word in segment.words:
                    if word.end_ms <= word.start_ms or word.start_ms < segment.start_ms or word.end_ms > segment.end_ms or word.start_ms < previous_end:
                        raise MediaError("SENTENCE_PREREQUISITE_INVALID")
                    previous_end = word.end_ms
                    words.append(word)
                group: list[Any] = []
                for word in words:
                    group.append(word)
                    word_text = normalize_text("".join(item.text for item in group))
                    terminal = any(character in END_PUNCTUATION for character in word_text[-2:])
                    if terminal:
                        output.append(_Piece(group[0].start_ms, group[-1].end_ms, word_text, {segment.index}, confidence, True))
                        group = []
                if group:
                    output.append(_Piece(group[0].start_ms, group[-1].end_ms, normalize_text("".join(item.text for item in group)), {segment.index}, confidence, False))
                if len(output) and output[-1].segment_indexes == {segment.index} and not output[-1].punctuated and any(char in END_PUNCTUATION for char in text[-2:]):
                    trailing = _TRAILING_PUNCTUATION.search(text)
                    output[-1].text = normalize_text(output[-1].text + (trailing.group(1) if trailing else ""))
                    output[-1].punctuated = True
                continue
            spans = [match.group(0) for match in _SENTENCE_SPLIT.finditer(text)] or [text]
            cursor = segment.start_ms
            total = max(1, len(text))
            for part in spans:
                part = normalize_text(part)
                if not part:
                    continue
                span = max(1, round((segment.end_ms - segment.start_ms) * len(part) / total))
                end = min(segment.end_ms, cursor + span)
                if end <= cursor:
                    end = min(segment.end_ms, cursor + 1)
                output.append(_Piece(cursor, end, part, {segment.index}, confidence, any(char in END_PUNCTUATION for char in part[-2:])))
                cursor = end
            if output and output[-1].end_ms < segment.end_ms:
                output[-1].end_ms = segment.end_ms
        return output

    @staticmethod
    def _groups(pieces: list[_Piece], config: SentenceConfig) -> list[_Group]:
        groups: list[_Group] = []
        current: _Group | None = None
        for piece in pieces:
            if not piece.text:
                continue
            if current is None:
                current = _Group([piece])
                continue
            gap = max(0, piece.start_ms - current.end_ms)
            would_exceed = piece.end_ms - current.start_ms > config.max_sentence_ms
            should_break = current.punctuated or gap >= config.pause_boundary_ms or would_exceed
            if should_break:
                if gap >= config.pause_boundary_ms and not current.punctuated:
                    current.reasons.add("pause-boundary")
                if would_exceed:
                    current.reasons.add("max-length")
                groups.append(current)
                current = _Group([piece])
            else:
                current.pieces.append(piece)
        if current is not None:
            if current.end_ms - current.start_ms > config.max_sentence_ms:
                current.reasons.add("max-length")
            if not current.punctuated:
                current.reasons.add("pause-boundary" if len(groups) > 0 else "missing-punctuation")
            groups.append(current)

        merged: list[_Group] = []
        for group in groups:
            if merged and (group.start_ms - merged[-1].end_ms) < config.pause_boundary_ms and (group.end_ms - merged[-1].start_ms) <= config.max_sentence_ms and (merged[-1].end_ms - merged[-1].start_ms) < config.min_sentence_ms and not merged[-1].punctuated:
                merged[-1].pieces.extend(group.pieces)
                merged[-1].reasons.update(group.reasons)
            else:
                merged.append(group)
        return merged

    def _asset(self, project_id: str, asset_id: str) -> tuple[Path, Path, Any]:
        from supervideo_core.project.errors import ProjectError
        from supervideo_core.project.paths import canonical_asset_path

        if self._database is None or self._project_root is None:
            raise ProjectError("PROJECT_NOT_ACTIVE")
        try:
            asset = AssetRepository(self._database).get(asset_id, project_id)
        except Exception as error:
            if getattr(error, "code", None) == "RECORD_NOT_FOUND":
                raise ProjectError("ASSET_NOT_FOUND") from error
            raise
        path, _ = canonical_asset_path(asset.absolute_path)
        signature, fingerprint = self._asset_signature(path)
        if signature != (asset.size_bytes, asset.modified_at_ms) or fingerprint != asset.content_fingerprint:
            raise ProjectError("ASSET_CHANGED")
        return self._project_root, path, asset

    @staticmethod
    def _asset_signature(path: Path) -> tuple[tuple[int, int], str]:
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
        return stat_signature(after), fingerprint

    @staticmethod
    def _ensure_unchanged(path: Path, signature: tuple[int, int], fingerprint: str) -> None:
        from supervideo_core.project.errors import ProjectError
        if SentenceService._asset_signature(path) != (signature, fingerprint):
            raise ProjectError("ASSET_CHANGED")

    @staticmethod
    def _cache_key(project_id: str, path: Path, signature: tuple[int, int], fingerprint: str, config: SentenceConfig) -> str:
        value = {"version": SENTENCE_CACHE_VERSION, "projectId": project_id, "path": str(path), "size": signature[0], "mtimeMs": signature[1], "fingerprint": fingerprint, "transcription": {"schemaVersion": TRANSCRIPTION_SCHEMA_VERSION, "adapterVersion": TRANSCRIPTION_ADAPTER_VERSION}, "vad": {"schemaVersion": VAD_SCHEMA_VERSION, "adapterVersion": VAD_ADAPTER_VERSION}, "config": config.model_dump(by_alias=True)}
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _read_cache(path: Path, key: str, project_id: str, asset_id: str, config: SentenceConfig) -> SentenceResult | None:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None
        if not isinstance(value, dict) or set(value) != {"schemaVersion", "cacheKey", "resultDigest", "result"} or value.get("schemaVersion") != SENTENCE_SCHEMA_VERSION or value.get("cacheKey") != key:
            return None
        if not isinstance(value.get("resultDigest"), str) or value["resultDigest"] != SentenceService._result_digest(value.get("result")):
            return None
        try:
            result = validate_sentence_result_size(SentenceResult.model_validate(value["result"]))
            if result.project_id != project_id or result.asset_id != asset_id or result.cache_key != key or result.cache_status != "created" or result.config != config:
                return None
            return result
        except (TypeError, ValueError, ValidationError):
            return None

    @staticmethod
    def _result_digest(value: Any) -> str:
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _atomic_json_write(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}-", suffix=".tmp", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(value, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, path)
        finally:
            Path(temp_name).unlink(missing_ok=True)


def normalize_text(value: str) -> str:
    value = _SPACE.sub(" ", value.strip())
    return _REPEATED_PUNCTUATION.sub(r"\1", value)
