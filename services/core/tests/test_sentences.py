from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from supervideo_core.media.errors import MediaError
from supervideo_core.media.sentence_models import SentenceParams
from supervideo_core.media.sentences import SentenceService
from supervideo_core.media.transcription_models import (
    TranscriptionModelInfo,
    TranscriptionResult,
    TranscriptionSegment,
)
from supervideo_core.media.vad_models import SpeechInterval, VadConfig, VadResult
from supervideo_core.project import AssetReferenceRequest, ProjectCreateRequest, ProjectService


PROJECT_ID = "11111111-1111-4111-8111-111111111111"
ASSET_ID = "22222222-2222-4222-8222-222222222222"


class FakePrerequisite:
    def __init__(self) -> None:
        self.calls = 0

    def bind_session(self, _root: Path, _database: object) -> None:
        pass


class FakeTranscription(FakePrerequisite):
    async def transcribe(self, request, _cancelled):
        self.calls += 1
        return TranscriptionResult(
            schemaVersion=1, projectId=request.project_id, assetId=request.asset_id,
            cacheStatus="created", cacheKey="t" * 64,
            model=TranscriptionModelInfo(adapterVersion="faster-whisper-v1", provider="faster-whisper", modelName="tiny", device="cpu", computeType="int8"),
            language="zh", languageProbability=0.99, durationMs=2_000,
            segments=[
                TranscriptionSegment(index=0, startMs=200, endMs=700, text="这是完整句子。", confidence=0.95, avgLogprob=-0.1, noSpeechProbability=0.01, compressionRatio=1.0),
                TranscriptionSegment(index=1, startMs=1_000, endMs=1_300, text="这是第二句！", confidence=0.92, avgLogprob=-0.1, noSpeechProbability=0.01, compressionRatio=1.0),
                TranscriptionSegment(index=2, startMs=1_700, endMs=1_900, text="没有标点的片段", confidence=0.4, avgLogprob=-1.0, noSpeechProbability=0.2, compressionRatio=1.0),
            ],
        )


class FakeVad(FakePrerequisite):
    async def detect(self, request, _cancelled):
        self.calls += 1
        return VadResult(
            schemaVersion=1, projectId=request.project_id, assetId=request.asset_id,
            cacheStatus="created", cacheKey="v" * 64, adapterVersion="ffmpeg-silencedetect-v1",
            durationMs=2_000, config=VadConfig(), intervals=[
                SpeechInterval(index=0, startMs=0, endMs=1_500, isSpeech=True, confidence=0.9, quality="detected"),
                SpeechInterval(index=1, startMs=1_500, endMs=1_600, isSpeech=False, confidence=None, quality="silence"),
                SpeechInterval(index=2, startMs=1_600, endMs=2_000, isSpeech=True, confidence=0.8, quality="detected"),
            ],
        )


def make_project(root: Path, transcription: FakeTranscription, vad: FakeVad) -> tuple[ProjectService, str, str]:
    root.mkdir(parents=True, exist_ok=True)
    project = ProjectService(sentence_service=SentenceService(transcription_service=transcription, vad_service=vad))
    summary = project.create(ProjectCreateRequest(name="Sentences", targetPlatform="douyin", projectRoot=str(root)))
    asset_path = root.parent / "voice.mp4"
    asset_path.write_bytes(b"stable sentence fixture")
    reference = project.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(asset_path)]))
    return project, summary.project_id, reference.items[0].asset_id


class SentenceServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_root = Path(tempfile.mkdtemp(prefix="supervideo sentences "))

    def tearDown(self) -> None:
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def test_punctuation_boundaries_vad_padding_and_review_reasons(self) -> None:
        transcription = FakeTranscription()
        vad = FakeVad()
        project, project_id, asset_id = make_project(self.temp_root / "project-a", transcription, vad)
        try:
            result = asyncio.run(project.split_sentences(SentenceParams(projectId=project_id, assetId=asset_id), asyncio.Event()))
            self.assertEqual(result.cache_status, "created")
            self.assertEqual(len(result.sentences), 3)
            self.assertEqual(result.sentences[0].text, "这是完整句子。")
            self.assertEqual((result.sentences[0].start_ms, result.sentences[0].end_ms), (80, 880))
            self.assertEqual(result.sentences[0].quality, "complete")
            self.assertEqual(result.sentences[2].quality, "needs_review")
            self.assertIn("missing-punctuation", result.sentences[2].quality_reasons)
            self.assertIn("low-confidence", result.sentences[2].quality_reasons)
        finally:
            project.close()

    def test_cache_hit_corruption_rebuild_and_fingerprint_invalidation(self) -> None:
        transcription = FakeTranscription()
        vad = FakeVad()
        project, project_id, asset_id = make_project(self.temp_root / "project-a", transcription, vad)
        source = self.temp_root / "voice.mp4"
        try:
            params = SentenceParams(projectId=project_id, assetId=asset_id)
            created = asyncio.run(project.split_sentences(params, asyncio.Event()))
            cached = asyncio.run(project.split_sentences(params, asyncio.Event()))
            self.assertEqual(cached.cache_status, "cache-hit")
            self.assertEqual((transcription.calls, vad.calls), (1, 1))
            cache_file = self.temp_root / "project-a" / "cache" / "sentence-cache-v1" / "sentences" / f"{created.cache_key}.json"
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
            payload["result"]["sentences"][0]["text"] = "损坏"
            cache_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            rebuilt = asyncio.run(project.split_sentences(params, asyncio.Event()))
            self.assertEqual(rebuilt.cache_status, "created")
            self.assertEqual((transcription.calls, vad.calls), (2, 2))
            source.write_bytes(b"changed sentence fixture")
            with self.assertRaises(Exception) as error:
                asyncio.run(project.split_sentences(params, asyncio.Event()))
            self.assertEqual(getattr(error.exception, "code", None), "ASSET_CHANGED")
        finally:
            project.close()

    def test_invalid_prerequisite_is_not_silently_accepted(self) -> None:
        class BadTranscription(FakeTranscription):
            async def transcribe(self, request, _cancelled):
                result = await super().transcribe(request, _cancelled)
                result.segments[0].index = 3
                return result

        transcription = BadTranscription()
        vad = FakeVad()
        project, project_id, asset_id = make_project(self.temp_root / "project-b", transcription, vad)
        try:
            with self.assertRaises(MediaError) as error:
                asyncio.run(project.split_sentences(SentenceParams(projectId=project_id, assetId=asset_id), asyncio.Event()))
            self.assertEqual(error.exception.code, "SENTENCE_PREREQUISITE_INVALID")
        finally:
            project.close()

    def test_cancellation_and_max_length_are_recoverable_and_reviewed(self) -> None:
        class SlowTranscription(FakeTranscription):
            async def transcribe(self, request, cancelled):
                self.calls += 1
                await cancelled.wait()
                raise MediaError("TRANSCRIPTION_CANCELLED")

        transcription = SlowTranscription()
        vad = FakeVad()
        project, project_id, asset_id = make_project(self.temp_root / "project-c", transcription, vad)
        try:
            async def scenario() -> None:
                cancelled = asyncio.Event()
                task = asyncio.create_task(project.split_sentences(SentenceParams(projectId=project_id, assetId=asset_id), cancelled))
                await asyncio.sleep(0.01)
                cancelled.set()
                with self.assertRaises(MediaError) as error:
                    await task
                self.assertEqual(error.exception.code, "SENTENCE_CANCELLED")

            asyncio.run(scenario())
        finally:
            project.close()


if __name__ == "__main__":
    unittest.main()
