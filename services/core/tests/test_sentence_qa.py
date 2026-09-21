from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from supervideo_core.media.qa import SentenceQaService
from supervideo_core.media.qa_models import SentenceQaParams, SentenceQaSaveParams
from supervideo_core.media.sentence_models import SentenceParams
from supervideo_core.project import AssetReferenceRequest, ProjectCreateRequest, ProjectService

from test_sentences import FakeTranscription, FakeVad


PROJECT_ID = "11111111-1111-4111-8111-111111111111"
ASSET_ID = "22222222-2222-4222-8222-222222222222"


class SentenceQaTests(unittest.TestCase):
    def test_regression_fixture_is_deterministic_and_has_at_least_50_samples(self) -> None:
        fixture_path = Path(__file__).parents[3] / "tests" / "fixtures" / "b06_sentence_qa_regression_v1.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        self.assertEqual(fixture["schemaVersion"], 1)
        self.assertEqual(fixture["fixtureVersion"], "sentence-qa-regression-v1")
        self.assertEqual(fixture["sentenceCount"], len(fixture["samples"]))
        self.assertGreaterEqual(fixture["sentenceCount"], 50)
        self.assertEqual([sample["id"] for sample in fixture["samples"]], [f"b06-{index:03d}" for index in range(1, 61)])

    def setUp(self) -> None:
        self.temp_root = Path(tempfile.mkdtemp(prefix="supervideo sentence qa "))
        self.asset_path = self.temp_root / "voice.mp4"
        self.asset_path.write_bytes(b"stable sentence qa fixture")
        project_root = self.temp_root / "project"
        project_root.mkdir()
        self.project = ProjectService(
            sentence_qa_service=SentenceQaService(),
            transcription_service=FakeTranscription(),
            vad_service=FakeVad(),
        )
        summary = self.project.create(ProjectCreateRequest(name="Sentence QA", targetPlatform="douyin", projectRoot=str(project_root)))
        reference = self.project.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(self.asset_path)]))
        self.project_id = summary.project_id
        self.asset_id = reference.items[0].asset_id

    def tearDown(self) -> None:
        self.project.close()
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def test_context_uses_b05_cache_and_stable_playback_address(self) -> None:
        sentence_result = asyncio.run(self.project.split_sentences(SentenceParams(projectId=self.project_id, assetId=self.asset_id), asyncio.Event()))
        context = self.project.inspect_sentence_qa(SentenceQaParams(projectId=self.project_id, assetId=self.asset_id, sentenceCacheKey=sentence_result.cache_key, sentenceIndex=1, contextBefore=1, contextAfter=1))
        self.assertEqual(context.qa_version, "sentence-qa-v1")
        self.assertEqual([item.relation for item in context.items], ["before", "selected", "after"])
        self.assertTrue(context.items[1].playback.uri.startswith(f"supervideo://asset/{self.asset_id}?startMs="))
        self.assertNotIn(str(self.asset_path), context.items[1].playback.uri)

    def test_markers_are_bounded_atomic_and_reloaded(self) -> None:
        sentence_result = asyncio.run(self.project.split_sentences(SentenceParams(projectId=self.project_id, assetId=self.asset_id), asyncio.Event()))
        request = SentenceQaSaveParams(
            projectId=self.project_id,
            assetId=self.asset_id,
            sentenceCacheKey=sentence_result.cache_key,
            sentenceIndex=2,
            markers=[
                {"sentenceIndex": 2, "issueType": "missing-text", "expectedText": "没有标点的片段。", "note": "句尾疑似缺字"},
                {"sentenceIndex": 2, "issueType": "low-confidence", "source": "automatic", "note": "B05 confidence below threshold"},
            ],
        )
        saved = self.project.save_sentence_qa(request)
        self.assertEqual(saved.revision, 1)
        self.assertEqual(len(saved.markers), 2)
        loaded = self.project.inspect_sentence_qa(SentenceQaParams(projectId=self.project_id, assetId=self.asset_id, sentenceCacheKey=sentence_result.cache_key, sentenceIndex=2))
        self.assertEqual([marker.issue_type for marker in loaded.markers], ["low-confidence", "missing-text"])
        marker_path = self.temp_root / "project" / "data" / "qa" / "sentence-qa-v1" / self.asset_id / f"{sentence_result.cache_key}.json"
        payload = json.loads(marker_path.read_text(encoding="utf-8"))
        self.assertEqual(payload["qaVersion"], "sentence-qa-v1")
        payload["markers"][0]["note"] = "tampered"
        marker_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(Exception) as error:
            self.project.inspect_sentence_qa(SentenceQaParams(projectId=self.project_id, assetId=self.asset_id, sentenceCacheKey=sentence_result.cache_key, sentenceIndex=2))
        self.assertEqual(getattr(error.exception, "code", None), "SENTENCE_QA_STORAGE_INVALID")

    def test_unknown_cache_and_out_of_range_markers_are_rejected(self) -> None:
        with self.assertRaises(Exception) as missing:
            self.project.inspect_sentence_qa(SentenceQaParams(projectId=self.project_id, assetId=self.asset_id, sentenceCacheKey="a" * 64, sentenceIndex=0))
        self.assertEqual(getattr(missing.exception, "code", None), "SENTENCE_QA_RESULT_NOT_FOUND")
        sentence_result = asyncio.run(self.project.split_sentences(SentenceParams(projectId=self.project_id, assetId=self.asset_id), asyncio.Event()))
        with self.assertRaises(Exception) as invalid:
            self.project.save_sentence_qa(SentenceQaSaveParams(projectId=self.project_id, assetId=self.asset_id, sentenceCacheKey=sentence_result.cache_key, sentenceIndex=0, markers=[{"sentenceIndex": 99, "issueType": "half-sentence", "note": "out of range"}]))
        self.assertEqual(getattr(invalid.exception, "code", None), "SENTENCE_QA_INDEX_INVALID")


if __name__ == "__main__":
    unittest.main()
