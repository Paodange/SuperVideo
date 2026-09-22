from __future__ import annotations

import asyncio
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from supervideo_core.media.final_export import FinalMp4ExportService
from supervideo_core.media.final_export_models import FinalMp4Container, FinalMp4ExportParams, FinalMp4Manifest
from supervideo_core.media.errors import MediaError
from supervideo_core.media.preview_render import compute_preview_plan_digest
from supervideo_core.media.preview_render_models import PreviewRenderCue, PreviewRenderResult, PreviewSourceBinding
from supervideo_core.media.quality_check_models import PreviewQualityCheckResult, PreviewQualityIssue

ROOT = Path(__file__).resolve().parents[3]
PROJECT_ID = "99999999-9999-4999-8999-999999999999"


def inputs(payload: bytes = b"verified preview bytes") -> tuple[PreviewRenderResult, PreviewQualityCheckResult, bytes]:
    preview = json.loads((ROOT / "tests" / "fixtures" / "c06_preview_render_v1.json").read_text(encoding="utf-8"))
    digest = preview["planDigest"]
    fingerprint = hashlib.sha256(payload).hexdigest()
    preview.update({
        "executionMode": "ffmpeg",
        "executionStatus": "completed",
        "log": {"status": "completed", "stdout": "", "stderr": ""},
        "output": {
            "kind": "video",
            "relativePath": f"previews/preview-render-v1/{digest}.mp4",
            "playbackUri": f"supervideo://preview/{PROJECT_ID}/{digest}",
            "sizeBytes": len(payload),
            "durationMs": preview["timelineDurationMs"],
            "outputFingerprint": fingerprint,
        },
    })
    preview["planDigest"] = compute_preview_plan_digest(
        preview["projectId"], preview["timelineId"], preview["arollPlanDigest"], preview["subtitlePlanDigest"],
        preview["selectedDurationMs"],
        [PreviewRenderCue.model_validate(cue) for cue in preview["cues"]],
        [],
        [PreviewSourceBinding.model_validate(binding) for binding in preview["sourceBindings"]],
    )
    preview["output"]["relativePath"] = f"previews/preview-render-v1/{preview['planDigest']}.mp4"
    preview["output"]["playbackUri"] = f"supervideo://preview/{PROJECT_ID}/{preview['planDigest']}"
    digest = preview["planDigest"]
    preview_result = PreviewRenderResult.model_validate(preview)
    quality_result = PreviewQualityCheckResult(
        schemaVersion=1,
        qaVersion="preview-quality-v1",
        projectId=PROJECT_ID,
        planDigest=digest,
        phase="executed",
        status="pass",
        readyForExport=True,
        executionVerified=True,
        issueCount=1,
        issues=[PreviewQualityIssue(checkId="container", code="QA_OUTPUT_CONTAINER_INVALID", severity="pass", status="verified", message="Container verified.")],
    )
    return preview_result, quality_result, payload


class FinalExportTests(unittest.TestCase):
    def _service(self, root: Path) -> FinalMp4ExportService:
        service = FinalMp4ExportService(ffprobe_path="C:\\missing\\ffprobe.exe")
        service.bind_session(root, object())
        return service

    def _write_preview(self, root: Path, preview: PreviewRenderResult, payload: bytes) -> None:
        assert preview.output is not None
        path = root / preview.output.relative_path
        path.parent.mkdir(parents=True)
        path.write_bytes(payload)
        path.with_name(f"{preview.plan_digest}.manifest.json").write_text(json.dumps({
            "schemaVersion": 1,
            "projectId": PROJECT_ID,
            "planDigest": preview.plan_digest,
            "relativePath": preview.output.relative_path,
            "sizeBytes": preview.output.size_bytes,
            "durationMs": preview.output.duration_ms,
            "outputFingerprint": preview.output.output_fingerprint,
        }), encoding="utf-8")

    def test_success_is_atomic_and_idempotent_with_bound_manifest(self) -> None:
        preview, quality, payload = inputs()
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            self._write_preview(root, preview, payload)
            service = self._service(root)
            container = FinalMp4Container(formatName="mov,mp4,m4a", videoCodec="h264", audioCodec=None, width=1080, height=1920, frameRate=30.0)
            with patch.object(service, "_verify_container", new=AsyncMock(return_value=(container, preview.timeline_duration_ms))):
                result = asyncio.run(service.export(FinalMp4ExportParams(projectId=PROJECT_ID, previewResult=preview, qualityResult=quality), asyncio.Event()))
                cached = asyncio.run(service.export(FinalMp4ExportParams(projectId=PROJECT_ID, previewResult=preview, qualityResult=quality), asyncio.Event()))
            self.assertEqual(result.status, "completed")
            self.assertEqual(cached.status, "cache-hit")
            self.assertEqual((root / result.output.relative_path).read_bytes(), payload)
            manifest = FinalMp4Manifest.model_validate(json.loads((root / result.output.manifest_relative_path).read_text(encoding="utf-8")))
            self.assertEqual(manifest.plan_digest, preview.plan_digest)
            self.assertEqual(manifest.quality_digest, result.quality_digest)
            self.assertEqual(manifest.preview_output_fingerprint, preview.output.output_fingerprint)

    def test_plan_not_run_quality_warning_and_gaps_are_blocked(self) -> None:
        preview, quality, payload = inputs()
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            self._write_preview(root, preview, payload)
            service = self._service(root)
            plan_preview = PreviewRenderResult.model_validate({**preview.model_dump(by_alias=True), "executionMode": "plan", "executionStatus": "not-run", "log": {"status": "not-run", "stdout": "", "stderr": ""}, "output": None})
            with self.assertRaises(MediaError) as error:
                asyncio.run(service.export(FinalMp4ExportParams(projectId=PROJECT_ID, previewResult=plan_preview, qualityResult=quality), asyncio.Event()))
            self.assertEqual(error.exception.code, "FINAL_EXPORT_PREVIEW_NOT_READY")
            with self.assertRaises(MediaError) as error:
                warning_quality = PreviewQualityCheckResult.model_validate({**quality.model_dump(by_alias=True), "status": "warning", "readyForExport": False, "issues": [{**quality.issues[0].model_dump(by_alias=True), "severity": "warning"}]})
                asyncio.run(service.export(FinalMp4ExportParams(projectId=PROJECT_ID, previewResult=preview, qualityResult=warning_quality), asyncio.Event()))
            self.assertEqual(error.exception.code, "FINAL_EXPORT_QUALITY_NOT_READY")

    def test_source_tampering_cancel_timeout_and_path_escape_are_stable(self) -> None:
        preview, quality, payload = inputs()
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            self._write_preview(root, preview, payload)
            service = self._service(root)
            (root / preview.output.relative_path).write_bytes(b"tampered")
            with self.assertRaises(MediaError) as error:
                asyncio.run(service.export(FinalMp4ExportParams(projectId=PROJECT_ID, previewResult=preview, qualityResult=quality), asyncio.Event()))
            self.assertEqual(error.exception.code, "FINAL_EXPORT_SOURCE_TAMPERED")
            cancelled = asyncio.Event()
            cancelled.set()
            with self.assertRaises(MediaError) as error:
                asyncio.run(service.export(FinalMp4ExportParams(projectId=PROJECT_ID, previewResult=preview, qualityResult=quality), cancelled))
            self.assertEqual(error.exception.code, "FINAL_EXPORT_CANCELLED")
        with self.assertRaises(ValueError):
            FinalMp4ExportParams(projectId=PROJECT_ID, previewResult=preview, qualityResult=quality, outputName="../outside.mp4")

    def test_container_validation_rejects_non_h264_and_timeout_is_stable(self) -> None:
        preview, quality, payload = inputs()
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            self._write_preview(root, preview, payload)
            service = self._service(root)
            service.ffprobe_path = "C:\\ffprobe.exe"
            probe = json.dumps({"format": {"format_name": "mov,mp4,m4a", "duration": "3.500"}, "streams": [{"index": 0, "codec_type": "video", "codec_name": "vp9", "width": 1080, "height": 1920, "r_frame_rate": "30/1"}]}).encode()
            with patch("supervideo_core.media.final_export.MediaService._run", new=AsyncMock(return_value=probe)):
                with self.assertRaises(MediaError) as error:
                    asyncio.run(service._verify_container(root / preview.output.relative_path, preview.timeline_duration_ms, asyncio.Event(), service._clock() + 1))
            self.assertEqual(error.exception.code, "FINAL_EXPORT_CONTAINER_INVALID")
            timeout_service = self._service(root)
            clock_values = [0.0, 2.0]
            timeout_service._clock = lambda: clock_values.pop(0) if clock_values else 2.0
            with self.assertRaises(MediaError) as error:
                asyncio.run(timeout_service.export(FinalMp4ExportParams(projectId=PROJECT_ID, previewResult=preview, qualityResult=quality, timeoutMs=1_000), asyncio.Event()))
            self.assertEqual(error.exception.code, "FINAL_EXPORT_TIMEOUT")


if __name__ == "__main__":
    unittest.main()
