import { isTimelineProject, type TimelineProject } from "./timeline-ir";

/**
 * D03 deliberately exposes a renderer seam instead of importing Remotion.
 * The values below are part of the persisted contract and must change only
 * with an explicit migration.
 */
export const REMOTION_CONTRACT_VERSION = "remotion-runtime-v1" as const;
export const REMOTION_RENDER_VERSION = "remotion-render-v1" as const;
export const REMOTION_BUNDLE_VERSION = "remotion-bundle-v1" as const;
export const REMOTION_TEMPLATE_ID = "timeline-preview" as const;
export const REMOTION_TEMPLATE_VERSION = "timeline-preview-v1" as const;
export const REMOTION_RUNTIME_MODE = "offline-contract" as const;
export const REMOTION_MAX_INPUT_BYTES = 768 * 1024;
export const REMOTION_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const REMOTION_MAX_RENDER_DURATION_MS = 86_400_000;

export type RemotionRenderInputProps = Readonly<{
  contractVersion: typeof REMOTION_CONTRACT_VERSION;
  projectId: string;
  templateId: typeof REMOTION_TEMPLATE_ID;
  templateVersion: typeof REMOTION_TEMPLATE_VERSION;
  bundleVersion: typeof REMOTION_BUNDLE_VERSION;
  timeline: TimelineProject;
}>;

export type RemotionRenderParams = Readonly<{
  schemaVersion: 1;
  renderVersion: typeof REMOTION_RENDER_VERSION;
  projectId: string;
  idempotencyKey: string;
  inputProps: RemotionRenderInputProps;
}>;

export type RemotionRenderResult = Readonly<{
  schemaVersion: 1;
  resultVersion: "remotion-render-result-v1";
  projectId: string;
  runtimeMode: typeof REMOTION_RUNTIME_MODE;
  templateId: typeof REMOTION_TEMPLATE_ID;
  templateVersion: typeof REMOTION_TEMPLATE_VERSION;
  bundleVersion: typeof REMOTION_BUNDLE_VERSION;
  cacheStatus: "created" | "cache-hit";
  cacheKey: string;
  bundleCacheKey: string;
  timelineDigest: string;
  output: Readonly<{
    artifactKind: "render-contract";
    relativePath: string;
    manifestPath: string;
    sizeBytes: number;
    sha256: string;
  }>;
  player: Readonly<{
    availability: "contract-only";
    compositionId: "timeline-preview-v1";
    playbackUri: string;
  }>;
}>;

export type RemotionPlayerPreviewContract = Readonly<{
  contractVersion: typeof REMOTION_CONTRACT_VERSION;
  availability: "contract-only";
  compositionId: "timeline-preview-v1";
  projectId: string;
  templateVersion: typeof REMOTION_TEMPLATE_VERSION;
  playbackUri: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_PATH = /^(?:generated\/remotion-v1|exports\/remotion-v1)\/[A-Za-z0-9._/-]+$/;

export function isRemotionRenderInputProps(value: unknown): value is RemotionRenderInputProps {
  if (!isRecord(value) || !hasOnlyKeys(value, ["contractVersion", "projectId", "templateId", "templateVersion", "bundleVersion", "timeline"])) return false;
  return value.contractVersion === REMOTION_CONTRACT_VERSION
    && isUuid(value.projectId)
    && value.templateId === REMOTION_TEMPLATE_ID
    && value.templateVersion === REMOTION_TEMPLATE_VERSION
    && value.bundleVersion === REMOTION_BUNDLE_VERSION
    && isTimelineProject(value.timeline)
    && !containsForbiddenKey(value.timeline)
    && boundedJson(value, REMOTION_MAX_INPUT_BYTES);
}

export function isRemotionRenderParams(value: unknown): value is RemotionRenderParams {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "renderVersion", "projectId", "idempotencyKey", "inputProps"])) return false;
  return value.schemaVersion === 1
    && value.renderVersion === REMOTION_RENDER_VERSION
    && isUuid(value.projectId)
    && isSafeString(value.idempotencyKey, 256)
    && isRemotionRenderInputProps(value.inputProps)
    && value.inputProps.projectId === value.projectId;
}

export function isRemotionRenderResult(value: unknown): value is RemotionRenderResult {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "resultVersion", "projectId", "runtimeMode", "templateId", "templateVersion", "bundleVersion", "cacheStatus", "cacheKey", "bundleCacheKey", "timelineDigest", "output", "player"])) return false;
  if (value.schemaVersion !== 1 || value.resultVersion !== "remotion-render-result-v1" || !isUuid(value.projectId)) return false;
  if (value.runtimeMode !== REMOTION_RUNTIME_MODE || value.templateId !== REMOTION_TEMPLATE_ID || value.templateVersion !== REMOTION_TEMPLATE_VERSION || value.bundleVersion !== REMOTION_BUNDLE_VERSION) return false;
  if (value.cacheStatus !== "created" && value.cacheStatus !== "cache-hit") return false;
  if (!isSha256(value.cacheKey) || !isSha256(value.bundleCacheKey) || !isSha256(value.timelineDigest)) return false;
  if (!isRecord(value.output) || !hasOnlyKeys(value.output, ["artifactKind", "relativePath", "manifestPath", "sizeBytes", "sha256"])) return false;
  if (value.output.artifactKind !== "render-contract" || !isCanonicalRenderPath(value.output.relativePath, value.cacheKey, false) || !isCanonicalRenderPath(value.output.manifestPath, value.cacheKey, true)) return false;
  if (!isSafeInteger(value.output.sizeBytes, 1, REMOTION_MAX_OUTPUT_BYTES) || !isSha256(value.output.sha256)) return false;
  if (!isRecord(value.player) || !hasOnlyKeys(value.player, ["availability", "compositionId", "playbackUri"])) return false;
  return value.player.availability === "contract-only" && value.player.compositionId === "timeline-preview-v1" && isPlaybackUri(value.player.playbackUri, value.projectId, value.cacheKey)
    && boundedJson(value, 32 * 1024);
}

export function isRemotionPlayerPreviewContract(value: unknown): value is RemotionPlayerPreviewContract {
  return isRecord(value) && hasOnlyKeys(value, ["contractVersion", "availability", "compositionId", "projectId", "templateVersion", "playbackUri"])
    && value.contractVersion === REMOTION_CONTRACT_VERSION
    && value.availability === "contract-only"
    && value.compositionId === "timeline-preview-v1"
    && isUuid(value.projectId)
    && value.templateVersion === REMOTION_TEMPLATE_VERSION
    && isPreviewPlaybackUri(value.playbackUri, value.projectId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function isSha256(value: unknown): value is string { return typeof value === "string" && SHA256.test(value); }
function isSafeString(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value); }
function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function isCanonicalRenderPath(value: unknown, cacheKey: string, manifest: boolean): value is string {
  const expected = `generated/remotion-v1/renders/${cacheKey}${manifest ? ".manifest.json" : ".json"}`;
  return typeof value === "string" && value === expected && value.length <= 512 && SAFE_PATH.test(value);
}
function isPreviewPlaybackUri(value: unknown, projectId: string): value is string {
  const prefix = `supervideo://remotion/${projectId}/`;
  return typeof value === "string" && value.startsWith(prefix) && isSha256(value.slice(prefix.length));
}
function isPlaybackUri(value: unknown, projectId: string, cacheKey: string): value is string { return value === `supervideo://remotion/${projectId}/${cacheKey}`; }

function boundedJson(value: unknown, maximum: number): boolean {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maximum; } catch { return false; }
}

function containsForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 16 || Array.isArray(value) && value.length > 2_048) return true;
  if (Array.isArray(value)) return value.some((item) => containsForbiddenKey(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => /(?:secret|credential|token|password|command|executable|rendererpath)/i.test(key) || containsForbiddenKey(item, depth + 1));
}
