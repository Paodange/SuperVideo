"""Versioned D06 image-generation models and bounded offline output contract."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

IMAGE_SCHEMA_VERSION = 1
IMAGE_CONTRACT_VERSION = 1
IMAGE_JOB_TYPE = "image.generate"
IMAGE_ADAPTER_VERSION = "fake-image-v1"
IMAGE_OUTPUT_DIRECTORY = "generated/images-v1"
IMAGE_MAX_PROMPT_LENGTH = 4_096
IMAGE_MAX_PROVENANCE = 32
IMAGE_MAX_RESULT_BYTES = 48 * 1024
IMAGE_MAX_OUTPUT_BYTES = 1 * 1024 * 1024
IMAGE_MAX_PIXELS = 1_048_576
_UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_PROVIDER_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_OUTPUT_PATTERN = re.compile(r"^generated/images-v1/[0-9a-f]{64}\.png$")
_PATH_PATTERN = re.compile(r"(?:https?|file|data)://|(?:^|\s)(?:[A-Za-z]:[\\/]|[\\/]{2}|~/)|[\\/]")
_SECRET_PATTERN = re.compile(r"\b(?:api[_ -]?key|access[_ -]?token|bearer|credential|secret|password|provider|command|token)\b", re.IGNORECASE)


class ImageModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True, populate_by_name=True)


class ImageParameters(ImageModel):
    width: int = Field(strict=True, ge=64, le=1_024)
    height: int = Field(strict=True, ge=64, le=1_024)
    steps: int = Field(strict=True, ge=1, le=64)
    seed: int = Field(strict=True, ge=0, le=2_147_483_647)

    @model_validator(mode="after")
    def validate_pixels(self) -> "ImageParameters":
        if self.width * self.height > IMAGE_MAX_PIXELS:
            raise ValueError("image dimensions are too large")
        return self


class ImageSource(ImageModel):
    kind: Literal["d05-shot", "user-brief", "fact"]
    id: str = Field(min_length=1, max_length=128)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if _ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid image source id")
        return value


class ImageProvenance(ImageModel):
    kind: Literal["script", "fact", "source"]
    id: str = Field(min_length=1, max_length=128)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if _ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid image provenance id")
        return value


class ImageJobInput(ImageModel):
    """Durable job input. No secret, credentialRef, command, or path is allowed."""

    provider_id: str = Field(alias="providerId", min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=128)
    shot_id: str = Field(alias="shotId", min_length=1, max_length=128)
    prompt: str = Field(min_length=1, max_length=IMAGE_MAX_PROMPT_LENGTH)
    parameters: ImageParameters
    source: ImageSource
    provenance: list[ImageProvenance] = Field(min_length=1, max_length=IMAGE_MAX_PROVENANCE)

    @field_validator("provider_id")
    @classmethod
    def validate_provider_id(cls, value: str) -> str:
        if _PROVIDER_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid image provider id")
        return value

    @field_validator("model", "shot_id")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value.strip() or value != value.strip() or _PATH_PATTERN.search(value) or _SECRET_PATTERN.search(value):
            raise ValueError("invalid image selection")
        if not _ID_PATTERN.fullmatch(value) and len(value) > 128:
            raise ValueError("invalid image selection")
        return value

    @field_validator("prompt")
    @classmethod
    def validate_prompt(cls, value: str) -> str:
        if not value.strip() or _PATH_PATTERN.search(value) or _SECRET_PATTERN.search(value):
            raise ValueError("invalid image prompt")
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("invalid image prompt")
        return value

    @model_validator(mode="after")
    def validate_provenance(self) -> "ImageJobInput":
        if len({item.id for item in self.provenance}) != len(self.provenance):
            raise ValueError("duplicate image provenance")
        return self


class ImageJobStartParams(ImageJobInput):
    project_id: str = Field(alias="projectId")
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=256)

    @field_validator("idempotency_key")
    @classmethod
    def validate_idempotency_key(cls, value: str) -> str:
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("invalid image idempotency key")
        return value

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if _UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid project id")
        return value


class ImageOutput(ImageModel):
    kind: Literal["image"]
    mime_type: Literal["image/png"] = Field(alias="mimeType")
    relative_path: str = Field(alias="relativePath", min_length=1, max_length=512)
    size_bytes: int = Field(alias="sizeBytes", strict=True, gt=0, le=IMAGE_MAX_OUTPUT_BYTES)
    width: int = Field(strict=True, ge=64, le=1_024)
    height: int = Field(strict=True, ge=64, le=1_024)
    output_fingerprint: str = Field(alias="outputFingerprint", min_length=64, max_length=64)

    @field_validator("relative_path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        if _OUTPUT_PATTERN.fullmatch(value) is None:
            raise ValueError("image output is outside generated boundary")
        return value

    @field_validator("output_fingerprint")
    @classmethod
    def validate_fingerprint(cls, value: str) -> str:
        if _SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid image fingerprint")
        return value

    @model_validator(mode="after")
    def validate_dimensions(self) -> "ImageOutput":
        if self.width * self.height > IMAGE_MAX_PIXELS:
            raise ValueError("image output dimensions are too large")
        return self


class ImageGenerationProvenance(ImageModel):
    kind: Literal["generated"]
    provider_id: str = Field(alias="providerId", min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=128)
    adapter_version: str = Field(alias="adapterVersion", min_length=1, max_length=64)
    source: ImageSource
    provenance: list[ImageProvenance] = Field(min_length=1, max_length=IMAGE_MAX_PROVENANCE)

    @field_validator("provider_id")
    @classmethod
    def validate_provider_id(cls, value: str) -> str:
        if _PROVIDER_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid image provider id")
        return value

    @field_validator("model", "adapter_version")
    @classmethod
    def validate_names(cls, value: str) -> str:
        if not value.strip() or value != value.strip() or _PATH_PATTERN.search(value) or _SECRET_PATTERN.search(value):
            raise ValueError("invalid image provenance")
        return value


class ImageGenerationResult(ImageModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    contract_version: Literal[1] = Field(alias="contractVersion")
    adapter_version: str = Field(alias="adapterVersion", min_length=1, max_length=64)
    project_id: str = Field(alias="projectId")
    cache_status: Literal["created", "cache-hit"] = Field(alias="cacheStatus")
    cache_key: str = Field(alias="cacheKey", min_length=64, max_length=64)
    provider_id: str = Field(alias="providerId", min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=128)
    shot_id: str = Field(alias="shotId", min_length=1, max_length=128)
    prompt: str = Field(min_length=1, max_length=IMAGE_MAX_PROMPT_LENGTH)
    parameters: ImageParameters
    source: ImageSource
    provenance: list[ImageProvenance] = Field(min_length=1, max_length=IMAGE_MAX_PROVENANCE)
    output: ImageOutput
    generation_provenance: ImageGenerationProvenance = Field(alias="generationProvenance")

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, value: str) -> str:
        if _UUID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid result project id")
        return value

    @field_validator("cache_key")
    @classmethod
    def validate_cache_key(cls, value: str) -> str:
        if _SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid image cache key")
        return value

    @model_validator(mode="after")
    def validate_result(self) -> "ImageGenerationResult":
        ImageJobInput(
            providerId=self.provider_id,
            model=self.model,
            shotId=self.shot_id,
            prompt=self.prompt,
            parameters=self.parameters,
            source=self.source,
            provenance=self.provenance,
        )
        if (
            self.output.relative_path != f"{IMAGE_OUTPUT_DIRECTORY}/{self.cache_key}.png"
            or self.output.width != self.parameters.width
            or self.output.height != self.parameters.height
            or self.generation_provenance.provider_id != self.provider_id
            or self.generation_provenance.model != self.model
            or self.generation_provenance.adapter_version != self.adapter_version
            or self.generation_provenance.source != self.source
            or self.generation_provenance.provenance != self.provenance
        ):
            raise ValueError("image result does not match selection")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > IMAGE_MAX_RESULT_BYTES:
            raise ValueError("image result is too large")
        return self


__all__ = [
    "IMAGE_ADAPTER_VERSION", "IMAGE_CONTRACT_VERSION", "IMAGE_JOB_TYPE", "IMAGE_MAX_OUTPUT_BYTES", "IMAGE_OUTPUT_DIRECTORY",
    "ImageGenerationProvenance", "ImageGenerationResult", "ImageJobInput", "ImageJobStartParams", "ImageOutput",
    "ImageParameters", "ImageProvenance", "ImageSource", "IMAGE_SCHEMA_VERSION",
]
