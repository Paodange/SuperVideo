"""Controlled faster-whisper adapter and bounded, fingerprinted cache."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError

from supervideo_core.storage import AssetRepository

from .errors import MediaError
from .transcription_models import (
    TRANSCRIPTION_ADAPTER_VERSION,
    TRANSCRIPTION_SCHEMA_VERSION,
    TRANSCRIPTION_MAX_DURATION_MS,
    TranscriptionModelInfo,
    TranscriptionParams,
    TranscriptionResult,
    TranscriptionSegment,
    TranscriptionWord,
    validate_total_text,
)


TRANSCRIPTION_CACHE_VERSION = "transcription-cache-v1"
ALLOWED_MODEL_NAMES = frozenset({"tiny", "base", "small", "medium", "large-v3"})
ALLOWED_DEVICES = frozenset({"cpu", "cuda"})
ALLOWED_COMPUTE_TYPES = frozenset({"int8", "float16", "float32", "int8_float16"})


@dataclass(frozen=True)
class TranscriptionConfig:
    model_name: str
    device: str
    compute_type: str

    @property
    def model_info(self) -> TranscriptionModelInfo:
        return TranscriptionModelInfo(
            adapterVersion=TRANSCRIPTION_ADAPTER_VERSION,
            provider="faster-whisper",
            modelName=self.model_name,
            device=self.device,
            computeType=self.compute_type,
        )


@dataclass(frozen=True)
class RawWord:
    start: float | None
    end: float | None
    text: str
    probability: float | None


@dataclass(frozen=True)
class RawSegment:
    start: float | None
    end: float | None
    text: str
    avg_logprob: float | None
    no_speech_probability: float | None
    compression_ratio: float | None
    words: tuple[RawWord, ...] = ()


@dataclass(frozen=True)
class RawTranscription:
    language: str | None
    language_probability: float | None
    duration: float | None
    segments: tuple[RawSegment, ...]


class TranscriptionRunner(Protocol):
    async def run(self, path: Path, config: TranscriptionConfig, cancelled: asyncio.Event) -> RawTranscription:
        """Run the controlled local adapter and return only structured output."""


def transcription_config_from_env(environ: dict[str, str] | None = None) -> TranscriptionConfig:
    values = environ if environ is not None else os.environ
    model_name = values.get("SUPERVIDEO_WHISPER_MODEL", "base").strip().casefold()
    device = values.get("SUPERVIDEO_WHISPER_DEVICE", "cpu").strip().casefold()
    compute_type = values.get("SUPERVIDEO_WHISPER_COMPUTE_TYPE", "int8").strip().casefold()
    if model_name not in ALLOWED_MODEL_NAMES or any(character in model_name for character in ("/", "\\", ":")):
        raise MediaError("TRANSCRIPTION_MODEL_UNAVAILABLE")
    if device not in ALLOWED_DEVICES or compute_type not in ALLOWED_COMPUTE_TYPES:
        raise MediaError("TRANSCRIPTION_MODEL_UNAVAILABLE")
    return TranscriptionConfig(model_name=model_name, device=device, compute_type=compute_type)


class FasterWhisperRunner:
    """Lazy optional faster-whisper runner; no RPC value can alter its model path."""

    def __init__(self) -> None:
        self._models: dict[tuple[str, str, str], Any] = {}
        self._lock = threading.Lock()

    async def run(self, path: Path, config: TranscriptionConfig, cancelled: asyncio.Event) -> RawTranscription:
        thread_cancel = threading.Event()
        work = asyncio.create_task(asyncio.to_thread(self._run_sync, path, config, thread_cancel))
        cancel_wait = asyncio.create_task(cancelled.wait())
        try:
            done, _ = await asyncio.wait({work, cancel_wait}, return_when=asyncio.FIRST_COMPLETED)
            if cancel_wait in done and cancelled.is_set():
                thread_cancel.set()
                work.cancel()
                raise MediaError("TRANSCRIPTION_CANCELLED")
            return await work
        except asyncio.CancelledError:
            thread_cancel.set()
            work.cancel()
            raise
        finally:
            cancel_wait.cancel()
            await asyncio.gather(cancel_wait, return_exceptions=True)

    def _run_sync(self, path: Path, config: TranscriptionConfig, cancelled: threading.Event) -> RawTranscription:
        try:
            from faster_whisper import WhisperModel
        except (ImportError, ModuleNotFoundError) as error:
            raise MediaError("TRANSCRIPTION_TOOL_UNAVAILABLE", cause=error) from error

        try:
            key = (config.model_name, config.device, config.compute_type)
            with self._lock:
                model = self._models.get(key)
                if model is None:
                    model = WhisperModel(config.model_name, device=config.device, compute_type=config.compute_type)
                    self._models[key] = model
            segments, info = model.transcribe(str(path), word_timestamps=True)
            output: list[RawSegment] = []
            for segment in segments:
                if cancelled.is_set():
                    raise MediaError("TRANSCRIPTION_CANCELLED")
                raw_words: list[RawWord] = []
                for word in (getattr(segment, "words", None) or ()):
                    raw_words.append(RawWord(
                        start=getattr(word, "start", None),
                        end=getattr(word, "end", None),
                        text=str(getattr(word, "word", "")),
                        probability=getattr(word, "probability", None),
                    ))
                output.append(RawSegment(
                    start=getattr(segment, "start", None),
                    end=getattr(segment, "end", None),
                    text=str(getattr(segment, "text", "")),
                    avg_logprob=getattr(segment, "avg_logprob", None),
                    no_speech_probability=getattr(segment, "no_speech_prob", None),
                    compression_ratio=getattr(segment, "compression_ratio", None),
                    words=tuple(raw_words),
                ))
            return RawTranscription(
                language=getattr(info, "language", None),
                language_probability=getattr(info, "language_probability", None),
                duration=getattr(info, "duration", None),
                segments=tuple(output),
            )
        except MediaError:
            raise
        except (OSError, RuntimeError, ValueError) as error:
            raise MediaError("TRANSCRIPTION_MODEL_UNAVAILABLE", cause=error) from error


class TranscriptionService:
    def __init__(self, *, runner: TranscriptionRunner | None = None, config: TranscriptionConfig | None = None) -> None:
        self.runner = runner or FasterWhisperRunner()
        self._configured_config = config
        self._project_root: Path | None = None
        self._database: Any | None = None

    def bind_session(self, project_root: Path, database: Any) -> None:
        self._project_root = project_root
        self._database = database

    async def transcribe(self, request: TranscriptionParams, cancelled: asyncio.Event) -> TranscriptionResult:
        config = self._configured_config or transcription_config_from_env()
        project_root, asset_path, _asset = self._asset(request.project_id, request.asset_id)
        signature, fingerprint = self._asset_signature(asset_path)
        key = self._cache_key(request.project_id, asset_path, signature, fingerprint, config)
        target = project_root / "cache" / TRANSCRIPTION_CACHE_VERSION / "transcripts" / f"{key}.json"
        cached = self._read_cache(target, key, request.project_id, request.asset_id)
        if cached is not None:
            return cached.model_copy(update={"cache_status": "cache-hit"})

        task = asyncio.create_task(self.runner.run(asset_path, config, cancelled))
        cancel_wait = asyncio.create_task(cancelled.wait())
        try:
            done, _ = await asyncio.wait({task, cancel_wait}, timeout=request.timeout_ms / 1_000, return_when=asyncio.FIRST_COMPLETED)
            if cancel_wait in done and cancelled.is_set():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("TRANSCRIPTION_CANCELLED")
            if task not in done:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("TRANSCRIPTION_TIMEOUT")
            raw = await task
        finally:
            cancel_wait.cancel()
            await asyncio.gather(cancel_wait, return_exceptions=True)

        result = self._build_result(request, key, config, raw)
        self._ensure_unchanged(asset_path, signature, fingerprint)
        self._atomic_json_write(target, {"schemaVersion": TRANSCRIPTION_SCHEMA_VERSION, "cacheKey": key, "result": result.model_dump(by_alias=True)})
        return result

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

    def _build_result(self, request: TranscriptionParams, key: str, config: TranscriptionConfig, raw: RawTranscription) -> TranscriptionResult:
        try:
            if not isinstance(raw, RawTranscription) or len(raw.segments) > 2_000:
                raise ValueError("invalid transcription envelope")
            segments: list[TranscriptionSegment] = []
            for index, source in enumerate(raw.segments):
                if not isinstance(source, RawSegment):
                    raise ValueError("invalid transcription segment")
                if not isinstance(source.words, (tuple, list)) or len(source.words) > 128:
                    raise ValueError("invalid transcription words")
                start_ms = self._milliseconds(source.start)
                end_ms = self._milliseconds(source.end)
                words = [
                    TranscriptionWord(
                        startMs=self._milliseconds(word.start),
                        endMs=self._milliseconds(word.end),
                        text=self._text(word.text),
                        probability=self._probability(word.probability),
                    )
                    for word in source.words
                    if isinstance(word, RawWord)
                ]
                if len(words) != len(source.words):
                    raise ValueError("invalid transcription segment")
                confidence = self._average_probability([word.probability for word in words])
                segments.append(TranscriptionSegment(
                    index=index,
                    startMs=start_ms,
                    endMs=end_ms,
                    text=self._text(source.text),
                    confidence=confidence,
                    avgLogprob=self._finite_float(source.avg_logprob, -100, 100),
                    noSpeechProbability=self._probability(source.no_speech_probability),
                    compressionRatio=self._finite_float(source.compression_ratio, 0, 100),
                    words=words,
                ))
            result = TranscriptionResult(
                schemaVersion=TRANSCRIPTION_SCHEMA_VERSION,
                projectId=request.project_id,
                assetId=request.asset_id,
                cacheStatus="created",
                cacheKey=key,
                model=config.model_info,
                language=self._text_or_none(raw.language, 64),
                languageProbability=self._probability(raw.language_probability),
                durationMs=None if raw.duration is None else self._milliseconds(raw.duration),
                segments=segments,
            )
            return validate_total_text(result)
        except (TypeError, ValueError, OverflowError, ValidationError) as error:
            raise MediaError("TRANSCRIPTION_OUTPUT_INVALID", cause=error) from error

    @staticmethod
    def _milliseconds(value: float | None) -> int:
        if value is None or not isinstance(value, (int, float)) or not 0 <= value <= TRANSCRIPTION_MAX_DURATION_MS / 1_000:
            raise ValueError("invalid timestamp")
        return round(float(value) * 1_000)

    @staticmethod
    def _probability(value: float | None) -> float | None:
        if value is None:
            return None
        if not isinstance(value, (int, float)) or not 0 <= value <= 1:
            raise ValueError("invalid probability")
        return float(value)

    @staticmethod
    def _finite_float(value: float | None, minimum: float, maximum: float) -> float | None:
        if value is None:
            return None
        if not isinstance(value, (int, float)) or not minimum <= value <= maximum:
            raise ValueError("invalid quality value")
        return float(value)

    @staticmethod
    def _text(value: str) -> str:
        if not isinstance(value, str) or not value.strip() or len(value) > 2_048 or any(ord(character) < 32 for character in value):
            raise ValueError("invalid transcription text")
        return value.strip()

    @staticmethod
    def _text_or_none(value: str | None, maximum: int) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str) or not value or len(value) > maximum or any(ord(character) < 32 for character in value):
            raise ValueError("invalid transcription language")
        return value

    @staticmethod
    def _average_probability(values: list[float | None]) -> float | None:
        numbers = [value for value in values if value is not None]
        return None if not numbers else sum(numbers) / len(numbers)

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
        current, current_fingerprint = TranscriptionService._asset_signature(path)
        if current != signature or current_fingerprint != fingerprint:
            from supervideo_core.project.errors import ProjectError
            raise ProjectError("ASSET_CHANGED")

    def _cache_key(self, project_id: str, path: Path, signature: tuple[int, int], fingerprint: str, config: TranscriptionConfig) -> str:
        value = {
            "version": TRANSCRIPTION_CACHE_VERSION,
            "projectId": project_id,
            "path": str(path),
            "size": signature[0],
            "mtimeMs": signature[1],
            "fingerprint": fingerprint,
            "adapter": TRANSCRIPTION_ADAPTER_VERSION,
            "model": config.model_name,
            "device": config.device,
            "computeType": config.compute_type,
        }
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _read_cache(path: Path, key: str, project_id: str, asset_id: str) -> TranscriptionResult | None:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None
        if not isinstance(value, dict) or set(value) != {"schemaVersion", "cacheKey", "result"} or value.get("schemaVersion") != TRANSCRIPTION_SCHEMA_VERSION or value.get("cacheKey") != key:
            return None
        try:
            result = validate_total_text(TranscriptionResult.model_validate(value["result"]))
            if result.project_id != project_id or result.asset_id != asset_id or result.cache_key != key or result.cache_status != "created":
                return None
            return result
        except (TypeError, ValueError, ValidationError):
            return None

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
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
