from __future__ import annotations

import asyncio
import shutil
import tempfile
import unittest
from pathlib import Path

from supervideo_core.media.errors import MediaError
from supervideo_core.media.vad import RawVadInterval, RawVadResult, VadService
from supervideo_core.media.vad_models import VadConfig, VadParams
from supervideo_core.project import AssetReferenceRequest, ProjectCreateRequest, ProjectError, ProjectService


class FakeVadRunner:
    def __init__(self, outcome: str = "success") -> None:
        self.outcome = outcome
        self.calls = 0

    async def run(self, _path: Path, _config: VadConfig, cancelled: asyncio.Event) -> RawVadResult:
        self.calls += 1
        if self.outcome == "timeout":
            await asyncio.sleep(30)
        if self.outcome == "cancel":
            await cancelled.wait()
            raise MediaError("VAD_CANCELLED")
        if self.outcome == "unavailable":
            raise MediaError("VAD_TOOL_UNAVAILABLE")
        if self.outcome == "bad-output":
            return RawVadResult(2, (RawVadInterval(1.0, 0.5, True),))
        if self.outcome == "nan-output":
            return RawVadResult(2, (RawVadInterval(float("nan"), 1.0, True),))
        return RawVadResult(
            2.0,
            (
                RawVadInterval(0.05, 0.45, True, 0.9),
                RawVadInterval(0.45, 0.50, False),
                RawVadInterval(0.50, 1.00, True, 0.8),
                RawVadInterval(1.00, 2.00, False),
            ),
        )


def make_service(root: Path, runner: FakeVadRunner) -> tuple[ProjectService, str, str]:
    root.mkdir(parents=True, exist_ok=True)
    project = ProjectService(vad_service=VadService(runner=runner))
    summary = project.create(ProjectCreateRequest(name="VAD", targetPlatform="douyin", projectRoot=str(root)))
    asset_path = root.parent / "source.mp4"
    asset_path.write_bytes(b"stable VAD source bytes")
    reference = project.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(asset_path)]))
    return project, summary.project_id, reference.items[0].asset_id


class VadServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_root = Path(tempfile.mkdtemp(prefix="supervideo vad "))

    def tearDown(self) -> None:
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def test_padding_merge_and_boundary_clipping_preserve_voice_edges(self) -> None:
        runner = FakeVadRunner()
        project, project_id, asset_id = make_service(self.temp_root / "project-a", runner)
        try:
            async def scenario() -> None:
                config = VadConfig(preRollMs=120, postRollMs=180, mergeGapMs=100)
                result = await project.detect_voice_activity(
                    VadParams(projectId=project_id, assetId=asset_id, config=config), asyncio.Event(),
                )
                speech = [item for item in result.intervals if item.is_speech]
                self.assertEqual(len(speech), 1)
                self.assertEqual((speech[0].start_ms, speech[0].end_ms), (0, 1_180))
                self.assertEqual(speech[0].confidence, None)
                self.assertEqual(result.intervals[0].is_speech, True)
                self.assertEqual(result.intervals[-1].is_speech, False)
                self.assertEqual(sum(item.end_ms - item.start_ms for item in result.intervals), 2_000)

            asyncio.run(scenario())
            self.assertEqual(runner.calls, 1)
        finally:
            project.close()

    def test_cache_is_strict_project_scoped_and_fingerprint_checked(self) -> None:
        runner = FakeVadRunner()
        project, project_id, asset_id = make_service(self.temp_root / "project-a", runner)
        try:
            params = VadParams(projectId=project_id, assetId=asset_id)

            async def scenario() -> None:
                created = await project.detect_voice_activity(params, asyncio.Event())
                self.assertEqual(created.cache_status, "created")
                cached = await project.detect_voice_activity(params, asyncio.Event())
                self.assertEqual(cached.cache_status, "cache-hit")
                cache_file = self.temp_root / "project-a" / "cache" / "vad-cache-v1" / "intervals" / f"{created.cache_key}.json"
                cache_file.write_text('{"schemaVersion":999}', encoding="utf-8")
                rebuilt = await project.detect_voice_activity(params, asyncio.Event())
                self.assertEqual(rebuilt.cache_status, "created")

            asyncio.run(scenario())
            self.assertEqual(runner.calls, 2)
            (self.temp_root / "source.mp4").write_bytes(b"changed VAD source bytes")
            with self.assertRaises(ProjectError) as error:
                asyncio.run(project.detect_voice_activity(params, asyncio.Event()))
            self.assertEqual(error.exception.code, "ASSET_CHANGED")
        finally:
            project.close()

        other_runner = FakeVadRunner()
        other, other_project_id, other_asset_id = make_service(self.temp_root / "project-b", other_runner)
        try:
            asyncio.run(other.detect_voice_activity(VadParams(projectId=other_project_id, assetId=other_asset_id), asyncio.Event()))
            self.assertEqual(other_runner.calls, 1)
        finally:
            other.close()

    def test_silence_bad_output_unavailable_timeout_and_cancel_have_stable_codes(self) -> None:
        for outcome, expected in (("unavailable", "VAD_TOOL_UNAVAILABLE"), ("bad-output", "VAD_OUTPUT_INVALID"), ("nan-output", "VAD_OUTPUT_INVALID")):
            runner = FakeVadRunner(outcome)
            project, project_id, asset_id = make_service(self.temp_root / outcome, runner)
            try:
                with self.assertRaises(MediaError) as error:
                    asyncio.run(project.detect_voice_activity(VadParams(projectId=project_id, assetId=asset_id), asyncio.Event()))
                self.assertEqual(error.exception.code, expected)
            finally:
                project.close()

        timeout_runner = FakeVadRunner("timeout")
        timeout_project, timeout_project_id, timeout_asset_id = make_service(self.temp_root / "timeout", timeout_runner)
        try:
            with self.assertRaises(MediaError) as error:
                asyncio.run(timeout_project.detect_voice_activity(VadParams(projectId=timeout_project_id, assetId=timeout_asset_id, timeoutMs=1_000), asyncio.Event()))
            self.assertEqual(error.exception.code, "VAD_TIMEOUT")
        finally:
            timeout_project.close()

        cancel_runner = FakeVadRunner("cancel")
        cancel_project, cancel_project_id, cancel_asset_id = make_service(self.temp_root / "cancel", cancel_runner)
        try:
            async def cancel_scenario() -> None:
                cancelled = asyncio.Event()
                task = asyncio.create_task(cancel_project.detect_voice_activity(VadParams(projectId=cancel_project_id, assetId=cancel_asset_id), cancelled))
                await asyncio.sleep(0.02)
                cancelled.set()
                with self.assertRaises(MediaError) as error:
                    await task
                self.assertEqual(error.exception.code, "VAD_CANCELLED")

            asyncio.run(cancel_scenario())
        finally:
            cancel_project.close()

    def test_no_speech_is_explicit_silence(self) -> None:
        service = VadService(runner=FakeVadRunner())
        request = VadParams(projectId="11111111-1111-4111-8111-111111111111", assetId="22222222-2222-4222-8222-222222222222")
        result = service._build_result(request, "a" * 64, request.config, RawVadResult(1, (RawVadInterval(0, 1, False),)))
        self.assertEqual(len(result.intervals), 1)
        self.assertFalse(result.intervals[0].is_speech)
        self.assertEqual(result.intervals[0].quality, "silence")


if __name__ == "__main__":
    unittest.main()
