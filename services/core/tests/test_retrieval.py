from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from supervideo_core.media.index_models import SentenceIndexParams
from supervideo_core.media.retrieval import SentenceRetrievalService
from supervideo_core.media.retrieval_models import RetrievalParams
from supervideo_core.media.sentence_models import SentenceCandidate, SentenceConfig, SentenceResult, validate_sentence_result_size
from supervideo_core.media.sentences import SentenceService
from supervideo_core.project import AssetReferenceRequest, ProjectCreateRequest, ProjectService
from supervideo_core.project.paths import canonical_asset_path


class SentenceRetrievalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_root = Path(tempfile.mkdtemp(prefix="supervideo retrieval "))
        self.asset_path = self.temp_root / "voice.mp4"
        self.asset_path.write_bytes(b"stable retrieval fixture")
        project_root = self.temp_root / "project"
        project_root.mkdir()
        self.project = ProjectService()
        summary = self.project.create(ProjectCreateRequest(name="Retrieval", targetPlatform="douyin", projectRoot=str(project_root)))
        reference = self.project.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(self.asset_path)]))
        self.project_id = summary.project_id
        self.asset_id = reference.items[0].asset_id
        self.project_root = project_root

    def tearDown(self) -> None:
        self.project.close()
        shutil.rmtree(self.temp_root, ignore_errors=True)

    @staticmethod
    def _digest(value: object) -> str:
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    def _write_b05(self) -> SentenceResult:
        texts = []
        for index in range(60):
            if index % 3 == 0:
                text = f"工厂招聘岗位第{index + 1}句，薪资和福利需要提前确认。"
            elif index % 3 == 1:
                text = f"求职面试第{index + 1}句，准备简历和工作经验。"
            else:
                text = f"视频剪辑第{index + 1}句，素材和字幕要保持完整。"
            texts.append(text)
        sentences = [SentenceCandidate(
            index=index,
            sourceAssetId=self.asset_id,
            startMs=index * 1_000,
            endMs=index * 1_000 + 700,
            text=text,
            confidence=0.95,
            quality="complete",
            qualityReasons=[],
            sourceSegmentIndexes=[index],
        ) for index, text in enumerate(texts)]
        canonical_path, _ = canonical_asset_path(str(self.asset_path))
        signature, fingerprint = SentenceService._asset_signature(canonical_path)
        config = SentenceConfig()
        cache_key = SentenceService._cache_key(self.project_id, canonical_path, signature, fingerprint, config)
        result = validate_sentence_result_size(SentenceResult(
            schemaVersion=1,
            projectId=self.project_id,
            assetId=self.asset_id,
            cacheStatus="created",
            cacheKey=cache_key,
            adapterVersion="sentence-segmentation-v1",
            durationMs=60_000,
            config=config,
            sentences=sentences,
        ))
        target = self.project_root / "cache" / "sentence-cache-v1" / "sentences" / f"{cache_key}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        value = result.model_dump(by_alias=True)
        target.write_text(json.dumps({"schemaVersion": 1, "cacheKey": cache_key, "resultDigest": self._digest(value), "result": value}, ensure_ascii=False), encoding="utf-8")
        return result

    def _index(self) -> SentenceResult:
        source = self._write_b05()
        asyncio.run(self.project.index_sentences(SentenceIndexParams(projectId=self.project_id, assetId=self.asset_id, sentenceCacheKey=source.cache_key), asyncio.Event()))
        return source

    def test_lexical_vector_and_hybrid_are_deterministic_and_auditable(self) -> None:
        source = self._index()
        lexical = asyncio.run(self.project.retrieve_sentences(RetrievalParams(projectId=self.project_id, query="工厂招聘薪资", mode="lexical", limit=10), asyncio.Event()))
        vector = asyncio.run(self.project.retrieve_sentences(RetrievalParams(projectId=self.project_id, query="工厂招聘薪资", mode="vector", limit=10), asyncio.Event()))
        hybrid = asyncio.run(self.project.retrieve_sentences(RetrievalParams(projectId=self.project_id, query="工厂招聘薪资", mode="hybrid", limit=10), asyncio.Event()))
        self.assertEqual(len(lexical.candidates), 10)
        self.assertEqual(lexical.candidates[0].quality, "complete")
        self.assertTrue(any(item.explanation.matched_keywords for item in lexical.candidates))
        self.assertEqual(lexical.candidates[0].score, lexical.candidates[0].lexical_score)
        self.assertEqual(vector.candidates[0].score, vector.candidates[0].vector_score)
        self.assertEqual(hybrid.candidates[0].score, hybrid.candidates[0].hybrid_score)
        self.assertEqual(hybrid.candidates[0].source_sentence_cache_key, source.cache_key)
        self.assertTrue(hybrid.candidates[0].preview_uri.startswith("supervideo://asset/"))
        again = asyncio.run(self.project.retrieve_sentences(RetrievalParams(projectId=self.project_id, query="工厂招聘薪资", limit=10), asyncio.Event()))
        self.assertEqual(hybrid.model_dump(), again.model_dump())

    def test_limit_and_metadata_filters_are_bounded(self) -> None:
        self._index()
        result = asyncio.run(self.project.retrieve_sentences(RetrievalParams(
            projectId=self.project_id,
            query="招聘",
            limit=50,
            filters={"topics": ["招聘就业"], "quality": "complete", "minConfidence": 0.9, "startMs": 0, "endMs": 20_000},
        ), asyncio.Event()))
        self.assertLessEqual(len(result.candidates), 20)
        self.assertTrue(all("招聘就业" in item.explanation.matched_topics or "招聘" in item.text for item in result.candidates))
        with self.assertRaises(Exception):
            RetrievalParams(projectId=self.project_id, query="x", limit=51)

    def test_project_isolation_and_tamper_or_stale_index_fail_stably(self) -> None:
        source = self._index()
        index_path = self.project_root / "cache" / "sentence-index-v1" / "indexes" / f"{source.cache_key}.json"
        payload = json.loads(index_path.read_text(encoding="utf-8"))
        payload["result"]["entries"][0]["text"] = "篡改"
        index_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(Exception) as tampered:
            asyncio.run(self.project.retrieve_sentences(RetrievalParams(projectId=self.project_id, query="招聘"), asyncio.Event()))
        self.assertEqual(getattr(tampered.exception, "code", None), "RETRIEVAL_INDEX_INVALID")

        self._index()
        b05_path = self.project_root / "cache" / "sentence-cache-v1" / "sentences" / f"{source.cache_key}.json"
        b05_payload = json.loads(b05_path.read_text(encoding="utf-8"))
        b05_payload["result"]["sentences"][0]["text"] = "过期来源"
        b05_payload["resultDigest"] = self._digest(b05_payload["result"])
        b05_path.write_text(json.dumps(b05_payload, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(Exception) as stale:
            asyncio.run(self.project.retrieve_sentences(RetrievalParams(projectId=self.project_id, query="招聘"), asyncio.Event()))
        self.assertEqual(getattr(stale.exception, "code", None), "RETRIEVAL_INDEX_STALE")

        other_root = self.temp_root / "other"
        other_root.mkdir()
        other = ProjectService()
        try:
            other_summary = other.create(ProjectCreateRequest(name="Other", targetPlatform="douyin", projectRoot=str(other_root)))
            with self.assertRaises(Exception) as isolated:
                asyncio.run(other.retrieve_sentences(RetrievalParams(projectId=other_summary.project_id, query="招聘"), asyncio.Event()))
            self.assertEqual(getattr(isolated.exception, "code", None), "RETRIEVAL_INDEX_NOT_FOUND")
        finally:
            other.close()


if __name__ == "__main__":
    unittest.main()
