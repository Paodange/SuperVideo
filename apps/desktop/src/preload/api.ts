import {
  createDesktopPublicError,
  DESKTOP_IPC_CHANNELS,
  isDesktopPublicError,
  isAgentWorkerStatusSnapshot,
  isValidAgentRunId,
  isValidDesktopAgentEvent,
  type AgentRunHandle,
  type AgentWorkerStatusSnapshot,
  type DesktopAgentEvent,
  type DesktopApi,
  type DesktopEnvironment,
  type DesktopIpcResult,
  type GetEnvironmentRequest,
  type GetAgentStatusRequest,
  type RunAgentSmokeTaskRequest,
  type CancelAgentRunRequest,
} from "@supervideo/shared";

type Invoke = (
  channel:
    | typeof DESKTOP_IPC_CHANNELS.getEnvironment
    | typeof DESKTOP_IPC_CHANNELS.getAgentStatus
    | typeof DESKTOP_IPC_CHANNELS.runAgentSmokeTask
    | typeof DESKTOP_IPC_CHANNELS.cancelAgentRun,
  payload: GetEnvironmentRequest | GetAgentStatusRequest | RunAgentSmokeTaskRequest | CancelAgentRunRequest,
) => Promise<unknown>;

type Subscribe = (
  channel: typeof DESKTOP_IPC_CHANNELS.agentEvent,
  listener: (event: unknown, payload: unknown) => void,
) => () => void;

/**
 * This factory is the complete auditable Renderer surface. No channel,
 * MessagePort, sender, event object, or raw ipcRenderer method crosses it.
 */
export function createDesktopApi(invoke: Invoke, subscribe: Subscribe = () => () => {}): DesktopApi {
  const api: DesktopApi = {
    getEnvironment: () => invokeValue(DESKTOP_IPC_CHANNELS.getEnvironment, {}, invoke, isEnvironment),
    getAgentStatus: () => invokeValue(DESKTOP_IPC_CHANNELS.getAgentStatus, {}, invoke, isAgentWorkerStatusSnapshot),
    runSmokeTask: () => invokeValue(DESKTOP_IPC_CHANNELS.runAgentSmokeTask, {}, invoke, isAgentRunHandle),
    cancelSmokeRun: async (runId) => {
      if (!isValidAgentRunId(runId)) {
        throw createDesktopPublicError("invalid-run-id");
      }
      await invokeValue(
        DESKTOP_IPC_CHANNELS.cancelAgentRun,
        { runId },
        invoke,
        isAgentRunHandle,
      );
    },
    onAgentEvent: (listener) => {
      let disposed = false;
      const wrapped = (_event: unknown, payload: unknown): void => {
        if (!disposed && isValidDesktopAgentEvent(payload)) {
          listener(payload);
        }
      };
      const remove = subscribe(DESKTOP_IPC_CHANNELS.agentEvent, wrapped);
      return () => {
        if (!disposed) {
          disposed = true;
          remove();
        }
      };
    },
  };

  return Object.freeze(api);
}

async function invokeValue<T>(
  channel: Parameters<Invoke>[0],
  payload: Parameters<Invoke>[1],
  invoke: Invoke,
  isValue: (value: unknown) => value is T,
): Promise<T> {
  try {
    const response = await invoke(channel, payload);
    if (isSuccessfulResponse(response) && isValue(response.value)) {
      return response.value;
    }
    if (isFailedResponse(response)) {
      throw response.error;
    }
    throw createDesktopPublicError("internal-error");
  } catch (error) {
    throw isDesktopPublicError(error) ? error : createDesktopPublicError("internal-error");
  }
}

function isSuccessfulResponse(value: unknown): value is Extract<DesktopIpcResult<unknown>, { ok: true }> {
  return value !== null && typeof value === "object" && (value as { ok?: unknown }).ok === true && "value" in value;
}

function isFailedResponse(value: unknown): value is Extract<DesktopIpcResult<unknown>, { ok: false }> {
  return value !== null && typeof value === "object" && (value as { ok?: unknown }).ok === false && isDesktopPublicError((value as { error?: unknown }).error);
}

function isEnvironment(value: unknown): value is DesktopEnvironment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DesktopEnvironment>;
  return (
    (candidate.mode === "development" || candidate.mode === "production") &&
    typeof candidate.platform === "string" &&
    typeof candidate.electron === "string"
  );
}

function isAgentRunHandle(value: unknown): value is AgentRunHandle {
  return value !== null && typeof value === "object" && isValidAgentRunId((value as { runId?: unknown }).runId);
}

export type { AgentWorkerStatusSnapshot, DesktopAgentEvent };
