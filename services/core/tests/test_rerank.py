from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from supervideo_core.media.rerank_models import RerankParams
from supervideo_core.media.sentence_models import SentenceCandidate, SentenceConfig, SentenceResult, validate_sentence_result_size
from supervideo_core.media.sentences import SentenceService
from supervideo_core.media.service import MEDIA_CACHE_VERSION, PROBE_PARAMETERS, MediaService
from supervideo_core.media.index_models import SentenceIndexParams
from supervideo_core.media.qa_models import SentenceQaSaveParams
from supervideo_core.project import AssetReferenceRequest, ProjectCreateRequest, ProjectService
from supervideo_core.project.paths import canonical_asset_path


class SentenceRerankTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_root = Path(tempfile.mkdtemp(prefix="supervideo rerank "))
        self.asset_path = self.temp_root / "voice-a.mp4"
        self.asset_path.write_bytes(b"stable rerank fixture a")
        self.second_path = self.temp_root / "voice-b.mp4"
        self.second_path.write_bytes(b"stable rerank fixture b")
        project_root = self.temp_root / "project"
        project_root.mkdir()
        self.project = ProjectService()
        summary = self.project.create(ProjectCreateRequest(name="Rerank", targetPlatform="douyin", projectRoot=str(project_root)))
        references = self.project.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(self.asset_path), str(self.second_path)]))
        self.project_id = summary.project_id
        self.asset_id = references.items[0].asset_id
        self.second_asset_id = references.items[1].asset_id
        self.project_root = project_root
        self.sources = [self._write_b05(self.asset_id, self.asset_path), self._write_b05(self.second_asset_id, self.second_path)]
        for source in self.sources:
            asyncio.run(self.project.index_sentences(SentenceIndexParams(projectId=self.project_id, assetId=source.asset_id, sentenceCacheKey=source.cache_key), asyncio.Event()))
        self._write_probe_cache(self.asset_path)

    def tearDown(self) -> None:
        self.project.close()
        shutil.rmtree(self.temp_root, ignore_errors=True)

    @staticmethod
    def _digest(value: object) -> str:
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    def _write_b05(self, asset_id: str, asset_path: Path) -> SentenceResult:
        sentences = []
        for index in range(60):
            if index % 3 == 0:
                text = "工厂招聘岗位薪资和福利需要提前确认。" if index == 0 else f"工厂招聘岗位第{index + 1}句，薪资和福利需要提前确认。"
            elif index % 3 == 1:
                text = f"求职面试第{index + 1}句，准备简历和工作经验。"
            else:
                text = f"视频剪辑第{index + 1}句，素材和字幕要保持完整。"
            quality = "needs_review" if index % 11 == 0 else "complete"
            sentences.append(SentenceCandidate(index=index, sourceAssetId=asset_id, startMs=index * 1_000, endMs=index * 1_000 + 700, text=text, confidence=0.95 if index % 4 else 0.55, quality=quality, qualityReasons=["boundary"] if quality == "needs_review" else [], sourceSegmentIndexes=[index]))
        canonical_path, _ = canonical_asset_path(str(asset_path))
        signature, fingerprint = SentenceService._asset_signature(canonical_path)
        config = SentenceConfig()
        cache_key = SentenceService._cache_key(self.project_id, canonical_path, signature, fingerprint, config)
        result = validate_sentence_result_size(SentenceResult(schemaVersion=1, projectId=self.project_id, assetId=asset_id, cacheStatus="created", cacheKey=cache_key, adapterVersion="sentence-segmentation-v1", durationMs=60_000, config=config, sentences=sentences))
        target = self.project_root / "cache" / "sentence-cache-v1" / "sentences" / f"{cache_key}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        value = result.model_dump(by_alias=True)
        target.write_text(json.dumps({"schemaVersion": 1, "cacheKey": cache_key, "resultDigest": self._digest(value), "result": value}, ensure_ascii=False), encoding="utf-8")
        return result

    def _write_probe_cache(self, asset_path: Path) -> None:
        canonical_path, _ = canonical_asset_path(str(asset_path))
        signature, fingerprint = MediaService._asset_signature(canonical_path)
        key = MediaService._cache_key(canonical_path, signature, fingerprint, PROBE_PARAMETERS)
        target = self.project_root / "cache" / MEDIA_CACHE_VERSION / "probe" / f"{key}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({
            "schemaVersion": 1,
            "metadata": {
                "schemaVersion": 1,
                "formatName": "fixture",
                "formatLongName": "fixture",
                "durationMs": 60_000,
                "bitRate": 8_000_000,
                "streams": [{"index": 0, "codecType": "video", "codecName": "h264", "width": 1920, "height": 1080, "frameRate": 30.0, "sampleRate": None, "channels": None, "channelLayout": None, "language": None}],
            },
        }), encoding="utf-8")

    def test_quality_qa_duplicate_and_diversity_are_auditable_and_deterministic(self) -> None:
        fixture_path = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "b09_quality_rerank_regression_v1.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        self.assertEqual(fixture["fixtureVersion"], "b09-quality-rerank-regression-v1")
        self.assertGreaterEqual(len(fixture["candidates"]), 50)
        source = self.sources[0]
        self.project.save_sentence_qa(SentenceQaSaveParams(
            projectId=self.project_id,
            assetId=self.asset_id,
            sentenceCacheKey=source.cache_key,
            sentenceIndex=0,
            markers=[*({"sentenceIndex": index, "issueType": "half-sentence", "status": "open", "source": "manual", "note": "boundary"} for index in range(0, 60, 3)), {"sentenceIndex": 1, "issueType": "low-confidence", "status": "resolved", "source": "manual"}],
        ))
        request = RerankParams(projectId=self.project_id, query="工厂招聘薪资", candidateLimit=20, limit=10)
        first = asyncio.run(self.project.rerank_sentences(request, asyncio.Event()))
        second = asyncio.run(self.project.rerank_sentences(request, asyncio.Event()))
        self.assertEqual(first.model_dump(), second.model_dump())
        self.assertEqual(first.rerank_version, "quality-rerank-v1")
        self.assertTrue(all(item.preview_uri.startswith("supervideo://asset/") for item in first.candidates))
        self.assertTrue(all(0 <= item.scores.final_score <= 1 for item in first.candidates))
        self.assertTrue(all(0 <= item.scores.visual_quality_score <= 1 and 0 <= item.scores.sentence_independence_score <= 1 for item in first.candidates))
        measured = asyncio.run(self.project.rerank_sentences(RerankParams(projectId=self.project_id, query="招聘", assetIds=[self.asset_id], candidateLimit=10, limit=1), asyncio.Event()))
        degraded = asyncio.run(self.project.rerank_sentences(RerankParams(projectId=self.project_id, query="招聘", assetIds=[self.second_asset_id], candidateLimit=10, limit=1), asyncio.Event()))
        self.assertEqual(measured.candidates[0].explanation.visual_quality_status, "measured")
        self.assertEqual(degraded.candidates[0].explanation.visual_quality_status, "degraded")
        self.assertTrue(any(item.explanation.qa_open_marker_count > 0 for item in first.candidates))
        review = asyncio.run(self.project.rerank_sentences(RerankParams(projectId=self.project_id, query="招聘", filters={"quality": "needs_review"}, candidateLimit=10, limit=1), asyncio.Event()))
        self.assertTrue(review.candidates and review.candidates[0].quality_status == "needs_review")
        self.assertTrue(any(item.scores.source_diversity_reward == 1 for item in first.candidates))
        self.assertTrue(any(item.scores.duplicate_penalty > 0 for item in first.candidates) or len({item.text for item in first.candidates}) == len(first.candidates))

    def test_bounded_config_and_limit(self) -> None:
        result = asyncio.run(self.project.rerank_sentences(RerankParams(projectId=self.project_id, query="招聘", candidateLimit=12, limit=3, config={"maxPerAsset": 1}), asyncio.Event()))
        self.assertLessEqual(len(result.candidates), 3)
        self.assertLessEqual(len({item.source_asset_id for item in result.candidates}), 3)
        with self.assertRaises(Exception):
            RerankParams(projectId=self.project_id, query="x", candidateLimit=3, limit=4)
        with self.assertRaises(Exception):
            RerankParams(projectId=self.project_id, query="x", candidateLimit=3, config={"weights": {"originalScore": 0.9, "narrationClarity": 0.9}})

    def test_corrupt_qa_and_stale_source_fail_stably(self) -> None:
        source = self.sources[0]
        self.project.save_sentence_qa(SentenceQaSaveParams(projectId=self.project_id, assetId=self.asset_id, sentenceCacheKey=source.cache_key, sentenceIndex=0, markers=[{"sentenceIndex": 0, "issueType": "other", "note": "review"}]))
        qa_path = self.project_root / "data" / "qa" / "sentence-qa-v1" / self.asset_id / f"{source.cache_key}.json"
        qa_value = json.loads(qa_path.read_text(encoding="utf-8"))
        qa_value["resultDigest"] = "0" * 64
        qa_path.write_text(json.dumps(qa_value), encoding="utf-8")
        with self.assertRaises(Exception) as error:
            asyncio.run(self.project.rerank_sentences(RerankParams(projectId=self.project_id, query="招聘"), asyncio.Event()))
        self.assertEqual(getattr(error.exception, "code", None), "RERANK_QA_STORAGE_INVALID")

        qa_path.unlink()
        source_path = self.project_root / "cache" / "sentence-cache-v1" / "sentences" / f"{source.cache_key}.json"
        source_value = json.loads(source_path.read_text(encoding="utf-8"))
        source_value["result"]["sentences"][0]["text"] = "过期来源"
        source_value["resultDigest"] = self._digest(source_value["result"])
        source_path.write_text(json.dumps(source_value, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(Exception) as stale:
            asyncio.run(self.project.rerank_sentences(RerankParams(projectId=self.project_id, query="招聘"), asyncio.Event()))
        self.assertIn(getattr(stale.exception, "code", None), {"RETRIEVAL_INDEX_STALE", "RERANK_SOURCE_STALE"})


if __name__ == "__main__":
    unittest.main()
