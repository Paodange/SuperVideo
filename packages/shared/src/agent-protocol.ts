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
} from "./core-rpc";
import { isJobEvent, isJobEventPage, isJobPage, isJobSummary } from "./core-rpc";

/**
 * The protocol between Electron Main and the isolated Agent utility process.
 * Keep this contract independent from the Renderer IPC contract: the Main
 * process is the only component allowed to translate between the two.
 */
export const AGENT_WORKER_PROTOCOL_VERSION = 1 as const;
export const AGENT_WORKER_MAX_MESSAGE_BYTES = 64 * 1024;
export const AGENT_WORKER_VERSION = "0.1.0" as const;

export const AGENT_WORKER_CAPABILITIES = ["smoke-task", "cancel", "project", "jobs"] as const;

export const AGENT_WORKER_COMMAND_TYPES = {
  runSmokeTask: "run-smoke-task",
  cancelRun: "cancel-run",
  ping: "ping",
  shutdown: "shutdown",
  projectCreate: "project-create",
  projectOpen: "project-open",
  projectInspect: "project-inspect",
  assetReference: "asset-reference",
  assetList: "asset-list",
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
} as const;

export type AgentWorkerCommandType = (typeof AGENT_WORKER_COMMAND_TYPES)[keyof typeof AGENT_WORKER_COMMAND_TYPES];
export type AgentWorkerMessageType = (typeof AGENT_WORKER_MESSAGE_TYPES)[keyof typeof AGENT_WORKER_MESSAGE_TYPES];
export type AgentProjectOperationType =
  | "project-create"
  | "project-open"
  | "project-inspect"
  | "asset-reference"
  | "asset-list";
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
  | "INVALID_RECORD";

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
  startSmokeJob: "desktop:v2:start-smoke-job",
  getJob: "desktop:v2:get-job",
  listJobs: "desktop:v2:list-jobs",
  listJobEvents: "desktop:v2:list-job-events",
  cancelJob: "desktop:v2:cancel-job",
  retryJob: "desktop:v2:retry-job",
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
export type ProjectDialogResult<T> = Readonly<{ cancelled: true }> | Readonly<{ cancelled: false; value: T }>;

export type DesktopPublicErrorCode = AgentPublicErrorCode | JobOperationErrorCode;
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
  startSmokeJob: (input: JobSmokeStartParams) => Promise<JobSummary>;
  getJob: (input: JobReferenceParams) => Promise<JobSummary>;
  listJobs: (input: JobListParams) => Promise<JobPage>;
  listJobEvents: (input: JobEventsListParams) => Promise<JobEventPage>;
  cancelJob: (input: JobReferenceParams) => Promise<JobSummary>;
  retryJob: (input: JobReferenceParams) => Promise<JobSummary>;
  onJobEvent: (listener: (event: JobEvent) => void) => () => void;
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
  return isAgentPublicErrorCode(candidate.code) && candidate.message === PUBLIC_ERROR_MESSAGES[candidate.code];
}

export function isAgentPublicErrorCode(value: unknown): value is AgentPublicErrorCode {
  return typeof value === "string" && value in PUBLIC_ERROR_MESSAGES;
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
      && isJsonValue(value.payload);
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
  return isDesktopPublicError(value);
}

function isAgentProjectOperationType(value: unknown): value is AgentProjectOperationType {
  return value === "project-create"
    || value === "project-open"
    || value === "project-inspect"
    || value === "asset-reference"
    || value === "asset-list";
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

function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isTimestamp(value: unknown): value is number {
  return isSafeInteger(value, 0, Number.MAX_SAFE_INTEGER);
}

function isSafeString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}
