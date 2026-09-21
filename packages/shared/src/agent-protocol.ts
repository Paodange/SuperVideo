import type {
  AssetListResult,
  AssetReferenceBatchResult,
  JobEvent,
  JobEventPage,
  JobEventsListParams,
  JobListParams,
  JobPage,
  JobReferenceParams,
  JobSmokeStartParams,
  JobSummary,
  ProjectSummary,
  SentenceQaParams,
  SentenceQaSaveParams,
} from "./core-rpc";
import { isBoundedText, isJobEvent, isJobEventPage, isJobPage, isJobSummary, isMediaProbeResult, isMediaProxyResult, isSentenceCacheKey, isTranscriptionResult, isVadResult, isSentenceResult, isSentenceQaContextResult, isSentenceQaSaveResult, isSentenceIndexParams, isSentenceIndexResult } from "./core-rpc";
import {
  PUBLIC_A08_ERROR_CODES,
  isAgentDiagnosticEvent,
  type A08PublicErrorCode,
  type AgentDiagnosticEvent,
  type CredentialListResult,
  type CredentialMetadata,
  type CredentialRemoveRequest,
  type CredentialRemoveResult,
  type CredentialReplaceRequest,
  type CredentialSaveRequest,
  type CredentialStorageStatus,
  type DiagnosticExportResult,
} from "./diagnostics-protocol";

/**
 * The protocol between Electron Main and the isolated Agent utility process.
 * Keep this contract independent from the Renderer IPC contract: the Main
 * process is the only component allowed to translate between the two.
 */
export const AGENT_WORKER_PROTOCOL_VERSION = 1 as const;
export const AGENT_WORKER_MAX_MESSAGE_BYTES = 64 * 1024;
export const AGENT_WORKER_VERSION = "0.1.0" as const;

export const AGENT_WORKER_CAPABILITIES = ["smoke-task", "cancel", "project", "transcription", "vad", "sentences", "sentence-index", "jobs", "diagnostics"] as const;

export const AGENT_WORKER_COMMAND_TYPES = {
  runSmokeTask: "run-smoke-task",
  cancelRun: "cancel-run",
  ping: "ping",
  shutdown: "shutdown",
  projectCreate: "project-create",
  projectOpen: "project-open",
  projectInspect: "project-inspect",
  assetReference: "asset-reference",
  assetScan: "asset-scan",
  assetList: "asset-list",
  mediaProbe: "media-probe",
  mediaProxy: "media-proxy",
  mediaTranscribe: "media-transcribe",
  mediaVad: "media-vad",
  mediaSentences: "media-sentences",
  mediaSentenceQaContext: "media-sentence-qa-context",
  mediaSentenceQaSave: "media-sentence-qa-save",
  mediaSentenceIndex: "media-sentence-index",
  jobSmokeStart: "job-smoke-start",
  jobGet: "job-get",
  jobList: "job-list",
  jobEventsList: "job-events-list",
  jobCancel: "job-cancel",
  jobRetry: "job-retry",
} as const;

export const AGENT_WORKER_MESSAGE_TYPES = {
  ready: "ready",
  pong: "pong",
  runEvent: "run-event",
  runFinished: "run-finished",
  workerError: "worker-error",
  projectOperationResult: "project-operation-result",
  projectOperationError: "project-operation-error",
  jobOperationResult: "job-operation-result",
  jobOperationError: "job-operation-error",
  jobEvent: "job-event",
  diagnosticEvent: "diagnostic-event",
} as const;

export type AgentWorkerCommandType = (typeof AGENT_WORKER_COMMAND_TYPES)[keyof typeof AGENT_WORKER_COMMAND_TYPES];
export type AgentWorkerMessageType = (typeof AGENT_WORKER_MESSAGE_TYPES)[keyof typeof AGENT_WORKER_MESSAGE_TYPES];
export type AgentProjectOperationType =
  | "project-create"
  | "project-open"
  | "project-inspect"
  | "asset-reference"
  | "asset-scan"
  | "asset-list"
  | "media-probe"
  | "media-proxy"
  | "media-transcribe"
  | "media-vad"
  | "media-sentences"
  | "media-sentence-qa-context"
  | "media-sentence-qa-save"
  | "media-sentence-index";
export type AgentJobOperationType = "job-smoke-start" | "job-get" | "job-list" | "job-events-list" | "job-cancel" | "job-retry";
export type AgentOperationType = AgentProjectOperationType | AgentJobOperationType;
export type ProjectOperationErrorCode =
  | "DIALOG_CANCELLED"
  | "INVALID_PROJECT_NAME"
  | "INVALID_PROJECT_ROOT"
  | "UNSUPPORTED_PROJECT_LOCATION"
  | "PROJECT_DIRECTORY_NOT_EMPTY"
  | "PROJECT_ALREADY_EXISTS"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_MANIFEST_INVALID"
  | "PROJECT_SCHEMA_TOO_NEW"
  | "PROJECT_DATABASE_MISSING"
  | "PROJECT_ID_MISMATCH"
  | "PROJECT_PATH_CONFLICT"
  | "PROJECT_NOT_ACTIVE"
  | "ASSET_NOT_FOUND"
  | "UNSUPPORTED_ASSET_TYPE"
  | "TOO_MANY_ASSETS"
  | "ASSET_CHANGED"
  | "ASSET_CHANGED_DURING_REFERENCE"
  | "FILE_ACCESS_DENIED"
  | "OPERATION_TIMEOUT"
  | "CORE_UNAVAILABLE"
  | "DATABASE_OPEN_FAILED"
  | "DATABASE_READ_ONLY"
  | "DATABASE_BUSY"
  | "DATABASE_CORRUPT"
  | "MIGRATION_FAILED"
  | "MIGRATION_CHECKSUM_MISMATCH"
  | "SCHEMA_TOO_NEW"
  | "CONSTRAINT_VIOLATION"
  | "RECORD_NOT_FOUND"
  | "INVALID_RECORD"
  | "MEDIA_TOOL_UNAVAILABLE" | "MEDIA_TOOL_TIMEOUT" | "MEDIA_PROBE_PARSE_ERROR"
  | "MEDIA_NOT_MEDIA" | "MEDIA_OUTPUT_INVALID" | "MEDIA_CANCELLED"
  | "TRANSCRIPTION_TOOL_UNAVAILABLE" | "TRANSCRIPTION_MODEL_UNAVAILABLE" | "TRANSCRIPTION_OUTPUT_INVALID" | "TRANSCRIPTION_TIMEOUT" | "TRANSCRIPTION_CANCELLED"
  | "VAD_TOOL_UNAVAILABLE" | "VAD_OUTPUT_INVALID" | "VAD_TIMEOUT" | "VAD_CANCELLED"
  | "SENTENCE_PREREQUISITE_UNAVAILABLE" | "SENTENCE_PREREQUISITE_INVALID" | "SENTENCE_OUTPUT_INVALID" | "SENTENCE_TIMEOUT" | "SENTENCE_CANCELLED"
  | "SENTENCE_QA_RESULT_NOT_FOUND" | "SENTENCE_QA_RESULT_INVALID" | "SENTENCE_QA_INDEX_INVALID" | "SENTENCE_QA_STORAGE_INVALID" | "SENTENCE_QA_OUTPUT_INVALID"
  | "SENTENCE_INDEX_SOURCE_NOT_FOUND" | "SENTENCE_INDEX_SOURCE_INVALID" | "SENTENCE_INDEX_SOURCE_STALE" | "SENTENCE_INDEX_STORAGE_INVALID" | "SENTENCE_INDEX_OUTPUT_INVALID" | "SENTENCE_INDEX_TIMEOUT" | "SENTENCE_INDEX_CANCELLED";

export type ProjectOperationError = Readonly<{
  code: ProjectOperationErrorCode;
  message: string;
}>;
export type JobOperationErrorCode = ProjectOperationErrorCode
  | "JOB_NOT_FOUND" | "JOB_STATE_CONFLICT" | "JOB_NOT_CANCELLABLE" | "JOB_NOT_RETRYABLE"
  | "JOB_RETRY_LIMIT" | "JOB_QUEUE_FULL" | "JOB_EXECUTOR_UNAVAILABLE" | "JOB_CHECKPOINT_INVALID"
  | "JOB_EVENT_GAP" | "IDEMPOTENCY_CONFLICT" | "JOB_SHUTTING_DOWN" | "JOB_EXECUTION_FAILED";
export type JobOperationError = Readonly<{ code: JobOperationErrorCode; message: string }>;

export type AgentRunStatus = "idle" | "running" | "completed" | "cancelled" | "interrupted" | "error";

export type AgentWorkerStatus = "starting" | "ready" | "running" | "restarting" | "unavailable" | "stopped";

export type AgentPublicErrorCode =
  | "busy"
  | "cancelled"
  | "forbidden-sender"
  | "internal-error"
  | "invalid-message"
  | "invalid-payload"
  | "invalid-run-id"
  | "run-not-found"
  | "worker-exited"
  | "worker-not-ready"
  | "worker-ready-timeout"
  | "worker-unavailable";

export type AgentPublicError = Readonly<{
  code: AgentPublicErrorCode;
  message: string;
}>;

export type AgentRunEvent =
  | Readonly<{ kind: "run-started" }>
  | Readonly<{ kind: "assistant-text-delta"; delta: string }>
  | Readonly<{ kind: "tool-started"; toolCallId: string; toolName: string }>
  | Readonly<{ kind: "tool-progress"; toolCallId: string; progress: number; message: string }>
  | Readonly<{ kind: "tool-finished"; toolCallId: string; toolName: string; ok: boolean; summary?: string }>;

export type AgentWorkerCommand =
  | Readonly<{ protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION; type: "run-smoke-task"; runId: string; steps: number }>
  | Readonly<{ protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION; type: "cancel-run"; runId: string }>
  | Readonly<{ protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION; type: "ping" }>
  | Readonly<{ protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION; type: "shutdown" }>
  | AgentProjectOperationCommand
  | AgentJobOperationCommand;
export type AgentProjectOperationPayload = Readonly<Record<string, unknown>>;
export type AgentProjectOperationCommand = Readonly<{
  protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
  type: AgentProjectOperationType;
  operationId: string;
  timestamp: number;
  projectId?: string;
  payload: AgentProjectOperationPayload;
}>;
export type AgentJobOperationCommand = Readonly<{
  protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
  type: AgentJobOperationType;
  operationId: string;
  timestamp: number;
  projectId: string;
  payload: Readonly<Record<string, unknown>>;
}>;
export type AgentWorkerCommandWithProjects = AgentWorkerCommand;

export type AgentWorkerMessage =
  | Readonly<{
      protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
      type: "ready";
      timestamp: number;
      workerVersion: string;
      capabilities: readonly string[];
    }>
  | Readonly<{ protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION; type: "pong"; timestamp: number }>
  | Readonly<{
      protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
      type: "run-event";
      runId: string;
      sequence: number;
      timestamp: number;
      event: AgentRunEvent;
    }>
  | Readonly<{
      protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
      type: "run-finished";
      runId: string;
      sequence: number;
      timestamp: number;
      status: Exclude<AgentRunStatus, "idle" | "running">;
      error?: AgentPublicError;
    }>
  | Readonly<{
      protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
      type: "worker-error";
      timestamp: number;
      error: AgentPublicError;
    }>
  | Readonly<{
      protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
      type: "project-operation-result";
      operationId: string;
      operation: AgentProjectOperationType;
      timestamp: number;
      projectId?: string;
      payload: Readonly<Record<string, unknown>>;
    }>
  | Readonly<{
      protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
      type: "job-operation-result";
      operationId: string;
      operation: AgentJobOperationType;
      timestamp: number;
      projectId: string;
      payload: Readonly<Record<string, unknown>>;
    }>
  | Readonly<{
      protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
      type: "job-operation-error";
      operationId: string;
      operation: AgentJobOperationType;
      timestamp: number;
      error: JobOperationError;
    }>
  | Readonly<{
      protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
      type: "job-event";
      projectId: string;
      jobId: string;
      event: JobEvent;
    }>
  | Readonly<{
      protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
      type: "diagnostic-event";
      event: AgentDiagnosticEvent;
    }>
  | Readonly<{
      protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION;
      type: "project-operation-error";
      operationId: string;
      operation: AgentProjectOperationType;
      timestamp: number;
      error: ProjectOperationError;
    }>;

export type AgentWorkerStatusSnapshot = Readonly<{
  status: AgentWorkerStatus;
  generation: number;
  activeRunId: string | null;
  runStatus: AgentRunStatus;
  restartCount: number;
  lastErrorCode: AgentPublicErrorCode | null;
  workerVersion: string | null;
  capabilities: readonly string[];
}>;

export type AgentRunHandle = Readonly<{ runId: string }>;

export type DesktopAgentEvent =
  | Readonly<{ kind: "worker-status"; timestamp: number; status: AgentWorkerStatusSnapshot }>
  | Readonly<{
      kind: "run-event";
      timestamp: number;
      runId: string;
      sequence: number;
      event: AgentRunEvent;
    }>
  | Readonly<{
      kind: "run-finished";
      timestamp: number;
      runId: string;
      sequence: number;
      status: Exclude<AgentRunStatus, "idle" | "running">;
      error?: AgentPublicError;
    }>
  | Readonly<{ kind: "worker-error"; timestamp: number; error: AgentPublicError }>
  | Readonly<{ kind: "job-event"; timestamp: number; projectId: string; jobId: string; event: JobEvent }>;

export const DESKTOP_IPC_CONTRACT_VERSION = 2 as const;

export const DESKTOP_IPC_CHANNELS = {
  getEnvironment: "desktop:v2:get-environment",
  getAgentStatus: "desktop:v2:get-agent-status",
  runAgentSmokeTask: "desktop:v2:run-agent-smoke-task",
  cancelAgentRun: "desktop:v2:cancel-agent-run",
  agentEvent: "desktop:v2:agent-event",
  createProject: "desktop:v2:create-project",
  openProject: "desktop:v2:open-project",
  addAssetReferences: "desktop:v2:add-asset-references",
  listProjectAssets: "desktop:v2:list-project-assets",
  inspectSentenceQa: "desktop:v2:inspect-sentence-qa",
  saveSentenceQa: "desktop:v2:save-sentence-qa",
  startSmokeJob: "desktop:v2:start-smoke-job",
  getJob: "desktop:v2:get-job",
  listJobs: "desktop:v2:list-jobs",
  listJobEvents: "desktop:v2:list-job-events",
  cancelJob: "desktop:v2:cancel-job",
  retryJob: "desktop:v2:retry-job",
  credentialsStatus: "desktop:v2:credentials-status",
  credentialsList: "desktop:v2:credentials-list",
  credentialsSave: "desktop:v2:credentials-save",
  credentialsReplace: "desktop:v2:credentials-replace",
  credentialsRemove: "desktop:v2:credentials-remove",
  diagnosticsExport: "desktop:v2:diagnostics-export",
} as const;

export type DesktopIpcChannel = (typeof DESKTOP_IPC_CHANNELS)[keyof typeof DESKTOP_IPC_CHANNELS];

export function isDesktopIpcChannel(value: unknown): value is DesktopIpcChannel {
  return Object.values(DESKTOP_IPC_CHANNELS).includes(value as DesktopIpcChannel);
}

export type DesktopEnvironment = {
  mode: "development" | "production";
  platform: string;
  electron: string;
};

export type GetEnvironmentRequest = Record<string, never>;
export type GetAgentStatusRequest = Record<string, never>;
export type RunAgentSmokeTaskRequest = Record<string, never>;
export type CancelAgentRunRequest = Readonly<{ runId: string }>;
export type CreateProjectRequest = Readonly<{ name: string; targetPlatform: string }>;
export type OpenProjectRequest = Record<string, never>;
export type AddAssetReferencesRequest = Readonly<{ projectId: string }>;
export type ListProjectAssetsRequest = Readonly<{ projectId: string }>;
export type StartSmokeJobRequest = JobSmokeStartParams;
export type GetJobRequest = JobReferenceParams;
export type ListJobsRequest = JobListParams;
export type ListJobEventsRequest = JobEventsListParams;
export type CancelJobRequest = JobReferenceParams;
export type RetryJobRequest = JobReferenceParams;
export type CredentialsStatusRequest = Record<string, never>;
export type CredentialsListRequest = Record<string, never>;
export type ProjectDialogResult<T> = Readonly<{ cancelled: true }> | Readonly<{ cancelled: false; value: T }>;

export type DesktopPublicErrorCode = AgentPublicErrorCode | JobOperationErrorCode | A08PublicErrorCode;
export type DesktopPublicError = Readonly<{
  code: DesktopPublicErrorCode;
  message: string;
}>;

export type DesktopIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: DesktopPublicError }>;

export type DesktopApi = Readonly<{
  getEnvironment: () => Promise<DesktopEnvironment>;
  getAgentStatus: () => Promise<AgentWorkerStatusSnapshot>;
  runSmokeTask: () => Promise<AgentRunHandle>;
  cancelSmokeRun: (runId: string) => Promise<void>;
  onAgentEvent: (listener: (event: DesktopAgentEvent) => void) => () => void;
  createProject: (input: CreateProjectRequest) => Promise<ProjectDialogResult<ProjectSummary>>;
  openProject: () => Promise<ProjectDialogResult<ProjectSummary>>;
  addAssetReferences: (input: AddAssetReferencesRequest) => Promise<ProjectDialogResult<AssetReferenceBatchResult>>;
  listProjectAssets: (input: ListProjectAssetsRequest) => Promise<AssetListResult>;
  inspectSentenceQa: (input: SentenceQaParams) => Promise<import("./core-rpc").SentenceQaContextResult>;
  saveSentenceQa: (input: SentenceQaSaveParams) => Promise<import("./core-rpc").SentenceQaSaveResult>;
  startSmokeJob: (input: JobSmokeStartParams) => Promise<JobSummary>;
  getJob: (input: JobReferenceParams) => Promise<JobSummary>;
  listJobs: (input: JobListParams) => Promise<JobPage>;
  listJobEvents: (input: JobEventsListParams) => Promise<JobEventPage>;
  cancelJob: (input: JobReferenceParams) => Promise<JobSummary>;
  retryJob: (input: JobReferenceParams) => Promise<JobSummary>;
  onJobEvent: (listener: (event: JobEvent) => void) => () => void;
  credentials: Readonly<{
    status: () => Promise<CredentialStorageStatus>;
    list: () => Promise<CredentialListResult>;
    save: (input: CredentialSaveRequest) => Promise<CredentialMetadata>;
    replace: (input: CredentialReplaceRequest) => Promise<CredentialMetadata>;
    remove: (input: CredentialRemoveRequest) => Promise<CredentialRemoveResult>;
  }>;
  diagnostics: Readonly<{ export: () => Promise<DiagnosticExportResult> }>;
}>;

const PUBLIC_ERROR_MESSAGES: Readonly<Record<DesktopPublicErrorCode, string>> = {
  busy: "The Agent Worker is already running a task.",
  cancelled: "The Agent task was cancelled.",
  "forbidden-sender": "The desktop request was rejected.",
  "internal-error": "The desktop request could not be completed.",
  "invalid-message": "The Agent Worker message was rejected.",
  "invalid-payload": "The desktop request payload is invalid.",
  "invalid-run-id": "The Agent run identifier is invalid.",
  "run-not-found": "The requested Agent run was not found.",
  "worker-exited": "The Agent Worker exited unexpectedly.",
  "worker-not-ready": "The Agent Worker is still starting.",
  "worker-ready-timeout": "The Agent Worker did not become ready in time.",
  "worker-unavailable": "The Agent Worker is currently unavailable.",
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
  CREDENTIAL_STORAGE_UNAVAILABLE: "Secure credential storage is unavailable.",
  CREDENTIAL_STORE_CORRUPT: "Secure credential storage is corrupt.",
  CREDENTIAL_NOT_FOUND: "The credential was not found.",
  INVALID_CREDENTIAL_INPUT: "The credential input is invalid.",
  CREDENTIAL_WRITE_FAILED: "Secure credential storage could not be updated.",
  DIAGNOSTIC_EXPORT_CANCELLED: "The diagnostics export was cancelled.",
  DIAGNOSTIC_EXPORT_FAILED: "Diagnostics could not be exported.",
};

export function createDesktopPublicError(code: DesktopPublicErrorCode): DesktopPublicError {
  return Object.freeze({ code, message: PUBLIC_ERROR_MESSAGES[code] });
}

export function createAgentPublicError(code: AgentPublicErrorCode): AgentPublicError {
  return createDesktopPublicError(code) as AgentPublicError;
}

export function isDesktopPublicError(value: unknown): value is DesktopPublicError {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["code", "message"])) {
    return false;
  }

  const candidate = value as Partial<DesktopPublicError>;
  return isDesktopPublicErrorCode(candidate.code) && candidate.message === PUBLIC_ERROR_MESSAGES[candidate.code];
}

export function isAgentPublicErrorCode(value: unknown): value is AgentPublicErrorCode {
  return value === "busy" || value === "cancelled" || value === "forbidden-sender" || value === "internal-error"
    || value === "invalid-message" || value === "invalid-payload" || value === "invalid-run-id"
    || value === "run-not-found" || value === "worker-exited" || value === "worker-not-ready"
    || value === "worker-ready-timeout" || value === "worker-unavailable";
}

export function isDesktopPublicErrorCode(value: unknown): value is DesktopPublicErrorCode {
  return isAgentPublicErrorCode(value) || isJobOperationErrorCode(value) || (typeof value === "string" && (PUBLIC_A08_ERROR_CODES as readonly string[]).includes(value));
}

export function isValidAgentRunId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value);
}

export function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null) {
    return value === null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, depth + 1));
  }
  if (isPlainRecord(value)) {
    return Object.getOwnPropertySymbols(value).length === 0
      && Object.entries(value).every(([key, item]) => key.length <= 128 && isJsonValue(item, depth + 1));
  }
  return false;
}

export function isValidAgentWorkerCommand(value: unknown): value is AgentWorkerCommand {
  if (!isPlainRecord(value) || value.protocolVersion !== AGENT_WORKER_PROTOCOL_VERSION || !isJsonValue(value)) {
    return false;
  }

  if (value.type === "run-smoke-task") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "runId", "steps"])
      && isValidAgentRunId(value.runId)
      && isSafeInteger(value.steps, 3, 8);
  }
  if (value.type === "cancel-run") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "runId"]) && isValidAgentRunId(value.runId);
  }
  if (value.type === "ping" || value.type === "shutdown") {
    return hasOnlyKeys(value, ["protocolVersion", "type"]);
  }
  if (isAgentProjectOperationType(value.type)) {
    return hasOnlyKeys(value, ["protocolVersion", "type", "operationId", "timestamp", "projectId", "payload"])
      && isValidAgentRunId(value.operationId)
      && isTimestamp(value.timestamp)
      && (value.projectId === undefined || isUuid(value.projectId))
      && isProjectOperationPayload(value.type, value.payload);
  }
  if (isAgentJobOperationType(value.type)) {
    return hasOnlyKeys(value, ["protocolVersion", "type", "operationId", "timestamp", "projectId", "payload"])
      && isValidAgentRunId(value.operationId)
      && isTimestamp(value.timestamp)
      && isUuid(value.projectId)
      && isJobOperationPayload(value.type, value.payload);
  }
  return false;
}

export function isValidAgentWorkerMessage(value: unknown): value is AgentWorkerMessage {
  if (!isPlainRecord(value) || value.protocolVersion !== AGENT_WORKER_PROTOCOL_VERSION || !isJsonValue(value)) {
    return false;
  }

  if (value.type === "ready") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "timestamp", "workerVersion", "capabilities"])
      && isTimestamp(value.timestamp)
      && typeof value.workerVersion === "string"
      && value.workerVersion.length > 0
      && value.workerVersion.length <= 32
      && Array.isArray(value.capabilities)
      && value.capabilities.length <= 16
      && value.capabilities.every((capability) => typeof capability === "string" && capability.length <= 64);
  }
  if (value.type === "pong") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "timestamp"]) && isTimestamp(value.timestamp);
  }
  if (value.type === "run-event") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "runId", "sequence", "timestamp", "event"])
      && isValidAgentRunId(value.runId)
      && isSafeInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER)
      && isTimestamp(value.timestamp)
      && isAgentRunEvent(value.event);
  }
  if (value.type === "run-finished") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "runId", "sequence", "timestamp", "status", "error"])
      && isValidAgentRunId(value.runId)
      && isSafeInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER)
      && isTimestamp(value.timestamp)
      && (value.status === "completed" || value.status === "cancelled" || value.status === "interrupted" || value.status === "error")
      && (value.error === undefined || isAgentPublicError(value.error));
  }
  if (value.type === "worker-error") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "timestamp", "error"])
      && isTimestamp(value.timestamp)
      && isAgentPublicError(value.error);
  }
  if (value.type === "project-operation-result") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "operationId", "operation", "timestamp", "projectId", "payload"])
      && isValidAgentRunId(value.operationId)
      && isAgentProjectOperationType(value.operation)
      && isTimestamp(value.timestamp)
      && (value.projectId === undefined || isUuid(value.projectId))
      && isPlainRecord(value.payload)
      && isJsonValue(value.payload)
      && isProjectOperationResultPayload(value.operation, value.payload);
  }
  if (value.type === "project-operation-error") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "operationId", "operation", "timestamp", "error"])
      && isValidAgentRunId(value.operationId)
      && isAgentProjectOperationType(value.operation)
      && isTimestamp(value.timestamp)
      && isProjectOperationError(value.error);
  }
  if (value.type === "job-operation-result") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "operationId", "operation", "timestamp", "projectId", "payload"])
      && isValidAgentRunId(value.operationId) && isAgentJobOperationType(value.operation)
      && isTimestamp(value.timestamp) && isUuid(value.projectId) && isPlainRecord(value.payload) && isJsonValue(value.payload)
      && isJobOperationPayload(value.operation, value.payload, true);
  }
  if (value.type === "job-operation-error") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "operationId", "operation", "timestamp", "error"])
      && isValidAgentRunId(value.operationId) && isAgentJobOperationType(value.operation)
      && isTimestamp(value.timestamp) && isJobOperationError(value.error);
  }
  if (value.type === "job-event") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "projectId", "jobId", "event"])
      && isUuid(value.projectId) && isUuid(value.jobId) && isJobEvent(value.event)
      && value.event.projectId === value.projectId && value.event.jobId === value.jobId;
  }
  if (value.type === "diagnostic-event") {
    return hasOnlyKeys(value, ["protocolVersion", "type", "event"])
      && isAgentDiagnosticEvent(value.event);
  }
  return false;
}

export function isValidDesktopAgentEvent(value: unknown): value is DesktopAgentEvent {
  if (!isPlainRecord(value) || !isJsonValue(value)) {
    return false;
  }
  if (value.kind === "worker-status") {
    return hasOnlyKeys(value, ["kind", "timestamp", "status"]) && isTimestamp(value.timestamp) && isAgentWorkerStatusSnapshot(value.status);
  }
  if (value.kind === "run-event") {
    return hasOnlyKeys(value, ["kind", "timestamp", "runId", "sequence", "event"])
      && isTimestamp(value.timestamp)
      && isValidAgentRunId(value.runId)
      && isSafeInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER)
      && isAgentRunEvent(value.event);
  }
  if (value.kind === "run-finished") {
    return hasOnlyKeys(value, ["kind", "timestamp", "runId", "sequence", "status", "error"])
      && isTimestamp(value.timestamp)
      && isValidAgentRunId(value.runId)
      && isSafeInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER)
      && (value.status === "completed" || value.status === "cancelled" || value.status === "interrupted" || value.status === "error")
      && (value.error === undefined || isAgentPublicError(value.error));
  }
  if (value.kind === "worker-error") {
    return hasOnlyKeys(value, ["kind", "timestamp", "error"]) && isTimestamp(value.timestamp) && isAgentPublicError(value.error);
  }
  if (value.kind === "job-event") {
    return hasOnlyKeys(value, ["kind", "timestamp", "projectId", "jobId", "event"])
      && isTimestamp(value.timestamp) && isUuid(value.projectId) && isUuid(value.jobId)
      && isJobEvent(value.event) && value.event.projectId === value.projectId && value.event.jobId === value.jobId;
  }
  return false;
}

export function isAgentWorkerStatusSnapshot(value: unknown): value is AgentWorkerStatusSnapshot {
  if (!isPlainRecord(value)) {
    return false;
  }
  return hasOnlyKeys(value, ["status", "generation", "activeRunId", "runStatus", "restartCount", "lastErrorCode", "workerVersion", "capabilities"])
    && (value.status === "starting" || value.status === "ready" || value.status === "running" || value.status === "restarting" || value.status === "unavailable" || value.status === "stopped")
    && isSafeInteger(value.generation, 0, Number.MAX_SAFE_INTEGER)
    && (value.activeRunId === null || isValidAgentRunId(value.activeRunId))
    && (value.runStatus === "idle" || value.runStatus === "running" || value.runStatus === "completed" || value.runStatus === "cancelled" || value.runStatus === "interrupted" || value.runStatus === "error")
    && isSafeInteger(value.restartCount, 0, Number.MAX_SAFE_INTEGER)
    && (value.lastErrorCode === null || isAgentPublicErrorCode(value.lastErrorCode))
    && (value.workerVersion === null || (typeof value.workerVersion === "string" && value.workerVersion.length <= 32))
    && Array.isArray(value.capabilities)
    && value.capabilities.length <= 16
    && value.capabilities.every((capability) => typeof capability === "string" && capability.length <= 64);
}

export function isValidAgentWireMessage(value: unknown): value is AgentWorkerCommand | AgentWorkerMessage {
  return isValidAgentWorkerCommand(value) || isValidAgentWorkerMessage(value);
}

export function isAgentWorkerMessageWithinLimit(value: unknown): boolean {
  if (!isValidAgentWorkerMessage(value)) {
    return false;
  }
  try {
    const encoded = encodeURIComponent(JSON.stringify(value));
    const byteLength = encoded.replace(/%[0-9A-F]{2}/gi, "_").length;
    return byteLength <= AGENT_WORKER_MAX_MESSAGE_BYTES;
  } catch {
    return false;
  }
}

function isAgentRunEvent(value: unknown): value is AgentRunEvent {
  if (!isPlainRecord(value)) {
    return false;
  }
  if (value.kind === "run-started") {
    return hasOnlyKeys(value, ["kind"]);
  }
  if (value.kind === "assistant-text-delta") {
    return hasOnlyKeys(value, ["kind", "delta"]) && typeof value.delta === "string" && value.delta.length <= 4096;
  }
  if (value.kind === "tool-started") {
    return hasOnlyKeys(value, ["kind", "toolCallId", "toolName"])
      && isSafeString(value.toolCallId, 128)
      && isSafeString(value.toolName, 128);
  }
  if (value.kind === "tool-progress") {
    return hasOnlyKeys(value, ["kind", "toolCallId", "progress", "message"])
      && isSafeString(value.toolCallId, 128)
      && typeof value.progress === "number"
      && Number.isFinite(value.progress)
      && value.progress >= 0
      && value.progress <= 1
      && isSafeString(value.message, 512);
  }
  if (value.kind === "tool-finished") {
    return hasOnlyKeys(value, ["kind", "toolCallId", "toolName", "ok", "summary"])
      && isSafeString(value.toolCallId, 128)
      && isSafeString(value.toolName, 128)
      && typeof value.ok === "boolean"
      && (value.summary === undefined || isSafeString(value.summary, 512));
  }
  return false;
}

function isAgentPublicError(value: unknown): value is AgentPublicError {
  return isDesktopPublicError(value)
    && isPlainRecord(value)
    && isAgentPublicErrorCode(value.code);
}

function isAgentProjectOperationType(value: unknown): value is AgentProjectOperationType {
  return value === "project-create"
    || value === "project-open"
    || value === "project-inspect"
    || value === "asset-reference"
    || value === "asset-scan"
    || value === "asset-list"
    || value === "media-probe"
    || value === "media-proxy"
    || value === "media-transcribe"
    || value === "media-vad"
    || value === "media-sentences"
    || value === "media-sentence-qa-context"
    || value === "media-sentence-qa-save";
}

function isAgentJobOperationType(value: unknown): value is AgentJobOperationType {
  return value === "job-smoke-start" || value === "job-get" || value === "job-list"
    || value === "job-events-list" || value === "job-cancel" || value === "job-retry";
}

function isProjectOperationError(value: unknown): value is ProjectOperationError {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["code", "message"])
    && typeof value.code === "string"
    && PROJECT_OPERATION_ERROR_CODES.has(value.code)
    && typeof value.message === "string"
    && value.message.length > 0
    && value.message.length <= 128;
}

export function isProjectOperationErrorCode(value: unknown): value is ProjectOperationErrorCode {
  return typeof value === "string" && PROJECT_OPERATION_ERROR_CODES.has(value);
}

export function isJobOperationErrorCode(value: unknown): value is JobOperationErrorCode {
  return typeof value === "string" && JOB_OPERATION_ERROR_CODES.has(value);
}

function isProjectOperationPayload(type: AgentProjectOperationType, value: unknown): boolean {
  if (!isPlainRecord(value) || !isJsonValue(value)) {
    return false;
  }
  if (type === "project-create") {
    return hasOnlyKeys(value, ["name", "targetPlatform", "projectRoot"])
      && isSafeString(value.name, 200)
      && isSafeString(value.targetPlatform, 64)
      && isAbsolutePath(value.projectRoot);
  }
  if (type === "project-open" || type === "project-inspect") {
    return hasOnlyKeys(value, ["projectRoot"]) && isAbsolutePath(value.projectRoot);
  }
  if (type === "asset-reference") {
    return hasOnlyKeys(value, ["projectId", "paths"])
      && isUuid(value.projectId)
      && Array.isArray(value.paths)
      && value.paths.length > 0
      && value.paths.length <= 100
      && value.paths.every((item) => isAbsolutePath(item));
  }
  if (type === "asset-scan") {
    return hasOnlyKeys(value, ["projectId", "directory"])
      && isUuid(value.projectId)
      && isAbsolutePath(value.directory);
  }
  if (type === "media-probe" || type === "media-proxy" || type === "media-transcribe") {
    return hasNoUnexpectedKeys(value, ["projectId", "assetId", "timeoutMs"])
      && isUuid(value.projectId) && isUuid(value.assetId)
      && (value.timeoutMs === undefined || isSafeInteger(value.timeoutMs, 1_000, 120_000));
  }
  if (type === "media-sentences") {
    if (!hasNoUnexpectedKeys(value, ["projectId", "assetId", "timeoutMs", "config"]) || !isUuid(value.projectId) || !isUuid(value.assetId)) return false;
    if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
    if (value.config === undefined) return true;
    return isPlainRecord(value.config) && hasNoUnexpectedKeys(value.config, ["maxSentenceMs", "pauseBoundaryMs", "minSentenceMs", "preRollMs", "postRollMs"])
      && (value.config.maxSentenceMs === undefined || isSafeInteger(value.config.maxSentenceMs, 1_000, 30_000))
      && (value.config.pauseBoundaryMs === undefined || isSafeInteger(value.config.pauseBoundaryMs, 100, 3_000))
      && (value.config.minSentenceMs === undefined || isSafeInteger(value.config.minSentenceMs, 0, 5_000))
      && (value.config.preRollMs === undefined || isSafeInteger(value.config.preRollMs, 0, 180))
      && (value.config.postRollMs === undefined || isSafeInteger(value.config.postRollMs, 0, 250));
  }
  if (type === "media-sentence-qa-context" || type === "media-sentence-qa-save") {
    if (!hasNoUnexpectedKeys(value, ["projectId", "assetId", "sentenceCacheKey", "sentenceIndex", "contextBefore", "contextAfter", "markers"]) || !isUuid(value.projectId) || !isUuid(value.assetId) || !isSentenceCacheKey(value.sentenceCacheKey) || !isSafeInteger(value.sentenceIndex, 0, 1_999)) return false;
    if (value.contextBefore !== undefined && !isSafeInteger(value.contextBefore, 0, 3)) return false;
    if (value.contextAfter !== undefined && !isSafeInteger(value.contextAfter, 0, 3)) return false;
    if (type === "media-sentence-qa-context") return value.markers === undefined;
    return value.markers === undefined || Array.isArray(value.markers) && value.markers.length <= 500 && value.markers.every(isSentenceQaMarkerInput);
  }
  if (type === "media-sentence-index") return isSentenceIndexParams(value);
  if (type === "media-vad") {
    if (!hasNoUnexpectedKeys(value, ["projectId", "assetId", "timeoutMs", "config"]) || !isUuid(value.projectId) || !isUuid(value.assetId)) return false;
    if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
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
  return hasOnlyKeys(value, ["projectId", "limit"])
    && isUuid(value.projectId)
    && isSafeInteger(value.limit, 1, 1_000);
}

function isJobOperationPayload(type: AgentJobOperationType, value: unknown, result = false): boolean {
  if (!isPlainRecord(value) || !isJsonValue(value)) return false;
  if (result) {
    if (type === "job-list") return isJobPage(value);
    if (type === "job-events-list") return isJobEventPage(value);
    return isJobSummary(value);
  }
  if (type === "job-smoke-start") {
    return hasOnlyKeys(value, ["idempotencyKey", "steps", "delayMs", "failAttempts"])
      && isSafeString(value.idempotencyKey, 256)
      && (value.steps === undefined || isSafeInteger(value.steps, 3, 8))
      && (value.delayMs === undefined || isSafeInteger(value.delayMs, 1, 1_000))
      && (value.failAttempts === undefined || isSafeInteger(value.failAttempts, 0, 1));
  }
  if (type === "job-list") {
    return hasOnlyKeys(value, ["statuses", "cursor", "limit"])
      && (value.statuses === undefined || Array.isArray(value.statuses) && value.statuses.length <= 8 && value.statuses.every(isJobStatus))
      && (value.cursor === undefined || value.cursor === null || isSafeString(value.cursor, 512))
      && (value.limit === undefined || isSafeInteger(value.limit, 1, 100));
  }
  if (type === "job-events-list") {
    return hasOnlyKeys(value, ["jobId", "afterSequence", "cursor", "limit"])
      && isUuid(value.jobId) && (value.afterSequence === undefined || isSafeInteger(value.afterSequence, 0, Number.MAX_SAFE_INTEGER))
      && (value.cursor === undefined || value.cursor === null || isSafeString(value.cursor, 64))
      && (value.limit === undefined || isSafeInteger(value.limit, 1, 100));
  }
  return hasOnlyKeys(value, ["jobId"]) && isUuid(value.jobId);
}

function isJobStatus(value: unknown): boolean {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed"
    || value === "retrying" || value === "cancelling" || value === "cancelled" || value === "needs_attention";
}

function isJobOperationError(value: unknown): value is JobOperationError {
  return isPlainRecord(value) && hasOnlyKeys(value, ["code", "message"])
    && isJobOperationErrorCode(value.code) && typeof value.message === "string" && value.message.length > 0 && value.message.length <= 128;
}

const PROJECT_OPERATION_ERROR_CODES = new Set<string>([
  "DIALOG_CANCELLED",
  "INVALID_PROJECT_NAME",
  "INVALID_PROJECT_ROOT",
  "UNSUPPORTED_PROJECT_LOCATION",
  "PROJECT_DIRECTORY_NOT_EMPTY",
  "PROJECT_ALREADY_EXISTS",
  "PROJECT_NOT_FOUND",
  "PROJECT_MANIFEST_INVALID",
  "PROJECT_SCHEMA_TOO_NEW",
  "PROJECT_DATABASE_MISSING",
  "PROJECT_ID_MISMATCH",
  "PROJECT_PATH_CONFLICT",
  "PROJECT_NOT_ACTIVE",
  "ASSET_NOT_FOUND",
  "UNSUPPORTED_ASSET_TYPE",
  "TOO_MANY_ASSETS",
  "ASSET_CHANGED",
  "ASSET_CHANGED_DURING_REFERENCE",
  "FILE_ACCESS_DENIED",
  "OPERATION_TIMEOUT",
  "CORE_UNAVAILABLE",
  "DATABASE_OPEN_FAILED",
  "DATABASE_READ_ONLY",
  "DATABASE_BUSY",
  "DATABASE_CORRUPT",
  "MIGRATION_FAILED",
  "MIGRATION_CHECKSUM_MISMATCH",
  "SCHEMA_TOO_NEW",
  "CONSTRAINT_VIOLATION",
  "RECORD_NOT_FOUND",
  "INVALID_RECORD",
  "MEDIA_TOOL_UNAVAILABLE", "MEDIA_TOOL_TIMEOUT", "MEDIA_PROBE_PARSE_ERROR",
  "MEDIA_NOT_MEDIA", "MEDIA_OUTPUT_INVALID", "MEDIA_CANCELLED",
  "TRANSCRIPTION_TOOL_UNAVAILABLE", "TRANSCRIPTION_MODEL_UNAVAILABLE", "TRANSCRIPTION_OUTPUT_INVALID", "TRANSCRIPTION_TIMEOUT", "TRANSCRIPTION_CANCELLED",
  "VAD_TOOL_UNAVAILABLE", "VAD_OUTPUT_INVALID", "VAD_TIMEOUT", "VAD_CANCELLED",
  "SENTENCE_PREREQUISITE_UNAVAILABLE", "SENTENCE_PREREQUISITE_INVALID", "SENTENCE_OUTPUT_INVALID", "SENTENCE_TIMEOUT", "SENTENCE_CANCELLED",
  "SENTENCE_QA_RESULT_NOT_FOUND", "SENTENCE_QA_RESULT_INVALID", "SENTENCE_QA_INDEX_INVALID", "SENTENCE_QA_STORAGE_INVALID", "SENTENCE_QA_OUTPUT_INVALID",
  "SENTENCE_INDEX_SOURCE_NOT_FOUND", "SENTENCE_INDEX_SOURCE_INVALID", "SENTENCE_INDEX_SOURCE_STALE", "SENTENCE_INDEX_STORAGE_INVALID", "SENTENCE_INDEX_OUTPUT_INVALID", "SENTENCE_INDEX_TIMEOUT", "SENTENCE_INDEX_CANCELLED",
]);

const JOB_OPERATION_ERROR_CODES = new Set<string>([
  ...PROJECT_OPERATION_ERROR_CODES,
  "JOB_NOT_FOUND", "JOB_STATE_CONFLICT", "JOB_NOT_CANCELLABLE", "JOB_NOT_RETRYABLE", "JOB_RETRY_LIMIT",
  "JOB_QUEUE_FULL", "JOB_EXECUTOR_UNAVAILABLE", "JOB_CHECKPOINT_INVALID", "JOB_EVENT_GAP",
  "IDEMPOTENCY_CONFLICT", "JOB_SHUTTING_DOWN", "JOB_EXECUTION_FAILED",
]);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 32_767
    && !value.includes("\u0000")
    && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/"));
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key));
}

function isProjectOperationResultPayload(type: AgentProjectOperationType, value: Readonly<Record<string, unknown>>): boolean {
  if (type === "media-probe") return isMediaProbeResult(value);
  if (type === "media-proxy") return isMediaProxyResult(value);
  if (type === "media-transcribe") return isTranscriptionResult(value);
  if (type === "media-vad") return isVadResult(value);
  if (type === "media-sentences") return isSentenceResult(value);
  if (type === "media-sentence-index") return isSentenceIndexResult(value);
  if (type === "media-sentence-qa-context") return isSentenceQaContextResult(value);
  if (type === "media-sentence-qa-save") return isSentenceQaSaveResult(value);
  return true;
}

function hasNoUnexpectedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key));
}

function isSentenceQaMarkerInput(value: unknown): boolean {
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

function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isTimestamp(value: unknown): value is number {
  return isSafeInteger(value, 0, Number.MAX_SAFE_INTEGER);
}

function isSafeString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
