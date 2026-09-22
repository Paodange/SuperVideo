from __future__ import annotations

import asyncio
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from supervideo_core.media.aroll_cut_join import ArollCutJoinService
from supervideo_core.media.aroll_cut_join_models import ArollCutJoinParams
from supervideo_core.media.aroll_cut_join_models import ArollCutJoinOutput
from supervideo_core.media.errors import MediaError
from supervideo_core.media.preview_render import PreviewRenderService
from supervideo_core.media.preview_render_models import PreviewRenderParams
from supervideo_core.media.preview_render_models import PreviewRenderOutput
from supervideo_core.media.service import MediaService
from supervideo_core.media.subtitle_plan import SubtitlePlanService
from supervideo_core.media.subtitle_plan_models import SubtitlePlanParams


ROOT = Path(__file__).resolve().parents[3]
PROJECT_ID = "99999999-9999-4999-8999-999999999999"


def timeline() -> dict[str, object]:
    value = json.loads((ROOT / "tests" / "fixtures" / "c04_aroll_cut_join_v1.json").read_text(encoding="utf-8"))
    for index, source in enumerate(value["sources"]):  # type: ignore[index]
        source["provenanceIds"] = [f"prov-source-{index}"]  # type: ignore[index]
    value["provenance"] = [
        {"id": f"prov-source-{index}", "kind": "user-supplied", "sourceId": source["id"]}
        for index, source in enumerate(value["sources"])  # type: ignore[index]
    ]
    for clip in value["tracks"][0]["clips"]:  # type: ignore[index]
        clip["metadata"]["subtitleText"] = f"字幕 {clip['id']}。"  # type: ignore[index]
    return value


def plans() -> tuple[object, object]:
    source_timeline = timeline()
    aroll = asyncio.run(ArollCutJoinService().cut_join(
        ArollCutJoinParams(projectId=PROJECT_ID, timeline=source_timeline, mode="video"), asyncio.Event()
    ))
    subtitle = asyncio.run(SubtitlePlanService().plan(
        SubtitlePlanParams(projectId=PROJECT_ID, timeline=source_timeline, trackId="track-video-aroll"), asyncio.Event()
    ))
    return aroll, subtitle


class PreviewRenderTests(unittest.TestCase):
    def test_plan_maps_c05_cues_to_c04_output_timecodes_and_is_repeatable(self) -> None:
        aroll, subtitle = plans()
        request = PreviewRenderParams(projectId=PROJECT_ID, arollPlan=aroll, subtitlePlan=subtitle)
        service = PreviewRenderService()
        first = asyncio.run(service.render(request, asyncio.Event()))
        second = asyncio.run(service.render(request, asyncio.Event()))
        self.assertEqual(first.execution_status, "not-run")
        self.assertIsNone(first.output)
        self.assertEqual(first.status, "ready")
        self.assertEqual([cue.output_start_ms for cue in first.cues], [0, 2_000])
        self.assertEqual(first.cue_count, 2)
        self.assertEqual(first.plan_digest, second.plan_digest)
        self.assertEqual(first.model_dump(by_alias=True), second.model_dump(by_alias=True))
        self.assertEqual([item.source_id for item in first.source_bindings], ["source-aroll-video-a", "source-aroll-video-b"])

    def test_plans_are_bound_to_one_project_and_timeline(self) -> None:
        aroll, subtitle = plans()
        with self.assertRaises(ValidationError):
            PreviewRenderParams(projectId="11111111-1111-4111-8111-111111111111", arollPlan=aroll, subtitlePlan=subtitle)
        changed = copy.deepcopy(subtitle.model_dump(by_alias=True))
        changed["timelineId"] = "another-timeline"
        with self.assertRaises(ValidationError):
            PreviewRenderParams(projectId=PROJECT_ID, arollPlan=aroll, subtitlePlan=changed)

    def test_subtitle_source_cannot_override_the_bound_aroll_source(self) -> None:
        aroll, subtitle = plans()
        changed_cue = subtitle.cues[0].model_copy(update={"source_id": "source-aroll-video-b"})
        changed_subtitle = subtitle.model_copy(update={"cues": [changed_cue, subtitle.cues[1]]})
        request = PreviewRenderParams(projectId=PROJECT_ID, arollPlan=aroll, subtitlePlan=changed_subtitle)
        with self.assertRaises(MediaError) as error:
            asyncio.run(PreviewRenderService().render(request, asyncio.Event()))
        self.assertEqual(error.exception.code, "PREVIEW_RENDER_SUBTITLE_INVALID")

    def test_execution_rechecks_c04_path_and_declared_size(self) -> None:
        aroll, subtitle = plans()
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            with patch.object(MediaService, "_resolve_tool", return_value="ffmpeg"):
                service = PreviewRenderService(ffmpeg_path="ffmpeg")
                service.bind_session(root, object())
                wrong_path = aroll.model_copy(update={
                    "execution_mode": "ffmpeg",
                    "execution_status": "completed",
                    "output": ArollCutJoinOutput(kind="video", relativePath="previews/other/input.mp4", sizeBytes=1),
                })
                with self.assertRaises(MediaError) as wrong_error:
                    asyncio.run(service.render(PreviewRenderParams(projectId=PROJECT_ID, arollPlan=wrong_path, subtitlePlan=subtitle, executionMode="ffmpeg"), asyncio.Event()))
                self.assertEqual(wrong_error.exception.code, "PREVIEW_RENDER_SOURCE_INVALID")

                expected_path = root / "previews" / "aroll-cut-join-v1" / f"{aroll.plan_digest}.video.mp4"
                expected_path.parent.mkdir(parents=True)
                expected_path.write_bytes(b"source")
                stale_size = aroll.model_copy(update={
                    "execution_mode": "ffmpeg",
                    "execution_status": "completed",
                    "output": ArollCutJoinOutput(kind="video", relativePath=f"previews/aroll-cut-join-v1/{aroll.plan_digest}.video.mp4", sizeBytes=999),
                })
                with self.assertRaises(MediaError) as size_error:
                    asyncio.run(service.render(PreviewRenderParams(projectId=PROJECT_ID, arollPlan=stale_size, subtitlePlan=subtitle, executionMode="ffmpeg"), asyncio.Event()))
                self.assertEqual(size_error.exception.code, "PREVIEW_RENDER_SOURCE_INVALID")

    def test_cache_requires_a_matching_manifest_and_fingerprint(self) -> None:
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            service = PreviewRenderService()
            service.bind_session(root, object())
            digest = "d" * 64
            output_path = root / "previews" / "preview-render-v1" / f"{digest}.mp4"
            output_path.parent.mkdir(parents=True)
            output_path.write_bytes(b"preview")
            output = service._output(output_path, PROJECT_ID, digest, 1_000)
            service._write_manifest(output_path.with_name(f"{digest}.manifest.json"), PROJECT_ID, digest, output)
            self.assertIsNotNone(service._read_verified_cache(output_path, PROJECT_ID, digest, 1_000))
            output_path.write_bytes(b"tampered")
            self.assertIsNone(service._read_verified_cache(output_path, PROJECT_ID, digest, 1_000))

    def test_output_model_rejects_non_c06_paths_and_playback_uris(self) -> None:
        base = {
            "kind": "video",
            "relativePath": f"previews/preview-render-v1/{'a' * 64}.mp4",
            "playbackUri": f"supervideo://preview/{PROJECT_ID}/{'a' * 64}",
            "sizeBytes": 1,
            "durationMs": 1,
            "outputFingerprint": "b" * 64,
        }
        PreviewRenderOutput.model_validate(base)
        for key, value in (("relativePath", f"previews/preview-render-v1/{'a' * 64}.mkv"), ("relativePath", f"previews/preview-render-v1/../{'a' * 64}.mp4"), ("playbackUri", f"supervideo://preview/not-a-uuid/{'a' * 64}")):
            invalid = {**base, key: value}
            with self.subTest(key=key, value=value), self.assertRaises(ValidationError):
                PreviewRenderOutput.model_validate(invalid)

    def test_execution_requires_ffmpeg_and_plan_never_fabricates_output(self) -> None:
        aroll, subtitle = plans()
        request = PreviewRenderParams(projectId=PROJECT_ID, arollPlan=aroll, subtitlePlan=subtitle, executionMode="ffmpeg")
        with patch.object(MediaService, "_resolve_tool", return_value=None):
            with self.assertRaises(MediaError) as error:
                asyncio.run(PreviewRenderService(ffmpeg_path=None).render(request, asyncio.Event()))
        self.assertEqual(error.exception.code, "PREVIEW_RENDER_TOOL_UNAVAILABLE")

    def test_cancel_and_ffmpeg_arguments_are_bounded(self) -> None:
        aroll, subtitle = plans()
        cancelled = asyncio.Event()
        cancelled.set()
        request = PreviewRenderParams(projectId=PROJECT_ID, arollPlan=aroll, subtitlePlan=subtitle)
        with self.assertRaises(MediaError) as error:
            asyncio.run(PreviewRenderService().render(request, cancelled))
        self.assertEqual(error.exception.code, "PREVIEW_RENDER_CANCELLED")
        args = PreviewRenderService._ffmpeg_args("C:\\ffmpeg.exe", Path("C:\\input.mp4"), Path("C:\\captions.ass"), Path("C:\\output.mp4"))
        self.assertEqual(args[0], "C:\\ffmpeg.exe")
        self.assertIn("-vf", args)
        self.assertNotIn("powershell", args)
        self.assertIn("1500k", args)


if __name__ == "__main__":
    unittest.main()
