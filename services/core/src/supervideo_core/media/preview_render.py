"""C06 deterministic preview plan and bounded FFmpeg execution."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import tempfile
import time
from collections.abc import Awaitable, Callable
from pathlib import Path

from .aroll_cut_join_models import ArollCutJoinResult
from .errors import MediaError
from .service import MediaService
from .subtitle_plan_models import SubtitlePlanResult
from .preview_render_models import (
    PREVIEW_RENDER_MAX_GAPS,
    PREVIEW_RENDER_MAX_OUTPUT_BYTES,
    PREVIEW_RENDER_POLICY,
    PREVIEW_RENDER_SCHEMA_VERSION,
    PREVIEW_RENDER_VERSION,
    PreviewRenderCue,
    PreviewRenderGap,
    PreviewRenderLog,
    PreviewRenderOutput,
    PreviewRenderParams,
    PreviewRenderResult,
    PreviewSourceBinding,
    validate_preview_render_size,
)

AROLL_OUTPUT_RELATIVE_PATTERN = re.compile(r"^previews/aroll-cut-join-v1/[0-9a-f]{64}\.video\.mp4$")
PREVIEW_MANIFEST_MAX_BYTES = 16 * 1024

ProgressEmitter = Callable[[int, float, str], Awaitable[None]]


class PreviewRenderService:
    """Builds a truthful preview plan; only Core owns the optional tool call."""

    def __init__(self, *, ffmpeg_path: str | None = None, clock: Callable[[], float] | None = None) -> None:
        self.ffmpeg_path = MediaService._resolve_tool(ffmpeg_path, "ffmpeg")
        self._clock = clock or time.monotonic
        self._project_root: Path | None = None
        self._database = None

    def bind_session(self, project_root: Path, database: object) -> None:
        self._project_root = project_root
        self._database = database

    async def render(
        self,
        request: PreviewRenderParams,
        cancelled: asyncio.Event,
        emit: ProgressEmitter | None = None,
    ) -> PreviewRenderResult:
        deadline = self._clock() + request.timeout_ms / 1_000
        try:
            self._check_budget(cancelled, deadline)
            aroll = request.aroll_plan
            subtitles = request.subtitle_plan
            if aroll.mode != "video":
                raise MediaError("PREVIEW_RENDER_SOURCE_INVALID")
            if aroll.timeline_id != subtitles.timeline_id:
                raise MediaError("PREVIEW_RENDER_INPUT_INVALID")
            if emit is not None:
                await emit(1, 0.05, "preview-plan")
            cues, gaps, bindings = self._map_cues(aroll, subtitles)
            self._check_budget(cancelled, deadline)
            digest = self._plan_digest(request.project_id, aroll, subtitles, cues, gaps, bindings)
            output = None
            log = PreviewRenderLog(status="not-run")
            execution_status = "not-run"
            if request.execution_mode == "ffmpeg":
                output, log = await self._execute(request, aroll, digest, cues, cancelled, deadline, emit)
                execution_status = "completed"
            result = PreviewRenderResult(
                schemaVersion=PREVIEW_RENDER_SCHEMA_VERSION,
                planVersion=PREVIEW_RENDER_VERSION,
                projectId=request.project_id,
                timelineId=aroll.timeline_id,
                arollPlanDigest=aroll.plan_digest,
                subtitlePlanDigest=subtitles.plan_digest,
                executionMode=request.execution_mode,
                executionStatus=execution_status,
                status="gaps" if gaps else "ready",
                renderPolicy=PREVIEW_RENDER_POLICY,
                selectedDurationMs=aroll.selected_duration_ms,
                timelineDurationMs=aroll.selected_duration_ms,
                cueCount=len(cues),
                planDigest=digest,
                sourceBindings=bindings,
                cues=cues,
                gaps=gaps,
                log=log,
                output=output,
            )
            if emit is not None:
                await emit(2, 1.0, "preview-completed")
            return validate_preview_render_size(result)
        except MediaError:
            raise
        except asyncio.CancelledError:
            raise
        except (ValueError, TypeError) as error:
            raise MediaError("PREVIEW_RENDER_OUTPUT_INVALID", cause=error) from error
        except Exception as error:
            raise MediaError("PREVIEW_RENDER_OUTPUT_INVALID", cause=error) from error

    @staticmethod
    def _map_cues(
        aroll: ArollCutJoinResult,
        subtitles: SubtitlePlanResult,
    ) -> tuple[list[PreviewRenderCue], list[PreviewRenderGap], list[PreviewSourceBinding]]:
        segments = {segment.clip_id: segment for segment in aroll.segments}
        source_counts: dict[str, int] = {}
        source_values: dict[str, PreviewSourceBinding] = {}
        for segment in aroll.segments:
            source_id = segment.source.source_id
            source_counts[source_id] = source_counts.get(source_id, 0) + 1
            if source_id not in source_values:
                source_values[source_id] = PreviewSourceBinding(
                    sourceId=source_id,
                    uri=segment.source.uri,
                    fingerprint=segment.source.fingerprint,
                    segmentCount=source_counts[source_id],
                )
            else:
                source_values[source_id] = source_values[source_id].model_copy(update={"segmentCount": source_counts[source_id]})
        cues: list[PreviewRenderCue] = []
        gaps: list[PreviewRenderGap] = [
            PreviewRenderGap(code="subtitle-plan-gap", clipId=gap.clip_id, cueId=None, detail=gap.detail)
            for gap in subtitles.gaps[:PREVIEW_RENDER_MAX_GAPS]
        ]
        for cue in subtitles.cues:
            segment = segments.get(cue.clip_id)
            if segment is None:
                if len(gaps) >= PREVIEW_RENDER_MAX_GAPS:
                    raise MediaError("PREVIEW_RENDER_INPUT_INVALID")
                gaps.append(PreviewRenderGap(code="subtitle-cue-unmapped", clipId=cue.clip_id, cueId=cue.cue_id, detail="Subtitle cue is not bound to an A-roll segment."))
                continue
            offset = cue.timeline_start_ms - segment.timeline_start_ms
            if offset < 0 or offset + cue.duration_ms > segment.duration_ms:
                if len(gaps) >= PREVIEW_RENDER_MAX_GAPS:
                    raise MediaError("PREVIEW_RENDER_INPUT_INVALID")
                gaps.append(PreviewRenderGap(code="subtitle-cue-range-invalid", clipId=cue.clip_id, cueId=cue.cue_id, detail="Subtitle cue is outside its A-roll segment."))
                continue
            if cue.source_id is not None and cue.source_id != segment.source.source_id:
                raise MediaError("PREVIEW_RENDER_SUBTITLE_INVALID")
            cues.append(PreviewRenderCue(
                order=len(cues) + 1,
                cueId=cue.cue_id,
                clipId=cue.clip_id,
                sentenceId=cue.sentence_id,
                sourceId=cue.source_id or segment.source.source_id,
                provenanceIds=list(cue.provenance_ids),
                text=cue.text,
                timelineStartMs=cue.timeline_start_ms,
                durationMs=cue.duration_ms,
                outputStartMs=segment.output_start_ms + offset,
                outputEndMs=segment.output_start_ms + offset + cue.duration_ms,
            ))
        return cues, gaps, list(source_values.values())

    @staticmethod
    def _plan_digest(
        project_id: str,
        aroll: ArollCutJoinResult,
        subtitles: SubtitlePlanResult,
        cues: list[PreviewRenderCue],
        gaps: list[PreviewRenderGap],
        bindings: list[PreviewSourceBinding],
    ) -> str:
        value = {
            "schemaVersion": PREVIEW_RENDER_SCHEMA_VERSION,
            "planVersion": PREVIEW_RENDER_VERSION,
            "projectId": project_id,
            "timelineId": aroll.timeline_id,
            "arollPlanDigest": aroll.plan_digest,
            "subtitlePlanDigest": subtitles.plan_digest,
            "renderPolicy": PREVIEW_RENDER_POLICY,
            "selectedDurationMs": aroll.selected_duration_ms,
            "sourceBindings": [item.model_dump(by_alias=True) for item in bindings],
            "cues": [item.model_dump(by_alias=True) for item in cues],
            "gaps": [item.model_dump(by_alias=True) for item in gaps],
        }
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    async def _execute(
        self,
        request: PreviewRenderParams,
        aroll: ArollCutJoinResult,
        digest: str,
        cues: list[PreviewRenderCue],
        cancelled: asyncio.Event,
        deadline: float,
        emit: ProgressEmitter | None,
    ) -> tuple[PreviewRenderOutput, PreviewRenderLog]:
        if self.ffmpeg_path is None:
            raise MediaError("PREVIEW_RENDER_TOOL_UNAVAILABLE")
        if self._project_root is None or self._database is None or aroll.output is None or aroll.output.kind != "video":
            raise MediaError("PREVIEW_RENDER_SOURCE_INVALID")
        input_path = self._resolve_aroll_output_path(aroll)
        input_size = self._ensure_regular_file(input_path, "PREVIEW_RENDER_SOURCE_INVALID")
        if input_size != aroll.output.size_bytes:
            raise MediaError("PREVIEW_RENDER_SOURCE_INVALID")
        output_dir = self._project_root / "previews" / "preview-render-v1"
        self._ensure_output_directory(output_dir)
        output_path = output_dir / f"{digest}.mp4"
        if output_path.exists():
            if output_path.is_symlink():
                raise MediaError("PREVIEW_RENDER_OUTPUT_INVALID")
            cached = self._read_verified_cache(output_path, request.project_id, digest, aroll.selected_duration_ms)
            if cached is not None:
                return cached, PreviewRenderLog(status="cache-hit")
        ass_fd, ass_name = tempfile.mkstemp(prefix=f".{digest[:16]}-", suffix=".ass", dir=str(output_dir))
        temp_fd, temp_name = tempfile.mkstemp(prefix=f".{digest[:16]}-", suffix=".mp4", dir=str(output_dir))
        os.close(ass_fd)
        os.close(temp_fd)
        ass_path = Path(ass_name)
        temp_path = Path(temp_name)
        try:
            ass_path.write_text(self._ass_content(cues), encoding="utf-8", newline="\n")
            if emit is not None:
                await emit(1, 0.2, "preview-ffmpeg")
            args = self._ffmpeg_args(self.ffmpeg_path, input_path, ass_path, temp_path)
            remaining_ms = max(1, min(request.timeout_ms, int((deadline - self._clock()) * 1_000)))
            try:
                await MediaService._run(args, remaining_ms, cancelled, overflow_code="PREVIEW_RENDER_OUTPUT_INVALID", stdout_limit=64 * 1024)
            except MediaError as error:
                mapped = {
                    "MEDIA_TOOL_UNAVAILABLE": "PREVIEW_RENDER_TOOL_UNAVAILABLE",
                    "MEDIA_TOOL_TIMEOUT": "PREVIEW_RENDER_TOOL_TIMEOUT",
                    "MEDIA_CANCELLED": "PREVIEW_RENDER_CANCELLED",
                }.get(error.code, "PREVIEW_RENDER_OUTPUT_INVALID")
                raise MediaError(mapped, cause=error) from error
            self._check_budget(cancelled, deadline)
            self._ensure_regular_file(temp_path)
            if temp_path.stat().st_size > PREVIEW_RENDER_MAX_OUTPUT_BYTES:
                raise MediaError("PREVIEW_RENDER_OUTPUT_INVALID")
            os.replace(temp_path, output_path)
            output = self._output(output_path, request.project_id, digest, aroll.selected_duration_ms)
            self._write_manifest(output_dir / f"{digest}.manifest.json", request.project_id, digest, output)
            return output, PreviewRenderLog(status="completed")
        finally:
            ass_path.unlink(missing_ok=True)
            temp_path.unlink(missing_ok=True)

    def _output(self, path: Path, project_id: str, digest: str, duration_ms: int) -> PreviewRenderOutput:
        size = path.stat().st_size
        if size <= 0 or size > PREVIEW_RENDER_MAX_OUTPUT_BYTES:
            raise MediaError("PREVIEW_RENDER_OUTPUT_INVALID")
        fingerprint = _sha256_file(path)
        return PreviewRenderOutput(
            kind="video",
            relativePath=self._relative_path(path),
            playbackUri=f"supervideo://preview/{project_id}/{digest}",
            sizeBytes=size,
            durationMs=duration_ms,
            outputFingerprint=fingerprint,
        )

    def _resolve_project_file(self, relative_path: str) -> Path:
        if self._project_root is None or relative_path.startswith(("/", "\\")) or "\\" in relative_path or ":" in relative_path:
            raise MediaError("PREVIEW_RENDER_SOURCE_INVALID")
        lexical_candidate = self._project_root / relative_path
        try:
            if lexical_candidate.is_symlink():
                raise MediaError("PREVIEW_RENDER_SOURCE_INVALID")
        except OSError as error:
            raise MediaError("PREVIEW_RENDER_SOURCE_INVALID", cause=error) from error
        candidate = lexical_candidate.resolve()
        try:
            if os.path.commonpath([str(self._project_root.resolve()), str(candidate)]) != str(self._project_root.resolve()):
                raise MediaError("PREVIEW_RENDER_SOURCE_INVALID")
        except ValueError as error:
            raise MediaError("PREVIEW_RENDER_SOURCE_INVALID", cause=error) from error
        if not relative_path.startswith("previews/"):
            raise MediaError("PREVIEW_RENDER_SOURCE_INVALID")
        return candidate

    def _resolve_aroll_output_path(self, aroll: ArollCutJoinResult) -> Path:
        assert aroll.output is not None
        if AROLL_OUTPUT_RELATIVE_PATTERN.fullmatch(aroll.output.relative_path) is None:
            raise MediaError("PREVIEW_RENDER_SOURCE_INVALID")
        expected = f"previews/aroll-cut-join-v1/{aroll.plan_digest}.video.mp4"
        if aroll.output.relative_path != expected:
            raise MediaError("PREVIEW_RENDER_SOURCE_INVALID")
        return self._resolve_project_file(aroll.output.relative_path)

    @staticmethod
    def _ensure_regular_file(path: Path, code: str = "PREVIEW_RENDER_OUTPUT_INVALID") -> int:
        if not path.exists() or path.is_symlink() or not path.is_file() or path.stat().st_size <= 0:
            raise MediaError(code)  # type: ignore[arg-type]
        return path.stat().st_size

    def _read_verified_cache(
        self,
        output_path: Path,
        project_id: str,
        digest: str,
        duration_ms: int,
    ) -> PreviewRenderOutput | None:
        manifest_path = output_path.with_name(f"{digest}.manifest.json")
        try:
            if manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size > PREVIEW_MANIFEST_MAX_BYTES:
                return None
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        if not isinstance(manifest, dict) or set(manifest) != {"schemaVersion", "projectId", "planDigest", "relativePath", "sizeBytes", "durationMs", "outputFingerprint"}:
            return None
        try:
            size = output_path.stat().st_size
            if manifest["schemaVersion"] != 1 or manifest["projectId"] != project_id or manifest["planDigest"] != digest:
                return None
            if manifest["relativePath"] != self._relative_path(output_path) or manifest["sizeBytes"] != size or manifest["durationMs"] != duration_ms:
                return None
            fingerprint = _sha256_file(output_path)
            if manifest["outputFingerprint"] != fingerprint:
                return None
            return self._output(output_path, project_id, digest, duration_ms)
        except (KeyError, OSError, MediaError):
            return None

    def _write_manifest(self, path: Path, project_id: str, digest: str, output: PreviewRenderOutput) -> None:
        payload = {
            "schemaVersion": 1,
            "projectId": project_id,
            "planDigest": digest,
            "relativePath": output.relative_path,
            "sizeBytes": output.size_bytes,
            "durationMs": output.duration_ms,
            "outputFingerprint": output.output_fingerprint,
        }
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if len(encoded) > PREVIEW_MANIFEST_MAX_BYTES:
            raise MediaError("PREVIEW_RENDER_OUTPUT_INVALID")
        fd, temp_name = tempfile.mkstemp(prefix=f".{digest[:16]}-", suffix=".manifest.json", dir=str(path.parent))
        os.close(fd)
        temp_path = Path(temp_name)
        try:
            temp_path.write_bytes(encoded)
            os.replace(temp_path, path)
        except OSError as error:
            raise MediaError("PREVIEW_RENDER_OUTPUT_INVALID", cause=error) from error
        finally:
            temp_path.unlink(missing_ok=True)

    @staticmethod
    def _ensure_output_directory(path: Path) -> None:
        for parent in (path.parent, path):
            if parent.exists() and (parent.is_symlink() or not parent.is_dir()):
                raise MediaError("PREVIEW_RENDER_OUTPUT_INVALID")
        if path.exists() and (path.is_symlink() or not path.is_dir()):
            raise MediaError("PREVIEW_RENDER_OUTPUT_INVALID")
        path.mkdir(parents=True, exist_ok=True)

    def _relative_path(self, path: Path) -> str:
        assert self._project_root is not None
        return str(path.resolve().relative_to(self._project_root.resolve())).replace("\\", "/")

    @staticmethod
    def _ffmpeg_args(ffmpeg_path: str, input_path: Path, ass_path: Path, output_path: Path) -> list[str]:
        escaped = str(ass_path).replace("\\", "/").replace("'", "\\'").replace(":", "\\:")
        return [
            ffmpeg_path, "-y", "-hide_banner", "-loglevel", "error", "-i", str(input_path),
            "-vf", f"subtitles='{escaped}'", "-c:v", "libx264", "-preset", "veryfast",
            "-b:v", "1500k", "-maxrate", "2000k", "-bufsize", "3000k", "-pix_fmt", "yuv420p",
            "-an", "-movflags", "+faststart", str(output_path),
        ]

    @staticmethod
    def _ass_content(cues: list[PreviewRenderCue]) -> str:
        lines = [
            "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "",
            "[V4+ Styles]", "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            "Style: Default,Arial,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,1,2,0,2,80,80,240,1", "",
            "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]
        for cue in cues:
            lines.append(f"Dialogue: 0,{_ass_time(cue.output_start_ms)},{_ass_time(cue.output_end_ms)},Default,,0,0,0,,{_ass_text(cue.text)}")
        return "\n".join(lines) + "\n"

    def _check_budget(self, cancelled: asyncio.Event, deadline: float) -> None:
        if cancelled.is_set():
            raise MediaError("PREVIEW_RENDER_CANCELLED")
        if self._clock() >= deadline:
            raise MediaError("PREVIEW_RENDER_TIMEOUT")


def _ass_time(value_ms: int) -> str:
    total_cs = max(0, value_ms) // 10
    hours, remainder = divmod(total_cs, 360000)
    minutes, remainder = divmod(remainder, 6000)
    seconds, centiseconds = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"


def _ass_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\r\n", "\\N").replace("\n", "\\N").replace("\r", "\\N")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
