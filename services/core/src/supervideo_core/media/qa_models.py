"""Versioned, bounded contracts for B06 sentence-boundary QA."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .sentence_models import SentenceCandidate, SentenceModel


SENTENCE_QA_SCHEMA_VERSION = 1
SENTENCE_QA_VERSION = "sentence-qa-v1"
SENTENCE_QA_MAX_MARKERS = 500
SENTENCE_QA_MAX_CONTEXT = 3
SENTENCE_QA_MAX_NOTE_LENGTH = 256
SENTENCE_QA_MAX_EXPECTED_TEXT_LENGTH = 2_048
SENTENCE_QA_MAX_RESULT_BYTES = 64 * 1024
SENTENCE_QA_MAX_TIMESTAMP_MS = 32_503_680_000_000
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_CACHE_KEY = re.compile(r"^[0-9a-f]{64}$")


def _validate_uuid(value: str) -> str:
    if _UUID.fullmatch(value) is None:
        raise ValueError("invalid id")
    return value


def _validate_cache_key(value: str) -> str:
    if _CACHE_KEY.fullmatch(value) is None:
        raise ValueError("invalid sentence cache key")
    return value


def _validate_text(value: str, maximum: int, label: str) -> str:
    if any(ord(character) < 32 for character in value) or len(value) > maximum:
        raise ValueError(f"invalid {label}")
    return value


QaIssueType = Literal["missing-text", "half-sentence", "low-confidence", "boundary-uncertain", "other"]
QaMarkerStatus = Literal["open", "resolved"]
QaMarkerSource = Literal["manual", "automatic"]


class SentenceQaParams(SentenceModel):
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    sentence_cache_key: str = Field(alias="sentenceCacheKey")
    sentence_index: int = Field(alias="sentenceIndex", strict=True, ge=0, lt=2_000)
    context_before: int = Field(default=1, alias="contextBefore", strict=True, ge=0, le=SENTENCE_QA_MAX_CONTEXT)
    context_after: int = Field(default=1, alias="contextAfter", strict=True, ge=0, le=SENTENCE_QA_MAX_CONTEXT)

    _validate_project_id = field_validator("project_id", "asset_id")(_validate_uuid)
    _validate_cache_key_value = field_validator("sentence_cache_key")(_validate_cache_key)


class SentenceQaMarkerInput(SentenceModel):
    sentence_index: int = Field(alias="sentenceIndex", strict=True, ge=0, lt=2_000)
    issue_type: QaIssueType = Field(alias="issueType")
    status: QaMarkerStatus = "open"
    source: QaMarkerSource = "manual"
    note: str = Field(default="", max_length=SENTENCE_QA_MAX_NOTE_LENGTH)
    expected_text: str | None = Field(default=None, alias="expectedText", max_length=SENTENCE_QA_MAX_EXPECTED_TEXT_LENGTH)

    @field_validator("note")
    @classmethod
    def validate_note(cls, value: str) -> str:
        return _validate_text(value, SENTENCE_QA_MAX_NOTE_LENGTH, "QA note")

    @field_validator("expected_text")
    @classmethod
    def validate_expected_text(cls, value: str | None) -> str | None:
        return None if value is None else _validate_text(value, SENTENCE_QA_MAX_EXPECTED_TEXT_LENGTH, "expected text")

    @model_validator(mode="after")
    def validate_expected_text_usage(self) -> "SentenceQaMarkerInput":
        if self.issue_type == "missing-text" and self.status == "open" and self.expected_text is None and not self.note:
            raise ValueError("missing-text marker requires expected text or a note")
        return self


class SentenceQaMarker(SentenceQaMarkerInput):
    marker_id: str = Field(alias="markerId")
    created_at_ms: int = Field(alias="createdAtMs", strict=True, ge=0, le=SENTENCE_QA_MAX_TIMESTAMP_MS)
    updated_at_ms: int = Field(alias="updatedAtMs", strict=True, ge=0, le=SENTENCE_QA_MAX_TIMESTAMP_MS)

    _validate_marker_id = field_validator("marker_id")(_validate_uuid)

    @model_validator(mode="after")
    def validate_timestamps(self) -> "SentenceQaMarker":
        if self.updated_at_ms < self.created_at_ms:
            raise ValueError("QA marker timestamps are out of order")
        return self


class SentenceQaSaveParams(SentenceQaParams):
    markers: list[SentenceQaMarkerInput] = Field(default_factory=list, max_length=SENTENCE_QA_MAX_MARKERS)


class SentencePlaybackAddress(SentenceModel):
    scheme: Literal["supervideo"] = "supervideo"
    asset_id: str = Field(alias="assetId")
    kind: Literal["audio", "video"]
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=86_400_000)
    end_ms: int = Field(alias="endMs", strict=True, ge=0, le=86_400_000)
    uri: str = Field(min_length=1, max_length=256)

    _validate_asset_id = field_validator("asset_id")(_validate_uuid)

    @model_validator(mode="after")
    def validate_range(self) -> "SentencePlaybackAddress":
        if self.end_ms <= self.start_ms:
            raise ValueError("playback range must be positive")
        return self


class SentenceQaContextItem(SentenceModel):
    relation: Literal["before", "selected", "after"]
    sentence: SentenceCandidate
    playback: SentencePlaybackAddress


class SentenceQaContextResult(SentenceModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    qa_version: Literal["sentence-qa-v1"] = Field(alias="qaVersion")
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    sentence_cache_key: str = Field(alias="sentenceCacheKey")
    selected_index: int = Field(alias="selectedIndex", strict=True, ge=0, lt=2_000)
    items: list[SentenceQaContextItem] = Field(max_length=7)
    markers: list[SentenceQaMarker] = Field(max_length=SENTENCE_QA_MAX_MARKERS)

    _validate_project_id = field_validator("project_id", "asset_id")(_validate_uuid)
    _validate_cache_key_value = field_validator("sentence_cache_key")(_validate_cache_key)


class SentenceQaSaveResult(SentenceModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    qa_version: Literal["sentence-qa-v1"] = Field(alias="qaVersion")
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    sentence_cache_key: str = Field(alias="sentenceCacheKey")
    revision: int = Field(strict=True, ge=1, le=2_000_000_000)
    markers: list[SentenceQaMarker] = Field(max_length=SENTENCE_QA_MAX_MARKERS)

    _validate_project_id = field_validator("project_id", "asset_id")(_validate_uuid)
    _validate_cache_key_value = field_validator("sentence_cache_key")(_validate_cache_key)


def validate_sentence_qa_size(value: SentenceQaContextResult | SentenceQaSaveResult) -> SentenceQaContextResult | SentenceQaSaveResult:
    if len(value.model_dump_json(by_alias=True).encode("utf-8")) > SENTENCE_QA_MAX_RESULT_BYTES:
        raise ValueError("sentence QA result is too large")
    return value
