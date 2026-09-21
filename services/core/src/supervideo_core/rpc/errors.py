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
    "DIALOG_CANCELLED": RpcErrorDefinition(-32100, "The dialog was cancelled."),
    "INVALID_PROJECT_NAME": RpcErrorDefinition(-32101, "The project name is invalid."),
    "INVALID_PROJECT_ROOT": RpcErrorDefinition(-32102, "The project location is invalid."),
    "UNSUPPORTED_PROJECT_LOCATION": RpcErrorDefinition(-32103, "The project location is not supported."),
    "PROJECT_DIRECTORY_NOT_EMPTY": RpcErrorDefinition(-32104, "The project directory is not empty."),
    "PROJECT_ALREADY_EXISTS": RpcErrorDefinition(-32105, "A SuperVideo project already exists there."),
    "PROJECT_NOT_FOUND": RpcErrorDefinition(-32106, "The project was not found."),
    "PROJECT_MANIFEST_INVALID": RpcErrorDefinition(-32107, "The project manifest is invalid."),
    "PROJECT_SCHEMA_TOO_NEW": RpcErrorDefinition(-32108, "The project schema is newer than supported."),
    "PROJECT_DATABASE_MISSING": RpcErrorDefinition(-32109, "The project database is missing."),
    "PROJECT_ID_MISMATCH": RpcErrorDefinition(-32110, "The project identity does not match."),
    "PROJECT_PATH_CONFLICT": RpcErrorDefinition(-32111, "The project location conflicts with another project."),
    "PROJECT_NOT_ACTIVE": RpcErrorDefinition(-32112, "No project is currently active."),
    "ASSET_NOT_FOUND": RpcErrorDefinition(-32113, "The asset was not found."),
    "UNSUPPORTED_ASSET_TYPE": RpcErrorDefinition(-32114, "The asset type is not supported."),
    "TOO_MANY_ASSETS": RpcErrorDefinition(-32115, "Too many assets were selected."),
    "ASSET_CHANGED": RpcErrorDefinition(-32116, "The asset has changed since it was referenced."),
    "ASSET_CHANGED_DURING_REFERENCE": RpcErrorDefinition(-32117, "The asset changed while it was being referenced."),
    "FILE_ACCESS_DENIED": RpcErrorDefinition(-32118, "The selected file could not be accessed."),
    "OPERATION_TIMEOUT": RpcErrorDefinition(-32119, "The project operation timed out."),
    "CORE_UNAVAILABLE": RpcErrorDefinition(-32120, "The Python Core is unavailable."),
    "DATABASE_OPEN_FAILED": RpcErrorDefinition(-32121, "Database could not be opened."),
    "DATABASE_READ_ONLY": RpcErrorDefinition(-32122, "Database is read-only."),
    "DATABASE_BUSY": RpcErrorDefinition(-32123, "Database is busy."),
    "DATABASE_CORRUPT": RpcErrorDefinition(-32124, "Database is corrupt."),
    "MIGRATION_FAILED": RpcErrorDefinition(-32125, "Database migration failed."),
    "MIGRATION_CHECKSUM_MISMATCH": RpcErrorDefinition(-32126, "Database migration checksum mismatch."),
    "SCHEMA_TOO_NEW": RpcErrorDefinition(-32127, "Database schema is newer than supported."),
    "CONSTRAINT_VIOLATION": RpcErrorDefinition(-32128, "Storage constraint was violated."),
    "RECORD_NOT_FOUND": RpcErrorDefinition(-32129, "Storage record was not found."),
    "INVALID_RECORD": RpcErrorDefinition(-32130, "Storage record is invalid."),
    "JOB_NOT_FOUND": RpcErrorDefinition(-32200, "The job was not found."),
    "JOB_STATE_CONFLICT": RpcErrorDefinition(-32201, "The job state changed concurrently."),
    "JOB_NOT_CANCELLABLE": RpcErrorDefinition(-32202, "The job cannot be cancelled."),
    "JOB_NOT_RETRYABLE": RpcErrorDefinition(-32203, "The job cannot be retried."),
    "JOB_RETRY_LIMIT": RpcErrorDefinition(-32204, "The job retry limit was reached."),
    "JOB_QUEUE_FULL": RpcErrorDefinition(-32205, "The job queue is full."),
    "JOB_EXECUTOR_UNAVAILABLE": RpcErrorDefinition(-32206, "The job executor is unavailable."),
    "JOB_CHECKPOINT_INVALID": RpcErrorDefinition(-32207, "The job checkpoint is invalid."),
    "JOB_EVENT_GAP": RpcErrorDefinition(-32208, "The job event sequence has a gap."),
    "IDEMPOTENCY_CONFLICT": RpcErrorDefinition(-32209, "The idempotency key conflicts with another job."),
    "JOB_SHUTTING_DOWN": RpcErrorDefinition(-32210, "The job service is shutting down."),
    "JOB_EXECUTION_FAILED": RpcErrorDefinition(-32211, "The simulated job failed."),
    "MEDIA_TOOL_UNAVAILABLE": RpcErrorDefinition(-32300, "The configured media tool is unavailable."),
    "MEDIA_TOOL_TIMEOUT": RpcErrorDefinition(-32301, "The media tool timed out."),
    "MEDIA_PROBE_PARSE_ERROR": RpcErrorDefinition(-32302, "The media probe output was invalid."),
    "MEDIA_NOT_MEDIA": RpcErrorDefinition(-32303, "The selected asset is not a valid media file."),
    "MEDIA_OUTPUT_INVALID": RpcErrorDefinition(-32304, "The generated media output was invalid."),
    "MEDIA_CANCELLED": RpcErrorDefinition(-32305, "The media operation was cancelled."),
    "TRANSCRIPTION_TOOL_UNAVAILABLE": RpcErrorDefinition(-32306, "The local transcription tool is unavailable."),
    "TRANSCRIPTION_MODEL_UNAVAILABLE": RpcErrorDefinition(-32307, "The local transcription model is unavailable."),
    "TRANSCRIPTION_OUTPUT_INVALID": RpcErrorDefinition(-32308, "The local transcription output was invalid."),
    "TRANSCRIPTION_TIMEOUT": RpcErrorDefinition(-32309, "The local transcription timed out."),
    "TRANSCRIPTION_CANCELLED": RpcErrorDefinition(-32310, "The local transcription was cancelled."),
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
