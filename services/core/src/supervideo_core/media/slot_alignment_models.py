"""Versioned, bounded contracts for deterministic B10 slot alignment."""

from __future__ import annotations

import hashlib
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .index_models import SENTENCE_INDEX_MAX_TEXT_LENGTH

SLOT_ALIGNMENT_SCHEMA_VERSION = 1
SLOT_ALIGNMENT_VERSION = "information-slot-alignment-v1"
SLOT_SPLITTER_VERSION = "deterministic-slot-split-v1"
SLOT_ALIGNMENT_MAX_INPUT_LENGTH = 8_192
SLOT_ALIGNMENT_MAX_SLOTS = 32
SLOT_ALIGNMENT_MAX_CANDIDATES = 8
SLOT_ALIGNMENT_MAX_RESULT_BYTES = 60 * 1024
SLOT_ALIGNMENT_MAX_REASON_LENGTH = 128


class SlotAlignmentModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def _validate_id(value: str) -> str:
    if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
        raise ValueError("invalid slot alignment identity")
    return value


def _validate_digest(value: str) -> str:
    if re.fullmatch(r"^[0-9a-f]{64}$", value) is None:
        raise ValueError("invalid slot alignment digest")
    return value


def _validate_text(value: str, maximum: int, *, multiline: bool = False) -> str:
    if not value.strip() or len(value) > maximum:
        raise ValueError("invalid slot alignment text")
    for character in value:
        code = ord(character)
        if code < 32 and (not multiline or character not in "\r\n\t"):
            raise ValueError("invalid slot alignment control character")
    return value


class SlotAlignmentParams(SlotAlignmentModel):
    project_id: str = Field(alias="projectId")
    input_kind: Literal["copy", "outline"] = Field(default="copy", alias="inputKind")
    input_text: str = Field(alias="inputText", min_length=1, max_length=SLOT_ALIGNMENT_MAX_INPUT_LENGTH)
    asset_ids: list[str] | None = Field(default=None, alias="assetIds", max_length=100)
    candidate_limit: int = Field(default=5, alias="candidateLimit", strict=True, ge=1, le=SLOT_ALIGNMENT_MAX_CANDIDATES)
    use_rerank: bool = Field(default=True, alias="useRerank")
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    _validate_project_id = field_validator("project_id")(_validate_id)

    @field_validator("input_text")
    @classmethod
    def validate_input_text(cls, value: str) -> str:
        return _validate_text(value, SLOT_ALIGNMENT_MAX_INPUT_LENGTH, multiline=True)

    @field_validator("asset_ids")
    @classmethod
    def validate_asset_ids(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        if not value or len(value) != len(set(value)):
            raise ValueError("slot alignment assets must be non-empty and unique")
        return [_validate_id(item) for item in value]


class SlotAlignmentTimecode(SlotAlignmentModel):
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=86_400_000)
    end_ms: int = Field(alias="endMs", strict=True, ge=1, le=86_400_000)

    @model_validator(mode="after")
    def validate_duration(self) -> "SlotAlignmentTimecode":
        if self.end_ms <= self.start_ms:
            raise ValueError("slot alignment timecode must have positive duration")
        return self


class SlotAlignmentCandidate(SlotAlignmentModel):
    rank: int = Field(strict=True, ge=1, le=SLOT_ALIGNMENT_MAX_CANDIDATES)
    origin: Literal["b08-retrieval", "b09-quality-rerank"]
    sentence_id: str = Field(alias="sentenceId", min_length=64, max_length=64)
    source_asset_id: str = Field(alias="sourceAssetId")
    source_sentence_cache_key: str = Field(alias="sourceSentenceCacheKey", min_length=64, max_length=64)
    sentence_index: int = Field(alias="sentenceIndex", strict=True, ge=0, lt=2_000)
    timecode: SlotAlignmentTimecode
    text: str = Field(min_length=1, max_length=SENTENCE_INDEX_MAX_TEXT_LENGTH)
    score: float = Field(strict=True, ge=0, le=1)
    quality: Literal["complete", "needs_review"]
    preview_uri: str = Field(alias="previewUri", min_length=1, max_length=256)
    selection_reason: str = Field(alias="selectionReason", min_length=1, max_length=SLOT_ALIGNMENT_MAX_REASON_LENGTH)
    preserved_facts: list[str] = Field(default_factory=list, alias="preservedFacts", max_length=8)

    _validate_digest_fields = field_validator("sentence_id", "source_sentence_cache_key")(_validate_digest)
    _validate_source_asset_id = field_validator("source_asset_id")(_validate_id)

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        return _validate_text(value, SENTENCE_INDEX_MAX_TEXT_LENGTH)

    @field_validator("selection_reason")
    @classmethod
    def validate_selection_reason(cls, value: str) -> str:
        return _validate_text(value, SLOT_ALIGNMENT_MAX_REASON_LENGTH)

    @field_validator("preserved_facts")
    @classmethod
    def validate_facts(cls, value: list[str]) -> list[str]:
        if any(not item.strip() or any(ord(char) < 32 for char in item) or len(item) > 64 for item in value):
            raise ValueError("invalid preserved slot facts")
        if len(value) != len(set(value)):
            raise ValueError("preserved slot facts must be unique")
        return value

    @model_validator(mode="after")
    def validate_candidate(self) -> "SlotAlignmentCandidate":
        expected = f"supervideo://asset/{self.source_asset_id}?kind=audio&startMs={self.timecode.start_ms}&endMs={self.timecode.end_ms}"
        if self.preview_uri != expected:
            raise ValueError("slot alignment preview URI does not match source")
        if self.quality != "complete":
            raise ValueError("slot alignment candidates must be complete sentences")
        return self


class InformationSlot(SlotAlignmentModel):
    slot_id: str = Field(alias="slotId", min_length=1, max_length=32)
    order: int = Field(strict=True, ge=1, le=SLOT_ALIGNMENT_MAX_SLOTS)
    kind: Literal["hook", "context", "claim", "evidence", "benefit", "requirement", "process", "cta", "closing", "other"]
    source_text: str = Field(alias="sourceText", min_length=1, max_length=512)
    query: str = Field(min_length=1, max_length=512)
    key_facts: list[str] = Field(default_factory=list, alias="keyFacts", max_length=8)
    status: Literal["matched", "gap"]
    selected_candidate_rank: int | None = Field(default=None, alias="selectedCandidateRank", strict=True, ge=1, le=SLOT_ALIGNMENT_MAX_CANDIDATES)
    candidates: list[SlotAlignmentCandidate] = Field(max_length=SLOT_ALIGNMENT_MAX_CANDIDATES)
    selection_reason: str | None = Field(default=None, alias="selectionReason", max_length=SLOT_ALIGNMENT_MAX_REASON_LENGTH)
    gap_reason: str | None = Field(default=None, alias="gapReason", max_length=SLOT_ALIGNMENT_MAX_REASON_LENGTH)

    @field_validator("slot_id", "source_text", "query")
    @classmethod
    def validate_slot_text(cls, value: str) -> str:
        return _validate_text(value, 512)

    @field_validator("key_facts")
    @classmethod
    def validate_key_facts(cls, value: list[str]) -> list[str]:
        if any(not item.strip() or any(ord(char) < 32 for char in item) or len(item) > 64 for item in value):
            raise ValueError("invalid slot key facts")
        if len(value) != len(set(value)):
            raise ValueError("slot key facts must be unique")
        return value

    @model_validator(mode="after")
    def validate_slot_state(self) -> "InformationSlot":
        if self.order != int(self.slot_id.removeprefix("slot-")):
            raise ValueError("slot order does not match slot identity")
        if self.status == "matched":
            if not self.candidates or self.selected_candidate_rank != 1 or not self.selection_reason or self.gap_reason is not None:
                raise ValueError("matched slot accounting is invalid")
        elif self.candidates or self.selected_candidate_rank is not None or self.selection_reason is not None or not self.gap_reason:
            raise ValueError("gap slot accounting is invalid")
        return self


class SlotAlignmentResult(SlotAlignmentModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    alignment_version: Literal["information-slot-alignment-v1"] = Field(alias="alignmentVersion")
    splitter_version: Literal["deterministic-slot-split-v1"] = Field(alias="splitterVersion")
    project_id: str = Field(alias="projectId")
    input_kind: Literal["copy", "outline"] = Field(alias="inputKind")
    input_text: str = Field(alias="inputText", min_length=1, max_length=SLOT_ALIGNMENT_MAX_INPUT_LENGTH)
    source_digest: str = Field(alias="sourceDigest", min_length=64, max_length=64)
    slot_count: int = Field(alias="slotCount", strict=True, ge=1, le=SLOT_ALIGNMENT_MAX_SLOTS)
    matched_count: int = Field(alias="matchedCount", strict=True, ge=0, le=SLOT_ALIGNMENT_MAX_SLOTS)
    slots: list[InformationSlot] = Field(max_length=SLOT_ALIGNMENT_MAX_SLOTS)

    _validate_project_id = field_validator("project_id")(_validate_id)
    _validate_source_digest = field_validator("source_digest")(_validate_digest)

    @field_validator("input_text")
    @classmethod
    def validate_input_text(cls, value: str) -> str:
        return _validate_text(value, SLOT_ALIGNMENT_MAX_INPUT_LENGTH, multiline=True)

    @model_validator(mode="after")
    def validate_result(self) -> "SlotAlignmentResult":
        if self.source_digest != hashlib.sha256(self.input_text.encode("utf-8")).hexdigest():
            raise ValueError("slot alignment source digest mismatch")
        if self.slot_count != len(self.slots) or self.matched_count != sum(slot.status == "matched" for slot in self.slots):
            raise ValueError("slot alignment accounting mismatch")
        for index, slot in enumerate(self.slots, start=1):
            if slot.order != index:
                raise ValueError("slot alignment order is not stable")
        return self


def validate_slot_alignment_size(result: SlotAlignmentResult) -> SlotAlignmentResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > SLOT_ALIGNMENT_MAX_RESULT_BYTES:
        raise ValueError("slot alignment result is too large")
    return result
