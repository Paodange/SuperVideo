import {
  createDesktopPublicError,
  DESKTOP_IPC_CHANNELS,
  isDesktopIpcChannel,
  isAgentPublicErrorCode,
  isValidAgentRunId,
  type AgentRunHandle,
  type AgentWorkerMessage,
  type AgentWorkerStatusSnapshot,
  type DesktopAgentEvent,
  type DesktopEnvironment,
  type DesktopIpcResult,
  type GetEnvironmentRequest,
  type GetAgentStatusRequest,
  type RunAgentSmokeTaskRequest,
  type CancelAgentRunRequest,
} from "@supervideo/shared";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { isTrustedRendererUrl, sanitizeUrlForDiagnostics, type RendererTrustPolicy } from "./policies";

export type SecurityLog = (event: string, details?: Readonly<Record<string, string | number | boolean>>) => void;

export type DesktopIpcDependencies = Readonly<{
  getEnvironment: () => DesktopEnvironment;
  getAgentStatus: () => AgentWorkerStatusSnapshot;
  runSmokeTask: () => AgentRunHandle;
  cancelSmokeRun: (runId: string) => void;
  rendererTrustPolicy: RendererTrustPolicy;
  log: SecurityLog;
}>;

export function isValidEmptyPayload(value: unknown): value is GetEnvironmentRequest {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 0
  );
}

export function registerDesktopIpcHandlers(
  ipc: Pick<IpcMain, "handle" | "removeHandler">,
  dependencies: DesktopIpcDependencies,
): () => void {
  const disposers = [
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.getEnvironment, isValidEmptyPayload, dependencies, () => dependencies.getEnvironment()),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.getAgentStatus, isValidEmptyPayload, dependencies, () => dependencies.getAgentStatus()),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.runAgentSmokeTask, isValidEmptyPayload, dependencies, () => dependencies.runSmokeTask()),
    registerInvokeHandler(
      ipc,
      DESKTOP_IPC_CHANNELS.cancelAgentRun,
      isValidCancelAgentRunPayload,
      dependencies,
      (payload) => {
        dependencies.cancelSmokeRun(payload.runId);
        return { runId: payload.runId } satisfies AgentRunHandle;
      },
    ),
  ];

  let disposed = false;
  return () => {
    if (!disposed) {
      disposed = true;
      for (const dispose of disposers) {
        dispose();
      }
    }
  };
}

export function isKnownDesktopIpcChannel(value: unknown): boolean {
  return isDesktopIpcChannel(value);
}

function failure<T>(code: Parameters<typeof createDesktopPublicError>[0]): DesktopIpcResult<T> {
  return Object.freeze({ ok: false, error: createDesktopPublicError(code) });
}

function registerInvokeHandler<TPayload, TValue>(
  ipc: Pick<IpcMain, "handle" | "removeHandler">,
  channel: string,
  validatePayload: (value: unknown) => value is TPayload,
  dependencies: DesktopIpcDependencies,
  action: (payload: TPayload) => TValue,
): () => void {
  ipc.removeHandler(channel);
  ipc.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl || !isTrustedRendererUrl(senderUrl, dependencies.rendererTrustPolicy)) {
      dependencies.log("ipc-rejected", {
        channel,
        reason: "forbidden-sender",
        sender: senderUrl ? sanitizeUrlForDiagnostics(senderUrl) : "[missing-frame]",
      });
      return failure<TValue>("forbidden-sender");
    }

    if (!validatePayload(payload)) {
      dependencies.log("ipc-rejected", { channel, reason: "invalid-payload" });
      return failure<TValue>("invalid-payload");
    }

    try {
      return Object.freeze({ ok: true, value: action(payload) }) as DesktopIpcResult<TValue>;
    } catch (error) {
      const code = publicErrorCode(error);
      dependencies.log("ipc-failed", { channel, reason: code });
      return failure<TValue>(code);
    }
  });

  return () => ipc.removeHandler(channel);
}

export function isValidCancelAgentRunPayload(value: unknown): value is CancelAgentRunRequest {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 1 &&
    isValidAgentRunId((value as { runId?: unknown }).runId)
  );
}

export function toDesktopAgentEvent(message: AgentWorkerMessage): DesktopAgentEvent | undefined {
  if (message.type === "run-event") {
    return Object.freeze({
      kind: "run-event",
      timestamp: message.timestamp,
      runId: message.runId,
      sequence: message.sequence,
      event: message.event,
    });
  }
  if (message.type === "run-finished") {
    return Object.freeze({
      kind: "run-finished",
      timestamp: message.timestamp,
      runId: message.runId,
      sequence: message.sequence,
      status: message.status,
      ...(message.error ? { error: message.error } : {}),
    });
  }
  if (message.type === "worker-error") {
    return Object.freeze({ kind: "worker-error", timestamp: message.timestamp, error: message.error });
  }
  return undefined;
}

export function createDesktopAgentStatusEvent(status: AgentWorkerStatusSnapshot, timestamp = Date.now()): DesktopAgentEvent {
  return Object.freeze({ kind: "worker-status", timestamp, status });
}

function publicErrorCode(error: unknown): Parameters<typeof createDesktopPublicError>[0] {
  if (error && typeof error === "object" && isAgentPublicErrorCode((error as { code?: unknown }).code)) {
    return (error as { code: Parameters<typeof createDesktopPublicError>[0] }).code;
  }
  return "internal-error";
}
