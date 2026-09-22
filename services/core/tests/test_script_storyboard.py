from __future__ import annotations

import asyncio
import hashlib
import unittest

from pydantic import ValidationError

from supervideo_core.media.script_storyboard import ScriptStoryboardPlannerService
from supervideo_core.media.script_storyboard_models import ScriptStoryboardParams
from supervideo_core.media.slot_alignment_models import SlotAlignmentTimecode
from supervideo_core.media.narrative_planner_models import (
    NarrativePlanGap,
    NarrativePlanResult,
    NarrativePlanSegment,
    NarrativePlanSource,
    NarrativePlanTimecode,
    narrative_plan_digest,
)


PROJECT_ID = "11111111-1111-4111-8111-111111111111"
ASSET_ID = "22222222-2222-4222-8222-222222222222"
CACHE_KEY = "a" * 64


def source(index: int) -> NarrativePlanSource:
    start = (index - 1) * 1_000
    end = index * 1_000
    return NarrativePlanSource(
        sourceAssetId=ASSET_ID,
        sourceSentenceCacheKey=CACHE_KEY,
        sentenceIndex=index,
        timecode=NarrativePlanTimecode(startMs=start, endMs=end),
        previewUri=f"supervideo://asset/{ASSET_ID}?kind=audio&startMs={start}&endMs={end}",
    )


def plan() -> NarrativePlanResult:
    texts = ["招工机会就在眼前。", "装配线操作工在江苏昆山上班。", "私信岗位名称，确认报名信息。"]
    roles = ["hook", "body", "cta"]
    segments = [
        NarrativePlanSegment(
            segmentId=f"segment-{index}", order=index, role=role, slotId=f"slot-{index}", slotKind="hook" if role == "hook" else "cta" if role == "cta" else "claim",
            sourceText=text, status="matched", candidateSentenceId=hashlib.sha256(f"sentence-{index}".encode()).hexdigest(), candidateRank=1,
            sentenceText=text, source=source(index), durationMs=1_000, selectionReason="b09-final-score;complete;facts-preserved",
        )
        for index, (role, text) in enumerate(zip(roles, texts, strict=True), start=1)
    ]
    result = NarrativePlanResult(
        schemaVersion=1, planVersion="narrative-remix-plan-v1", inputVersion="deterministic-narrative-input-v1", projectId=PROJECT_ID,
        theme="招聘", audience="求职者", outline="\n".join(texts), targetDurationMs=3_000, toleranceLowerMs=2_400, toleranceUpperMs=3_600,
        selectedDurationMs=3_000, durationStatus="within-tolerance", status="ready", selectionPolicy="b10-first-complete-candidate-v1",
        alignmentVersion="information-slot-alignment-v1", planDigest="0" * 64, segments=segments, gaps=[],
    )
    return result.model_copy(update={"plan_digest": narrative_plan_digest(result)})


def request(**overrides: object) -> ScriptStoryboardParams:
    value = {
        "schemaVersion": 1,
        "contractVersion": "script-storyboard-v1",
        "projectId": PROJECT_ID,
        "brief": {"theme": "招聘", "audience": "求职者", "objective": "说明岗位事实并引导用户确认报名"},
        "facts": [
            {"id": "fact-job", "field": "jobTitle", "value": "装配线操作工", "provenanceIds": ["prov-brief"], "verification": "verified"},
            {"id": "fact-location", "field": "location", "value": "江苏昆山", "provenanceIds": ["prov-brief"], "verification": "needs-user-confirmation"},
        ],
        "forbiddenInferences": ["不得补充未提供的薪资、福利、资格或录用承诺"],
        "target": {"platform": "douyin", "aspectRatio": "9:16", "durationMs": 3_000, "tolerancePercent": 20},
        "visualContext": {"hasUserMaterial": False},
        "provenance": [{"id": "prov-brief", "kind": "user-brief", "label": "用户提供的招聘简报", "verified": True}],
        "factBindings": [{"segmentId": "segment-2", "factIds": ["fact-job", "fact-location"]}],
        "sourcePlan": plan(),
    }
    value.update(overrides)
    return ScriptStoryboardParams.model_validate(value)


class ScriptStoryboardTests(unittest.IsolatedAsyncioTestCase):
    async def test_complete_plan_keeps_c02_sentences_and_binds_facts(self) -> None:
        result = await ScriptStoryboardPlannerService().plan(request(), asyncio.Event())
        self.assertEqual(result.contract_version, "script-storyboard-v1")
        self.assertEqual(result.status, "needs-user-confirmation")
        self.assertEqual(result.script.hook.sentence_id, plan().segments[0].candidate_sentence_id)
        self.assertEqual(result.script.body[0].text, "装配线操作工在江苏昆山上班。")
        self.assertEqual(result.selected_duration_ms, 3_000)
        self.assertEqual([shot.fallback_reason for shot in result.shots], ["no-user-material"] * 3)
        self.assertEqual(result.shots[0].visual_source_priority, ["licensed-stock", "ai-image", "remotion-template", "text-card"])
        self.assertEqual(result.facts[0].status, "bound")
        self.assertEqual(result.facts[1].status, "needs-user-confirmation")

    async def test_rejects_extra_keys_paths_and_unbound_fact_refs(self) -> None:
        with self.assertRaises(ValidationError):
            request(credentialRef="should-never-cross-boundary")
        with self.assertRaises(ValidationError):
            request(brief={"theme": "C:\\private", "audience": "求职者", "objective": "说明岗位"})
        with self.assertRaises(ValidationError):
            request(factBindings=[{"segmentId": "segment-2", "factIds": ["missing-fact"]}])

    async def test_c02_gap_is_preserved_and_gets_programmatic_fallback(self) -> None:
        original = plan()
        gap_segment = original.segments[1].model_copy(update={
            "status": "gap",
            "candidate_sentence_id": None,
            "candidate_rank": None,
            "sentence_text": None,
            "source": None,
            "duration_ms": 0,
            "selection_reason": None,
            "gap_reason": NarrativePlanGap(segmentId="segment-2", slotId="slot-2", role="body", code="alignment-gap", detail="no-retrieval-candidates"),
        })
        gap_plan = original.model_copy(update={
            "segments": [original.segments[0], gap_segment, original.segments[2]],
            "selected_duration_ms": 2_000,
            "duration_status": "outside-tolerance",
            "status": "gaps",
            "gaps": [gap_segment.gap_reason],
        })
        gap_plan = gap_plan.model_copy(update={"plan_digest": narrative_plan_digest(gap_plan)})
        result = await ScriptStoryboardPlannerService().plan(request(sourcePlan=gap_plan, factBindings=[]), asyncio.Event())
        self.assertEqual(result.status, "gaps")
        self.assertEqual(result.script.body[0].status, "gap")
        self.assertEqual(result.script.body[0].duration_ms, 0)
        self.assertEqual(result.shots[1].fallback_reason, "source-gap")

    async def test_cancel_is_stable(self) -> None:
        cancelled = asyncio.Event()
        cancelled.set()
        with self.assertRaises(Exception) as context:
            await ScriptStoryboardPlannerService().plan(request(), cancelled)
        self.assertEqual(context.exception.code, "SCRIPT_STORYBOARD_CANCELLED")


if __name__ == "__main__":
    unittest.main()
