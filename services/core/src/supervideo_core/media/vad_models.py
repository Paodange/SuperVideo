"""Versioned, bounded VAD request and speech-interval result models."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


VAD_SCHEMA_VERSION = 1
VAD_ADAPTER_VERSION = "ffmpeg-silencedetect-v1"
VAD_MAX_DURATION_MS = 86_400_000
VAD_MAX_INTERVALS = 4_000
VAD_MAX_RESULT_BYTES = 48 * 1024


class VadModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class VadConfig(VadModel):
    threshold_db: float = Field(default=-35.0, alias="thresholdDb", strict=True, ge=-60, le=-5)
    min_speech_ms: int = Field(default=120, alias="minSpeechMs", strict=True, ge=20, le=5_000)
    min_silence_ms: int = Field(default=120, alias="minSilenceMs", strict=True, ge=20, le=5_000)
    pre_roll_ms: int = Field(default=120, alias="preRollMs", strict=True, ge=0, le=180)
    post_roll_ms: int = Field(default=180, alias="postRollMs", strict=True, ge=0, le=250)
    merge_gap_ms: int = Field(default=120, alias="mergeGapMs", strict=True, ge=0, le=1_000)


class VadParams(VadModel):
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)
    config: VadConfig = Field(default_factory=VadConfig)

    @field_validator("project_id", "asset_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
            raise ValueError("invalid VAD id")
        return value


class SpeechInterval(VadModel):
    index: int = Field(strict=True, ge=0, lt=VAD_MAX_INTERVALS)
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=VAD_MAX_DURATION_MS)
    end_ms: int = Field(alias="endMs", strict=True, ge=0, le=VAD_MAX_DURATION_MS)
    is_speech: bool = Field(alias="isSpeech")
    confidence: float | None = Field(default=None, strict=True, ge=0, le=1)
    quality: Literal["detected", "silence", "boundary-expanded", "boundary-clipped", "merged"]

    @model_validator(mode="after")
    def validate_range(self) -> "SpeechInterval":
        if self.end_ms <= self.start_ms:
            raise ValueError("interval must have positive duration")
        return self


class VadResult(VadModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    cache_status: Literal["created", "cache-hit"] = Field(alias="cacheStatus")
    cache_key: str = Field(alias="cacheKey", min_length=16, max_length=128)
    adapter_version: Literal["ffmpeg-silencedetect-v1"] = Field(alias="adapterVersion")
    duration_ms: int = Field(alias="durationMs", strict=True, ge=0, le=VAD_MAX_DURATION_MS)
    config: VadConfig
    intervals: list[SpeechInterval] = Field(max_length=VAD_MAX_INTERVALS)

    @model_validator(mode="after")
    def validate_intervals(self) -> "VadResult":
        cursor = 0
        for index, interval in enumerate(self.intervals):
            if interval.index != index or interval.start_ms != cursor or interval.end_ms > self.duration_ms:
                raise ValueError("VAD intervals must be ordered, bounded, and non-overlapping")
            cursor = interval.end_ms
        if self.duration_ms > 0 and cursor != self.duration_ms:
            raise ValueError("VAD intervals must cover media duration")
        return self


def validate_vad_result_size(result: VadResult) -> VadResult:
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > VAD_MAX_RESULT_BYTES:
        raise ValueError("VAD result is too large")
    return result
