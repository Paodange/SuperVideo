"""Deterministic complete-sentence A-roll cut/join planning and safe execution."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlsplit

from supervideo_core.storage import AssetRepository
from supervideo_core.timeline.models import TimelineClip, TimelineProject, TimelineSource, validate_timeline_project, validate_timeline_size

from .errors import MediaError
from .service import MediaService
from .aroll_cut_join_models import (
    AROLL_CUT_JOIN_GAP_POLICY,
    AROLL_CUT_JOIN_MAX_CLIPS,
    AROLL_CUT_JOIN_SELECTION_POLICY,
    AROLL_CUT_JOIN_SCHEMA_VERSION,
    AROLL_CUT_JOIN_VERSION,
    ArollCutJoinGap,
    ArollCutJoinOutput,
    ArollCutJoinParams,
    ArollCutJoinResult,
    ArollCutJoinSegment,
    ArollSourceRef,
    validate_aroll_cut_join_size,
)

ASSET_URI_PATTERN = re.compile(r"^supervideo://asset/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$")


class ArollCutJoinService:
    """Build an immutable plan; optional FFmpeg execution uses only Core-owned paths."""

    def __init__(self, *, ffmpeg_path: str | None = None, clock: Callable[[], float] | None = None) -> None:
        self.ffmpeg_path = MediaService._resolve_tool(ffmpeg_path, "ffmpeg")
        self._clock = clock or time.monotonic
        self._project_root: Path | None = None
        self._database = None

    def bind_session(self, project_root: Path, database: object) -> None:
        self._project_root = project_root
        self._database = database

    async def cut_join(self, request: ArollCutJoinParams, cancelled: asyncio.Event) -> ArollCutJoinResult:
        deadline = self._clock() + request.timeout_ms / 1_000
        try:
            self._check_budget(cancelled, deadline)
            timeline = validate_timeline_size(validate_timeline_project(request.timeline))
            track, clips = self._select_clips(request, timeline)
            segments, gaps = await self._build_plan(request, timeline, track.id, clips, cancelled, deadline)
            digest = self._plan_digest(request, timeline, track.id, segments, gaps)
            output: ArollCutJoinOutput | None = None
            execution_status = "not-run"
            if request.execution_mode == "ffmpeg":
                output = await self._execute(request, timeline, segments, digest, cancelled, deadline)
                execution_status = "completed"
            result = ArollCutJoinResult(
                schemaVersion=AROLL_CUT_JOIN_SCHEMA_VERSION,
                planVersion=AROLL_CUT_JOIN_VERSION,
                projectId=request.project_id,
                timelineId=timeline.id,
                trackId=track.id,
                mode=request.mode,
                executionMode=request.execution_mode,
                executionStatus=execution_status,
                status="gaps" if gaps else "ready",
                selectionPolicy=AROLL_CUT_JOIN_SELECTION_POLICY,
                gapPolicy=AROLL_CUT_JOIN_GAP_POLICY,
                planDigest=digest,
                selectedDurationMs=sum(segment.duration_ms for segment in segments),
                segments=segments,
                gaps=gaps,
                output=output,
            )
            return validate_aroll_cut_join_size(result)
        except MediaError:
            raise
        except asyncio.CancelledError:
            raise
        except ValueError as error:
            raise MediaError("AROLL_CUT_JOIN_OUTPUT_INVALID", cause=error) from error
        except Exception as error:
            raise MediaError("AROLL_CUT_JOIN_OUTPUT_INVALID", cause=error) from error

    @staticmethod
    def _select_clips(request: ArollCutJoinParams, timeline: TimelineProject) -> tuple[object, list[TimelineClip]]:
        tracks = [track for track in timeline.tracks if track.kind == request.mode]
        if request.track_id is not None:
            tracks = [track for track in tracks if track.id == request.track_id]
        if len(tracks) != 1:
            raise MediaError("AROLL_CUT_JOIN_TIMELINE_INVALID")
        track = tracks[0]
        clips = sorted(track.clips, key=lambda clip: (clip.timeline_start_ms, clip.id))
        if not clips or len(clips) > AROLL_CUT_JOIN_MAX_CLIPS:
            raise MediaError("AROLL_CUT_JOIN_INPUT_INVALID")
        for previous, current in zip(clips, clips[1:]):
            if previous.timeline_start_ms + previous.duration_ms > current.timeline_start_ms:
                raise MediaError("AROLL_CUT_JOIN_TIMELINE_INVALID")
        return track, clips

    async def _build_plan(
        self,
        request: ArollCutJoinParams,
        timeline: TimelineProject,
        track_id: str,
        clips: list[TimelineClip],
        cancelled: asyncio.Event,
        deadline: float,
    ) -> tuple[list[ArollCutJoinSegment], list[ArollCutJoinGap]]:
        source_map = {source.id: source for source in timeline.sources}
        segments: list[ArollCutJoinSegment] = []
        gaps: list[ArollCutJoinGap] = []
        output_cursor = 0
        previous_clip: TimelineClip | None = None
        previous_end = 0
        for index, clip in enumerate(clips, start=1):
            self._check_budget(cancelled, deadline)
            self._validate_clip(request, clip, source_map)
            if clip.timeline_start_ms > previous_end:
                gaps.append(self._gap(previous_clip, clip, previous_end, clip.timeline_start_ms))
            source = source_map[clip.source_id]
            assert clip.source_in_ms is not None and clip.source_out_ms is not None and clip.sentence_id is not None
            segment = ArollCutJoinSegment(
                order=index,
                clipId=clip.id,
                sentenceId=clip.sentence_id,
                source=ArollSourceRef(
                    sourceId=source.id,
                    uri=source.uri,
                    mediaType=request.mode,
                    durationMs=source.duration_ms,
                    fingerprint=source.fingerprint,
                ),
                sourceInMs=clip.source_in_ms,
                sourceOutMs=clip.source_out_ms,
                durationMs=clip.duration_ms,
                timelineStartMs=clip.timeline_start_ms,
                outputStartMs=output_cursor,
                outputEndMs=output_cursor + clip.duration_ms,
            )
            segments.append(segment)
            output_cursor += clip.duration_ms
            previous_clip = clip
            previous_end = clip.timeline_start_ms + clip.duration_ms
            await asyncio.sleep(0)
        if previous_clip is not None and previous_end < timeline.duration_ms:
            gaps.append(self._gap(previous_clip, None, previous_end, timeline.duration_ms))
        self._check_budget(cancelled, deadline)
        return segments, gaps

    @staticmethod
    def _validate_clip(request: ArollCutJoinParams, clip: TimelineClip, sources: dict[str, TimelineSource]) -> None:
        if clip.kind != request.mode or clip.source_id is None or clip.sentence_id is None:
            raise MediaError("AROLL_CUT_JOIN_INPUT_INVALID")
        if clip.source_in_ms is None or clip.source_out_ms is None or clip.source_out_ms - clip.source_in_ms != clip.duration_ms:
            raise MediaError("AROLL_CUT_JOIN_INPUT_INVALID")
        metadata = clip.metadata or {}
        if metadata.get("sentenceStatus") != "complete":
            raise MediaError("AROLL_CUT_JOIN_INPUT_INVALID")
        source = sources.get(clip.source_id)
        if source is None:
            raise MediaError("AROLL_CUT_JOIN_SOURCE_INVALID")
        if source.kind != "asset" or source.media_type != request.mode or source.duration_ms is None:
            raise MediaError("AROLL_CUT_JOIN_SOURCE_INVALID")
        if source.metadata is None or source.metadata.get("role") != "a-roll":
            raise MediaError("AROLL_CUT_JOIN_SOURCE_INVALID")
        if ASSET_URI_PATTERN.fullmatch(source.uri) is None:
            raise MediaError("AROLL_CUT_JOIN_SOURCE_INVALID")
        if clip.source_out_ms > source.duration_ms:
            raise MediaError("AROLL_CUT_JOIN_SOURCE_INVALID")

    @staticmethod
    def _gap(before: TimelineClip | None, after: TimelineClip | None, start_ms: int, end_ms: int) -> ArollCutJoinGap:
        return ArollCutJoinGap(
            code="timeline-gap",
            beforeClipId=before.id if before else None,
            afterClipId=after.id if after else None,
            startMs=start_ms,
            endMs=end_ms,
            durationMs=end_ms - start_ms,
        )

    @staticmethod
    def _plan_digest(
        request: ArollCutJoinParams,
        timeline: TimelineProject,
        track_id: str,
        segments: list[ArollCutJoinSegment],
        gaps: list[ArollCutJoinGap],
    ) -> str:
        value = {
            "schemaVersion": AROLL_CUT_JOIN_SCHEMA_VERSION,
            "projectId": request.project_id,
            "timelineId": timeline.id,
            "trackId": track_id,
            "mode": request.mode,
            "selectionPolicy": AROLL_CUT_JOIN_SELECTION_POLICY,
            "gapPolicy": AROLL_CUT_JOIN_GAP_POLICY,
            "segments": [segment.model_dump(by_alias=True) for segment in segments],
            "gaps": [gap.model_dump(by_alias=True) for gap in gaps],
        }
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    async def _execute(
        self,
        request: ArollCutJoinParams,
        timeline: TimelineProject,
        segments: list[ArollCutJoinSegment],
        digest: str,
        cancelled: asyncio.Event,
        deadline: float,
    ) -> ArollCutJoinOutput:
        if self.ffmpeg_path is None:
            raise MediaError("AROLL_CUT_JOIN_TOOL_UNAVAILABLE")
        if self._project_root is None or self._database is None:
            raise MediaError("AROLL_CUT_JOIN_SOURCE_INVALID")
        inputs: list[tuple[Path, tuple[int, int], str]] = []
        for segment in segments:
            self._check_budget(cancelled, deadline)
            source_id = self._asset_id_from_uri(segment.source.uri)
            try:
                asset = AssetRepository(self._database).get(source_id, request.project_id)
                path, _ = self._canonical_asset_path(asset.absolute_path)
                signature, fingerprint = MediaService._asset_signature(path)
            except Exception as error:
                if isinstance(error, MediaError):
                    raise
                raise MediaError("AROLL_CUT_JOIN_SOURCE_INVALID", cause=error) from error
            if segment.source.fingerprint is not None and segment.source.fingerprint != fingerprint:
                raise MediaError("AROLL_CUT_JOIN_SOURCE_INVALID")
            inputs.append((path, signature, fingerprint))
        previews_dir = self._project_root / "previews"
        if previews_dir.exists() and (previews_dir.is_symlink() or not previews_dir.is_dir()):
            raise MediaError("AROLL_CUT_JOIN_OUTPUT_INVALID")
        if not previews_dir.exists():
            try:
                previews_dir.mkdir()
            except OSError as error:
                raise MediaError("AROLL_CUT_JOIN_OUTPUT_INVALID", cause=error) from error
        output_dir = previews_dir / "aroll-cut-join-v1"
        MediaService._ensure_output_directory(output_dir)
        filename = f"{digest}.{request.mode}.{'m4a' if request.mode == 'audio' else 'mp4'}"
        output_path = output_dir / filename
        if output_path.exists():
            if output_path.is_symlink():
                raise MediaError("AROLL_CUT_JOIN_OUTPUT_INVALID")
            try:
                MediaService._ensure_output(output_path)
                return ArollCutJoinOutput(kind=request.mode, relativePath=self._relative_path(self._project_root, output_path), sizeBytes=output_path.stat().st_size)
            except MediaError:
                output_path.unlink(missing_ok=True)
        temp_fd, temp_name = tempfile.mkstemp(prefix=f".{digest[:16]}-", suffix=output_path.suffix, dir=str(output_dir))
        os.close(temp_fd)
        temp_path = Path(temp_name)
        try:
            args = self._ffmpeg_args(
                self.ffmpeg_path,
                inputs,
                segments,
                temp_path,
                request.mode,
                width=timeline.canvas.width,
                height=timeline.canvas.height,
                fps=timeline.canvas.fps,
            )
            try:
                remaining_ms = max(1, min(request.timeout_ms, int((deadline - self._clock()) * 1_000)))
                await MediaService._run(args, remaining_ms, cancelled, overflow_code="AROLL_CUT_JOIN_OUTPUT_INVALID", stdout_limit=64 * 1024)
            except MediaError as error:
                mapped = {
                    "MEDIA_TOOL_UNAVAILABLE": "AROLL_CUT_JOIN_TOOL_UNAVAILABLE",
                    "MEDIA_TOOL_TIMEOUT": "AROLL_CUT_JOIN_TOOL_TIMEOUT",
                    "MEDIA_CANCELLED": "AROLL_CUT_JOIN_CANCELLED",
                }.get(error.code, "AROLL_CUT_JOIN_OUTPUT_INVALID")
                raise MediaError(mapped, cause=error) from error
            self._check_budget(cancelled, deadline)
            for path, signature, fingerprint in inputs:
                current, current_fingerprint = MediaService._asset_signature(path)
                if current != signature or current_fingerprint != fingerprint:
                    raise MediaError("AROLL_CUT_JOIN_SOURCE_INVALID")
            try:
                MediaService._ensure_output(temp_path)
                os.replace(temp_path, output_path)
                MediaService._ensure_output(output_path)
            except (OSError, MediaError) as error:
                raise MediaError("AROLL_CUT_JOIN_OUTPUT_INVALID", cause=error) from error
            return ArollCutJoinOutput(kind=request.mode, relativePath=self._relative_path(self._project_root, output_path), sizeBytes=output_path.stat().st_size)
        finally:
            temp_path.unlink(missing_ok=True)

    @staticmethod
    def _asset_id_from_uri(uri: str) -> str:
        match = ASSET_URI_PATTERN.fullmatch(uri)
        if match is None:
            raise MediaError("AROLL_CUT_JOIN_SOURCE_INVALID")
        return match.group(1)

    @staticmethod
    def _canonical_asset_path(value: str) -> tuple[Path, object]:
        from supervideo_core.project.paths import canonical_asset_path

        return canonical_asset_path(value)

    @staticmethod
    def _relative_path(root: Path, value: Path) -> str:
        resolved_root = root.resolve()
        resolved_value = value.resolve()
        try:
            if os.path.commonpath([str(resolved_root), str(resolved_value)]) != str(resolved_root):
                raise MediaError("AROLL_CUT_JOIN_OUTPUT_INVALID")
        except ValueError as error:
            raise MediaError("AROLL_CUT_JOIN_OUTPUT_INVALID", cause=error) from error
        return str(resolved_value.relative_to(resolved_root)).replace("\\", "/")

    @staticmethod
    def _ffmpeg_args(
        ffmpeg_path: str,
        inputs: list[tuple[Path, tuple[int, int], str]],
        segments: list[ArollCutJoinSegment],
        output_path: Path,
        mode: str,
        *,
        width: int | None = None,
        height: int | None = None,
        fps: float | None = None,
    ) -> list[str]:
        args = [ffmpeg_path, "-y", "-hide_banner", "-loglevel", "error"]
        for path, _signature, _fingerprint in inputs:
            args.extend(["-i", str(path)])
        filters: list[str] = []
        labels: list[str] = []
        for index, segment in enumerate(segments):
            start = f"{segment.source_in_ms / 1_000:.3f}"
            end = f"{segment.source_out_ms / 1_000:.3f}"
            if mode == "audio":
                label = f"a{index}"
                filters.append(f"[{index}:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[{label}]")
            else:
                label = f"v{index}"
                normalize = ""
                if width is not None and height is not None and fps is not None:
                    normalize = f",fps=fps={fps:.3f},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p"
                filters.append(f"[{index}:v]trim=start={start}:end={end},setpts=PTS-STARTPTS{normalize}[{label}]")
            labels.append(f"[{label}]")
        output_label = "outa" if mode == "audio" else "outv"
        filters.append("".join(labels) + f"concat=n={len(labels)}:v={'0' if mode == 'audio' else '1'}:a={'1' if mode == 'audio' else '0'}[{output_label}]")
        args.extend(["-filter_complex", ";".join(filters), "-map", f"[{output_label}]"])
        if mode == "audio":
            args.extend(["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", str(output_path)])
        else:
            args.extend(["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output_path)])
        return args

    def _check_budget(self, cancelled: asyncio.Event, deadline: float) -> None:
        if cancelled.is_set():
            raise MediaError("AROLL_CUT_JOIN_CANCELLED")
        if self._clock() >= deadline:
            raise MediaError("AROLL_CUT_JOIN_TIMEOUT")
