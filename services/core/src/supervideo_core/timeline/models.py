"""Strict Pydantic representation of the renderer-neutral Timeline IR V1."""

from __future__ import annotations

import re
import math
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

TIMELINE_IR_SCHEMA_VERSION = 1
TIMELINE_IR_MAX_DURATION_MS = 86_400_000
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class TimelineValidationError(ValueError):
    def __init__(self, code: str, path: str, message: str) -> None:
        self.code = code
        self.path = path
        super().__init__(f"{code} at {path}: {message}")


class TimelineModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class TimelineCanvas(TimelineModel):
    width: int = Field(strict=True, ge=1, le=7_680)
    height: int = Field(strict=True, ge=1, le=7_680)
    fps: float = Field(strict=True, ge=1, le=240)


class TimelineTransform(TimelineModel):
    x: float = Field(strict=True, ge=-100_000, le=100_000)
    y: float = Field(strict=True, ge=-100_000, le=100_000)
    scale_x: float = Field(alias="scaleX", strict=True, gt=0, le=100)
    scale_y: float = Field(alias="scaleY", strict=True, gt=0, le=100)
    rotation: float = Field(strict=True, ge=-360_000, le=360_000)
    opacity: float = Field(strict=True, ge=0, le=1)
    anchor_x: float = Field(alias="anchorX", strict=True, ge=0, le=1)
    anchor_y: float = Field(alias="anchorY", strict=True, ge=0, le=1)


class TimelineTransition(TimelineModel):
    kind: Literal["fade", "dissolve", "wipe"]
    duration_ms: int = Field(alias="durationMs", strict=True, ge=1, le=10_000)


class TimelineSubtitleStyle(TimelineModel):
    font_family: str | None = Field(default=None, alias="fontFamily", max_length=128)
    font_size: float | None = Field(default=None, alias="fontSize", strict=True, ge=1, le=512)
    color: str | None = Field(default=None, max_length=9)
    background_color: str | None = Field(default=None, alias="backgroundColor", max_length=9)
    position: Literal["top", "center", "bottom"] | None = None
    max_lines: int | None = Field(default=None, alias="maxLines", strict=True, ge=1, le=8)

    @field_validator("color", "background_color")
    @classmethod
    def validate_color(cls, value: str | None) -> str | None:
        if value is not None and re.fullmatch(r"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?", value) is None:
            raise ValueError("subtitle colors must be #RRGGBB or #RRGGBBAA")
        return value


class TimelineSubtitle(TimelineModel):
    text: str = Field(min_length=1, max_length=8_192)
    language: str | None = Field(default=None, max_length=32)
    style: TimelineSubtitleStyle | None = None


class TimelineSource(TimelineModel):
    id: str
    kind: Literal["asset", "generated", "external"]
    uri: str = Field(min_length=1, max_length=32_767)
    media_type: Literal["video", "audio", "image", "other"] | None = Field(default=None, alias="mediaType")
    duration_ms: int | None = Field(default=None, alias="durationMs", strict=True, ge=1, le=TIMELINE_IR_MAX_DURATION_MS)
    fingerprint: str | None = Field(default=None, max_length=64)
    provenance_ids: list[str] | None = Field(default=None, alias="provenanceIds", max_length=32)
    metadata: dict[str, Any] | None = None

    _id = field_validator("id")(lambda value: _identifier(value, "source.id"))
    _fingerprint = field_validator("fingerprint")(lambda value: _fingerprint(value))
    _provenance_ids = field_validator("provenance_ids")(lambda value: _id_list(value, "source.provenanceIds"))
    _metadata = field_validator("metadata")(lambda value: _metadata(value, "source.metadata"))


class TimelineProvenance(TimelineModel):
    id: str
    kind: Literal["user-supplied", "generated", "external", "derived"]
    source_id: str | None = Field(default=None, alias="sourceId")
    uri: str | None = Field(default=None, max_length=2_048)
    provider: str | None = Field(default=None, max_length=128)
    license: str | None = Field(default=None, max_length=256)
    retrieved_at: str | None = Field(default=None, alias="retrievedAt", max_length=64)
    metadata: dict[str, Any] | None = None

    _id = field_validator("id")(lambda value: _identifier(value, "provenance.id"))
    _source_id = field_validator("source_id")(lambda value: _optional_identifier(value, "provenance.sourceId"))
    @field_validator("retrieved_at")
    @classmethod
    def validate_retrieved_at(cls, value: str | None) -> str | None:
        if value is not None:
            try:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as error:
                raise ValueError("retrievedAt must be an ISO timestamp") from error
        return value
    _metadata = field_validator("metadata")(lambda value: _metadata(value, "provenance.metadata"))


class TimelineClip(TimelineModel):
    id: str
    track_id: str = Field(alias="trackId")
    kind: Literal["video", "audio", "image", "text", "subtitle", "template"]
    source_id: str | None = Field(default=None, alias="sourceId")
    timeline_start_ms: int = Field(alias="timelineStartMs", strict=True, ge=0, le=TIMELINE_IR_MAX_DURATION_MS)
    duration_ms: int = Field(alias="durationMs", strict=True, ge=1, le=TIMELINE_IR_MAX_DURATION_MS)
    source_in_ms: int | None = Field(default=None, alias="sourceInMs", strict=True, ge=0, le=TIMELINE_IR_MAX_DURATION_MS)
    source_out_ms: int | None = Field(default=None, alias="sourceOutMs", strict=True, ge=1, le=TIMELINE_IR_MAX_DURATION_MS)
    transform: TimelineTransform | None = None
    volume: float | None = Field(default=None, strict=True, ge=0, le=4)
    transition_in: TimelineTransition | None = Field(default=None, alias="transitionIn")
    transition_out: TimelineTransition | None = Field(default=None, alias="transitionOut")
    sentence_id: str | None = Field(default=None, alias="sentenceId")
    editable_in_jianying: bool = Field(alias="editableInJianying")
    subtitle: TimelineSubtitle | None = None
    provenance_ids: list[str] | None = Field(default=None, alias="provenanceIds", max_length=32)
    metadata: dict[str, Any] | None = None

    _id = field_validator("id")(lambda value: _identifier(value, "clip.id"))
    _track_id = field_validator("track_id")(lambda value: _identifier(value, "clip.trackId"))
    _source_id = field_validator("source_id")(lambda value: _optional_identifier(value, "clip.sourceId"))
    _sentence_id = field_validator("sentence_id")(lambda value: _optional_identifier(value, "clip.sentenceId"))
    _provenance_ids = field_validator("provenance_ids")(lambda value: _id_list(value, "clip.provenanceIds"))
    _metadata = field_validator("metadata")(lambda value: _metadata(value, "clip.metadata"))

    @model_validator(mode="after")
    def validate_clip_invariants(self) -> "TimelineClip":
        if (self.source_in_ms is None) != (self.source_out_ms is None):
            raise TimelineValidationError("TIMELINE_SOURCE_RANGE_INVALID", "clip", "sourceInMs and sourceOutMs must be provided together")
        if self.source_in_ms is not None and self.source_out_ms is not None:
            if self.source_out_ms <= self.source_in_ms or self.source_out_ms - self.source_in_ms != self.duration_ms:
                raise TimelineValidationError("TIMELINE_SOURCE_RANGE_INVALID", "clip", "source span must equal clip duration")
        if self.kind == "subtitle" and self.subtitle is None:
            raise TimelineValidationError("TIMELINE_INVALID_VALUE", "clip.subtitle", "is required for subtitle clips")
        if self.kind != "subtitle" and self.subtitle is not None:
            raise TimelineValidationError("TIMELINE_INVALID_VALUE", "clip.subtitle", "is only valid for subtitle clips")
        transition_ms = (self.transition_in.duration_ms if self.transition_in else 0) + (self.transition_out.duration_ms if self.transition_out else 0)
        if transition_ms > self.duration_ms:
            raise TimelineValidationError("TIMELINE_INVALID_VALUE", "clip.transition", "transition durations must fit within clip duration")
        return self


class TimelineTrack(TimelineModel):
    id: str
    kind: Literal["video", "audio", "subtitle", "overlay"]
    name: str | None = Field(default=None, max_length=128)
    clips: list[TimelineClip] = Field(max_length=2_048)
    metadata: dict[str, Any] | None = None

    _id = field_validator("id")(lambda value: _identifier(value, "track.id"))
    _metadata = field_validator("metadata")(lambda value: _metadata(value, "track.metadata"))


class TimelineProject(TimelineModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    id: str
    canvas: TimelineCanvas
    duration_ms: int = Field(alias="durationMs", strict=True, ge=1, le=TIMELINE_IR_MAX_DURATION_MS)
    tracks: list[TimelineTrack] = Field(max_length=64)
    sources: list[TimelineSource] = Field(max_length=2_048)
    provenance: list[TimelineProvenance] = Field(max_length=4_096)

    _id = field_validator("id")(lambda value: _identifier(value, "id"))

    @model_validator(mode="after")
    def validate_references(self) -> "TimelineProject":
        source_ids = _unique_ids(self.sources, "source")
        provenance_ids = _unique_ids(self.provenance, "provenance")
        track_ids = _unique_ids(self.tracks, "track")
        clip_ids: set[str] = set()
        source_map = {item.id: item for item in self.sources}
        if not self.tracks or not any(track.clips for track in self.tracks):
            raise TimelineValidationError("TIMELINE_INVALID_VALUE", "tracks", "must contain at least one clip")
        for track in self.tracks:
            for clip in track.clips:
                if clip.id in clip_ids:
                    raise TimelineValidationError("TIMELINE_DUPLICATE_ID", "clip.id", "identifier must be unique")
                clip_ids.add(clip.id)
                if clip.track_id != track.id:
                    raise TimelineValidationError("TIMELINE_REFERENCE_MISSING", "clip.trackId", "must match its parent track")
                if clip.timeline_start_ms + clip.duration_ms > self.duration_ms:
                    raise TimelineValidationError("TIMELINE_CLIP_OUT_OF_BOUNDS", "clip", "must end within project duration")
                compatible = (track.kind == "audio" and clip.kind == "audio") or (track.kind == "subtitle" and clip.kind == "subtitle") or (track.kind == "video" and clip.kind in {"video", "image", "template"}) or (track.kind == "overlay" and clip.kind in {"image", "text", "template"})
                if not compatible:
                    raise TimelineValidationError("TIMELINE_INVALID_VALUE", "clip.kind", "is incompatible with track kind")
                if clip.kind == "subtitle" and clip.subtitle is None:
                    raise TimelineValidationError("TIMELINE_INVALID_VALUE", "clip.subtitle", "is required for subtitle clips")
                if clip.kind != "subtitle" and clip.subtitle is not None:
                    raise TimelineValidationError("TIMELINE_INVALID_VALUE", "clip.subtitle", "is only valid for subtitle clips")
                if clip.kind in {"video", "audio", "image", "template"} and clip.source_id is None:
                    raise TimelineValidationError("TIMELINE_REFERENCE_MISSING", "clip.sourceId", "is required for media clips")
                if clip.source_id is not None and clip.source_id not in source_ids:
                    raise TimelineValidationError("TIMELINE_REFERENCE_MISSING", "clip.sourceId", "must reference a declared source")
                if clip.source_in_ms is not None and clip.source_out_ms is not None:
                    if clip.source_out_ms <= clip.source_in_ms or clip.source_out_ms - clip.source_in_ms != clip.duration_ms:
                        raise TimelineValidationError("TIMELINE_SOURCE_RANGE_INVALID", "clip", "source span must equal clip duration")
                    source = source_map.get(clip.source_id)
                    if source and source.duration_ms is not None and clip.source_out_ms > source.duration_ms:
                        raise TimelineValidationError("TIMELINE_SOURCE_RANGE_INVALID", "clip.sourceOutMs", "must not exceed source duration")
                for provenance_id in clip.provenance_ids or []:
                    if provenance_id not in provenance_ids:
                        raise TimelineValidationError("TIMELINE_REFERENCE_MISSING", "clip.provenanceIds", "must reference declared provenance")
        for source in self.sources:
            for provenance_id in source.provenance_ids or []:
                if provenance_id not in provenance_ids:
                    raise TimelineValidationError("TIMELINE_REFERENCE_MISSING", "source.provenanceIds", "must reference declared provenance")
        for provenance in self.provenance:
            if provenance.source_id is not None and provenance.source_id not in source_ids:
                raise TimelineValidationError("TIMELINE_REFERENCE_MISSING", "provenance.sourceId", "must reference a declared source")
        return self


class TimelineValidateParams(TimelineModel):
    project_id: str = Field(alias="projectId")
    timeline: TimelineProject

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid project id")
        return value


class TimelineValidateResult(TimelineModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    project_id: str = Field(alias="projectId")
    timeline_id: str = Field(alias="timelineId")
    valid: Literal[True]
    duration_ms: int = Field(alias="durationMs", strict=True, ge=1, le=TIMELINE_IR_MAX_DURATION_MS)
    track_count: int = Field(alias="trackCount", strict=True, ge=0, le=64)
    clip_count: int = Field(alias="clipCount", strict=True, ge=1, le=2_048)


def _identifier(value: str, path: str) -> str:
    if ID_PATTERN.fullmatch(value) is None:
        raise ValueError(f"invalid identifier at {path}")
    return value


def _optional_identifier(value: str | None, path: str) -> str | None:
    return None if value is None else _identifier(value, path)


def _id_list(value: list[str] | None, path: str) -> list[str] | None:
    if value is None:
        return None
    if not value or len(set(value)) != len(value):
        raise ValueError(f"{path} must be a non-empty unique list")
    return [_identifier(item, f"{path}[{index}]") for index, item in enumerate(value)]


def _fingerprint(value: str | None) -> str | None:
    if value is not None and SHA256_PATTERN.fullmatch(value) is None:
        raise ValueError("fingerprint must be lowercase SHA-256")
    return value


def _metadata(value: dict[str, Any] | None, path: str) -> dict[str, Any] | None:
    if value is None or _is_bounded_json(value, 0):
        return value
    raise ValueError(f"{path} must be bounded JSON metadata")


def _is_bounded_json(value: Any, depth: int) -> bool:
    if depth > 4:
        return False
    if value is None or isinstance(value, bool):
        return True
    if isinstance(value, str):
        return len(value) <= 2_048 and not any(ord(char) < 32 and char not in "\t\n\r" for char in value)
    if isinstance(value, (int, float)):
        return math.isfinite(value)
    if isinstance(value, list):
        return len(value) <= 32 and all(_is_bounded_json(item, depth + 1) for item in value)
    return isinstance(value, dict) and len(value) <= 64 and all(0 < len(key) <= 128 and _is_bounded_json(item, depth + 1) for key, item in value.items())


def _unique_ids(items: list[Any], kind: str) -> set[str]:
    values = [item.id for item in items]
    if len(values) != len(set(values)):
        raise TimelineValidationError("TIMELINE_DUPLICATE_ID", f"{kind}.id", "identifier must be unique")
    return set(values)


def validate_timeline_project(value: Any) -> TimelineProject:
    return value if isinstance(value, TimelineProject) else TimelineProject.model_validate(value)


def validate_timeline_size(value: TimelineProject | dict[str, Any], maximum_bytes: int = 512 * 1024) -> TimelineProject:
    project = validate_timeline_project(value)
    if len(project.model_dump_json(by_alias=True).encode("utf-8")) > maximum_bytes:
        raise TimelineValidationError("TIMELINE_INVALID_VALUE", "$", "encoded Timeline IR exceeds the size limit")
    return project
