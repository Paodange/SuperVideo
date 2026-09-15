import {
  createDesktopPublicError,
  DESKTOP_IPC_CHANNELS,
  isDesktopIpcChannel,
  type DesktopEnvironment,
  type DesktopIpcResult,
  type GetEnvironmentRequest,
} from "@supervideo/shared";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { isTrustedRendererUrl, sanitizeUrlForDiagnostics, type RendererTrustPolicy } from "./policies";

export type SecurityLog = (event: string, details?: Readonly<Record<string, string | number | boolean>>) => void;

export type DesktopIpcDependencies = Readonly<{
  getEnvironment: () => DesktopEnvironment;
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
  const channel = DESKTOP_IPC_CHANNELS.getEnvironment;

  // Removing first makes hot reloads and isolated tests deterministic. There
  // is still exactly one handler for the versioned allowlisted channel.
  ipc.removeHandler(channel);
  ipc.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl || !isTrustedRendererUrl(senderUrl, dependencies.rendererTrustPolicy)) {
      dependencies.log("ipc-rejected", {
        channel,
        reason: "forbidden-sender",
        sender: senderUrl ? sanitizeUrlForDiagnostics(senderUrl) : "[missing-frame]",
      });
      return failure("forbidden-sender");
    }

    if (!isValidEmptyPayload(payload)) {
      dependencies.log("ipc-rejected", { channel, reason: "invalid-payload" });
      return failure("invalid-payload");
    }

    try {
      return success(dependencies.getEnvironment());
    } catch {
      // The public contract intentionally contains no exception, stack, path,
      // environment value, or Electron object from the Main process.
      dependencies.log("ipc-failed", { channel, reason: "internal-error" });
      return failure("internal-error");
    }
  });

  let disposed = false;
  return () => {
    if (!disposed) {
      disposed = true;
      ipc.removeHandler(channel);
    }
  };
}

export function isKnownDesktopIpcChannel(value: unknown): boolean {
  return isDesktopIpcChannel(value);
}

function success(value: DesktopEnvironment): DesktopIpcResult<DesktopEnvironment> {
  return Object.freeze({ ok: true, value });
}

function failure(code: "forbidden-sender" | "invalid-payload" | "internal-error"): DesktopIpcResult<never> {
  return Object.freeze({ ok: false, error: createDesktopPublicError(code) });
}
