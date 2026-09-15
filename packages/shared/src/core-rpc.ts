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
} as const;

export type CoreRpcMethod = (typeof CORE_RPC_METHODS)[keyof typeof CORE_RPC_METHODS];
export type CoreRpcCallableMethod = typeof CORE_RPC_METHODS.health | typeof CORE_RPC_METHODS.smokeCountdown;

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

export type CoreRpcMessage = CoreRpcRequest | CoreRpcResponse | CoreProgressNotification | CoreCancelNotification;
export type CoreRpcServerMessage = CoreRpcResponse | CoreProgressNotification;

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
    || isCoreCancelNotification(value);
}

export function isCoreRpcServerMessage(value: unknown): value is CoreRpcServerMessage {
  return isCoreRpcResponse(value) || isCoreProgressNotification(value);
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
    && value.capabilities.length <= 16
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
