from __future__ import annotations

import asyncio
import hashlib
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from supervideo_core.media.duration_optimizer import DurationOptimizerService
from supervideo_core.media.duration_optimizer_models import DurationOptimizationParams
from supervideo_core.media.errors import MediaError
from supervideo_core.media.narrative_planner_models import (
    NarrativePlanResult,
    NarrativePlanSegment,
    NarrativePlanSource,
    NarrativePlanTimecode,
    narrative_plan_digest,
)
from supervideo_core.media.slot_alignment_models import (
    InformationSlot,
    SlotAlignmentCandidate,
    SlotAlignmentResult,
    SlotAlignmentTimecode,
)


PROJECT_ID = "11111111-1111-4111-8111-111111111111"
ASSET_ID = "22222222-2222-4222-8222-222222222222"
CACHE_KEY = "a" * 64


def make_candidate(slot: int, rank: int, start: int, end: int, text: str | None = None, sentence_id: str | None = None) -> SlotAlignmentCandidate:
    identity = sentence_id or hashlib.sha256(f"slot-{slot}-rank-{rank}".encode()).hexdigest()
    return SlotAlignmentCandidate(
        rank=rank,
        origin="b09-quality-rerank" if rank == 1 else "b08-retrieval",
        sentenceId=identity,
        sourceAssetId=ASSET_ID,
        sourceSentenceCacheKey=CACHE_KEY,
        sentenceIndex=slot * 10 + rank,
        timecode=SlotAlignmentTimecode(startMs=start, endMs=end),
        text=text or f"第{slot}句候选{rank}。",
        score=1 - rank / 10,
        quality="complete",
        previewUri=f"supervideo://asset/{ASSET_ID}?kind=audio&startMs={start}&endMs={end}",
        selectionReason="deterministic-test-candidate",
        preservedFacts=[],
    )


def make_alignment(candidates_by_slot: list[list[SlotAlignmentCandidate]]) -> SlotAlignmentResult:
    slots: list[InformationSlot] = []
    for index, candidates in enumerate(candidates_by_slot, start=1):
        slots.append(InformationSlot(
            slotId=f"slot-{index}", order=index, kind="hook" if index == 1 else "cta" if index == len(candidates_by_slot) else "claim",
            sourceText=f"第{index}句。", query=f"第{index}句。", keyFacts=[], status="matched",
            selectedCandidateRank=1, candidates=candidates, selectionReason="deterministic-test-slot", gapReason=None,
        ))
    input_text = "\n".join(slot.source_text for slot in slots)
    return SlotAlignmentResult(
        schemaVersion=1, alignmentVersion="information-slot-alignment-v1", splitterVersion="deterministic-slot-split-v1",
        projectId=PROJECT_ID, inputKind="outline", inputText=input_text,
        sourceDigest=hashlib.sha256(input_text.encode()).hexdigest(), slotCount=len(slots), matchedCount=len(slots), slots=slots,
    )


def make_plan(alignment: SlotAlignmentResult, target: int, *, gap_slot: int | None = None) -> NarrativePlanResult:
    segments: list[NarrativePlanSegment] = []
    for index, slot in enumerate(alignment.slots, start=1):
        if gap_slot == index:
            segments.append(NarrativePlanSegment(
                segmentId=f"segment-{index}", order=index, role="hook" if index == 1 else "cta" if index == len(alignment.slots) else "body",
                slotId=slot.slot_id, slotKind=slot.kind, sourceText=slot.source_text, status="gap", durationMs=0,
                gapReason={"segmentId": f"segment-{index}", "slotId": slot.slot_id, "role": "body", "code": "alignment-gap", "detail": "candidate unavailable"},
            ))
            continue
        candidate = slot.candidates[0]
        segments.append(NarrativePlanSegment(
            segmentId=f"segment-{index}", order=index, role="hook" if index == 1 else "cta" if index == len(alignment.slots) else "body",
            slotId=slot.slot_id, slotKind=slot.kind, sourceText=slot.source_text, status="matched",
            candidateSentenceId=candidate.sentence_id, candidateRank=1, sentenceText=candidate.text,
            source=NarrativePlanSource(
                sourceAssetId=candidate.source_asset_id, sourceSentenceCacheKey=candidate.source_sentence_cache_key,
                sentenceIndex=candidate.sentence_index,
                timecode=NarrativePlanTimecode(startMs=candidate.timecode.start_ms, endMs=candidate.timecode.end_ms),
                previewUri=candidate.preview_uri,
            ), durationMs=candidate.timecode.end_ms - candidate.timecode.start_ms,
            selectionReason="b10-first-complete-candidate-v1;complete;facts-preserved",
        ))
    result = NarrativePlanResult(
        schemaVersion=1, planVersion="narrative-remix-plan-v1", inputVersion="deterministic-narrative-input-v1",
        projectId=PROJECT_ID, theme="招聘", audience="求职者", outline="第1句。\n第2句。\n第3句。",
        targetDurationMs=target, toleranceLowerMs=int(target * .8), toleranceUpperMs=int(target * 1.2),
        selectedDurationMs=sum(segment.duration_ms for segment in segments),
        durationStatus="within-tolerance" if int(target * .8) <= sum(segment.duration_ms for segment in segments) <= int(target * 1.2) else "outside-tolerance",
        status="gaps" if gap_slot else "ready" if int(target * .8) <= sum(segment.duration_ms for segment in segments) <= int(target * 1.2) else "needs-duration-optimization",
        selectionPolicy="b10-first-complete-candidate-v1", alignmentVersion="information-slot-alignment-v1", planDigest="0" * 64,
        segments=segments, gaps=[segment.gap_reason for segment in segments if segment.gap_reason is not None],
    )
    return result.model_copy(update={"plan_digest": narrative_plan_digest(result)})


class DurationOptimizerTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_hit_keeps_complete_sentences_and_provenance(self) -> None:
        alignment = make_alignment([[make_candidate(1, 1, 0, 1000)], [make_candidate(2, 1, 1000, 2000)], [make_candidate(3, 1, 2000, 3000)]])
        plan = make_plan(alignment, 3000)
        result = await DurationOptimizerService().optimize(DurationOptimizationParams(projectId=PROJECT_ID, sourcePlan=plan, alignment=alignment), asyncio.Event())
        self.assertEqual(result.status, "unchanged")
        self.assertEqual(result.selected_duration_ms, 3000)
        self.assertEqual([change.operation for change in result.changes], ["keep", "keep", "keep"])
        self.assertEqual(result.segments[0].sentence_text, alignment.slots[0].candidates[0].text)
        self.assertEqual(result.segments[0].source.timecode.start_ms, 0)

    async def test_replacement_enters_tolerance_without_cutting(self) -> None:
        alignment = make_alignment([
            [make_candidate(1, 1, 0, 1000), make_candidate(1, 2, 0, 2500)],
            [make_candidate(2, 1, 1000, 2000)],
            [make_candidate(3, 1, 2000, 3000)],
        ])
        plan = make_plan(alignment, 4500)
        result = await DurationOptimizerService().optimize(DurationOptimizationParams(projectId=PROJECT_ID, sourcePlan=plan, alignment=alignment), asyncio.Event())
        self.assertEqual(result.status, "optimized")
        self.assertEqual(result.selected_duration_ms, 4500)
        self.assertEqual(result.changes[0].operation, "replace")
        self.assertEqual(result.changes[0].after.candidate_rank, 2)

    async def test_removal_enters_tolerance_and_shortage_is_structured(self) -> None:
        alignment = make_alignment([[make_candidate(1, 1, 0, 1000)], [make_candidate(2, 1, 1000, 2000)], [make_candidate(3, 1, 2000, 3000)]])
        plan = make_plan(alignment, 2200)
        result = await DurationOptimizerService().optimize(DurationOptimizationParams(projectId=PROJECT_ID, sourcePlan=plan, alignment=alignment), asyncio.Event())
        self.assertEqual(result.status, "optimized")
        self.assertEqual(result.selected_duration_ms, 2000)
        self.assertEqual([change.operation for change in result.changes], ["remove", "keep", "keep"])

        shortage = await DurationOptimizerService().optimize(DurationOptimizationParams(projectId=PROJECT_ID, sourcePlan=make_plan(alignment, 10_000), alignment=alignment), asyncio.Event())
        self.assertEqual(shortage.status, "gaps")
        self.assertEqual(shortage.gaps[-1].code, "duration-outside-tolerance")

    async def test_add_replaces_a_source_gap(self) -> None:
        gap_alignment = make_alignment([[make_candidate(1, 1, 0, 1000)], [make_candidate(2, 1, 1000, 2000)], [make_candidate(3, 1, 2000, 3000)]])
        plan = make_plan(gap_alignment, 3000, gap_slot=2)
        result = await DurationOptimizerService().optimize(DurationOptimizationParams(projectId=PROJECT_ID, sourcePlan=plan, alignment=gap_alignment), asyncio.Event())
        self.assertEqual(result.status, "optimized")
        self.assertEqual(result.changes[1].operation, "add")
        self.assertEqual(result.segments[1].operation, "add")

    async def test_duplicate_candidate_id_and_invalid_timecode_are_rejected(self) -> None:
        duplicate = hashlib.sha256(b"duplicate").hexdigest()
        alignment = make_alignment([[make_candidate(1, 1, 0, 1000, sentence_id=duplicate)], [make_candidate(2, 1, 1000, 2000, sentence_id=duplicate)]])
        plan = make_plan(alignment, 2000)
        with self.assertRaises(MediaError) as context:
            await DurationOptimizerService().optimize(DurationOptimizationParams(projectId=PROJECT_ID, sourcePlan=plan, alignment=alignment), asyncio.Event())
        self.assertEqual(context.exception.code, "DURATION_OPTIMIZATION_ALIGNMENT_INVALID")
        with self.assertRaises(ValidationError):
            make_candidate(1, 1, 1000, 1000)

    async def test_cancel_and_timeout_are_stable(self) -> None:
        alignment = make_alignment([[make_candidate(1, 1, 0, 1000)]])
        plan = make_plan(alignment, 1000)
        cancelled = asyncio.Event()
        cancelled.set()
        with self.assertRaisesRegex(MediaError, "cancelled") as context:
            await DurationOptimizerService().optimize(DurationOptimizationParams(projectId=PROJECT_ID, sourcePlan=plan, alignment=alignment), cancelled)
        self.assertEqual(context.exception.code, "DURATION_OPTIMIZATION_CANCELLED")
        with patch.object(DurationOptimizerService, "_check_budget", side_effect=MediaError("DURATION_OPTIMIZATION_TIMEOUT")):
            with self.assertRaisesRegex(MediaError, "timed out") as context:
                await DurationOptimizerService().optimize(DurationOptimizationParams(projectId=PROJECT_ID, sourcePlan=plan, alignment=alignment), asyncio.Event())
        self.assertEqual(context.exception.code, "DURATION_OPTIMIZATION_TIMEOUT")


if __name__ == "__main__":
    unittest.main()
