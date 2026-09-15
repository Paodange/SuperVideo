"""Strict typed records used by the SQLite repositories."""

from __future__ import annotations

import json
import math
import os
import re
import time
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


STORAGE_MAX_JSON_BYTES = 256 * 1024
STORAGE_MAX_LIST_LIMIT = 1_000
STORAGE_DEFAULT_LIST_LIMIT = 100
STORAGE_MAX_TEXT_LENGTH = 64 * 1024
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

JobStatus = Literal[
    "queued",
    "running",
    "succeeded",
    "failed",
    "retrying",
    "cancelling",
    "cancelled",
    "needs_attention",
]
MessageRole = Literal["user", "assistant", "tool", "system"]


class StorageModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, validate_assignment=True)


def utc_now_ms() -> int:
    return time.time_ns() // 1_000_000


def new_id() -> str:
    return str(uuid4())


def validate_id(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("id must be a string")
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError, TypeError) as error:
        raise ValueError("id must be a UUID") from error
    normalized = str(parsed)
    if UUID_PATTERN.fullmatch(normalized) is None:
        raise ValueError("id must be a UUID")
    return normalized


def validate_optional_id(value: str | None) -> str | None:
    if value is None:
        return None
    return validate_id(value)


def normalize_absolute_path(value: str) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("path is invalid")
    if not os.path.isabs(value):
        raise ValueError("path must be absolute")
    if len(value) > 32_767:
        raise ValueError("path is too long")
    # Do not resolve symlinks or inspect the filesystem.  A06 owns path
    # selection; A05 stores the lexical normalized reference only.
    return os.path.normcase(os.path.abspath(os.path.normpath(value)))


def _validate_json_value(value: Any, *, depth: int = 0, seen: set[int] | None = None) -> None:
    if depth > 32:
        raise ValueError("JSON value is too deeply nested")
    if value is None or isinstance(value, (str, bool)):
        return
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > 9_007_199_254_740_991:
            raise ValueError("JSON integer is outside the safe range")
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("JSON number is not finite")
        return
    if seen is None:
        seen = set()
    identity = id(value)
    if identity in seen:
        raise ValueError("JSON value is circular")
    seen.add(identity)
    try:
        if isinstance(value, list):
            for item in value:
                _validate_json_value(item, depth=depth + 1, seen=seen)
            return
        if isinstance(value, dict):
            for key, item in value.items():
                if not isinstance(key, str) or len(key) > 256:
                    raise ValueError("JSON object key is invalid")
                _validate_json_value(item, depth=depth + 1, seen=seen)
            return
    finally:
        seen.remove(identity)
    raise ValueError("value is not JSON-safe")


def serialize_json_value(value: Any) -> str:
    """Validate and serialize a JSON-safe value deterministically."""

    _validate_json_value(value)
    try:
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("value is not JSON-safe") from error
    if len(encoded.encode("utf-8")) > STORAGE_MAX_JSON_BYTES:
        raise ValueError("JSON value is too large")
    return encoded


def deserialize_json_value(value: str) -> Any:
    if not isinstance(value, str) or len(value.encode("utf-8")) > STORAGE_MAX_JSON_BYTES:
        raise ValueError("stored JSON is invalid")
    try:
        decoded = json.loads(value, parse_constant=_reject_non_finite)
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("stored JSON is invalid") from error
    _validate_json_value(decoded)
    return decoded


def _reject_non_finite(_value: str) -> object:
    raise ValueError("non-finite JSON number")


def _json_field(value: Any) -> Any:
    serialize_json_value(value)
    return value


class ProjectRecord(StorageModel):
    id: str = Field(default_factory=new_id)
    name: str = Field(min_length=1, max_length=200)
    project_root: str
    target_platform: str = Field(default="douyin", min_length=1, max_length=64)
    config_json: dict[str, Any] = Field(default_factory=dict)
    created_at_ms: int = Field(default_factory=utc_now_ms, strict=True, ge=0)
    updated_at_ms: int = Field(default_factory=utc_now_ms, strict=True, ge=0)
    revision: int = Field(default=0, strict=True, ge=0)

    _id = field_validator("id")(validate_id)
    _root = field_validator("project_root")(normalize_absolute_path)
    _config = field_validator("config_json", mode="before")(_json_field)


ProjectCreate = ProjectRecord
Project = ProjectRecord


class AssetRecord(StorageModel):
    id: str = Field(default_factory=new_id)
    project_id: str
    absolute_path: str
    kind: str = Field(min_length=1, max_length=64)
    size_bytes: int = Field(strict=True, ge=0)
    modified_at_ms: int = Field(strict=True, ge=0)
    content_fingerprint: str = Field(min_length=1, max_length=512)
    source_type: str = Field(min_length=1, max_length=64)
    license_json: dict[str, Any] = Field(default_factory=dict)
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at_ms: int = Field(default_factory=utc_now_ms, strict=True, ge=0)
    updated_at_ms: int = Field(default_factory=utc_now_ms, strict=True, ge=0)

    _id = field_validator("id")(validate_id)
    _project_id = field_validator("project_id")(validate_id)
    _path = field_validator("absolute_path")(normalize_absolute_path)
    _license = field_validator("license_json", mode="before")(_json_field)
    _metadata = field_validator("metadata_json", mode="before")(_json_field)


AssetCreate = AssetRecord
Asset = AssetRecord


class JobRecord(StorageModel):
    id: str = Field(default_factory=new_id)
    project_id: str
    job_type: str = Field(min_length=1, max_length=128)
    status: JobStatus = "queued"
    progress: float = Field(default=0.0, strict=True, ge=0.0, le=1.0)
    stage: str | None = Field(default=None, max_length=128)
    input_json: dict[str, Any] = Field(default_factory=dict)
    result_json: dict[str, Any] | None = None
    error_code: str | None = Field(default=None, max_length=128)
    idempotency_key: str | None = Field(default=None, max_length=256)
    attempt: int = Field(default=0, strict=True, ge=0)
    created_at_ms: int = Field(default_factory=utc_now_ms, strict=True, ge=0)
    updated_at_ms: int = Field(default_factory=utc_now_ms, strict=True, ge=0)
    started_at_ms: int | None = Field(default=None, strict=True, ge=0)
    finished_at_ms: int | None = Field(default=None, strict=True, ge=0)

    _id = field_validator("id")(validate_id)
    _project_id = field_validator("project_id")(validate_id)
    _input = field_validator("input_json", mode="before")(_json_field)
    _result = field_validator("result_json", mode="before")(_json_field)


JobCreate = JobRecord
Job = JobRecord


class MessageCreate(StorageModel):
    id: str = Field(default_factory=new_id)
    project_id: str
    conversation_id: str = Field(min_length=1, max_length=256)
    sequence: int | None = Field(default=None, strict=True, ge=1)
    role: MessageRole
    message_type: str = Field(min_length=1, max_length=64)
    content_json: Any
    created_at_ms: int = Field(default_factory=utc_now_ms, strict=True, ge=0)

    _id = field_validator("id")(validate_id)
    _project_id = field_validator("project_id")(validate_id)
    _content = field_validator("content_json", mode="before")(_json_field)


class MessageRecord(StorageModel):
    id: str
    project_id: str
    conversation_id: str = Field(min_length=1, max_length=256)
    sequence: int = Field(strict=True, ge=1)
    role: MessageRole
    message_type: str = Field(min_length=1, max_length=64)
    content_json: Any
    created_at_ms: int = Field(strict=True, ge=0)

    _id = field_validator("id")(validate_id)
    _project_id = field_validator("project_id")(validate_id)
    _content = field_validator("content_json", mode="before")(_json_field)


Message = MessageRecord


class TimelineVersionCreate(StorageModel):
    id: str = Field(default_factory=new_id)
    project_id: str
    version_number: int | None = Field(default=None, strict=True, ge=1)
    parent_version_id: str | None = None
    schema_version: int = Field(default=1, strict=True, ge=1)
    timeline_json: dict[str, Any]
    edit_intent_json: dict[str, Any] = Field(default_factory=dict)
    diff_summary_json: dict[str, Any] = Field(default_factory=dict)
    created_at_ms: int = Field(default_factory=utc_now_ms, strict=True, ge=0)

    _id = field_validator("id")(validate_id)
    _project_id = field_validator("project_id")(validate_id)
    _parent = field_validator("parent_version_id")(validate_optional_id)
    _timeline = field_validator("timeline_json", mode="before")(_json_field)
    _intent = field_validator("edit_intent_json", mode="before")(_json_field)
    _diff = field_validator("diff_summary_json", mode="before")(_json_field)


class TimelineVersionRecord(StorageModel):
    id: str
    project_id: str
    version_number: int = Field(strict=True, ge=1)
    parent_version_id: str | None = None
    schema_version: int = Field(strict=True, ge=1)
    timeline_json: dict[str, Any]
    edit_intent_json: dict[str, Any] = Field(default_factory=dict)
    diff_summary_json: dict[str, Any] = Field(default_factory=dict)
    created_at_ms: int = Field(strict=True, ge=0)

    _id = field_validator("id")(validate_id)
    _project_id = field_validator("project_id")(validate_id)
    _parent = field_validator("parent_version_id")(validate_optional_id)
    _timeline = field_validator("timeline_json", mode="before")(_json_field)
    _intent = field_validator("edit_intent_json", mode="before")(_json_field)
    _diff = field_validator("diff_summary_json", mode="before")(_json_field)


TimelineVersion = TimelineVersionRecord
