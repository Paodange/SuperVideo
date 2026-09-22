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
    "VAD_TOOL_UNAVAILABLE": RpcErrorDefinition(-32311, "The local VAD backend is unavailable."),
    "VAD_OUTPUT_INVALID": RpcErrorDefinition(-32312, "The local VAD output was invalid."),
    "VAD_TIMEOUT": RpcErrorDefinition(-32313, "The local VAD timed out."),
    "VAD_CANCELLED": RpcErrorDefinition(-32314, "The local VAD operation was cancelled."),
    "SENTENCE_PREREQUISITE_UNAVAILABLE": RpcErrorDefinition(-32315, "The transcription or speech interval result is unavailable."),
    "SENTENCE_PREREQUISITE_INVALID": RpcErrorDefinition(-32316, "The transcription or speech interval result is invalid."),
    "SENTENCE_OUTPUT_INVALID": RpcErrorDefinition(-32317, "The sentence segmentation output was invalid."),
    "SENTENCE_TIMEOUT": RpcErrorDefinition(-32318, "The sentence segmentation timed out."),
    "SENTENCE_CANCELLED": RpcErrorDefinition(-32319, "The sentence segmentation was cancelled."),
    "SENTENCE_QA_RESULT_NOT_FOUND": RpcErrorDefinition(-32320, "The requested B05 sentence result is unavailable."),
    "SENTENCE_QA_RESULT_INVALID": RpcErrorDefinition(-32321, "The requested B05 sentence result is invalid."),
    "SENTENCE_QA_INDEX_INVALID": RpcErrorDefinition(-32322, "The requested sentence index is invalid."),
    "SENTENCE_QA_STORAGE_INVALID": RpcErrorDefinition(-32323, "The saved sentence QA markers are invalid."),
    "SENTENCE_QA_OUTPUT_INVALID": RpcErrorDefinition(-32324, "The sentence QA output was invalid."),
    "SENTENCE_INDEX_SOURCE_NOT_FOUND": RpcErrorDefinition(-32325, "The requested B05 sentence result is unavailable for indexing."),
    "SENTENCE_INDEX_SOURCE_INVALID": RpcErrorDefinition(-32326, "The requested B05 sentence result is invalid for indexing."),
    "SENTENCE_INDEX_SOURCE_STALE": RpcErrorDefinition(-32327, "The requested B05 sentence result is stale for the referenced asset."),
    "SENTENCE_INDEX_STORAGE_INVALID": RpcErrorDefinition(-32328, "The sentence index storage is invalid."),
    "SENTENCE_INDEX_OUTPUT_INVALID": RpcErrorDefinition(-32329, "The sentence index output was invalid."),
    "SENTENCE_INDEX_TIMEOUT": RpcErrorDefinition(-32330, "The sentence index operation timed out."),
    "SENTENCE_INDEX_CANCELLED": RpcErrorDefinition(-32331, "The sentence index operation was cancelled."),
    "RETRIEVAL_INDEX_NOT_FOUND": RpcErrorDefinition(-32332, "A valid sentence index is unavailable for retrieval."),
    "RETRIEVAL_INDEX_INVALID": RpcErrorDefinition(-32333, "The sentence index is invalid for retrieval."),
    "RETRIEVAL_INDEX_STALE": RpcErrorDefinition(-32334, "The sentence index is stale for the referenced asset."),
    "RETRIEVAL_STORAGE_INVALID": RpcErrorDefinition(-32335, "The sentence retrieval storage is invalid."),
    "RETRIEVAL_OUTPUT_INVALID": RpcErrorDefinition(-32336, "The sentence retrieval output was invalid."),
    "RETRIEVAL_TIMEOUT": RpcErrorDefinition(-32337, "The sentence retrieval operation timed out."),
    "RETRIEVAL_CANCELLED": RpcErrorDefinition(-32338, "The sentence retrieval operation was cancelled."),
    "RERANK_RETRIEVAL_INVALID": RpcErrorDefinition(-32339, "The B08 retrieval result is invalid for reranking."),
    "RERANK_SOURCE_INVALID": RpcErrorDefinition(-32340, "The B05/B07 source is invalid for reranking."),
    "RERANK_SOURCE_STALE": RpcErrorDefinition(-32341, "The B05/B07 source is stale for reranking."),
    "RERANK_QA_STORAGE_INVALID": RpcErrorDefinition(-32342, "The B06 sentence QA storage is invalid."),
    "RERANK_OUTPUT_INVALID": RpcErrorDefinition(-32343, "The sentence reranking output was invalid."),
    "RERANK_TIMEOUT": RpcErrorDefinition(-32344, "The sentence reranking operation timed out."),
    "RERANK_CANCELLED": RpcErrorDefinition(-32345, "The sentence reranking operation was cancelled."),
    "SLOT_INPUT_INVALID": RpcErrorDefinition(-32346, "The information-slot input is invalid or exceeds its bounds."),
    "SLOT_SOURCE_INVALID": RpcErrorDefinition(-32347, "The B08/B09 source is invalid for slot alignment."),
    "SLOT_SOURCE_STALE": RpcErrorDefinition(-32348, "The B08/B09 source is stale for slot alignment."),
    "SLOT_RETRIEVAL_INVALID": RpcErrorDefinition(-32349, "The B08/B09 retrieval result is invalid for slot alignment."),
    "SLOT_OUTPUT_INVALID": RpcErrorDefinition(-32350, "The information-slot alignment output was invalid."),
    "SLOT_TIMEOUT": RpcErrorDefinition(-32351, "The information-slot alignment operation timed out."),
    "SLOT_CANCELLED": RpcErrorDefinition(-32352, "The information-slot alignment operation was cancelled."),
    "PLAN_INPUT_INVALID": RpcErrorDefinition(-32353, "The narrative plan input is invalid or exceeds its bounds."),
    "PLAN_SOURCE_INVALID": RpcErrorDefinition(-32354, "The B10 source is invalid for narrative planning."),
    "PLAN_SOURCE_STALE": RpcErrorDefinition(-32355, "The B10 source is stale for narrative planning."),
    "PLAN_ALIGNMENT_INVALID": RpcErrorDefinition(-32356, "The B10 alignment result is invalid for narrative planning."),
    "PLAN_OUTPUT_INVALID": RpcErrorDefinition(-32357, "The narrative plan output was invalid."),
    "PLAN_TIMEOUT": RpcErrorDefinition(-32358, "The narrative planning operation timed out."),
    "PLAN_CANCELLED": RpcErrorDefinition(-32359, "The narrative planning operation was cancelled."),
    "DURATION_OPTIMIZATION_INPUT_INVALID": RpcErrorDefinition(-32360, "The duration optimization input is invalid or exceeds its bounds."),
    "DURATION_OPTIMIZATION_SOURCE_INVALID": RpcErrorDefinition(-32361, "The C02 source plan is invalid for duration optimization."),
    "DURATION_OPTIMIZATION_ALIGNMENT_INVALID": RpcErrorDefinition(-32362, "The B10 candidate pool is invalid for duration optimization."),
    "DURATION_OPTIMIZATION_OUTPUT_INVALID": RpcErrorDefinition(-32363, "The duration optimization output was invalid."),
    "DURATION_OPTIMIZATION_TIMEOUT": RpcErrorDefinition(-32364, "The duration optimization operation timed out."),
    "DURATION_OPTIMIZATION_CANCELLED": RpcErrorDefinition(-32365, "The duration optimization operation was cancelled."),
    "AROLL_CUT_JOIN_INPUT_INVALID": RpcErrorDefinition(-32366, "The A-roll cut/join input is invalid or exceeds its bounds."),
    "AROLL_CUT_JOIN_TIMELINE_INVALID": RpcErrorDefinition(-32367, "The Timeline IR is invalid for A-roll cut/join."),
    "AROLL_CUT_JOIN_SOURCE_INVALID": RpcErrorDefinition(-32368, "An A-roll source reference is invalid or stale."),
    "AROLL_CUT_JOIN_OUTPUT_INVALID": RpcErrorDefinition(-32369, "The A-roll cut/join plan or output was invalid."),
    "AROLL_CUT_JOIN_TOOL_UNAVAILABLE": RpcErrorDefinition(-32370, "The configured A-roll media tool is unavailable."),
    "AROLL_CUT_JOIN_TOOL_TIMEOUT": RpcErrorDefinition(-32371, "The A-roll media tool timed out."),
    "AROLL_CUT_JOIN_CANCELLED": RpcErrorDefinition(-32372, "The A-roll cut/join operation was cancelled."),
    "AROLL_CUT_JOIN_TIMEOUT": RpcErrorDefinition(-32373, "The A-roll cut/join operation timed out."),
    "SUBTITLE_INPUT_INVALID": RpcErrorDefinition(-32374, "The subtitle plan input is invalid or exceeds its bounds."),
    "SUBTITLE_TIMELINE_INVALID": RpcErrorDefinition(-32375, "The Timeline IR is invalid for subtitle planning."),
    "SUBTITLE_SOURCE_INVALID": RpcErrorDefinition(-32376, "A subtitle source reference is invalid."),
    "SUBTITLE_TIMECODE_INVALID": RpcErrorDefinition(-32377, "A subtitle timecode is invalid or outside the timeline."),
    "SUBTITLE_OVERLAP": RpcErrorDefinition(-32378, "Subtitle cues overlap in timeline order."),
    "SUBTITLE_TEXT_INVALID": RpcErrorDefinition(-32379, "Subtitle text is invalid or exceeds its bounds."),
    "SUBTITLE_LINE_COUNT_INVALID": RpcErrorDefinition(-32380, "Subtitle text exceeds the configured line count."),
    "SUBTITLE_LINE_WIDTH_INVALID": RpcErrorDefinition(-32381, "Subtitle text exceeds the configured display width."),
    "SUBTITLE_OUTPUT_INVALID": RpcErrorDefinition(-32382, "The generated subtitle plan was invalid."),
    "SUBTITLE_TIMEOUT": RpcErrorDefinition(-32383, "The subtitle planning operation timed out."),
    "SUBTITLE_CANCELLED": RpcErrorDefinition(-32384, "The subtitle planning operation was cancelled."),
    "PREVIEW_RENDER_INPUT_INVALID": RpcErrorDefinition(-32385, "The preview render input is invalid or exceeds its bounds."),
    "PREVIEW_RENDER_SOURCE_INVALID": RpcErrorDefinition(-32386, "The preview source is invalid, stale, or outside the preview boundary."),
    "PREVIEW_RENDER_SUBTITLE_INVALID": RpcErrorDefinition(-32387, "The subtitle plan cannot be bound to the preview timeline."),
    "PREVIEW_RENDER_OUTPUT_INVALID": RpcErrorDefinition(-32388, "The generated preview output was invalid."),
    "PREVIEW_RENDER_TOOL_UNAVAILABLE": RpcErrorDefinition(-32389, "The configured preview media tool is unavailable."),
    "PREVIEW_RENDER_TOOL_TIMEOUT": RpcErrorDefinition(-32390, "The preview media tool timed out."),
    "PREVIEW_RENDER_TIMEOUT": RpcErrorDefinition(-32391, "The preview render operation timed out."),
    "PREVIEW_RENDER_CANCELLED": RpcErrorDefinition(-32392, "The preview render operation was cancelled."),
    "PREVIEW_QUALITY_INPUT_INVALID": RpcErrorDefinition(-32393, "The preview quality-check input is invalid."),
    "PREVIEW_QUALITY_OUTPUT_INVALID": RpcErrorDefinition(-32394, "The preview quality-check result was invalid."),
    "PREVIEW_QUALITY_TIMEOUT": RpcErrorDefinition(-32395, "The preview quality check timed out."),
    "PREVIEW_QUALITY_CANCELLED": RpcErrorDefinition(-32396, "The preview quality check was cancelled."),
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
