import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from supervideo_core.media.errors import MediaError
from supervideo_core.media.retrieval_models import RetrievalCandidate, RetrievalExplanation, RetrievalResult, RetrievalTimecode
from supervideo_core.media.slot_alignment import InformationSlotAlignmentService, extract_key_facts, split_information_slots
from supervideo_core.media.slot_alignment_models import SlotAlignmentParams


PROJECT_ID = "11111111-1111-4111-8111-111111111111"
OTHER_PROJECT_ID = "33333333-3333-4333-8333-333333333333"
ASSET_ID = "22222222-2222-4222-8222-222222222222"
OTHER_ASSET_ID = "44444444-4444-4444-8444-444444444444"
SOURCE_CACHE_KEY = "a" * 64


def retrieval_candidate(text: str, *, asset_id: str = ASSET_ID, project_id: str = PROJECT_ID) -> RetrievalCandidate:
    del project_id
    sentence_id = (text.encode("utf-8").hex() + "0" * 64)[:64]
    return RetrievalCandidate(
        rank=1,
        sentenceId=sentence_id,
        sourceAssetId=asset_id,
        sourceSentenceCacheKey=SOURCE_CACHE_KEY,
        sentenceIndex=0,
        timecode=RetrievalTimecode(startMs=0, endMs=1_000),
        text=text,
        lexicalScore=1.0,
        vectorScore=1.0,
        hybridScore=1.0,
        score=1.0,
        explanation=RetrievalExplanation(
            queryKeywords=["语句"],
            matchedKeywords=["语句"],
            matchedTopics=[],
            vectorProvider="sha256-hash-v1",
            scoreFormula="hybrid-0.6-0.4-v1",
        ),
        confidence=0.95,
        quality="complete",
        qualityReasons=[],
        previewUri=f"supervideo://asset/{asset_id}?kind=audio&startMs=0&endMs=1000",
    )


class FakeRetrieval:
    def __init__(self, candidates: list[RetrievalCandidate]) -> None:
        self.candidates = candidates
        self.queries: list[str] = []
        self.preserve_text = False

    def bind_session(self, _root: Path, _database: object) -> None:
        return

    def _resolve_assets(self, _request: object) -> dict[str, tuple[Path, object]]:
        return {ASSET_ID: (Path("C:/safe/reference.mp4"), object())}

    async def search(self, request: object, _cancelled: asyncio.Event) -> RetrievalResult:
        self.queries.append(request.query)
        candidates = [candidate if self.preserve_text else candidate.model_copy(update={"text": request.query}) for candidate in self.candidates]
        return RetrievalResult(
            schemaVersion=1,
            retrievalVersion="hybrid-retrieval-v1",
            projectId=PROJECT_ID,
            query=request.query,
            mode="hybrid",
            limit=request.limit,
            candidateCount=len(candidates),
            candidates=candidates,
        )


class FakeRerank:
    def __init__(self, retrieval: FakeRetrieval) -> None:
        self.retrieval = retrieval
        self.queries: list[str] = []

    def bind_session(self, _root: Path, _database: object) -> None:
        return

    async def rerank(self, request: object, _cancelled: asyncio.Event) -> object:
        from supervideo_core.media.rerank_models import RerankCandidate, RerankExplanation, RerankResult, RerankScores

        self.queries.append(request.query)
        source = self.retrieval.candidates[0].model_copy(update={"text": request.query})
        candidate = RerankCandidate(
            rank=1,
            retrievalRank=1,
            sentenceId=source.sentence_id,
            sourceAssetId=source.source_asset_id,
            sourceSentenceCacheKey=source.source_sentence_cache_key,
            sentenceIndex=0,
            timecode={"startMs": 0, "endMs": 1_000},
            text=request.query,
            quality="complete",
            qualityStatus="complete",
            qualityReasons=[],
            previewUri=source.preview_uri,
            scores=RerankScores(
                originalScore=1.0, narrationClarityScore=1.0, narrationQualityScore=1.0,
                visualQualityScore=1.0, sentenceCompletenessScore=1.0, sentenceIndependenceScore=1.0,
                qaScore=1.0, duplicatePenalty=0.0, sourceDiversityReward=1.0, finalScore=1.0,
            ),
            explanation=RerankExplanation(
                reasons=["complete"], qaOpenMarkerCount=0, qaIssueTypes=[], duplicateOfSentenceId=None,
                selectedSourceAssetCount=1, visualQualityStatus="degraded", visualQualityReason="test",
            ),
        )
        return RerankResult(
            schemaVersion=1, rerankVersion="quality-rerank-v1", projectId=PROJECT_ID,
            query=request.query, mode="hybrid", candidateLimit=request.candidate_limit,
            limit=request.limit, candidateCount=1, candidates=[candidate],
        )


class SlotAlignmentTests(unittest.TestCase):
    def setUp(self) -> None:
        retrieval = FakeRetrieval([retrieval_candidate("占位")])
        self.retrieval = retrieval
        self.rerank = FakeRerank(retrieval)
        self.service = InformationSlotAlignmentService(retrieval, self.rerank)
        self.service.bind_session(Path("C:/safe/project"), object())

    def test_privacy_safe_fixture_has_at_least_fifty_deterministic_cases(self) -> None:
        fixture_path = Path(__file__).parents[3] / "tests" / "fixtures" / "b10_slot_alignment_regression_v1.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(fixture["cases"]), 50)
        for case in fixture["cases"]:
            slots = split_information_slots(case["inputText"])
            self.assertEqual(len(slots), case["expectedSlotCount"])
            self.assertEqual(extract_key_facts(case["inputText"]), case["facts"])

    def test_alignment_is_ordered_and_preserves_input_and_facts(self) -> None:
        text = "开头介绍岗位。月薪 8 千元，地点在上海。"
        result = asyncio.run(self.service.align(SlotAlignmentParams(projectId=PROJECT_ID, inputText=text, useRerank=False), asyncio.Event()))
        self.assertEqual(result.input_text, text)
        self.assertEqual(result.slot_count, 2)
        self.assertEqual([slot.order for slot in result.slots], [1, 2])
        self.assertEqual(result.slots[1].key_facts, ["8 千元"])
        self.assertEqual(result.slots[1].candidates[0].text, result.slots[1].source_text)
        self.assertEqual(self.retrieval.queries, [slot.query for slot in result.slots])

    def test_optional_b09_origin_is_bound_and_used_per_slot(self) -> None:
        result = asyncio.run(self.service.align(SlotAlignmentParams(projectId=PROJECT_ID, inputText="岗位介绍。报名联系。", useRerank=True), asyncio.Event()))
        self.assertTrue(all(slot.candidates[0].origin == "b09-quality-rerank" for slot in result.slots))
        self.assertEqual(self.rerank.queries, [slot.query for slot in result.slots])

    def test_empty_results_are_stable_gaps(self) -> None:
        self.retrieval.candidates = []
        result = asyncio.run(self.service.align(SlotAlignmentParams(projectId=PROJECT_ID, inputText="第一句。第二句。", useRerank=False), asyncio.Event()))
        self.assertEqual([slot.status for slot in result.slots], ["gap", "gap"])
        self.assertEqual([slot.gap_reason for slot in result.slots], ["no-retrieval-candidates", "no-retrieval-candidates"])

    def test_fact_mismatch_is_a_gap_and_never_rewritten(self) -> None:
        self.retrieval.preserve_text = True
        for source_text, input_text in (
            ("工资 17000 元", "工资 7000 元。"),
            ("月薪 18 千元", "月薪 8 千元。"),
            ("欢迎使用 SuperVideoPro", "欢迎使用 SuperVideo。"),
        ):
            self.retrieval.candidates = [retrieval_candidate(source_text)]
            result = asyncio.run(self.service.align(SlotAlignmentParams(projectId=PROJECT_ID, inputText=input_text, useRerank=False), asyncio.Event()))
            self.assertEqual(result.slots[0].status, "gap", source_text)
            self.assertEqual(result.slots[0].gap_reason, "key-facts-not-preserved", source_text)

    def test_cross_project_source_is_rejected(self) -> None:
        self.retrieval._resolve_assets = lambda _request: {OTHER_ASSET_ID: (Path("C:/other/reference.mp4"), object())}  # type: ignore[method-assign]
        with self.assertRaises(MediaError) as context:
            asyncio.run(self.service.align(SlotAlignmentParams(projectId=PROJECT_ID, inputText="一句话。", useRerank=False), asyncio.Event()))
        self.assertEqual(context.exception.code, "SLOT_SOURCE_INVALID")

    def test_cancel_and_malicious_bounds_have_stable_errors(self) -> None:
        cancelled = asyncio.Event()
        cancelled.set()
        with self.assertRaises(MediaError) as context:
            asyncio.run(self.service.align(SlotAlignmentParams(projectId=PROJECT_ID, inputText="一句话。", useRerank=False), cancelled))
        self.assertEqual(context.exception.code, "SLOT_CANCELLED")
        with self.assertRaises(MediaError) as context:
            asyncio.run(self.service.align(SlotAlignmentParams(projectId=PROJECT_ID, inputText="x" * 513, useRerank=False), asyncio.Event()))
        self.assertEqual(context.exception.code, "SLOT_INPUT_INVALID")


if __name__ == "__main__":
    unittest.main()
