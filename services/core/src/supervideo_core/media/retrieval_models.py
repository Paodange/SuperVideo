"""Bounded, versioned contracts for deterministic B08 retrieval."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .index_models import SENTENCE_INDEX_MAX_TEXT_LENGTH, SENTENCE_INDEX_VECTOR_DIMENSION

RETRIEVAL_SCHEMA_VERSION = 1
RETRIEVAL_VERSION = "hybrid-retrieval-v1"
RETRIEVAL_MAX_QUERY_LENGTH = 512
RETRIEVAL_MAX_ASSETS = 100
RETRIEVAL_MAX_LIMIT = 50
RETRIEVAL_MAX_FILTER_TOPICS = 8
RETRIEVAL_MAX_RESULT_BYTES = 60 * 1024


class RetrievalModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def _validate_id(value: str) -> str:
    if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
        raise ValueError("invalid retrieval identity")
    return value


def _validate_text(value: str, maximum: int) -> str:
    if not value.strip() or any(ord(char) < 32 for char in value):
        raise ValueError("invalid retrieval text")
    if len(value) > maximum:
        raise ValueError("retrieval text is too long")
    return value


def _validate_digest(value: str) -> str:
    if re.fullmatch(r"^[0-9a-f]{64}$", value) is None:
        raise ValueError("invalid retrieval digest")
    return value


class RetrievalFilters(RetrievalModel):
    topics: list[str] = Field(default_factory=list, max_length=RETRIEVAL_MAX_FILTER_TOPICS)
    quality: Literal["complete", "needs_review"] | None = None
    min_confidence: float | None = Field(default=None, alias="minConfidence", ge=0, le=1)
    start_ms: int | None = Field(default=None, alias="startMs", strict=True, ge=0, le=86_400_000)
    end_ms: int | None = Field(default=None, alias="endMs", strict=True, ge=1, le=86_400_000)

    @field_validator("topics")
    @classmethod
    def validate_topics(cls, value: list[str]) -> list[str]:
        cleaned = [_validate_text(item, 64).strip() for item in value]
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("retrieval topics must be unique")
        return cleaned

    @model_validator(mode="after")
    def validate_range(self) -> "RetrievalFilters":
        if self.start_ms is not None and self.end_ms is not None and self.end_ms <= self.start_ms:
            raise ValueError("retrieval time range must be positive")
        return self


class RetrievalParams(RetrievalModel):
    project_id: str = Field(alias="projectId")
    query: str = Field(min_length=1, max_length=RETRIEVAL_MAX_QUERY_LENGTH)
    mode: Literal["lexical", "vector", "hybrid"] = "hybrid"
    asset_ids: list[str] | None = Field(default=None, alias="assetIds", max_length=RETRIEVAL_MAX_ASSETS)
    limit: int = Field(default=20, strict=True, ge=1, le=RETRIEVAL_MAX_LIMIT)
    filters: RetrievalFilters = Field(default_factory=RetrievalFilters)
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    _validate_project_id = field_validator("project_id")(_validate_id)

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        return _validate_text(value, RETRIEVAL_MAX_QUERY_LENGTH)

    @field_validator("asset_ids")
    @classmethod
    def validate_asset_ids(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        if len(value) != len(set(value)):
            raise ValueError("retrieval assets must be unique")
        return [_validate_id(item) for item in value]


class RetrievalTimecode(RetrievalModel):
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=86_400_000)
    end_ms: int = Field(alias="endMs", strict=True, ge=1, le=86_400_000)

    @model_validator(mode="after")
    def validate_duration(self) -> "RetrievalTimecode":
        if self.end_ms <= self.start_ms:
            raise ValueError("retrieval timecode must have positive duration")
        return self


class RetrievalExplanation(RetrievalModel):
    query_keywords: list[str] = Field(alias="queryKeywords", max_length=32)
    matched_keywords: list[str] = Field(alias="matchedKeywords", max_length=32)
    matched_topics: list[str] = Field(alias="matchedTopics", max_length=8)
    vector_provider: Literal["sha256-hash-v1"] = Field(alias="vectorProvider")
    score_formula: Literal["lexical-keyword-overlap-v1", "vector-cosine-v1", "hybrid-0.6-0.4-v1"] = Field(alias="scoreFormula")

    @field_validator("query_keywords", "matched_keywords", "matched_topics")
    @classmethod
    def validate_labels(cls, value: list[str]) -> list[str]:
        if any(not item or any(ord(char) < 32 for char in item) for item in value):
            raise ValueError("invalid retrieval explanation")
        if len(value) != len(set(value)):
            raise ValueError("retrieval explanation labels must be unique")
        return value


class RetrievalCandidate(RetrievalModel):
    rank: int = Field(strict=True, ge=1, le=RETRIEVAL_MAX_LIMIT)
    sentence_id: str = Field(alias="sentenceId", min_length=64, max_length=64)
    source_asset_id: str = Field(alias="sourceAssetId")
    source_sentence_cache_key: str = Field(alias="sourceSentenceCacheKey", min_length=64, max_length=64)
    sentence_index: int = Field(alias="sentenceIndex", strict=True, ge=0, lt=2_000)
    timecode: RetrievalTimecode
    text: str = Field(min_length=1, max_length=SENTENCE_INDEX_MAX_TEXT_LENGTH)
    lexical_score: float = Field(alias="lexicalScore", strict=True, ge=0, le=1)
    vector_score: float = Field(alias="vectorScore", strict=True, ge=0, le=1)
    hybrid_score: float = Field(alias="hybridScore", strict=True, ge=0, le=1)
    score: float = Field(strict=True, ge=0, le=1)
    explanation: RetrievalExplanation
    confidence: float | None = Field(default=None, strict=True, ge=0, le=1)
    quality: Literal["complete", "needs_review"]
    quality_reasons: list[str] = Field(default_factory=list, alias="qualityReasons", max_length=8)
    preview_uri: str = Field(alias="previewUri", min_length=1, max_length=256)

    _validate_sentence_id = field_validator("sentence_id", "source_sentence_cache_key")(_validate_digest)
    _validate_source_asset_id = field_validator("source_asset_id")(_validate_id)

    @field_validator("text", "quality_reasons")
    @classmethod
    def validate_textual_values(cls, value):
        values = value if isinstance(value, list) else [value]
        if any(not isinstance(item, str) or not item.strip() or any(ord(char) < 32 for char in item) for item in values):
            raise ValueError("invalid retrieval text")
        return value

    @model_validator(mode="after")
    def validate_preview_uri(self) -> "RetrievalCandidate":
        expected = f"supervideo://asset/{self.source_asset_id}?kind=audio&startMs={self.timecode.start_ms}&endMs={self.timecode.end_ms}"
        if self.preview_uri != expected:
            raise ValueError("retrieval preview URI does not match source")
        return self


class RetrievalResult(RetrievalModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    retrieval_version: Literal["hybrid-retrieval-v1"] = Field(alias="retrievalVersion")
    project_id: str = Field(alias="projectId")
    query: str = Field(min_length=1, max_length=RETRIEVAL_MAX_QUERY_LENGTH)
    mode: Literal["lexical", "vector", "hybrid"]
    limit: int = Field(strict=True, ge=1, le=RETRIEVAL_MAX_LIMIT)
    candidate_count: int = Field(alias="candidateCount", strict=True, ge=0, le=RETRIEVAL_MAX_LIMIT)
    candidates: list[RetrievalCandidate] = Field(max_length=RETRIEVAL_MAX_LIMIT)

    _validate_project_id = field_validator("project_id")(_validate_id)

    @model_validator(mode="after")
    def validate_result(self) -> "RetrievalResult":
        if self.candidate_count != len(self.candidates):
            raise ValueError("retrieval candidate accounting mismatch")
        for index, candidate in enumerate(self.candidates, start=1):
            if candidate.rank != index:
                raise ValueError("retrieval candidates must be ranked")
        return self


def validate_retrieval_size(result: RetrievalResult) -> RetrievalResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > RETRIEVAL_MAX_RESULT_BYTES:
        raise ValueError("retrieval result is too large")
    return result
