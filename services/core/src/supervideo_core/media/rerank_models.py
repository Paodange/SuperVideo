"""Versioned, bounded contracts for deterministic B09 quality reranking."""

from __future__ import annotations

import math
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .index_models import SENTENCE_INDEX_MAX_TEXT_LENGTH
from .retrieval_models import RetrievalFilters

RERANK_SCHEMA_VERSION = 1
RERANK_VERSION = "quality-rerank-v1"
RERANK_MAX_QUERY_LENGTH = 512
RERANK_MAX_ASSETS = 100
RERANK_MAX_CANDIDATES = 50
RERANK_MAX_LIMIT = 50
RERANK_MAX_REASON_LENGTH = 96
RERANK_MAX_REASONS = 8
RERANK_MAX_RESULT_BYTES = 60 * 1024


class RerankModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def _validate_id(value: str) -> str:
    if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
        raise ValueError("invalid rerank identity")
    return value


def _validate_digest(value: str) -> str:
    if re.fullmatch(r"^[0-9a-f]{64}$", value) is None:
        raise ValueError("invalid rerank digest")
    return value


def _validate_text(value: str, maximum: int) -> str:
    if not value.strip() or any(ord(char) < 32 for char in value) or len(value) > maximum:
        raise ValueError("invalid rerank text")
    return value


class RerankWeights(RerankModel):
    original_score: float = Field(default=0.45, alias="originalScore", strict=True, ge=0, le=1)
    narration_clarity: float = Field(default=0.20, alias="narrationClarity", strict=True, ge=0, le=1)
    sentence_completeness: float = Field(default=0.15, alias="sentenceCompleteness", strict=True, ge=0, le=1)
    qa_quality: float = Field(default=0.15, alias="qaQuality", strict=True, ge=0, le=1)
    source_diversity: float = Field(default=0.05, alias="sourceDiversity", strict=True, ge=0, le=1)

    @model_validator(mode="after")
    def validate_total(self) -> "RerankWeights":
        total = self.original_score + self.narration_clarity + self.sentence_completeness + self.qa_quality + self.source_diversity
        if not math.isfinite(total) or total <= 0:
            raise ValueError("rerank weights must sum to a positive value")
        return self


class RerankConfig(RerankModel):
    weights: RerankWeights = Field(default_factory=RerankWeights)
    duplicate_penalty: float = Field(default=0.30, alias="duplicatePenalty", strict=True, ge=0, le=1)
    diversity_reward: float = Field(default=0.10, alias="diversityReward", strict=True, ge=0, le=1)
    duplicate_threshold: float = Field(default=0.75, alias="duplicateThreshold", strict=True, ge=0, le=1)
    max_per_asset: int = Field(default=RERANK_MAX_CANDIDATES, alias="maxPerAsset", strict=True, ge=1, le=RERANK_MAX_CANDIDATES)


class RerankParams(RerankModel):
    project_id: str = Field(alias="projectId")
    query: str = Field(min_length=1, max_length=RERANK_MAX_QUERY_LENGTH)
    mode: Literal["lexical", "vector", "hybrid"] = "hybrid"
    asset_ids: list[str] | None = Field(default=None, alias="assetIds", max_length=RERANK_MAX_ASSETS)
    filters: RetrievalFilters = Field(default_factory=RetrievalFilters)
    candidate_limit: int = Field(default=20, alias="candidateLimit", strict=True, ge=1, le=RERANK_MAX_CANDIDATES)
    limit: int = Field(default=10, strict=True, ge=1, le=RERANK_MAX_LIMIT)
    config: RerankConfig = Field(default_factory=RerankConfig)
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    _validate_project_id = field_validator("project_id")(_validate_id)

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        return _validate_text(value, RERANK_MAX_QUERY_LENGTH)

    @field_validator("asset_ids")
    @classmethod
    def validate_asset_ids(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        if len(value) != len(set(value)):
            raise ValueError("rerank assets must be unique")
        return [_validate_id(item) for item in value]

    @model_validator(mode="after")
    def validate_limits(self) -> "RerankParams":
        if self.limit > self.candidate_limit:
            raise ValueError("rerank limit cannot exceed candidate limit")
        return self


class RerankScores(RerankModel):
    original_score: float = Field(alias="originalScore", strict=True, ge=0, le=1)
    narration_clarity_score: float = Field(alias="narrationClarityScore", strict=True, ge=0, le=1)
    narration_quality_score: float = Field(alias="narrationQualityScore", strict=True, ge=0, le=1)
    sentence_completeness_score: float = Field(alias="sentenceCompletenessScore", strict=True, ge=0, le=1)
    qa_score: float = Field(alias="qaScore", strict=True, ge=0, le=1)
    duplicate_penalty: float = Field(alias="duplicatePenalty", strict=True, ge=0, le=1)
    source_diversity_reward: float = Field(alias="sourceDiversityReward", strict=True, ge=0, le=1)
    final_score: float = Field(alias="finalScore", strict=True, ge=0, le=1)


class RerankExplanation(RerankModel):
    reasons: list[str] = Field(max_length=RERANK_MAX_REASONS)
    qa_open_marker_count: int = Field(alias="qaOpenMarkerCount", strict=True, ge=0, le=500)
    qa_issue_types: list[str] = Field(alias="qaIssueTypes", max_length=5)
    duplicate_of_sentence_id: str | None = Field(default=None, alias="duplicateOfSentenceId")
    selected_source_asset_count: int = Field(alias="selectedSourceAssetCount", strict=True, ge=1, le=RERANK_MAX_LIMIT)

    @field_validator("reasons")
    @classmethod
    def validate_reasons(cls, value: list[str]) -> list[str]:
        if any(not item.strip() or any(ord(char) < 32 for char in item) or len(item) > RERANK_MAX_REASON_LENGTH for item in value):
            raise ValueError("invalid rerank explanation")
        if len(value) != len(set(value)):
            raise ValueError("rerank explanation labels must be unique")
        return value

    @field_validator("qa_issue_types")
    @classmethod
    def validate_issue_types(cls, value: list[str]) -> list[str]:
        if any(not item.strip() or any(ord(char) < 32 for char in item) or len(item) > 64 for item in value):
            raise ValueError("invalid rerank issue types")
        if len(value) != len(set(value)):
            raise ValueError("rerank issue types must be unique")
        return value

    @field_validator("duplicate_of_sentence_id")
    @classmethod
    def validate_duplicate_id(cls, value: str | None) -> str | None:
        return None if value is None else _validate_digest(value)


class RerankTimecode(RerankModel):
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=86_400_000)
    end_ms: int = Field(alias="endMs", strict=True, ge=1, le=86_400_000)

    @model_validator(mode="after")
    def validate_duration(self) -> "RerankTimecode":
        if self.end_ms <= self.start_ms:
            raise ValueError("rerank timecode must have positive duration")
        return self


class RerankCandidate(RerankModel):
    rank: int = Field(strict=True, ge=1, le=RERANK_MAX_LIMIT)
    retrieval_rank: int = Field(alias="retrievalRank", strict=True, ge=1, le=RERANK_MAX_CANDIDATES)
    sentence_id: str = Field(alias="sentenceId", min_length=64, max_length=64)
    source_asset_id: str = Field(alias="sourceAssetId")
    source_sentence_cache_key: str = Field(alias="sourceSentenceCacheKey", min_length=64, max_length=64)
    sentence_index: int = Field(alias="sentenceIndex", strict=True, ge=0, lt=2_000)
    timecode: RerankTimecode
    text: str = Field(min_length=1, max_length=SENTENCE_INDEX_MAX_TEXT_LENGTH)
    quality: Literal["complete", "needs_review"]
    quality_status: Literal["complete", "needs_review"] = Field(alias="qualityStatus")
    quality_reasons: list[str] = Field(default_factory=list, alias="qualityReasons", max_length=8)
    preview_uri: str = Field(alias="previewUri", min_length=1, max_length=256)
    scores: RerankScores
    explanation: RerankExplanation

    _validate_digest_fields = field_validator("sentence_id", "source_sentence_cache_key")(_validate_digest)
    _validate_asset_id = field_validator("source_asset_id")(_validate_id)

    @field_validator("text", "quality_reasons")
    @classmethod
    def validate_textual_values(cls, value):
        values = value if isinstance(value, list) else [value]
        if any(not item.strip() or any(ord(char) < 32 for char in item) for item in values):
            raise ValueError("invalid rerank text")
        return value

    @model_validator(mode="after")
    def validate_candidate(self) -> "RerankCandidate":
        if self.quality == "complete" and self.quality_reasons:
            raise ValueError("complete rerank candidate cannot have quality reasons")
        if self.quality == "needs_review" and not self.quality_reasons:
            raise ValueError("review rerank candidate needs quality reasons")
        if self.quality_status != self.quality:
            raise ValueError("rerank quality status mismatch")
        expected = f"supervideo://asset/{self.source_asset_id}?kind=audio&startMs={self.timecode.start_ms}&endMs={self.timecode.end_ms}"
        if self.preview_uri != expected:
            raise ValueError("rerank preview URI does not match source")
        return self


class RerankResult(RerankModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    rerank_version: Literal["quality-rerank-v1"] = Field(alias="rerankVersion")
    project_id: str = Field(alias="projectId")
    query: str = Field(min_length=1, max_length=RERANK_MAX_QUERY_LENGTH)
    mode: Literal["lexical", "vector", "hybrid"]
    candidate_limit: int = Field(alias="candidateLimit", strict=True, ge=1, le=RERANK_MAX_CANDIDATES)
    limit: int = Field(strict=True, ge=1, le=RERANK_MAX_LIMIT)
    candidate_count: int = Field(alias="candidateCount", strict=True, ge=0, le=RERANK_MAX_CANDIDATES)
    candidates: list[RerankCandidate] = Field(max_length=RERANK_MAX_LIMIT)

    _validate_project_id = field_validator("project_id")(_validate_id)

    @model_validator(mode="after")
    def validate_result(self) -> "RerankResult":
        if self.limit > self.candidate_limit or self.candidate_count != len(self.candidates):
            raise ValueError("rerank candidate accounting mismatch")
        for index, candidate in enumerate(self.candidates, start=1):
            if candidate.rank != index:
                raise ValueError("rerank candidates must be ranked")
        return self


def validate_rerank_size(result: RerankResult) -> RerankResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > RERANK_MAX_RESULT_BYTES:
        raise ValueError("rerank result is too large")
    return result
