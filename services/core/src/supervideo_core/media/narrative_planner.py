"""C02 deterministic hook-body-CTA planning over B10 aligned candidates."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from pydantic import ValidationError

from .errors import MediaError
from .slot_alignment import InformationSlotAlignmentService
from .slot_alignment_models import SlotAlignmentParams, SlotAlignmentResult
from .narrative_planner_models import (
    NARRATIVE_PLAN_INPUT_VERSION,
    NARRATIVE_PLAN_SCHEMA_VERSION,
    NARRATIVE_PLAN_VERSION,
    NarrativePlanGap,
    NarrativePlanParams,
    NarrativePlanResult,
    NarrativePlanSegment,
    NarrativePlanSource,
    NarrativePlanTimecode,
    narrative_plan_digest,
    validate_narrative_plan_size,
)


class NarrativePlannerService:
    """Build a reproducible plan without changing sentence text or optimizing duration."""

    def __init__(self, alignment_service: InformationSlotAlignmentService | None = None) -> None:
        self.alignment_service = alignment_service or InformationSlotAlignmentService()
        self._project_root: Any | None = None
        self._database: Any | None = None

    def bind_session(self, project_root: Any, database: Any) -> None:
        self._project_root = project_root
        self._database = database
        self.alignment_service.bind_session(project_root, database)

    async def create_remix(self, request: NarrativePlanParams, cancelled: asyncio.Event) -> NarrativePlanResult:
        if self._project_root is None or self._database is None:
            from supervideo_core.project.errors import ProjectError

            raise ProjectError("PROJECT_NOT_ACTIVE")
        if cancelled.is_set():
            raise MediaError("PLAN_CANCELLED")
        deadline = time.monotonic() + request.timeout_ms / 1_000
        try:
            alignment_input = request.outline or self._default_alignment_input(request)
            alignment_request = SlotAlignmentParams(
                projectId=request.project_id,
                inputKind="outline" if request.outline else "copy",
                inputText=alignment_input,
                assetIds=request.asset_ids,
                candidateLimit=request.candidate_limit,
                useRerank=request.use_rerank,
                timeoutMs=self._remaining_timeout(deadline),
            )
            alignment = await self._await_with_cancel(self.alignment_service.align(alignment_request, cancelled), cancelled, deadline)
            self._validate_alignment(alignment, request)
            segments = self._build_segments(alignment)
            gaps = [segment.gap_reason for segment in segments if segment.gap_reason is not None]
            selected_duration_ms = sum(segment.duration_ms for segment in segments)
            lower = int(request.target_duration_ms * 0.8)
            upper = int(request.target_duration_ms * 1.2)
            duration_status = "within-tolerance" if lower <= selected_duration_ms <= upper else "outside-tolerance"
            status = "gaps" if any(segment.status == "gap" for segment in segments) else "ready" if duration_status == "within-tolerance" else "needs-duration-optimization"
            result = NarrativePlanResult(
                schemaVersion=NARRATIVE_PLAN_SCHEMA_VERSION,
                planVersion=NARRATIVE_PLAN_VERSION,
                inputVersion=NARRATIVE_PLAN_INPUT_VERSION,
                projectId=request.project_id,
                theme=request.theme,
                audience=request.audience,
                outline=request.outline,
                targetDurationMs=request.target_duration_ms,
                toleranceLowerMs=lower,
                toleranceUpperMs=upper,
                selectedDurationMs=selected_duration_ms,
                durationStatus=duration_status,
                status=status,
                selectionPolicy="b10-first-complete-candidate-v1",
                alignmentVersion="information-slot-alignment-v1",
                planDigest="0" * 64,
                segments=segments,
                gaps=gaps,
            )
            result = result.model_copy(update={"plan_digest": narrative_plan_digest(result)})
            return validate_narrative_plan_size(result)
        except MediaError as error:
            self._raise_plan_error(error)
            raise AssertionError("unreachable")
        except asyncio.CancelledError:
            raise
        except (ValidationError, TypeError, ValueError) as error:
            raise MediaError("PLAN_OUTPUT_INVALID", cause=error) from error
        except Exception as error:
            raise MediaError("PLAN_OUTPUT_INVALID", cause=error) from error

    @staticmethod
    def _default_alignment_input(request: NarrativePlanParams) -> str:
        return f"开头：{request.theme}\n主体：{request.theme}，面向{request.audience}\n行动号召：围绕这个主题请联系咨询。"

    @staticmethod
    def _validate_alignment(result: SlotAlignmentResult, request: NarrativePlanParams) -> None:
        if result.project_id != request.project_id or result.alignment_version != "information-slot-alignment-v1":
            raise MediaError("PLAN_ALIGNMENT_INVALID")
        allowed = set(request.asset_ids or [])
        if allowed:
            for slot in result.slots:
                for candidate in slot.candidates:
                    if candidate.source_asset_id not in allowed:
                        raise MediaError("PLAN_SOURCE_INVALID")

    @staticmethod
    def _build_segments(alignment: SlotAlignmentResult) -> list[NarrativePlanSegment]:
        slots = list(alignment.slots)
        if not slots:
            raise MediaError("PLAN_ALIGNMENT_INVALID")
        if len(slots) == 1:
            role_slots: list[tuple[Any, str]] = [(slots[0], "hook"), (None, "body"), (None, "cta")]
        elif len(slots) == 2:
            role_slots = [(slots[0], "hook"), (None, "body"), (slots[1], "cta")]
        else:
            role_slots = [(slot, "hook" if index == 0 else "cta" if index == len(slots) - 1 else "body") for index, slot in enumerate(slots)]
        segments: list[NarrativePlanSegment] = []
        for order, (slot, role) in enumerate(role_slots, start=1):
            if slot is None:
                gap = NarrativePlanGap(
                    segmentId=f"segment-{order}",
                    slotId=f"missing-{role}",
                    role=role,
                    code="missing-narrative-role",
                    detail=f"no B10 slot was available for the {role} segment",
                )
                segments.append(NarrativePlanSegment(
                    segmentId=f"segment-{order}", order=order, role=role, slotId=f"missing-{role}",
                    slotKind="other", sourceText=f"{role} segment was not supplied", status="gap", durationMs=0,
                    gapReason=gap,
                ))
                continue
            if slot.status == "gap":
                gap = NarrativePlanGap(
                    segmentId=f"segment-{order}",
                    slotId=slot.slot_id,
                    role=role,
                    code="alignment-gap",
                    detail=slot.gap_reason or "b10-alignment-gap",
                )
                segments.append(NarrativePlanSegment(
                    segmentId=f"segment-{order}", order=order, role=role, slotId=slot.slot_id,
                    slotKind=slot.kind, sourceText=slot.source_text, status="gap", durationMs=0,
                    gapReason=gap,
                ))
                continue
            candidate = slot.candidates[0]
            duration_ms = candidate.timecode.end_ms - candidate.timecode.start_ms
            segments.append(NarrativePlanSegment(
                segmentId=f"segment-{order}", order=order, role=role, slotId=slot.slot_id,
                slotKind=slot.kind, sourceText=slot.source_text, status="matched",
                candidateSentenceId=candidate.sentence_id, candidateRank=candidate.rank,
                sentenceText=candidate.text,
                source=NarrativePlanSource(
                    sourceAssetId=candidate.source_asset_id,
                    sourceSentenceCacheKey=candidate.source_sentence_cache_key,
                    sentenceIndex=candidate.sentence_index,
                    timecode=NarrativePlanTimecode(startMs=candidate.timecode.start_ms, endMs=candidate.timecode.end_ms),
                    previewUri=candidate.preview_uri,
                ),
                durationMs=duration_ms,
                selectionReason=f"{candidate.origin};rank-{candidate.rank};complete;facts-preserved",
            ))
        return segments

    @staticmethod
    def _raise_plan_error(error: MediaError) -> None:
        if error.code.startswith("PLAN_"):
            raise error
        if error.code == "SLOT_CANCELLED":
            raise MediaError("PLAN_CANCELLED", cause=error)
        if error.code == "SLOT_TIMEOUT":
            raise MediaError("PLAN_TIMEOUT", cause=error)
        if error.code == "SLOT_SOURCE_STALE":
            raise MediaError("PLAN_SOURCE_STALE", cause=error)
        if error.code == "SLOT_SOURCE_INVALID":
            raise MediaError("PLAN_SOURCE_INVALID", cause=error)
        if error.code == "SLOT_INPUT_INVALID":
            raise MediaError("PLAN_INPUT_INVALID", cause=error)
        raise MediaError("PLAN_ALIGNMENT_INVALID", cause=error)

    @staticmethod
    def _remaining_timeout(deadline: float) -> int:
        remaining_ms = int((deadline - time.monotonic()) * 1_000)
        if remaining_ms < 1_000:
            raise MediaError("PLAN_TIMEOUT")
        return min(120_000, remaining_ms)

    @staticmethod
    async def _await_with_cancel(operation: Any, cancelled: asyncio.Event, deadline: float) -> Any:
        task = asyncio.create_task(operation)
        cancel_task = asyncio.create_task(cancelled.wait())
        try:
            remaining = max(0.001, deadline - time.monotonic())
            done, _ = await asyncio.wait({task, cancel_task}, timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
            if cancel_task in done and cancelled.is_set():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("PLAN_CANCELLED")
            if task not in done:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise MediaError("PLAN_TIMEOUT")
            return await task
        finally:
            cancel_task.cancel()
            await asyncio.gather(cancel_task, return_exceptions=True)
