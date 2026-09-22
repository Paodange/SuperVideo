/** D01 bounded, versioned provider contract. No secret or ciphertext is represented. */
export const PROVIDER_CONTRACT_VERSION = 1 as const;
export const PROVIDER_CONFIG_SCHEMA_VERSION = 1 as const;
export const PROVIDER_MAX_CONFIGS_PER_PROJECT = 32;
export const PROVIDER_SERVICE_KINDS = ["llm", "tts", "image", "video"] as const;
export type ProviderServiceKind = (typeof PROVIDER_SERVICE_KINDS)[number];
export const PROVIDER_CAPABILITIES = ["chat.generate", "chat.stream", "speech.synthesize", "image.generate", "video.generate"] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];
export type ProviderHealthErrorCode = "UNKNOWN_PROVIDER" | "CONFIG_INVALID" | "MISSING_CREDENTIAL" | "CREDENTIAL_UNAVAILABLE" | "AUTH_FAILED" | "NETWORK_ERROR" | "TIMEOUT" | "INVALID_RESPONSE" | "UNSUPPORTED_CAPABILITY" | "INTERNAL";
export const PROVIDER_PUBLIC_ERROR_CODES = ["PROVIDER_INVALID_CONFIG", "PROVIDER_UNKNOWN", "PROVIDER_CONFIG_NOT_FOUND", "PROVIDER_CONFIG_CORRUPT", "PROVIDER_CONFIG_WRITE_FAILED", "PROVIDER_PROJECT_MISMATCH", "PROVIDER_CREDENTIAL_NOT_FOUND", "PROVIDER_CREDENTIAL_KIND_MISMATCH", "PROVIDER_HEALTH_TIMEOUT", "PROVIDER_AUTH_FAILED", "PROVIDER_UNAVAILABLE", "PROVIDER_ADAPTER_FAILED", "PROVIDER_REGISTRY_CONFLICT"] as const;
export type ProviderPublicErrorCode = (typeof PROVIDER_PUBLIC_ERROR_CODES)[number];
export type ProviderConfig = Readonly<{ schemaVersion: 1; protocolVersion: 1; projectId: string; serviceKind: ProviderServiceKind; providerId: string; displayName: string; model: string; endpoint: string | null; credentialRef: string | null; capabilities: readonly ProviderCapability[]; enabled: boolean; createdAtMs: number; updatedAtMs: number }>;
export type ProviderConfigInput = Readonly<{ projectId: string; serviceKind: ProviderServiceKind; providerId: string; displayName: string; model: string; endpoint?: string | null; credentialRef?: string | null; capabilities?: readonly ProviderCapability[]; enabled?: boolean }>;
/** Main-only adapter input. It is never serialized into a Renderer/Core job. */
export type ProviderTtsSynthesisRequest = Readonly<{
  projectId: string;
  model: string;
  voice: string;
  sentences: readonly Readonly<{ sentenceId: string; text: string; provenanceIds: readonly string[] }>[];
}>;
/** Main-only adapter output. A real provider adapter may replace the offline Core adapter later. */
export type ProviderTtsSynthesisResult = Readonly<{
  audioBytes: Uint8Array;
  durationMs: number;
}>;
export type ProviderConfigDeleteRequest = Readonly<{ projectId: string; serviceKind: ProviderServiceKind; providerId: string }>;
export type ProviderConfigListRequest = Readonly<{ projectId: string }>;
export type ProviderConfigListResult = Readonly<{ projectId: string; items: readonly ProviderConfig[] }>;
export interface ProviderAdapter {
  readonly descriptor: Readonly<{ providerId: string; serviceKind: ProviderServiceKind; capabilities: ProviderConfig["capabilities"] }>;
  health(secret: string, config: ProviderConfig, timeoutMs: number): Promise<ProviderHealthErrorCode | null>;
  /** Optional future real-TTS seam. `secret` is available only in this Main-owned callback. */
  synthesizeTts?: (secret: string, request: ProviderTtsSynthesisRequest, timeoutMs: number) => Promise<ProviderTtsSynthesisResult>;
}
export interface ProviderRegistry {
  register(adapter: ProviderAdapter): void;
  get(providerId: string, serviceKind: ProviderServiceKind): ProviderAdapter | undefined;
  list(): readonly ProviderAdapter["descriptor"][];
}
export type ProviderDeleteResult = Readonly<ProviderConfigDeleteRequest & { removed: boolean }>;
export type ProviderHealth = Readonly<{ schemaVersion: 1; protocolVersion: 1; projectId: string; serviceKind: ProviderServiceKind; providerId: string; status: "healthy" | "unhealthy" | "unconfigured" | "unknown"; capabilities: readonly ProviderCapability[]; checkedAtMs: number; latencyMs: number | null; error: Readonly<{ code: ProviderHealthErrorCode; retryable: boolean }> | null }>;

export function isProviderConfigInput(value: unknown): value is ProviderConfigInput {
  return isRecord(value) && hasOnlyKeys(value, ["projectId", "serviceKind", "providerId", "displayName", "model", "endpoint", "credentialRef", "capabilities", "enabled"])
    && isUuid(value.projectId) && isService(value.serviceKind) && isProviderId(value.providerId) && isText(value.displayName, 80, true) && isText(value.model, 128, false)
    && (value.endpoint === undefined || isEndpoint(value.endpoint)) && (value.credentialRef === undefined || isCredentialRef(value.credentialRef))
    && (value.capabilities === undefined || isCapabilities(value.capabilities)) && (value.enabled === undefined || typeof value.enabled === "boolean");
}
export function isProviderConfigDeleteRequest(value: unknown): value is ProviderConfigDeleteRequest { return isRecord(value) && hasExactKeys(value, ["projectId", "serviceKind", "providerId"]) && isUuid(value.projectId) && isService(value.serviceKind) && isProviderId(value.providerId); }
export function isProviderConfigListRequest(value: unknown): value is ProviderConfigListRequest { return isRecord(value) && hasExactKeys(value, ["projectId"]) && isUuid(value.projectId); }
export function isProviderConfig(value: unknown): value is ProviderConfig {
  return isRecord(value) && hasExactKeys(value, ["schemaVersion", "protocolVersion", "projectId", "serviceKind", "providerId", "displayName", "model", "endpoint", "credentialRef", "capabilities", "enabled", "createdAtMs", "updatedAtMs"])
    && value.schemaVersion === 1 && value.protocolVersion === 1 && isUuid(value.projectId) && isService(value.serviceKind) && isProviderId(value.providerId) && isText(value.displayName, 80, true) && isText(value.model, 128, false) && isEndpoint(value.endpoint) && isCredentialRef(value.credentialRef) && isCapabilities(value.capabilities) && typeof value.enabled === "boolean" && isTime(value.createdAtMs) && isTime(value.updatedAtMs) && value.updatedAtMs >= value.createdAtMs;
}
export function isProviderConfigListResult(value: unknown): value is ProviderConfigListResult { return isRecord(value) && hasExactKeys(value, ["projectId", "items"]) && isUuid(value.projectId) && Array.isArray(value.items) && value.items.length <= PROVIDER_MAX_CONFIGS_PER_PROJECT && value.items.every(isProviderConfig) && value.items.every((item) => item.projectId === value.projectId); }
export function isProviderDeleteResult(value: unknown): value is ProviderDeleteResult { return isRecord(value) && hasExactKeys(value, ["projectId", "serviceKind", "providerId", "removed"]) && isUuid(value.projectId) && isService(value.serviceKind) && isProviderId(value.providerId) && typeof value.removed === "boolean"; }
export function isProviderHealth(value: unknown): value is ProviderHealth { return isRecord(value) && hasExactKeys(value, ["schemaVersion", "protocolVersion", "projectId", "serviceKind", "providerId", "status", "capabilities", "checkedAtMs", "latencyMs", "error"]) && value.schemaVersion === 1 && value.protocolVersion === 1 && isUuid(value.projectId) && isService(value.serviceKind) && isProviderId(value.providerId) && ["healthy", "unhealthy", "unconfigured", "unknown"].includes(value.status as string) && isCapabilities(value.capabilities) && isTime(value.checkedAtMs) && (value.latencyMs === null || (typeof value.latencyMs === "number" && Number.isSafeInteger(value.latencyMs) && value.latencyMs >= 0)) && (value.error === null || (isRecord(value.error) && hasExactKeys(value.error, ["code", "retryable"]) && isErrorCode(value.error.code) && typeof value.error.retryable === "boolean")); }

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)); }
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function isService(value: unknown): value is ProviderServiceKind { return typeof value === "string" && (PROVIDER_SERVICE_KINDS as readonly string[]).includes(value); }
function isProviderId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value); }
function isCredentialRef(value: unknown): value is string | null { return value === null || (typeof value === "string" && /^cred-[A-Za-z0-9._:-]{1,63}$/.test(value)); }
function isText(value: unknown, max: number, trim: boolean): value is string { return typeof value === "string" && value.length > 0 && value.length <= max && (!trim || value === value.trim()) && !/[\u0000-\u001f\u007f]/.test(value); }
function isEndpoint(value: unknown): value is string | null { if (value === null) return true; if (typeof value !== "string" || value.length === 0 || value.length > 512) return false; try { const url = new URL(value); return (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname))) && !url.username && !url.password && !url.hash; } catch { return false; } }
function isCapabilities(value: unknown): value is readonly ProviderCapability[] { return Array.isArray(value) && value.length > 0 && value.length <= 16 && new Set(value).size === value.length && value.every((item) => typeof item === "string" && (PROVIDER_CAPABILITIES as readonly string[]).includes(item)); }
function isTime(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isErrorCode(value: unknown): value is ProviderHealthErrorCode { return typeof value === "string" && ["UNKNOWN_PROVIDER", "CONFIG_INVALID", "MISSING_CREDENTIAL", "CREDENTIAL_UNAVAILABLE", "AUTH_FAILED", "NETWORK_ERROR", "TIMEOUT", "INVALID_RESPONSE", "UNSUPPORTED_CAPABILITY", "INTERNAL"].includes(value); }
