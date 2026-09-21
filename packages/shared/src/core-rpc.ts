/**
 * Versioned contract shared by the Agent Worker and the Python Core.
 *
 * This module deliberately contains runtime checks as well as TypeScript
 * types.  JSON crossing the process boundary is untrusted input, even when
 * both processes are started by the same application.
 */

export const JSON_RPC_VERSION = "2.0" as const;
export const CORE_RPC_PROTOCOL_VERSION = 1 as const;
export const CORE_RPC_MAX_LINE_BYTES = 256 * 1024;
export const CORE_RPC_MAX_REQUEST_ID_LENGTH = 64;
export const CORE_RPC_MAX_METHOD_LENGTH = 128;
export const CORE_RPC_MAX_PROGRESS_MESSAGE_LENGTH = 256;
export const CORE_RPC_MAX_ERROR_MESSAGE_LENGTH = 128;

export const CORE_RPC_METHODS = {
  health: "core.health",
  smokeCountdown: "core.smoke.countdown",
  progress: "core.progress",
  cancel: "core.cancel",
  projectCreate: "project.create",
  projectOpen: "project.open",
  projectInspect: "project.inspect",
  assetReference: "asset.reference",
  assetScan: "asset.scan",
  assetList: "asset.list",
  mediaProbe: "media.probe",
  mediaProxy: "media.proxy",
  mediaTranscribe: "media.transcribe",
  mediaVad: "media.vad",
  mediaSentences: "media.sentences",
  mediaSentenceQaContext: "media.sentences.qa.context",
  mediaSentenceQaSave: "media.sentences.qa.save",
  mediaSentenceIndex: "media.sentences.index",
  mediaSentenceRetrieve: "media.sentences.retrieve",
  mediaSentenceRerank: "media.sentences.rerank",
  mediaScriptAlign: "media.script.align",
  jobSmokeStart: "job.smoke.start",
  jobGet: "job.get",
  jobList: "job.list",
  jobEventsList: "job.events.list",
  jobCancel: "job.cancel",
  jobRetry: "job.retry",
  jobEvent: "core.job.event",
} as const;

export type CoreRpcMethod = (typeof CORE_RPC_METHODS)[keyof typeof CORE_RPC_METHODS];
export type CoreRpcCallableMethod =
  | typeof CORE_RPC_METHODS.health
  | typeof CORE_RPC_METHODS.smokeCountdown
  | typeof CORE_RPC_METHODS.projectCreate
  | typeof CORE_RPC_METHODS.projectOpen
  | typeof CORE_RPC_METHODS.projectInspect
  | typeof CORE_RPC_METHODS.assetReference
  | typeof CORE_RPC_METHODS.assetScan
  | typeof CORE_RPC_METHODS.assetList
  | typeof CORE_RPC_METHODS.mediaProbe
  | typeof CORE_RPC_METHODS.mediaProxy
  | typeof CORE_RPC_METHODS.mediaTranscribe
  | typeof CORE_RPC_METHODS.mediaVad
  | typeof CORE_RPC_METHODS.mediaSentences
  | typeof CORE_RPC_METHODS.mediaSentenceQaContext
  | typeof CORE_RPC_METHODS.mediaSentenceQaSave
  | typeof CORE_RPC_METHODS.mediaSentenceIndex
  | typeof CORE_RPC_METHODS.mediaSentenceRetrieve
  | typeof CORE_RPC_METHODS.mediaSentenceRerank
  | typeof CORE_RPC_METHODS.mediaScriptAlign
  | typeof CORE_RPC_METHODS.jobSmokeStart
  | typeof CORE_RPC_METHODS.jobGet
  | typeof CORE_RPC_METHODS.jobList
  | typeof CORE_RPC_METHODS.jobEventsList
  | typeof CORE_RPC_METHODS.jobCancel
  | typeof CORE_RPC_METHODS.jobRetry;
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "retrying" | "cancelling" | "cancelled" | "needs_attention";

export const CORE_RPC_ERROR_CODES = {
  parseError: "PARSE_ERROR",
  invalidRequest: "INVALID_REQUEST",
  methodNotFound: "METHOD_NOT_FOUND",
  invalidParams: "INVALID_PARAMS",
  internalError: "INTERNAL_ERROR",
  messageTooLarge: "MESSAGE_TOO_LARGE",
  protocolMismatch: "PROTOCOL_MISMATCH",
  duplicateRequestId: "DUPLICATE_REQUEST_ID",
  busy: "BUSY",
  requestCancelled: "REQUEST_CANCELLED",
  requestTimeout: "REQUEST_TIMEOUT",
  transportClosed: "TRANSPORT_CLOSED",
  pythonNotFound: "PYTHON_NOT_FOUND",
  protocolError: "PROTOCOL_ERROR",
  dialogCancelled: "DIALOG_CANCELLED",
  invalidProjectName: "INVALID_PROJECT_NAME",
  invalidProjectRoot: "INVALID_PROJECT_ROOT",
  unsupportedProjectLocation: "UNSUPPORTED_PROJECT_LOCATION",
  projectDirectoryNotEmpty: "PROJECT_DIRECTORY_NOT_EMPTY",
  projectAlreadyExists: "PROJECT_ALREADY_EXISTS",
  projectNotFound: "PROJECT_NOT_FOUND",
  projectManifestInvalid: "PROJECT_MANIFEST_INVALID",
  projectSchemaTooNew: "PROJECT_SCHEMA_TOO_NEW",
  projectDatabaseMissing: "PROJECT_DATABASE_MISSING",
  projectIdMismatch: "PROJECT_ID_MISMATCH",
  projectPathConflict: "PROJECT_PATH_CONFLICT",
  projectNotActive: "PROJECT_NOT_ACTIVE",
  assetNotFound: "ASSET_NOT_FOUND",
  unsupportedAssetType: "UNSUPPORTED_ASSET_TYPE",
  tooManyAssets: "TOO_MANY_ASSETS",
  assetChanged: "ASSET_CHANGED",
  assetChangedDuringReference: "ASSET_CHANGED_DURING_REFERENCE",
  fileAccessDenied: "FILE_ACCESS_DENIED",
  operationTimeout: "OPERATION_TIMEOUT",
  coreUnavailable: "CORE_UNAVAILABLE",
  databaseOpenFailed: "DATABASE_OPEN_FAILED",
  databaseReadOnly: "DATABASE_READ_ONLY",
  databaseBusy: "DATABASE_BUSY",
  databaseCorrupt: "DATABASE_CORRUPT",
  migrationFailed: "MIGRATION_FAILED",
  migrationChecksumMismatch: "MIGRATION_CHECKSUM_MISMATCH",
  schemaTooNew: "SCHEMA_TOO_NEW",
  constraintViolation: "CONSTRAINT_VIOLATION",
  recordNotFound: "RECORD_NOT_FOUND",
  invalidRecord: "INVALID_RECORD",
  jobNotFound: "JOB_NOT_FOUND",
  jobStateConflict: "JOB_STATE_CONFLICT",
  jobNotCancellable: "JOB_NOT_CANCELLABLE",
  jobNotRetryable: "JOB_NOT_RETRYABLE",
  jobRetryLimit: "JOB_RETRY_LIMIT",
  jobQueueFull: "JOB_QUEUE_FULL",
  jobExecutorUnavailable: "JOB_EXECUTOR_UNAVAILABLE",
  jobCheckpointInvalid: "JOB_CHECKPOINT_INVALID",
  jobEventGap: "JOB_EVENT_GAP",
  idempotencyConflict: "IDEMPOTENCY_CONFLICT",
  jobShuttingDown: "JOB_SHUTTING_DOWN",
  jobExecutionFailed: "JOB_EXECUTION_FAILED",
  mediaToolUnavailable: "MEDIA_TOOL_UNAVAILABLE",
  mediaToolTimeout: "MEDIA_TOOL_TIMEOUT",
  mediaProbeParseError: "MEDIA_PROBE_PARSE_ERROR",
  mediaNotMedia: "MEDIA_NOT_MEDIA",
  mediaOutputInvalid: "MEDIA_OUTPUT_INVALID",
  mediaCancelled: "MEDIA_CANCELLED",
  transcriptionToolUnavailable: "TRANSCRIPTION_TOOL_UNAVAILABLE",
  transcriptionModelUnavailable: "TRANSCRIPTION_MODEL_UNAVAILABLE",
  transcriptionOutputInvalid: "TRANSCRIPTION_OUTPUT_INVALID",
  transcriptionTimeout: "TRANSCRIPTION_TIMEOUT",
  transcriptionCancelled: "TRANSCRIPTION_CANCELLED",
  vadToolUnavailable: "VAD_TOOL_UNAVAILABLE",
  vadOutputInvalid: "VAD_OUTPUT_INVALID",
  vadTimeout: "VAD_TIMEOUT",
  vadCancelled: "VAD_CANCELLED",
  sentencePrerequisiteUnavailable: "SENTENCE_PREREQUISITE_UNAVAILABLE",
  sentencePrerequisiteInvalid: "SENTENCE_PREREQUISITE_INVALID",
  sentenceOutputInvalid: "SENTENCE_OUTPUT_INVALID",
  sentenceTimeout: "SENTENCE_TIMEOUT",
  sentenceCancelled: "SENTENCE_CANCELLED",
  sentenceQaResultNotFound: "SENTENCE_QA_RESULT_NOT_FOUND",
  sentenceQaResultInvalid: "SENTENCE_QA_RESULT_INVALID",
  sentenceQaIndexInvalid: "SENTENCE_QA_INDEX_INVALID",
  sentenceQaStorageInvalid: "SENTENCE_QA_STORAGE_INVALID",
  sentenceQaOutputInvalid: "SENTENCE_QA_OUTPUT_INVALID",
  sentenceIndexSourceNotFound: "SENTENCE_INDEX_SOURCE_NOT_FOUND",
  sentenceIndexSourceInvalid: "SENTENCE_INDEX_SOURCE_INVALID",
  sentenceIndexSourceStale: "SENTENCE_INDEX_SOURCE_STALE",
  sentenceIndexStorageInvalid: "SENTENCE_INDEX_STORAGE_INVALID",
  sentenceIndexOutputInvalid: "SENTENCE_INDEX_OUTPUT_INVALID",
  sentenceIndexTimeout: "SENTENCE_INDEX_TIMEOUT",
  sentenceIndexCancelled: "SENTENCE_INDEX_CANCELLED",
  retrievalIndexNotFound: "RETRIEVAL_INDEX_NOT_FOUND",
  retrievalIndexInvalid: "RETRIEVAL_INDEX_INVALID",
  retrievalIndexStale: "RETRIEVAL_INDEX_STALE",
  retrievalStorageInvalid: "RETRIEVAL_STORAGE_INVALID",
  retrievalOutputInvalid: "RETRIEVAL_OUTPUT_INVALID",
  retrievalTimeout: "RETRIEVAL_TIMEOUT",
  retrievalCancelled: "RETRIEVAL_CANCELLED",
  rerankRetrievalInvalid: "RERANK_RETRIEVAL_INVALID",
  rerankSourceInvalid: "RERANK_SOURCE_INVALID",
  rerankSourceStale: "RERANK_SOURCE_STALE",
  rerankQaStorageInvalid: "RERANK_QA_STORAGE_INVALID",
  rerankOutputInvalid: "RERANK_OUTPUT_INVALID",
  rerankTimeout: "RERANK_TIMEOUT",
  rerankCancelled: "RERANK_CANCELLED",
  slotInputInvalid: "SLOT_INPUT_INVALID",
  slotSourceInvalid: "SLOT_SOURCE_INVALID",
  slotSourceStale: "SLOT_SOURCE_STALE",
  slotRetrievalInvalid: "SLOT_RETRIEVAL_INVALID",
  slotOutputInvalid: "SLOT_OUTPUT_INVALID",
  slotTimeout: "SLOT_TIMEOUT",
  slotCancelled: "SLOT_CANCELLED",
} as const;

export type CoreRpcErrorCode = (typeof CORE_RPC_ERROR_CODES)[keyof typeof CORE_RPC_ERROR_CODES];

export const CORE_RPC_ERROR_NUMBERS: Readonly<Record<CoreRpcErrorCode, number>> = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  MESSAGE_TOO_LARGE: -32001,
  PROTOCOL_MISMATCH: -32002,
  DUPLICATE_REQUEST_ID: -32003,
  BUSY: -32004,
  REQUEST_CANCELLED: -32005,
  TRANSPORT_CLOSED: -32006,
  REQUEST_TIMEOUT: -32007,
  PYTHON_NOT_FOUND: -32008,
  PROTOCOL_ERROR: -32009,
  DIALOG_CANCELLED: -32100,
  INVALID_PROJECT_NAME: -32101,
  INVALID_PROJECT_ROOT: -32102,
  UNSUPPORTED_PROJECT_LOCATION: -32103,
  PROJECT_DIRECTORY_NOT_EMPTY: -32104,
  PROJECT_ALREADY_EXISTS: -32105,
  PROJECT_NOT_FOUND: -32106,
  PROJECT_MANIFEST_INVALID: -32107,
  PROJECT_SCHEMA_TOO_NEW: -32108,
  PROJECT_DATABASE_MISSING: -32109,
  PROJECT_ID_MISMATCH: -32110,
  PROJECT_PATH_CONFLICT: -32111,
  PROJECT_NOT_ACTIVE: -32112,
  ASSET_NOT_FOUND: -32113,
  UNSUPPORTED_ASSET_TYPE: -32114,
  TOO_MANY_ASSETS: -32115,
  ASSET_CHANGED: -32116,
  ASSET_CHANGED_DURING_REFERENCE: -32117,
  FILE_ACCESS_DENIED: -32118,
  OPERATION_TIMEOUT: -32119,
  CORE_UNAVAILABLE: -32120,
  DATABASE_OPEN_FAILED: -32121,
  DATABASE_READ_ONLY: -32122,
  DATABASE_BUSY: -32123,
  DATABASE_CORRUPT: -32124,
  MIGRATION_FAILED: -32125,
  MIGRATION_CHECKSUM_MISMATCH: -32126,
  SCHEMA_TOO_NEW: -32127,
  CONSTRAINT_VIOLATION: -32128,
  RECORD_NOT_FOUND: -32129,
  INVALID_RECORD: -32130,
  JOB_NOT_FOUND: -32200,
  JOB_STATE_CONFLICT: -32201,
  JOB_NOT_CANCELLABLE: -32202,
  JOB_NOT_RETRYABLE: -32203,
  JOB_RETRY_LIMIT: -32204,
  JOB_QUEUE_FULL: -32205,
  JOB_EXECUTOR_UNAVAILABLE: -32206,
  JOB_CHECKPOINT_INVALID: -32207,
  JOB_EVENT_GAP: -32208,
  IDEMPOTENCY_CONFLICT: -32209,
  JOB_SHUTTING_DOWN: -32210,
  JOB_EXECUTION_FAILED: -32211,
  MEDIA_TOOL_UNAVAILABLE: -32300,
  MEDIA_TOOL_TIMEOUT: -32301,
  MEDIA_PROBE_PARSE_ERROR: -32302,
  MEDIA_NOT_MEDIA: -32303,
  MEDIA_OUTPUT_INVALID: -32304,
  MEDIA_CANCELLED: -32305,
  TRANSCRIPTION_TOOL_UNAVAILABLE: -32306,
  TRANSCRIPTION_MODEL_UNAVAILABLE: -32307,
  TRANSCRIPTION_OUTPUT_INVALID: -32308,
  TRANSCRIPTION_TIMEOUT: -32309,
  TRANSCRIPTION_CANCELLED: -32310,
  VAD_TOOL_UNAVAILABLE: -32311,
  VAD_OUTPUT_INVALID: -32312,
  VAD_TIMEOUT: -32313,
  VAD_CANCELLED: -32314,
  SENTENCE_PREREQUISITE_UNAVAILABLE: -32315,
  SENTENCE_PREREQUISITE_INVALID: -32316,
  SENTENCE_OUTPUT_INVALID: -32317,
  SENTENCE_TIMEOUT: -32318,
  SENTENCE_CANCELLED: -32319,
  SENTENCE_QA_RESULT_NOT_FOUND: -32320,
  SENTENCE_QA_RESULT_INVALID: -32321,
  SENTENCE_QA_INDEX_INVALID: -32322,
  SENTENCE_QA_STORAGE_INVALID: -32323,
  SENTENCE_QA_OUTPUT_INVALID: -32324,
  SENTENCE_INDEX_SOURCE_NOT_FOUND: -32325,
  SENTENCE_INDEX_SOURCE_INVALID: -32326,
  SENTENCE_INDEX_SOURCE_STALE: -32327,
  SENTENCE_INDEX_STORAGE_INVALID: -32328,
  SENTENCE_INDEX_OUTPUT_INVALID: -32329,
  SENTENCE_INDEX_TIMEOUT: -32330,
  SENTENCE_INDEX_CANCELLED: -32331,
  RETRIEVAL_INDEX_NOT_FOUND: -32332,
  RETRIEVAL_INDEX_INVALID: -32333,
  RETRIEVAL_INDEX_STALE: -32334,
  RETRIEVAL_STORAGE_INVALID: -32335,
  RETRIEVAL_OUTPUT_INVALID: -32336,
  RETRIEVAL_TIMEOUT: -32337,
  RETRIEVAL_CANCELLED: -32338,
  RERANK_RETRIEVAL_INVALID: -32339,
  RERANK_SOURCE_INVALID: -32340,
  RERANK_SOURCE_STALE: -32341,
  RERANK_QA_STORAGE_INVALID: -32342,
  RERANK_OUTPUT_INVALID: -32343,
  RERANK_TIMEOUT: -32344,
  RERANK_CANCELLED: -32345,
  SLOT_INPUT_INVALID: -32346,
  SLOT_SOURCE_INVALID: -32347,
  SLOT_SOURCE_STALE: -32348,
  SLOT_RETRIEVAL_INVALID: -32349,
  SLOT_OUTPUT_INVALID: -32350,
  SLOT_TIMEOUT: -32351,
  SLOT_CANCELLED: -32352,
};

export const CORE_RPC_ERROR_MESSAGES: Readonly<Record<CoreRpcErrorCode, string>> = {
  PARSE_ERROR: "Parse error.",
  INVALID_REQUEST: "Invalid request.",
  METHOD_NOT_FOUND: "Method not found.",
  INVALID_PARAMS: "Invalid params.",
  INTERNAL_ERROR: "Internal error.",
  MESSAGE_TOO_LARGE: "Message too large.",
  PROTOCOL_MISMATCH: "Protocol mismatch.",
  DUPLICATE_REQUEST_ID: "Duplicate request ID.",
  BUSY: "Core is busy.",
  REQUEST_CANCELLED: "Request cancelled.",
  REQUEST_TIMEOUT: "Request timed out.",
  TRANSPORT_CLOSED: "Core transport closed.",
  PYTHON_NOT_FOUND: "Python Core could not be started.",
  PROTOCOL_ERROR: "Core protocol error.",
  DIALOG_CANCELLED: "The dialog was cancelled.",
  INVALID_PROJECT_NAME: "The project name is invalid.",
  INVALID_PROJECT_ROOT: "The project location is invalid.",
  UNSUPPORTED_PROJECT_LOCATION: "The project location is not supported.",
  PROJECT_DIRECTORY_NOT_EMPTY: "The project directory is not empty.",
  PROJECT_ALREADY_EXISTS: "A SuperVideo project already exists there.",
  PROJECT_NOT_FOUND: "The project was not found.",
  PROJECT_MANIFEST_INVALID: "The project manifest is invalid.",
  PROJECT_SCHEMA_TOO_NEW: "The project schema is newer than supported.",
  PROJECT_DATABASE_MISSING: "The project database is missing.",
  PROJECT_ID_MISMATCH: "The project identity does not match.",
  PROJECT_PATH_CONFLICT: "The project location conflicts with another project.",
  PROJECT_NOT_ACTIVE: "No project is currently active.",
  ASSET_NOT_FOUND: "The asset was not found.",
  UNSUPPORTED_ASSET_TYPE: "The asset type is not supported.",
  TOO_MANY_ASSETS: "Too many assets were selected.",
  ASSET_CHANGED: "The asset has changed since it was referenced.",
  ASSET_CHANGED_DURING_REFERENCE: "The asset changed while it was being referenced.",
  FILE_ACCESS_DENIED: "The selected file could not be accessed.",
  OPERATION_TIMEOUT: "The project operation timed out.",
  CORE_UNAVAILABLE: "The Python Core is unavailable.",
  DATABASE_OPEN_FAILED: "Database could not be opened.",
  DATABASE_READ_ONLY: "Database is read-only.",
  DATABASE_BUSY: "Database is busy.",
  DATABASE_CORRUPT: "Database is corrupt.",
  MIGRATION_FAILED: "Database migration failed.",
  MIGRATION_CHECKSUM_MISMATCH: "Database migration checksum mismatch.",
  SCHEMA_TOO_NEW: "Database schema is newer than supported.",
  CONSTRAINT_VIOLATION: "Storage constraint was violated.",
  RECORD_NOT_FOUND: "Storage record was not found.",
  INVALID_RECORD: "Storage record is invalid.",
  JOB_NOT_FOUND: "The job was not found.",
  JOB_STATE_CONFLICT: "The job state changed concurrently.",
  JOB_NOT_CANCELLABLE: "The job cannot be cancelled.",
  JOB_NOT_RETRYABLE: "The job cannot be retried.",
  JOB_RETRY_LIMIT: "The job retry limit was reached.",
  JOB_QUEUE_FULL: "The job queue is full.",
  JOB_EXECUTOR_UNAVAILABLE: "The job executor is unavailable.",
  JOB_CHECKPOINT_INVALID: "The job checkpoint is invalid.",
  JOB_EVENT_GAP: "The job event sequence has a gap.",
  IDEMPOTENCY_CONFLICT: "The idempotency key conflicts with another job.",
  JOB_SHUTTING_DOWN: "The job service is shutting down.",
  JOB_EXECUTION_FAILED: "The simulated job failed.",
  MEDIA_TOOL_UNAVAILABLE: "The configured media tool is unavailable.",
  MEDIA_TOOL_TIMEOUT: "The media tool timed out.",
  MEDIA_PROBE_PARSE_ERROR: "The media probe output was invalid.",
  MEDIA_NOT_MEDIA: "The selected asset is not a valid media file.",
  MEDIA_OUTPUT_INVALID: "The generated media output was invalid.",
  MEDIA_CANCELLED: "The media operation was cancelled.",
  TRANSCRIPTION_TOOL_UNAVAILABLE: "The local transcription tool is unavailable.",
  TRANSCRIPTION_MODEL_UNAVAILABLE: "The local transcription model is unavailable.",
  TRANSCRIPTION_OUTPUT_INVALID: "The local transcription output was invalid.",
  TRANSCRIPTION_TIMEOUT: "The local transcription timed out.",
  TRANSCRIPTION_CANCELLED: "The local transcription was cancelled.",
  VAD_TOOL_UNAVAILABLE: "The local VAD backend is unavailable.",
  VAD_OUTPUT_INVALID: "The local VAD output was invalid.",
  VAD_TIMEOUT: "The local VAD timed out.",
  VAD_CANCELLED: "The local VAD operation was cancelled.",
  SENTENCE_PREREQUISITE_UNAVAILABLE: "The transcription or speech interval result is unavailable.",
  SENTENCE_PREREQUISITE_INVALID: "The transcription or speech interval result is invalid.",
  SENTENCE_OUTPUT_INVALID: "The sentence segmentation output was invalid.",
  SENTENCE_TIMEOUT: "The sentence segmentation timed out.",
  SENTENCE_CANCELLED: "The sentence segmentation was cancelled.",
  SENTENCE_QA_RESULT_NOT_FOUND: "The requested B05 sentence result is unavailable.",
  SENTENCE_QA_RESULT_INVALID: "The requested B05 sentence result is invalid.",
  SENTENCE_QA_INDEX_INVALID: "The requested sentence index is invalid.",
  SENTENCE_QA_STORAGE_INVALID: "The saved sentence QA markers are invalid.",
  SENTENCE_QA_OUTPUT_INVALID: "The sentence QA output was invalid.",
  SENTENCE_INDEX_SOURCE_NOT_FOUND: "The requested B05 sentence result is unavailable for indexing.",
  SENTENCE_INDEX_SOURCE_INVALID: "The requested B05 sentence result is invalid for indexing.",
  SENTENCE_INDEX_SOURCE_STALE: "The requested B05 sentence result is stale for the referenced asset.",
  SENTENCE_INDEX_STORAGE_INVALID: "The sentence index storage is invalid.",
  SENTENCE_INDEX_OUTPUT_INVALID: "The sentence index output was invalid.",
  SENTENCE_INDEX_TIMEOUT: "The sentence index operation timed out.",
  SENTENCE_INDEX_CANCELLED: "The sentence index operation was cancelled.",
  RETRIEVAL_INDEX_NOT_FOUND: "A valid sentence index is unavailable for retrieval.",
  RETRIEVAL_INDEX_INVALID: "The sentence index is invalid for retrieval.",
  RETRIEVAL_INDEX_STALE: "The sentence index is stale for the referenced asset.",
  RETRIEVAL_STORAGE_INVALID: "The sentence retrieval storage is invalid.",
  RETRIEVAL_OUTPUT_INVALID: "The sentence retrieval output was invalid.",
  RETRIEVAL_TIMEOUT: "The sentence retrieval operation timed out.",
  RETRIEVAL_CANCELLED: "The sentence retrieval operation was cancelled.",
  RERANK_RETRIEVAL_INVALID: "The B08 retrieval result is invalid for reranking.",
  RERANK_SOURCE_INVALID: "The B05/B07 source is invalid for reranking.",
  RERANK_SOURCE_STALE: "The B05/B07 source is stale for reranking.",
  RERANK_QA_STORAGE_INVALID: "The B06 sentence QA storage is invalid.",
  RERANK_OUTPUT_INVALID: "The sentence reranking output was invalid.",
  RERANK_TIMEOUT: "The sentence reranking operation timed out.",
  RERANK_CANCELLED: "The sentence reranking operation was cancelled.",
  SLOT_INPUT_INVALID: "The information-slot input is invalid or exceeds its bounds.",
  SLOT_SOURCE_INVALID: "The B08/B09 source is invalid for slot alignment.",
  SLOT_SOURCE_STALE: "The B08/B09 source is stale for slot alignment.",
  SLOT_RETRIEVAL_INVALID: "The B08/B09 retrieval result is invalid for slot alignment.",
  SLOT_OUTPUT_INVALID: "The information-slot alignment output was invalid.",
  SLOT_TIMEOUT: "The information-slot alignment operation timed out.",
  SLOT_CANCELLED: "The information-slot alignment operation was cancelled.",
};

export type CoreRpcId = string;

export type CoreHealth = Readonly<{
  service: "python-core";
  status: "ok";
  protocolVersion: typeof CORE_RPC_PROTOCOL_VERSION;
  coreVersion: string;
  capabilities: readonly string[];
}>;

export type CoreSmokeCountdownParams = Readonly<{ steps: number; delayMs: number }>;
export type CoreSmokeCountdownResult = Readonly<{ status: "completed"; steps: number }>;
export type ProjectCreateParams = Readonly<{ name: string; targetPlatform: string; projectRoot: string }>;
export type ProjectOpenParams = Readonly<{ projectRoot: string }>;
export type ProjectSummary = Readonly<{
  projectId: string;
  name: string;
  targetPlatform: string;
  projectRoot: string;
  manifestSchemaVersion: number;
  databaseSchemaVersion: number;
  assetCount: number;
  createdAtMs: number;
  updatedAtMs: number;
}>;
export type AssetReferenceParams = Readonly<{ projectId: string; paths: readonly string[] }>;
export type AssetScanParams = Readonly<{ projectId: string; directory: string }>;
export type AssetListParams = Readonly<{ projectId: string; limit: number }>;
export type JobSmokeStartParams = Readonly<{ projectId: string; idempotencyKey: string; steps?: number; delayMs?: number; failAttempts?: number }>;
export type JobReferenceParams = Readonly<{ projectId: string; jobId: string }>;
export type JobListParams = Readonly<{ projectId: string; statuses?: readonly JobStatus[]; cursor?: string | null; limit?: number }>;
export type JobEventsListParams = Readonly<{ projectId: string; jobId: string; afterSequence?: number; cursor?: string | null; limit?: number }>;
export type JobSummary = Readonly<{
  jobId: string; projectId: string; jobType: "smoke.countdown"; status: JobStatus; progress: number;
  stage: string | null; attempt: number; revision: number; lastEventSequence: number;
  createdAtMs: number; updatedAtMs: number; startedAtMs: number | null; finishedAtMs: number | null; errorCode: string | null;
}>;
export type JobEvent = Readonly<{
  projectId: string; jobId: string; sequence: number; eventType: string; status: JobStatus;
  progress: number; stage: string | null; attempt: number; timestamp: number; payload: unknown;
}>;
export type JobPage = Readonly<{ projectId: string; items: readonly JobSummary[]; nextCursor: string | null; hasMore: boolean }>;
export type JobEventPage = Readonly<{ projectId: string; jobId: string; items: readonly JobEvent[]; nextCursor: string | null; hasMore: boolean }>;
export type AssetSummary = Readonly<{
  assetId: string;
  projectId: string;
  fileName: string;
  absolutePath: string;
  kind: string;
  sizeBytes: number;
  modifiedAtMs: number;
  fingerprintAlgorithm: string;
  referenceStatus: "added" | "existing";
}>;
export type AssetReferenceBatchResult = Readonly<{ projectId: string; items: readonly AssetSummary[] }>;
export type AssetScanResult = Readonly<{ projectId: string; directory: string; items: readonly AssetSummary[] }>;
export type AssetListResult = Readonly<{ projectId: string; items: readonly AssetSummary[] }>;
export type MediaParams = Readonly<{ projectId: string; assetId: string; timeoutMs?: number }>;
export type TranscriptionParams = MediaParams;
export type VadConfig = Readonly<{
  thresholdDb: number;
  minSpeechMs: number;
  minSilenceMs: number;
  preRollMs: number;
  postRollMs: number;
  mergeGapMs: number;
}>;
export type VadParams = Readonly<{ projectId: string; assetId: string; timeoutMs?: number; config?: Partial<VadConfig> }>;
export type MediaStream = Readonly<{ index: number; codecType: "video" | "audio" | "data" | "subtitle" | "attachment" | "unknown"; codecName: string | null; width: number | null; height: number | null; frameRate: number | null; sampleRate: number | null; channels: number | null; channelLayout: string | null; language: string | null }>;
export type MediaMetadata = Readonly<{ schemaVersion: 1; formatName: string | null; formatLongName: string | null; durationMs: number | null; bitRate: number | null; streams: readonly MediaStream[] }>;
export type MediaProbeResult = Readonly<{ schemaVersion: 1; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; metadata: MediaMetadata }>;
export type MediaOutput = Readonly<{ kind: "audio" | "video" | "thumbnail"; relativePath: string; sizeBytes: number }>;
export type MediaProxyResult = Readonly<{ schemaVersion: 1; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; outputs: readonly MediaOutput[] }>;
export type TranscriptionModelInfo = Readonly<{ adapterVersion: "faster-whisper-v1"; provider: "faster-whisper"; modelName: "tiny" | "base" | "small" | "medium" | "large-v3"; device: "cpu" | "cuda"; computeType: "int8" | "float16" | "float32" | "int8_float16" }>;
export type TranscriptionWord = Readonly<{ startMs: number; endMs: number; text: string; probability: number | null }>;
export type TranscriptionSegment = Readonly<{ index: number; startMs: number; endMs: number; text: string; confidence: number | null; avgLogprob: number | null; noSpeechProbability: number | null; compressionRatio: number | null; words: readonly TranscriptionWord[] }>;
export type TranscriptionResult = Readonly<{ schemaVersion: 1; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; model: TranscriptionModelInfo; language: string | null; languageProbability: number | null; durationMs: number | null; segments: readonly TranscriptionSegment[] }>;
export type SpeechInterval = Readonly<{ index: number; startMs: number; endMs: number; isSpeech: boolean; confidence: number | null; quality: "detected" | "silence" | "boundary-expanded" | "boundary-clipped" | "merged" }>;
export type VadResult = Readonly<{ schemaVersion: 1; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; adapterVersion: "ffmpeg-silencedetect-v1"; durationMs: number; config: VadConfig; intervals: readonly SpeechInterval[] }>;
export type SentenceConfig = Readonly<{ maxSentenceMs: number; pauseBoundaryMs: number; minSentenceMs: number; preRollMs: number; postRollMs: number }>;
export type SentenceParams = Readonly<{ projectId: string; assetId: string; timeoutMs?: number; config?: Partial<SentenceConfig> }>;
export type SentenceCandidate = Readonly<{ index: number; sourceAssetId: string; startMs: number; endMs: number; text: string; confidence: number | null; quality: "complete" | "needs_review"; qualityReasons: readonly string[]; sourceSegmentIndexes: readonly number[] }>;
export type SentenceResult = Readonly<{ schemaVersion: 1; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; adapterVersion: "sentence-segmentation-v1"; durationMs: number; config: SentenceConfig; sentences: readonly SentenceCandidate[] }>;
export type SentenceIndexParams = Readonly<{ projectId: string; assetId: string; sentenceCacheKey: string; timeoutMs?: number }>;
export type SentenceIndexEntry = Readonly<{ sentenceId: string; sourceAssetId: string; sentenceIndex: number; sourceSentenceCacheKey: string; startMs: number; endMs: number; text: string; keywords: readonly string[]; topics: readonly string[]; vector: readonly number[]; confidence: number | null; quality: "complete" | "needs_review"; qualityReasons: readonly string[] }>;
export type SentenceIndexResult = Readonly<{ schemaVersion: 1; indexVersion: "sentence-index-v1"; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; sourceSentenceCacheKey: string; sourceSentenceResultDigest: string; adapterVersion: "deterministic-keyword-topic-vector-v1"; vectorProvider: "sha256-hash-v1"; vectorDimension: 32; reusedCount: number; rebuiltCount: number; entries: readonly SentenceIndexEntry[] }>;
export type RetrievalFilters = Readonly<{ topics?: readonly string[]; quality?: "complete" | "needs_review"; minConfidence?: number; startMs?: number; endMs?: number }>;
export type RetrievalParams = Readonly<{ projectId: string; query: string; mode?: "lexical" | "vector" | "hybrid"; assetIds?: readonly string[]; limit?: number; filters?: RetrievalFilters; timeoutMs?: number }>;
export type RetrievalTimecode = Readonly<{ startMs: number; endMs: number }>;
export type RetrievalExplanation = Readonly<{ queryKeywords: readonly string[]; matchedKeywords: readonly string[]; matchedTopics: readonly string[]; vectorProvider: "sha256-hash-v1"; scoreFormula: "lexical-keyword-overlap-v1" | "vector-cosine-v1" | "hybrid-0.6-0.4-v1" }>;
export type RetrievalCandidate = Readonly<{ rank: number; sentenceId: string; sourceAssetId: string; sourceSentenceCacheKey: string; sentenceIndex: number; timecode: RetrievalTimecode; text: string; lexicalScore: number; vectorScore: number; hybridScore: number; score: number; explanation: RetrievalExplanation; confidence: number | null; quality: "complete" | "needs_review"; qualityReasons: readonly string[]; previewUri: string }>;
export type RetrievalResult = Readonly<{ schemaVersion: 1; retrievalVersion: "hybrid-retrieval-v1"; projectId: string; query: string; mode: "lexical" | "vector" | "hybrid"; limit: number; candidateCount: number; candidates: readonly RetrievalCandidate[] }>;
export type RerankWeights = Readonly<{ originalScore?: number; narrationClarity?: number; visualQuality?: number; sentenceCompleteness?: number; sentenceIndependence?: number; qaQuality?: number; sourceDiversity?: number }>;
export type RerankConfig = Readonly<{ weights?: RerankWeights; duplicatePenalty?: number; diversityReward?: number; duplicateThreshold?: number; maxPerAsset?: number }>;
export type RerankParams = Readonly<{ projectId: string; query: string; mode?: "lexical" | "vector" | "hybrid"; assetIds?: readonly string[]; filters?: RetrievalFilters; candidateLimit?: number; limit?: number; config?: RerankConfig; timeoutMs?: number }>;
export type RerankTimecode = Readonly<{ startMs: number; endMs: number }>;
export type RerankScores = Readonly<{ originalScore: number; narrationClarityScore: number; narrationQualityScore: number; visualQualityScore: number; sentenceCompletenessScore: number; sentenceIndependenceScore: number; qaScore: number; duplicatePenalty: number; sourceDiversityReward: number; finalScore: number }>;
export type RerankExplanation = Readonly<{ reasons: readonly string[]; qaOpenMarkerCount: number; qaIssueTypes: readonly string[]; duplicateOfSentenceId: string | null; selectedSourceAssetCount: number; visualQualityStatus: "measured" | "degraded"; visualQualityReason: string }>;
export type RerankCandidate = Readonly<{ rank: number; retrievalRank: number; sentenceId: string; sourceAssetId: string; sourceSentenceCacheKey: string; sentenceIndex: number; timecode: RerankTimecode; text: string; quality: "complete" | "needs_review"; qualityStatus: "complete" | "needs_review"; qualityReasons: readonly string[]; previewUri: string; scores: RerankScores; explanation: RerankExplanation }>;
export type RerankResult = Readonly<{ schemaVersion: 1; rerankVersion: "quality-rerank-v1"; projectId: string; query: string; mode: "lexical" | "vector" | "hybrid"; candidateLimit: number; limit: number; candidateCount: number; candidates: readonly RerankCandidate[] }>;
export type SlotAlignmentParams = Readonly<{ projectId: string; inputKind?: "copy" | "outline"; inputText: string; assetIds?: readonly string[]; candidateLimit?: number; useRerank?: boolean; timeoutMs?: number }>;
export type SlotAlignmentTimecode = Readonly<{ startMs: number; endMs: number }>;
export type SlotAlignmentCandidate = Readonly<{ rank: number; origin: "b08-retrieval" | "b09-quality-rerank"; sentenceId: string; sourceAssetId: string; sourceSentenceCacheKey: string; sentenceIndex: number; timecode: SlotAlignmentTimecode; text: string; score: number; quality: "complete"; previewUri: string; selectionReason: string; preservedFacts: readonly string[] }>;
export type InformationSlot = Readonly<{ slotId: string; order: number; kind: "hook" | "context" | "claim" | "evidence" | "benefit" | "requirement" | "process" | "cta" | "closing" | "other"; sourceText: string; query: string; keyFacts: readonly string[]; status: "matched" | "gap"; selectedCandidateRank: number | null; candidates: readonly SlotAlignmentCandidate[]; selectionReason: string | null; gapReason: string | null }>;
export type SlotAlignmentResult = Readonly<{ schemaVersion: 1; alignmentVersion: "information-slot-alignment-v1"; splitterVersion: "deterministic-slot-split-v1"; projectId: string; inputKind: "copy" | "outline"; inputText: string; sourceDigest: string; slotCount: number; matchedCount: number; slots: readonly InformationSlot[] }>;
export type SentenceQaParams = Readonly<{ projectId: string; assetId: string; sentenceCacheKey: string; sentenceIndex: number; contextBefore?: number; contextAfter?: number }>;
export type SentenceQaMarkerInput = Readonly<{ sentenceIndex: number; issueType: "missing-text" | "half-sentence" | "low-confidence" | "boundary-uncertain" | "other"; status?: "open" | "resolved"; source?: "manual" | "automatic"; note?: string; expectedText?: string | null }>;
export type SentenceQaMarker = SentenceQaMarkerInput & Readonly<{ markerId: string; status: "open" | "resolved"; source: "manual" | "automatic"; note: string; expectedText: string | null; createdAtMs: number; updatedAtMs: number }>;
export type SentencePlaybackAddress = Readonly<{ scheme: "supervideo"; assetId: string; kind: "audio" | "video"; startMs: number; endMs: number; uri: string }>;
export type SentenceQaContextItem = Readonly<{ relation: "before" | "selected" | "after"; sentence: SentenceCandidate; playback: SentencePlaybackAddress }>;
export type SentenceQaContextResult = Readonly<{ schemaVersion: 1; qaVersion: "sentence-qa-v1"; projectId: string; assetId: string; sentenceCacheKey: string; selectedIndex: number; items: readonly SentenceQaContextItem[]; markers: readonly SentenceQaMarker[] }>;
export type SentenceQaSaveParams = SentenceQaParams & Readonly<{ markers?: readonly SentenceQaMarkerInput[] }>;
export type SentenceQaSaveResult = Readonly<{ schemaVersion: 1; qaVersion: "sentence-qa-v1"; projectId: string; assetId: string; sentenceCacheKey: string; revision: number; markers: readonly SentenceQaMarker[] }>;
export type CoreProgress = Readonly<{
  requestId: CoreRpcId;
  sequence: number;
  progress: number;
  message: string;
}>;

export type CoreRpcRequest = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  id: CoreRpcId;
  method: string;
  params: Readonly<Record<string, unknown>>;
}>;

export type CoreRpcErrorData = Readonly<{ errorCode: CoreRpcErrorCode }>;
export type CoreRpcErrorObject = Readonly<{
  code: number;
  message: string;
  data: CoreRpcErrorData;
}>;

export type CoreRpcResponse = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  id: CoreRpcId | null;
  result?: unknown;
  error?: CoreRpcErrorObject;
}>;

export type CoreProgressNotification = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  method: typeof CORE_RPC_METHODS.progress;
  params: CoreProgress;
}>;

export type CoreCancelNotification = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  method: typeof CORE_RPC_METHODS.cancel;
  params: Readonly<{ requestId: CoreRpcId }>;
}>;

export type CoreJobEventNotification = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  method: typeof CORE_RPC_METHODS.jobEvent;
  params: JobEvent;
}>;

export type CoreRpcMessage = CoreRpcRequest | CoreRpcResponse | CoreProgressNotification | CoreCancelNotification | CoreJobEventNotification;
export type CoreRpcServerMessage = CoreRpcResponse | CoreProgressNotification | CoreJobEventNotification;

export function createCoreRpcError(errorCode: CoreRpcErrorCode): CoreRpcErrorObject {
  return Object.freeze({
    code: CORE_RPC_ERROR_NUMBERS[errorCode],
    message: CORE_RPC_ERROR_MESSAGES[errorCode],
    data: Object.freeze({ errorCode }),
  });
}

export function createCoreRpcRequest(id: CoreRpcId, method: string, params: Readonly<Record<string, unknown>>): CoreRpcRequest {
  return Object.freeze({ jsonrpc: JSON_RPC_VERSION, id, method, params });
}

export function isCoreRpcErrorCode(value: unknown): value is CoreRpcErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CORE_RPC_ERROR_MESSAGES, value);
}

export function isCoreRpcId(value: unknown): value is CoreRpcId {
  return typeof value === "string"
    && value.length > 0
    && value.length <= CORE_RPC_MAX_REQUEST_ID_LENGTH
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

export function isCoreJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 16) {
    return false;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isCoreJsonValue(item, depth + 1));
  }
  if (!isPlainRecord(value)) {
    return false;
  }
  return Object.entries(value).every(([key, item]) =>
    key.length <= 128 && isCoreJsonValue(item, depth + 1));
}

export function isCoreRpcRequest(value: unknown): value is CoreRpcRequest {
  if (!isPlainRecord(value) || !isCoreJsonValue(value)) {
    return false;
  }
  if (!hasOnlyKeys(value, ["jsonrpc", "id", "method", "params"])) {
    return false;
  }
  if (value.jsonrpc !== JSON_RPC_VERSION || !isCoreRpcId(value.id)) {
    return false;
  }
  if (typeof value.method !== "string" || value.method.length === 0 || value.method.length > CORE_RPC_MAX_METHOD_LENGTH) {
    return false;
  }
  if (!isPlainRecord(value.params)) {
    return false;
  }
  if (value.method === CORE_RPC_METHODS.health) {
    return isEmptyRecord(value.params);
  }
  if (value.method === CORE_RPC_METHODS.smokeCountdown) {
    return isCoreSmokeCountdownParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.cancel) {
    return false;
  }
  if (value.method === CORE_RPC_METHODS.projectCreate) {
    return isProjectCreateParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.projectOpen || value.method === CORE_RPC_METHODS.projectInspect) {
    return isProjectOpenParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.assetReference) {
    return isAssetReferenceParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.assetScan) {
    return isAssetScanParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.assetList) {
    return isAssetListParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.mediaProbe || value.method === CORE_RPC_METHODS.mediaProxy || value.method === CORE_RPC_METHODS.mediaTranscribe) {
    return isMediaParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.mediaVad) return isVadParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentences) return isSentenceParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentenceQaContext) return isSentenceQaParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentenceQaSave) return isSentenceQaSaveParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentenceIndex) return isSentenceIndexParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentenceRetrieve) return isRetrievalParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentenceRerank) return isRerankParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaScriptAlign) return isSlotAlignmentParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobSmokeStart) return isJobSmokeStartParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobGet || value.method === CORE_RPC_METHODS.jobCancel || value.method === CORE_RPC_METHODS.jobRetry) return isJobReferenceParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobList) return isJobListParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobEventsList) return isJobEventsListParams(value.params);
  return true;
}

export function isCoreRpcResponse(value: unknown): value is CoreRpcResponse {
  if (!isPlainRecord(value) || !isCoreJsonValue(value)) {
    return false;
  }
  if (value.jsonrpc !== JSON_RPC_VERSION || (value.id !== null && !isCoreRpcId(value.id))) {
    return false;
  }
  const hasResult = Object.prototype.hasOwnProperty.call(value, "result");
  const hasError = Object.prototype.hasOwnProperty.call(value, "error");
  if (hasResult === hasError) {
    return false;
  }
  if (!hasOnlyKeys(value, hasResult ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"])) {
    return false;
  }
  return hasResult ? isCoreJsonValue(value.result) : isCoreRpcErrorObject(value.error);
}

export function isCoreProgressNotification(value: unknown): value is CoreProgressNotification {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["jsonrpc", "method", "params"])) {
    return false;
  }
  return value.jsonrpc === JSON_RPC_VERSION
    && value.method === CORE_RPC_METHODS.progress
    && isCoreProgress(value.params);
}

export function isCoreJobEventNotification(value: unknown): value is CoreJobEventNotification {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["jsonrpc", "method", "params"])) return false;
  return value.jsonrpc === JSON_RPC_VERSION && value.method === CORE_RPC_METHODS.jobEvent && isJobEvent(value.params);
}

export function isCoreCancelNotification(value: unknown): value is CoreCancelNotification {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["jsonrpc", "method", "params"])) {
    return false;
  }
  return value.jsonrpc === JSON_RPC_VERSION
    && value.method === CORE_RPC_METHODS.cancel
    && isPlainRecord(value.params)
    && hasOnlyKeys(value.params, ["requestId"])
    && isCoreRpcId(value.params.requestId);
}

export function isCoreRpcMessage(value: unknown): value is CoreRpcMessage {
  return isCoreRpcRequest(value)
    || isCoreRpcResponse(value)
    || isCoreProgressNotification(value)
    || isCoreCancelNotification(value)
    || isCoreJobEventNotification(value);
}

export function isCoreRpcServerMessage(value: unknown): value is CoreRpcServerMessage {
  return isCoreRpcResponse(value) || isCoreProgressNotification(value) || isCoreJobEventNotification(value);
}

export function isCoreHealth(value: unknown): value is CoreHealth {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["service", "status", "protocolVersion", "coreVersion", "capabilities"])) {
    return false;
  }
  return value.service === "python-core"
    && value.status === "ok"
    && value.protocolVersion === CORE_RPC_PROTOCOL_VERSION
    && typeof value.coreVersion === "string"
    && value.coreVersion.length > 0
    && value.coreVersion.length <= 32
    && Array.isArray(value.capabilities)
    && value.capabilities.length <= 32
    && value.capabilities.every((capability) => typeof capability === "string" && capability.length > 0 && capability.length <= 64);
}

export function isCoreSmokeCountdownParams(value: unknown): value is CoreSmokeCountdownParams {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["steps", "delayMs"])) {
    return false;
  }
  return isSafeInteger(value.steps, 3, 8) && isSafeInteger(value.delayMs, 1, 1_000);
}

export function isCoreSmokeCountdownResult(value: unknown): value is CoreSmokeCountdownResult {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["status", "steps"])) {
    return false;
  }
  return value.status === "completed" && isSafeInteger(value.steps, 3, 8);
}

export function isProjectSummary(value: unknown): value is ProjectSummary {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "name", "targetPlatform", "projectRoot", "manifestSchemaVersion", "databaseSchemaVersion", "assetCount", "createdAtMs", "updatedAtMs"])
    && isUuid(value.projectId)
    && isSafeString(value.name, 200)
    && isSafeString(value.targetPlatform, 64)
    && isAbsolutePath(value.projectRoot)
    && isSafeInteger(value.manifestSchemaVersion, 1, Number.MAX_SAFE_INTEGER)
    && isSafeInteger(value.databaseSchemaVersion, 1, Number.MAX_SAFE_INTEGER)
    && isSafeInteger(value.assetCount, 0, 1_000_000)
    && isTimestamp(value.createdAtMs)
    && isTimestamp(value.updatedAtMs);
}

export function isAssetSummary(value: unknown): value is AssetSummary {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["assetId", "projectId", "fileName", "absolutePath", "kind", "sizeBytes", "modifiedAtMs", "fingerprintAlgorithm", "referenceStatus"])
    && isUuid(value.assetId)
    && isUuid(value.projectId)
    && isSafeString(value.fileName, 255)
    && isAbsolutePath(value.absolutePath)
    && isSafeString(value.kind, 64)
    && isSafeInteger(value.sizeBytes, 0, Number.MAX_SAFE_INTEGER)
    && isTimestamp(value.modifiedAtMs)
    && isSafeString(value.fingerprintAlgorithm, 64)
    && (value.referenceStatus === "added" || value.referenceStatus === "existing");
}

export function isAssetReferenceBatchResult(value: unknown): value is AssetReferenceBatchResult {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "items"])
    && isUuid(value.projectId)
    && Array.isArray(value.items)
    && value.items.length <= 100
    && value.items.every(isAssetSummary);
}

export function isAssetListResult(value: unknown): value is AssetListResult {
  return isAssetReferenceBatchResult(value);
}

export function isAssetScanResult(value: unknown): value is AssetScanResult {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "directory", "items"])
    && isUuid(value.projectId)
    && isAbsolutePath(value.directory)
    && Array.isArray(value.items)
    && value.items.length <= 100
    && value.items.every(isAssetSummary);
}

export function isMediaProbeResult(value: unknown): value is MediaProbeResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "metadata"])
    && value.schemaVersion === 1 && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSafeString(value.cacheKey, 128) && isMediaMetadata(value.metadata);
}

export function isMediaProxyResult(value: unknown): value is MediaProxyResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "outputs"])
    && value.schemaVersion === 1 && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSafeString(value.cacheKey, 128)
    && Array.isArray(value.outputs) && value.outputs.length === 3 && value.outputs.every(isMediaOutput);
}

export function isTranscriptionResult(value: unknown): value is TranscriptionResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "model", "language", "languageProbability", "durationMs", "segments"])
    && value.schemaVersion === 1 && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSafeString(value.cacheKey, 128)
    && isTranscriptionModelInfo(value.model)
    && (value.language === null || isSafeString(value.language, 64))
    && (value.languageProbability === null || isFiniteInRange(value.languageProbability, 0, 1))
    && (value.durationMs === null || isSafeInteger(value.durationMs, 0, 86_400_000))
    && Array.isArray(value.segments) && value.segments.length <= 2_000 && value.segments.every(isTranscriptionSegment)
    && isBoundedCoreJsonValue(value, 48 * 1024);
}

export function isVadResult(value: unknown): value is VadResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "adapterVersion", "durationMs", "config", "intervals"])
    && value.schemaVersion === 1 && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSafeString(value.cacheKey, 128)
    && value.adapterVersion === "ffmpeg-silencedetect-v1"
    && isSafeInteger(value.durationMs, 0, 86_400_000)
    && isVadConfig(value.config)
    && isVadIntervals(value.intervals, value.durationMs)
    && isBoundedCoreJsonValue(value, 48 * 1024);
}

export function isSentenceResult(value: unknown): value is SentenceResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "adapterVersion", "durationMs", "config", "sentences"])
    && value.schemaVersion === 1 && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSafeString(value.cacheKey, 128)
    && value.adapterVersion === "sentence-segmentation-v1"
    && isSafeInteger(value.durationMs, 0, 86_400_000)
    && isSentenceConfig(value.config)
    && Array.isArray(value.sentences) && value.sentences.length <= 2_000
    && value.sentences.every((item, index) => isSentenceCandidate(item, index, value.assetId as string, value.durationMs as number))
    && isBoundedCoreJsonValue(value, 48 * 1024);
}

export function isSentenceIndexResult(value: unknown): value is SentenceIndexResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "indexVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "sourceSentenceCacheKey", "sourceSentenceResultDigest", "adapterVersion", "vectorProvider", "vectorDimension", "reusedCount", "rebuiltCount", "entries"])
    && value.schemaVersion === 1 && value.indexVersion === "sentence-index-v1" && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSentenceCacheKey(value.cacheKey) && isSentenceCacheKey(value.sourceSentenceCacheKey) && isSentenceCacheKey(value.sourceSentenceResultDigest)
    && value.adapterVersion === "deterministic-keyword-topic-vector-v1" && value.vectorProvider === "sha256-hash-v1" && value.vectorDimension === 32
    && isSafeInteger(value.reusedCount, 0, 2_000) && isSafeInteger(value.rebuiltCount, 0, 2_000)
    && Array.isArray(value.entries) && value.entries.length <= 2_000 && value.reusedCount + value.rebuiltCount === value.entries.length
    && value.entries.every((entry, index) => isSentenceIndexEntry(entry, index, value.assetId as string, value.sourceSentenceCacheKey as string))
    && isBoundedCoreJsonValue(value, 60 * 1024);
}

export function isRetrievalResult(value: unknown): value is RetrievalResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "retrievalVersion", "projectId", "query", "mode", "limit", "candidateCount", "candidates"])
    && value.schemaVersion === 1 && value.retrievalVersion === "hybrid-retrieval-v1" && isUuid(value.projectId)
    && isBoundedText(value.query, 512) && ["lexical", "vector", "hybrid"].includes(value.mode as string)
    && isSafeInteger(value.limit, 1, 50) && isSafeInteger(value.candidateCount, 0, 50)
    && Array.isArray(value.candidates) && value.candidates.length === value.candidateCount
    && value.candidates.every((item, index) => isRetrievalCandidate(item, index + 1))
    && isBoundedCoreJsonValue(value, 60 * 1024);
}

export function isRerankResult(value: unknown): value is RerankResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "rerankVersion", "projectId", "query", "mode", "candidateLimit", "limit", "candidateCount", "candidates"])
    && value.schemaVersion === 1 && value.rerankVersion === "quality-rerank-v1" && isUuid(value.projectId)
    && isBoundedText(value.query, 512) && ["lexical", "vector", "hybrid"].includes(value.mode as string)
    && isSafeInteger(value.candidateLimit, 1, 50) && isSafeInteger(value.limit, 1, 50) && value.limit <= value.candidateLimit
    && isSafeInteger(value.candidateCount, 0, 50) && Array.isArray(value.candidates) && value.candidates.length === value.candidateCount
    && value.candidates.every((item, index) => isRerankCandidate(item, index + 1))
    && isBoundedCoreJsonValue(value, 60 * 1024);
}

export function isSlotAlignmentResult(value: unknown): value is SlotAlignmentResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "alignmentVersion", "splitterVersion", "projectId", "inputKind", "inputText", "sourceDigest", "slotCount", "matchedCount", "slots"])
    && value.schemaVersion === 1 && value.alignmentVersion === "information-slot-alignment-v1" && value.splitterVersion === "deterministic-slot-split-v1"
    && isUuid(value.projectId) && (value.inputKind === "copy" || value.inputKind === "outline")
    && isBoundedMultilineText(value.inputText, 8_192) && isSentenceCacheKey(value.sourceDigest)
    && isSafeInteger(value.slotCount, 1, 32) && isSafeInteger(value.matchedCount, 0, 32)
    && Array.isArray(value.slots) && value.slots.length === value.slotCount
    && value.slots.every((slot, index) => isInformationSlot(slot, index + 1))
    && value.matchedCount === value.slots.filter((slot) => (slot as Record<string, unknown>).status === "matched").length
    && isBoundedCoreJsonValue(value, 60 * 1024);
}

export function isSentenceQaContextResult(value: unknown): value is SentenceQaContextResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "qaVersion", "projectId", "assetId", "sentenceCacheKey", "selectedIndex", "items", "markers"])
    && value.schemaVersion === 1 && value.qaVersion === "sentence-qa-v1" && isUuid(value.projectId) && isUuid(value.assetId)
    && isSentenceCacheKey(value.sentenceCacheKey) && isSafeInteger(value.selectedIndex, 0, 1_999)
    && Array.isArray(value.items) && value.items.length <= 7 && value.items.every((item) => isSentenceQaContextItem(item, value.assetId as string))
    && Array.isArray(value.markers) && value.markers.length <= 500 && value.markers.every(isSentenceQaMarker)
    && isBoundedCoreJsonValue(value, 64 * 1024);
}

export function isSentenceQaSaveResult(value: unknown): value is SentenceQaSaveResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "qaVersion", "projectId", "assetId", "sentenceCacheKey", "revision", "markers"])
    && value.schemaVersion === 1 && value.qaVersion === "sentence-qa-v1" && isUuid(value.projectId) && isUuid(value.assetId)
    && isSentenceCacheKey(value.sentenceCacheKey) && isSafeInteger(value.revision, 1, 2_000_000_000)
    && Array.isArray(value.markers) && value.markers.length <= 500 && value.markers.every(isSentenceQaMarker)
    && isBoundedCoreJsonValue(value, 64 * 1024);
}

function isVadIntervals(value: unknown, durationMs: number): value is readonly SpeechInterval[] {
  if (!Array.isArray(value) || value.length > 4_000) return false;
  let cursor = 0;
  for (let index = 0; index < value.length; index += 1) {
    const interval = value[index];
    if (!isSpeechInterval(interval) || interval.index !== index || interval.startMs !== cursor || interval.endMs > durationMs) return false;
    cursor = interval.endMs;
  }
  return durationMs === 0 ? value.length === 0 : cursor === durationMs;
}

export function isCoreProgress(value: unknown): value is CoreProgress {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["requestId", "sequence", "progress", "message"])) {
    return false;
  }
  return isCoreRpcId(value.requestId)
    && isSafeInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER)
    && typeof value.progress === "number"
    && Number.isFinite(value.progress)
    && value.progress >= 0
    && value.progress <= 1
    && typeof value.message === "string"
    && value.message.length <= CORE_RPC_MAX_PROGRESS_MESSAGE_LENGTH;
}

export function isJobSummary(value: unknown): value is JobSummary {
  return isPlainRecord(value) && hasOnlyKeys(value, ["jobId", "projectId", "jobType", "status", "progress", "stage", "attempt", "revision", "lastEventSequence", "createdAtMs", "updatedAtMs", "startedAtMs", "finishedAtMs", "errorCode"])
    && isUuid(value.jobId) && isUuid(value.projectId) && value.jobType === "smoke.countdown" && isJobStatus(value.status)
    && isFiniteProgress(value.progress) && (value.stage === null || isSafeString(value.stage, 128))
    && isSafeInteger(value.attempt, 0, Number.MAX_SAFE_INTEGER)
    && isSafeInteger(value.revision, 0, Number.MAX_SAFE_INTEGER) && isSafeInteger(value.lastEventSequence, 0, Number.MAX_SAFE_INTEGER)
    && isTimestamp(value.createdAtMs) && isTimestamp(value.updatedAtMs)
    && (value.startedAtMs === null || isTimestamp(value.startedAtMs)) && (value.finishedAtMs === null || isTimestamp(value.finishedAtMs))
    && (value.errorCode === null || isSafeString(value.errorCode, 128));
}

export function isJobEvent(value: unknown): value is JobEvent {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectId", "jobId", "sequence", "eventType", "status", "progress", "stage", "attempt", "timestamp", "payload"])
    && isUuid(value.projectId) && isUuid(value.jobId) && isSafeInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER)
    && isSafeString(value.eventType, 64) && isJobStatus(value.status) && isFiniteProgress(value.progress)
    && (value.stage === null || isSafeString(value.stage, 128)) && isSafeInteger(value.attempt, 0, Number.MAX_SAFE_INTEGER)
    && isTimestamp(value.timestamp) && isBoundedCoreJsonValue(value.payload, 16 * 1024);
}

export function isJobPage(value: unknown): value is JobPage {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectId", "items", "nextCursor", "hasMore"])
    && isUuid(value.projectId) && Array.isArray(value.items) && value.items.length <= 100
    && value.items.every(isJobSummary) && (value.nextCursor === null || isSafeString(value.nextCursor, 512)) && typeof value.hasMore === "boolean";
}

export function isJobEventPage(value: unknown): value is JobEventPage {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectId", "jobId", "items", "nextCursor", "hasMore"])
    && isUuid(value.projectId) && isUuid(value.jobId) && Array.isArray(value.items) && value.items.length <= 100
    && value.items.every(isJobEvent) && (value.nextCursor === null || isSafeString(value.nextCursor, 64)) && typeof value.hasMore === "boolean";
}

export function isCoreRpcErrorObject(value: unknown): value is CoreRpcErrorObject {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["code", "message", "data"])) {
    return false;
  }
  if (!Object.values(CORE_RPC_ERROR_NUMBERS).includes(value.code as number)
    || typeof value.message !== "string"
    || value.message.length > CORE_RPC_MAX_ERROR_MESSAGE_LENGTH) {
    return false;
  }
  if (!isPlainRecord(value.data) || !hasOnlyKeys(value.data, ["errorCode"]) || !isCoreRpcErrorCode(value.data.errorCode)) {
    return false;
  }
  return value.code === CORE_RPC_ERROR_NUMBERS[value.data.errorCode]
    && value.message === CORE_RPC_ERROR_MESSAGES[value.data.errorCode];
}

export function serializeCoreRpcMessage(value: CoreRpcMessage | CoreRpcServerMessage): string {
  if (!isCoreJsonValue(value)) {
    throw new Error("Core RPC message is not JSON-safe.");
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined || utf8ByteLength(serialized) > CORE_RPC_MAX_LINE_BYTES) {
    throw new Error("Core RPC message exceeds the line limit.");
  }
  return serialized;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key)) && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return isPlainRecord(value) && Object.keys(value).length === 0;
}

function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isTimestamp(value: unknown): value is number {
  return isSafeInteger(value, 0, Number.MAX_SAFE_INTEGER);
}

function isProjectCreateParams(value: unknown): value is ProjectCreateParams {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["name", "targetPlatform", "projectRoot"])
    && isSafeString(value.name, 200)
    && !/[\u0000-\u001f\u007f]/.test(value.name)
    && isSafeString(value.targetPlatform, 64)
    && !/[\u0000-\u001f\u007f]/.test(value.targetPlatform)
    && isAbsolutePath(value.projectRoot);
}

function isProjectOpenParams(value: unknown): value is ProjectOpenParams {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectRoot"]) && isAbsolutePath(value.projectRoot);
}

function isAssetReferenceParams(value: unknown): value is AssetReferenceParams {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "paths"])
    && isUuid(value.projectId)
    && Array.isArray(value.paths)
    && value.paths.length > 0
    && value.paths.length <= 100
    && value.paths.every((item) => isAbsolutePath(item));
}

function isAssetListParams(value: unknown): value is AssetListParams {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "limit"])
    && isUuid(value.projectId)
    && isSafeInteger(value.limit, 1, 1_000);
}

function isAssetScanParams(value: unknown): value is AssetScanParams {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "directory"])
    && isUuid(value.projectId)
    && isAbsolutePath(value.directory);
}

function isMediaParams(value: unknown): value is MediaParams {
  return isPlainRecord(value) && hasNoUnexpectedKeys(value, ["projectId", "assetId", "timeoutMs"])
    && isUuid(value.projectId) && isUuid(value.assetId)
    && (value.timeoutMs === undefined || isSafeInteger(value.timeoutMs, 1_000, 120_000));
}

function isVadParams(value: unknown): value is VadParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "assetId", "timeoutMs", "config"])) return false;
  if (!isUuid(value.projectId) || !isUuid(value.assetId) || (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000))) return false;
  if (value.config === undefined) return true;
  if (!isPlainRecord(value.config)) return false;
  return hasNoUnexpectedKeys(value.config, ["thresholdDb", "minSpeechMs", "minSilenceMs", "preRollMs", "postRollMs", "mergeGapMs"])
    && (value.config.thresholdDb === undefined || isFiniteInRange(value.config.thresholdDb, -60, -5))
    && (value.config.minSpeechMs === undefined || isSafeInteger(value.config.minSpeechMs, 20, 5_000))
    && (value.config.minSilenceMs === undefined || isSafeInteger(value.config.minSilenceMs, 20, 5_000))
    && (value.config.preRollMs === undefined || isSafeInteger(value.config.preRollMs, 0, 180))
    && (value.config.postRollMs === undefined || isSafeInteger(value.config.postRollMs, 0, 250))
    && (value.config.mergeGapMs === undefined || isSafeInteger(value.config.mergeGapMs, 0, 1_000));
}

function isSentenceParams(value: unknown): value is SentenceParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "assetId", "timeoutMs", "config"])) return false;
  if (!isUuid(value.projectId) || !isUuid(value.assetId) || (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000))) return false;
  if (value.config === undefined) return true;
  return isPlainRecord(value.config) && hasNoUnexpectedKeys(value.config, ["maxSentenceMs", "pauseBoundaryMs", "minSentenceMs", "preRollMs", "postRollMs"])
    && (value.config.maxSentenceMs === undefined || isSafeInteger(value.config.maxSentenceMs, 1_000, 30_000))
    && (value.config.pauseBoundaryMs === undefined || isSafeInteger(value.config.pauseBoundaryMs, 100, 3_000))
    && (value.config.minSentenceMs === undefined || isSafeInteger(value.config.minSentenceMs, 0, 5_000))
    && (value.config.preRollMs === undefined || isSafeInteger(value.config.preRollMs, 0, 180))
    && (value.config.postRollMs === undefined || isSafeInteger(value.config.postRollMs, 0, 250));
}

export function isSentenceQaParams(value: unknown): value is SentenceQaParams {
  return isPlainRecord(value) && hasNoUnexpectedKeys(value, ["projectId", "assetId", "sentenceCacheKey", "sentenceIndex", "contextBefore", "contextAfter"])
    && isUuid(value.projectId) && isUuid(value.assetId) && isSentenceCacheKey(value.sentenceCacheKey)
    && isSafeInteger(value.sentenceIndex, 0, 1_999)
    && (value.contextBefore === undefined || isSafeInteger(value.contextBefore, 0, 3))
    && (value.contextAfter === undefined || isSafeInteger(value.contextAfter, 0, 3));
}

export function isSentenceIndexParams(value: unknown): value is SentenceIndexParams {
  return isPlainRecord(value) && hasNoUnexpectedKeys(value, ["projectId", "assetId", "sentenceCacheKey", "timeoutMs"])
    && isUuid(value.projectId) && isUuid(value.assetId) && isSentenceCacheKey(value.sentenceCacheKey)
    && (value.timeoutMs === undefined || isSafeInteger(value.timeoutMs, 1_000, 120_000));
}

export function isRetrievalParams(value: unknown): value is RetrievalParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "query", "mode", "assetIds", "limit", "filters", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || !isBoundedText(value.query, 512) || !(value.query as string).trim()) return false;
  if (value.mode !== undefined && !["lexical", "vector", "hybrid"].includes(value.mode as string)) return false;
  if (value.limit !== undefined && !isSafeInteger(value.limit, 1, 50)) return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  if (value.assetIds !== undefined && (!Array.isArray(value.assetIds) || value.assetIds.length > 100 || value.assetIds.length !== new Set(value.assetIds).size || !value.assetIds.every(isUuid))) return false;
  if (value.filters === undefined) return true;
  const filters = value.filters;
  if (!isPlainRecord(filters) || !hasNoUnexpectedKeys(filters, ["topics", "quality", "minConfidence", "startMs", "endMs"])) return false;
  if (filters.topics !== undefined && (!Array.isArray(filters.topics) || filters.topics.length > 8 || filters.topics.length !== new Set(filters.topics).size || !filters.topics.every((item) => isBoundedText(item, 64)))) return false;
  if (filters.quality !== undefined && filters.quality !== "complete" && filters.quality !== "needs_review") return false;
  if (filters.minConfidence !== undefined && !isFiniteInRange(filters.minConfidence, 0, 1)) return false;
  if (filters.startMs !== undefined && !isSafeInteger(filters.startMs, 0, 86_400_000)) return false;
  if (filters.endMs !== undefined && !isSafeInteger(filters.endMs, 1, 86_400_000)) return false;
  return filters.startMs === undefined || filters.endMs === undefined || filters.endMs > filters.startMs;
}

export function isRerankParams(value: unknown): value is RerankParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "query", "mode", "assetIds", "filters", "candidateLimit", "limit", "config", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || !isBoundedText(value.query, 512) || !(value.query as string).trim()) return false;
  if (value.mode !== undefined && !["lexical", "vector", "hybrid"].includes(value.mode as string)) return false;
  if (value.candidateLimit !== undefined && !isSafeInteger(value.candidateLimit, 1, 50)) return false;
  if (value.limit !== undefined && !isSafeInteger(value.limit, 1, 50)) return false;
  if (value.limit !== undefined && value.candidateLimit !== undefined && value.limit > value.candidateLimit) return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  if (value.assetIds !== undefined && (!Array.isArray(value.assetIds) || value.assetIds.length > 100 || value.assetIds.length !== new Set(value.assetIds).size || !value.assetIds.every(isUuid))) return false;
  if (value.filters !== undefined && !isRetrievalParams({ projectId: value.projectId, query: value.query, filters: value.filters })) return false;
  if (value.config === undefined) return true;
  const config = value.config;
  if (!isPlainRecord(config) || !hasNoUnexpectedKeys(config, ["weights", "duplicatePenalty", "diversityReward", "duplicateThreshold", "maxPerAsset"])) return false;
  if (config.duplicatePenalty !== undefined && !isFiniteInRange(config.duplicatePenalty, 0, 1)) return false;
  if (config.diversityReward !== undefined && !isFiniteInRange(config.diversityReward, 0, 1)) return false;
  if (config.duplicateThreshold !== undefined && !isFiniteInRange(config.duplicateThreshold, 0, 1)) return false;
  if (config.maxPerAsset !== undefined && !isSafeInteger(config.maxPerAsset, 1, 50)) return false;
  if (config.weights === undefined) return true;
  const weights = config.weights;
  if (!isPlainRecord(weights) || !hasNoUnexpectedKeys(weights, ["originalScore", "narrationClarity", "visualQuality", "sentenceCompleteness", "sentenceIndependence", "qaQuality", "sourceDiversity"])) return false;
  const values = [weights.originalScore, weights.narrationClarity, weights.visualQuality, weights.sentenceCompleteness, weights.sentenceIndependence, weights.qaQuality, weights.sourceDiversity];
  return values.every((item) => item === undefined || isFiniteInRange(item, 0, 1))
    && (values.every((item) => item === undefined) || values.some((item) => item !== undefined && item > 0));
}

export function isSlotAlignmentParams(value: unknown): value is SlotAlignmentParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "inputKind", "inputText", "assetIds", "candidateLimit", "useRerank", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || (value.inputKind !== undefined && value.inputKind !== "copy" && value.inputKind !== "outline")) return false;
  if (!isBoundedMultilineText(value.inputText, 8_192)) return false;
  if (value.candidateLimit !== undefined && !isSafeInteger(value.candidateLimit, 1, 8)) return false;
  if (value.useRerank !== undefined && typeof value.useRerank !== "boolean") return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  return value.assetIds === undefined || Array.isArray(value.assetIds) && value.assetIds.length >= 1 && value.assetIds.length <= 100
    && value.assetIds.length === new Set(value.assetIds).size && value.assetIds.every(isUuid);
}

export function isSentenceQaSaveParams(value: unknown): value is SentenceQaSaveParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "assetId", "sentenceCacheKey", "sentenceIndex", "contextBefore", "contextAfter", "markers"])) return false;
  const base = { ...value };
  delete base.markers;
  if (!isSentenceQaParams(base)) return false;
  const markers = (value as SentenceQaSaveParams).markers;
  return markers === undefined || Array.isArray(markers) && markers.length <= 500 && markers.every(isSentenceQaMarkerInput);
}

function isSentenceQaMarkerInput(value: unknown): value is SentenceQaMarkerInput {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["sentenceIndex", "issueType", "status", "source", "note", "expectedText"])) return false;
  const validFields = isSafeInteger(value.sentenceIndex, 0, 1_999)
    && ["missing-text", "half-sentence", "low-confidence", "boundary-uncertain", "other"].includes(value.issueType as string)
    && (value.status === undefined || value.status === "open" || value.status === "resolved")
    && (value.source === undefined || value.source === "manual" || value.source === "automatic")
    && (value.note === undefined || isBoundedText(value.note, 256))
    && (value.expectedText === undefined || value.expectedText === null || isBoundedText(value.expectedText, 2_048));
  if (!validFields) return false;
  return value.issueType !== "missing-text" || value.status === "resolved" || (value.expectedText !== undefined && value.expectedText !== null) || (typeof value.note === "string" && value.note.length > 0);
}

export function isSentenceCacheKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length <= maximumLength && !/[\u0000-\u001f]/.test(value);
}

function isBoundedMultilineText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length <= maximumLength && value.trim().length > 0
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function isSentenceQaMarker(value: unknown): value is SentenceQaMarker {
  if (!isSentenceQaMarkerInput(value) || !isPlainRecord(value)) return false;
  const marker = value as SentenceQaMarker;
  return hasOnlyKeys(value, ["sentenceIndex", "issueType", "status", "source", "note", "expectedText", "markerId", "createdAtMs", "updatedAtMs"])
    && isUuid(marker.markerId) && marker.status !== undefined && marker.source !== undefined && marker.note !== undefined
    && marker.expectedText !== undefined && isTimestamp(marker.createdAtMs) && isTimestamp(marker.updatedAtMs)
    && marker.updatedAtMs >= marker.createdAtMs;
}

function isSentenceQaContextItem(value: unknown, assetId: string): value is SentenceQaContextItem {
  return isPlainRecord(value) && hasOnlyKeys(value, ["relation", "sentence", "playback"])
    && (value.relation === "before" || value.relation === "selected" || value.relation === "after")
    && isPlainRecord(value.sentence) && isSentenceCandidate(value.sentence, value.sentence.index as number, assetId, 86_400_000)
    && isPlainRecord(value.playback) && hasOnlyKeys(value.playback, ["scheme", "assetId", "kind", "startMs", "endMs", "uri"])
    && value.playback.scheme === "supervideo" && value.playback.assetId === assetId
    && (value.playback.kind === "audio" || value.playback.kind === "video")
    && isSafeInteger(value.playback.startMs, 0, 86_400_000) && isSafeInteger(value.playback.endMs, 1, 86_400_000)
    && value.playback.endMs > value.playback.startMs
    && value.playback.uri === `supervideo://asset/${assetId}?kind=${value.playback.kind}&startMs=${value.playback.startMs}&endMs=${value.playback.endMs}`;
}

function isVadConfig(value: unknown): value is VadConfig {
  return isPlainRecord(value) && hasOnlyKeys(value, ["thresholdDb", "minSpeechMs", "minSilenceMs", "preRollMs", "postRollMs", "mergeGapMs"])
    && isFiniteInRange(value.thresholdDb, -60, -5)
    && isSafeInteger(value.minSpeechMs, 20, 5_000)
    && isSafeInteger(value.minSilenceMs, 20, 5_000)
    && isSafeInteger(value.preRollMs, 0, 180)
    && isSafeInteger(value.postRollMs, 0, 250)
    && isSafeInteger(value.mergeGapMs, 0, 1_000);
}

function isSentenceConfig(value: unknown): value is SentenceConfig {
  return isPlainRecord(value) && hasOnlyKeys(value, ["maxSentenceMs", "pauseBoundaryMs", "minSentenceMs", "preRollMs", "postRollMs"])
    && isSafeInteger(value.maxSentenceMs, 1_000, 30_000)
    && isSafeInteger(value.pauseBoundaryMs, 100, 3_000)
    && isSafeInteger(value.minSentenceMs, 0, 5_000)
    && isSafeInteger(value.preRollMs, 0, 180)
    && isSafeInteger(value.postRollMs, 0, 250);
}

function isSentenceCandidate(value: unknown, index: number, assetId: string, durationMs: number): value is SentenceCandidate {
  return isPlainRecord(value) && hasOnlyKeys(value, ["index", "sourceAssetId", "startMs", "endMs", "text", "confidence", "quality", "qualityReasons", "sourceSegmentIndexes"])
    && value.index === index && value.sourceAssetId === assetId
    && isSafeInteger(value.startMs, 0, durationMs) && isSafeInteger(value.endMs, value.startMs + 1, durationMs)
    && isSafeString(value.text, 2_048)
    && (value.confidence === null || isFiniteInRange(value.confidence, 0, 1))
    && (value.quality === "complete" && Array.isArray(value.qualityReasons) && value.qualityReasons.length === 0 || value.quality === "needs_review" && Array.isArray(value.qualityReasons) && value.qualityReasons.length > 0)
    && Array.isArray(value.qualityReasons) && value.qualityReasons.length <= 8 && value.qualityReasons.every((reason) => isSafeString(reason, 64))
    && Array.isArray(value.sourceSegmentIndexes) && value.sourceSegmentIndexes.length <= 2_000
    && value.sourceSegmentIndexes.every((sourceIndex) => isSafeInteger(sourceIndex, 0, 1_999));
}

function isSentenceIndexEntry(value: unknown, index: number, assetId: string, sourceCacheKey: string): value is SentenceIndexEntry {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["sentenceId", "sourceAssetId", "sentenceIndex", "sourceSentenceCacheKey", "startMs", "endMs", "text", "keywords", "topics", "vector", "confidence", "quality", "qualityReasons"])) return false;
  return isSentenceCacheKey(value.sentenceId) && value.sourceAssetId === assetId && value.sentenceIndex === index && value.sourceSentenceCacheKey === sourceCacheKey
    && isSafeInteger(value.startMs, 0, 86_400_000) && isSafeInteger(value.endMs, value.startMs + 1, 86_400_000)
    && isSafeString(value.text, 2_048)
    && Array.isArray(value.keywords) && value.keywords.length <= 32 && value.keywords.length > 0 && value.keywords.every((item) => isSafeString(item, 64))
    && Array.isArray(value.topics) && value.topics.length <= 8 && value.topics.length > 0 && value.topics.every((item) => isSafeString(item, 64))
    && Array.isArray(value.vector) && value.vector.length === 32 && value.vector.every((item) => isFiniteInRange(item, -1, 1))
    && (value.confidence === null || isFiniteInRange(value.confidence, 0, 1))
    && (value.quality === "complete" && Array.isArray(value.qualityReasons) && value.qualityReasons.length === 0 || value.quality === "needs_review" && Array.isArray(value.qualityReasons) && value.qualityReasons.length > 0)
    && Array.isArray(value.qualityReasons) && value.qualityReasons.length <= 8 && value.qualityReasons.every((reason) => isSafeString(reason, 64));
}

function isRetrievalCandidate(value: unknown, rank: number): value is RetrievalCandidate {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["rank", "sentenceId", "sourceAssetId", "sourceSentenceCacheKey", "sentenceIndex", "timecode", "text", "lexicalScore", "vectorScore", "hybridScore", "score", "explanation", "confidence", "quality", "qualityReasons", "previewUri"])) return false;
  if (value.rank !== rank || !isSentenceCacheKey(value.sentenceId) || !isUuid(value.sourceAssetId) || !isSentenceCacheKey(value.sourceSentenceCacheKey)) return false;
  if (!isSafeInteger(value.sentenceIndex, 0, 1_999) || !isSafeString(value.text, 2_048)) return false;
  if (!isPlainRecord(value.timecode) || !hasOnlyKeys(value.timecode, ["startMs", "endMs"]) || !isSafeInteger(value.timecode.startMs, 0, 86_400_000) || !isSafeInteger(value.timecode.endMs, 1, 86_400_000) || value.timecode.endMs <= value.timecode.startMs) return false;
  if (!isFiniteInRange(value.lexicalScore, 0, 1) || !isFiniteInRange(value.vectorScore, 0, 1) || !isFiniteInRange(value.hybridScore, 0, 1) || !isFiniteInRange(value.score, 0, 1)) return false;
  if (!isPlainRecord(value.explanation) || !hasOnlyKeys(value.explanation, ["queryKeywords", "matchedKeywords", "matchedTopics", "vectorProvider", "scoreFormula"])) return false;
  if (!Array.isArray(value.explanation.queryKeywords) || value.explanation.queryKeywords.length > 32 || !value.explanation.queryKeywords.every((item) => isSafeString(item, 64))) return false;
  if (!Array.isArray(value.explanation.matchedKeywords) || value.explanation.matchedKeywords.length > 32 || !value.explanation.matchedKeywords.every((item) => isSafeString(item, 64))) return false;
  if (!Array.isArray(value.explanation.matchedTopics) || value.explanation.matchedTopics.length > 8 || !value.explanation.matchedTopics.every((item) => isSafeString(item, 64))) return false;
  if (value.explanation.vectorProvider !== "sha256-hash-v1" || !["lexical-keyword-overlap-v1", "vector-cosine-v1", "hybrid-0.6-0.4-v1"].includes(value.explanation.scoreFormula as string)) return false;
  if (value.confidence !== null && !isFiniteInRange(value.confidence, 0, 1)) return false;
  if (value.quality !== "complete" && value.quality !== "needs_review") return false;
  if (!Array.isArray(value.qualityReasons) || value.qualityReasons.length > 8 || !value.qualityReasons.every((item) => isSafeString(item, 256))) return false;
  return value.previewUri === `supervideo://asset/${value.sourceAssetId}?kind=audio&startMs=${value.timecode.startMs}&endMs=${value.timecode.endMs}`;
}

function isRerankCandidate(value: unknown, rank: number): value is RerankCandidate {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["rank", "retrievalRank", "sentenceId", "sourceAssetId", "sourceSentenceCacheKey", "sentenceIndex", "timecode", "text", "quality", "qualityStatus", "qualityReasons", "previewUri", "scores", "explanation"])) return false;
  if (value.rank !== rank || !isSafeInteger(value.retrievalRank, 1, 50) || !isSentenceCacheKey(value.sentenceId) || !isUuid(value.sourceAssetId) || !isSentenceCacheKey(value.sourceSentenceCacheKey)) return false;
  if (!isSafeInteger(value.sentenceIndex, 0, 1_999) || !isSafeString(value.text, 2_048)) return false;
  if (!isPlainRecord(value.timecode) || !hasOnlyKeys(value.timecode, ["startMs", "endMs"]) || !isSafeInteger(value.timecode.startMs, 0, 86_400_000) || !isSafeInteger(value.timecode.endMs, 1, 86_400_000) || value.timecode.endMs <= value.timecode.startMs) return false;
  if ((value.quality !== "complete" && value.quality !== "needs_review") || value.qualityStatus !== value.quality) return false;
  if (!Array.isArray(value.qualityReasons) || value.qualityReasons.length > 8 || !value.qualityReasons.every((item) => isSafeString(item, 2_048))) return false;
  if (value.quality === "complete" && value.qualityReasons.length > 0 || value.quality === "needs_review" && value.qualityReasons.length === 0) return false;
  if (value.previewUri !== `supervideo://asset/${value.sourceAssetId}?kind=audio&startMs=${value.timecode.startMs}&endMs=${value.timecode.endMs}`) return false;
  if (!isPlainRecord(value.scores) || !hasOnlyKeys(value.scores, ["originalScore", "narrationClarityScore", "narrationQualityScore", "visualQualityScore", "sentenceCompletenessScore", "sentenceIndependenceScore", "qaScore", "duplicatePenalty", "sourceDiversityReward", "finalScore"])) return false;
  if (![value.scores.originalScore, value.scores.narrationClarityScore, value.scores.narrationQualityScore, value.scores.visualQualityScore, value.scores.sentenceCompletenessScore, value.scores.sentenceIndependenceScore, value.scores.qaScore, value.scores.duplicatePenalty, value.scores.sourceDiversityReward, value.scores.finalScore].every((item) => isFiniteInRange(item, 0, 1))) return false;
  if (!isPlainRecord(value.explanation) || !hasOnlyKeys(value.explanation, ["reasons", "qaOpenMarkerCount", "qaIssueTypes", "duplicateOfSentenceId", "selectedSourceAssetCount", "visualQualityStatus", "visualQualityReason"])) return false;
  if (!Array.isArray(value.explanation.reasons) || value.explanation.reasons.length > 8 || !value.explanation.reasons.every((item) => isSafeString(item, 96))) return false;
  if (!isSafeInteger(value.explanation.qaOpenMarkerCount, 0, 500) || !Array.isArray(value.explanation.qaIssueTypes) || value.explanation.qaIssueTypes.length > 5 || !value.explanation.qaIssueTypes.every((item) => isSafeString(item, 64))) return false;
  if (value.explanation.duplicateOfSentenceId !== null && !isSentenceCacheKey(value.explanation.duplicateOfSentenceId)) return false;
  return isSafeInteger(value.explanation.selectedSourceAssetCount, 1, 50)
    && (value.explanation.visualQualityStatus === "measured" || value.explanation.visualQualityStatus === "degraded")
    && isSafeString(value.explanation.visualQualityReason, 96);
}

function isInformationSlot(value: unknown, order: number): value is InformationSlot {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["slotId", "order", "kind", "sourceText", "query", "keyFacts", "status", "selectedCandidateRank", "candidates", "selectionReason", "gapReason"])) return false;
  if (value.slotId !== `slot-${order}` || value.order !== order || !["hook", "context", "claim", "evidence", "benefit", "requirement", "process", "cta", "closing", "other"].includes(value.kind as string)) return false;
  if (!isBoundedText(value.sourceText, 512) || !isBoundedText(value.query, 512)) return false;
  if (!Array.isArray(value.keyFacts) || value.keyFacts.length > 8 || !value.keyFacts.every((item) => isBoundedText(item, 64))) return false;
  const keyFacts = value.keyFacts as readonly string[];
  if (!Array.isArray(value.candidates) || value.candidates.length > 8 || !value.candidates.every((candidate, index) => isSlotAlignmentCandidate(candidate, index + 1, keyFacts))) return false;
  if (value.status === "matched") {
    return value.candidates.length > 0
      && value.candidates.every((candidate) => candidate.preservedFacts.length === keyFacts.length && keyFacts.every((fact) => candidate.preservedFacts.includes(fact)))
      && value.selectedCandidateRank === 1 && isBoundedText(value.selectionReason, 128) && value.gapReason === null;
  }
  return value.status === "gap" && value.candidates.length === 0 && value.selectedCandidateRank === null && value.selectionReason === null && isBoundedText(value.gapReason, 128);
}

function isSlotAlignmentCandidate(value: unknown, rank: number, keyFacts: readonly string[]): value is SlotAlignmentCandidate {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["rank", "origin", "sentenceId", "sourceAssetId", "sourceSentenceCacheKey", "sentenceIndex", "timecode", "text", "score", "quality", "previewUri", "selectionReason", "preservedFacts"])) return false;
  if (value.rank !== rank || (value.origin !== "b08-retrieval" && value.origin !== "b09-quality-rerank") || !isSentenceCacheKey(value.sentenceId) || !isUuid(value.sourceAssetId) || !isSentenceCacheKey(value.sourceSentenceCacheKey)) return false;
  if (!isSafeInteger(value.sentenceIndex, 0, 1_999) || !isBoundedText(value.text, 2_048) || !isFiniteInRange(value.score, 0, 1) || value.quality !== "complete") return false;
  if (!isPlainRecord(value.timecode) || !hasOnlyKeys(value.timecode, ["startMs", "endMs"]) || !isSafeInteger(value.timecode.startMs, 0, 86_400_000) || !isSafeInteger(value.timecode.endMs, 1, 86_400_000) || value.timecode.endMs <= value.timecode.startMs) return false;
  if (value.previewUri !== `supervideo://asset/${value.sourceAssetId}?kind=audio&startMs=${value.timecode.startMs}&endMs=${value.timecode.endMs}`) return false;
  return isBoundedText(value.selectionReason, 128)
    && Array.isArray(value.preservedFacts)
    && value.preservedFacts.length <= 8
    && value.preservedFacts.every((item) => isBoundedText(item, 64) && keyFacts.includes(item) && extractSlotFacts(value.text as string).includes(item));
}

function extractSlotFacts(text: string): string[] {
  const source = text.replace(/^\s*\d{1,3}[.)、]\s*/gm, "");
  const patterns = [
    /\d{4}年\d{1,2}月\d{1,2}日/g,
    /\d{1,2}月\d{1,2}日/g,
    /\d+(?:\.\d+)?\s*(?:(?:万|千)?元|万|千|岁|人|天|月|年|分钟|秒|小时|%|％)/g,
    /\b[A-Z][A-Za-z0-9_-]{1,31}\b/g,
    /(?<![A-Za-z0-9])\d+(?:\.\d+)?(?![A-Za-z0-9])/g,
  ];
  const matches: Array<{ position: number; value: string }> = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match.index !== undefined) matches.push({ position: match.index, value: match[0] });
    }
  }
  const values: string[] = [];
  for (const item of matches.sort((left, right) => left.position - right.position || (left.value < right.value ? -1 : left.value > right.value ? 1 : 0))) {
    if (item.value && !values.includes(item.value)) values.push(item.value);
  }
  return values.filter((item) => !values.some((other) => item !== other && other.includes(item))).slice(0, 8);
}

function isSpeechInterval(value: unknown): value is SpeechInterval {
  return isPlainRecord(value) && hasOnlyKeys(value, ["index", "startMs", "endMs", "isSpeech", "confidence", "quality"])
    && isSafeInteger(value.index, 0, 3_999)
    && isSafeInteger(value.startMs, 0, 86_400_000)
    && isSafeInteger(value.endMs, value.startMs + 1, 86_400_000)
    && typeof value.isSpeech === "boolean"
    && (value.confidence === null || isFiniteInRange(value.confidence, 0, 1))
    && ["detected", "silence", "boundary-expanded", "boundary-clipped", "merged"].includes(value.quality as string);
}

function isTranscriptionModelInfo(value: unknown): value is TranscriptionModelInfo {
  return isPlainRecord(value) && hasOnlyKeys(value, ["adapterVersion", "provider", "modelName", "device", "computeType"])
    && value.adapterVersion === "faster-whisper-v1" && value.provider === "faster-whisper"
    && ["tiny", "base", "small", "medium", "large-v3"].includes(value.modelName as string)
    && ["cpu", "cuda"].includes(value.device as string)
    && ["int8", "float16", "float32", "int8_float16"].includes(value.computeType as string);
}

function isTranscriptionSegment(value: unknown): value is TranscriptionSegment {
  return isPlainRecord(value) && hasOnlyKeys(value, ["index", "startMs", "endMs", "text", "confidence", "avgLogprob", "noSpeechProbability", "compressionRatio", "words"])
    && isSafeInteger(value.index, 0, 1_999)
    && isSafeInteger(value.startMs, 0, 86_400_000)
    && isSafeInteger(value.endMs, value.startMs, 86_400_000)
    && isSafeString(value.text, 2_048)
    && (value.confidence === null || isFiniteInRange(value.confidence, 0, 1))
    && (value.avgLogprob === null || isFiniteInRange(value.avgLogprob, -100, 100))
    && (value.noSpeechProbability === null || isFiniteInRange(value.noSpeechProbability, 0, 1))
    && (value.compressionRatio === null || isFiniteInRange(value.compressionRatio, 0, 100))
    && Array.isArray(value.words) && value.words.length <= 128 && value.words.every(isTranscriptionWord);
}

function isTranscriptionWord(value: unknown): value is TranscriptionWord {
  return isPlainRecord(value) && hasOnlyKeys(value, ["startMs", "endMs", "text", "probability"])
    && isSafeInteger(value.startMs, 0, 86_400_000)
    && isSafeInteger(value.endMs, value.startMs, 86_400_000)
    && isSafeString(value.text, 2_048)
    && (value.probability === null || isFiniteInRange(value.probability, 0, 1));
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isMediaMetadata(value: unknown): value is MediaMetadata {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "formatName", "formatLongName", "durationMs", "bitRate", "streams"])
    && value.schemaVersion === 1
    && (value.formatName === null || isSafeString(value.formatName, 128))
    && (value.formatLongName === null || isSafeString(value.formatLongName, 256))
    && (value.durationMs === null || isSafeInteger(value.durationMs, 0, 86_400_000_000))
    && (value.bitRate === null || isSafeInteger(value.bitRate, 0, 10_000_000_000))
    && Array.isArray(value.streams) && value.streams.length <= 64 && value.streams.every(isMediaStream);
}

function isMediaStream(value: unknown): value is MediaStream {
  return isPlainRecord(value) && hasOnlyKeys(value, ["index", "codecType", "codecName", "width", "height", "frameRate", "sampleRate", "channels", "channelLayout", "language"])
    && isSafeInteger(value.index, 0, 100_000)
    && ["video", "audio", "data", "subtitle", "attachment", "unknown"].includes(value.codecType as string)
    && (value.codecName === null || isSafeString(value.codecName, 64))
    && (value.width === null || isSafeInteger(value.width, 1, 100_000))
    && (value.height === null || isSafeInteger(value.height, 1, 100_000))
    && (value.frameRate === null || typeof value.frameRate === "number" && Number.isFinite(value.frameRate) && value.frameRate >= 0 && value.frameRate <= 1_000)
    && (value.sampleRate === null || isSafeInteger(value.sampleRate, 1, 1_000_000))
    && (value.channels === null || isSafeInteger(value.channels, 1, 256))
    && (value.channelLayout === null || isSafeString(value.channelLayout, 64))
    && (value.language === null || isSafeString(value.language, 32));
}

function isMediaOutput(value: unknown): value is MediaOutput {
  return isPlainRecord(value) && hasOnlyKeys(value, ["kind", "relativePath", "sizeBytes"])
    && (value.kind === "audio" || value.kind === "video" || value.kind === "thumbnail")
    && isSafeString(value.relativePath, 512) && value.relativePath.startsWith("cache/media-cache-v1/")
    && isSafeInteger(value.sizeBytes, 1, Number.MAX_SAFE_INTEGER);
}

function isMediaCacheStatus(value: unknown): value is "created" | "cache-hit" {
  return value === "created" || value === "cache-hit";
}

function hasNoUnexpectedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key));
}

function isJobStatus(value: unknown): value is JobStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "retrying" || value === "cancelling" || value === "cancelled" || value === "needs_attention";
}

function isFiniteProgress(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isJobSmokeStartParams(value: unknown): value is JobSmokeStartParams {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectId", "idempotencyKey", "steps", "delayMs", "failAttempts"])
    && isUuid(value.projectId) && isSafeString(value.idempotencyKey, 256)
    && (value.steps === undefined || isSafeInteger(value.steps, 3, 8))
    && (value.delayMs === undefined || isSafeInteger(value.delayMs, 1, 1_000))
    && (value.failAttempts === undefined || isSafeInteger(value.failAttempts, 0, 1));
}

export function isJobReferenceParams(value: unknown): value is JobReferenceParams {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectId", "jobId"]) && isUuid(value.projectId) && isUuid(value.jobId);
}

export function isJobListParams(value: unknown): value is JobListParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "statuses", "cursor", "limit"]) || !isUuid(value.projectId)) return false;
  return (value.statuses === undefined || Array.isArray(value.statuses) && value.statuses.length <= 8 && value.statuses.every(isJobStatus))
    && (value.cursor === undefined || value.cursor === null || isSafeString(value.cursor, 512))
    && (value.limit === undefined || isSafeInteger(value.limit, 1, 100));
}

export function isJobEventsListParams(value: unknown): value is JobEventsListParams {
  return isPlainRecord(value) && hasNoUnexpectedKeys(value, ["projectId", "jobId", "afterSequence", "cursor", "limit"])
    && isUuid(value.projectId) && isUuid(value.jobId) && (value.afterSequence === undefined || isSafeInteger(value.afterSequence, 0, Number.MAX_SAFE_INTEGER))
    && (value.cursor === undefined || value.cursor === null || isSafeString(value.cursor, 64))
    && (value.limit === undefined || isSafeInteger(value.limit, 1, 100));
}

function isBoundedCoreJsonValue(value: unknown, maximumBytes: number): boolean {
  if (!isCoreJsonValue(value)) return false;
  try {
    return utf8ByteLength(JSON.stringify(value)) <= maximumBytes;
  } catch {
    return false;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 32_767
    && !value.includes("\u0000")
    && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/"));
}

function isSafeString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}
