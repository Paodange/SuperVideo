"""Controlled FFmpeg VAD adapter with bounded speech intervals and cache."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import shutil
import stat
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError

from supervideo_core.storage import AssetRepository

from .errors import MediaError
from .vad_models import (
    VAD_ADAPTER_VERSION,
    VAD_MAX_DURATION_MS,
    VAD_MAX_INTERVALS,
    VAD_SCHEMA_VERSION,
    SpeechInterval,
    VadConfig,
    VadParams,
    VadResult,
    validate_vad_result_size,
)


VAD_CACHE_VERSION = "vad-cache-v1"
VAD_MAX_TOOL_OUTPUT_BYTES = 128 * 1024
_SILENCE_START = re.compile(rb"silence_start:\s*([-+0-9.eE]+)")
_SILENCE_END = re.compile(rb"silence_end:\s*([-+0-9.eE]+)")
_PROGRESS_TIME = re.compile(rb"(?:out_time_ms|out_time_us)=(-?[0-9]+)")


@dataclass(frozen=True)
class RawVadInterval:
    start: float
    end: float
    is_speech: bool
    confidence: float | None = None


@dataclass(frozen=True)
class RawVadResult:
    duration: float
    intervals: tuple[RawVadInterval, ...]


class VadRunner(Protocol):
    async def run(self, path: Path, config: VadConfig, cancelled: asyncio.Event) -> RawVadResult:
        """Run a controlled local VAD backend and return structured output."""


class FfmpegVadRunner:
    """Use FFmpeg's built-in silencedetect filter; no model or user command is accepted."""

    def __init__(self, ffmpeg_path: str | None = None) -> None:
        self.ffmpeg_path = self._resolve_tool(ffmpeg_path)

    async def run(self, path: Path, config: VadConfig, cancelled: asyncio.Event) -> RawVadResult:
        if self.ffmpeg_path is None:
            raise MediaError("VAD_TOOL_UNAVAILABLE")
        filter_value = f"silencedetect=n={config.threshold_db:g}dB:d={config.min_silence_ms / 1_000:g}"
        args = [
            self.ffmpeg_path,
            "-hide_banner",
            "-nostats",
            "-i", str(path),
            "-af", filter_value,
            "-f", "null",
            "-progress", "pipe:1",
            "-",
        ]
        try:
            process = await asyncio.create_subprocess_exec(
                *args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
        except (FileNotFoundError, PermissionError, OSError) as error:
            raise MediaError("VAD_TOOL_UNAVAILABLE", cause=error) from error
        assert process.stdout is not None and process.stderr is not None
        stdout_task = asyncio.create_task(self._read_bounded(process.stdout))
        stderr_task = asyncio.create_task(self._read_bounded(process.stderr))
        process_task = asyncio.create_task(process.wait())
        cancel_wait = asyncio.create_task(cancelled.wait())
        try:
            done, _ = await asyncio.wait(
                {process_task, cancel_wait}, timeout=120, return_when=asyncio.FIRST_COMPLETED,
            )
            if cancel_wait in done and cancelled.is_set():
                await self._kill_and_wait(process)
                raise MediaError("VAD_CANCELLED")
            if process_task not in done:
                await self._kill_and_wait(process)
                raise MediaError("VAD_TIMEOUT")
            stdout, stderr = await asyncio.gather(stdout_task, stderr_task)
            if process.returncode != 0:
                raise MediaError("VAD_OUTPUT_INVALID")
            return self._parse_output(stdout, stderr)
        except asyncio.CancelledError:
            await self._kill_and_wait(process)
            raise
        finally:
            cancel_wait.cancel()
            for task in (stdout_task, stderr_task, process_task, cancel_wait):
                if not task.done():
                    task.cancel()
            await asyncio.gather(stdout_task, stderr_task, process_task, cancel_wait, return_exceptions=True)

    @staticmethod
    async def _read_bounded(stream: asyncio.StreamReader) -> bytes:
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = await stream.read(min(8_192, VAD_MAX_TOOL_OUTPUT_BYTES + 1 - total))
            if not chunk:
                return b"".join(chunks)
            total += len(chunk)
            if total > VAD_MAX_TOOL_OUTPUT_BYTES:
                raise MediaError("VAD_OUTPUT_INVALID")
            chunks.append(chunk)

    @staticmethod
    async def _kill_and_wait(process: asyncio.subprocess.Process) -> None:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        await process.wait()

    @staticmethod
    def _parse_output(stdout: bytes, stderr: bytes) -> RawVadResult:
        try:
            progress_values = [int(match.group(1)) for match in _PROGRESS_TIME.finditer(stdout) if int(match.group(1)) >= 0]
            duration = (max(progress_values) / 1_000_000) if progress_values else 0.0
            silence_starts = [float(match.group(1)) for match in _SILENCE_START.finditer(stderr)]
            silence_ends = [float(match.group(1)) for match in _SILENCE_END.finditer(stderr)]
            if any(not math.isfinite(value) or value < 0 for value in [*silence_starts, *silence_ends]):
                raise ValueError("non-finite silence marker")
            if silence_ends:
                duration = max(duration, max(silence_ends))
            if silence_starts:
                duration = max(duration, max(silence_starts))
            if duration <= 0 or duration > VAD_MAX_DURATION_MS / 1_000:
                raise ValueError("invalid media duration")
            silences: list[tuple[float, float]] = []
            for index, start in enumerate(silence_starts):
                end = silence_ends[index] if index < len(silence_ends) else duration
                if end <= start or end > duration + 0.01:
                    raise ValueError("invalid silence interval")
                silences.append((start, min(end, duration)))
            intervals: list[RawVadInterval] = []
            cursor = 0.0
            for start, end in silences:
                if start > cursor:
                    intervals.append(RawVadInterval(cursor, start, True, None))
                intervals.append(RawVadInterval(start, end, False, None))
                cursor = end
            if cursor < duration:
                intervals.append(RawVadInterval(cursor, duration, True, None))
            if not intervals:
                intervals = [RawVadInterval(0.0, duration, True, None)]
            return RawVadResult(duration=duration, intervals=tuple(intervals))
        except (TypeError, ValueError, OverflowError) as error:
            raise MediaError("VAD_OUTPUT_INVALID", cause=error) from error

    @staticmethod
    def _resolve_tool(configured: str | None) -> str | None:
        value = configured or os.environ.get("SUPERVIDEO_FFMPEG_PATH") or shutil.which("ffmpeg")
        if not value:
            return None
        candidate = Path(value)
        if candidate.name.casefold() not in {"ffmpeg", "ffmpeg.exe"} or not candidate.is_absolute():
            return None
        try:
            if not stat.S_ISREG(candidate.stat().st_mode):
                return None
        except OSError:
            return None
        return str(candidate)


class VadService:
    def __init__(self, *, runner: VadRunner | None = None, ffmpeg_path: str | None = None) -> None:
        self.runner = runner or FfmpegVadRunner(ffmpeg_path)
        self._project_root: Path | None = None
        self._database: Any | None = None

    def bind_session(self, project_root: Path, database: Any) -> None:
        self._project_root = project_root
        self._database = database

    async def detect(self, request: VadParams, cancelled: asyncio.Event) -> VadResult:
        config = request.config
        project_root, asset_path = self._asset(request.project_id, request.asset_id)
        signature, fingerprint = self._asset_signature(asset_path)
        key = self._cache_key(request.project_id, asset_path, signature, fingerprint, config)
        target = project_root / "cache" / VAD_CACHE_VERSION / "intervals" / f"{key}.json"
        cached = self._read_cache(target, key, request.project_id, request.asset_id, config)
        if cached is not None:
            return cached.model_copy(update={"cache_status": "cache-hit"})

        task = asyncio.create_task(self.runner.run(asset_path, config, cancelled))
        cancel_wait = asyncio.create_task(cancelled.wait())
        try:
            done, _ = await asyncio.wait(
                {task, cancel_wait}, timeout=request.timeout_ms / 1_000, return_when=asyncio.FIRST_COMPLETED,
            )
            if cancel_wait in done and cancelled.is_set():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("VAD_CANCELLED")
            if task not in done:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("VAD_TIMEOUT")
            try:
                raw = await task
            except MediaError:
                raise
            except Exception as error:
                raise MediaError("VAD_OUTPUT_INVALID", cause=error) from error
        finally:
            cancel_wait.cancel()
            await asyncio.gather(cancel_wait, return_exceptions=True)

        result = self._build_result(request, key, config, raw)
        self._ensure_unchanged(asset_path, signature, fingerprint)
        self._atomic_json_write(target, {"schemaVersion": VAD_SCHEMA_VERSION, "cacheKey": key, "result": result.model_dump(by_alias=True)})
        return result

    def _asset(self, project_id: str, asset_id: str) -> tuple[Path, Path]:
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
        return self._project_root, path

    def _build_result(self, request: VadParams, key: str, config: VadConfig, raw: RawVadResult) -> VadResult:
        try:
            if not isinstance(raw, RawVadResult) or not isinstance(raw.intervals, (tuple, list)) or len(raw.intervals) > VAD_MAX_INTERVALS:
                raise ValueError("invalid VAD envelope")
            duration_ms = self._milliseconds(raw.duration)
            duration = duration_ms / 1_000
            previous_end = 0.0
            normalized: list[RawVadInterval] = []
            for source in raw.intervals:
                if not isinstance(source, RawVadInterval):
                    raise ValueError("invalid VAD interval")
                start = self._seconds(source.start)
                end = self._seconds(source.end)
                if end <= start or start < previous_end or end > duration:
                    raise ValueError("unordered or out-of-range VAD interval")
                if not isinstance(source.is_speech, bool):
                    raise ValueError("invalid VAD classification")
                confidence = self._confidence(source.confidence)
                normalized.append(RawVadInterval(start, end, source.is_speech, confidence))
                previous_end = end
            if not normalized and duration > 0:
                normalized = [RawVadInterval(0, duration, False, None)]
            normalized = self._fill_and_merge(normalized, duration, config)
            speech = [item for item in normalized if item.is_speech and item.end - item.start >= config.min_speech_ms / 1_000]
            expanded: list[tuple[float, float, RawVadInterval, str]] = []
            for item in speech:
                start = max(0.0, item.start - config.pre_roll_ms / 1_000)
                end = min(duration, item.end + config.post_roll_ms / 1_000)
                quality = "boundary-expanded" if start != item.start or end != item.end else "detected"
                if start == 0 or end == duration:
                    quality = "boundary-clipped" if quality != "detected" else quality
                expanded.append((start, end, item, quality))
            for index in range(1, len(expanded)):
                left = expanded[index - 1]
                right = expanded[index]
                if left[1] > right[0]:
                    boundary = (speech[index - 1].end + speech[index].start) / 2
                    expanded[index - 1] = (left[0], boundary, left[2], "boundary-clipped")
                    expanded[index] = (boundary, right[1], right[2], "boundary-clipped")
            intervals: list[SpeechInterval] = []
            cursor_ms = 0
            for start, end, source, quality in expanded:
                start_ms = max(cursor_ms, round(start * 1_000))
                end_ms = round(end * 1_000)
                if start_ms > cursor_ms:
                    intervals.append(SpeechInterval(index=len(intervals), startMs=cursor_ms, endMs=start_ms, isSpeech=False, confidence=None, quality="silence"))
                if end_ms > start_ms:
                    intervals.append(SpeechInterval(index=len(intervals), startMs=start_ms, endMs=end_ms, isSpeech=True, confidence=source.confidence, quality=quality))
                    cursor_ms = end_ms
            if cursor_ms < duration_ms:
                intervals.append(SpeechInterval(index=len(intervals), startMs=cursor_ms, endMs=duration_ms, isSpeech=False, confidence=None, quality="silence"))
            result = VadResult(
                schemaVersion=VAD_SCHEMA_VERSION,
                projectId=request.project_id,
                assetId=request.asset_id,
                cacheStatus="created",
                cacheKey=key,
                adapterVersion=VAD_ADAPTER_VERSION,
                durationMs=duration_ms,
                config=config,
                intervals=intervals,
            )
            return validate_vad_result_size(result)
        except (TypeError, ValueError, OverflowError, ValidationError) as error:
            raise MediaError("VAD_OUTPUT_INVALID", cause=error) from error

    @staticmethod
    def _fill_and_merge(items: list[RawVadInterval], duration: float, config: VadConfig) -> list[RawVadInterval]:
        if not items:
            return items
        merged: list[RawVadInterval] = []
        cursor = 0.0
        for item in items:
            if item.start > cursor:
                merged.append(RawVadInterval(cursor, item.start, False, None))
            if merged and merged[-1].is_speech == item.is_speech and item.start - merged[-1].end <= config.merge_gap_ms / 1_000:
                previous = merged.pop()
                confidence = previous.confidence if previous.confidence == item.confidence else None
                merged.append(RawVadInterval(previous.start, item.end, item.is_speech, confidence))
            else:
                merged.append(item)
            cursor = item.end
        if cursor < duration:
            merged.append(RawVadInterval(cursor, duration, False, None))
        gap_limit = config.merge_gap_ms / 1_000
        index = 0
        while index + 2 < len(merged):
            left, gap, right = merged[index:index + 3]
            if left.is_speech and not gap.is_speech and right.is_speech and gap.end - gap.start <= gap_limit:
                confidence = left.confidence if left.confidence == right.confidence else None
                merged[index:index + 3] = [RawVadInterval(left.start, right.end, True, confidence)]
                continue
            index += 1
        return merged

    @staticmethod
    def _milliseconds(value: float) -> int:
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 or value > VAD_MAX_DURATION_MS / 1_000:
            raise ValueError("invalid VAD duration")
        return round(float(value) * 1_000)

    @staticmethod
    def _seconds(value: float) -> float:
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > VAD_MAX_DURATION_MS / 1_000:
            raise ValueError("invalid VAD timestamp")
        return float(value)

    @staticmethod
    def _confidence(value: float | None) -> float | None:
        if value is None:
            return None
        if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
            raise ValueError("invalid VAD confidence")
        return float(value)

    @staticmethod
    def _asset_signature(path: Path) -> tuple[tuple[int, int], str]:
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
        return stat_signature(after), fingerprint

    @staticmethod
    def _ensure_unchanged(path: Path, signature: tuple[int, int], fingerprint: str) -> None:
        from supervideo_core.project.errors import ProjectError
        current, current_fingerprint = VadService._asset_signature(path)
        if current != signature or current_fingerprint != fingerprint:
            raise ProjectError("ASSET_CHANGED")

    @staticmethod
    def _cache_key(project_id: str, path: Path, signature: tuple[int, int], fingerprint: str, config: VadConfig) -> str:
        value = {
            "version": VAD_CACHE_VERSION,
            "projectId": project_id,
            "path": str(path),
            "size": signature[0],
            "mtimeMs": signature[1],
            "fingerprint": fingerprint,
            "adapter": VAD_ADAPTER_VERSION,
            "config": config.model_dump(by_alias=True),
        }
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _read_cache(path: Path, key: str, project_id: str, asset_id: str, config: VadConfig) -> VadResult | None:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None
        if not isinstance(value, dict) or set(value) != {"schemaVersion", "cacheKey", "result"} or value.get("schemaVersion") != VAD_SCHEMA_VERSION or value.get("cacheKey") != key:
            return None
        try:
            result = validate_vad_result_size(VadResult.model_validate(value["result"]))
            if result.project_id != project_id or result.asset_id != asset_id or result.cache_key != key or result.cache_status != "created" or result.config != config:
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
