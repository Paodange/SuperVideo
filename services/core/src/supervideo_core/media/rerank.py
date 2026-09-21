"""B09 deterministic quality reranking over audited B08 candidates."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from supervideo_core.storage import AssetRepository

from .errors import MediaError
from .qa import SentenceQaService
from .qa_models import SentenceQaParams
from .retrieval import SentenceRetrievalService
from .retrieval_models import RetrievalParams, RetrievalResult
from .rerank_models import (
    RERANK_SCHEMA_VERSION,
    RERANK_VERSION,
    RerankCandidate,
    RerankConfig,
    RerankExplanation,
    RerankParams,
    RerankResult,
    RerankScores,
    validate_rerank_size,
)


_ISSUE_PENALTY = {
    "missing-text": 0.45,
    "half-sentence": 0.35,
    "low-confidence": 0.20,
    "boundary-uncertain": 0.15,
    "other": 0.10,
}
_TOKEN = re.compile(r"[a-z0-9]+|[\u4e00-\u9fff]")


class SentenceQualityRerankService:
    """Rerank only trusted B08 output; callers cannot provide paths or sources."""

    def __init__(self, retrieval_service: SentenceRetrievalService | None = None, qa_service: SentenceQaService | None = None) -> None:
        self._project_root: Path | None = None
        self._database: Any | None = None
        self.retrieval_service = retrieval_service or SentenceRetrievalService()
        self.qa_service = qa_service or SentenceQaService()

    def bind_session(self, project_root: Path, database: Any) -> None:
        self._project_root = project_root
        self._database = database
        self.retrieval_service.bind_session(project_root, database)
        self.qa_service.bind_session(project_root, database)

    async def rerank(self, request: RerankParams, cancelled: asyncio.Event) -> RerankResult:
        from supervideo_core.project.errors import ProjectError

        if self._project_root is None or self._database is None:
            raise ProjectError("PROJECT_NOT_ACTIVE")
        if cancelled.is_set():
            raise MediaError("RERANK_CANCELLED")
        retrieval_request = RetrievalParams(
            projectId=request.project_id,
            query=request.query,
            mode=request.mode,
            assetIds=request.asset_ids,
            limit=request.candidate_limit,
            filters=request.filters,
            timeoutMs=request.timeout_ms,
        )
        retrieval = await self.retrieval_service.search(retrieval_request, cancelled)
        if cancelled.is_set():
            raise MediaError("RERANK_CANCELLED")
        try:
            assets = self.retrieval_service._resolve_assets(retrieval_request)
            audited = self._audit_sources(retrieval, assets, request)
            return self._rank(request, audited)
        except (MediaError, ProjectError, asyncio.CancelledError):
            raise
        except Exception as error:
            raise MediaError("RERANK_OUTPUT_INVALID", cause=error) from error

    def _audit_sources(self, retrieval: RetrievalResult, assets: dict[str, tuple[Path, Any]], request: RerankParams) -> list[tuple[Any, list[Any]]]:
        if retrieval.project_id != request.project_id or retrieval.query != request.query or retrieval.mode != request.mode:
            raise MediaError("RERANK_RETRIEVAL_INVALID")
        audited: list[tuple[Any, list[Any]]] = []
        marker_cache: dict[tuple[str, str], list[Any]] = {}
        source_cache: dict[tuple[str, str], Any] = {}
        for candidate in retrieval.candidates:
            key = (candidate.source_asset_id, candidate.source_sentence_cache_key)
            asset_pair = assets.get(candidate.source_asset_id)
            if asset_pair is None:
                raise MediaError("RERANK_RETRIEVAL_INVALID")
            asset_path, asset_record = asset_pair
            source = source_cache.get(key)
            if source is None:
                qa_request = SentenceQaParams(
                    projectId=request.project_id,
                    assetId=candidate.source_asset_id,
                    sentenceCacheKey=candidate.source_sentence_cache_key,
                    sentenceIndex=candidate.sentence_index,
                )
                try:
                    source = self.qa_service._read_sentence_result(self._project_root_required(), qa_request)
                    self.qa_service._ensure_asset_unchanged(candidate.source_asset_id, asset_path, asset_record)
                    source_cache[key] = source
                except MediaError as error:
                    if error.code in {"SENTENCE_QA_RESULT_NOT_FOUND", "SENTENCE_QA_RESULT_INVALID"}:
                        raise MediaError("RERANK_SOURCE_INVALID", cause=error) from error
                    raise
            if candidate.sentence_index >= len(source.sentences):
                raise MediaError("RERANK_SOURCE_INVALID")
            sentence = source.sentences[candidate.sentence_index]
            if (
                source.project_id != request.project_id
                or source.asset_id != candidate.source_asset_id
                or source.cache_key != candidate.source_sentence_cache_key
                or sentence.source_asset_id != candidate.source_asset_id
                or sentence.text != candidate.text
                or sentence.start_ms != candidate.timecode.start_ms
                or sentence.end_ms != candidate.timecode.end_ms
            ):
                raise MediaError("RERANK_SOURCE_STALE")
            if key not in marker_cache:
                try:
                    marker_cache[key] = self.qa_service._read_markers(self._project_root_required(), SentenceQaParams(
                        projectId=request.project_id,
                        assetId=candidate.source_asset_id,
                        sentenceCacheKey=candidate.source_sentence_cache_key,
                        sentenceIndex=candidate.sentence_index,
                    ))
                except MediaError as error:
                    if error.code == "SENTENCE_QA_STORAGE_INVALID":
                        raise MediaError("RERANK_QA_STORAGE_INVALID", cause=error) from error
                    raise
            sentence_markers = [item for item in marker_cache[key] if item.sentence_index == candidate.sentence_index and item.status == "open"]
            audited.append((candidate, sentence_markers))
        return audited

    def _rank(self, request: RerankParams, audited: list[tuple[Any, list[Any]]]) -> RerankResult:
        config = request.config
        remaining = list(audited)
        selected: list[tuple[Any, list[Any], float, float, float, str | None]] = []
        asset_counts: dict[str, int] = {}
        while remaining and len(selected) < request.limit:
            options: list[tuple[float, tuple[Any, list[Any], float, float, float, str | None]]] = []
            for candidate, markers in remaining:
                if asset_counts.get(candidate.source_asset_id, 0) >= config.max_per_asset:
                    continue
                duplicate_penalty, duplicate_of = self._duplicate_penalty(candidate.text, selected, config)
                diversity = 1.0 if candidate.source_asset_id not in asset_counts else 0.0
                clarity, completeness, qa_score = self._quality_scores(candidate, markers)
                weights = config.weights
                base = (
                    candidate.score * weights.original_score
                    + clarity * weights.narration_clarity
                    + completeness * weights.sentence_completeness
                    + qa_score * weights.qa_quality
                    + diversity * weights.source_diversity
                )
                final = max(0.0, min(1.0, round(base - duplicate_penalty * config.duplicate_penalty + diversity * config.diversity_reward, 8)))
                options.append((final, (candidate, markers, clarity, qa_score, diversity, duplicate_of)))
            if not options:
                break
            _final, chosen = max(options, key=lambda item: (item[0], -item[1][0].rank, item[1][0].sentence_id))
            remaining.remove((chosen[0], chosen[1]))
            selected.append((*chosen[:2], _final, chosen[3], chosen[4], chosen[5]))
            asset_counts[chosen[0].source_asset_id] = asset_counts.get(chosen[0].source_asset_id, 0) + 1

        results: list[RerankCandidate] = []
        for rank, (candidate, markers, _selected_final, qa_score, diversity, duplicate_of) in enumerate(selected, start=1):
            duplicate_penalty = self._duplicate_penalty(candidate.text, selected[: rank - 1], config)[0]
            clarity, completeness, _qa = self._quality_scores(candidate, markers)
            final = self._final_score(candidate.score, clarity, completeness, qa_score, diversity, duplicate_penalty, config)
            reasons = self._reasons(candidate, markers, clarity, completeness, qa_score, duplicate_penalty, diversity)
            issue_types = sorted({item.issue_type for item in markers})
            try:
                results.append(RerankCandidate(
                    rank=rank,
                    retrievalRank=candidate.rank,
                    sentenceId=candidate.sentence_id,
                    sourceAssetId=candidate.source_asset_id,
                    sourceSentenceCacheKey=candidate.source_sentence_cache_key,
                    sentenceIndex=candidate.sentence_index,
                    timecode={"startMs": candidate.timecode.start_ms, "endMs": candidate.timecode.end_ms},
                    text=candidate.text,
                    quality=candidate.quality,
                    qualityStatus=candidate.quality,
                    qualityReasons=list(candidate.quality_reasons),
                    previewUri=candidate.preview_uri,
                    scores=RerankScores(
                        originalScore=round(candidate.score, 8),
                        narrationClarityScore=round(clarity, 8),
                        narrationQualityScore=round(clarity * (0.8 if candidate.quality == "complete" else 0.5), 8),
                        sentenceCompletenessScore=round(completeness, 8),
                        qaScore=round(qa_score, 8),
                        duplicatePenalty=round(duplicate_penalty, 8),
                        sourceDiversityReward=round(diversity, 8),
                        finalScore=final,
                    ),
                    explanation=RerankExplanation(
                        reasons=reasons,
                        qaOpenMarkerCount=len(markers),
                        qaIssueTypes=issue_types,
                        duplicateOfSentenceId=duplicate_of,
                        selectedSourceAssetCount=len(asset_counts),
                    ),
                ))
            except (TypeError, ValueError, ValidationError) as error:
                raise MediaError("RERANK_OUTPUT_INVALID", cause=error) from error
        try:
            return validate_rerank_size(RerankResult(
                schemaVersion=RERANK_SCHEMA_VERSION,
                rerankVersion=RERANK_VERSION,
                projectId=request.project_id,
                query=request.query,
                mode=request.mode,
                candidateLimit=request.candidate_limit,
                limit=request.limit,
                candidateCount=len(results),
                candidates=results,
            ))
        except (TypeError, ValueError, ValidationError) as error:
            raise MediaError("RERANK_OUTPUT_INVALID", cause=error) from error

    @staticmethod
    def _quality_scores(candidate: Any, markers: list[Any]) -> tuple[float, float, float]:
        clarity = candidate.confidence if candidate.confidence is not None else 0.5
        completeness = 1.0 if candidate.quality == "complete" else 0.0
        qa_score = max(0.0, 1.0 - min(1.0, sum(_ISSUE_PENALTY.get(item.issue_type, 0.1) for item in markers if item.status == "open")))
        return round(clarity, 8), completeness, round(qa_score, 8)

    @classmethod
    def _final_score(cls, original: float, clarity: float, completeness: float, qa_score: float, diversity: float, duplicate_penalty: float, config: RerankConfig) -> float:
        weights = config.weights
        value = original * weights.original_score + clarity * weights.narration_clarity + completeness * weights.sentence_completeness + qa_score * weights.qa_quality + diversity * weights.source_diversity
        return max(0.0, min(1.0, round(value - duplicate_penalty * config.duplicate_penalty + diversity * config.diversity_reward, 8)))

    @classmethod
    def _duplicate_penalty(cls, text: str, selected: list[tuple[Any, list[Any], float, float, float, str | None]], config: RerankConfig) -> tuple[float, str | None]:
        best = 0.0
        duplicate_of: str | None = None
        for item in selected:
            similarity = cls._text_similarity(text, item[0].text)
            if similarity >= config.duplicate_threshold and (similarity > best or (similarity == best and item[0].sentence_id < (duplicate_of or "~"))):
                best, duplicate_of = similarity, item[0].sentence_id
        return round(best, 8), duplicate_of

    @staticmethod
    def _text_similarity(left: str, right: str) -> float:
        def tokens(value: str) -> set[str]:
            normalized = value.lower()
            return set(_TOKEN.findall(normalized))
        left_tokens, right_tokens = tokens(left), tokens(right)
        if left_tokens == right_tokens:
            return 1.0
        union = left_tokens | right_tokens
        return round(len(left_tokens & right_tokens) / len(union), 8) if union else 0.0

    @staticmethod
    def _reasons(candidate: Any, markers: list[Any], clarity: float, completeness: float, qa_score: float, duplicate_penalty: float, diversity: float) -> list[str]:
        reasons = ["high-original-score" if candidate.score >= 0.7 else "retrieval-supported"]
        reasons.append("clear-narration" if clarity >= 0.8 else "uncertain-narration")
        reasons.append("complete-sentence" if completeness == 1 else "sentence-needs-review")
        reasons.append("qa-clean" if qa_score >= 1 else "qa-open-marker")
        reasons.append("new-source-asset" if diversity else "same-source-asset")
        if duplicate_penalty > 0:
            reasons.append("duplicate-penalty")
        return reasons[:8]

    def _project_root_required(self) -> Path:
        if self._project_root is None:
            raise MediaError("RERANK_SOURCE_INVALID")
        return self._project_root
