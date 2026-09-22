/** D06 versioned image-generation contract. It never carries a secret or credential reference. */

export const IMAGE_CONTRACT_VERSION = 1 as const;
export const IMAGE_SCHEMA_VERSION = 1 as const;
export const IMAGE_JOB_TYPE = "image.generate" as const;
export const IMAGE_ADAPTER_VERSION = "fake-image-v1" as const;
export const IMAGE_OUTPUT_DIRECTORY = "generated/images-v1" as const;
export const IMAGE_OUTPUT_RELATIVE_PATTERN = /^generated\/images-v1\/[0-9a-f]{64}\.png$/;
export const IMAGE_MAX_PROMPT_LENGTH = 4_096;
export const IMAGE_MAX_PROVENANCE = 32;
export const IMAGE_MAX_RESULT_BYTES = 48 * 1024;
export const IMAGE_MAX_OUTPUT_BYTES = 1 * 1024 * 1024;
export const IMAGE_MAX_PIXELS = 1_048_576;

export type ImageParameters = Readonly<{
  width: number;
  height: number;
  steps: number;
  seed: number;
}>;

export type ImageSource = Readonly<{
  kind: "d05-shot" | "user-brief" | "fact";
  id: string;
}>;

export type ImageProvenance = Readonly<{
  kind: "script" | "fact" | "source";
  id: string;
}>;

export type ImageJobStartParams = Readonly<{
  projectId: string;
  idempotencyKey: string;
  providerId: string;
  model: string;
  shotId: string;
  prompt: string;
  parameters: ImageParameters;
  source: ImageSource;
  provenance: readonly ImageProvenance[];
}>;

/** Renderer-facing request. Main resolves the model and provider capability. */
export type ImageStartRequest = Readonly<{
  projectId: string;
  idempotencyKey: string;
  providerId: string;
  shotId: string;
  prompt: string;
  parameters: ImageParameters;
  source: ImageSource;
  provenance: readonly ImageProvenance[];
}>;

export type ImageOutput = Readonly<{
  kind: "image";
  mimeType: "image/png";
  relativePath: string;
  sizeBytes: number;
  width: number;
  height: number;
  outputFingerprint: string;
}>;

export type ImageGenerationProvenance = Readonly<{
  kind: "generated";
  providerId: string;
  model: string;
  adapterVersion: string;
  source: ImageSource;
  provenance: readonly ImageProvenance[];
}>;

export type ImageGenerationResult = Readonly<{
  schemaVersion: typeof IMAGE_SCHEMA_VERSION;
  contractVersion: typeof IMAGE_CONTRACT_VERSION;
  adapterVersion: string;
  projectId: string;
  cacheStatus: "created" | "cache-hit";
  cacheKey: string;
  providerId: string;
  model: string;
  shotId: string;
  prompt: string;
  parameters: ImageParameters;
  source: ImageSource;
  provenance: readonly ImageProvenance[];
  output: ImageOutput;
  generationProvenance: ImageGenerationProvenance;
}>;

export function isImageJobStartParams(value: unknown): value is ImageJobStartParams {
  if (!isRecord(value) || !hasExactKeys(value, ["projectId", "idempotencyKey", "providerId", "model", "shotId", "prompt", "parameters", "source", "provenance"])) return false;
  return isUuid(value.projectId) && isSafeString(value.idempotencyKey, 256) && isProviderId(value.providerId)
    && isSafeName(value.model, 128) && isSafeId(value.shotId) && isSafePrompt(value.prompt)
    && isImageParameters(value.parameters) && isImageSource(value.source) && isImageProvenanceList(value.provenance);
}

export function isImageStartRequest(value: unknown): value is ImageStartRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["projectId", "idempotencyKey", "providerId", "shotId", "prompt", "parameters", "source", "provenance"])) return false;
  return isUuid(value.projectId) && isSafeString(value.idempotencyKey, 256) && isProviderId(value.providerId)
    && isSafeId(value.shotId) && isSafePrompt(value.prompt) && isImageParameters(value.parameters)
    && isImageSource(value.source) && isImageProvenanceList(value.provenance);
}

export function isImageGenerationResult(value: unknown): value is ImageGenerationResult {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "contractVersion", "adapterVersion", "projectId", "cacheStatus", "cacheKey", "providerId", "model", "shotId", "prompt", "parameters", "source", "provenance", "output", "generationProvenance"])) return false;
  if (value.schemaVersion !== IMAGE_SCHEMA_VERSION || value.contractVersion !== IMAGE_CONTRACT_VERSION || !isSafeName(value.adapterVersion, 64)
    || !isUuid(value.projectId) || (value.cacheStatus !== "created" && value.cacheStatus !== "cache-hit") || !isSha256(value.cacheKey)
    || !isProviderId(value.providerId) || !isSafeName(value.model, 128) || !isSafeId(value.shotId) || !isSafePrompt(value.prompt)
    || !isImageParameters(value.parameters) || !isImageSource(value.source) || !isImageProvenanceList(value.provenance)
    || !isImageOutput(value.output) || !isImageGenerationProvenance(value.generationProvenance)) return false;
  const output = value.output as ImageOutput;
  const generated = value.generationProvenance as ImageGenerationProvenance;
  const serialized = JSON.stringify(value);
  return output.relativePath === `${IMAGE_OUTPUT_DIRECTORY}/${value.cacheKey}.png`
    && output.width === (value.parameters as ImageParameters).width
    && output.height === (value.parameters as ImageParameters).height
    && generated.providerId === value.providerId && generated.model === value.model
    && generated.adapterVersion === value.adapterVersion && sameJson(generated.source, value.source)
    && sameJson(generated.provenance, value.provenance)
    && serialized !== undefined && utf8ByteLength(serialized) <= IMAGE_MAX_RESULT_BYTES;
}

function isImageParameters(value: unknown): value is ImageParameters {
  return isRecord(value) && hasExactKeys(value, ["width", "height", "steps", "seed"])
    && isSafeInteger(value.width, 64, 1024) && isSafeInteger(value.height, 64, 1024)
    && value.width * value.height <= IMAGE_MAX_PIXELS && isSafeInteger(value.steps, 1, 64)
    && isSafeInteger(value.seed, 0, 2_147_483_647);
}

function isImageSource(value: unknown): value is ImageSource {
  return isRecord(value) && hasExactKeys(value, ["kind", "id"])
    && (value.kind === "d05-shot" || value.kind === "user-brief" || value.kind === "fact") && isSafeId(value.id);
}

function isImageProvenance(value: unknown): value is ImageProvenance {
  return isRecord(value) && hasExactKeys(value, ["kind", "id"])
    && (value.kind === "script" || value.kind === "fact" || value.kind === "source") && isSafeId(value.id);
}

function isImageProvenanceList(value: unknown): value is readonly ImageProvenance[] {
  return Array.isArray(value) && value.length > 0 && value.length <= IMAGE_MAX_PROVENANCE
    && value.every(isImageProvenance) && new Set(value.map((item) => item.id)).size === value.length;
}

function isImageOutput(value: unknown): value is ImageOutput {
  return isRecord(value) && hasExactKeys(value, ["kind", "mimeType", "relativePath", "sizeBytes", "width", "height", "outputFingerprint"])
    && value.kind === "image" && value.mimeType === "image/png" && typeof value.relativePath === "string"
    && IMAGE_OUTPUT_RELATIVE_PATTERN.test(value.relativePath) && isSafeInteger(value.sizeBytes, 1, IMAGE_MAX_OUTPUT_BYTES)
    && isSafeInteger(value.width, 64, 1024) && isSafeInteger(value.height, 64, 1024) && value.width * value.height <= IMAGE_MAX_PIXELS
    && isSha256(value.outputFingerprint);
}

function isImageGenerationProvenance(value: unknown): value is ImageGenerationProvenance {
  return isRecord(value) && hasExactKeys(value, ["kind", "providerId", "model", "adapterVersion", "source", "provenance"])
    && value.kind === "generated" && isProviderId(value.providerId) && isSafeName(value.model, 128)
    && isSafeName(value.adapterVersion, 64) && isImageSource(value.source) && isImageProvenanceList(value.provenance);
}

function isSafePrompt(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096 && value.trim().length > 0
    && !/[\u0000-\u001f\u007f]/.test(value) && !containsSecretOrPath(value);
}

function isSafeName(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value) && !containsSecretOrPath(value);
}

function containsSecretOrPath(value: string): boolean {
  return /(?:https?|file|data):\/\//i.test(value) || /(?:^|\s)(?:[A-Za-z]:[\\/]|[\\/]{2}|~[\\/])/.test(value)
    || /[\\/]/.test(value)
    || /\b(?:api[_ -]?key|access[_ -]?token|bearer|credential|secret|password|provider|command|token)\b/i.test(value);
}

function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function utf8ByteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)); }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function isProviderId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value); }
function isSafeId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function isSafeString(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value); }
function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function isSha256(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
