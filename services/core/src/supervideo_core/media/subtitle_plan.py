"""Deterministic subtitle cue planning from Timeline IR V1."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
import unicodedata
from collections.abc import Callable

from supervideo_core.timeline.models import TimelineClip, TimelineProject, TimelineSource, validate_timeline_project, validate_timeline_size

from .errors import MediaError
from .subtitle_plan_models import (
    SUBTITLE_PLAN_MAX_CUES,
    SUBTITLE_PLAN_MAX_TOTAL_TEXT_LENGTH,
    SUBTITLE_PLAN_SCHEMA_VERSION,
    SUBTITLE_PLAN_VERSION,
    SubtitleCue,
    SubtitlePlanGap,
    SubtitlePlanParams,
    SubtitlePlanResult,
    SubtitleSentenceSource,
    validate_subtitle_plan_size,
)


class SubtitlePlanService:
    """Builds an immutable subtitle plan; it never reads or writes media files."""

    def __init__(self, *, clock: Callable[[], float] | None = None) -> None:
        self._clock = clock or time.monotonic

    async def plan(self, request: SubtitlePlanParams, cancelled: asyncio.Event) -> SubtitlePlanResult:
        deadline = self._clock() + request.timeout_ms / 1_000
        try:
            self._check_budget(cancelled, deadline)
            timeline = validate_timeline_size(validate_timeline_project(request.timeline))
            sentence_sources = self._sentence_sources(request.sentence_sources)
            timeline_sources = {source.id: source for source in timeline.sources}
            clips = self._select_clips(request, timeline)
            cues: list[SubtitleCue] = []
            gaps: list[SubtitlePlanGap] = []
            for clip in clips:
                self._check_budget(cancelled, deadline)
                cue_input = self._resolve_clip(clip, sentence_sources, timeline_sources)
                if cue_input is None:
                    gap = self._gap_for_clip(clip, sentence_sources)
                    gaps.append(gap)
                    continue
                text, language, sentence_id, source_id, source_in, source_out, provenance_ids = cue_input
                self._validate_text(text, request.max_lines, request.max_line_width)
                if len(cues) >= SUBTITLE_PLAN_MAX_CUES:
                    raise MediaError("SUBTITLE_INPUT_INVALID")
                cues.append(SubtitleCue(
                    order=len(cues) + 1,
                    cueId=f"subtitle-{clip.id}",
                    clipId=clip.id,
                    sentenceId=sentence_id,
                    sourceId=source_id,
                    sourceInMs=source_in,
                    sourceOutMs=source_out,
                    provenanceIds=provenance_ids,
                    text=text,
                    language=language,
                    timelineStartMs=clip.timeline_start_ms,
                    durationMs=clip.duration_ms,
                    timelineEndMs=clip.timeline_start_ms + clip.duration_ms,
                ))
            self._validate_cues(cues, timeline.duration_ms)
            if sum(len(cue.text) for cue in cues) > SUBTITLE_PLAN_MAX_TOTAL_TEXT_LENGTH:
                raise MediaError("SUBTITLE_TEXT_INVALID")
            if not cues and not gaps:
                raise MediaError("SUBTITLE_INPUT_INVALID")
            result_without_digest = {
                "schemaVersion": SUBTITLE_PLAN_SCHEMA_VERSION,
                "planVersion": SUBTITLE_PLAN_VERSION,
                "projectId": request.project_id,
                "timelineId": timeline.id,
                "status": "gaps" if gaps else "ready",
                "selectionPolicy": "timeline-subtitles-or-sentence-clips-v1",
                "layoutPolicy": "bounded-display-width-v1",
                "maxLines": request.max_lines,
                "maxLineWidth": request.max_line_width,
                "totalDurationMs": sum(cue.duration_ms for cue in cues),
                "cueCount": len(cues),
                "cues": [cue.model_dump(by_alias=True) for cue in cues],
                "gaps": [gap.model_dump(by_alias=True) for gap in gaps],
            }
            digest = self._digest(result_without_digest)
            result = SubtitlePlanResult(planDigest=digest, **result_without_digest)
            return validate_subtitle_plan_size(result)
        except MediaError:
            raise
        except asyncio.CancelledError:
            raise
        except TimeoutError as error:
            raise MediaError("SUBTITLE_TIMEOUT", cause=error) from error
        except (ValueError, TypeError) as error:
            raise MediaError("SUBTITLE_OUTPUT_INVALID", cause=error) from error
        except Exception as error:
            raise MediaError("SUBTITLE_OUTPUT_INVALID", cause=error) from error

    @staticmethod
    def _sentence_sources(items: list[SubtitleSentenceSource]) -> dict[str, SubtitleSentenceSource]:
        values: dict[str, SubtitleSentenceSource] = {}
        for item in items:
            if item.sentence_id in values:
                raise MediaError("SUBTITLE_INPUT_INVALID")
            values[item.sentence_id] = item
        return values

    @staticmethod
    def _select_clips(request: SubtitlePlanParams, timeline: TimelineProject) -> list[TimelineClip]:
        if request.track_id is not None:
            tracks = [track for track in timeline.tracks if track.id == request.track_id]
            if len(tracks) != 1 or tracks[0].kind not in {"subtitle", "video", "audio"}:
                raise MediaError("SUBTITLE_TIMELINE_INVALID")
        else:
            subtitle_tracks = [track for track in timeline.tracks if track.kind == "subtitle" and track.clips]
            tracks = subtitle_tracks or [track for track in timeline.tracks if track.kind in {"video", "audio"} and track.clips]
        clips = sorted((clip for track in tracks for clip in track.clips), key=lambda clip: (clip.timeline_start_ms, clip.id))
        if len(clips) > SUBTITLE_PLAN_MAX_CUES:
            raise MediaError("SUBTITLE_INPUT_INVALID")
        return clips

    @staticmethod
    def _resolve_clip(
        clip: TimelineClip,
        sentence_sources: dict[str, SubtitleSentenceSource],
        timeline_sources: dict[str, TimelineSource],
    ) -> tuple[str, str | None, str | None, str | None, int | None, int | None, list[str]] | None:
        sentence_id = clip.sentence_id
        sentence = sentence_sources.get(sentence_id) if sentence_id is not None else None
        subtitle = clip.subtitle
        metadata = clip.metadata or {}
        text = subtitle.text if subtitle is not None else _metadata_text(metadata)
        if text is None and sentence is not None:
            text = sentence.text
        if text is None:
            return None
        language = subtitle.language if subtitle is not None else None
        if language is None and sentence is not None:
            language = sentence.language
        source_id = clip.source_id or (sentence.source_id if sentence is not None else None)
        if source_id is not None and source_id not in timeline_sources:
            raise MediaError("SUBTITLE_SOURCE_INVALID")
        source_in = clip.source_in_ms
        source_out = clip.source_out_ms
        if source_in is None and sentence is not None:
            source_in, source_out = sentence.source_in_ms, sentence.source_out_ms
        if source_id is not None and source_out is not None:
            declared_duration = timeline_sources[source_id].duration_ms
            if declared_duration is not None and source_out > declared_duration:
                raise MediaError("SUBTITLE_TIMECODE_INVALID")
        provenance_ids = list(dict.fromkeys([
            *(clip.provenance_ids or []),
            *(sentence.provenance_ids if sentence is not None else []),
            *(timeline_sources[source_id].provenance_ids if source_id is not None else []),
        ]))
        return text, language, sentence_id, source_id, source_in, source_out, provenance_ids

    @staticmethod
    def _gap_for_clip(clip: TimelineClip, sentence_sources: dict[str, SubtitleSentenceSource]) -> SubtitlePlanGap:
        if clip.sentence_id is not None and clip.sentence_id not in sentence_sources:
            return SubtitlePlanGap(code="missing-sentence-source", clipId=clip.id, sentenceId=clip.sentence_id, detail="No B03 sentence source was supplied for this sentence clip.")
        return SubtitlePlanGap(code="missing-subtitle-text", clipId=clip.id, sentenceId=clip.sentence_id, detail="The timeline clip has no subtitle text or resolvable sentence source.")

    @staticmethod
    def _validate_text(text: str, max_lines: int, max_line_width: int) -> None:
        if not text or len(text) > 256 or any(ord(character) < 32 and character not in "\n\r\t" for character in text):
            raise MediaError("SUBTITLE_TEXT_INVALID")
        lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        if len(lines) > max_lines:
            raise MediaError("SUBTITLE_LINE_COUNT_INVALID")
        if any(_display_width(line) > max_line_width for line in lines):
            raise MediaError("SUBTITLE_LINE_WIDTH_INVALID")

    @staticmethod
    def _validate_cues(cues: list[SubtitleCue], project_duration_ms: int) -> None:
        previous_end = 0
        for cue in cues:
            if cue.timeline_end_ms > project_duration_ms:
                raise MediaError("SUBTITLE_TIMECODE_INVALID")
            if cue.timeline_start_ms < previous_end:
                raise MediaError("SUBTITLE_OVERLAP")
            if cue.duration_ms <= 0 or cue.timeline_end_ms <= cue.timeline_start_ms:
                raise MediaError("SUBTITLE_TIMECODE_INVALID")
            if cue.source_in_ms is not None and cue.source_out_ms is not None and cue.source_out_ms <= cue.source_in_ms:
                raise MediaError("SUBTITLE_TIMECODE_INVALID")
            previous_end = cue.timeline_end_ms

    @staticmethod
    def _digest(value: dict[str, object]) -> str:
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _check_budget(cancelled: asyncio.Event, deadline: float) -> None:
        if cancelled.is_set():
            raise MediaError("SUBTITLE_CANCELLED")
        if time.monotonic() > deadline:
            raise MediaError("SUBTITLE_TIMEOUT")


def _metadata_text(metadata: dict[str, object]) -> str | None:
    for key in ("subtitleText", "sentenceText", "text"):
        value = metadata.get(key)
        if isinstance(value, str):
            return value
    return None


def _display_width(value: str) -> int:
    width = 0
    for character in value:
        if unicodedata.combining(character):
            continue
        if unicodedata.east_asian_width(character) in {"W", "F"}:
            width += 2
        else:
            width += 1
    return width
