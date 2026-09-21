"""Versioned, bounded complete-sentence segmentation models."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SENTENCE_SCHEMA_VERSION = 1
SENTENCE_ADAPTER_VERSION = "sentence-segmentation-v1"
SENTENCE_CACHE_VERSION = "sentence-cache-v1"
SENTENCE_MAX_DURATION_MS = 86_400_000
SENTENCE_MAX_CANDIDATES = 2_000
SENTENCE_MAX_TEXT_LENGTH = 2_048
SENTENCE_MAX_TOTAL_TEXT_LENGTH = 180_000
SENTENCE_MAX_RESULT_BYTES = 48 * 1024


class SentenceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SentenceConfig(SentenceModel):
    max_sentence_ms: int = Field(default=15_000, alias="maxSentenceMs", strict=True, ge=1_000, le=30_000)
    pause_boundary_ms: int = Field(default=650, alias="pauseBoundaryMs", strict=True, ge=100, le=3_000)
    min_sentence_ms: int = Field(default=300, alias="minSentenceMs", strict=True, ge=0, le=5_000)
    pre_roll_ms: int = Field(default=120, alias="preRollMs", strict=True, ge=0, le=180)
    post_roll_ms: int = Field(default=180, alias="postRollMs", strict=True, ge=0, le=250)


class SentenceParams(SentenceModel):
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)
    config: SentenceConfig = Field(default_factory=SentenceConfig)

    @field_validator("config", mode="before")
    @classmethod
    def normalize_config(cls, value: object) -> object:
        """Accept a bounded partial patch, then normalize through the strict full model."""
        if not isinstance(value, dict):
            return value
        defaults = SentenceConfig().model_dump(by_alias=True)
        defaults.update(value)
        return SentenceConfig.model_validate(defaults)

    @field_validator("project_id", "asset_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
            raise ValueError("invalid sentence id")
        return value


SentenceQuality = Literal["complete", "needs_review"]


class SentenceCandidate(SentenceModel):
    index: int = Field(strict=True, ge=0, lt=SENTENCE_MAX_CANDIDATES)
    source_asset_id: str = Field(alias="sourceAssetId")
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=SENTENCE_MAX_DURATION_MS)
    end_ms: int = Field(alias="endMs", strict=True, ge=0, le=SENTENCE_MAX_DURATION_MS)
    text: str = Field(min_length=1, max_length=SENTENCE_MAX_TEXT_LENGTH)
    confidence: float | None = Field(default=None, strict=True, ge=0, le=1)
    quality: SentenceQuality
    quality_reasons: list[str] = Field(default_factory=list, alias="qualityReasons", max_length=8)
    source_segment_indexes: list[int] = Field(default_factory=list, alias="sourceSegmentIndexes", max_length=2_000)

    @field_validator("source_segment_indexes")
    @classmethod
    def validate_segment_indexes(cls, value: list[int]) -> list[int]:
        if any(not isinstance(item, int) or item < 0 or item >= 2_000 for item in value):
            raise ValueError("invalid source segment index")
        return value

    @field_validator("source_asset_id")
    @classmethod
    def validate_asset_id(cls, value: str) -> str:
        if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
            raise ValueError("invalid sentence asset id")
        return value

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 for character in value):
            raise ValueError("invalid sentence text")
        return value

    @field_validator("quality_reasons")
    @classmethod
    def validate_reasons(cls, value: list[str]) -> list[str]:
        if any(not item or len(item) > 64 or any(ord(character) < 32 for character in item) for item in value):
            raise ValueError("invalid sentence quality reason")
        return value

    @model_validator(mode="after")
    def validate_range(self) -> "SentenceCandidate":
        if self.end_ms <= self.start_ms:
            raise ValueError("sentence must have positive duration")
        if self.quality == "complete" and self.quality_reasons:
            raise ValueError("complete sentence cannot have quality reasons")
        if self.quality == "needs_review" and not self.quality_reasons:
            raise ValueError("review sentence must have a quality reason")
        return self


class SentenceResult(SentenceModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    cache_status: Literal["created", "cache-hit"] = Field(alias="cacheStatus")
    cache_key: str = Field(alias="cacheKey", min_length=16, max_length=128)
    adapter_version: Literal["sentence-segmentation-v1"] = Field(alias="adapterVersion")
    duration_ms: int = Field(alias="durationMs", strict=True, ge=0, le=SENTENCE_MAX_DURATION_MS)
    config: SentenceConfig
    sentences: list[SentenceCandidate] = Field(max_length=SENTENCE_MAX_CANDIDATES)

    @field_validator("project_id", "asset_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
            raise ValueError("invalid sentence result id")
        return value

    @model_validator(mode="after")
    def validate_candidates(self) -> "SentenceResult":
        for index, sentence in enumerate(self.sentences):
            if sentence.index != index or sentence.source_asset_id != self.asset_id or sentence.end_ms > self.duration_ms:
                raise ValueError("sentences must be ordered and bounded")
        total = sum(len(sentence.text) for sentence in self.sentences)
        if total > SENTENCE_MAX_TOTAL_TEXT_LENGTH:
            raise ValueError("sentence text is too large")
        return self


def validate_sentence_result_size(result: SentenceResult) -> SentenceResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > SENTENCE_MAX_RESULT_BYTES:
        raise ValueError("sentence result is too large")
    return result
