"""D01 provider contracts for Python Core.

Core validates and consumes only secret-free configuration. Decryption and
provider health execution remain Electron Main responsibilities.
"""
from __future__ import annotations

from typing import Literal
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

ProviderKind = Literal["llm", "tts", "image", "video"]
ProviderCapability = Literal["chat.generate", "chat.stream", "speech.synthesize", "image.generate", "video.generate"]
ProviderHealthErrorCode = Literal["UNKNOWN_PROVIDER", "CONFIG_INVALID", "MISSING_CREDENTIAL", "CREDENTIAL_UNAVAILABLE", "AUTH_FAILED", "NETWORK_ERROR", "TIMEOUT", "INVALID_RESPONSE", "UNSUPPORTED_CAPABILITY", "INTERNAL"]


class ProviderContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class ProviderConfig(ProviderContractModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    protocol_version: Literal[1] = Field(alias="protocolVersion")
    project_id: UUID = Field(alias="projectId")
    service_kind: ProviderKind = Field(alias="serviceKind")
    provider_id: str = Field(alias="providerId", pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$")
    display_name: str = Field(alias="displayName", min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=128)
    endpoint: str | None = Field(default=None, max_length=512)
    credential_ref: str | None = Field(default=None, alias="credentialRef", pattern=r"^cred-[A-Za-z0-9._:-]{1,63}$")
    capabilities: tuple[ProviderCapability, ...] = Field(min_length=1, max_length=16)
    enabled: bool
    created_at_ms: int = Field(alias="createdAtMs", ge=0)
    updated_at_ms: int = Field(alias="updatedAtMs", ge=0)

    @field_validator("display_name", "model")
    @classmethod
    def no_control_chars(cls, value: str) -> str:
        if value != value.strip() or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("text is invalid")
        return value

    @field_validator("endpoint")
    @classmethod
    def safe_endpoint(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlparse(value)
        if parsed.scheme not in {"https", "http"} or not parsed.netloc or parsed.username or parsed.password or parsed.fragment:
            raise ValueError("endpoint is invalid")
        if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("plain HTTP is limited to loopback")
        return value

    @field_validator("capabilities")
    @classmethod
    def unique_capabilities(cls, value: tuple[ProviderCapability, ...]) -> tuple[ProviderCapability, ...]:
        if len(set(value)) != len(value):
            raise ValueError("capabilities must be unique")
        return value


class ProviderHealthError(ProviderContractModel):
    code: ProviderHealthErrorCode
    retryable: bool


class ProviderHealth(ProviderContractModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    protocol_version: Literal[1] = Field(alias="protocolVersion")
    project_id: UUID = Field(alias="projectId")
    service_kind: ProviderKind = Field(alias="serviceKind")
    provider_id: str = Field(alias="providerId", pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$")
    status: Literal["healthy", "unhealthy", "unconfigured", "unknown"]
    capabilities: tuple[ProviderCapability, ...] = Field(min_length=1, max_length=16)
    checked_at_ms: int = Field(alias="checkedAtMs", ge=0)
    latency_ms: int | None = Field(alias="latencyMs", default=None, ge=0)
    error: ProviderHealthError | None = None


ProviderHealthResult = ProviderHealth


def provider_capabilities(service_kind: str) -> tuple[str, ...]:
    return {
        "llm": ("chat.generate", "chat.stream"),
        "tts": ("speech.synthesize",),
        "image": ("image.generate",),
        "video": ("video.generate",),
    }.get(service_kind, ())
