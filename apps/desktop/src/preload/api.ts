import {
  createDesktopPublicError,
  DESKTOP_IPC_CHANNELS,
  isDesktopPublicError,
  type DesktopApi,
  type DesktopEnvironment,
  type DesktopIpcResult,
  type GetEnvironmentRequest,
} from "@supervideo/shared";

type Invoke = (channel: typeof DESKTOP_IPC_CHANNELS.getEnvironment, payload: GetEnvironmentRequest) => Promise<unknown>;

/**
 * Keeping this factory separate makes the exposed surface auditable and tests
 * it without loading an Electron process. The renderer never receives a
 * channel selector, sender, event emitter, or raw ipcRenderer object.
 */
export function createDesktopApi(invoke: Invoke): DesktopApi {
  const api: DesktopApi = {
    getEnvironment: async (): Promise<DesktopEnvironment> => {
      try {
        const response = await invoke(DESKTOP_IPC_CHANNELS.getEnvironment, {});
        if (isSuccessfulEnvironmentResponse(response)) {
          return response.value;
        }

        if (isFailedEnvironmentResponse(response)) {
          throw response.error;
        }

        throw createDesktopPublicError("internal-error");
      } catch (error) {
        throw isDesktopPublicError(error) ? error : createDesktopPublicError("internal-error");
      }
    },
  };

  return Object.freeze(api);
}

function isSuccessfulEnvironmentResponse(value: unknown): value is Extract<DesktopIpcResult<DesktopEnvironment>, { ok: true }> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === true &&
    isEnvironment((value as { value?: unknown }).value)
  );
}

function isFailedEnvironmentResponse(value: unknown): value is Extract<DesktopIpcResult<DesktopEnvironment>, { ok: false }> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === false &&
    isDesktopPublicError((value as { error?: unknown }).error)
  );
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
