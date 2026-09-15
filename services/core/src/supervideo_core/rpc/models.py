"""Strict Pydantic models for the versioned Core JSON-RPC contract."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from supervideo_core import __version__
from supervideo_core.project.models import (
    AssetListRequest,
    AssetReferenceRequest,
    ProjectCreateRequest,
    ProjectInspectRequest,
    ProjectOpenRequest,
)

JSON_RPC_VERSION = "2.0"
CORE_RPC_PROTOCOL_VERSION = 1
CORE_RPC_MAX_LINE_BYTES = 256 * 1024
CORE_RPC_MAX_REQUEST_ID_LENGTH = 64
CORE_RPC_MAX_METHOD_LENGTH = 128
CORE_RPC_MAX_PROGRESS_MESSAGE_LENGTH = 256

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class RpcRequest(StrictModel):
    jsonrpc: Literal["2.0"]
    id: str
    method: str
    params: dict[str, Any]

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not value or len(value) > CORE_RPC_MAX_REQUEST_ID_LENGTH or REQUEST_ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid request id")
        return value

    @field_validator("method")
    @classmethod
    def validate_method(cls, value: str) -> str:
        if not value or len(value) > CORE_RPC_MAX_METHOD_LENGTH:
            raise ValueError("invalid method")
        return value


class HealthParams(StrictModel):
    pass


class SmokeCountdownParams(StrictModel):
    steps: int = Field(strict=True, ge=3, le=8)
    delay_ms: int = Field(alias="delayMs", strict=True, ge=1, le=1_000)


class CancelParams(StrictModel):
    request_id: str = Field(alias="requestId")

    @field_validator("request_id")
    @classmethod
    def validate_request_id(cls, value: str) -> str:
        if not value or len(value) > CORE_RPC_MAX_REQUEST_ID_LENGTH or REQUEST_ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid request id")
        return value


class CoreHealth(StrictModel):
    service: Literal["python-core"]
    status: Literal["ok"]
    protocol_version: Literal[1] = Field(alias="protocolVersion")
    core_version: str = Field(alias="coreVersion", min_length=1, max_length=32)
    capabilities: list[str] = Field(max_length=16)

    @field_validator("capabilities")
    @classmethod
    def validate_capabilities(cls, value: list[str]) -> list[str]:
        if any(not item or len(item) > 64 for item in value):
            raise ValueError("invalid capability")
        return value


class SmokeCountdownResult(StrictModel):
    status: Literal["completed"]
    steps: int = Field(strict=True, ge=3, le=8)


class ProgressParams(StrictModel):
    request_id: str = Field(alias="requestId")
    sequence: int = Field(strict=True, ge=1)
    progress: float = Field(strict=True, ge=0, le=1)
    message: str = Field(max_length=CORE_RPC_MAX_PROGRESS_MESSAGE_LENGTH)

    @field_validator("request_id")
    @classmethod
    def validate_request_id(cls, value: str) -> str:
        if not value or len(value) > CORE_RPC_MAX_REQUEST_ID_LENGTH or REQUEST_ID_PATTERN.fullmatch(value) is None:
            raise ValueError("invalid request id")
        return value


class RpcProgressNotification(StrictModel):
    jsonrpc: Literal["2.0"]
    method: Literal["core.progress"]
    params: ProgressParams


class RpcCancelNotification(StrictModel):
    jsonrpc: Literal["2.0"]
    method: Literal["core.cancel"]
    params: CancelParams


class RpcErrorData(StrictModel):
    error_code: str = Field(alias="errorCode")


class RpcErrorObject(StrictModel):
    code: int = Field(strict=True)
    message: str = Field(max_length=128)
    data: RpcErrorData

    @model_validator(mode="after")
    def validate_stable_error(self) -> "RpcErrorObject":
        from .errors import ERRORS

        definition = ERRORS.get(self.data.error_code)
        if definition is None or self.code != definition.code or self.message != definition.message:
            raise ValueError("unstable error")
        return self


class RpcSuccessResponse(StrictModel):
    jsonrpc: Literal["2.0"]
    id: str | None
    result: Any

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str | None) -> str | None:
        if value is not None and (not value or len(value) > CORE_RPC_MAX_REQUEST_ID_LENGTH or REQUEST_ID_PATTERN.fullmatch(value) is None):
            raise ValueError("invalid response id")
        return value


class RpcErrorResponse(StrictModel):
    jsonrpc: Literal["2.0"]
    id: str | None
    error: RpcErrorObject

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str | None) -> str | None:
        if value is not None and (not value or len(value) > CORE_RPC_MAX_REQUEST_ID_LENGTH or REQUEST_ID_PATTERN.fullmatch(value) is None):
            raise ValueError("invalid response id")
        return value


def validate_request(value: Any) -> RpcRequest:
    """Validate a request envelope and its known-method parameter shape."""

    request = RpcRequest.model_validate(value)
    if request.method == "core.health":
        HealthParams.model_validate(request.params)
    elif request.method == "core.smoke.countdown":
        SmokeCountdownParams.model_validate(request.params)
    elif request.method == "core.cancel":
        raise ValueError("cancel must be a notification")
    elif request.method == "project.create":
        ProjectCreateRequest.model_validate(request.params)
    elif request.method == "project.open":
        ProjectOpenRequest.model_validate(request.params)
    elif request.method == "project.inspect":
        ProjectInspectRequest.model_validate(request.params)
    elif request.method == "asset.reference":
        AssetReferenceRequest.model_validate(request.params)
    elif request.method == "asset.list":
        AssetListRequest.model_validate(request.params)
    return request


def validate_rpc_message(value: Any) -> Any:
    """Validate one fixture/message, accepting requests and server messages."""

    if isinstance(value, list) or not isinstance(value, dict):
        raise ValueError("JSON-RPC batch and scalar values are unsupported")
    if "method" in value:
        if "id" in value:
            return validate_request(value)
        if value.get("method") == "core.progress":
            return RpcProgressNotification.model_validate(value)
        if value.get("method") == "core.cancel":
            return RpcCancelNotification.model_validate(value)
        raise ValueError("unknown notification")
    if "result" in value and "error" not in value:
        return RpcSuccessResponse.model_validate(value)
    if "error" in value and "result" not in value:
        return RpcErrorResponse.model_validate(value)
    raise ValueError("invalid JSON-RPC message")


def is_valid_rpc_message(value: Any) -> bool:
    try:
        validate_rpc_message(value)
    except (TypeError, ValueError):
        return False
    return True


def health_result() -> dict[str, object]:
    health = CoreHealth(
        service="python-core",
        status="ok",
        protocolVersion=CORE_RPC_PROTOCOL_VERSION,
        coreVersion=__version__,
        capabilities=[
            "core.health",
            "core.smoke.countdown",
            "core.cancel",
            "project.create",
            "project.open",
            "project.inspect",
            "asset.reference",
            "asset.list",
        ],
    )
    return health.model_dump(by_alias=True)
