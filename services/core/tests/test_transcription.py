from __future__ import annotations

import asyncio
import shutil
import tempfile
import unittest
from pathlib import Path

from supervideo_core.media.errors import MediaError
from supervideo_core.media.transcription import (
    RawSegment,
    RawTranscription,
    RawWord,
    TranscriptionConfig,
    TranscriptionService,
    transcription_config_from_env,
)
from supervideo_core.media.transcription_models import TranscriptionParams
from supervideo_core.project import AssetReferenceRequest, ProjectCreateRequest, ProjectError, ProjectService


class FakeRunner:
    def __init__(self, outcome: str = "success") -> None:
        self.outcome = outcome
        self.calls = 0

    async def run(self, _path: Path, _config: TranscriptionConfig, cancelled: asyncio.Event) -> RawTranscription:
        self.calls += 1
        if self.outcome == "timeout":
            await asyncio.sleep(30)
        if self.outcome == "cancel":
            await cancelled.wait()
            raise MediaError("TRANSCRIPTION_CANCELLED")
        if self.outcome == "bad-output":
            return RawTranscription(language="zh", language_probability=0.9, duration=1, segments=(RawSegment(
                start=0, end=1, text="", avg_logprob=None, no_speech_probability=None, compression_ratio=None,
            ),))
        if self.outcome in {
            "TRANSCRIPTION_TOOL_UNAVAILABLE",
            "TRANSCRIPTION_MODEL_UNAVAILABLE",
            "TRANSCRIPTION_OUTPUT_INVALID",
        }:
            raise MediaError(self.outcome)  # type: ignore[arg-type]
        return RawTranscription(
            language="zh",
            language_probability=0.98,
            duration=1.25,
            segments=(RawSegment(
                start=0,
                end=1.2,
                text="  这是一个测试句子。 ",
                avg_logprob=-0.21,
                no_speech_probability=0.02,
                compression_ratio=1.1,
                words=(
                    RawWord(start=0.0, end=0.4, text="这是", probability=0.96),
                    RawWord(start=0.4, end=1.2, text="一个测试句子。", probability=0.94),
                ),
            ),),
        )


def make_service(root: Path, runner: FakeRunner) -> tuple[ProjectService, str, str]:
    root.mkdir(parents=True, exist_ok=True)
    project = ProjectService(
        transcription_service=TranscriptionService(
            runner=runner,
            config=TranscriptionConfig(model_name="tiny", device="cpu", compute_type="int8"),
        )
    )
    summary = project.create(ProjectCreateRequest(name="Transcription", targetPlatform="douyin", projectRoot=str(root)))
    asset_path = root.parent / "source.mp4"
    asset_path.write_bytes(b"stable source bytes")
    reference = project.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(asset_path)]))
    return project, summary.project_id, reference.items[0].asset_id


class TranscriptionServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_root = Path(tempfile.mkdtemp(prefix="supervideo transcription "))

    def tearDown(self) -> None:
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def test_success_cache_hit_fingerprint_invalidation_and_project_isolation(self) -> None:
        runner = FakeRunner()
        project, project_id, asset_id = make_service(self.temp_root / "project-a", runner)
        original = (self.temp_root / "source.mp4").read_bytes()

        async def scenario() -> None:
            params = TranscriptionParams(projectId=project_id, assetId=asset_id)
            created = await project.transcribe_media(params, asyncio.Event())
            self.assertEqual(created.cache_status, "created")
            self.assertEqual(created.segments[0].words[0].start_ms, 0)
            self.assertEqual((await project.transcribe_media(params, asyncio.Event())).cache_status, "cache-hit")
            self.assertEqual(runner.calls, 1)
            cache_file = self.temp_root / "project-a" / "cache" / "transcription-cache-v1" / "transcripts" / f"{created.cache_key}.json"
            cache_file.write_text('{"schemaVersion":999}', encoding="utf-8")
            self.assertEqual((await project.transcribe_media(params, asyncio.Event())).cache_status, "created")
            self.assertEqual(runner.calls, 2)

        asyncio.run(scenario())
        self.assertEqual((self.temp_root / "source.mp4").read_bytes(), original)
        (self.temp_root / "source.mp4").write_bytes(b"changed source bytes")
        with self.assertRaises(ProjectError) as error:
            asyncio.run(project.transcribe_media(TranscriptionParams(projectId=project_id, assetId=asset_id), asyncio.Event()))
        self.assertEqual(error.exception.code, "ASSET_CHANGED")
        project.close()

        other_runner = FakeRunner()
        other, other_project_id, other_asset_id = make_service(self.temp_root / "project-b", other_runner)
        try:
            async def other_scenario() -> None:
                result = await other.transcribe_media(TranscriptionParams(projectId=other_project_id, assetId=other_asset_id), asyncio.Event())
                self.assertEqual(result.cache_status, "created")

            asyncio.run(other_scenario())
            self.assertEqual(other_runner.calls, 1)
        finally:
            other.close()

    def test_fixed_errors_bad_output_tool_model_timeout_and_cancel(self) -> None:
        for outcome, expected in (
            ("TRANSCRIPTION_TOOL_UNAVAILABLE", "TRANSCRIPTION_TOOL_UNAVAILABLE"),
            ("TRANSCRIPTION_MODEL_UNAVAILABLE", "TRANSCRIPTION_MODEL_UNAVAILABLE"),
            ("bad-output", "TRANSCRIPTION_OUTPUT_INVALID"),
        ):
            with self.subTest(outcome=outcome):
                runner = FakeRunner(outcome)
                project, project_id, asset_id = make_service(self.temp_root / outcome, runner)
                try:
                    with self.assertRaises(MediaError) as error:
                        asyncio.run(project.transcribe_media(TranscriptionParams(projectId=project_id, assetId=asset_id), asyncio.Event()))
                    self.assertEqual(error.exception.code, expected)
                finally:
                    project.close()

        timeout_runner = FakeRunner("timeout")
        timeout_project, timeout_project_id, timeout_asset_id = make_service(self.temp_root / "timeout", timeout_runner)
        try:
            with self.assertRaises(MediaError) as error:
                asyncio.run(timeout_project.transcribe_media(TranscriptionParams(projectId=timeout_project_id, assetId=timeout_asset_id, timeoutMs=1_000), asyncio.Event()))
            self.assertEqual(error.exception.code, "TRANSCRIPTION_TIMEOUT")
        finally:
            timeout_project.close()

        cancel_runner = FakeRunner("cancel")
        cancel_project, cancel_project_id, cancel_asset_id = make_service(self.temp_root / "cancel", cancel_runner)
        try:
            async def cancel_scenario() -> None:
                cancelled = asyncio.Event()
                task = asyncio.create_task(cancel_project.transcribe_media(TranscriptionParams(projectId=cancel_project_id, assetId=cancel_asset_id), cancelled))
                await asyncio.sleep(0.02)
                cancelled.set()
                with self.assertRaises(MediaError) as error:
                    await task
                self.assertEqual(error.exception.code, "TRANSCRIPTION_CANCELLED")

            asyncio.run(cancel_scenario())
        finally:
            cancel_project.close()

    def test_controlled_environment_rejects_model_paths(self) -> None:
        with self.assertRaises(MediaError) as error:
            transcription_config_from_env({"SUPERVIDEO_WHISPER_MODEL": r"C:\\models\\secret"})
        self.assertEqual(error.exception.code, "TRANSCRIPTION_MODEL_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
