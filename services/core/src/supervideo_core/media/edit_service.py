"""Deterministic, local C09 timeline edit parser and transformer."""

from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from typing import Any

from pydantic import ValidationError

from supervideo_core.timeline.models import TimelineClip, TimelineProject, validate_timeline_project

from .edit_models import (
    C09_EDIT_VERSION,
    C09_POLICY,
    EditIntent,
    TimelineEditDiff,
    TimelineEditParams,
    TimelineEditRejection,
    TimelineEditResult,
)


class TimelineEditService:
    """Apply only explicit, bounded edits; never executes text as a command or path."""

    def edit(self, request: TimelineEditParams) -> TimelineEditResult:
        source = validate_timeline_project(request.timeline)
        input_kind = "structured" if request.intent is not None else "natural-language"
        try:
            intent = request.intent or self.parse_instruction(request.instruction or "", source)
        except EditParseError as error:
            intent = self._fallback_intent(error.operation)
            return self._rejected(request, source, input_kind, intent, error.code, error.message)
        try:
            return self._apply(request, source, input_kind, intent)
        except EditReject as error:
            return self._rejected(request, source, input_kind, intent, error.code, error.message, error.target_clip_id)
        except (ValidationError, ValueError) as error:
            return self._rejected(request, source, input_kind, intent, "EDIT_TIMELINE_INVALID", str(error)[:256])

    @staticmethod
    def parse_instruction(instruction: str, timeline: TimelineProject) -> EditIntent:
        text = instruction.strip()
        if not text:
            raise EditParseError("EDIT_UNSUPPORTED_INSTRUCTION", "", "instruction is empty")
        operation: str
        if re.search(r"删|删除|去掉|移除", text):
            operation = "delete"
        elif re.search(r"换成|替换|改成", text) and "字幕" not in text and "CTA" not in text.upper() and "行动号召" not in text:
            operation = "replace"
        elif re.search(r"前移|往前|提前", text):
            operation = "move-forward"
        elif re.search(r"后移|往后|推后", text):
            operation = "move-backward"
        elif re.search(r"缩短|减少时长|短一点", text):
            operation = "shorten"
        elif re.search(r"加长|延长|增加时长|长一点", text):
            operation = "extend"
        elif "字幕" in text and re.search(r"改|换|设|变", text):
            operation = "subtitle"
        elif "CTA" in text.upper() or "行动号召" in text or "结尾" in text and re.search(r"改|换|直接", text):
            operation = "cta"
        else:
            raise EditParseError("EDIT_UNSUPPORTED_INSTRUCTION", "", "instruction does not match a supported C09 template")

        target = _parse_target(text, operation, timeline)
        amount_ms = _parse_amount_ms(text) if operation in {"shorten", "extend"} else None
        replacement_clip_id = None
        new_text = None
        if operation == "replace":
            replacement_phrase = _after_keyword(text, ("换成", "替换成", "替换为"))
            replacement_clip_id = _find_clip_by_phrase(timeline, replacement_phrase)
            if replacement_clip_id is None:
                raise EditParseError("EDIT_REPLACEMENT_NOT_FOUND", target, "replacement must identify exactly one existing clip")
        if operation in {"subtitle", "cta"}:
            new_text = _parse_new_text(text, operation)
            if not new_text:
                raise EditParseError("EDIT_UNSUPPORTED_INSTRUCTION", target, "new text is required")
        try:
            return EditIntent(
                schemaVersion=1,
                editVersion="edit-intent-v1",
                policy=C09_POLICY,
                operation=operation,
                targetClipId=target if _clip_exists(timeline, target) else None,
                targetText=None if _clip_exists(timeline, target) else target,
                replacementClipId=replacement_clip_id,
                text=new_text,
                amountMs=amount_ms,
            )
        except ValidationError as error:
            raise EditParseError("EDIT_UNSUPPORTED_INSTRUCTION", target, str(error)[:256]) from error

    def _apply(self, request: TimelineEditParams, source: TimelineProject, input_kind: str, intent: EditIntent) -> TimelineEditResult:
        clips = [(track_index, clip_index, clip) for track_index, track in enumerate(source.tracks) for clip_index, clip in enumerate(track.clips)]
        target = _resolve_target(intent, clips)
        if target is None:
            if intent.target_text:
                needle = intent.target_text.casefold()
                matches = [item for item in clips if needle in _searchable_clip_text(item[2]).casefold()]
                if len(matches) > 1:
                    raise EditReject("EDIT_AMBIGUOUS_TARGET", "target text matched more than one clip")
            raise EditReject("EDIT_TARGET_NOT_FOUND", "target clip or sentence was not found")
        track_index, clip_index, clip = target
        if intent.operation in {"shorten", "extend"} and clip.sentence_id:
            raise EditReject("EDIT_COMPLETE_SENTENCE_REQUIRED", "duration edits cannot cut a complete sentence", clip.id)
        replacement = None
        if intent.operation == "replace":
            replacement = next((item[2] for item in clips if item[2].id == intent.replacement_clip_id), None)
            if replacement is None or replacement.id == clip.id:
                raise EditReject("EDIT_REPLACEMENT_NOT_FOUND", "replacement clip was not found or equals the target", clip.id)
            if replacement.track_id != clip.track_id:
                raise EditReject("EDIT_OPERATION_UNSAFE", "replacement must stay on the target track", clip.id)
            if replacement.kind != clip.kind:
                raise EditReject("EDIT_OPERATION_UNSAFE", "replacement must keep the target track clip kind", clip.id)

        changed: list[str] = []
        removed: list[str] = []
        moved: list[str] = []
        tracks = deepcopy(list(source.tracks))
        target_clip = tracks[track_index].clips[clip_index]
        if intent.operation == "delete":
            if len([item for track in tracks for item in track.clips]) <= 1:
                raise EditReject("EDIT_TIMELINE_EMPTY", "deleting the last clip would make the Timeline IR invalid", clip.id)
            tracks[track_index].clips.pop(clip_index)
            removed.append(clip.id)
            summary = f"Deleted clip {clip.id}."
        elif intent.operation == "replace":
            replacement_data = replacement.model_dump(by_alias=True, exclude_none=True)  # type: ignore[union-attr]
            replacement_data["id"] = clip.id
            replacement_data["trackId"] = clip.track_id
            replacement_data["timelineStartMs"] = clip.timeline_start_ms
            tracks[track_index].clips[clip_index] = TimelineClip.model_validate(replacement_data)
            changed.append(clip.id)
            summary = f"Replaced clip {clip.id} with {replacement.id}."  # type: ignore[union-attr]
        elif intent.operation in {"move-forward", "move-backward"}:
            ordered = sorted(enumerate(tracks[track_index].clips), key=lambda item: (item[1].timeline_start_ms, item[1].id))
            position = next(index for index, (_, item) in enumerate(ordered) if item.id == clip.id)
            neighbor_position = position - 1 if intent.operation == "move-forward" else position + 1
            if neighbor_position < 0 or neighbor_position >= len(ordered):
                raise EditReject("EDIT_OPERATION_UNSAFE", "target cannot move beyond the track boundary", clip.id)
            neighbor_index, neighbor = ordered[neighbor_position]
            start = min(clip.timeline_start_ms, neighbor.timeline_start_ms)
            first, second = (clip, neighbor) if intent.operation == "move-forward" else (neighbor, clip)
            first_start, second_start = start, start + first.duration_ms
            first_data = first.model_dump(by_alias=True)
            second_data = second.model_dump(by_alias=True)
            first_data["timelineStartMs"], second_data["timelineStartMs"] = first_start, second_start
            first_slot = next(index for index, item in enumerate(tracks[track_index].clips) if item.id == first.id)
            second_slot = next(index for index, item in enumerate(tracks[track_index].clips) if item.id == second.id)
            tracks[track_index].clips[first_slot] = TimelineClip.model_validate(first_data)
            tracks[track_index].clips[second_slot] = TimelineClip.model_validate(second_data)
            changed.extend([clip.id, neighbor.id])
            moved.extend([clip.id, neighbor.id])
            summary = f"Moved clip {clip.id} {'earlier' if intent.operation == 'move-forward' else 'later'} by swapping adjacent complete clips."
        elif intent.operation in {"shorten", "extend"}:
            delta = intent.amount_ms if intent.operation == "extend" else -(intent.amount_ms or 0)
            new_duration = clip.duration_ms + delta
            if new_duration < 1:
                raise EditReject("EDIT_OPERATION_UNSAFE", "duration edit would make a clip empty", clip.id)
            data = target_clip.model_dump(by_alias=True)
            data["durationMs"] = new_duration
            if clip.source_in_ms is not None and clip.source_out_ms is not None:
                data["sourceOutMs"] = clip.source_in_ms + new_duration
                source_item = next(item for item in source.sources if item.id == clip.source_id)
                if source_item.duration_ms is not None and data["sourceOutMs"] > source_item.duration_ms:
                    raise EditReject("EDIT_OPERATION_UNSAFE", "duration edit exceeds the declared source timecode", clip.id)
            if clip.timeline_start_ms + new_duration > source.duration_ms:
                raise EditReject("EDIT_OPERATION_UNSAFE", "duration edit exceeds the Timeline duration", clip.id)
            tracks[track_index].clips[clip_index] = TimelineClip.model_validate(data)
            changed.append(clip.id)
            summary = f"Changed clip {clip.id} duration by {delta} ms."
        elif intent.operation == "subtitle":
            if target_clip.kind != "subtitle" or target_clip.subtitle is None:
                raise EditReject("EDIT_OPERATION_UNSAFE", "subtitle edits require a subtitle clip", clip.id)
            data = target_clip.model_dump(by_alias=True)
            data["subtitle"]["text"] = intent.text
            tracks[track_index].clips[clip_index] = TimelineClip.model_validate(data)
            changed.append(clip.id)
            summary = f"Updated subtitle text on clip {clip.id}."
        else:
            data = target_clip.model_dump(by_alias=True)
            metadata = dict(data.get("metadata") or {})
            metadata["ctaText"] = intent.text
            data["metadata"] = metadata
            tracks[track_index].clips[clip_index] = TimelineClip.model_validate(data)
            changed.append(clip.id)
            summary = f"Updated CTA text on clip {clip.id}."

        next_data = source.model_dump(by_alias=True)
        next_data["tracks"] = [track.model_dump(by_alias=True) for track in tracks]
        digest = _digest({"timeline": next_data, "intent": intent.model_dump(by_alias=True)})
        next_data["id"] = f"{source.id}:edit-{digest[:12]}"
        result_timeline = validate_timeline_project(next_data)
        diff = TimelineEditDiff(
            changedClipIds=sorted(set(changed)),
            removedClipIds=removed,
            movedClipIds=sorted(set(moved)),
            durationDeltaMs=result_timeline.duration_ms - source.duration_ms,
            summary=summary,
            preservedSourceIds=sorted({item.id for item in source.sources}),
            preservedProvenanceIds=sorted({item.id for item in source.provenance}),
        )
        return TimelineEditResult(
            schemaVersion=1,
            editVersion=C09_EDIT_VERSION,
            policy=C09_POLICY,
            projectId=request.project_id,
            inputKind=input_kind,
            status="applied",
            sourceTimelineId=source.id,
            resultTimeline=result_timeline,
            intent=intent,
            diff=diff,
            rejection=None,
            determinismDigest=digest,
        )

    @staticmethod
    def _fallback_intent(operation: str) -> EditIntent:
        safe_operation = operation if operation in {"delete", "replace", "move-forward", "move-backward", "shorten", "extend", "subtitle", "cta"} else "delete"
        fields: dict[str, Any] = {"schemaVersion": 1, "editVersion": "edit-intent-v1", "policy": C09_POLICY, "operation": safe_operation, "targetText": "unresolved"}
        if safe_operation == "replace": fields["replacementClipId"] = "unresolved-replacement"
        if safe_operation in {"shorten", "extend"}: fields["amountMs"] = 1
        if safe_operation in {"subtitle", "cta"}: fields["text"] = "unresolved"
        return EditIntent(**fields)  # type: ignore[arg-type]

    @staticmethod
    def _rejected(request: TimelineEditParams, source: TimelineProject, input_kind: str, intent: EditIntent, code: str, message: str, target_clip_id: str | None = None) -> TimelineEditResult:
        digest = _digest({"timeline": source.model_dump(by_alias=True), "intent": intent.model_dump(by_alias=True), "rejection": code})
        diff = TimelineEditDiff(changedClipIds=[], removedClipIds=[], movedClipIds=[], durationDeltaMs=0, summary="No timeline change was applied.", preservedSourceIds=sorted(item.id for item in source.sources), preservedProvenanceIds=sorted(item.id for item in source.provenance))
        return TimelineEditResult(schemaVersion=1, editVersion=C09_EDIT_VERSION, policy=C09_POLICY, projectId=request.project_id, inputKind=input_kind, status="rejected", sourceTimelineId=source.id, resultTimeline=source, intent=intent, diff=diff, rejection=TimelineEditRejection(code=code, message=message[:256], targetClipId=target_clip_id), determinismDigest=digest)


class EditParseError(Exception):
    def __init__(self, code: str, operation: str, message: str) -> None:
        self.code, self.operation, self.message = code, operation, message
        super().__init__(message)


class EditReject(Exception):
    def __init__(self, code: str, message: str, target_clip_id: str | None = None) -> None:
        self.code, self.message, self.target_clip_id = code, message, target_clip_id
        super().__init__(message)


def _digest(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _clip_exists(timeline: TimelineProject, value: str) -> bool:
    return any(clip.id == value for track in timeline.tracks for clip in track.clips)


def _parse_target(text: str, operation: str, timeline: TimelineProject) -> str:
    for clip_id in sorted((clip.id for track in timeline.tracks for clip in track.clips), key=len, reverse=True):
        if clip_id in text:
            return clip_id
    ordinal = re.search(r"第\s*(\d+)\s*(?:条|个|段|句|个镜头)?", text)
    if ordinal:
        candidates = sorted((clip for track in timeline.tracks for clip in track.clips if clip.sentence_id or clip.kind in {"video", "audio", "subtitle"}), key=lambda item: (item.timeline_start_ms, item.id))
        index = int(ordinal.group(1)) - 1
        if 0 <= index < len(candidates):
            return candidates[index].id
    if operation == "cta":
        cta = [clip for track in timeline.tracks for clip in track.clips if _is_cta(clip)]
        if len(cta) == 1:
            return cta[0].id
    if operation == "subtitle":
        subtitles = [clip for track in timeline.tracks for clip in track.clips if clip.kind == "subtitle"]
        if len(subtitles) == 1:
            return subtitles[0].id
    if operation == "replace" and "换成" in text:
        before = text.split("换成", 1)[0]
        before = re.sub(r"^(不要|把|请|将|这个|那个)\s*", "", before).strip(" ，,：:")
        if before:
            return before
    quoted = re.findall(r"[“「\"']([^”」\"']+)[”」\"']", text)
    if quoted:
        return quoted[0].strip()
    marker = re.search(r"(?:删除|删掉|去掉|移除|换成|替换成|前移|后移|缩短|加长|延长|字幕|CTA|结尾)[：: ]*(.*)$", text, re.IGNORECASE)
    return (marker.group(1).strip() if marker else text).split("换成", 1)[0].strip()


def _parse_amount_ms(text: str) -> int:
    match = re.search(r"(\d+(?:\.\d+)?)\s*(毫秒|ms|秒|s)", text, re.IGNORECASE)
    if not match:
        return 1_000
    value = float(match.group(1)) * (1_000 if match.group(2).casefold() in {"秒", "s"} else 1)
    return max(1, min(60_000, round(value)))


def _after_keyword(text: str, keywords: tuple[str, ...]) -> str:
    for keyword in keywords:
        if keyword in text:
            return text.split(keyword, 1)[1].strip().strip("。.!！")
    return ""


def _parse_new_text(text: str, operation: str) -> str:
    if operation == "subtitle":
        match = re.search(r"字幕\s*(?:改成|修改为|换成|设为|变成)[：: ]*[“「\"']?(.+?)[”」\"']?$", text)
    else:
        match = re.search(r"(?:CTA|行动号召|结尾)\s*(?:改成|修改为|换成|设为|更直接为)?[：: ]*[“「\"']?(.+?)[”」\"']?$", text, re.IGNORECASE)
    return match.group(1).strip("。.!！”」\"'") if match else ""


def _find_clip_by_phrase(timeline: TimelineProject, phrase: str) -> str | None:
    needle = phrase.strip().casefold()
    candidates = [clip for track in timeline.tracks for clip in track.clips if needle and needle in _searchable_clip_text(clip).casefold()]
    return candidates[0].id if len(candidates) == 1 else None


def _searchable_clip_text(clip: TimelineClip) -> str:
    values = [clip.id, clip.sentence_id or "", clip.subtitle.text if clip.subtitle else ""]
    if clip.metadata:
        values.extend(str(value) for value in clip.metadata.values() if isinstance(value, (str, int, float)))
    return " ".join(values)


def _is_cta(clip: TimelineClip) -> bool:
    metadata = clip.metadata or {}
    role = str(metadata.get("role", metadata.get("section", ""))).casefold()
    return role in {"cta", "call-to-action", "行动号召"} or "cta" in clip.id.casefold()


def _resolve_target(intent: EditIntent, clips: list[tuple[int, int, TimelineClip]]) -> tuple[int, int, TimelineClip] | None:
    if intent.target_clip_id:
        return next((item for item in clips if item[2].id == intent.target_clip_id), None)
    if intent.target_sentence_id:
        matches = [item for item in clips if item[2].sentence_id == intent.target_sentence_id]
    else:
        needle = (intent.target_text or "").casefold()
        matches = [item for item in clips if needle and needle in _searchable_clip_text(item[2]).casefold()]
    return matches[0] if len(matches) == 1 else None
