/** D07 generated-video assembly contract and deterministic Timeline IR builder. */

import {
  isImageGenerationResult,
  type ImageGenerationResult,
} from "./image-contract";
import {
  isRecruitmentTemplateRenderPlan,
  type RecruitmentTemplateRenderPlan,
} from "./recruitment-template-contract";
import {
  REMOTION_BUNDLE_VERSION,
  REMOTION_CONTRACT_VERSION,
  REMOTION_RUNTIME_MODE,
  REMOTION_TEMPLATE_ID,
  REMOTION_TEMPLATE_VERSION,
  REMOTION_RENDER_VERSION,
} from "./remotion-contract";
import {
  isScriptStoryboardResult,
  type ScriptStoryboardResult,
  type ScriptStoryboardSegment,
} from "./script-storyboard-contract";
import {
  isTimelineProject,
  type TimelineClip,
  type TimelineJsonValue,
  type TimelineProject,
  type TimelineProvenance,
  type TimelineSource,
  type TimelineTrack,
} from "./timeline-ir";
import { isTtsSynthesisResult, type TtsSynthesisResult } from "./tts-contract";

export const VIDEO_ASSEMBLY_SCHEMA_VERSION = 1 as const;
export const VIDEO_ASSEMBLY_CONTRACT_VERSION = "video-assembly-v1" as const;
export const VIDEO_ASSEMBLY_RUNTIME_MODE = "offline-deterministic" as const;
export const VIDEO_ASSEMBLY_MAX_DURATION_MS = 60_000;
export const VIDEO_ASSEMBLY_MAX_SHOTS = 32;
export const VIDEO_ASSEMBLY_MAX_MATERIALS = 32;
export const VIDEO_ASSEMBLY_MAX_INPUT_BYTES = 768 * 1024;
export const VIDEO_ASSEMBLY_MAX_RESULT_BYTES = 768 * 1024;
export const VIDEO_ASSEMBLY_OUTPUT_PATTERN = /^generated\/video-assembly-v1\/[0-9a-f]{64}\.json$/;
export const VIDEO_ASSEMBLY_USER_URI_PATTERN = /^supervideo:\/\/asset\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const VIDEO_ASSEMBLY_CONTROLLED_URI_PATTERN = /^supervideo:\/\/(?:asset|generated|external)\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?:\?[A-Za-z0-9._=&:-]{0,256})?$/;

export type VideoAssemblyRemotionPlan = Readonly<{
  contractVersion: typeof REMOTION_CONTRACT_VERSION;
  renderVersion: typeof REMOTION_RENDER_VERSION;
  runtimeMode: typeof REMOTION_RUNTIME_MODE;
  templateId: typeof REMOTION_TEMPLATE_ID;
  templateVersion: typeof REMOTION_TEMPLATE_VERSION;
  bundleVersion: typeof REMOTION_BUNDLE_VERSION;
  compositionId: "timeline-preview-v1";
}>;

export type VideoAssemblyUserMaterial = Readonly<{
  sourceId: string;
  shotId: string;
  uri: string;
  mediaType: "video" | "image";
  durationMs?: number;
  fingerprint: string;
  provenanceId: string;
}>;

export type VideoAssemblyRequest = Readonly<{
  schemaVersion: typeof VIDEO_ASSEMBLY_SCHEMA_VERSION;
  contractVersion: typeof VIDEO_ASSEMBLY_CONTRACT_VERSION;
  runtimeMode: typeof VIDEO_ASSEMBLY_RUNTIME_MODE;
  projectId: string;
  timelineId: string;
  assemblyId: string;
  storyboard: ScriptStoryboardResult;
  tts: TtsSynthesisResult;
  imageResults: readonly ImageGenerationResult[];
  d04Plan: RecruitmentTemplateRenderPlan;
  d03Plan: VideoAssemblyRemotionPlan;
  userMaterials?: readonly VideoAssemblyUserMaterial[];
}>;

export type VideoAssemblyPreview = Readonly<{
  availability: "contract-only";
  compositionId: "timeline-preview-v1";
  playbackUri: string;
  timelineDigest: string;
}>;

export type VideoAssemblyProvenanceSummary = Readonly<{
  storyboardSourcePlanDigest: string;
  ttsCacheKey: string;
  imageCacheKeys: readonly Readonly<{ shotId: string; cacheKey: string }>[];
  userMaterialSourceIds: readonly string[];
}>;

export type VideoAssemblyResult = Readonly<{
  schemaVersion: typeof VIDEO_ASSEMBLY_SCHEMA_VERSION;
  contractVersion: typeof VIDEO_ASSEMBLY_CONTRACT_VERSION;
  runtimeMode: typeof VIDEO_ASSEMBLY_RUNTIME_MODE;
  projectId: string;
  timelineId: string;
  assemblyId: string;
  status: "assembled";
  contentStatus: "ready" | "needs-user-confirmation";
  durationMs: number;
  timelineDigest: string;
  output: Readonly<{
    kind: "timeline-ir";
    relativePath: string;
    durationMs: number;
    digest: string;
  }>;
  preview: VideoAssemblyPreview;
  provenance: VideoAssemblyProvenanceSummary;
  timeline: TimelineProject;
}>;

export type VideoAssemblyErrorCode =
  | "VIDEO_ASSEMBLY_INPUT_INVALID"
  | "VIDEO_ASSEMBLY_PROJECT_MISMATCH"
  | "VIDEO_ASSEMBLY_STORYBOARD_INVALID"
  | "VIDEO_ASSEMBLY_TTS_BINDING_INVALID"
  | "VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID"
  | "VIDEO_ASSEMBLY_MATERIAL_INVALID"
  | "VIDEO_ASSEMBLY_LAYOUT_INVALID"
  | "VIDEO_ASSEMBLY_PLAN_INVALID"
  | "VIDEO_ASSEMBLY_TIMELINE_INVALID"
  | "VIDEO_ASSEMBLY_RESULT_INVALID";

export type VideoAssemblyStage =
  | "input"
  | "project-binding"
  | "storyboard-binding"
  | "tts-binding"
  | "image-binding"
  | "material-binding"
  | "layout-binding"
  | "plan-binding"
  | "timeline-validation"
  | "result"
  | "result-validation";

export type VideoAssemblyValidationError = Readonly<{
  code: VideoAssemblyErrorCode;
  stage: VideoAssemblyStage;
  path: string;
  message: string;
}>;

export class VideoAssemblyValidationException extends Error {
  readonly error: VideoAssemblyValidationError;

  constructor(error: VideoAssemblyValidationError) {
    super(`${error.code} at ${error.path}: ${error.message}`);
    this.name = "VideoAssemblyValidationException";
    this.error = error;
  }
}

export function isVideoAssemblyRequest(value: unknown): value is VideoAssemblyRequest {
  try {
    validateVideoAssemblyRequest(value);
    return true;
  } catch {
    return false;
  }
}

export function validateVideoAssemblyRequest(value: unknown): VideoAssemblyRequest {
  const input = record(value, "$.", "VIDEO_ASSEMBLY_INPUT_INVALID", "input");
  exactKeys(input, ["schemaVersion", "contractVersion", "runtimeMode", "projectId", "timelineId", "assemblyId", "storyboard", "tts", "imageResults", "d04Plan", "d03Plan", "userMaterials"], "$", "VIDEO_ASSEMBLY_INPUT_INVALID", "input");
  if (input.schemaVersion !== VIDEO_ASSEMBLY_SCHEMA_VERSION || input.contractVersion !== VIDEO_ASSEMBLY_CONTRACT_VERSION || input.runtimeMode !== VIDEO_ASSEMBLY_RUNTIME_MODE) fail("VIDEO_ASSEMBLY_INPUT_INVALID", "input", "$", "has an invalid D07 version or runtime mode");
  checkUuid(input.projectId, "$.projectId", "VIDEO_ASSEMBLY_INPUT_INVALID", "input");
  checkId(input.timelineId, "$.timelineId", "VIDEO_ASSEMBLY_INPUT_INVALID", "input");
  checkId(input.assemblyId, "$.assemblyId", "VIDEO_ASSEMBLY_INPUT_INVALID", "input");
  if (!isScriptStoryboardResult(input.storyboard)) fail("VIDEO_ASSEMBLY_STORYBOARD_INVALID", "storyboard-binding", "$.storyboard", "must be a valid D05 result");
  if (!isTtsSynthesisResult(input.tts)) fail("VIDEO_ASSEMBLY_TTS_BINDING_INVALID", "tts-binding", "$.tts", "must be a valid D02 result");
  if (!Array.isArray(input.imageResults) || input.imageResults.length > VIDEO_ASSEMBLY_MAX_SHOTS) fail("VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID", "image-binding", "$.imageResults", "must contain at most 32 D06 results");
  const imageResults = (input.imageResults ?? []) as unknown[];
  imageResults.forEach((item, index) => {
    if (!isImageGenerationResult(item)) fail("VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID", "image-binding", `$.imageResults[${index}]`, "must be a valid D06 result");
  });
  if (!isRecruitmentTemplateRenderPlan(input.d04Plan)) fail("VIDEO_ASSEMBLY_LAYOUT_INVALID", "layout-binding", "$.d04Plan", "must be a valid D04 render plan");
  validateRemotionPlan(input.d03Plan, "$.d03Plan");
  const materials = input.userMaterials ?? [];
  if (!Array.isArray(materials) || materials.length > VIDEO_ASSEMBLY_MAX_MATERIALS) fail("VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding", "$.userMaterials", "must contain at most 32 materials");
  materials.forEach((item, index) => validateUserMaterial(item, `$.userMaterials[${index}]`));
  rejectForbidden(input, "$", new Set());
  if (!boundedJson(input, VIDEO_ASSEMBLY_MAX_INPUT_BYTES)) fail("VIDEO_ASSEMBLY_INPUT_INVALID", "input", "$", "exceeds the D07 input size limit");
  return value as VideoAssemblyRequest;
}

export function isVideoAssemblyResult(value: unknown): value is VideoAssemblyResult {
  try {
    validateVideoAssemblyResult(value);
    return true;
  } catch {
    return false;
  }
}

export function validateVideoAssemblyResult(value: unknown): VideoAssemblyResult {
  const result = record(value, "$.", "VIDEO_ASSEMBLY_RESULT_INVALID", "result");
  exactKeys(result, ["schemaVersion", "contractVersion", "runtimeMode", "projectId", "timelineId", "assemblyId", "status", "contentStatus", "durationMs", "timelineDigest", "output", "preview", "provenance", "timeline"], "$", "VIDEO_ASSEMBLY_RESULT_INVALID", "result");
  if (result.schemaVersion !== 1 || result.contractVersion !== VIDEO_ASSEMBLY_CONTRACT_VERSION || result.runtimeMode !== VIDEO_ASSEMBLY_RUNTIME_MODE || result.status !== "assembled") fail("VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation", "$", "has an invalid result version or status");
  checkUuid(result.projectId, "$.projectId", "VIDEO_ASSEMBLY_RESULT_INVALID", "result");
  checkId(result.timelineId, "$.timelineId", "VIDEO_ASSEMBLY_RESULT_INVALID", "result");
  checkId(result.assemblyId, "$.assemblyId", "VIDEO_ASSEMBLY_RESULT_INVALID", "result");
  if (result.contentStatus !== "ready" && result.contentStatus !== "needs-user-confirmation") fail("VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation", "$.contentStatus", "is not allowed");
  checkInteger(result.durationMs, 1, VIDEO_ASSEMBLY_MAX_DURATION_MS, "$.durationMs", "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation");
  checkSha256(result.timelineDigest, "$.timelineDigest", "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation");
  if (!isTimelineProject(result.timeline)) fail("VIDEO_ASSEMBLY_TIMELINE_INVALID", "timeline-validation", "$.timeline", "must pass the C01 Timeline IR V1 validator");
  const timeline = result.timeline as TimelineProject;
  if (timeline.id !== result.timelineId || timeline.durationMs !== result.durationMs || timeline.id === "") fail("VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation", "$.timeline", "does not bind to the result identity or duration");
  timeline.sources.forEach((source, index) => { if (!VIDEO_ASSEMBLY_CONTROLLED_URI_PATTERN.test(source.uri) || source.uri.includes("..") || source.uri.includes("\\")) fail("VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation", `$.timeline.sources[${index}].uri`, "must be a controlled SuperVideo reference"); });
  timeline.provenance.forEach((item, index) => { if (item.uri !== undefined && (!VIDEO_ASSEMBLY_CONTROLLED_URI_PATTERN.test(item.uri) || item.uri.includes("..") || item.uri.includes("\\"))) fail("VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation", `$.timeline.provenance[${index}].uri`, "must be a controlled SuperVideo reference"); });
  if (sha256Hex(canonicalJson(timeline)) !== result.timelineDigest) fail("VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation", "$.timelineDigest", "does not match the canonical Timeline IR");
  const output = record(result.output, "$.output", "VIDEO_ASSEMBLY_RESULT_INVALID", "result");
  exactKeys(output, ["kind", "relativePath", "durationMs", "digest"], "$.output", "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation");
  if (output.kind !== "timeline-ir" || output.durationMs !== result.durationMs || output.digest !== result.timelineDigest || output.relativePath !== `generated/video-assembly-v1/${result.timelineDigest}.json` || !VIDEO_ASSEMBLY_OUTPUT_PATTERN.test(String(output.relativePath))) fail("VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation", "$.output", "has an uncontrolled or mismatched plan reference");
  const preview = record(result.preview, "$.preview", "VIDEO_ASSEMBLY_RESULT_INVALID", "result");
  exactKeys(preview, ["availability", "compositionId", "playbackUri", "timelineDigest"], "$.preview", "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation");
  if (preview.availability !== "contract-only" || preview.compositionId !== "timeline-preview-v1" || preview.timelineDigest !== result.timelineDigest || preview.playbackUri !== `supervideo://remotion/${result.projectId}/${result.timelineDigest}`) fail("VIDEO_ASSEMBLY_PLAN_INVALID", "plan-binding", "$.preview", "does not match the fixed D03 offline seam");
  validateProvenanceSummary(result.provenance);
  rejectForbidden(result, "$", new Set());
  if (!boundedJson(result, VIDEO_ASSEMBLY_MAX_RESULT_BYTES)) fail("VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation", "$", "exceeds the D07 result size limit");
  return value as VideoAssemblyResult;
}

export function buildVideoAssembly(value: unknown): VideoAssemblyResult {
  const request = validateVideoAssemblyRequest(value);
  const storyboard = request.storyboard;
  const segments = [storyboard.script.hook, ...storyboard.script.body, storyboard.script.cta];
  if (storyboard.projectId !== request.projectId || request.d04Plan.projectId !== request.projectId || request.d04Plan.timelineId !== request.timelineId) fail("VIDEO_ASSEMBLY_PROJECT_MISMATCH", "project-binding", "$.projectId", "D05 and D04 inputs do not belong to the requested project/timeline");
  if (storyboard.status === "gaps" || storyboard.status === "needs-duration-optimization" || storyboard.durationStatus !== "within-tolerance" || segments.some((segment) => segment.status !== "matched" || segment.durationMs <= 0)) fail("VIDEO_ASSEMBLY_STORYBOARD_INVALID", "storyboard-binding", "$.storyboard", "D07 requires a complete, in-tolerance, whole-sentence storyboard; D08 fallback is not applied");
  if (storyboard.selectedDurationMs < 1 || storyboard.selectedDurationMs > VIDEO_ASSEMBLY_MAX_DURATION_MS) fail("VIDEO_ASSEMBLY_STORYBOARD_INVALID", "storyboard-binding", "$.storyboard.selectedDurationMs", "is outside the D07 duration bound");
  bindTts(request.tts, request.projectId, segments);
  const materials = [...(request.userMaterials ?? [])];
  const materialByShot = new Map(materials.map((item) => [item.shotId, item]));
  const imageByShot = new Map(request.imageResults.map((item) => [item.shotId, item]));
  const shots = [...storyboard.shots].sort((left, right) => left.order - right.order);
  if (shots.length !== segments.length || shots.some((shot, index) => shot.segmentId !== segments[index]?.segmentId || shot.durationMs !== segments[index]?.durationMs)) fail("VIDEO_ASSEMBLY_STORYBOARD_INVALID", "storyboard-binding", "$.storyboard.shots", "shot identity or duration does not match the script");
  if (new Set(shots.map((shot) => shot.shotId)).size !== shots.length) fail("VIDEO_ASSEMBLY_STORYBOARD_INVALID", "storyboard-binding", "$.storyboard.shots", "shot identities must be unique");
  if (new Set(request.imageResults.map((image) => image.shotId)).size !== request.imageResults.length) fail("VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID", "image-binding", "$.imageResults", "D06 results must contain at most one image per shot");
  if (new Set(materials.map((material) => material.shotId)).size !== materials.length || new Set(materials.map((material) => material.sourceId)).size !== materials.length) fail("VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding", "$.userMaterials", "user materials must have unique shot and source identities");
  if (materials.some((material) => !shots.some((shot) => shot.shotId === material.shotId))) fail("VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding", "$.userMaterials", "contains a material for an unknown shot");
  for (const shot of shots) {
    if (shot.fallbackReason === "source-gap") fail("VIDEO_ASSEMBLY_STORYBOARD_INVALID", "storyboard-binding", `$.storyboard.shots.${shot.shotId}`, "source gaps require D08 and cannot be assembled by D07");
    const material = materialByShot.get(shot.shotId);
    const image = imageByShot.get(shot.shotId);
    if (shot.visualSourcePriority[0] === "user-material") {
      if (!material) fail("VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding", `$.userMaterials.${shot.shotId}`, "D05 selected user-material but no bound reference was supplied");
    } else if (material) {
      fail("VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding", `$.userMaterials.${shot.shotId}`, "a user material is not allowed when D05 did not select user-material");
    } else if (!image) {
      fail("VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID", "image-binding", `$.imageResults.${shot.shotId}`, "every non-user shot needs a bound D06 image result; D07 does not guess a fallback");
    }
    if (material?.mediaType === "video" && material.durationMs !== undefined && material.durationMs < shot.durationMs) fail("VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding", `$.userMaterials.${shot.shotId}.durationMs`, "video material is shorter than its selected shot");
    if (image && image.projectId !== request.projectId) fail("VIDEO_ASSEMBLY_PROJECT_MISMATCH", "image-binding", `$.imageResults.${shot.shotId}.projectId`, "D06 result belongs to another project");
  }
  if (request.imageResults.some((image) => !shots.some((shot) => shot.shotId === image.shotId))) fail("VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID", "image-binding", "$.imageResults", "contains an image for an unknown shot");
  if (request.d04Plan.sourceIds.some((sourceId) => !materials.some((material) => material.sourceId === sourceId))) fail("VIDEO_ASSEMBLY_LAYOUT_INVALID", "layout-binding", "$.d04Plan.sourceIds", "D04 source bindings do not resolve to supplied user materials");
  const timeline = buildTimeline(request, segments, shots, materialByShot, imageByShot);
  try {
    if (!isTimelineProject(timeline)) throw new Error("Timeline IR rejected by C01 validator");
  } catch (error) {
    fail("VIDEO_ASSEMBLY_TIMELINE_INVALID", "timeline-validation", "$.timeline", error instanceof Error ? error.message : "Timeline IR validation failed");
  }
  const timelineDigest = sha256Hex(canonicalJson(timeline));
  const imageCacheKeys = shots.flatMap((shot) => {
    const image = imageByShot.get(shot.shotId);
    return image ? [{ shotId: shot.shotId, cacheKey: image.cacheKey }] : [];
  });
  const result: VideoAssemblyResult = {
    schemaVersion: VIDEO_ASSEMBLY_SCHEMA_VERSION,
    contractVersion: VIDEO_ASSEMBLY_CONTRACT_VERSION,
    runtimeMode: VIDEO_ASSEMBLY_RUNTIME_MODE,
    projectId: request.projectId,
    timelineId: request.timelineId,
    assemblyId: request.assemblyId,
    status: "assembled",
    contentStatus: storyboard.status === "ready" ? "ready" : "needs-user-confirmation",
    durationMs: timeline.durationMs,
    timelineDigest,
    output: { kind: "timeline-ir", relativePath: `generated/video-assembly-v1/${timelineDigest}.json`, durationMs: timeline.durationMs, digest: timelineDigest },
    preview: { availability: "contract-only", compositionId: "timeline-preview-v1", playbackUri: `supervideo://remotion/${request.projectId}/${timelineDigest}`, timelineDigest },
    provenance: { storyboardSourcePlanDigest: storyboard.sourcePlanDigest, ttsCacheKey: request.tts.cacheKey, imageCacheKeys, userMaterialSourceIds: materials.map((item) => item.sourceId) },
    timeline,
  };
  try {
    return validateVideoAssemblyResult(result);
  } catch (error) {
    if (error instanceof VideoAssemblyValidationException) throw error;
    fail("VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation", "$", "assembled result failed validation");
  }
}

function buildTimeline(
  request: VideoAssemblyRequest,
  segments: readonly ScriptStoryboardSegment[],
  shots: Readonly<ScriptStoryboardResult["shots"]>,
  materialByShot: ReadonlyMap<string, VideoAssemblyUserMaterial>,
  imageByShot: ReadonlyMap<string, ImageGenerationResult>,
): TimelineProject {
  const durationMs = request.storyboard.selectedDurationMs;
  const sources: TimelineSource[] = [];
  const provenance: TimelineProvenance[] = [];
  const sourceIds = new Set<string>();
  const provenanceIds = new Set<string>();
  const addProvenance = (item: TimelineProvenance): string => {
    if (!provenanceIds.has(item.id)) { provenanceIds.add(item.id); provenance.push(item); }
    return item.id;
  };
  const addSource = (item: TimelineSource): string => {
    if (!sourceIds.has(item.id)) { sourceIds.add(item.id); sources.push(item); }
    return item.id;
  };
  const d05ById = new Map(request.storyboard.provenance.map((item) => [item.id, item]));
  const d05Ref = (originId: string): string => {
    const id = referenceId("d05", originId);
    const source = d05ById.get(originId);
    addProvenance({ id, kind: source?.kind === "user-brief" ? "user-supplied" : "derived", metadata: { originId, label: source?.label ?? "D05 storyboard provenance", verified: source?.verified ?? false } });
    return id;
  };
  const ttsProvenanceIds = request.tts.sentences.flatMap((sentence) => sentence.provenanceIds.map((id) => addProvenance({ id: referenceId("tts-input", id), kind: "derived", metadata: { originId: id } })));
  const ttsGeneratedId = addProvenance({ id: referenceId("tts-output", request.tts.cacheKey), kind: "generated", sourceId: "source:tts", metadata: { cacheKey: request.tts.cacheKey, adapterVersion: request.tts.adapterVersion } });
  const ttsSourceId = addSource({ id: "source:tts", kind: "generated", uri: `supervideo://generated/tts-${request.tts.cacheKey}`, mediaType: "audio", durationMs, fingerprint: request.tts.output.outputFingerprint, provenanceIds: unique([ttsGeneratedId, ...ttsProvenanceIds]), metadata: { relativePath: request.tts.output.relativePath, cacheKey: request.tts.cacheKey } });
  const d03ProvId = addProvenance({ id: referenceId("d03-plan", `${request.d03Plan.templateVersion}:${request.timelineId}`), kind: "derived", metadata: { contractVersion: request.d03Plan.contractVersion, templateId: request.d03Plan.templateId, templateVersion: request.d03Plan.templateVersion, bundleVersion: request.d03Plan.bundleVersion } });
  const d04PlanRef = referenceId("d04-plan", `${request.d04Plan.projectId}:${request.d04Plan.timelineId}:${request.d04Plan.templateVersion}`);
  const d04ProvIds = request.d04Plan.provenanceIds.map((id) => addProvenance({ id: referenceId("d04-input", id), kind: "derived", metadata: { originId: id, planReference: d04PlanRef } }));
  const layoutProvId = addProvenance({ id: referenceId("d04-plan-output", d04PlanRef), kind: "derived", metadata: { planReference: d04PlanRef, templateId: request.d04Plan.templateId, templateVersion: request.d04Plan.templateVersion } });
  const layoutSourceId = addSource({ id: "source:d04-layout", kind: "generated", uri: `supervideo://generated/layout-${referenceId("layout", d04PlanRef).slice(7)}`, mediaType: "other", durationMs, provenanceIds: unique([layoutProvId, ...d04ProvIds]), metadata: { contractVersion: request.d04Plan.contractVersion, templateId: request.d04Plan.templateId, templateVersion: request.d04Plan.templateVersion } });

  const videoClips: TimelineClip[] = [];
  const subtitleClips: TimelineClip[] = [];
  const overlayClips: TimelineClip[] = [];
  let cursor = 0;
  for (const [index, shot] of shots.entries()) {
    const segment = segments[index]!;
    const segmentProvenance = segment.provenanceIds.map(d05Ref);
    const factIds = segment.factIds.map((id) => referenceId("d05-fact", id));
    for (const factId of segment.factIds) {
      const audit = request.storyboard.facts.find((item) => item.factId === factId);
      addProvenance({ id: referenceId("d05-fact", factId), kind: "derived", metadata: { originId: factId, status: audit?.status ?? "unbound", provenanceIds: audit?.provenanceIds.map(d05Ref) ?? [] } });
    }
    const material = materialByShot.get(shot.shotId);
    const image = imageByShot.get(shot.shotId);
    let selectedSourceId: string;
    let selectedKind: "asset" | "generated";
    let selectedMediaType: "video" | "image";
    const selectedProvenanceIds: string[] = [...segmentProvenance, ...factIds];
    if (material) {
      const materialProv = addProvenance({ id: referenceId("user-material", material.provenanceId), kind: "user-supplied", sourceId: material.sourceId, metadata: { originId: material.provenanceId } });
      selectedProvenanceIds.push(materialProv);
      selectedSourceId = addSource({ id: material.sourceId, kind: "asset", uri: material.uri, mediaType: material.mediaType, ...(material.durationMs === undefined ? {} : { durationMs: material.durationMs }), fingerprint: material.fingerprint, provenanceIds: [materialProv], metadata: { shotId: shot.shotId } });
      selectedKind = "asset";
      selectedMediaType = material.mediaType;
    } else if (image) {
      const imageProvenanceIds = image.provenance.map((item) => addProvenance({ id: referenceId("d06-input", `${item.kind}:${item.id}`), kind: "derived", metadata: { originKind: item.kind, originId: item.id } }));
      const imageOutputProv = addProvenance({ id: referenceId("d06-output", image.cacheKey), kind: "generated", sourceId: `source:image:${shot.shotId}`, metadata: { cacheKey: image.cacheKey, adapterVersion: image.adapterVersion, outputFingerprint: image.output.outputFingerprint } });
      selectedSourceId = addSource({ id: `source:image:${shot.shotId}`, kind: "generated", uri: `supervideo://generated/image-${image.cacheKey}`, mediaType: "image", durationMs: shot.durationMs, fingerprint: image.output.outputFingerprint, provenanceIds: unique([imageOutputProv, ...imageProvenanceIds]), metadata: { shotId: shot.shotId, relativePath: image.output.relativePath, cacheKey: image.cacheKey } });
      selectedKind = "generated";
      selectedMediaType = "image";
      selectedProvenanceIds.push(imageOutputProv, ...imageProvenanceIds);
    } else {
      fail("VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID", "image-binding", `$.imageResults.${shot.shotId}`, "no selected visual source");
    }
    videoClips.push({
      id: `clip:video:${shot.shotId}`, trackId: "track:video", kind: selectedMediaType === "video" ? "video" : "image", sourceId: selectedSourceId,
      timelineStartMs: cursor, durationMs: shot.durationMs,
      ...(selectedMediaType === "video" ? { sourceInMs: 0, sourceOutMs: shot.durationMs } : {}),
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
      sentenceId: segment.sentenceId!, editableInJianying: selectedKind === "asset", provenanceIds: unique(selectedProvenanceIds),
      metadata: { shotId: shot.shotId, segmentId: segment.segmentId, visualSource: selectedKind === "asset" ? "user-material" : "d06-image", visualSourcePriority: [...shot.visualSourcePriority] },
    });
    subtitleClips.push({ id: `clip:subtitle:${segment.segmentId}`, trackId: "track:subtitle", kind: "subtitle", timelineStartMs: cursor, durationMs: segment.durationMs, editableInJianying: true, subtitle: { text: segment.text!, language: "zh-CN", style: { fontFamily: "Microsoft YaHei", fontSize: 56, color: "#FFFFFF", backgroundColor: "#00000099", position: "bottom", maxLines: 2 } }, provenanceIds: unique([...segmentProvenance, ...factIds]), metadata: { segmentId: segment.segmentId, factIds: [...segment.factIds], confirmation: segment.confirmation } });
    overlayClips.push({ id: `clip:overlay:${shot.shotId}`, trackId: "track:overlay", kind: "template", sourceId: layoutSourceId, timelineStartMs: cursor, durationMs: shot.durationMs, sourceInMs: cursor, sourceOutMs: cursor + shot.durationMs, editableInJianying: false, provenanceIds: unique([d03ProvId, layoutProvId, ...segmentProvenance]), metadata: { shotId: shot.shotId, d04TemplateId: request.d04Plan.templateId, d04TemplateVersion: request.d04Plan.templateVersion, d03CompositionId: request.d03Plan.compositionId } });
    cursor += shot.durationMs;
  }
  const audioClip: TimelineClip = { id: "clip:audio:tts", trackId: "track:audio", kind: "audio", sourceId: ttsSourceId, timelineStartMs: 0, durationMs, sourceInMs: 0, sourceOutMs: durationMs, volume: 1, editableInJianying: true, provenanceIds: [ttsGeneratedId], metadata: { cacheKey: request.tts.cacheKey, providerId: request.tts.providerId } };
  const factStatus = request.storyboard.facts.map((item) => ({ factId: item.factId, status: item.status }));
  const tracks: TimelineTrack[] = [
    { id: "track:video", kind: "video", name: "Generated visual assembly", clips: videoClips, metadata: { sourcePolicy: "d05-priority-v1" } },
    { id: "track:audio", kind: "audio", name: "D02 TTS", clips: [audioClip], metadata: { contractVersion: "tts-contract-v1", cacheKey: request.tts.cacheKey } },
    { id: "track:subtitle", kind: "subtitle", name: "D05 subtitles", clips: subtitleClips, metadata: { sourceContract: "script-storyboard-v1" } },
    { id: "track:overlay", kind: "overlay", name: "D04 layout / D03 preview seam", clips: overlayClips, metadata: { d04PlanReference: d04PlanRef, d03Plan: { templateId: request.d03Plan.templateId, templateVersion: request.d03Plan.templateVersion, bundleVersion: request.d03Plan.bundleVersion, runtimeMode: request.d03Plan.runtimeMode }, factStatus, forbiddenInferences: [...request.storyboard.forbiddenInferences] } },
  ];
  return { schemaVersion: 1, id: request.timelineId, canvas: { width: 1080, height: 1920, fps: 30 }, durationMs, tracks, sources, provenance };
}

function bindTts(tts: TtsSynthesisResult, projectId: string, segments: readonly ScriptStoryboardSegment[]): void {
  if (tts.projectId !== projectId) fail("VIDEO_ASSEMBLY_PROJECT_MISMATCH", "tts-binding", "$.tts.projectId", "D02 result belongs to another project");
  if (tts.durationMs !== segments.reduce((sum, segment) => sum + segment.durationMs, 0) || tts.sentences.length !== segments.length) fail("VIDEO_ASSEMBLY_TTS_BINDING_INVALID", "tts-binding", "$.tts", "D02 duration or sentence count does not match D05");
  tts.sentences.forEach((sentence, index) => {
    const segment = segments[index]!;
    if (sentence.sentenceId !== segment.sentenceId || sentence.text !== segment.text || sentence.startMs !== segments.slice(0, index).reduce((sum, item) => sum + item.durationMs, 0) || sentence.endMs - sentence.startMs !== segment.durationMs) fail("VIDEO_ASSEMBLY_TTS_BINDING_INVALID", "tts-binding", `$.tts.sentences[${index}]`, "D02 sentence identity, text, or complete-sentence duration does not match D05");
  });
}

function validateRemotionPlan(value: unknown, path: string): asserts value is VideoAssemblyRemotionPlan {
  const plan = record(value, path, "VIDEO_ASSEMBLY_PLAN_INVALID", "plan-binding");
  exactKeys(plan, ["contractVersion", "renderVersion", "runtimeMode", "templateId", "templateVersion", "bundleVersion", "compositionId"], path, "VIDEO_ASSEMBLY_PLAN_INVALID", "plan-binding");
  if (plan.contractVersion !== REMOTION_CONTRACT_VERSION || plan.renderVersion !== REMOTION_RENDER_VERSION || plan.runtimeMode !== REMOTION_RUNTIME_MODE || plan.templateId !== REMOTION_TEMPLATE_ID || plan.templateVersion !== REMOTION_TEMPLATE_VERSION || plan.bundleVersion !== REMOTION_BUNDLE_VERSION || plan.compositionId !== "timeline-preview-v1") fail("VIDEO_ASSEMBLY_PLAN_INVALID", "plan-binding", path, "does not match the fixed D03 offline plan");
}

function validateUserMaterial(value: unknown, path: string): asserts value is VideoAssemblyUserMaterial {
  const material = record(value, path, "VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding");
  exactKeys(material, ["sourceId", "shotId", "uri", "mediaType", "durationMs", "fingerprint", "provenanceId"], path, "VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding");
  checkId(material.sourceId, `${path}.sourceId`, "VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding");
  checkId(material.shotId, `${path}.shotId`, "VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding");
  if (typeof material.uri !== "string" || !VIDEO_ASSEMBLY_USER_URI_PATTERN.test(material.uri) || material.uri !== `supervideo://asset/${material.sourceId}`) fail("VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding", `${path}.uri`, "must be the controlled project asset reference for sourceId");
  if (material.mediaType !== "video" && material.mediaType !== "image") fail("VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding", `${path}.mediaType`, "must be video or image");
  if (material.durationMs !== undefined) checkInteger(material.durationMs, 1, VIDEO_ASSEMBLY_MAX_DURATION_MS, `${path}.durationMs`, "VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding");
  if (material.mediaType === "video" && material.durationMs === undefined) fail("VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding", `${path}.durationMs`, "video references require a declared duration");
  checkSha256(material.fingerprint, `${path}.fingerprint`, "VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding");
  checkId(material.provenanceId, `${path}.provenanceId`, "VIDEO_ASSEMBLY_MATERIAL_INVALID", "material-binding");
}

function validateProvenanceSummary(value: unknown): asserts value is VideoAssemblyProvenanceSummary {
  const item = record(value, "$.provenance", "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation");
  exactKeys(item, ["storyboardSourcePlanDigest", "ttsCacheKey", "imageCacheKeys", "userMaterialSourceIds"], "$.provenance", "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation");
  checkSha256(item.storyboardSourcePlanDigest, "$.provenance.storyboardSourcePlanDigest", "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation");
  checkSha256(item.ttsCacheKey, "$.provenance.ttsCacheKey", "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation");
  if (!Array.isArray(item.imageCacheKeys) || item.imageCacheKeys.length > VIDEO_ASSEMBLY_MAX_SHOTS) fail("VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation", "$.provenance.imageCacheKeys", "is not a bounded array");
  item.imageCacheKeys.forEach((raw, index) => { const entry = record(raw, `$.provenance.imageCacheKeys[${index}]`, "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation"); exactKeys(entry, ["shotId", "cacheKey"], `$.provenance.imageCacheKeys[${index}]`, "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation"); checkId(entry.shotId, `$.provenance.imageCacheKeys[${index}].shotId`, "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation"); checkSha256(entry.cacheKey, `$.provenance.imageCacheKeys[${index}].cacheKey`, "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation"); });
  if (!Array.isArray(item.userMaterialSourceIds) || item.userMaterialSourceIds.length > VIDEO_ASSEMBLY_MAX_MATERIALS || new Set(item.userMaterialSourceIds).size !== item.userMaterialSourceIds.length) fail("VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation", "$.provenance.userMaterialSourceIds", "is not a bounded unique array");
  item.userMaterialSourceIds.forEach((id, index) => checkId(id, `$.provenance.userMaterialSourceIds[${index}]`, "VIDEO_ASSEMBLY_RESULT_INVALID", "result-validation"));
}

function referenceId(namespace: string, value: string): string { return `${namespace}:${sha256Hex(value).slice(0, 32)}`; }
function unique(items: readonly string[]): string[] { return [...new Set(items)]; }
function checkUuid(value: unknown, path: string, code: VideoAssemblyErrorCode, stage: VideoAssemblyStage): void { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) fail(code, stage, path, "must be a UUID"); }
function checkId(value: unknown, path: string, code: VideoAssemblyErrorCode, stage: VideoAssemblyStage): void { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) fail(code, stage, path, "must be a bounded identifier"); }
function checkSha256(value: unknown, path: string, code: VideoAssemblyErrorCode, stage: VideoAssemblyStage): void { if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(code, stage, path, "must be a lowercase SHA-256 digest"); }
function checkInteger(value: unknown, minimum: number, maximum: number, path: string, code: VideoAssemblyErrorCode, stage: VideoAssemblyStage): void { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code, stage, path, `must be an integer between ${minimum} and ${maximum}`); }
function record(value: unknown, path: string, code: VideoAssemblyErrorCode, stage: VideoAssemblyStage): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code, stage, path, "must be a plain object"); return value as Record<string, any>; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string, code: VideoAssemblyErrorCode, stage: VideoAssemblyStage): void { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code, stage, `${path}.${key}`, "unknown key is not allowed"); }
function fail(code: VideoAssemblyErrorCode, stage: VideoAssemblyStage, path: string, message: string): never { throw new VideoAssemblyValidationException({ code, stage, path, message }); }
function boundedJson(value: unknown, maximum: number): boolean { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maximum; } catch { return false; } }
function rejectForbidden(value: unknown, path: string, seen: Set<unknown>): void { if (seen.has(value)) fail("VIDEO_ASSEMBLY_INPUT_INVALID", "input", path, "cyclic input is not allowed"); if (value && typeof value === "object") { seen.add(value); if (Array.isArray(value)) value.forEach((item, index) => rejectForbidden(item, `${path}[${index}]`, seen)); else Object.entries(value).forEach(([key, item]) => { const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, ""); if (["secret", "credential", "credentialref", "token", "command", "executable", "authorization", "password", "apikey", "provider"].includes(normalized)) fail("VIDEO_ASSEMBLY_INPUT_INVALID", "input", `${path}.${key}`, "forbidden secret, provider, or executable field"); rejectForbidden(item, `${path}.${key}`, seen); }); seen.delete(value); } }

/** Canonical JSON is shared with the Python Core for stable SHA-256 digests. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw new TypeError("value is not JSON serializable");
}

/** Small dependency-free SHA-256 implementation for the shared package. */
export function sha256Hex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const constants = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const words = new Int32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getInt32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const u = words[index - 2]!;
      const sigma1 = rotr(u, 17) ^ rotr(u, 19) ^ (u >>> 10);
      const v = words[index - 15]!;
      const sigma0 = rotr(v, 7) ^ rotr(v, 18) ^ (v >>> 3);
      words[index] = ((sigma1 + words[index - 7]!) | 0) + ((sigma0 + words[index - 16]!) | 0);
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index++) {
      const sigma1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const choose = (e! & f!) ^ (~e! & g!);
      const temp1 = (((sigma1 + choose) | 0) + ((h! + ((constants[index]! + words[index]!) | 0)) | 0)) | 0;
      const sigma0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (sigma0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    state[0] = state[0]! + a!;
    state[1] = state[1]! + b!;
    state[2] = state[2]! + c!;
    state[3] = state[3]! + d!;
    state[4] = state[4]! + e!;
    state[5] = state[5]! + f!;
    state[6] = state[6]! + g!;
    state[7] = state[7]! + h!;
  }

  return Array.from(state, (word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}
