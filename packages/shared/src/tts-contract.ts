/** D02 versioned TTS job/result contract. No secret or ciphertext is represented. */

export const TTS_CONTRACT_VERSION = 1 as const;
export const TTS_SCHEMA_VERSION = 1 as const;
export const TTS_JOB_TYPE = "tts.synthesize" as const;
export const TTS_ADAPTER_VERSION = "fake-tts-v1" as const;
export const TTS_MAX_SENTENCES = 256;
export const TTS_MAX_TEXT_LENGTH = 4_096;
export const TTS_MAX_TOTAL_TEXT_LENGTH = 16_000;
export const TTS_MAX_DURATION_MS = 600_000;
export const TTS_MAX_RESULT_BYTES = 48 * 1024;
export const TTS_OUTPUT_RELATIVE_PATTERN = /^generated\/tts-v1\/[0-9a-f]{64}\.wav$/;

export type TtsSentenceInput = Readonly<{
  sentenceId: string;
  text: string;
  provenanceIds?: readonly string[];
}>;

export type TtsJobStartParams = Readonly<{
  projectId: string;
  idempotencyKey: string;
  providerId: string;
  model: string;
  voice: string;
  sentences: readonly TtsSentenceInput[];
}>;

/** Renderer-facing request; Main resolves model/capability/credentialRef. */
export type TtsStartRequest = Readonly<{
  projectId: string;
  idempotencyKey: string;
  providerId: string;
  voice: string;
  sentences: readonly TtsSentenceInput[];
}>;

export type TtsSentenceTimestamp = Readonly<{
  sentenceId: string;
  text: string;
  startMs: number;
  endMs: number;
  provenanceIds: readonly string[];
}>;

export type TtsAudioOutput = Readonly<{
  kind: "audio";
  relativePath: string;
  sizeBytes: number;
  durationMs: number;
  outputFingerprint: string;
}>;

export type TtsProvenance = Readonly<{
  kind: "generated";
  providerId: string;
  model: string;
  voice: string;
  adapterVersion: string;
}>;

export type TtsSynthesisResult = Readonly<{
  schemaVersion: typeof TTS_SCHEMA_VERSION;
  contractVersion: typeof TTS_CONTRACT_VERSION;
  adapterVersion: string;
  projectId: string;
  cacheStatus: "created" | "cache-hit";
  cacheKey: string;
  providerId: string;
  model: string;
  voice: string;
  durationMs: number;
  sentences: readonly TtsSentenceTimestamp[];
  output: TtsAudioOutput;
  provenance: TtsProvenance;
}>;

export type TtsJobResultParams = Readonly<{ projectId: string; jobId: string }>;

export function isTtsJobStartParams(value: unknown): value is TtsJobStartParams {
  if (!isRecord(value) || !hasOnlyKeys(value, ["projectId", "idempotencyKey", "providerId", "model", "voice", "sentences"])) return false;
  return isUuid(value.projectId)
    && isSafeString(value.idempotencyKey, 256)
    && isProviderId(value.providerId)
    && isSafeString(value.model, 128)
    && isSafeString(value.voice, 128)
    && isSentenceList(value.sentences);
}

export function isTtsStartRequest(value: unknown): value is TtsStartRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["projectId", "idempotencyKey", "providerId", "voice", "sentences"])) return false;
  return isUuid(value.projectId)
    && isSafeString(value.idempotencyKey, 256)
    && isProviderId(value.providerId)
    && isSafeString(value.voice, 128)
    && isSentenceList(value.sentences);
}

export function isTtsSynthesisResult(value: unknown): value is TtsSynthesisResult {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "contractVersion", "adapterVersion", "projectId", "cacheStatus", "cacheKey", "providerId", "model", "voice", "durationMs", "sentences", "output", "provenance"])) return false;
  if (value.schemaVersion !== TTS_SCHEMA_VERSION || value.contractVersion !== TTS_CONTRACT_VERSION || !isSafeString(value.adapterVersion, 64) || !isUuid(value.projectId) || (value.cacheStatus !== "created" && value.cacheStatus !== "cache-hit") || !isSha256(value.cacheKey) || !isProviderId(value.providerId) || !isSafeString(value.model, 128) || !isSafeString(value.voice, 128) || !isSafeInteger(value.durationMs, 1, TTS_MAX_DURATION_MS) || !Array.isArray(value.sentences) || value.sentences.length === 0 || value.sentences.length > TTS_MAX_SENTENCES || !value.sentences.every(isTtsSentenceTimestamp) || !isTtsAudioOutput(value.output) || !isTtsProvenance(value.provenance)) return false;
  const last = value.sentences[value.sentences.length - 1] as TtsSentenceTimestamp;
  const sentences = value.sentences as readonly TtsSentenceTimestamp[];
  const serialized = JSON.stringify(value);
  return sentences[0]!.startMs === 0
    && sentences.every((sentence, index) => index === 0 || sentence.startMs === sentences[index - 1]!.endMs)
    && new Set(sentences.map((sentence) => sentence.sentenceId)).size === sentences.length
    && last.endMs === value.durationMs
    && value.output.relativePath === `generated/tts-v1/${value.cacheKey}.wav`
    && value.output.durationMs === value.durationMs
    && value.provenance.providerId === value.providerId
    && value.provenance.model === value.model
    && value.provenance.voice === value.voice
    && value.provenance.adapterVersion === value.adapterVersion
    && serialized !== undefined
    && utf8ByteLength(serialized) <= TTS_MAX_RESULT_BYTES;
}

function isTtsSentenceTimestamp(value: unknown): value is TtsSentenceTimestamp {
  return isRecord(value) && hasOnlyKeys(value, ["sentenceId", "text", "startMs", "endMs", "provenanceIds"])
    && isSafeId(value.sentenceId) && isSafeText(value.text, TTS_MAX_TEXT_LENGTH) && isSafeInteger(value.startMs, 0, TTS_MAX_DURATION_MS) && isSafeInteger(value.endMs, 1, TTS_MAX_DURATION_MS) && value.endMs > value.startMs && isProvenanceIds(value.provenanceIds);
}

function isTtsAudioOutput(value: unknown): value is TtsAudioOutput {
  return isRecord(value) && hasOnlyKeys(value, ["kind", "relativePath", "sizeBytes", "durationMs", "outputFingerprint"])
    && value.kind === "audio" && typeof value.relativePath === "string" && TTS_OUTPUT_RELATIVE_PATTERN.test(value.relativePath) && isSafeInteger(value.sizeBytes, 1, 64 * 1024 * 1024) && isSafeInteger(value.durationMs, 1, TTS_MAX_DURATION_MS) && isSha256(value.outputFingerprint);
}

function isTtsProvenance(value: unknown): value is TtsProvenance {
  return isRecord(value) && hasOnlyKeys(value, ["kind", "providerId", "model", "voice", "adapterVersion"])
    && value.kind === "generated" && isProviderId(value.providerId) && isSafeString(value.model, 128) && isSafeString(value.voice, 128) && isSafeString(value.adapterVersion, 64);
}

function isSentenceList(value: unknown): value is readonly TtsSentenceInput[] {
  return Array.isArray(value) && value.length > 0 && value.length <= TTS_MAX_SENTENCES && value.every(isTtsSentenceInput)
    && new Set(value.map((item) => item.sentenceId)).size === value.length
    && value.reduce((total, item) => total + item.text.length, 0) <= TTS_MAX_TOTAL_TEXT_LENGTH;
}

function isTtsSentenceInput(value: unknown): value is TtsSentenceInput {
  return isRecord(value) && hasNoUnexpectedKeys(value, ["sentenceId", "text", "provenanceIds"])
    && Object.prototype.hasOwnProperty.call(value, "sentenceId") && Object.prototype.hasOwnProperty.call(value, "text")
    && isSafeId(value.sentenceId) && isSafeText(value.text, TTS_MAX_TEXT_LENGTH) && (value.provenanceIds === undefined || isProvenanceIds(value.provenanceIds));
}

function isProvenanceIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 16 && new Set(value).size === value.length && value.every(isSafeId);
}

function isProviderId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function isSafeText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasNoUnexpectedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function isSha256(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function isSafeString(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value); }
function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
