"""Versioned D02 text-to-speech models and bounded output contract."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


TTS_SCHEMA_VERSION = 1
TTS_CONTRACT_VERSION = 1
TTS_JOB_TYPE = "tts.synthesize"
TTS_ADAPTER_VERSION = "fake-tts-v1"
TTS_MAX_SENTENCES = 256
TTS_MAX_TEXT_LENGTH = 4_096
TTS_MAX_TOTAL_TEXT_LENGTH = 16_000
TTS_MAX_DURATION_MS = 600_000
TTS_MAX_RESULT_BYTES = 48 * 1024
TTS_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
TTS_OUTPUT_DIRECTORY = "generated/tts-v1"
_UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_PROVIDER_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_OUTPUT_PATTERN = re.compile(r"^generated/tts-v1/[0-9a-f]{64}\.wav$")


class TtsModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class TtsSentenceInput(TtsModel):
    sentence_id: str = Field(alias="sentenceId", min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=TTS_MAX_TEXT_LENGTH)
    provenance_ids: list[str] = Field(default_factory=list, alias="provenanceIds", max_length=16)

    @field_validator("sentence_id")
    @classmethod
    def validate_sentence_id(cls, value: str) -> str:
        if _ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid sentence id")
        return value

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("invalid sentence text")
        return value.strip()

    @field_validator("provenance_ids")
    @classmethod
    def validate_provenance_ids(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or any(_ID_PATTERN.fullmatch(item) is None for item in value):
            raise ValueError("invalid sentence provenance")
        return value


class TtsJobInput(TtsModel):
    """The durable job input. It intentionally has no credentialRef or secret."""

    provider_id: str = Field(alias="providerId", min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=128)
    voice: str = Field(min_length=1, max_length=128)
    sentences: list[TtsSentenceInput] = Field(min_length=1, max_length=TTS_MAX_SENTENCES)

    @field_validator("provider_id")
    @classmethod
    def validate_provider_id(cls, value: str) -> str:
        if _PROVIDER_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid provider id")
        return value

    @field_validator("model", "voice")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("invalid tts selection")
        return value.strip()

    @model_validator(mode="after")
    def validate_sentences(self) -> "TtsJobInput":
        if len({item.sentence_id for item in self.sentences}) != len(self.sentences):
            raise ValueError("duplicate sentence id")
        if sum(len(item.text) for item in self.sentences) > TTS_MAX_TOTAL_TEXT_LENGTH:
            raise ValueError("tts input is too large")
        return self


class TtsJobStartParams(TtsJobInput):
    project_id: str = Field(alias="projectId")
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=256)

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if _UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid project id")
        return value


class TtsSentenceTimestamp(TtsModel):
    sentence_id: str = Field(alias="sentenceId", min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=TTS_MAX_TEXT_LENGTH)
    start_ms: int = Field(alias="startMs", strict=True, ge=0, le=TTS_MAX_DURATION_MS)
    end_ms: int = Field(alias="endMs", strict=True, gt=0, le=TTS_MAX_DURATION_MS)
    provenance_ids: list[str] = Field(alias="provenanceIds", max_length=16)

    @field_validator("sentence_id")
    @classmethod
    def validate_sentence_id(cls, value: str) -> str:
        if _ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid sentence id")
        return value

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("invalid sentence text")
        return value.strip()

    @field_validator("provenance_ids")
    @classmethod
    def validate_provenance_ids(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or any(_ID_PATTERN.fullmatch(item) is None for item in value):
            raise ValueError("invalid sentence provenance")
        return value

    @model_validator(mode="after")
    def validate_range(self) -> "TtsSentenceTimestamp":
        if self.end_ms <= self.start_ms:
            raise ValueError("invalid sentence timestamp")
        return self


class TtsAudioOutput(TtsModel):
    kind: Literal["audio"]
    relative_path: str = Field(alias="relativePath", min_length=1, max_length=512)
    size_bytes: int = Field(alias="sizeBytes", strict=True, gt=0, le=TTS_MAX_OUTPUT_BYTES)
    duration_ms: int = Field(alias="durationMs", strict=True, gt=0, le=TTS_MAX_DURATION_MS)
    output_fingerprint: str = Field(alias="outputFingerprint", min_length=64, max_length=64)

    @field_validator("relative_path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        if _OUTPUT_PATTERN.fullmatch(value) is None:
            raise ValueError("tts output is outside the generated boundary")
        return value

    @field_validator("output_fingerprint")
    @classmethod
    def validate_fingerprint(cls, value: str) -> str:
        if _SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid output fingerprint")
        return value


class TtsProvenance(TtsModel):
    kind: Literal["generated"]
    provider_id: str = Field(alias="providerId", min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=128)
    voice: str = Field(min_length=1, max_length=128)
    adapter_version: str = Field(alias="adapterVersion", min_length=1, max_length=64)

    @field_validator("provider_id")
    @classmethod
    def validate_provider_id(cls, value: str) -> str:
        if _PROVIDER_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid provider id")
        return value

    @field_validator("model", "voice", "adapter_version")
    @classmethod
    def validate_names(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("invalid tts provenance")
        return value.strip()


class TtsSynthesisResult(TtsModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal[1] = Field(alias="contractVersion")
    adapter_version: str = Field(alias="adapterVersion", min_length=1, max_length=64)
    project_id: str = Field(alias="projectId")
    cache_status: Literal["created", "cache-hit"] = Field(alias="cacheStatus")
    cache_key: str = Field(alias="cacheKey", min_length=64, max_length=64)
    provider_id: str = Field(alias="providerId", min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=128)
    voice: str = Field(min_length=1, max_length=128)
    duration_ms: int = Field(alias="durationMs", strict=True, gt=0, le=TTS_MAX_DURATION_MS)
    sentences: list[TtsSentenceTimestamp] = Field(max_length=TTS_MAX_SENTENCES)
    output: TtsAudioOutput
    provenance: TtsProvenance

    @field_validator("adapter_version")
    @classmethod
    def validate_adapter_version(cls, value: str) -> str:
        if not value.strip() or any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("invalid adapter version")
        return value.strip()

    @field_validator("project_id")
    @classmethod
    def validate_result_project_id(cls, value: str) -> str:
        if _UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid result project id")
        return value

    @field_validator("cache_key")
    @classmethod
    def validate_cache_key(cls, value: str) -> str:
        if _SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid cache key")
        return value

    @model_validator(mode="after")
    def validate_result(self) -> "TtsSynthesisResult":
        if (
            not self.sentences
            or self.sentences[0].start_ms != 0
            or any(previous.end_ms != current.start_ms for previous, current in zip(self.sentences, self.sentences[1:]))
            or len({item.sentence_id for item in self.sentences}) != len(self.sentences)
            or self.sentences[-1].end_ms != self.duration_ms
            or self.output.relative_path != f"{TTS_OUTPUT_DIRECTORY}/{self.cache_key}.wav"
        ):
            raise ValueError("tts duration does not match sentence timestamps")
        if self.provenance.provider_id != self.provider_id or self.provenance.model != self.model or self.provenance.voice != self.voice or self.provenance.adapter_version != self.adapter_version:
            raise ValueError("tts provenance does not match selection")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > TTS_MAX_RESULT_BYTES:
            raise ValueError("tts result is too large")
        return self
