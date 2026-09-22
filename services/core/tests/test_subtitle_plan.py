import asyncio
import copy
import json
import unittest
from pathlib import Path

from supervideo_core.media.errors import MediaError
from supervideo_core.media.subtitle_plan import SubtitlePlanService
from supervideo_core.media.subtitle_plan_models import SubtitlePlanParams


PROJECT_ID = "11111111-1111-4111-8111-111111111111"


class SubtitlePlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixture_path = Path(__file__).parents[3] / "tests" / "fixtures" / "c01_timeline_ir_v1.json"
        cls.timeline = json.loads(fixture_path.read_text(encoding="utf-8"))

    def test_subtitle_track_preserves_order_and_is_deterministic(self) -> None:
        params = SubtitlePlanParams(projectId=PROJECT_ID, timeline=self.timeline)
        service = SubtitlePlanService()
        first = asyncio.run(service.plan(params, asyncio.Event()))
        second = asyncio.run(service.plan(params, asyncio.Event()))
        self.assertEqual(first.status, "ready")
        self.assertEqual(first.cue_count, 1)
        self.assertEqual(first.cues[0].text, "这是一个可编辑的字幕片段。")
        self.assertEqual(first.cues[0].timeline_end_ms, 4_500)
        self.assertEqual(first.plan_digest, second.plan_digest)
        self.assertEqual(first.model_dump(by_alias=True), second.model_dump(by_alias=True))

    def test_sentence_clip_uses_b03_source_and_provenance(self) -> None:
        timeline = copy.deepcopy(self.timeline)
        timeline["tracks"] = [timeline["tracks"][0]]
        timeline["durationMs"] = 4_000
        timeline["tracks"][0]["clips"][0]["durationMs"] = 4_000
        timeline["tracks"][0]["clips"][0]["sourceOutMs"] = 5_000
        timeline["tracks"][0]["clips"][0]["provenanceIds"] = ["prov-camera-a"]
        params = SubtitlePlanParams(
            projectId=PROJECT_ID,
            timeline=timeline,
            trackId="track-video",
            sentenceSources=[{
                "sentenceId": "sentence-0001",
                "sourceId": "source-camera-a",
                "sourceInMs": 1_000,
                "sourceOutMs": 5_000,
                "text": "这是来自 B03 的完整句子。",
                "provenanceIds": ["prov-camera-a"],
            }],
            maxLineWidth=48,
        )
        result = asyncio.run(SubtitlePlanService().plan(params, asyncio.Event()))
        self.assertEqual(result.cues[0].sentence_id, "sentence-0001")
        self.assertEqual((result.cues[0].source_in_ms, result.cues[0].source_out_ms), (1_000, 5_000))
        self.assertEqual(result.cues[0].provenance_ids, ["prov-camera-a"])

    def test_missing_sentence_source_is_explainable_gap(self) -> None:
        timeline = copy.deepcopy(self.timeline)
        timeline["tracks"] = [timeline["tracks"][0]]
        timeline["tracks"][0]["clips"][0].pop("subtitle", None)
        result = asyncio.run(SubtitlePlanService().plan(SubtitlePlanParams(projectId=PROJECT_ID, timeline=timeline), asyncio.Event()))
        self.assertEqual(result.status, "gaps")
        self.assertEqual(result.cue_count, 0)
        self.assertEqual(result.gaps[0].code, "missing-sentence-source")

    def test_overlap_and_layout_bounds_have_stable_codes(self) -> None:
        overlap = copy.deepcopy(self.timeline)
        overlap["tracks"][2]["clips"].append({
            **overlap["tracks"][2]["clips"][0],
            "id": "clip-subtitle-0002",
            "timelineStartMs": 1_000,
            "durationMs": 1_000,
        })
        with self.assertRaises(MediaError) as overlap_error:
            asyncio.run(SubtitlePlanService().plan(SubtitlePlanParams(projectId=PROJECT_ID, timeline=overlap), asyncio.Event()))
        self.assertEqual(overlap_error.exception.code, "SUBTITLE_OVERLAP")

        wide = copy.deepcopy(self.timeline)
        wide["tracks"][2]["clips"][0]["subtitle"]["text"] = "123456789012345678901234567890123"
        with self.assertRaises(MediaError) as width_error:
            asyncio.run(SubtitlePlanService().plan(SubtitlePlanParams(projectId=PROJECT_ID, timeline=wide, maxLineWidth=32), asyncio.Event()))
        self.assertEqual(width_error.exception.code, "SUBTITLE_LINE_WIDTH_INVALID")

    def test_cancel_is_bounded(self) -> None:
        cancelled = asyncio.Event()
        cancelled.set()
        with self.assertRaises(MediaError) as error:
            asyncio.run(SubtitlePlanService().plan(SubtitlePlanParams(projectId=PROJECT_ID, timeline=self.timeline), cancelled))
        self.assertEqual(error.exception.code, "SUBTITLE_CANCELLED")


if __name__ == "__main__":
    unittest.main()
