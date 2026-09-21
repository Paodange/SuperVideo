"""Windows-safe ffprobe/FFmpeg adapter with versioned cache keys."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from supervideo_core.storage import AssetRepository

from .errors import MediaError
from .models import MediaMetadata, MediaOutput, MediaProbeParams, MediaProbeResult, MediaProxyParams, MediaProxyResult, MediaStream

MEDIA_CACHE_VERSION = "media-cache-v1"
MEDIA_SCHEMA_VERSION = 1
PROBE_PARAMETERS = {"ffprobe": ["-v", "error", "-print_format", "json", "-show_format", "-show_streams"]}
PROXY_PARAMETERS = {
    "audio": ["-vn", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"],
    "video": ["-vf", "scale=640:-2", "-c:v", "libx264", "-preset", "veryfast", "-b:v", "800k", "-maxrate", "900k", "-bufsize", "1800k", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"],
    "thumbnail": ["-vf", "thumbnail,scale=320:-2", "-frames:v", "1", "-q:v", "3"],
}


class MediaService:
    def __init__(self, *, ffprobe_path: str | None = None, ffmpeg_path: str | None = None) -> None:
        self.ffprobe_path = self._resolve_tool(ffprobe_path, "ffprobe")
        self.ffmpeg_path = self._resolve_tool(ffmpeg_path, "ffmpeg")

    async def probe(self, request: MediaProbeParams, cancelled: asyncio.Event) -> MediaProbeResult:
        project_root, asset_path, _asset = self._asset(request.project_id, request.asset_id)
        signature, fingerprint = self._asset_signature(asset_path)
        key = self._cache_key(asset_path, signature, fingerprint, PROBE_PARAMETERS)
        target = project_root / "cache" / MEDIA_CACHE_VERSION / "probe" / f"{key}.json"
        cached = self._read_json_cache(target)
        if cached is not None:
            return MediaProbeResult.model_validate({**cached, "projectId": request.project_id, "assetId": request.asset_id, "cacheStatus": "cache-hit", "cacheKey": key})
        if self.ffprobe_path is None:
            raise MediaError("MEDIA_TOOL_UNAVAILABLE")
        args = [self.ffprobe_path, *PROBE_PARAMETERS["ffprobe"], str(asset_path)]
        raw = await self._run(args, request.timeout_ms, cancelled)
        metadata = self._parse_probe(raw)
        self._ensure_unchanged(asset_path, signature, fingerprint)
        payload = {"schemaVersion": MEDIA_SCHEMA_VERSION, "metadata": metadata.model_dump(by_alias=True)}
        self._atomic_json_write(target, payload)
        return MediaProbeResult.model_validate({**payload, "projectId": request.project_id, "assetId": request.asset_id, "cacheStatus": "created", "cacheKey": key})

    async def proxy(self, request: MediaProxyParams, cancelled: asyncio.Event) -> MediaProxyResult:
        project_root, asset_path, _asset = self._asset(request.project_id, request.asset_id)
        signature, fingerprint = self._asset_signature(asset_path)
        key = self._cache_key(asset_path, signature, fingerprint, PROXY_PARAMETERS)
        output_dir = project_root / "cache" / MEDIA_CACHE_VERSION / "proxy" / key
        manifest = output_dir / "manifest.json"
        cached = self._read_json_cache(manifest)
        if cached is not None and self._cached_outputs_are_valid(project_root, cached):
            return MediaProxyResult.model_validate({**cached, "projectId": request.project_id, "assetId": request.asset_id, "cacheStatus": "cache-hit", "cacheKey": key})
        if self.ffmpeg_path is None:
            raise MediaError("MEDIA_TOOL_UNAVAILABLE")
        output_dir.parent.mkdir(parents=True, exist_ok=True)
        temp_dir = Path(tempfile.mkdtemp(prefix=f".{key[:16]}-", dir=str(output_dir.parent)))
        try:
            targets = {"audio": temp_dir / "audio.m4a", "video": temp_dir / "video.mp4", "thumbnail": temp_dir / "thumbnail.jpg"}
            for kind, target in targets.items():
                args = [self.ffmpeg_path, "-y", "-hide_banner", "-loglevel", "error", "-i", str(asset_path), *PROXY_PARAMETERS[kind], str(target)]
                await self._run(args, request.timeout_ms, cancelled)
                self._ensure_output(target)
                self._ensure_unchanged(asset_path, signature, fingerprint)
            outputs = [MediaOutput(kind=kind, relativePath=str((Path("cache") / MEDIA_CACHE_VERSION / "proxy" / key / target.name)).replace("\\", "/"), sizeBytes=target.stat().st_size) for kind, target in targets.items()]
            payload = {"schemaVersion": MEDIA_SCHEMA_VERSION, "outputs": [item.model_dump(by_alias=True) for item in outputs]}
            if output_dir.exists():
                shutil.rmtree(output_dir)
            output_dir.mkdir(parents=True, exist_ok=False)
            for target in targets.values():
                os.replace(target, output_dir / target.name)
            self._atomic_json_write(output_dir / "manifest.json", payload)
            return MediaProxyResult.model_validate({**payload, "projectId": request.project_id, "assetId": request.asset_id, "cacheStatus": "created", "cacheKey": key})
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def bind_session(self, project_root: Path, database: Any) -> None:
        self._project_root = project_root
        self._database = database

    def _asset(self, project_id: str, asset_id: str) -> tuple[Path, Path, Any]:  # type: ignore[no-redef]
        from supervideo_core.project.errors import ProjectError
        from supervideo_core.project.paths import canonical_asset_path

        database = getattr(self, "_database", None)
        project_root = getattr(self, "_project_root", None)
        if database is None or project_root is None:
            raise ProjectError("PROJECT_NOT_ACTIVE")
        try:
            asset = AssetRepository(database).get(asset_id, project_id)
        except Exception as error:
            if getattr(error, "code", None) == "RECORD_NOT_FOUND":
                raise ProjectError("ASSET_NOT_FOUND") from error
            raise
        path, _ = canonical_asset_path(asset.absolute_path)
        signature, fingerprint = self._asset_signature(path)
        if signature != (asset.size_bytes, asset.modified_at_ms) or fingerprint != asset.content_fingerprint:
            raise ProjectError("ASSET_CHANGED")
        return project_root, path, asset

    @staticmethod
    def _resolve_tool(configured: str | None, expected_name: str) -> str | None:
        value = configured or os.environ.get(f"SUPERVIDEO_{expected_name.upper()}_PATH")
        if value is None:
            value = shutil.which(expected_name)
        if not value:
            return None
        candidate = Path(value)
        if candidate.name.casefold() not in {expected_name.casefold(), f"{expected_name}.exe"} or not candidate.is_absolute():
            return None
        try:
            if not stat.S_ISREG(candidate.stat().st_mode):
                return None
        except OSError:
            return None
        return str(candidate)

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

        current, current_fingerprint = MediaService._asset_signature(path)
        if current != signature or current_fingerprint != fingerprint:
            raise ProjectError("ASSET_CHANGED")

    @staticmethod
    def _cache_key(path: Path, signature: tuple[int, int], fingerprint: str, parameters: dict[str, Any]) -> str:
        value = {"version": MEDIA_CACHE_VERSION, "path": str(path), "size": signature[0], "mtimeMs": signature[1], "fingerprint": fingerprint, "parameters": parameters}
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _read_json_cache(path: Path) -> dict[str, Any] | None:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None
        return value if isinstance(value, dict) else None

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

    @staticmethod
    def _ensure_output(path: Path) -> None:
        try:
            if not stat.S_ISREG(path.stat().st_mode) or path.stat().st_size <= 0:
                raise MediaError("MEDIA_OUTPUT_INVALID")
        except OSError as error:
            raise MediaError("MEDIA_OUTPUT_INVALID", cause=error) from error

    @staticmethod
    def _cached_outputs_are_valid(project_root: Path, value: dict[str, Any]) -> bool:
        try:
            outputs = value["outputs"]
            if not isinstance(outputs, list) or len(outputs) != 3:
                return False
            for item in outputs:
                relative = str(item["relativePath"])
                path = (project_root / relative).resolve()
                if not relative.startswith(f"cache/{MEDIA_CACHE_VERSION}/proxy/") or os.path.commonpath([str(project_root.resolve()), str(path)]) != str(project_root.resolve()):
                    return False
                if not stat.S_ISREG(path.stat().st_mode) or path.stat().st_size != int(item["sizeBytes"]):
                    return False
            return True
        except (KeyError, TypeError, ValueError, OSError):
            return False

    async def _run(self, args: list[str], timeout_ms: int, cancelled: asyncio.Event) -> bytes:
        try:
            process = await asyncio.create_subprocess_exec(*args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except (FileNotFoundError, PermissionError, OSError) as error:
            raise MediaError("MEDIA_TOOL_UNAVAILABLE", cause=error) from error
        communicate = asyncio.create_task(process.communicate())
        cancel_wait = asyncio.create_task(cancelled.wait())
        try:
            done, _ = await asyncio.wait({communicate, cancel_wait}, timeout=timeout_ms / 1_000, return_when=asyncio.FIRST_COMPLETED)
            if cancel_wait in done and cancelled.is_set():
                process.kill()
                await process.wait()
                raise MediaError("MEDIA_CANCELLED")
            if communicate not in done:
                process.kill()
                await process.wait()
                raise MediaError("MEDIA_TOOL_TIMEOUT")
            stdout, _stderr = communicate.result()
            if process.returncode != 0:
                raise MediaError("MEDIA_NOT_MEDIA")
            return stdout
        except asyncio.CancelledError:
            if process.returncode is None:
                process.kill()
                await process.wait()
            raise
        finally:
            cancel_wait.cancel()
            if not communicate.done():
                communicate.cancel()

    @staticmethod
    def _parse_probe(raw: bytes) -> MediaMetadata:
        try:
            value = json.loads(raw.decode("utf-8"))
            if not isinstance(value, dict) or not isinstance(value.get("streams"), list) or len(value["streams"]) > 64 or not isinstance(value.get("format"), dict):
                raise ValueError("missing probe sections")
            format_value = value["format"]
            streams: list[MediaStream] = []
            for item in value["streams"][:64]:
                if not isinstance(item, dict):
                    raise ValueError("invalid stream")
                codec_type = item.get("codec_type") if item.get("codec_type") in {"video", "audio", "data", "subtitle", "attachment"} else "unknown"
                values: dict[str, Any] = {"index": item.get("index", 0), "codecType": codec_type, "codecName": item.get("codec_name")}
                for source, target in (("width", "width"), ("height", "height"), ("sample_rate", "sampleRate"), ("channels", "channels"), ("channel_layout", "channelLayout")):
                    if source in item and item[source] not in (None, ""):
                        values[target] = int(item[source]) if source in {"width", "height", "sample_rate", "channels"} else item[source]
                rate = item.get("r_frame_rate") or item.get("avg_frame_rate")
                if isinstance(rate, str) and rate not in {"0/0", "N/A"} and "/" in rate:
                    numerator, denominator = rate.split("/", 1)
                    if float(denominator) != 0:
                        values["frameRate"] = float(numerator) / float(denominator)
                tags = item.get("tags")
                if isinstance(tags, dict) and isinstance(tags.get("language"), str):
                    values["language"] = tags["language"]
                streams.append(MediaStream.model_validate(values))
            duration = format_value.get("duration")
            duration_ms = None if duration in (None, "N/A") else round(float(duration) * 1_000)
            bit_rate = format_value.get("bit_rate")
            return MediaMetadata(schemaVersion=1, formatName=format_value.get("format_name"), formatLongName=format_value.get("format_long_name"), durationMs=duration_ms, bitRate=None if bit_rate in (None, "N/A") else int(bit_rate), streams=streams)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError, KeyError, OverflowError, ValidationError) as error:
            raise MediaError("MEDIA_PROBE_PARSE_ERROR", cause=error) from error
