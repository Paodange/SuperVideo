"""Strict B02 request and response models."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MediaModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class MediaRequest(MediaModel):
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    @field_validator("project_id", "asset_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if re.fullmatch(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value) is None:
            raise ValueError("invalid media id")
        return value


class MediaProbeParams(MediaRequest):
    pass


class MediaProxyParams(MediaRequest):
    pass


class MediaStream(MediaModel):
    index: int = Field(strict=True, ge=0)
    codec_type: Literal["video", "audio", "data", "subtitle", "attachment", "unknown"] = Field(alias="codecType")
    codec_name: str | None = Field(default=None, alias="codecName", max_length=64)
    width: int | None = Field(default=None, strict=True, ge=1, le=100_000)
    height: int | None = Field(default=None, strict=True, ge=1, le=100_000)
    frame_rate: float | None = Field(default=None, alias="frameRate", strict=True, ge=0, le=1_000)
    sample_rate: int | None = Field(default=None, alias="sampleRate", strict=True, ge=1, le=1_000_000)
    channels: int | None = Field(default=None, strict=True, ge=1, le=256)
    channel_layout: str | None = Field(default=None, alias="channelLayout", max_length=64)
    language: str | None = Field(default=None, max_length=32)


class MediaMetadata(MediaModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    format_name: str | None = Field(default=None, alias="formatName", max_length=128)
    format_long_name: str | None = Field(default=None, alias="formatLongName", max_length=256)
    duration_ms: int | None = Field(default=None, alias="durationMs", strict=True, ge=0, le=86_400_000_000)
    bit_rate: int | None = Field(default=None, alias="bitRate", strict=True, ge=0, le=10_000_000_000)
    streams: list[MediaStream] = Field(max_length=64)


class MediaProbeResult(MediaModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    cache_status: Literal["created", "cache-hit"] = Field(alias="cacheStatus")
    cache_key: str = Field(alias="cacheKey", min_length=16, max_length=128)
    metadata: MediaMetadata


class MediaOutput(MediaModel):
    kind: Literal["audio", "video", "thumbnail"]
    relative_path: str = Field(alias="relativePath", min_length=1, max_length=512)
    size_bytes: int = Field(alias="sizeBytes", strict=True, ge=1)


class MediaProxyResult(MediaModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
    cache_status: Literal["created", "cache-hit"] = Field(alias="cacheStatus")
    cache_key: str = Field(alias="cacheKey", min_length=16, max_length=128)
    outputs: list[MediaOutput] = Field(min_length=1, max_length=3)
