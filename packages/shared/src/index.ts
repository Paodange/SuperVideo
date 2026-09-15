export type HealthStatus = {
  service: string;
  status: "ok" | "error";
};

export const DESKTOP_IPC_CONTRACT_VERSION = 1 as const;

export const DESKTOP_IPC_CHANNELS = {
  getEnvironment: "desktop:v1:get-environment",
} as const;

export type DesktopIpcChannel = (typeof DESKTOP_IPC_CHANNELS)[keyof typeof DESKTOP_IPC_CHANNELS];

export type DesktopEnvironment = {
  mode: "development" | "production";
  platform: string;
  electron: string;
};

export type GetEnvironmentRequest = Record<string, never>;

export type DesktopPublicErrorCode = "forbidden-sender" | "invalid-payload" | "internal-error";

export type DesktopPublicError = Readonly<{
  code: DesktopPublicErrorCode;
  message: string;
}>;

export type DesktopIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: DesktopPublicError }>;

export type DesktopApi = Readonly<{
  getEnvironment: () => Promise<DesktopEnvironment>;
}>;

const PUBLIC_ERROR_MESSAGES: Readonly<Record<DesktopPublicErrorCode, string>> = {
  "forbidden-sender": "The desktop request was rejected.",
  "invalid-payload": "The desktop request payload is invalid.",
  "internal-error": "The desktop request could not be completed.",
};

export function createDesktopPublicError(code: DesktopPublicErrorCode): DesktopPublicError {
  return Object.freeze({ code, message: PUBLIC_ERROR_MESSAGES[code] });
}

export function isDesktopPublicError(value: unknown): value is DesktopPublicError {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DesktopPublicError>;
  return (
    (candidate.code === "forbidden-sender" ||
      candidate.code === "invalid-payload" ||
      candidate.code === "internal-error") &&
    candidate.message === PUBLIC_ERROR_MESSAGES[candidate.code]
  );
}

export function isDesktopIpcChannel(value: unknown): value is DesktopIpcChannel {
  return value === DESKTOP_IPC_CHANNELS.getEnvironment;
}
