from __future__ import annotations

import asyncio
import hashlib
import unittest

from supervideo_core.media.narrative_planner import NarrativePlannerService
from supervideo_core.media.narrative_planner_models import NarrativePlanParams, narrative_plan_digest
from supervideo_core.media.slot_alignment_models import (
    InformationSlot,
    SlotAlignmentCandidate,
    SlotAlignmentResult,
    SlotAlignmentTimecode,
)


PROJECT_ID = "11111111-1111-4111-8111-111111111111"
ASSET_ID = "22222222-2222-4222-8222-222222222222"
CACHE_KEY = "a" * 64


def candidate(index: int, text: str, start_ms: int, end_ms: int) -> SlotAlignmentCandidate:
    return SlotAlignmentCandidate(
        rank=1,
        origin="b09-quality-rerank",
        sentenceId=hashlib.sha256(f"sentence-{index}".encode()).hexdigest(),
        sourceAssetId=ASSET_ID,
        sourceSentenceCacheKey=CACHE_KEY,
        sentenceIndex=index,
        timecode=SlotAlignmentTimecode(startMs=start_ms, endMs=end_ms),
        text=text,
        score=0.9,
        quality="complete",
        previewUri=f"supervideo://asset/{ASSET_ID}?kind=audio&startMs={start_ms}&endMs={end_ms}",
        selectionReason="b09-final-score;all-key-facts-preserved",
        preservedFacts=[],
    )


def aligned_result(*, with_gap: bool = False) -> SlotAlignmentResult:
    texts = ["开头说明机会。", "主体介绍岗位。", "最后请私信咨询。"]
    slots: list[InformationSlot] = []
    for index, text in enumerate(texts, start=1):
        if with_gap and index == 2:
            slots.append(InformationSlot(
                slotId=f"slot-{index}", order=index, kind="other", sourceText=text, query=text,
                keyFacts=[], status="gap", candidates=[], gapReason="no-retrieval-candidates",
            ))
        else:
            slots.append(InformationSlot(
                slotId=f"slot-{index}", order=index, kind="hook" if index == 1 else "cta" if index == 3 else "claim",
                sourceText=text, query=text, keyFacts=[], status="matched", selectedCandidateRank=1,
                candidates=[candidate(index, text, (index - 1) * 1000, index * 1000)],
                selectionReason="b09-final-score;all-key-facts-preserved",
            ))
    return SlotAlignmentResult(
        schemaVersion=1,
        alignmentVersion="information-slot-alignment-v1",
        splitterVersion="deterministic-slot-split-v1",
        projectId=PROJECT_ID,
        inputKind="outline",
        inputText="\n".join(texts),
        sourceDigest=hashlib.sha256("\n".join(texts).encode()).hexdigest(),
        slotCount=3,
        matchedCount=2 if with_gap else 3,
        slots=slots,
    )


class FakeAlignmentService:
    def __init__(self, result: SlotAlignmentResult) -> None:
        self.result = result
        self.request = None

    def bind_session(self, project_root, database) -> None:
        return None

    async def align(self, request, cancelled: asyncio.Event) -> SlotAlignmentResult:
        self.request = request
        return self.result


class NarrativePlannerTests(unittest.IsolatedAsyncioTestCase):
    async def test_plan_is_versioned_and_uses_complete_candidate_verbatim(self) -> None:
        alignment = FakeAlignmentService(aligned_result())
        planner = NarrativePlannerService(alignment)  # type: ignore[arg-type]
        planner.bind_session(object(), object())
        result = await planner.create_remix(NarrativePlanParams(
            projectId=PROJECT_ID,
            theme="工厂招聘",
            audience="求职者",
            targetDurationMs=3_000,
            outline="开头说明机会。\n主体介绍岗位。\n最后请私信咨询。",
        ), asyncio.Event())

        self.assertEqual(result.plan_version, "narrative-remix-plan-v1")
        self.assertEqual(result.status, "ready")
        self.assertEqual(result.selected_duration_ms, 3_000)
        self.assertNotEqual(result.plan_digest, "0" * 64)
        self.assertEqual(result.plan_digest, narrative_plan_digest(result))
        self.assertEqual([segment.role for segment in result.segments], ["hook", "body", "cta"])
        self.assertEqual([segment.sentence_text for segment in result.segments], ["开头说明机会。", "主体介绍岗位。", "最后请私信咨询。"])
        self.assertEqual(alignment.request.input_text, "开头说明机会。\n主体介绍岗位。\n最后请私信咨询。")

    async def test_candidate_shortage_is_a_stable_gap(self) -> None:
        planner = NarrativePlannerService(FakeAlignmentService(aligned_result(with_gap=True)))  # type: ignore[arg-type]
        planner.bind_session(object(), object())
        result = await planner.create_remix(NarrativePlanParams(
            projectId=PROJECT_ID,
            theme="招聘",
            audience="求职者",
            targetDurationMs=3_000,
            outline="开头说明机会。\n主体介绍岗位。\n最后请私信咨询。",
        ), asyncio.Event())

        self.assertEqual(result.status, "gaps")
        self.assertEqual(result.segments[1].gap_reason.code, "alignment-gap")
        self.assertEqual(result.segments[1].gap_reason.detail, "no-retrieval-candidates")
        self.assertEqual(result.gaps[0].slot_id, "slot-2")


if __name__ == "__main__":
    unittest.main()
