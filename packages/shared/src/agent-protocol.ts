/**
 * The protocol between Electron Main and the isolated Agent utility process.
 * Keep this contract independent from the Renderer IPC contract: the Main
 * process is the only component allowed to translate between the two.
 */
export const AGENT_WORKER_PROTOCOL_VERSION = 1 as const;
export const AGENT_WORKER_MAX_MESSAGE_BYTES = 64 * 1024;
export const AGENT_WORKER_VERSION = "0.1.0" as const;

export const AGENT_WORKER_CAPABILITIES = ["smoke-task", "cancel"] as const;

export const AGENT_WORKER_COMMAND_TYPES = {
  runSmokeTask: "run-smoke-task",
  cancelRun: "cancel-run",
  ping: "ping",
  shutdown: "shutdown",
} as const;

export const AGENT_WORKER_MESSAGE_TYPES = {
  ready: "ready",
  pong: "pong",
  runEvent: "run-event",
  runFinished: "run-finished",
  workerError: "worker-error",
} as const;

export type AgentWorkerCommandType = (typeof AGENT_WORKER_COMMAND_TYPES)[keyof typeof AGENT_WORKER_COMMAND_TYPES];
export type AgentWorkerMessageType = (typeof AGENT_WORKER_MESSAGE_TYPES)[keyof typeof AGENT_WORKER_MESSAGE_TYPES];

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
  | Readonly<{ protocolVersion: typeof AGENT_WORKER_PROTOCOL_VERSION; type: "shutdown" }>;

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
  | Readonly<{ kind: "worker-error"; timestamp: number; error: AgentPublicError }>;

export const DESKTOP_IPC_CONTRACT_VERSION = 2 as const;

export const DESKTOP_IPC_CHANNELS = {
  getEnvironment: "desktop:v2:get-environment",
  getAgentStatus: "desktop:v2:get-agent-status",
  runAgentSmokeTask: "desktop:v2:run-agent-smoke-task",
  cancelAgentRun: "desktop:v2:cancel-agent-run",
  agentEvent: "desktop:v2:agent-event",
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

export type DesktopPublicErrorCode = AgentPublicErrorCode;
export type DesktopPublicError = AgentPublicError;

export type DesktopIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: DesktopPublicError }>;

export type DesktopApi = Readonly<{
  getEnvironment: () => Promise<DesktopEnvironment>;
  getAgentStatus: () => Promise<AgentWorkerStatusSnapshot>;
  runSmokeTask: () => Promise<AgentRunHandle>;
  cancelSmokeRun: (runId: string) => Promise<void>;
  onAgentEvent: (listener: (event: DesktopAgentEvent) => void) => () => void;
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
};

export function createDesktopPublicError(code: DesktopPublicErrorCode): DesktopPublicError {
  return Object.freeze({ code, message: PUBLIC_ERROR_MESSAGES[code] });
}

export const createAgentPublicError = createDesktopPublicError;

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
