"""Versioned, bounded contracts for the deterministic B07 sentence index."""

from __future__ import annotations

import math
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SENTENCE_INDEX_SCHEMA_VERSION = 1
SENTENCE_INDEX_VERSION = "sentence-index-v1"
SENTENCE_INDEX_ADAPTER_VERSION = "deterministic-keyword-topic-vector-v1"
SENTENCE_INDEX_VECTOR_PROVIDER = "sha256-hash-v1"
SENTENCE_INDEX_VECTOR_DIMENSION = 32
SENTENCE_INDEX_MAX_ENTRIES = 2_000
SENTENCE_INDEX_MAX_KEYWORDS = 32
SENTENCE_INDEX_MAX_TOPICS = 8
SENTENCE_INDEX_MAX_TEXT_LENGTH = 2_048
SENTENCE_INDEX_MAX_TOTAL_TEXT_LENGTH = 180_000
# Keep the result below the 64 KiB Agent Worker message envelope even after
# the project-operation wrapper is added.
SENTENCE_INDEX_MAX_RESULT_BYTES = 60 * 1024


class SentenceIndexModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def _validate_id(value: str) -> str:
    if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
        raise ValueError("invalid index identity")
    return value


def _validate_digest(value: str) -> str:
    if re.fullmatch(r"^[0-9a-f]{64}$", value) is None:
        raise ValueError("invalid index digest")
    return value


class SentenceIndexParams(SentenceIndexModel):
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    sentence_cache_key: str = Field(alias="sentenceCacheKey", min_length=64, max_length=64)
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    _validate_project_id = field_validator("project_id", "asset_id")(_validate_id)

    @field_validator("sentence_cache_key")
    @classmethod
    def validate_sentence_cache_key(cls, value: str) -> str:
        return _validate_digest(value)


class SentenceIndexEntry(SentenceIndexModel):
    sentence_id: str = Field(alias="sentenceId", min_length=64, max_length=64)
    source_asset_id: str = Field(alias="sourceAssetId")
    sentence_index: int = Field(alias="sentenceIndex", strict=True, ge=0, lt=SENTENCE_INDEX_MAX_ENTRIES)
    source_sentence_cache_key: str = Field(alias="sourceSentenceCacheKey", min_length=64, max_length=64)
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=86_400_000)
    end_ms: int = Field(alias="endMs", strict=True, ge=1, le=86_400_000)
    text: str = Field(min_length=1, max_length=SENTENCE_INDEX_MAX_TEXT_LENGTH)
    keywords: list[str] = Field(max_length=SENTENCE_INDEX_MAX_KEYWORDS)
    topics: list[str] = Field(max_length=SENTENCE_INDEX_MAX_TOPICS)
    vector: list[float] = Field(min_length=SENTENCE_INDEX_VECTOR_DIMENSION, max_length=SENTENCE_INDEX_VECTOR_DIMENSION)
    confidence: float | None = Field(default=None, strict=True, ge=0, le=1)
    quality: Literal["complete", "needs_review"]
    quality_reasons: list[str] = Field(default_factory=list, alias="qualityReasons", max_length=8)

    _validate_source_asset_id = field_validator("source_asset_id")(_validate_id)
    _validate_sentence_id = field_validator("sentence_id")(_validate_digest)
    _validate_source_cache_key = field_validator("source_sentence_cache_key")(_validate_digest)

    @field_validator("text", "keywords", "topics", "quality_reasons")
    @classmethod
    def validate_textual_values(cls, value):
        values = value if isinstance(value, list) else [value]
        if any(not isinstance(item, str) or not item.strip() or any(ord(char) < 32 for char in item) for item in values):
            raise ValueError("invalid index text")
        return value

    @field_validator("keywords", "topics")
    @classmethod
    def validate_unique_labels(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("index labels must be unique")
        return value

    @field_validator("vector")
    @classmethod
    def validate_vector(cls, value: list[float]) -> list[float]:
        if any(not isinstance(item, float) or not math.isfinite(item) or item < -1 or item > 1 for item in value):
            raise ValueError("invalid index vector")
        return value

    @model_validator(mode="after")
    def validate_entry(self) -> "SentenceIndexEntry":
        if self.end_ms <= self.start_ms:
            raise ValueError("index entry must have positive duration")
        if self.quality == "complete" and self.quality_reasons:
            raise ValueError("complete index entry cannot have quality reasons")
        if self.quality == "needs_review" and not self.quality_reasons:
            raise ValueError("review index entry must have a quality reason")
        return self


class SentenceIndexResult(SentenceIndexModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    index_version: Literal["sentence-index-v1"] = Field(alias="indexVersion")
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    cache_status: Literal["created", "cache-hit"] = Field(alias="cacheStatus")
    cache_key: str = Field(alias="cacheKey", min_length=64, max_length=64)
    source_sentence_cache_key: str = Field(alias="sourceSentenceCacheKey", min_length=64, max_length=64)
    source_sentence_result_digest: str = Field(alias="sourceSentenceResultDigest", min_length=64, max_length=64)
    adapter_version: Literal["deterministic-keyword-topic-vector-v1"] = Field(alias="adapterVersion")
    vector_provider: Literal["sha256-hash-v1"] = Field(alias="vectorProvider")
    vector_dimension: int = Field(alias="vectorDimension", strict=True, ge=1, le=128)
    reused_count: int = Field(alias="reusedCount", strict=True, ge=0, le=SENTENCE_INDEX_MAX_ENTRIES)
    rebuilt_count: int = Field(alias="rebuiltCount", strict=True, ge=0, le=SENTENCE_INDEX_MAX_ENTRIES)
    entries: list[SentenceIndexEntry] = Field(max_length=SENTENCE_INDEX_MAX_ENTRIES)

    _validate_project_id = field_validator("project_id", "asset_id")(_validate_id)
    _validate_cache_key = field_validator("cache_key", "source_sentence_cache_key", "source_sentence_result_digest")(_validate_digest)

    @model_validator(mode="after")
    def validate_result(self) -> "SentenceIndexResult":
        if self.vector_dimension != SENTENCE_INDEX_VECTOR_DIMENSION:
            raise ValueError("unsupported index vector dimension")
        if self.reused_count + self.rebuilt_count != len(self.entries):
            raise ValueError("index accounting mismatch")
        for index, entry in enumerate(self.entries):
            if entry.sentence_index != index or entry.source_asset_id != self.asset_id or entry.source_sentence_cache_key != self.source_sentence_cache_key:
                raise ValueError("index entries must be ordered and project-bound")
        if sum(len(entry.text) for entry in self.entries) > SENTENCE_INDEX_MAX_TOTAL_TEXT_LENGTH:
            raise ValueError("index text is too large")
        return self


def validate_sentence_index_size(result: SentenceIndexResult) -> SentenceIndexResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > SENTENCE_INDEX_MAX_RESULT_BYTES:
        raise ValueError("sentence index result is too large")
    return result
