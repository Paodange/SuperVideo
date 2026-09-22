from __future__ import annotations

import asyncio
import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from supervideo_core.media.aroll_cut_join import ArollCutJoinService
from supervideo_core.media.aroll_cut_join_models import ArollCutJoinParams, ArollCutJoinSegment
from supervideo_core.media.errors import MediaError


ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "tests" / "fixtures" / "c04_aroll_cut_join_v1.json"
PROJECT_ID = "99999999-9999-4999-8999-999999999999"


def fixture_timeline() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def params(mode: str = "video", **overrides: object) -> ArollCutJoinParams:
    value: dict[str, object] = {"projectId": PROJECT_ID, "timeline": fixture_timeline(), "mode": mode}
    value.update(overrides)
    return ArollCutJoinParams.model_validate(value)


class ArollCutJoinTests(unittest.IsolatedAsyncioTestCase):
    async def test_plan_cuts_multiple_complete_sentences_in_stable_order(self) -> None:
        result = await ArollCutJoinService().cut_join(params(), asyncio.Event())
        self.assertEqual(result.execution_mode, "plan")
        self.assertEqual(result.execution_status, "not-run")
        self.assertEqual(result.status, "gaps")
        self.assertEqual([segment.clip_id for segment in result.segments], ["clip-video-1", "clip-video-2"])
        self.assertEqual([segment.output_start_ms for segment in result.segments], [0, 2_000])
        self.assertEqual(result.selected_duration_ms, 3_500)
        self.assertEqual(result.gaps[0].duration_ms, 500)
        self.assertIsNone(result.output)

    async def test_audio_mode_is_supported_and_repeated_plans_are_identical(self) -> None:
        request = params("audio")
        first = await ArollCutJoinService().cut_join(request, asyncio.Event())
        second = await ArollCutJoinService().cut_join(request, asyncio.Event())
        self.assertEqual(first.model_dump(by_alias=True), second.model_dump(by_alias=True))
        self.assertEqual(first.mode, "audio")
        self.assertEqual(first.selected_duration_ms, 2_200)
        self.assertEqual(first.segments[1].source_out_ms - first.segments[1].source_in_ms, first.segments[1].duration_ms)

    async def test_source_role_and_sentence_completeness_are_required(self) -> None:
        timeline = fixture_timeline()
        assert isinstance(timeline["sources"], list)
        timeline["sources"][0]["metadata"] = {"role": "b-roll"}
        with self.assertRaises(MediaError) as context:
            await ArollCutJoinService().cut_join(
                ArollCutJoinParams(projectId=PROJECT_ID, timeline=timeline, mode="video"), asyncio.Event()
            )
        self.assertEqual(context.exception.code, "AROLL_CUT_JOIN_SOURCE_INVALID")

    async def test_invalid_timecode_and_missing_source_reference_are_rejected(self) -> None:
        timeline = fixture_timeline()
        assert isinstance(timeline["tracks"], list)
        timeline["tracks"][0]["clips"][0]["sourceOutMs"] = 2_999
        with self.assertRaises(ValidationError):
            ArollCutJoinParams(projectId=PROJECT_ID, timeline=timeline, mode="video")

        timeline = fixture_timeline()
        timeline["tracks"][0]["clips"][0]["sourceId"] = "source-not-declared"
        with self.assertRaises(ValidationError):
            ArollCutJoinParams(projectId=PROJECT_ID, timeline=timeline, mode="video")

    async def test_cancel_timeout_and_tool_unavailable_have_stable_codes(self) -> None:
        cancelled = asyncio.Event()
        cancelled.set()
        with self.assertRaises(MediaError) as context:
            await ArollCutJoinService().cut_join(params(), cancelled)
        self.assertEqual(context.exception.code, "AROLL_CUT_JOIN_CANCELLED")

        ticks = iter((0.0, 2.0))
        with self.assertRaises(MediaError) as context:
            await ArollCutJoinService(clock=lambda: next(ticks)).cut_join(params(timeoutMs=1_000), asyncio.Event())
        self.assertEqual(context.exception.code, "AROLL_CUT_JOIN_TIMEOUT")

        with self.assertRaises(MediaError) as context:
            await ArollCutJoinService(ffmpeg_path="C:\\missing\\ffmpeg.exe").cut_join(params(executionMode="ffmpeg"), asyncio.Event())
        self.assertEqual(context.exception.code, "AROLL_CUT_JOIN_TOOL_UNAVAILABLE")

    def test_ffmpeg_arguments_are_structured_and_do_not_accept_a_command(self) -> None:
        args = ArollCutJoinService._ffmpeg_args(
            "C:\\Program Files\\ffmpeg\\ffmpeg.exe",
            [(Path("C:\\input.mp4"), (1, 2), "a" * 64)],
            [],
            Path("C:\\project\\previews\\output.mp4"),
            "video",
        )
        self.assertEqual(args[0], "C:\\Program Files\\ffmpeg\\ffmpeg.exe")
        self.assertIn("-filter_complex", args)
        self.assertNotIn("cmd", args)
        self.assertNotIn("powershell", args)
        self.assertIn("concat=n=0:v=1:a=0", args[args.index("-filter_complex") + 1])

        audio_segment = ArollCutJoinSegment.model_validate({
            "order": 1,
            "clipId": "clip-audio-1",
            "sentenceId": "sentence-audio-1",
            "source": {
                "sourceId": "source-aroll-audio",
                "uri": "supervideo://asset/33333333-3333-4333-8333-333333333333",
                "mediaType": "audio",
                "durationMs": 10_000,
                "fingerprint": "b" * 64,
            },
            "sourceInMs": 1_000,
            "sourceOutMs": 3_000,
            "durationMs": 2_000,
            "timelineStartMs": 0,
            "outputStartMs": 0,
            "outputEndMs": 2_000,
        })
        audio_args = ArollCutJoinService._ffmpeg_args(
            "C:\\Program Files\\ffmpeg\\ffmpeg.exe",
            [(Path("C:\\input.m4a"), (1, 2), "b" * 64)],
            [audio_segment],
            Path("C:\\project\\previews\\output.m4a"),
            "audio",
        )
        self.assertIn("concat=n=1:v=0:a=1", audio_args[audio_args.index("-filter_complex") + 1])


if __name__ == "__main__":
    unittest.main()
