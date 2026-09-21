"""Versioned local transcription request, result, and runner models."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


TRANSCRIPTION_SCHEMA_VERSION = 1
TRANSCRIPTION_ADAPTER_VERSION = "faster-whisper-v1"
TRANSCRIPTION_MAX_SEGMENTS = 2_000
TRANSCRIPTION_MAX_WORDS_PER_SEGMENT = 128
TRANSCRIPTION_MAX_TEXT_LENGTH = 2_048
TRANSCRIPTION_MAX_TOTAL_TEXT_LENGTH = 180_000
TRANSCRIPTION_MAX_DURATION_MS = 86_400_000
TRANSCRIPTION_MAX_RESULT_BYTES = 48 * 1024


class TranscriptionModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class TranscriptionParams(TranscriptionModel):
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    @field_validator("project_id", "asset_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
            raise ValueError("invalid transcription id")
        return value


class TranscriptionModelInfo(TranscriptionModel):
    adapter_version: Literal["faster-whisper-v1"] = Field(alias="adapterVersion")
    provider: Literal["faster-whisper"]
    model_name: Literal["tiny", "base", "small", "medium", "large-v3"] = Field(alias="modelName")
    device: Literal["cpu", "cuda"]
    compute_type: Literal["int8", "float16", "float32", "int8_float16"] = Field(alias="computeType")


class TranscriptionWord(TranscriptionModel):
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=TRANSCRIPTION_MAX_DURATION_MS)
    end_ms: int = Field(alias="endMs", strict=True, ge=0, le=TRANSCRIPTION_MAX_DURATION_MS)
    text: str = Field(min_length=1, max_length=TRANSCRIPTION_MAX_TEXT_LENGTH)
    probability: float | None = Field(default=None, strict=True, ge=0, le=1)

    @field_validator("end_ms")
    @classmethod
    def validate_end(cls, value: int, info) -> int:
        start = info.data.get("start_ms")
        if isinstance(start, int) and value < start:
            raise ValueError("word end precedes start")
        return value


class TranscriptionSegment(TranscriptionModel):
    index: int = Field(strict=True, ge=0, lt=TRANSCRIPTION_MAX_SEGMENTS)
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=TRANSCRIPTION_MAX_DURATION_MS)
    end_ms: int = Field(alias="endMs", strict=True, ge=0, le=TRANSCRIPTION_MAX_DURATION_MS)
    text: str = Field(min_length=1, max_length=TRANSCRIPTION_MAX_TEXT_LENGTH)
    confidence: float | None = Field(default=None, strict=True, ge=0, le=1)
    avg_logprob: float | None = Field(default=None, alias="avgLogprob", strict=True, ge=-100, le=100)
    no_speech_probability: float | None = Field(default=None, alias="noSpeechProbability", strict=True, ge=0, le=1)
    compression_ratio: float | None = Field(default=None, alias="compressionRatio", strict=True, ge=0, le=100)
    words: list[TranscriptionWord] = Field(default_factory=list, max_length=TRANSCRIPTION_MAX_WORDS_PER_SEGMENT)

    @field_validator("end_ms")
    @classmethod
    def validate_end(cls, value: int, info) -> int:
        start = info.data.get("start_ms")
        if isinstance(start, int) and value < start:
            raise ValueError("segment end precedes start")
        return value


class TranscriptionResult(TranscriptionModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    cache_status: Literal["created", "cache-hit"] = Field(alias="cacheStatus")
    cache_key: str = Field(alias="cacheKey", min_length=16, max_length=128)
    model: TranscriptionModelInfo
    language: str | None = Field(default=None, max_length=64)
    language_probability: float | None = Field(default=None, alias="languageProbability", strict=True, ge=0, le=1)
    duration_ms: int | None = Field(default=None, alias="durationMs", strict=True, ge=0, le=TRANSCRIPTION_MAX_DURATION_MS)
    segments: list[TranscriptionSegment] = Field(max_length=TRANSCRIPTION_MAX_SEGMENTS)


def validate_total_text(result: TranscriptionResult) -> TranscriptionResult:
    total = sum(len(segment.text) + sum(len(word.text) for word in segment.words) for segment in result.segments)
    if total > TRANSCRIPTION_MAX_TOTAL_TEXT_LENGTH:
        raise ValueError("transcription text is too large")
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > TRANSCRIPTION_MAX_RESULT_BYTES:
        raise ValueError("transcription result is too large")
    return result
