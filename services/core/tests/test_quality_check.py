from __future__ import annotations

import asyncio
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from supervideo_core.media.aroll_cut_join import ArollCutJoinService
from supervideo_core.media.aroll_cut_join_models import ArollCutJoinParams
from supervideo_core.media.preview_render import PreviewRenderService
from supervideo_core.media.preview_render_models import PreviewRenderGap, PreviewRenderOutput, PreviewRenderParams, PreviewRenderResult
from supervideo_core.media.quality_check import PreviewQualityCheckService
from supervideo_core.media.quality_check_models import PreviewQualityCheckParams
from supervideo_core.media.subtitle_plan import SubtitlePlanService
from supervideo_core.media.subtitle_plan_models import SubtitlePlanGap, SubtitlePlanParams

ROOT = Path(__file__).resolve().parents[3]
PROJECT_ID = "99999999-9999-4999-8999-999999999999"


def plans():
    timeline = json.loads((ROOT / "tests" / "fixtures" / "c04_aroll_cut_join_v1.json").read_text(encoding="utf-8"))
    for index, source in enumerate(timeline["sources"]):
        source["provenanceIds"] = [f"prov-source-{index}"]
    timeline["provenance"] = [
        {"id": f"prov-source-{index}", "kind": "user-supplied", "sourceId": source["id"]}
        for index, source in enumerate(timeline["sources"])
    ]
    for clip in timeline["tracks"][0]["clips"]:
        clip["metadata"]["subtitleText"] = f"字幕 {clip['id']}。"
    aroll = asyncio.run(ArollCutJoinService().cut_join(ArollCutJoinParams(projectId=PROJECT_ID, timeline=timeline, mode="video"), asyncio.Event()))
    subtitle = asyncio.run(SubtitlePlanService().plan(SubtitlePlanParams(projectId=PROJECT_ID, timeline=timeline, trackId="track-video-aroll"), asyncio.Event()))
    return aroll, subtitle


class PreviewQualityCheckTests(unittest.TestCase):
    def test_plan_is_explicitly_unverified_and_not_export_ready(self) -> None:
        aroll, subtitle = plans()
        preview = asyncio.run(PreviewRenderService().render(PreviewRenderParams(projectId=PROJECT_ID, arollPlan=aroll, subtitlePlan=subtitle), asyncio.Event()))
        with patch.object(__import__("supervideo_core.media.quality_check", fromlist=["MediaService"]).MediaService, "_resolve_tool", return_value=None):
            service = PreviewQualityCheckService()
        result = asyncio.run(service.check(PreviewQualityCheckParams(projectId=PROJECT_ID, previewResult=preview), asyncio.Event()))
        self.assertEqual(result.phase, "plan")
        self.assertEqual(result.status, "warning")
        self.assertFalse(result.execution_verified)
        self.assertFalse(result.ready_for_export)
        self.assertEqual(result.issues[-1].code, "QA_EXECUTION_NOT_RUN")
        self.assertEqual(result.issues[-1].status, "not-run")

    def test_gaps_are_a_failure_even_when_execution_did_not_run(self) -> None:
        aroll, subtitle = plans()
        gap = SubtitlePlanGap(code="missing-subtitle-text", clipId="clip-video-2", sentenceId=None, detail="No subtitle text was available.")
        subtitle = subtitle.model_copy(update={"status": "gaps", "cues": [subtitle.cues[0]], "cue_count": 1, "total_duration_ms": 2_000, "gaps": [gap]})
        preview = asyncio.run(PreviewRenderService().render(PreviewRenderParams(projectId=PROJECT_ID, arollPlan=aroll, subtitlePlan=subtitle), asyncio.Event()))
        result = asyncio.run(PreviewQualityCheckService(ffprobe_path=None).check(PreviewQualityCheckParams(projectId=PROJECT_ID, previewResult=preview), asyncio.Event()))
        self.assertEqual(result.status, "fail")
        self.assertFalse(result.ready_for_export)
        self.assertIn("QA_PLAN_GAP", [issue.code for issue in result.issues])

    def test_digest_detects_source_cue_and_gap_tampering(self) -> None:
        aroll, subtitle = plans()
        base = asyncio.run(PreviewRenderService().render(PreviewRenderParams(projectId=PROJECT_ID, arollPlan=aroll, subtitlePlan=subtitle), asyncio.Event()))
        changed_cue = {**base.model_dump(by_alias=True), "cues": [
            {**base.cues[0].model_dump(by_alias=True), "sourceId": base.source_bindings[1].source_id},
            base.cues[1].model_dump(by_alias=True),
        ]}
        changed_gaps = {**base.model_dump(by_alias=True), "status": "gaps", "gaps": [
            PreviewRenderGap(code="subtitle-plan-gap", clipId="clip-video-1", cueId=None, detail="tampered").model_dump(by_alias=True),
        ]}
        for payload in (changed_cue, changed_gaps):
            with self.subTest(payload=payload):
                tampered = PreviewRenderResult.model_validate(payload)
                result = asyncio.run(PreviewQualityCheckService(ffprobe_path="C:\\missing\\ffprobe.exe").check(PreviewQualityCheckParams(projectId=PROJECT_ID, previewResult=tampered), asyncio.Event()))
                self.assertEqual(result.status, "fail")
                self.assertIn("QA_PLAN_DIGEST_MISMATCH", [issue.code for issue in result.issues])

    def test_executed_output_checks_manifest_size_and_fingerprint(self) -> None:
        aroll, subtitle = plans()
        base = asyncio.run(PreviewRenderService().render(PreviewRenderParams(projectId=PROJECT_ID, arollPlan=aroll, subtitlePlan=subtitle), asyncio.Event()))
        payload = b"deterministic preview bytes"
        digest = base.plan_digest
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            output_path = root / "previews" / "preview-render-v1" / f"{digest}.mp4"
            output_path.parent.mkdir(parents=True)
            output_path.write_bytes(payload)
            fingerprint = hashlib.sha256(payload).hexdigest()
            output = PreviewRenderOutput(kind="video", relativePath=f"previews/preview-render-v1/{digest}.mp4", playbackUri=f"supervideo://preview/{PROJECT_ID}/{digest}", sizeBytes=len(payload), durationMs=base.timeline_duration_ms, outputFingerprint=fingerprint)
            manifest = {"schemaVersion": 1, "projectId": PROJECT_ID, "planDigest": digest, "relativePath": output.relative_path, "sizeBytes": output.size_bytes, "durationMs": output.duration_ms, "outputFingerprint": output.output_fingerprint}
            output_path.with_name(f"{digest}.manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            executed = PreviewRenderResult.model_validate({**base.model_dump(by_alias=True), "executionMode": "ffmpeg", "executionStatus": "completed", "log": {"status": "completed", "stdout": "", "stderr": ""}, "output": output.model_dump(by_alias=True)})
            service = PreviewQualityCheckService(ffprobe_path="C:\\missing\\ffprobe.exe")
            service.bind_session(root, object())
            result = asyncio.run(service.check(PreviewQualityCheckParams(projectId=PROJECT_ID, previewResult=executed), asyncio.Event()))
            self.assertEqual(result.status, "warning")
            self.assertFalse(result.ready_for_export)
            self.assertNotIn("QA_OUTPUT_SIZE_MISMATCH", [issue.code for issue in result.issues if issue.severity == "fail"])
            wrong_uri = PreviewRenderResult.model_validate({**executed.model_dump(by_alias=True), "output": {**output.model_dump(by_alias=True), "playbackUri": f"supervideo://preview/11111111-1111-4111-8111-111111111111/{digest}"}})
            wrong_uri_result = asyncio.run(service.check(PreviewQualityCheckParams(projectId=PROJECT_ID, previewResult=wrong_uri), asyncio.Event()))
            self.assertEqual(wrong_uri_result.status, "fail")
            self.assertIn("QA_OUTPUT_PLAYBACK_URI_INVALID", [issue.code for issue in wrong_uri_result.issues])
            output_path.write_bytes(b"tampered")
            tampered = asyncio.run(service.check(PreviewQualityCheckParams(projectId=PROJECT_ID, previewResult=executed), asyncio.Event()))
            self.assertEqual(tampered.status, "fail")
            self.assertIn("QA_OUTPUT_FINGERPRINT_MISMATCH", [issue.code for issue in tampered.issues])

    def test_timeout_budget_expires_during_hash_with_stable_error(self) -> None:
        aroll, subtitle = plans()
        base = asyncio.run(PreviewRenderService().render(PreviewRenderParams(projectId=PROJECT_ID, arollPlan=aroll, subtitlePlan=subtitle), asyncio.Event()))
        digest = base.plan_digest
        payload = b"preview bytes"
        fingerprint = hashlib.sha256(payload).hexdigest()
        output = PreviewRenderOutput(kind="video", relativePath=f"previews/preview-render-v1/{digest}.mp4", playbackUri=f"supervideo://preview/{PROJECT_ID}/{digest}", sizeBytes=len(payload), durationMs=base.timeline_duration_ms, outputFingerprint=fingerprint)
        executed = PreviewRenderResult.model_validate({**base.model_dump(by_alias=True), "executionMode": "ffmpeg", "executionStatus": "completed", "log": {"status": "completed", "stdout": "", "stderr": ""}, "output": output.model_dump(by_alias=True)})
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            output_path = root / output.relative_path
            output_path.parent.mkdir(parents=True)
            output_path.write_bytes(payload)
            clock_value = [0.0]

            def clock() -> float:
                return clock_value[0]

            def slow_hash(_path: Path, check_budget) -> str:
                clock_value[0] = 2.0
                check_budget()
                return fingerprint

            service = PreviewQualityCheckService(ffprobe_path="C:\\missing\\ffprobe.exe", clock=clock)
            service.bind_session(root, object())
            with patch("supervideo_core.media.quality_check._sha256_file", side_effect=slow_hash):
                with self.assertRaises(Exception) as error:
                    asyncio.run(service.check(PreviewQualityCheckParams(projectId=PROJECT_ID, previewResult=executed, timeoutMs=1_000), asyncio.Event()))
            self.assertEqual(error.exception.code, "PREVIEW_QUALITY_TIMEOUT")

    def test_cancel_is_stable(self) -> None:
        aroll, subtitle = plans()
        preview = asyncio.run(PreviewRenderService().render(PreviewRenderParams(projectId=PROJECT_ID, arollPlan=aroll, subtitlePlan=subtitle), asyncio.Event()))
        cancelled = asyncio.Event()
        cancelled.set()
        with self.assertRaises(Exception) as error:
            asyncio.run(PreviewQualityCheckService().check(PreviewQualityCheckParams(projectId=PROJECT_ID, previewResult=preview), cancelled))
        self.assertEqual(error.exception.code, "PREVIEW_QUALITY_CANCELLED")


if __name__ == "__main__":
    unittest.main()
