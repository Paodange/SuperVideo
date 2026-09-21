/**
 * Versioned contracts for A08 observability, diagnostics and credentials.
 *
 * Secrets deliberately appear only in the save request type. No response or
 * persisted model in this module contains a secret or ciphertext.
 */

export const CREDENTIAL_STORE_SCHEMA_VERSION = 1 as const;
export const DIAGNOSTICS_VERSION = 1 as const;
export const LOG_SCHEMA_VERSION = 1 as const;
export const LOG_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const LOG_MAX_FILES = 3;
export const LOG_MAX_DETAILS = 24;
export const LOG_MAX_DETAIL_KEY_LENGTH = 64;
export const LOG_MAX_DETAIL_STRING_LENGTH = 512;
export const DIAGNOSTICS_MAX_LOG_EVENTS = 200;
export const DIAGNOSTICS_MAX_LOG_BYTES = 256 * 1024;
export const DIAGNOSTICS_MAX_FILE_BYTES = 512 * 1024;
export const CREDENTIAL_MAX_SECRET_BYTES = 8 * 1024;
export const CREDENTIAL_MAX_ITEMS = 100;
export const CREDENTIAL_MAX_CIPHERTEXT_BYTES = 64 * 1024;

export const CREDENTIAL_SERVICE_KINDS = ["llm", "tts", "image", "video"] as const;
export type CredentialServiceKind = (typeof CREDENTIAL_SERVICE_KINDS)[number];

export type CredentialMetadata = Readonly<{
  credentialRef: string;
  serviceKind: CredentialServiceKind;
  providerId: string;
  displayName: string;
  configured: true;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type CredentialStorageStatus = Readonly<{
  available: boolean;
  state: "available" | "unavailable" | "corrupt";
}>;

export type CredentialSaveRequest = Readonly<{
  serviceKind: CredentialServiceKind;
  providerId: string;
  displayName: string;
  secret: string;
}>;

export type CredentialReplaceRequest = Readonly<{ credentialRef: string; secret: string }>;
export type CredentialRemoveRequest = Readonly<{ credentialRef: string }>;
export type CredentialRemoveResult = Readonly<{ removed: boolean }>;

export type CredentialListResult = Readonly<{ items: readonly CredentialMetadata[] }>;

export type DiagnosticExportResult = Readonly<{ status: "saved" | "cancelled" }>;

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogComponent = "electron-main" | "agent-worker" | "python-core";
export type LogDetailValue = string | number | boolean | null;

// This is an allowlist, rather than a free-form event channel. Add a name
// here when a lifecycle event becomes part of the observable product contract.
export const LOG_EVENT_NAMES = [
  "app-started",
  "app-ready",
  "app-shutdown",
  "dev-server-rejected",
  "navigation-rejected",
  "window-open-rejected",
  "renderer-load-failed",
  "download-rejected",
  "permission-rejected",
  "ipc-rejected",
  "ipc-failed",
  "agent-event-rejected",
  "agent-start-failed",
  "agent-worker-spawn",
  "agent-worker-process-spawned",
  "agent-worker-ready",
  "agent-worker-ready-timeout",
  "agent-worker-error",
  "agent-worker-exit",
  "agent-worker-spawn-failed",
  "agent-worker-restart-scheduled",
  "agent-worker-unavailable",
  "agent-worker-shutdown-timeout",
  "agent-worker-run-interrupted",
  "agent-worker-message-rejected",
  "agent-run-started",
  "agent-run-event",
  "agent-run-terminal",
  "project-dialog-finished",
  "project-operation-started",
  "project-operation-finished",
  "job-operation-started",
  "job-operation-finished",
  "job-event",
  "credential-status",
  "credential-saved",
  "credential-replaced",
  "credential-removed",
  "diagnostic-export-started",
  "diagnostic-export-finished",
  "diagnostic-export-failed",
  "core-started",
  "core-ready",
  "core-request-started",
  "core-request-finished",
  "core-request-failed",
  "core-exit",
  "core-stderr-rejected",
  "diagnostic-event-rejected",
  "log-write-failed",
  "log-rotated",
] as const;
export type LogEventName = (typeof LOG_EVENT_NAMES)[number];

export type LogEvent = Readonly<{
  schemaVersion: typeof LOG_SCHEMA_VERSION;
  timestamp: string;
  level: LogLevel;
  component: LogComponent;
  event: LogEventName;
  sessionId: string;
  correlationId?: string;
  operationId?: string;
  runId?: string;
  requestId?: string;
  projectId?: string;
  jobId?: string;
  errorCode?: string;
  details?: Readonly<Record<string, LogDetailValue>>;
}>;

export type AgentDiagnosticEvent = Readonly<{
  schemaVersion: typeof LOG_SCHEMA_VERSION;
  timestamp: string;
  level: LogLevel;
  component: Exclude<LogComponent, "electron-main">;
  event: LogEventName;
  operationId?: string;
  runId?: string;
  requestId?: string;
  projectId?: string;
  jobId?: string;
  errorCode?: string;
  details?: Readonly<Record<string, LogDetailValue>>;
}>;

export type DiagnosticDocument = Readonly<{
  diagnosticsVersion: typeof DIAGNOSTICS_VERSION;
  generatedAt: string;
  application: Readonly<{ version: string; electronVersion: string; nodeVersion: string; pythonCoreVersion: string }>;
  platform: Readonly<{ platform: string; release: string; architecture: string }>;
  worker: Readonly<{
    status: string;
    protocolVersion: number;
    generation: number;
    workerVersion: string | null;
    capabilityCount: number;
    restartCount: number;
    lastErrorCode: string | null;
  }>;
  core: Readonly<{ status: string; protocolVersion: number; coreVersion: string | null; capabilityCount: number }>;
  safeStorage: CredentialStorageStatus;
  credentials: Readonly<{ configuredByServiceKind: Readonly<Record<CredentialServiceKind, number>> }>;
  project: Readonly<{ open: boolean; manifestSchemaVersion: number | null; databaseSchemaVersion: number | null }>;
  jobs: Readonly<{
    countsByStatus: Readonly<Record<string, number>>;
    recentErrors: readonly Readonly<{ errorCode: string; timestamp: number }>[];
  }>;
  logging: Readonly<{
    schemaVersion: typeof LOG_SCHEMA_VERSION;
    maxFileBytes: number;
    maxFiles: number;
    rotationCount: number;
    droppedCount: number;
    redactedCount: number;
    writeErrorCount: number;
  }>;
  recentLogs: readonly LogEvent[];
  truncated: boolean;
}>;

export const PUBLIC_A08_ERROR_CODES = [
  "CREDENTIAL_STORAGE_UNAVAILABLE",
  "CREDENTIAL_STORE_CORRUPT",
  "CREDENTIAL_NOT_FOUND",
  "INVALID_CREDENTIAL_INPUT",
  "CREDENTIAL_WRITE_FAILED",
  "DIAGNOSTIC_EXPORT_CANCELLED",
  "DIAGNOSTIC_EXPORT_FAILED",
] as const;
export type A08PublicErrorCode = (typeof PUBLIC_A08_ERROR_CODES)[number];

export function isCredentialServiceKind(value: unknown): value is CredentialServiceKind {
  return typeof value === "string" && (CREDENTIAL_SERVICE_KINDS as readonly string[]).includes(value);
}

export function isCredentialStorageStatus(value: unknown): value is CredentialStorageStatus {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["available", "state"])) return false;
  return typeof value.available === "boolean"
    && (value.state === "available" || value.state === "unavailable" || value.state === "corrupt")
    && (value.state === "available" ? value.available : value.state === "corrupt" ? value.available : !value.available);
}

export function isCredentialMetadata(value: unknown): value is CredentialMetadata {
  return isPlainRecord(value)
    && hasExactKeys(value, ["credentialRef", "serviceKind", "providerId", "displayName", "configured", "createdAtMs", "updatedAtMs"])
    && isCredentialRef(value.credentialRef)
    && isCredentialServiceKind(value.serviceKind)
    && isProviderId(value.providerId)
    && isNormalizedDisplayName(value.displayName)
    && value.configured === true
    && isTimestamp(value.createdAtMs)
    && isTimestamp(value.updatedAtMs);
}

export function isCredentialListResult(value: unknown): value is CredentialListResult {
  return isPlainRecord(value) && hasExactKeys(value, ["items"])
    && Array.isArray(value.items) && value.items.length <= CREDENTIAL_MAX_ITEMS
    && value.items.every(isCredentialMetadata);
}

export function isCredentialSaveRequest(value: unknown): value is CredentialSaveRequest {
  return isPlainRecord(value)
    && hasExactKeys(value, ["serviceKind", "providerId", "displayName", "secret"])
    && isCredentialServiceKind(value.serviceKind)
    && isProviderId(value.providerId)
    && isDisplayNameInput(value.displayName)
    && isSecret(value.secret);
}

export function isCredentialReplaceRequest(value: unknown): value is CredentialReplaceRequest {
  return isPlainRecord(value) && hasExactKeys(value, ["credentialRef", "secret"])
    && isCredentialRef(value.credentialRef) && isSecret(value.secret);
}

export function isCredentialRemoveRequest(value: unknown): value is CredentialRemoveRequest {
  return isPlainRecord(value) && hasExactKeys(value, ["credentialRef"]) && isCredentialRef(value.credentialRef);
}

export function isCredentialRemoveResult(value: unknown): value is CredentialRemoveResult {
  return isPlainRecord(value) && hasExactKeys(value, ["removed"]) && typeof value.removed === "boolean";
}

export function isDiagnosticExportResult(value: unknown): value is DiagnosticExportResult {
  return isPlainRecord(value) && hasExactKeys(value, ["status"])
    && (value.status === "saved" || value.status === "cancelled");
}

export function isAgentDiagnosticEvent(value: unknown): value is AgentDiagnosticEvent {
  if (!isPlainRecord(value) || !isJsonValue(value)) return false;
  const allowed = ["schemaVersion", "timestamp", "level", "component", "event", "operationId", "runId", "requestId", "projectId", "jobId", "errorCode", "details"];
  if (!Object.keys(value).every((key) => allowed.includes(key))) return false;
  if (value.schemaVersion !== LOG_SCHEMA_VERSION || !isIsoTimestamp(value.timestamp)) return false;
  if (value.level !== "debug" && value.level !== "info" && value.level !== "warn" && value.level !== "error") return false;
  if (value.component !== "agent-worker" && value.component !== "python-core") return false;
  if (!isLogEventName(value.event)) return false;
  for (const key of ["operationId", "runId", "requestId", "projectId", "jobId", "errorCode"]) {
    if (value[key] !== undefined && !isSafeString(value[key], 256)) return false;
  }
  return value.details === undefined || isLogDetails(value.details);
}

export function isLogEventName(value: unknown): value is LogEventName {
  return typeof value === "string" && (LOG_EVENT_NAMES as readonly string[]).includes(value);
}

export function isLogEvent(value: unknown): value is LogEvent {
  if (!isPlainRecord(value) || !isJsonValue(value)) return false;
  const allowed = ["schemaVersion", "timestamp", "level", "component", "event", "sessionId", "correlationId", "operationId", "runId", "requestId", "projectId", "jobId", "errorCode", "details"];
  if (!Object.keys(value).every((key) => allowed.includes(key))) return false;
  if (value.schemaVersion !== LOG_SCHEMA_VERSION || !isIsoTimestamp(value.timestamp)) return false;
  if (value.level !== "debug" && value.level !== "info" && value.level !== "warn" && value.level !== "error") return false;
  if (value.component !== "electron-main" && value.component !== "agent-worker" && value.component !== "python-core") return false;
  if (!isLogEventName(value.event) || !isSafeString(value.sessionId, 128)) return false;
  for (const key of ["correlationId", "operationId", "runId", "requestId", "projectId", "jobId", "errorCode"]) {
    if (value[key] !== undefined && !isSafeString(value[key], 256)) return false;
  }
  return value.details === undefined || isLogDetails(value.details);
}

export function isDiagnosticDocument(value: unknown): value is DiagnosticDocument {
  if (!isPlainRecord(value) || !isJsonValue(value)) return false;
  if (!hasExactKeys(value, ["diagnosticsVersion", "generatedAt", "application", "platform", "worker", "core", "safeStorage", "credentials", "project", "jobs", "logging", "recentLogs", "truncated"])) return false;
  const application = value.application;
  const platform = value.platform;
  const worker = value.worker;
  const core = value.core;
  const credentials = value.credentials;
  const project = value.project;
  const jobs = value.jobs;
  const logging = value.logging;
  if (!isPlainRecord(application) || !hasExactKeys(application, ["version", "electronVersion", "nodeVersion", "pythonCoreVersion"]) || ![application.version, application.electronVersion, application.nodeVersion, application.pythonCoreVersion].every((item) => isSafeString(item, 64))) return false;
  if (!isPlainRecord(platform) || !hasExactKeys(platform, ["platform", "release", "architecture"]) || ![platform.platform, platform.release, platform.architecture].every((item) => isSafeString(item, 64))) return false;
  if (!isPlainRecord(worker) || !hasExactKeys(worker, ["status", "protocolVersion", "generation", "workerVersion", "capabilityCount", "restartCount", "lastErrorCode"]) || !isSafeString(worker.status, 32) || !isSafeInteger(worker.protocolVersion, 1, 1) || !isSafeInteger(worker.generation, 0, Number.MAX_SAFE_INTEGER) || !(worker.workerVersion === null || isSafeString(worker.workerVersion, 32)) || !isSafeInteger(worker.capabilityCount, 0, 16) || !isSafeInteger(worker.restartCount, 0, Number.MAX_SAFE_INTEGER) || !(worker.lastErrorCode === null || isSafeString(worker.lastErrorCode, 128))) return false;
  if (!isPlainRecord(core) || !hasExactKeys(core, ["status", "protocolVersion", "coreVersion", "capabilityCount"]) || !isSafeString(core.status, 32) || !isSafeInteger(core.protocolVersion, 1, 1) || !(core.coreVersion === null || isSafeString(core.coreVersion, 32)) || !isSafeInteger(core.capabilityCount, 0, 32)) return false;
  if (!isPlainRecord(credentials) || !hasExactKeys(credentials, ["configuredByServiceKind"]) || !isPlainRecord(credentials.configuredByServiceKind) || !hasExactKeys(credentials.configuredByServiceKind, CREDENTIAL_SERVICE_KINDS) || !CREDENTIAL_SERVICE_KINDS.every((kind) => isSafeInteger(credentials.configuredByServiceKind[kind], 0, CREDENTIAL_MAX_ITEMS))) return false;
  if (!isPlainRecord(project) || !hasExactKeys(project, ["open", "manifestSchemaVersion", "databaseSchemaVersion"]) || typeof project.open !== "boolean" || !(project.manifestSchemaVersion === null || isSafeInteger(project.manifestSchemaVersion, 1, Number.MAX_SAFE_INTEGER)) || !(project.databaseSchemaVersion === null || isSafeInteger(project.databaseSchemaVersion, 1, Number.MAX_SAFE_INTEGER))) return false;
  if (!isPlainRecord(jobs) || !hasExactKeys(jobs, ["countsByStatus", "recentErrors"]) || !isPlainRecord(jobs.countsByStatus) || Object.keys(jobs.countsByStatus).length > 8 || !Object.values(jobs.countsByStatus).every((item) => isSafeInteger(item, 0, Number.MAX_SAFE_INTEGER)) || !Array.isArray(jobs.recentErrors) || jobs.recentErrors.length > 10 || !jobs.recentErrors.every(isDiagnosticErrorSummary)) return false;
  if (!isPlainRecord(logging) || !hasExactKeys(logging, ["schemaVersion", "maxFileBytes", "maxFiles", "rotationCount", "droppedCount", "redactedCount", "writeErrorCount"]) || logging.schemaVersion !== LOG_SCHEMA_VERSION || !isSafeInteger(logging.maxFileBytes, 1, 100 * 1024 * 1024) || !isSafeInteger(logging.maxFiles, 1, 16) || !isSafeInteger(logging.rotationCount, 0, Number.MAX_SAFE_INTEGER) || !isSafeInteger(logging.droppedCount, 0, Number.MAX_SAFE_INTEGER) || !isSafeInteger(logging.redactedCount, 0, Number.MAX_SAFE_INTEGER) || !isSafeInteger(logging.writeErrorCount, 0, Number.MAX_SAFE_INTEGER)) return false;
  return value.diagnosticsVersion === DIAGNOSTICS_VERSION
    && isIsoTimestamp(value.generatedAt)
    && isCredentialStorageStatus(value.safeStorage)
    && Array.isArray(value.recentLogs)
    && value.recentLogs.length <= DIAGNOSTICS_MAX_LOG_EVENTS
    && value.recentLogs.every(isLogEvent)
    && typeof value.truncated === "boolean";
}

function isDiagnosticErrorSummary(value: unknown): value is Readonly<{ errorCode: string; timestamp: number }> {
  return isPlainRecord(value) && hasExactKeys(value, ["errorCode", "timestamp"]) && isSafeString(value.errorCode, 128) && isTimestamp(value.timestamp);
}

export function credentialUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isSecret(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\u0000") && credentialUtf8ByteLength(value) <= CREDENTIAL_MAX_SECRET_BYTES;
}

function isCredentialRef(value: unknown): value is string {
  return typeof value === "string" && /^cred-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function isProviderId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9._-]{1,64}$/.test(value);
}

function isDisplayNameInput(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isNormalizedDisplayName(value: unknown): value is string {
  return isDisplayNameInput(value) && value === value.trim();
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isSafeString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value)) && value.endsWith("Z");
}

function isLogDetails(value: unknown): value is Readonly<Record<string, LogDetailValue>> {
  if (!isPlainRecord(value) || Object.keys(value).length > LOG_MAX_DETAILS) return false;
  return Object.entries(value).every(([key, item]) => key.length <= LOG_MAX_DETAIL_KEY_LENGTH && (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item) || typeof item === "string" && item.length <= LOG_MAX_DETAIL_STRING_LENGTH));
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 256 && value.every((item) => isJsonValue(item, depth + 1));
  return isPlainRecord(value) && Object.entries(value).length <= 128 && Object.entries(value).every(([key, item]) => key.length <= 128 && isJsonValue(item, depth + 1));
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
