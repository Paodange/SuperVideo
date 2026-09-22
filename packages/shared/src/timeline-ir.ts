/**
 * Renderer-neutral Timeline IR V1.
 *
 * Timeline JSON is an untrusted cross-process contract. Keep this module
 * dependency-free so the desktop, worker and future renderers can validate
 * the same payload without importing a renderer implementation.
 */

export const TIMELINE_IR_SCHEMA_VERSION = 1 as const;
export const TIMELINE_IR_MAX_DURATION_MS = 86_400_000;
export const TIMELINE_IR_MAX_PROJECT_BYTES = 512 * 1024;
export const TIMELINE_IR_MAX_TRACKS = 64;
export const TIMELINE_IR_MAX_CLIPS = 2_048;
export const TIMELINE_IR_MAX_SOURCES = 2_048;
export const TIMELINE_IR_MAX_PROVENANCE = 4_096;

export type TimelineId = string;
export type TimelineTrackKind = "video" | "audio" | "subtitle" | "overlay";
export type TimelineClipKind = "video" | "audio" | "image" | "text" | "subtitle" | "template";
export type TimelineSourceKind = "asset" | "generated" | "external";
export type TimelineProvenanceKind = "user-supplied" | "generated" | "external" | "derived";

export type TimelineJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly TimelineJsonValue[]
  | { readonly [key: string]: TimelineJsonValue };

export type TimelineCanvas = Readonly<{
  width: number;
  height: number;
  fps: number;
}>;

export type TimelineTransform = Readonly<{
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  anchorX: number;
  anchorY: number;
}>;

export type TimelineTransition = Readonly<{
  kind: "fade" | "dissolve" | "wipe";
  durationMs: number;
}>;

export type TimelineSubtitleStyle = Readonly<{
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  position?: "top" | "center" | "bottom";
  maxLines?: number;
}>;

export type TimelineSubtitle = Readonly<{
  text: string;
  language?: string;
  style?: TimelineSubtitleStyle;
}>;

export type TimelineSource = Readonly<{
  id: TimelineId;
  kind: TimelineSourceKind;
  uri: string;
  mediaType?: "video" | "audio" | "image" | "other";
  durationMs?: number;
  fingerprint?: string;
  provenanceIds?: readonly TimelineId[];
  metadata?: Readonly<Record<string, TimelineJsonValue>>;
}>;

export type TimelineProvenance = Readonly<{
  id: TimelineId;
  kind: TimelineProvenanceKind;
  sourceId?: TimelineId;
  uri?: string;
  provider?: string;
  license?: string;
  retrievedAt?: string;
  metadata?: Readonly<Record<string, TimelineJsonValue>>;
}>;

export type TimelineClip = Readonly<{
  id: TimelineId;
  trackId: TimelineId;
  kind: TimelineClipKind;
  sourceId?: TimelineId;
  timelineStartMs: number;
  durationMs: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  transform?: TimelineTransform;
  volume?: number;
  transitionIn?: TimelineTransition;
  transitionOut?: TimelineTransition;
  sentenceId?: string;
  editableInJianying: boolean;
  subtitle?: TimelineSubtitle;
  provenanceIds?: readonly TimelineId[];
  metadata?: Readonly<Record<string, TimelineJsonValue>>;
}>;

export type TimelineTrack = Readonly<{
  id: TimelineId;
  kind: TimelineTrackKind;
  name?: string;
  clips: readonly TimelineClip[];
  metadata?: Readonly<Record<string, TimelineJsonValue>>;
}>;

export type TimelineProject = Readonly<{
  schemaVersion: typeof TIMELINE_IR_SCHEMA_VERSION;
  id: TimelineId;
  canvas: TimelineCanvas;
  durationMs: number;
  tracks: readonly TimelineTrack[];
  sources: readonly TimelineSource[];
  provenance: readonly TimelineProvenance[];
}>;

export type TimelineValidationError = Readonly<{
  path: string;
  message: string;
}>;

export class TimelineValidationException extends Error {
  readonly errors: readonly TimelineValidationError[];

  constructor(errors: readonly TimelineValidationError[]) {
    super(errors.map((error) => `${error.path}: ${error.message}`).join("; "));
    this.name = "TimelineValidationException";
    this.errors = errors;
  }
}

export function isTimelineProject(value: unknown): value is TimelineProject {
  try {
    validateTimelineProject(value);
    return true;
  } catch {
    return false;
  }
}

export function validateTimelineProject(value: unknown): TimelineProject {
  const errors: TimelineValidationError[] = [];
  const project = asRecord(value, "$", errors);
  if (!project) throw new TimelineValidationException(errors);

  checkOnlyKeys(project, ["schemaVersion", "id", "canvas", "durationMs", "tracks", "sources", "provenance"], "$", errors);
  if (project.schemaVersion !== TIMELINE_IR_SCHEMA_VERSION) add(errors, "$.schemaVersion", "must be schema version 1");
  checkId(project.id, "$.id", errors);
  checkCanvas(project.canvas, "$.canvas", errors);
  checkInteger(project.durationMs, 1, TIMELINE_IR_MAX_DURATION_MS, "$.durationMs", errors);

  const sources = checkArray(project.sources, TIMELINE_IR_MAX_SOURCES, "$.sources", errors);
  const provenance = checkArray(project.provenance, TIMELINE_IR_MAX_PROVENANCE, "$.provenance", errors);
  const tracks = checkArray(project.tracks, TIMELINE_IR_MAX_TRACKS, "$.tracks", errors);

  const sourceIds = new Set<string>();
  sources?.forEach((source, index) => {
    checkSource(source, `$.sources[${index}]`, sourceIds, errors);
  });
  const provenanceIds = new Set<string>();
  provenance?.forEach((item, index) => {
    checkProvenance(item, `$.provenance[${index}]`, provenanceIds, sourceIds, errors);
  });
  sources?.forEach((source, index) => {
    if (Array.isArray(source.provenanceIds)) {
      for (const reference of source.provenanceIds) {
        if (typeof reference === "string" && !provenanceIds.has(reference)) add(errors, `$.sources[${index}].provenanceIds`, "must reference declared provenance");
      }
    }
  });

  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  let clipCount = 0;
  tracks?.forEach((track, trackIndex) => {
    const path = `$.tracks[${trackIndex}]`;
    const clips = checkTrack(track, path, trackIds, errors);
    clips?.forEach((clip, clipIndex) => {
      clipCount += 1;
      if (clipCount > TIMELINE_IR_MAX_CLIPS) add(errors, "$.tracks", `must contain at most ${TIMELINE_IR_MAX_CLIPS} clips`);
      checkClip(clip, `${path}.clips[${clipIndex}]`, track, project.durationMs, clipIds, sourceIds, provenanceIds, sources, errors);
    });
  });
  if (clipCount === 0) add(errors, "$.tracks", "must contain at least one clip");
  if (errors.length > 0) throw new TimelineValidationException(errors);

  let serializedSize = 0;
  try {
    serializedSize = utf8ByteLength(JSON.stringify(value));
  } catch {
    add(errors, "$", "must be JSON serializable");
  }
  if (serializedSize > TIMELINE_IR_MAX_PROJECT_BYTES) add(errors, "$", "exceeds the maximum encoded size");
  if (errors.length > 0) throw new TimelineValidationException(errors);
  return value as TimelineProject;
}

function checkCanvas(value: unknown, path: string, errors: TimelineValidationError[]): void {
  const canvas = asRecord(value, path, errors);
  if (!canvas) return;
  checkOnlyKeys(canvas, ["width", "height", "fps"], path, errors);
  checkInteger(canvas.width, 1, 7_680, `${path}.width`, errors);
  checkInteger(canvas.height, 1, 7_680, `${path}.height`, errors);
  checkNumber(canvas.fps, 1, 240, `${path}.fps`, errors);
}

function checkSource(value: unknown, path: string, ids: Set<string>, errors: TimelineValidationError[]): void {
  const source = asRecord(value, path, errors);
  if (!source) return;
  checkOnlyKeys(source, ["id", "kind", "uri", "mediaType", "durationMs", "fingerprint", "provenanceIds", "metadata"], path, errors);
  checkUniqueId(source.id, `${path}.id`, ids, errors);
  checkEnum(source.kind, ["asset", "generated", "external"], `${path}.kind`, errors);
  checkString(source.uri, 32_767, `${path}.uri`, errors);
  if (source.mediaType !== undefined) checkEnum(source.mediaType, ["video", "audio", "image", "other"], `${path}.mediaType`, errors);
  if (source.durationMs !== undefined) checkInteger(source.durationMs, 1, TIMELINE_IR_MAX_DURATION_MS, `${path}.durationMs`, errors);
  if (source.fingerprint !== undefined) checkFingerprint(source.fingerprint, `${path}.fingerprint`, errors);
  if (source.provenanceIds !== undefined) checkIdArray(source.provenanceIds, `${path}.provenanceIds`, errors);
  checkMetadata(source.metadata, `${path}.metadata`, errors);
}

function checkProvenance(value: unknown, path: string, ids: Set<string>, sourceIds: Set<string>, errors: TimelineValidationError[]): void {
  const provenance = asRecord(value, path, errors);
  if (!provenance) return;
  checkOnlyKeys(provenance, ["id", "kind", "sourceId", "uri", "provider", "license", "retrievedAt", "metadata"], path, errors);
  checkUniqueId(provenance.id, `${path}.id`, ids, errors);
  checkEnum(provenance.kind, ["user-supplied", "generated", "external", "derived"], `${path}.kind`, errors);
  if (provenance.sourceId !== undefined) {
    checkId(provenance.sourceId, `${path}.sourceId`, errors);
    if (typeof provenance.sourceId === "string" && !sourceIds.has(provenance.sourceId)) add(errors, `${path}.sourceId`, "must reference a declared source");
  }
  if (provenance.uri !== undefined) checkString(provenance.uri, 2_048, `${path}.uri`, errors);
  if (provenance.provider !== undefined) checkString(provenance.provider, 128, `${path}.provider`, errors);
  if (provenance.license !== undefined) checkString(provenance.license, 256, `${path}.license`, errors);
  if (provenance.retrievedAt !== undefined) checkIsoTimestamp(provenance.retrievedAt, `${path}.retrievedAt`, errors);
  checkMetadata(provenance.metadata, `${path}.metadata`, errors);
}

function checkTrack(value: unknown, path: string, ids: Set<string>, errors: TimelineValidationError[]): Record<string, unknown>[] | undefined {
  const track = asRecord(value, path, errors);
  if (!track) return undefined;
  checkOnlyKeys(track, ["id", "kind", "name", "clips", "metadata"], path, errors);
  checkUniqueId(track.id, `${path}.id`, ids, errors);
  checkEnum(track.kind, ["video", "audio", "subtitle", "overlay"], `${path}.kind`, errors);
  if (track.name !== undefined) checkString(track.name, 128, `${path}.name`, errors);
  const clips = checkArray(track.clips, TIMELINE_IR_MAX_CLIPS, `${path}.clips`, errors);
  checkMetadata(track.metadata, `${path}.metadata`, errors);
  return clips;
}

function checkClip(
  value: Record<string, unknown>,
  path: string,
  track: Record<string, unknown>,
  projectDurationMs: unknown,
  clipIds: Set<string>,
  sourceIds: Set<string>,
  provenanceIds: Set<string>,
  sources: Record<string, unknown>[] | undefined,
  errors: TimelineValidationError[],
): void {
  checkOnlyKeys(value, ["id", "trackId", "kind", "sourceId", "timelineStartMs", "durationMs", "sourceInMs", "sourceOutMs", "transform", "volume", "transitionIn", "transitionOut", "sentenceId", "editableInJianying", "subtitle", "provenanceIds", "metadata"], path, errors);
  checkUniqueId(value.id, `${path}.id`, clipIds, errors);
  checkId(value.trackId, `${path}.trackId`, errors);
  if (value.trackId !== track.id) add(errors, `${path}.trackId`, "must match its parent track");
  checkEnum(value.kind, ["video", "audio", "image", "text", "subtitle", "template"], `${path}.kind`, errors);
  checkInteger(value.timelineStartMs, 0, TIMELINE_IR_MAX_DURATION_MS, `${path}.timelineStartMs`, errors);
  checkInteger(value.durationMs, 1, TIMELINE_IR_MAX_DURATION_MS, `${path}.durationMs`, errors);
  if (typeof value.timelineStartMs === "number" && typeof value.durationMs === "number" && typeof projectDurationMs === "number" && value.timelineStartMs + value.durationMs > projectDurationMs) {
    add(errors, path, "clip must end within project duration");
  }
  if (value.sourceId !== undefined) {
    checkId(value.sourceId, `${path}.sourceId`, errors);
    if (typeof value.sourceId === "string" && !sourceIds.has(value.sourceId)) add(errors, `${path}.sourceId`, "must reference a declared source");
  }
  if (["video", "audio", "image", "template"].includes(value.kind as string) && value.sourceId === undefined) add(errors, `${path}.sourceId`, "is required for media clips");
  const hasSourceIn = value.sourceInMs !== undefined;
  const hasSourceOut = value.sourceOutMs !== undefined;
  if (hasSourceIn !== hasSourceOut) add(errors, path, "sourceInMs and sourceOutMs must be provided together");
  if (hasSourceIn && hasSourceOut) {
    checkInteger(value.sourceInMs, 0, TIMELINE_IR_MAX_DURATION_MS, `${path}.sourceInMs`, errors);
    checkInteger(value.sourceOutMs, 1, TIMELINE_IR_MAX_DURATION_MS, `${path}.sourceOutMs`, errors);
    if (typeof value.sourceInMs === "number" && typeof value.sourceOutMs === "number") {
      if (value.sourceOutMs <= value.sourceInMs) add(errors, path, "sourceOutMs must be greater than sourceInMs");
      if (typeof value.durationMs === "number" && value.sourceOutMs - value.sourceInMs !== value.durationMs) add(errors, path, "source span must equal clip duration");
    }
  }
  if (typeof value.sourceId === "string" && Array.isArray(sources) && hasSourceOut) {
    const source = sources.find((item) => item.id === value.sourceId);
    if (typeof source?.durationMs === "number" && typeof value.sourceOutMs === "number" && value.sourceOutMs > source.durationMs) add(errors, `${path}.sourceOutMs`, "must not exceed source duration");
  }
  checkTransform(value.transform, `${path}.transform`, errors);
  if (value.volume !== undefined) checkNumber(value.volume, 0, 4, `${path}.volume`, errors);
  checkTransition(value.transitionIn, `${path}.transitionIn`, errors);
  checkTransition(value.transitionOut, `${path}.transitionOut`, errors);
  if (value.sentenceId !== undefined) checkString(value.sentenceId, 128, `${path}.sentenceId`, errors);
  if (typeof value.editableInJianying !== "boolean") add(errors, `${path}.editableInJianying`, "must be a boolean");
  if (value.provenanceIds !== undefined) {
    checkIdArray(value.provenanceIds, `${path}.provenanceIds`, errors);
    if (Array.isArray(value.provenanceIds)) for (const id of value.provenanceIds) if (typeof id === "string" && !provenanceIds.has(id)) add(errors, `${path}.provenanceIds`, "must reference declared provenance");
  }
  if (value.kind === "subtitle") checkSubtitle(value.subtitle, `${path}.subtitle`, errors);
  else if (value.subtitle !== undefined) add(errors, `${path}.subtitle`, "is only valid for subtitle clips");
  checkTrackClipCompatibility(track.kind, value.kind, path, errors);
  checkTransitionDurations(value, path, errors);
  checkMetadata(value.metadata, `${path}.metadata`, errors);
}

function checkTrackClipCompatibility(trackKind: unknown, clipKind: unknown, path: string, errors: TimelineValidationError[]): void {
  const valid = trackKind === "audio" ? clipKind === "audio"
    : trackKind === "subtitle" ? clipKind === "subtitle"
      : trackKind === "video" ? ["video", "image", "template"].includes(clipKind as string)
        : ["image", "text", "template"].includes(clipKind as string);
  if (!valid) add(errors, path, "clip kind is not compatible with track kind");
}

function checkTransform(value: unknown, path: string, errors: TimelineValidationError[]): void {
  if (value === undefined) return;
  const transform = asRecord(value, path, errors);
  if (!transform) return;
  checkOnlyKeys(transform, ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "anchorX", "anchorY"], path, errors);
  checkNumber(transform.x, -100_000, 100_000, `${path}.x`, errors);
  checkNumber(transform.y, -100_000, 100_000, `${path}.y`, errors);
  checkNumber(transform.scaleX, 0.001, 100, `${path}.scaleX`, errors);
  checkNumber(transform.scaleY, 0.001, 100, `${path}.scaleY`, errors);
  checkNumber(transform.rotation, -360_000, 360_000, `${path}.rotation`, errors);
  checkNumber(transform.opacity, 0, 1, `${path}.opacity`, errors);
  checkNumber(transform.anchorX, 0, 1, `${path}.anchorX`, errors);
  checkNumber(transform.anchorY, 0, 1, `${path}.anchorY`, errors);
}

function checkTransition(value: unknown, path: string, errors: TimelineValidationError[]): void {
  if (value === undefined) return;
  const transition = asRecord(value, path, errors);
  if (!transition) return;
  checkOnlyKeys(transition, ["kind", "durationMs"], path, errors);
  checkEnum(transition.kind, ["fade", "dissolve", "wipe"], `${path}.kind`, errors);
  checkInteger(transition.durationMs, 1, 10_000, `${path}.durationMs`, errors);
}

function checkTransitionDurations(value: Record<string, unknown>, path: string, errors: TimelineValidationError[]): void {
  const inDuration = transitionDuration(value.transitionIn);
  const outDuration = transitionDuration(value.transitionOut);
  if (typeof value.durationMs === "number" && inDuration + outDuration > value.durationMs) add(errors, path, "transition durations must fit within clip duration");
}

function transitionDuration(value: unknown): number {
  return isPlainRecord(value) && typeof value.durationMs === "number" && Number.isFinite(value.durationMs) ? value.durationMs : 0;
}

function checkSubtitle(value: unknown, path: string, errors: TimelineValidationError[]): void {
  const subtitle = asRecord(value, path, errors);
  if (!subtitle) return;
  checkOnlyKeys(subtitle, ["text", "language", "style"], path, errors);
  checkString(subtitle.text, 8_192, `${path}.text`, errors);
  if (subtitle.language !== undefined) checkString(subtitle.language, 32, `${path}.language`, errors);
  if (subtitle.style === undefined) return;
  const style = asRecord(subtitle.style, `${path}.style`, errors);
  if (!style) return;
  checkOnlyKeys(style, ["fontFamily", "fontSize", "color", "backgroundColor", "position", "maxLines"], `${path}.style`, errors);
  if (style.fontFamily !== undefined) checkString(style.fontFamily, 128, `${path}.style.fontFamily`, errors);
  if (style.fontSize !== undefined) checkNumber(style.fontSize, 1, 512, `${path}.style.fontSize`, errors);
  if (style.color !== undefined) checkColor(style.color, `${path}.style.color`, errors);
  if (style.backgroundColor !== undefined) checkColor(style.backgroundColor, `${path}.style.backgroundColor`, errors);
  if (style.position !== undefined) checkEnum(style.position, ["top", "center", "bottom"], `${path}.style.position`, errors);
  if (style.maxLines !== undefined) checkInteger(style.maxLines, 1, 8, `${path}.style.maxLines`, errors);
}

function checkMetadata(value: unknown, path: string, errors: TimelineValidationError[]): void {
  if (value === undefined) return;
  if (!isTimelineJsonValue(value, 0)) add(errors, path, "must be bounded JSON metadata");
}

function isTimelineJsonValue(value: unknown, depth: number): value is TimelineJsonValue {
  if (depth > 4 || value === null || typeof value === "boolean" || typeof value === "string") return value === null || typeof value === "boolean" || typeof value === "string" && value.length <= 2_048 && !hasControlCharacters(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 32 && value.every((item) => isTimelineJsonValue(item, depth + 1));
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length <= 64 && keys.every((key) => key.length > 0 && key.length <= 128 && isTimelineJsonValue(value[key], depth + 1));
}

function checkIdArray(value: unknown, path: string, errors: TimelineValidationError[]): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    add(errors, path, "must be a non-empty array of at most 32 IDs");
    return;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    checkId(item, `${path}[${index}]`, errors);
    if (typeof item === "string") {
      if (seen.has(item)) add(errors, `${path}[${index}]`, "must be unique");
      seen.add(item);
    }
  });
}

function checkUniqueId(value: unknown, path: string, ids: Set<string>, errors: TimelineValidationError[]): void {
  checkId(value, path, errors);
  if (typeof value === "string") {
    if (ids.has(value)) add(errors, path, "must be unique");
    ids.add(value);
  }
}

function checkId(value: unknown, path: string, errors: TimelineValidationError[]): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) add(errors, path, "must be a bounded timeline ID");
}

function checkFingerprint(value: unknown, path: string, errors: TimelineValidationError[]): void {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) add(errors, path, "must be a lowercase SHA-256 fingerprint");
}

function checkIsoTimestamp(value: unknown, path: string, errors: TimelineValidationError[]): void {
  if (typeof value !== "string" || value.length > 64 || Number.isNaN(Date.parse(value))) add(errors, path, "must be an ISO timestamp");
}

function checkColor(value: unknown, path: string, errors: TimelineValidationError[]): void {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value)) add(errors, path, "must be an #RRGGBB or #RRGGBBAA color");
}

function checkString(value: unknown, maximumLength: number, path: string, errors: TimelineValidationError[]): void {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || hasControlCharacters(value)) add(errors, path, `must be a non-empty string of at most ${maximumLength} characters`);
}

function checkNumber(value: unknown, minimum: number, maximum: number, path: string, errors: TimelineValidationError[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) add(errors, path, `must be a finite number between ${minimum} and ${maximum}`);
}

function checkInteger(value: unknown, minimum: number, maximum: number, path: string, errors: TimelineValidationError[]): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) add(errors, path, `must be an integer between ${minimum} and ${maximum}`);
}

function checkEnum(value: unknown, allowed: readonly string[], path: string, errors: TimelineValidationError[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) add(errors, path, `must be one of ${allowed.join(", ")}`);
}

function checkArray(value: unknown, maximumLength: number, path: string, errors: TimelineValidationError[]): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value) || value.length > maximumLength) {
    add(errors, path, `must be an array of at most ${maximumLength} items`);
    return undefined;
  }
  return value.map((item, index) => {
    if (!isPlainRecord(item)) {
      add(errors, `${path}[${index}]`, "must be an object");
      return {};
    }
    return item;
  });
}

function asRecord(value: unknown, path: string, errors: TimelineValidationError[]): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) {
    add(errors, path, "must be an object");
    return undefined;
  }
  return value;
}

function checkOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: TimelineValidationError[]): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) if (!accepted.has(key)) add(errors, `${path}.${key}`, "is not allowed");
}

function add(errors: TimelineValidationError[], path: string, message: string): void {
  if (errors.length < 64) errors.push({ path, message });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 && character !== "\t" && character !== "\n" && character !== "\r";
  });
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
