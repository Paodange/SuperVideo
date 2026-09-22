"""Deterministic bounded whole-sentence duration optimization for C03."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

from .errors import MediaError
from .narrative_planner_models import NarrativePlanGap
from .duration_optimizer_models import (
    DURATION_OPTIMIZATION_POLICY,
    DURATION_OPTIMIZATION_SCHEMA_VERSION,
    DURATION_OPTIMIZATION_VERSION,
    DurationOptimizationChange,
    DurationOptimizationParams,
    DurationOptimizationResult,
    DurationOptimizationSegment,
    DurationOptimizationSentence,
    validate_duration_optimization_size,
)
from .slot_alignment_models import SlotAlignmentCandidate

MAX_FRONTIER_STATES = 20_000


@dataclass(frozen=True)
class _Choice:
    candidate: SlotAlignmentCandidate | None
    duration_ms: int


@dataclass(frozen=True)
class _State:
    duration_ms: int
    choices: tuple[int, ...]
    change_count: int
    rank_sum: int


class DurationOptimizerService:
    """Optimize only by choosing, replacing, or removing complete B10 sentences."""

    async def optimize(self, request: DurationOptimizationParams, cancelled: asyncio.Event) -> DurationOptimizationResult:
        deadline = time.monotonic() + request.timeout_ms / 1_000
        try:
            if cancelled.is_set():
                raise MediaError("DURATION_OPTIMIZATION_CANCELLED")
            self._validate_input_sources(request)
            await asyncio.sleep(0)
            if cancelled.is_set():
                raise MediaError("DURATION_OPTIMIZATION_CANCELLED")
            choices = await self._build_choices(request, cancelled, deadline)
            selected = self._select_state(request, choices, cancelled, deadline)
            result = self._build_result(request, choices, selected)
            return validate_duration_optimization_size(result)
        except MediaError:
            raise
        except asyncio.CancelledError:
            raise
        except (TypeError, ValueError) as error:
            raise MediaError("DURATION_OPTIMIZATION_OUTPUT_INVALID", cause=error) from error
        except Exception as error:
            raise MediaError("DURATION_OPTIMIZATION_OUTPUT_INVALID", cause=error) from error

    @staticmethod
    def _validate_input_sources(request: DurationOptimizationParams) -> None:
        plan = request.source_plan
        alignment = request.alignment
        if plan.project_id != request.project_id or alignment.project_id != request.project_id:
            raise MediaError("DURATION_OPTIMIZATION_SOURCE_INVALID")
        if plan.alignment_version != alignment.alignment_version:
            raise MediaError("DURATION_OPTIMIZATION_ALIGNMENT_INVALID")
        if len(plan.segments) > 32 or len(alignment.slots) > 32:
            raise MediaError("DURATION_OPTIMIZATION_INPUT_INVALID")
        slot_ids = {slot.slot_id for slot in alignment.slots}
        for segment in plan.segments:
            if segment.status == "matched" and segment.slot_id not in slot_ids:
                raise MediaError("DURATION_OPTIMIZATION_ALIGNMENT_INVALID")

    @classmethod
    async def _build_choices(
        cls,
        request: DurationOptimizationParams,
        cancelled: asyncio.Event,
        deadline: float,
    ) -> list[list[_Choice]]:
        slots = {slot.slot_id: slot for slot in request.alignment.slots}
        seen_sentence_ids: set[str] = set()
        choices: list[list[_Choice]] = []
        for segment in request.source_plan.segments:
            cls._check_budget(cancelled, deadline)
            slot = slots.get(segment.slot_id)
            options: list[_Choice] = [_Choice(None, 0)]
            if slot is not None:
                for candidate in slot.candidates:
                    if candidate.sentence_id in seen_sentence_ids:
                        raise MediaError("DURATION_OPTIMIZATION_ALIGNMENT_INVALID")
                    seen_sentence_ids.add(candidate.sentence_id)
                    options.append(_Choice(candidate, candidate.timecode.end_ms - candidate.timecode.start_ms))
            if segment.status == "matched":
                if slot is None or not any(option.candidate and option.candidate.sentence_id == segment.candidate_sentence_id for option in options):
                    raise MediaError("DURATION_OPTIMIZATION_SOURCE_INVALID")
            choices.append(options)
            await asyncio.sleep(0)
        return choices

    @classmethod
    def _select_state(
        cls,
        request: DurationOptimizationParams,
        choices: list[list[_Choice]],
        cancelled: asyncio.Event,
        deadline: float,
    ) -> _State:
        target = request.source_plan.target_duration_ms
        lower = int(target * 0.8)
        upper = int(target * 1.2)
        max_candidate_duration = max((choice.duration_ms for group in choices for choice in group), default=0)
        frontier: dict[int, _State] = {0: _State(0, (), 0, 0)}
        max_duration = upper + max_candidate_duration
        for segment_index, group in enumerate(choices):
            cls._check_budget(cancelled, deadline)
            next_frontier: dict[int, _State] = {}
            for state in frontier.values():
                for choice_index, choice in enumerate(group):
                    total = state.duration_ms + choice.duration_ms
                    if total > max_duration:
                        continue
                    changes = state.change_count + cls._choice_change(request, segment_index, choice)
                    candidate_rank = choice.candidate.rank if choice.candidate else 0
                    candidate_state = _State(total, state.choices + (choice_index,), changes, state.rank_sum + candidate_rank)
                    previous = next_frontier.get(total)
                    if previous is None or cls._partial_key(candidate_state) < cls._partial_key(previous):
                        next_frontier[total] = candidate_state
            if len(next_frontier) > MAX_FRONTIER_STATES:
                ordered = sorted(next_frontier.values(), key=lambda state: cls._frontier_key(state, target, lower, upper))
                next_frontier = {state.duration_ms: state for state in ordered[:MAX_FRONTIER_STATES]}
            frontier = next_frontier
        if not frontier:
            return _State(0, tuple(0 for _ in choices), len(choices), 0)
        return min(frontier.values(), key=lambda state: cls._frontier_key(state, target, lower, upper))

    @staticmethod
    def _choice_change(request: DurationOptimizationParams, index: int, choice: _Choice) -> int:
        segment = request.source_plan.segments[index]
        before = segment.candidate_sentence_id if segment.status == "matched" else None
        after = choice.candidate.sentence_id if choice.candidate else None
        return int(before != after)

    @staticmethod
    def _partial_key(state: _State) -> tuple[int, int, tuple[int, ...]]:
        return state.change_count, state.rank_sum, state.choices

    @staticmethod
    def _frontier_key(state: _State, target: int, lower: int, upper: int) -> tuple[int, int, int, int, tuple[int, ...]]:
        in_tolerance = lower <= state.duration_ms <= upper
        return (0 if in_tolerance else 1, abs(target - state.duration_ms), state.change_count, state.rank_sum, state.choices)

    @staticmethod
    def _check_budget(cancelled: asyncio.Event, deadline: float) -> None:
        if cancelled.is_set():
            raise MediaError("DURATION_OPTIMIZATION_CANCELLED")
        if time.monotonic() >= deadline:
            raise MediaError("DURATION_OPTIMIZATION_TIMEOUT")

    @classmethod
    def _build_result(
        cls,
        request: DurationOptimizationParams,
        choices: list[list[_Choice]],
        state: _State,
    ) -> DurationOptimizationResult:
        plan = request.source_plan
        selected_segments: list[DurationOptimizationSegment] = []
        changes: list[DurationOptimizationChange] = []
        source_gaps: list[NarrativePlanGap] = []
        selected_duration = 0
        for index, segment in enumerate(plan.segments):
            choice_index = state.choices[index] if index < len(state.choices) else 0
            choice = choices[index][choice_index] if choice_index < len(choices[index]) else _Choice(None, 0)
            before = cls._sentence_from_segment(segment)
            after = cls._sentence_from_candidate(choice.candidate)
            operation = cls._operation(before, after)
            if after is not None:
                selected_duration += after.duration_ms
                selected_segments.append(DurationOptimizationSegment(
                    segmentId=segment.segment_id,
                    order=len(selected_segments) + 1,
                    role=segment.role,
                    slotId=segment.slot_id,
                    slotKind=segment.slot_kind,
                    sourceText=segment.source_text,
                    status="matched",
                    operation=operation if operation != "remove" else "replace",
                    candidateSentenceId=after.sentence_id,
                    candidateRank=after.candidate_rank,
                    sentenceText=after.sentence_text,
                    source=after.source,
                    durationMs=after.duration_ms,
                    selectionReason=cls._reason(plan, segment, after, operation),
                    gapReason=None,
                ))
            elif segment.status == "gap":
                gap = segment.gap_reason
                if gap is not None:
                    source_gaps.append(gap)
                    selected_segments.append(DurationOptimizationSegment(
                        segmentId=segment.segment_id,
                        order=len(selected_segments) + 1,
                        role=segment.role,
                        slotId=segment.slot_id,
                        slotKind=segment.slot_kind,
                        sourceText=segment.source_text,
                        status="gap",
                        operation="keep",
                        candidateSentenceId=None,
                        candidateRank=None,
                        sentenceText=None,
                        source=None,
                        durationMs=0,
                        selectionReason=None,
                        gapReason=gap,
                    ))
            if before is not None or after is not None:
                changes.append(DurationOptimizationChange(
                    segmentId=segment.segment_id,
                    slotId=segment.slot_id,
                    role=segment.role,
                    operation=operation,
                    before=before,
                    after=after,
                    selectionReason=cls._reason(plan, segment, after, operation),
                ))
        lower = int(plan.target_duration_ms * 0.8)
        upper = int(plan.target_duration_ms * 1.2)
        duration_status = "within-tolerance" if lower <= selected_duration <= upper else "outside-tolerance"
        gaps = list(source_gaps)
        if duration_status == "outside-tolerance":
            gaps.append(NarrativePlanGap(
                segmentId="duration-optimization",
                slotId="duration",
                role="body",
                code="duration-outside-tolerance",
                detail=f"whole-sentence result {selected_duration}ms is outside {lower}-{upper}ms",
            ))
        changed = any(change.operation != "keep" for change in changes)
        status = "gaps" if gaps else "optimized" if changed else "unchanged" if duration_status == "within-tolerance" else "needs-duration-optimization"
        return DurationOptimizationResult(
            schemaVersion=DURATION_OPTIMIZATION_SCHEMA_VERSION,
            optimizationVersion=DURATION_OPTIMIZATION_VERSION,
            projectId=request.project_id,
            sourcePlanDigest=plan.plan_digest,
            targetDurationMs=plan.target_duration_ms,
            toleranceLowerMs=lower,
            toleranceUpperMs=upper,
            selectedDurationMs=selected_duration,
            durationStatus=duration_status,
            status=status,
            selectionPolicy=DURATION_OPTIMIZATION_POLICY,
            segments=selected_segments,
            changes=changes,
            gaps=gaps,
        )

    @staticmethod
    def _sentence_from_segment(segment: Any) -> DurationOptimizationSentence | None:
        if segment.status != "matched":
            return None
        return DurationOptimizationSentence(
            sentenceId=segment.candidate_sentence_id,
            sentenceText=segment.sentence_text,
            source=segment.source,
            durationMs=segment.duration_ms,
            candidateRank=segment.candidate_rank,
        )

    @staticmethod
    def _sentence_from_candidate(candidate: SlotAlignmentCandidate | None) -> DurationOptimizationSentence | None:
        if candidate is None:
            return None
        return DurationOptimizationSentence(
            sentenceId=candidate.sentence_id,
            sentenceText=candidate.text,
            source={
                "sourceAssetId": candidate.source_asset_id,
                "sourceSentenceCacheKey": candidate.source_sentence_cache_key,
                "sentenceIndex": candidate.sentence_index,
                "timecode": {"startMs": candidate.timecode.start_ms, "endMs": candidate.timecode.end_ms},
                "previewUri": candidate.preview_uri,
            },
            durationMs=candidate.timecode.end_ms - candidate.timecode.start_ms,
            candidateRank=candidate.rank,
        )

    @staticmethod
    def _operation(before: DurationOptimizationSentence | None, after: DurationOptimizationSentence | None) -> str:
        if before is None and after is not None:
            return "add"
        if before is not None and after is None:
            return "remove"
        if before is not None and after is not None and before.sentence_id != after.sentence_id:
            return "replace"
        return "keep"

    @staticmethod
    def _reason(plan: Any, segment: Any, after: DurationOptimizationSentence | None, operation: str) -> str:
        target = plan.target_duration_ms
        rank = after.candidate_rank if after is not None else 0
        return f"{DURATION_OPTIMIZATION_POLICY};target-{target}ms;{operation};rank-{rank};complete"
