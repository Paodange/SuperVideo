"""Stable public errors for the Python Core RPC boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True)
class RpcErrorDefinition:
    code: int
    message: str


ERRORS: Final[dict[str, RpcErrorDefinition]] = {
    "PARSE_ERROR": RpcErrorDefinition(-32700, "Parse error."),
    "INVALID_REQUEST": RpcErrorDefinition(-32600, "Invalid request."),
    "METHOD_NOT_FOUND": RpcErrorDefinition(-32601, "Method not found."),
    "INVALID_PARAMS": RpcErrorDefinition(-32602, "Invalid params."),
    "INTERNAL_ERROR": RpcErrorDefinition(-32603, "Internal error."),
    "MESSAGE_TOO_LARGE": RpcErrorDefinition(-32001, "Message too large."),
    "PROTOCOL_MISMATCH": RpcErrorDefinition(-32002, "Protocol mismatch."),
    "DUPLICATE_REQUEST_ID": RpcErrorDefinition(-32003, "Duplicate request ID."),
    "BUSY": RpcErrorDefinition(-32004, "Core is busy."),
    "REQUEST_CANCELLED": RpcErrorDefinition(-32005, "Request cancelled."),
    "TRANSPORT_CLOSED": RpcErrorDefinition(-32006, "Core transport closed."),
    "PROTOCOL_ERROR": RpcErrorDefinition(-32009, "Core protocol error."),
}


class RpcServiceError(Exception):
    """An exception safe to expose through the public RPC error shape."""

    def __init__(self, error_code: str):
        if error_code not in ERRORS:
            error_code = "INTERNAL_ERROR"
        self.error_code = error_code
        definition = ERRORS[error_code]
        super().__init__(definition.message)


def error_payload(error_code: str) -> dict[str, object]:
    """Return a fresh JSON-safe JSON-RPC error object."""

    definition = ERRORS.get(error_code, ERRORS["INTERNAL_ERROR"])
    stable_code = error_code if error_code in ERRORS else "INTERNAL_ERROR"
    return {
        "code": definition.code,
        "message": definition.message,
        "data": {"errorCode": stable_code},
    }


def error_response(request_id: str | None, error_code: str) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": request_id, "error": error_payload(error_code)}
