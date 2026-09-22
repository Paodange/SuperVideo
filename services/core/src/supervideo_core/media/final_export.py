"""C08 verified, atomic final MP4 export from a C06 preview."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import stat
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

from pydantic import ValidationError

from .errors import MediaError
from .service import MediaService
from .preview_render import compute_preview_plan_digest
from .final_export_models import (
    FINAL_EXPORT_MAX_MANIFEST_BYTES,
    FINAL_EXPORT_MAX_OUTPUT_BYTES,
    FINAL_EXPORT_POLICY,
    FINAL_EXPORT_SCHEMA_VERSION,
    FINAL_EXPORT_VERSION,
    FINAL_OUTPUT_PATTERN,
    FinalMp4Container,
    FinalMp4ExportParams,
    FinalMp4ExportResult,
    FinalMp4Manifest,
    FinalMp4Output,
    validate_final_export_size,
)

FINAL_MANIFEST_PATTERN = re.compile(r"^exports/videos/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.manifest\.json$")
MEDIA_DURATION_TOLERANCE_MS = 100
ExportBudgetCheck = Callable[[], None]


class FinalMp4ExportService:
    """Only exports an already executed and independently verified C06 result."""

    def __init__(self, *, ffprobe_path: str | None = None, clock: Callable[[], float] | None = None) -> None:
        self.ffprobe_path = MediaService._resolve_tool(ffprobe_path, "ffprobe")
        self._project_root: Path | None = None
        self._clock = clock or time.monotonic

    def bind_session(self, project_root: Path, _database: object) -> None:
        self._project_root = project_root

    async def export(self, request: FinalMp4ExportParams, cancelled: asyncio.Event) -> FinalMp4ExportResult:
        deadline = self._clock() + request.timeout_ms / 1_000
        self._check_budget(cancelled, deadline)
        preview = request.preview_result
        quality = request.quality_result
        self._validate_gate(request, deadline, cancelled)
        if self._project_root is None:
            raise MediaError("FINAL_EXPORT_SOURCE_INVALID")
        source_path = self._resolve_project_file(preview.output.relative_path if preview.output else "")
        source_manifest_path = self._resolve_project_file(
            self._manifest_relative_path(preview.output.relative_path if preview.output else ""),
            expected_prefix="previews/preview-render-v1/",
        )
        source_output = preview.output
        assert source_output is not None
        self._verify_preview_manifest(source_manifest_path, request.project_id, preview, source_output)
        source_size, source_fingerprint = self._source_signature(source_path, cancelled, deadline)
        if source_size != source_output.size_bytes or source_fingerprint != source_output.output_fingerprint:
            raise MediaError("FINAL_EXPORT_SOURCE_TAMPERED")

        output_name = request.output_name or f"final-{preview.plan_digest}.mp4"
        output_relative = f"exports/videos/{output_name}"
        manifest_relative = output_relative.removesuffix(".mp4") + ".manifest.json"
        output_path = self._resolve_project_file(output_relative, expected_prefix="exports/videos/")
        manifest_path = self._resolve_project_file(manifest_relative, expected_prefix="exports/videos/")
        self._ensure_export_directory()
        quality_digest = _json_digest(quality.model_dump(by_alias=True))
        existing = self._read_cache(manifest_path, output_path, request, quality_digest)
        if existing is not None:
            return validate_final_export_size(existing.model_copy(update={"status": "cache-hit"}))
        if output_path.exists() or manifest_path.exists():
            raise MediaError("FINAL_EXPORT_OUTPUT_CONFLICT")

        temp_path: Path | None = None
        try:
            temp_path = self._copy_to_temp(source_path, output_path.parent, cancelled, deadline, source_size, source_fingerprint)
            container, duration_ms = await self._verify_container(temp_path, source_output.duration_ms, cancelled, deadline)
            self._check_budget(cancelled, deadline)
            output_size, output_fingerprint = self._source_signature(temp_path, cancelled, deadline)
            if output_size > FINAL_EXPORT_MAX_OUTPUT_BYTES or output_size != source_size or output_fingerprint != source_fingerprint:
                raise MediaError("FINAL_EXPORT_OUTPUT_INVALID")
            output = FinalMp4Output(
                kind="video",
                relativePath=output_relative,
                manifestRelativePath=manifest_relative,
                sizeBytes=output_size,
                durationMs=duration_ms,
                outputFingerprint=output_fingerprint,
                container=container,
            )
            result = FinalMp4ExportResult(
                schemaVersion=FINAL_EXPORT_SCHEMA_VERSION,
                exportVersion=FINAL_EXPORT_VERSION,
                exportPolicy=FINAL_EXPORT_POLICY,
                projectId=request.project_id,
                timelineId=preview.timeline_id,
                planDigest=preview.plan_digest,
                qualityDigest=quality_digest,
                status="completed",
                output=output,
            )
            manifest = FinalMp4Manifest(
                schemaVersion=FINAL_EXPORT_SCHEMA_VERSION,
                exportVersion=FINAL_EXPORT_VERSION,
                exportPolicy=FINAL_EXPORT_POLICY,
                status="completed",
                projectId=request.project_id,
                timelineId=preview.timeline_id,
                planDigest=preview.plan_digest,
                previewOutputFingerprint=source_output.output_fingerprint,
                qualityVersion=quality.qa_version,
                qualityDigest=quality_digest,
                qualityStatus=quality.status,
                relativePath=output.relative_path,
                manifestRelativePath=output.manifest_relative_path,
                sizeBytes=output.size_bytes,
                durationMs=output.duration_ms,
                outputFingerprint=output.output_fingerprint,
                container=container,
            )
            os.replace(temp_path, output_path)
            temp_path = None
            # The manifest is committed after the bytes have become visible. A subsequent run
            # treats an orphaned output as a conflict instead of silently replacing it.
            self._atomic_write_json(manifest_path, manifest.model_dump(by_alias=True))
            return validate_final_export_size(result)
        except MediaError:
            raise
        except (OSError, TypeError, ValueError, ValidationError) as error:
            raise MediaError("FINAL_EXPORT_OUTPUT_INVALID", cause=error) from error
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

    def _validate_gate(self, request: FinalMp4ExportParams, deadline: float, cancelled: asyncio.Event) -> None:
        preview = request.preview_result
        quality = request.quality_result
        if preview.execution_mode != "ffmpeg" or preview.execution_status != "completed" or preview.status != "ready" or preview.gaps or preview.output is None:
            raise MediaError("FINAL_EXPORT_PREVIEW_NOT_READY")
        if quality.phase != "executed" or quality.status != "pass" or not quality.ready_for_export or not quality.execution_verified:
            raise MediaError("FINAL_EXPORT_QUALITY_NOT_READY")
        if quality.project_id != request.project_id or quality.plan_digest != preview.plan_digest:
            raise MediaError("FINAL_EXPORT_INPUT_INVALID")
        if any(issue.severity != "pass" or issue.status != "verified" for issue in quality.issues):
            raise MediaError("FINAL_EXPORT_QUALITY_NOT_READY")
        expected_digest = compute_preview_plan_digest(
            preview.project_id,
            preview.timeline_id,
            preview.aroll_plan_digest,
            preview.subtitle_plan_digest,
            preview.selected_duration_ms,
            list(preview.cues),
            list(preview.gaps),
            list(preview.source_bindings),
        )
        if expected_digest != preview.plan_digest:
            raise MediaError("FINAL_EXPORT_INPUT_INVALID")
        output = preview.output
        if output.relative_path != f"previews/preview-render-v1/{preview.plan_digest}.mp4" or output.playback_uri != f"supervideo://preview/{request.project_id}/{preview.plan_digest}":
            raise MediaError("FINAL_EXPORT_INPUT_INVALID")
        self._check_budget(cancelled, deadline)

    async def _verify_container(
        self,
        path: Path,
        expected_duration_ms: int,
        cancelled: asyncio.Event,
        deadline: float,
    ) -> tuple[FinalMp4Container, int]:
        if self.ffprobe_path is None:
            raise MediaError("FINAL_EXPORT_TOOL_UNAVAILABLE")
        remaining_ms = int((deadline - self._clock()) * 1_000)
        if remaining_ms <= 0:
            raise MediaError("FINAL_EXPORT_TIMEOUT")
        try:
            raw = await MediaService._run(
                [self.ffprobe_path, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
                remaining_ms,
                cancelled,
                overflow_code="FINAL_EXPORT_CONTAINER_INVALID",
                stdout_limit=128 * 1024,
            )
            metadata = MediaService._parse_probe(raw)
        except MediaError as error:
            if error.code == "MEDIA_CANCELLED":
                raise MediaError("FINAL_EXPORT_CANCELLED") from error
            if error.code == "MEDIA_TOOL_TIMEOUT":
                raise MediaError("FINAL_EXPORT_TIMEOUT") from error
            if error.code == "MEDIA_TOOL_UNAVAILABLE":
                raise MediaError("FINAL_EXPORT_TOOL_UNAVAILABLE") from error
            raise MediaError("FINAL_EXPORT_CONTAINER_INVALID") from error
        self._check_budget(cancelled, deadline)
        format_name = metadata.format_name or ""
        video = next((stream for stream in metadata.streams if stream.codec_type == "video"), None)
        audio = next((stream for stream in metadata.streams if stream.codec_type == "audio"), None)
        if "mp4" not in {part.strip().casefold() for part in format_name.split(",")} or video is None or video.codec_name != "h264":
            raise MediaError("FINAL_EXPORT_CONTAINER_INVALID")
        if audio is not None and audio.codec_name != "aac":
            raise MediaError("FINAL_EXPORT_CONTAINER_INVALID")
        if video.width is None or video.height is None:
            raise MediaError("FINAL_EXPORT_CONTAINER_INVALID")
        duration_ms = metadata.duration_ms
        if duration_ms is None or abs(duration_ms - expected_duration_ms) > MEDIA_DURATION_TOLERANCE_MS:
            raise MediaError("FINAL_EXPORT_CONTAINER_INVALID")
        return FinalMp4Container(
            formatName=format_name,
            videoCodec=video.codec_name,
            audioCodec=audio.codec_name if audio is not None else None,
            width=video.width,
            height=video.height,
            frameRate=video.frame_rate,
        ), duration_ms

    def _copy_to_temp(self, source: Path, directory: Path, cancelled: asyncio.Event, deadline: float, expected_size: int, expected_fingerprint: str) -> Path:
        if expected_size <= 0 or expected_size > FINAL_EXPORT_MAX_OUTPUT_BYTES:
            raise MediaError("FINAL_EXPORT_SOURCE_INVALID")
        fd, name = tempfile.mkstemp(prefix=".final-export-", suffix=".mp4", dir=str(directory))
        os.close(fd)
        temp_path = Path(name)
        digest = hashlib.sha256()
        copied = 0
        try:
            with source.open("rb") as source_handle, temp_path.open("wb") as target_handle:
                while True:
                    self._check_budget(cancelled, deadline)
                    chunk = source_handle.read(1024 * 1024)
                    if not chunk:
                        break
                    copied += len(chunk)
                    if copied > FINAL_EXPORT_MAX_OUTPUT_BYTES:
                        raise MediaError("FINAL_EXPORT_OUTPUT_INVALID")
                    digest.update(chunk)
                    target_handle.write(chunk)
                target_handle.flush()
                os.fsync(target_handle.fileno())
            self._check_budget(cancelled, deadline)
            try:
                if source.stat().st_size != expected_size:
                    raise MediaError("FINAL_EXPORT_SOURCE_TAMPERED")
            except OSError as error:
                raise MediaError("FINAL_EXPORT_SOURCE_INVALID", cause=error) from error
            if copied != expected_size or digest.hexdigest() != expected_fingerprint:
                raise MediaError("FINAL_EXPORT_SOURCE_TAMPERED")
            return temp_path
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise

    def _source_signature(self, path: Path, cancelled: asyncio.Event, deadline: float) -> tuple[int, str]:
        try:
            before = path.stat()
            if not stat.S_ISREG(before.st_mode) or path.is_symlink() or before.st_size <= 0:
                raise MediaError("FINAL_EXPORT_SOURCE_INVALID")
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    self._check_budget(cancelled, deadline)
                    digest.update(chunk)
            after = path.stat()
        except MediaError:
            raise
        except OSError as error:
            raise MediaError("FINAL_EXPORT_SOURCE_INVALID", cause=error) from error
        if before.st_size != after.st_size:
            raise MediaError("FINAL_EXPORT_SOURCE_TAMPERED")
        return after.st_size, digest.hexdigest()

    def _verify_preview_manifest(self, path: Path, project_id: str, preview, output) -> None:
        try:
            if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024:
                raise MediaError("FINAL_EXPORT_SOURCE_INVALID")
            value = json.loads(path.read_text(encoding="utf-8"))
            expected = {
                "schemaVersion": 1,
                "projectId": project_id,
                "planDigest": preview.plan_digest,
                "relativePath": output.relative_path,
                "sizeBytes": output.size_bytes,
                "durationMs": output.duration_ms,
                "outputFingerprint": output.output_fingerprint,
            }
            if value != expected:
                raise MediaError("FINAL_EXPORT_SOURCE_TAMPERED")
        except MediaError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError):
            raise MediaError("FINAL_EXPORT_SOURCE_INVALID")

    def _read_cache(self, manifest_path: Path, output_path: Path, request: FinalMp4ExportParams, quality_digest: str) -> FinalMp4ExportResult | None:
        if not manifest_path.exists() or not output_path.exists():
            return None
        try:
            if manifest_path.is_symlink() or output_path.is_symlink() or manifest_path.stat().st_size > FINAL_EXPORT_MAX_MANIFEST_BYTES:
                return None
            manifest = FinalMp4Manifest.model_validate(json.loads(manifest_path.read_text(encoding="utf-8")))
            if manifest.project_id != request.project_id or manifest.timeline_id != request.preview_result.timeline_id or manifest.plan_digest != request.preview_result.plan_digest or manifest.preview_output_fingerprint != request.preview_result.output.output_fingerprint or manifest.quality_digest != quality_digest or manifest.relative_path != self._relative_path(output_path):
                return None
            size, fingerprint = self._plain_signature(output_path)
            if size != manifest.size_bytes or fingerprint != manifest.output_fingerprint:
                return None
            return FinalMp4ExportResult(
                schemaVersion=manifest.schema_version,
                exportVersion=manifest.export_version,
                exportPolicy=manifest.export_policy,
                projectId=manifest.project_id,
                timelineId=manifest.timeline_id,
                planDigest=manifest.plan_digest,
                qualityDigest=manifest.quality_digest,
                status="completed",
                output=FinalMp4Output(
                    kind="video",
                    relativePath=manifest.relative_path,
                    manifestRelativePath=manifest.manifest_relative_path,
                    sizeBytes=manifest.size_bytes,
                    durationMs=manifest.duration_ms,
                    outputFingerprint=manifest.output_fingerprint,
                    container=manifest.container,
                ),
            )
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError, ValidationError, MediaError):
            return None

    def _resolve_project_file(self, relative_path: str, *, expected_prefix: str | None = None) -> Path:
        if self._project_root is None or relative_path.startswith(("/", "\\")) or "\\" in relative_path or ":" in relative_path or any(part in {"", ".", ".."} for part in relative_path.split("/")):
            raise MediaError("FINAL_EXPORT_SOURCE_INVALID")
        if expected_prefix is not None and not relative_path.startswith(expected_prefix):
            raise MediaError("FINAL_EXPORT_SOURCE_INVALID")
        if expected_prefix == "exports/videos/" and FINAL_OUTPUT_PATTERN.fullmatch(relative_path) is None and FINAL_MANIFEST_PATTERN.fullmatch(relative_path) is None:
            raise MediaError("FINAL_EXPORT_OUTPUT_INVALID")
        if expected_prefix == "previews/preview-render-v1/" and not (relative_path.endswith(".mp4") or relative_path.endswith(".manifest.json")):
            raise MediaError("FINAL_EXPORT_SOURCE_INVALID")
        root = self._project_root.resolve()
        lexical = self._project_root / relative_path
        try:
            cursor = lexical
            while cursor != root:
                if cursor.is_symlink():
                    raise MediaError("FINAL_EXPORT_SOURCE_INVALID")
                cursor = cursor.parent
            resolved = lexical.resolve()
            if os.path.commonpath([str(root), str(resolved)]) != str(root):
                raise MediaError("FINAL_EXPORT_SOURCE_INVALID")
            return resolved
        except (OSError, ValueError) as error:
            raise MediaError("FINAL_EXPORT_SOURCE_INVALID", cause=error) from error

    def _ensure_export_directory(self) -> None:
        assert self._project_root is not None
        root = self._project_root.resolve()
        exports = root / "exports"
        videos = exports / "videos"
        for path in (exports, videos):
            if path.exists() and (path.is_symlink() or not path.is_dir()):
                raise MediaError("FINAL_EXPORT_OUTPUT_INVALID")
        try:
            exports.mkdir(exist_ok=True)
            videos.mkdir(exist_ok=True)
        except OSError as error:
            raise MediaError("FINAL_EXPORT_OUTPUT_INVALID", cause=error) from error

    def _manifest_relative_path(self, output_relative_path: str) -> str:
        if not output_relative_path.endswith(".mp4"):
            raise MediaError("FINAL_EXPORT_SOURCE_INVALID")
        return output_relative_path.removesuffix(".mp4") + ".manifest.json"

    def _relative_path(self, path: Path) -> str:
        assert self._project_root is not None
        return str(path.resolve().relative_to(self._project_root.resolve())).replace("\\", "/")

    def _plain_signature(self, path: Path) -> tuple[int, str]:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        return path.stat().st_size, digest

    def _atomic_write_json(self, path: Path, value: dict[str, object]) -> None:
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if len(encoded) > FINAL_EXPORT_MAX_MANIFEST_BYTES:
            raise MediaError("FINAL_EXPORT_OUTPUT_INVALID")
        fd, name = tempfile.mkstemp(prefix=".final-manifest-", suffix=".json", dir=str(path.parent))
        temp = Path(name)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, path)
        except OSError as error:
            raise MediaError("FINAL_EXPORT_OUTPUT_INVALID", cause=error) from error
        finally:
            temp.unlink(missing_ok=True)

    def _check_budget(self, cancelled: asyncio.Event, deadline: float) -> None:
        if cancelled.is_set():
            raise MediaError("FINAL_EXPORT_CANCELLED")
        if self._clock() >= deadline:
            raise MediaError("FINAL_EXPORT_TIMEOUT")


def _json_digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
