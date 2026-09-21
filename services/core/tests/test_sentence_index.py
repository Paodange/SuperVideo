from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from supervideo_core.media.index import SentenceIndexService
from supervideo_core.media.index_models import SentenceIndexParams
from supervideo_core.media.sentence_models import SentenceCandidate, SentenceConfig, SentenceResult, validate_sentence_result_size
from supervideo_core.media.sentences import SentenceService
from supervideo_core.project import AssetReferenceRequest, ProjectCreateRequest, ProjectService
from supervideo_core.project.paths import canonical_asset_path


class SentenceIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_root = Path(tempfile.mkdtemp(prefix="supervideo sentence index "))
        self.asset_path = self.temp_root / "voice.mp4"
        self.asset_path.write_bytes(b"stable sentence index fixture")
        project_root = self.temp_root / "project"
        project_root.mkdir()
        self.project = ProjectService()
        summary = self.project.create(ProjectCreateRequest(name="Sentence index", targetPlatform="douyin", projectRoot=str(project_root)))
        reference = self.project.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(self.asset_path)]))
        self.project_id = summary.project_id
        self.asset_id = reference.items[0].asset_id
        self.project_root = project_root

    def tearDown(self) -> None:
        self.project.close()
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def _write_b05(self, config: SentenceConfig, *, changed_index: int | None = None) -> SentenceResult:
        sentences = []
        for index in range(60):
            text = f"这是用于句级索引回归的招聘样本第{index + 1}句。"
            if index == changed_index:
                text = "这是用于句级索引回归的技术样本第11句。"
            sentences.append(SentenceCandidate(
                index=index,
                sourceAssetId=self.asset_id,
                startMs=index * 1_000,
                endMs=index * 1_000 + 700,
                text=text,
                confidence=0.95,
                quality="complete",
                qualityReasons=[],
                sourceSegmentIndexes=[index],
            ))
        canonical_path, _ = canonical_asset_path(str(self.asset_path))
        signature, fingerprint = SentenceService._asset_signature(canonical_path)
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
        value = result.model_dump(by_alias=True)
        target = self.project_root / "cache" / "sentence-cache-v1" / "sentences" / f"{cache_key}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"schemaVersion": 1, "cacheKey": cache_key, "resultDigest": self._digest(value), "result": value}, ensure_ascii=False), encoding="utf-8")
        return result

    @staticmethod
    def _digest(value: object) -> str:
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    def test_fixture_produces_auditable_keywords_topics_and_vectors_for_60_sentences(self) -> None:
        source = self._write_b05(SentenceConfig())
        params = SentenceIndexParams(projectId=self.project_id, assetId=self.asset_id, sentenceCacheKey=source.cache_key)
        result = asyncio.run(self.project.index_sentences(params, asyncio.Event()))
        self.assertEqual(result.index_version, "sentence-index-v1")
        self.assertEqual(len(result.entries), 60)
        self.assertEqual(result.rebuilt_count, 60)
        self.assertEqual(result.reused_count, 0)
        self.assertEqual(len(result.entries[0].vector), 32)
        self.assertTrue(result.entries[0].keywords)
        self.assertTrue(result.entries[0].topics)
        self.assertEqual(result.entries[0].source_sentence_cache_key, source.cache_key)
        self.assertEqual(result.entries[0].start_ms, 0)
        cached = asyncio.run(self.project.index_sentences(params, asyncio.Event()))
        self.assertEqual(cached.cache_status, "cache-hit")
        self.assertEqual(cached.entries[0].vector, result.entries[0].vector)

    def test_changed_sentence_result_cache_key_reuses_unchanged_entries(self) -> None:
        first = self._write_b05(SentenceConfig())
        first_index = asyncio.run(self.project.index_sentences(SentenceIndexParams(projectId=self.project_id, assetId=self.asset_id, sentenceCacheKey=first.cache_key), asyncio.Event()))
        second_config = SentenceConfig(maxSentenceMs=12_000)
        second = self._write_b05(second_config, changed_index=10)
        second_index = asyncio.run(self.project.index_sentences(SentenceIndexParams(projectId=self.project_id, assetId=self.asset_id, sentenceCacheKey=second.cache_key), asyncio.Event()))
        self.assertEqual(first_index.rebuilt_count, 60)
        self.assertEqual(second_index.reused_count, 59)
        self.assertEqual(second_index.rebuilt_count, 1)
        self.assertEqual(second_index.entries[0].vector, first_index.entries[0].vector)
        self.assertNotEqual(second_index.entries[10].text, first_index.entries[10].text)

    def test_tampered_b05_is_rejected_and_tampered_index_is_rebuilt(self) -> None:
        source = self._write_b05(SentenceConfig())
        params = SentenceIndexParams(projectId=self.project_id, assetId=self.asset_id, sentenceCacheKey=source.cache_key)
        result = asyncio.run(self.project.index_sentences(params, asyncio.Event()))
        index_path = self.project_root / "cache" / "sentence-index-v1" / "indexes" / f"{source.cache_key}.json"
        payload = json.loads(index_path.read_text(encoding="utf-8"))
        payload["result"]["entries"][0]["keywords"] = ["tampered"]
        index_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        rebuilt = asyncio.run(self.project.index_sentences(params, asyncio.Event()))
        self.assertEqual(rebuilt.cache_status, "created")
        self.assertEqual(rebuilt.entries[0].keywords, result.entries[0].keywords)

        b05_path = self.project_root / "cache" / "sentence-cache-v1" / "sentences" / f"{source.cache_key}.json"
        b05_payload = json.loads(b05_path.read_text(encoding="utf-8"))
        b05_payload["result"]["sentences"][0]["text"] = "篡改后的句子。"
        b05_path.write_text(json.dumps(b05_payload, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(Exception) as error:
            asyncio.run(self.project.index_sentences(params, asyncio.Event()))
        self.assertEqual(getattr(error.exception, "code", None), "SENTENCE_INDEX_SOURCE_INVALID")

    def test_project_identity_is_not_cross_project(self) -> None:
        source = self._write_b05(SentenceConfig())
        other_root = self.temp_root / "other-project"
        other_root.mkdir()
        other = ProjectService()
        try:
            summary = other.create(ProjectCreateRequest(name="Other", targetPlatform="douyin", projectRoot=str(other_root)))
            with self.assertRaises(Exception) as error:
                asyncio.run(other.index_sentences(SentenceIndexParams(projectId=summary.project_id, assetId=self.asset_id, sentenceCacheKey=source.cache_key), asyncio.Event()))
            self.assertEqual(getattr(error.exception, "code", None), "ASSET_NOT_FOUND")
        finally:
            other.close()


if __name__ == "__main__":
    unittest.main()
