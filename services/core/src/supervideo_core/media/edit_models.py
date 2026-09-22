"""Versioned C09 natural-language timeline edit contracts."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from supervideo_core.timeline.models import TimelineProject

C09_SCHEMA_VERSION = 1
C09_EDIT_VERSION = "timeline-edit-v1"
C09_POLICY = "deterministic-natural-language-v1"
C09_MAX_INPUT_BYTES = 512 * 1024
C09_MAX_RESULT_BYTES = 512 * 1024
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

EditOperation = Literal[
    "delete",
    "replace",
    "move-forward",
    "move-backward",
    "shorten",
    "extend",
    "subtitle",
    "cta",
]


class EditModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class EditIntent(EditModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    edit_version: Literal["edit-intent-v1"] = Field(alias="editVersion")
    policy: Literal["deterministic-natural-language-v1"]
    operation: EditOperation
    target_clip_id: str | None = Field(default=None, alias="targetClipId")
    target_sentence_id: str | None = Field(default=None, alias="targetSentenceId")
    target_text: str | None = Field(default=None, alias="targetText", min_length=1, max_length=256)
    replacement_clip_id: str | None = Field(default=None, alias="replacementClipId")
    text: str | None = Field(default=None, min_length=1, max_length=8_192)
    amount_ms: int | None = Field(default=None, alias="amountMs", strict=True, ge=1, le=60_000)

    @field_validator("target_clip_id", "target_sentence_id", "replacement_clip_id")
    @classmethod
    def validate_ids(cls, value: str | None) -> str | None:
        if value is not None and ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid timeline identifier")
        return value

    @field_validator("target_text", "text")
    @classmethod
    def validate_text(cls, value: str | None) -> str | None:
        if value is not None and any(ord(character) < 32 and character not in "\t\n\r" for character in value):
            raise ValueError("text contains a control character")
        return value

    @model_validator(mode="after")
    def validate_operation_fields(self) -> "EditIntent":
        if not any(value is not None for value in (self.target_clip_id, self.target_sentence_id, self.target_text)):
            raise ValueError("an edit target is required")
        if sum(value is not None for value in (self.target_clip_id, self.target_sentence_id, self.target_text)) > 1:
            raise ValueError("edit target selectors are mutually exclusive")
        if self.operation == "replace" and self.replacement_clip_id is None:
            raise ValueError("replace requires replacementClipId")
        if self.operation in {"subtitle", "cta"} and self.text is None:
            raise ValueError("text is required for subtitle and cta edits")
        if self.operation in {"shorten", "extend"} and self.amount_ms is None:
            raise ValueError("amountMs is required for duration edits")
        if self.operation not in {"replace"} and self.replacement_clip_id is not None:
            raise ValueError("replacementClipId is only valid for replace")
        if self.operation not in {"subtitle", "cta"} and self.text is not None:
            raise ValueError("text is only valid for subtitle and cta edits")
        if self.operation not in {"shorten", "extend"} and self.amount_ms is not None:
            raise ValueError("amountMs is only valid for duration edits")
        return self


class TimelineEditParams(EditModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    edit_version: Literal["timeline-edit-v1"] = Field(alias="editVersion")
    policy: Literal["deterministic-natural-language-v1"]
    project_id: str = Field(alias="projectId")
    timeline: TimelineProject
    instruction: str | None = Field(default=None, min_length=1, max_length=2_048)
    intent: EditIntent | None = None
    timeout_ms: int = Field(default=120_000, alias="timeoutMs", strict=True, ge=1_000, le=120_000)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid edit project id")
        return value

    @field_validator("instruction")
    @classmethod
    def validate_instruction(cls, value: str | None) -> str | None:
        if value is not None and any(ord(character) < 32 and character not in "\t\n\r" for character in value):
            raise ValueError("instruction contains a control character")
        return value

    @model_validator(mode="after")
    def validate_input(self) -> "TimelineEditParams":
        if (self.instruction is None) == (self.intent is None):
            raise ValueError("provide exactly one of instruction or intent")
        if self.intent is not None and self.intent.policy != self.policy:
            raise ValueError("intent policy does not match request policy")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > C09_MAX_INPUT_BYTES:
            raise ValueError("edit input is too large")
        return self


class TimelineEditDiff(EditModel):
    changed_clip_ids: list[str] = Field(alias="changedClipIds", max_length=64)
    removed_clip_ids: list[str] = Field(alias="removedClipIds", max_length=64)
    moved_clip_ids: list[str] = Field(alias="movedClipIds", max_length=64)
    duration_delta_ms: int = Field(alias="durationDeltaMs", strict=True, ge=-86_400_000, le=86_400_000)
    summary: str = Field(min_length=1, max_length=256)
    preserved_source_ids: list[str] = Field(alias="preservedSourceIds", max_length=2_048)
    preserved_provenance_ids: list[str] = Field(alias="preservedProvenanceIds", max_length=4_096)


class TimelineEditRejection(EditModel):
    code: Literal[
        "EDIT_UNSUPPORTED_INSTRUCTION",
        "EDIT_TARGET_NOT_FOUND",
        "EDIT_AMBIGUOUS_TARGET",
        "EDIT_REPLACEMENT_NOT_FOUND",
        "EDIT_COMPLETE_SENTENCE_REQUIRED",
        "EDIT_TIMELINE_EMPTY",
        "EDIT_OPERATION_UNSAFE",
        "EDIT_TIMELINE_INVALID",
    ]
    message: str = Field(min_length=1, max_length=256)
    target_clip_id: str | None = Field(default=None, alias="targetClipId")


class TimelineEditResult(EditModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    edit_version: Literal["timeline-edit-v1"] = Field(alias="editVersion")
    policy: Literal["deterministic-natural-language-v1"]
    project_id: str = Field(alias="projectId")
    input_kind: Literal["natural-language", "structured"] = Field(alias="inputKind")
    status: Literal["applied", "rejected"]
    source_timeline_id: str = Field(alias="sourceTimelineId")
    result_timeline: TimelineProject = Field(alias="resultTimeline")
    intent: EditIntent
    diff: TimelineEditDiff
    rejection: TimelineEditRejection | None = None
    determinism_digest: str = Field(alias="determinismDigest", min_length=64, max_length=64)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid edit result project id")
        return value

    @field_validator("determinism_digest")
    @classmethod
    def validate_digest(cls, value: str) -> str:
        if re.fullmatch(r"[0-9a-f]{64}", value) is None:
            raise ValueError("invalid edit digest")
        return value

    @model_validator(mode="after")
    def validate_result(self) -> "TimelineEditResult":
        if (self.status == "rejected") != (self.rejection is not None):
            raise ValueError("rejection must match edit status")
        if self.status == "applied" and self.result_timeline.id == self.source_timeline_id:
            raise ValueError("applied edit must produce a new timeline id")
        expected_sources = sorted(item.id for item in self.result_timeline.sources)
        expected_provenance = sorted(item.id for item in self.result_timeline.provenance)
        if self.diff.preserved_source_ids != expected_sources or self.diff.preserved_provenance_ids != expected_provenance:
            raise ValueError("edit diff must preserve the complete declared source and provenance sets")
        if len(set(self.diff.changed_clip_ids)) != len(self.diff.changed_clip_ids):
            raise ValueError("changed clip ids must be unique")
        if len(set(self.diff.removed_clip_ids)) != len(self.diff.removed_clip_ids):
            raise ValueError("removed clip ids must be unique")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > C09_MAX_RESULT_BYTES:
            raise ValueError("edit result is too large")
        return self
