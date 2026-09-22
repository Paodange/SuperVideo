/** D08 deterministic generation-failure fallback contract. */

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
  REMOTION_RENDER_VERSION,
  REMOTION_RUNTIME_MODE,
  REMOTION_TEMPLATE_ID,
  REMOTION_TEMPLATE_VERSION,
} from "./remotion-contract";
import {
  isScriptStoryboardResult,
  type ScriptStoryboardResult,
  type ScriptStoryboardShot,
} from "./script-storyboard-contract";
import {
  isVideoAssemblyRequest,
  type VideoAssemblyRequest,
  type VideoAssemblyUserMaterial,
  canonicalJson,
  sha256Hex,
} from "./video-assembly-contract";
import { isTtsSynthesisResult, type TtsSynthesisResult } from "./tts-contract";

export const GENERATION_FALLBACK_SCHEMA_VERSION = 1 as const;
export const GENERATION_FALLBACK_CONTRACT_VERSION = "generation-fallback-v1" as const;
export const GENERATION_FALLBACK_POLICY_VERSION = "deterministic-generation-fallback-v1" as const;
export const GENERATION_FALLBACK_RUNTIME_MODE = "offline-deterministic" as const;
export const GENERATION_FALLBACK_MAX_SHOTS = 32;
export const GENERATION_FALLBACK_MAX_FAILURES = 64;
export const GENERATION_FALLBACK_MAX_RESULT_BYTES = 768 * 1024;

export const GENERATION_FALLBACK_FAILURE_CODES = [
  "PROVIDER_UNAVAILABLE",
  "GENERATION_FAILED",
  "OUTPUT_INVALID",
  "TIMEOUT",
  "CANCELLED",
] as const;
export type GenerationFallbackFailureCode = (typeof GENERATION_FALLBACK_FAILURE_CODES)[number];
export type GenerationFallbackFailureStage = "tts" | "image" | "animation";
export type GenerationFallbackComponent = GenerationFallbackFailureStage;

export const GENERATION_FALLBACK_VISUAL_SOURCES = [
  "user-material",
  "licensed-stock",
  "ai-image",
  "remotion-template",
  "text-card",
] as const;
export type GenerationFallbackVisualSource = (typeof GENERATION_FALLBACK_VISUAL_SOURCES)[number];

export type GenerationFallbackFailure = Readonly<{
  projectId: string;
  component: GenerationFallbackComponent;
  stage: GenerationFallbackFailureStage;
  shotId: string | null;
  code: GenerationFallbackFailureCode;
  retryable: boolean;
}>;

export type GenerationFallbackDiagnosticCode =
  | "FALLBACK_SOURCE_UNAVAILABLE"
  | "FALLBACK_SOURCE_GAP"
  | "FALLBACK_CANDIDATES_EXHAUSTED"
  | "FALLBACK_D07_SOURCE_UNSUPPORTED"
  | "FALLBACK_TTS_AUDIO_UNAVAILABLE"
  | "FALLBACK_D07_INPUT_INVALID";
export type GenerationFallbackDiagnosticStage = "selection" | "storyboard" | "d07-binding" | "tts";
export type GenerationFallbackDiagnostic = Readonly<{
  code: GenerationFallbackDiagnosticCode;
  stage: GenerationFallbackDiagnosticStage;
}>;

export type GenerationFallbackRequest = Readonly<{
  schemaVersion: typeof GENERATION_FALLBACK_SCHEMA_VERSION;
  contractVersion: typeof GENERATION_FALLBACK_CONTRACT_VERSION;
  policyVersion: typeof GENERATION_FALLBACK_POLICY_VERSION;
  runtimeMode: typeof GENERATION_FALLBACK_RUNTIME_MODE;
  projectId: string;
  timelineId: string;
  assemblyId: string;
  storyboard: ScriptStoryboardResult;
  tts: TtsSynthesisResult | null;
  ttsFailure: GenerationFallbackFailure | null;
  imageResults: readonly ImageGenerationResult[];
  imageFailures: readonly GenerationFallbackFailure[];
  animationFailures: readonly GenerationFallbackFailure[];
  textCardUnavailableShotIds: readonly string[];
  d04Plan: RecruitmentTemplateRenderPlan;
  d03Plan: GenerationFallbackRemotionPlan;
  userMaterials: readonly VideoAssemblyUserMaterial[];
}>;

export type GenerationFallbackRemotionPlan = Readonly<{
  contractVersion: typeof REMOTION_CONTRACT_VERSION;
  renderVersion: typeof REMOTION_RENDER_VERSION;
  runtimeMode: typeof REMOTION_RUNTIME_MODE;
  templateId: typeof REMOTION_TEMPLATE_ID;
  templateVersion: typeof REMOTION_TEMPLATE_VERSION;
  bundleVersion: typeof REMOTION_BUNDLE_VERSION;
  compositionId: "timeline-preview-v1";
}>;

export type GenerationFallbackAttempt = Readonly<{
  source: GenerationFallbackVisualSource;
  outcome: "selected" | "failed" | "unavailable";
  error: GenerationFallbackFailure | GenerationFallbackDiagnostic | null;
  provenance: readonly string[];
}>;

export type GenerationFallbackShot = Readonly<{
  shotId: string;
  order: number;
  segmentId: string;
  status: "resolved" | "unresolved";
  chosenSource: GenerationFallbackVisualSource | null;
  fallbackReason: "none" | "generation-failed" | "source-unavailable" | "source-gap" | "candidates-exhausted";
  d05FallbackReason: "planned" | "no-user-material" | "source-gap";
  d07Binding: "user-material" | "d06-image" | null;
  attempts: readonly GenerationFallbackAttempt[];
  provenance: readonly string[];
  diagnostic: GenerationFallbackDiagnostic | null;
}>;

export type GenerationFallbackTts = Readonly<{
  status: "available" | "fallback";
  chosenSource: "d02-tts" | "silence-placeholder";
  fallbackReason: "none" | "generation-failed";
  d07Binding: "d02-tts" | null;
  failure: GenerationFallbackFailure | null;
  provenance: readonly string[];
  diagnostic: GenerationFallbackDiagnostic | null;
}>;

export type GenerationFallbackResult = Readonly<{
  schemaVersion: typeof GENERATION_FALLBACK_SCHEMA_VERSION;
  contractVersion: typeof GENERATION_FALLBACK_CONTRACT_VERSION;
  policyVersion: typeof GENERATION_FALLBACK_POLICY_VERSION;
  runtimeMode: typeof GENERATION_FALLBACK_RUNTIME_MODE;
  projectId: string;
  timelineId: string;
  assemblyId: string;
  status: "ready" | "partial" | "blocked";
  d07Eligible: boolean;
  inputDigest: string;
  resultDigest: string;
  storyboard: ScriptStoryboardResult;
  resolvedStoryboard: ScriptStoryboardResult;
  tts: GenerationFallbackTts;
  shots: readonly GenerationFallbackShot[];
  d07Diagnostic: GenerationFallbackDiagnostic | null;
  videoAssemblyRequest: VideoAssemblyRequest | null;
}>;

export type GenerationFallbackErrorCode =
  | "GENERATION_FALLBACK_INPUT_INVALID"
  | "GENERATION_FALLBACK_PROJECT_MISMATCH"
  | "GENERATION_FALLBACK_FAILURE_INVALID"
  | "GENERATION_FALLBACK_CANDIDATE_INVALID"
  | "GENERATION_FALLBACK_RESULT_INVALID";
export type GenerationFallbackErrorStage = "input" | "project-binding" | "failure-binding" | "candidate-binding" | "result";
export type GenerationFallbackValidationError = Readonly<{
  code: GenerationFallbackErrorCode;
  stage: GenerationFallbackErrorStage;
  path: string;
  message: string;
}>;

export class GenerationFallbackValidationException extends Error {
  readonly error: GenerationFallbackValidationError;

  constructor(error: GenerationFallbackValidationError) {
    super(`${error.code} at ${error.path}: ${error.message}`);
    this.name = "GenerationFallbackValidationException";
    this.error = error;
  }
}

export function isGenerationFallbackRequest(value: unknown): value is GenerationFallbackRequest {
  try {
    validateGenerationFallbackRequest(value);
    return true;
  } catch {
    return false;
  }
}

export function isGenerationFallbackResult(value: unknown): value is GenerationFallbackResult {
  try {
    validateGenerationFallbackResult(value);
    return true;
  } catch {
    return false;
  }
}

export function validateGenerationFallbackRequest(value: unknown): GenerationFallbackRequest {
  const input = record(value, "GENERATION_FALLBACK_INPUT_INVALID", "input", "$");
  exactKeys(input, ["schemaVersion", "contractVersion", "policyVersion", "runtimeMode", "projectId", "timelineId", "assemblyId", "storyboard", "tts", "ttsFailure", "imageResults", "imageFailures", "animationFailures", "textCardUnavailableShotIds", "d04Plan", "d03Plan", "userMaterials"], "GENERATION_FALLBACK_INPUT_INVALID", "input", "$");
  if (input.schemaVersion !== GENERATION_FALLBACK_SCHEMA_VERSION || input.contractVersion !== GENERATION_FALLBACK_CONTRACT_VERSION || input.policyVersion !== GENERATION_FALLBACK_POLICY_VERSION || input.runtimeMode !== GENERATION_FALLBACK_RUNTIME_MODE) fail("GENERATION_FALLBACK_INPUT_INVALID", "input", "$.schemaVersion", "has an invalid D08 version or runtime mode");
  checkUuid(input.projectId, "$.projectId", "GENERATION_FALLBACK_INPUT_INVALID", "input");
  checkId(input.timelineId, "$.timelineId", "GENERATION_FALLBACK_INPUT_INVALID", "input");
  checkId(input.assemblyId, "$.assemblyId", "GENERATION_FALLBACK_INPUT_INVALID", "input");
  if (!isScriptStoryboardResult(input.storyboard)) fail("GENERATION_FALLBACK_INPUT_INVALID", "input", "$.storyboard", "must be a valid D05 result");
  if (!isRecruitmentTemplateRenderPlan(input.d04Plan)) fail("GENERATION_FALLBACK_INPUT_INVALID", "input", "$.d04Plan", "must be a valid D04 render plan");
  validateRemotionPlan(input.d03Plan, "$.d03Plan");
  validateTtsBinding(input, "$");
  const shots = getShots(input.storyboard as ScriptStoryboardResult);
  const shotIds = new Set(shots.map((shot) => shot.shotId));
  const imageResults = validateImageResults(input.imageResults, shotIds);
  const imageFailures = validateFailures(input.imageFailures, "$.imageFailures", input.projectId as string, shotIds, "image");
  const animationFailures = validateFailures(input.animationFailures, "$.animationFailures", input.projectId as string, shotIds, "animation");
  const textCardUnavailableShotIds = input.textCardUnavailableShotIds;
  if (!Array.isArray(textCardUnavailableShotIds) || textCardUnavailableShotIds.length > GENERATION_FALLBACK_MAX_SHOTS || new Set(textCardUnavailableShotIds).size !== textCardUnavailableShotIds.length || textCardUnavailableShotIds.some((shotId) => !isId(shotId) || !shotIds.has(shotId))) fail("GENERATION_FALLBACK_CANDIDATE_INVALID", "candidate-binding", "$.textCardUnavailableShotIds", "must contain unique known shot identifiers");
  validateFailures(input.ttsFailure === null ? [] : [input.ttsFailure], "$.ttsFailure", input.projectId as string, new Set(), "tts");
  if (input.ttsFailure !== null && input.tts !== null) fail("GENERATION_FALLBACK_FAILURE_INVALID", "failure-binding", "$.ttsFailure", "TTS success and failure cannot be supplied together");
  if (input.ttsFailure === null && input.tts === null) fail("GENERATION_FALLBACK_FAILURE_INVALID", "failure-binding", "$.tts", "one of TTS result or TTS failure is required");
  if (imageResults.some((item) => imageFailures.some((failure) => failure.shotId === item.shotId))) fail("GENERATION_FALLBACK_FAILURE_INVALID", "failure-binding", "$.imageFailures", "an image cannot be both successful and failed");
  if (animationFailures.some((failure, index) => animationFailures.findIndex((item) => item.shotId === failure.shotId) !== index)) fail("GENERATION_FALLBACK_FAILURE_INVALID", "failure-binding", "$.animationFailures", "animation failures must be unique per shot");
  const materials = validateMaterials(input.userMaterials, shotIds);
  if (input.projectId !== (input.storyboard as ScriptStoryboardResult).projectId || input.projectId !== (input.d04Plan as RecruitmentTemplateRenderPlan).projectId || (input.tts !== null && input.tts.projectId !== input.projectId) || imageResults.some((item) => item.projectId !== input.projectId)) fail("GENERATION_FALLBACK_PROJECT_MISMATCH", "project-binding", "$.projectId", "D02/D04/D05/D06 objects must belong to the requested project");
  if (materials.some((material) => !shots.find((shot) => shot.shotId === material.shotId)?.visualSourcePriority.includes("user-material") || shots.find((shot) => shot.shotId === material.shotId)?.visualSourcePriority[0] !== "user-material")) fail("GENERATION_FALLBACK_CANDIDATE_INVALID", "candidate-binding", "$.userMaterials", "user material is only allowed for a D05 user-material priority shot");
  if (new Set(imageResults.map((item) => item.shotId)).size !== imageResults.length) fail("GENERATION_FALLBACK_CANDIDATE_INVALID", "candidate-binding", "$.imageResults", "D06 results must be unique per shot");
  rejectForbidden(input, "$", new Set());
  if (!boundedJson(input, GENERATION_FALLBACK_MAX_RESULT_BYTES)) fail("GENERATION_FALLBACK_INPUT_INVALID", "input", "$", "exceeds the D08 input size limit");
  return input as GenerationFallbackRequest;
}

export function validateGenerationFallbackResult(value: unknown): GenerationFallbackResult {
  const result = record(value, "GENERATION_FALLBACK_RESULT_INVALID", "result", "$");
  exactKeys(result, ["schemaVersion", "contractVersion", "policyVersion", "runtimeMode", "projectId", "timelineId", "assemblyId", "status", "d07Eligible", "inputDigest", "resultDigest", "storyboard", "resolvedStoryboard", "tts", "shots", "d07Diagnostic", "videoAssemblyRequest"], "GENERATION_FALLBACK_RESULT_INVALID", "result", "$");
  if (result.schemaVersion !== GENERATION_FALLBACK_SCHEMA_VERSION || result.contractVersion !== GENERATION_FALLBACK_CONTRACT_VERSION || result.policyVersion !== GENERATION_FALLBACK_POLICY_VERSION || result.runtimeMode !== GENERATION_FALLBACK_RUNTIME_MODE) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$", "has an invalid D08 version or runtime mode");
  checkUuid(result.projectId, "$.projectId", "GENERATION_FALLBACK_RESULT_INVALID", "result");
  checkId(result.timelineId, "$.timelineId", "GENERATION_FALLBACK_RESULT_INVALID", "result");
  checkId(result.assemblyId, "$.assemblyId", "GENERATION_FALLBACK_RESULT_INVALID", "result");
  if (!["ready", "partial", "blocked"].includes(String(result.status))) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.status", "is not allowed");
  if (typeof result.d07Eligible !== "boolean") fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.d07Eligible", "must be boolean");
  checkSha256(result.inputDigest, "$.inputDigest", "GENERATION_FALLBACK_RESULT_INVALID", "result");
  checkSha256(result.resultDigest, "$.resultDigest", "GENERATION_FALLBACK_RESULT_INVALID", "result");
  if (!isScriptStoryboardResult(result.storyboard) || !isScriptStoryboardResult(result.resolvedStoryboard)) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.storyboard", "must contain valid D05 storyboards");
  if (result.storyboard.projectId !== result.projectId || result.resolvedStoryboard.projectId !== result.projectId) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.storyboard.projectId", "must match the D08 project");
  const shots = getShots(result.storyboard as ScriptStoryboardResult);
  const resolvedShots = getShots(result.resolvedStoryboard as ScriptStoryboardResult);
  if (!Array.isArray(result.shots) || result.shots.length !== shots.length) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.shots", "must map one-to-one to D05 shots");
  validateTtsResolution(result.tts, result.projectId as string);
  const tts = result.tts as GenerationFallbackTts;
  const shotResults = result.shots as GenerationFallbackShot[];
  shotResults.forEach((item: unknown, index: number) => validateResolvedShot(item, `$.shots[${index}]`, shots[index]!, resolvedShots[index]!));
  if (result.d07Diagnostic !== null) validateDiagnostic(result.d07Diagnostic, "$.d07Diagnostic");
  if (result.videoAssemblyRequest !== null) {
    if (!isVideoAssemblyRequest(result.videoAssemblyRequest)) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.videoAssemblyRequest", "must be a valid D07 request");
    if (result.videoAssemblyRequest.projectId !== result.projectId || JSON.stringify(result.videoAssemblyRequest.storyboard) !== JSON.stringify(result.resolvedStoryboard)) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.videoAssemblyRequest", "must bind to the resolved D05 project");
  }
  if (result.d07Eligible !== (result.videoAssemblyRequest !== null)) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.d07Eligible", "must match D07 request availability");
  const expectedStatus = result.d07Eligible || result.videoAssemblyRequest !== null
    ? "ready"
    : tts.status === "fallback" || shotResults.some((item) => item.status === "unresolved")
      ? "blocked"
      : "partial";
  if (result.status !== expectedStatus) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.status", "does not match D07 eligibility and fallback outcomes");
  const digest = fallbackResultDigest(result as GenerationFallbackResult);
  if (digest !== result.resultDigest) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.resultDigest", "does not match the deterministic D08 result digest");
  rejectForbidden(result, "$", new Set());
  if (!boundedJson(result, GENERATION_FALLBACK_MAX_RESULT_BYTES)) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$", "exceeds the D08 result size limit");
  return result as GenerationFallbackResult;
}

export function resolveGenerationFallback(value: unknown): GenerationFallbackResult {
  const request = validateGenerationFallbackRequest(value);
  const sourceStoryboard = request.storyboard;
  const sourceShots = getShots(sourceStoryboard);
  const images = new Map(request.imageResults.map((item) => [item.shotId, item]));
  const materials = new Map(request.userMaterials.map((item) => [item.shotId, item]));
  const imageFailures = new Map(request.imageFailures.map((item) => [item.shotId!, item]));
  const animationFailures = new Map(request.animationFailures.map((item) => [item.shotId!, item]));
  const textCardUnavailable = new Set(request.textCardUnavailableShotIds);
  const resolvedShots: ScriptStoryboardShot[] = [];
  const resolutions: GenerationFallbackShot[] = [];

  for (const shot of sourceShots) {
    const segment = findSegment(sourceStoryboard, shot.segmentId);
    if (segment.status === "gap") {
      const attempts = shot.visualSourcePriority.map((source) => ({ source, outcome: "unavailable" as const, error: { code: "FALLBACK_SOURCE_GAP" as const, stage: "storyboard" as const }, provenance: [] }));
      resolutions.push({ shotId: shot.shotId, order: shot.order, segmentId: shot.segmentId, status: "unresolved", chosenSource: null, fallbackReason: "source-gap", d05FallbackReason: shot.fallbackReason, d07Binding: null, attempts, provenance: ["d08:policy:generation-fallback-v1"], diagnostic: { code: "FALLBACK_SOURCE_GAP", stage: "storyboard" } });
      resolvedShots.push({ ...shot });
      continue;
    }
    const attempts: GenerationFallbackAttempt[] = [];
    let selected: GenerationFallbackVisualSource | null = null;
    let selectedProvenance: string[] = [];
    let sawFailure = false;
    for (const source of shot.visualSourcePriority) {
      const candidate = candidateFor(source, shot, segment.segmentId, images, materials, imageFailures, animationFailures, textCardUnavailable, request.d04Plan);
      attempts.push(candidate.attempt);
      if (candidate.available) {
        selected = source;
        selectedProvenance = candidate.provenance;
        attempts[attempts.length - 1] = { ...candidate.attempt, outcome: "selected", error: null, provenance: candidate.provenance };
        break;
      }
      if (candidate.attempt.outcome === "failed") sawFailure = true;
    }
    const d07Binding = selected === "user-material" ? "user-material" : selected === "ai-image" ? "d06-image" : null;
    const diagnostic = selected === null
      ? { code: "FALLBACK_CANDIDATES_EXHAUSTED" as const, stage: "selection" as const }
      : d07Binding === null
        ? { code: "FALLBACK_D07_SOURCE_UNSUPPORTED" as const, stage: "d07-binding" as const }
        : null;
    const status = selected === null ? "unresolved" as const : "resolved" as const;
    const fallbackReason = selected === null ? "candidates-exhausted" as const : attempts[0]?.outcome === "selected" ? "none" as const : sawFailure ? "generation-failed" as const : "source-unavailable" as const;
    resolutions.push({ shotId: shot.shotId, order: shot.order, segmentId: shot.segmentId, status, chosenSource: selected, fallbackReason, d05FallbackReason: shot.fallbackReason, d07Binding, attempts, provenance: selectedProvenance.length > 0 ? selectedProvenance : ["d08:policy:generation-fallback-v1"], diagnostic });
    resolvedShots.push({ ...shot, ...(selected !== "user-material" && shot.fallbackReason === "planned" ? { fallbackReason: "no-user-material", visualSourcePriority: ["licensed-stock", "ai-image", "remotion-template", "text-card"] as const } : {}) });
  }

  const resolvedStoryboard = { ...sourceStoryboard, shots: resolvedShots } as ScriptStoryboardResult;
  const tts = resolveTts(request);
  const d07Candidate = tts.d07Binding !== null && resolutions.every((item) => item.status === "resolved" && item.d07Binding !== null) && resolvedStoryboard.status !== "gaps" && resolvedStoryboard.durationStatus === "within-tolerance" && getSegments(resolvedStoryboard).every((segment) => segment.status === "matched" && segment.durationMs > 0)
    ? buildD07Request(request, resolvedStoryboard, resolutions)
    : null;
  const d07Diagnostic = d07Candidate === null ? firstD07Diagnostic(tts, resolutions) : null;
  const status = d07Candidate !== null ? "ready" as const : resolutions.some((item) => item.status === "unresolved") || tts.status === "fallback" ? "blocked" as const : "partial" as const;
  const d07Eligible = d07Candidate !== null;
  const inputDigestValue = sha256Hex(canonicalJson(inputDigest(request)));
  const digestSeed = { schemaVersion: GENERATION_FALLBACK_SCHEMA_VERSION, contractVersion: GENERATION_FALLBACK_CONTRACT_VERSION, policyVersion: GENERATION_FALLBACK_POLICY_VERSION, projectId: request.projectId, timelineId: request.timelineId, assemblyId: request.assemblyId, status, d07Eligible, inputDigest: inputDigestValue, storyboardDigest: sourceStoryboard.sourcePlanDigest, tts: ttsDigest(tts), shots: resolutions.map(shotDigest), d07Diagnostic, resolvedStoryboard, videoAssemblyRequest: d07Candidate };
  const result: GenerationFallbackResult = { schemaVersion: GENERATION_FALLBACK_SCHEMA_VERSION, contractVersion: GENERATION_FALLBACK_CONTRACT_VERSION, policyVersion: GENERATION_FALLBACK_POLICY_VERSION, runtimeMode: GENERATION_FALLBACK_RUNTIME_MODE, projectId: request.projectId, timelineId: request.timelineId, assemblyId: request.assemblyId, status, d07Eligible, inputDigest: inputDigestValue, resultDigest: sha256Hex(canonicalJson(digestSeed)), storyboard: sourceStoryboard, resolvedStoryboard, tts, shots: resolutions, d07Diagnostic, videoAssemblyRequest: d07Candidate };
  return validateGenerationFallbackResult(result);
}

function resolveTts(request: GenerationFallbackRequest): GenerationFallbackTts {
  if (request.tts !== null) return { status: "available", chosenSource: "d02-tts", fallbackReason: "none", d07Binding: "d02-tts", failure: null, provenance: ["d08:policy:generation-fallback-v1", `d02:tts:${request.tts.cacheKey}`], diagnostic: null };
  return { status: "fallback", chosenSource: "silence-placeholder", fallbackReason: "generation-failed", d07Binding: null, failure: request.ttsFailure, provenance: ["d08:policy:generation-fallback-v1"], diagnostic: { code: "FALLBACK_TTS_AUDIO_UNAVAILABLE", stage: "tts" } };
}

function candidateFor(source: GenerationFallbackVisualSource, shot: ScriptStoryboardShot, segmentId: string, images: ReadonlyMap<string, ImageGenerationResult>, materials: ReadonlyMap<string, VideoAssemblyUserMaterial>, imageFailures: ReadonlyMap<string, GenerationFallbackFailure>, animationFailures: ReadonlyMap<string, GenerationFallbackFailure>, textCardUnavailable: ReadonlySet<string>, d04Plan: RecruitmentTemplateRenderPlan): { available: boolean; provenance: string[]; attempt: GenerationFallbackAttempt } {
  if (source === "user-material") {
    const material = materials.get(shot.shotId);
    return material ? { available: true, provenance: ["d08:policy:generation-fallback-v1", `user-material:${material.provenanceId}`], attempt: { source, outcome: "selected", error: null, provenance: [] } } : unavailable(source);
  }
  if (source === "licensed-stock") return unavailable(source);
  if (source === "ai-image") {
    const failure = imageFailures.get(shot.shotId);
    const image = images.get(shot.shotId);
    if (failure) return { available: false, provenance: [], attempt: { source, outcome: "failed", error: failure, provenance: [] } };
    return image ? { available: true, provenance: ["d08:policy:generation-fallback-v1", `d06:image:${image.cacheKey}`], attempt: { source, outcome: "selected", error: null, provenance: [] } } : unavailable(source);
  }
  if (source === "remotion-template") {
    const failure = animationFailures.get(shot.shotId);
    if (failure) return { available: false, provenance: [], attempt: { source, outcome: "failed", error: failure, provenance: [] } };
    return { available: true, provenance: ["d08:policy:generation-fallback-v1", `d04:template:${d04Plan.templateVersion}`], attempt: { source, outcome: "selected", error: null, provenance: [] } };
  }
  return segmentId.length > 0 && !textCardUnavailable.has(shot.shotId) ? { available: true, provenance: ["d08:policy:generation-fallback-v1", `text-card:${segmentId}`], attempt: { source, outcome: "selected", error: null, provenance: [] } } : unavailable(source);
}

function unavailable(source: GenerationFallbackVisualSource): { available: false; provenance: string[]; attempt: GenerationFallbackAttempt } { return { available: false, provenance: [], attempt: { source, outcome: "unavailable", error: { code: "FALLBACK_SOURCE_UNAVAILABLE", stage: "selection" }, provenance: [] } }; }

function buildD07Request(request: GenerationFallbackRequest, storyboard: ScriptStoryboardResult, shots: readonly GenerationFallbackShot[]): VideoAssemblyRequest | null {
  const selectedShotIds = new Set(shots.filter((shot) => shot.d07Binding === "d06-image").map((shot) => shot.shotId));
  const selectedImages = request.imageResults.filter((image) => selectedShotIds.has(image.shotId));
  const selectedMaterials = request.userMaterials.filter((material) => shots.some((shot) => shot.d07Binding === "user-material" && shot.shotId === material.shotId));
  const candidate = { schemaVersion: 1, contractVersion: "video-assembly-v1", runtimeMode: "offline-deterministic", projectId: request.projectId, timelineId: request.timelineId, assemblyId: request.assemblyId, storyboard, tts: request.tts, imageResults: selectedImages, d04Plan: request.d04Plan, d03Plan: request.d03Plan, userMaterials: selectedMaterials };
  return isVideoAssemblyRequest(candidate) ? candidate : null;
}

function firstD07Diagnostic(tts: GenerationFallbackTts, shots: readonly GenerationFallbackShot[]): GenerationFallbackDiagnostic { if (tts.diagnostic) return tts.diagnostic; return shots.find((shot) => shot.diagnostic)?.diagnostic ?? { code: "FALLBACK_D07_INPUT_INVALID", stage: "d07-binding" }; }

function validateResolvedShot(value: unknown, path: string, source: ScriptStoryboardShot, resolved: ScriptStoryboardShot): void {
  const item = record(value, "GENERATION_FALLBACK_RESULT_INVALID", "result", path);
  exactKeys(item, ["shotId", "order", "segmentId", "status", "chosenSource", "fallbackReason", "d05FallbackReason", "d07Binding", "attempts", "provenance", "diagnostic"], "GENERATION_FALLBACK_RESULT_INVALID", "result", path);
  if (item.shotId !== source.shotId || item.order !== source.order || item.segmentId !== source.segmentId) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", path, "does not bind to the source storyboard shot");
  if (item.d05FallbackReason !== source.fallbackReason || resolved.segmentId !== source.segmentId) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", path, "does not preserve D05 shot identity or fallback reason");
  if (item.status !== "resolved" && item.status !== "unresolved") fail("GENERATION_FALLBACK_RESULT_INVALID", "result", `${path}.status`, "is not allowed");
  if (item.chosenSource !== null && !(GENERATION_FALLBACK_VISUAL_SOURCES as readonly unknown[]).includes(item.chosenSource)) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", `${path}.chosenSource`, "is not an allowlisted visual source");
  if (!["none", "generation-failed", "source-unavailable", "source-gap", "candidates-exhausted"].includes(String(item.fallbackReason))) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", `${path}.fallbackReason`, "is not allowed");
  if (item.d07Binding !== null && item.d07Binding !== "user-material" && item.d07Binding !== "d06-image") fail("GENERATION_FALLBACK_RESULT_INVALID", "result", `${path}.d07Binding`, "is not allowed");
  if (!Array.isArray(item.attempts) || item.attempts.length === 0 || item.attempts.length > source.visualSourcePriority.length || new Set(item.attempts.map((attempt: any) => attempt?.source)).size !== item.attempts.length || item.attempts.some((attempt: any, index: number) => attempt?.source !== source.visualSourcePriority[index])) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", `${path}.attempts`, "must be a non-looping prefix of the D05 priority");
  item.attempts.forEach((attempt: unknown, index: number) => validateAttempt(attempt, `${path}.attempts[${index}]`, source.visualSourcePriority[index]!));
  validateStringArray(item.provenance, `${path}.provenance`, 16);
  if (item.diagnostic !== null) validateDiagnostic(item.diagnostic, `${path}.diagnostic`);
}

function validateAttempt(value: unknown, path: string, expectedSource: GenerationFallbackVisualSource): void {
  const item = record(value, "GENERATION_FALLBACK_RESULT_INVALID", "result", path);
  exactKeys(item, ["source", "outcome", "error", "provenance"], "GENERATION_FALLBACK_RESULT_INVALID", "result", path);
  if (item.source !== expectedSource || !["selected", "failed", "unavailable"].includes(String(item.outcome))) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", path, "does not preserve the deterministic priority path");
  if (item.error !== null) { if (isFailure(item.error)) validateFailure(item.error, path, undefined, undefined); else validateDiagnostic(item.error, `${path}.error`); }
  validateStringArray(item.provenance, `${path}.provenance`, 16);
}

function validateTtsResolution(value: unknown, projectId: string): void {
  const item = record(value, "GENERATION_FALLBACK_RESULT_INVALID", "result", "$.tts");
  exactKeys(item, ["status", "chosenSource", "fallbackReason", "d07Binding", "failure", "provenance", "diagnostic"], "GENERATION_FALLBACK_RESULT_INVALID", "result", "$.tts");
  if (item.status === "available") { if (item.chosenSource !== "d02-tts" || item.fallbackReason !== "none" || item.d07Binding !== "d02-tts" || item.failure !== null || item.diagnostic !== null) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.tts", "has invalid successful TTS fallback accounting"); }
  else if (item.status === "fallback") { if (item.chosenSource !== "silence-placeholder" || item.fallbackReason !== "generation-failed" || item.d07Binding !== null || !isFailure(item.failure) || item.failure.component !== "tts" || item.failure.projectId !== projectId || item.diagnostic?.code !== "FALLBACK_TTS_AUDIO_UNAVAILABLE") fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.tts", "has invalid TTS failure accounting"); }
  else fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.tts.status", "is not allowed");
  validateStringArray(item.provenance, "$.tts.provenance", 8);
  if (item.diagnostic !== null) validateDiagnostic(item.diagnostic, "$.tts.diagnostic");
}

function validateTtsBinding(input: Record<string, any>, path: string): void { if (input.tts !== null && !isTtsSynthesisResult(input.tts)) fail("GENERATION_FALLBACK_INPUT_INVALID", "input", `${path}.tts`, "must be a valid D02 result or null"); if (input.ttsFailure !== null && !isFailure(input.ttsFailure)) fail("GENERATION_FALLBACK_FAILURE_INVALID", "failure-binding", `${path}.ttsFailure`, "must be a valid TTS failure or null"); }

function validateImageResults(value: unknown, shotIds: ReadonlySet<string>): ImageGenerationResult[] { if (!Array.isArray(value) || value.length > GENERATION_FALLBACK_MAX_SHOTS) fail("GENERATION_FALLBACK_CANDIDATE_INVALID", "candidate-binding", "$.imageResults", "must contain at most 32 D06 results"); const result: ImageGenerationResult[] = []; value.forEach((item, index) => { if (!isImageGenerationResult(item)) fail("GENERATION_FALLBACK_CANDIDATE_INVALID", "candidate-binding", `$.imageResults[${index}]`, "must be a valid D06 result"); if (!shotIds.has((item as ImageGenerationResult).shotId)) fail("GENERATION_FALLBACK_CANDIDATE_INVALID", "candidate-binding", `$.imageResults[${index}].shotId`, "must reference a D05 shot"); result.push(item as ImageGenerationResult); }); return result; }

function validateFailures(value: unknown, path: string, projectId: string, shotIds: ReadonlySet<string>, component: GenerationFallbackComponent): GenerationFallbackFailure[] { if (!Array.isArray(value) || value.length > GENERATION_FALLBACK_MAX_FAILURES) fail("GENERATION_FALLBACK_FAILURE_INVALID", "failure-binding", path, "must be a bounded failure list"); const result: GenerationFallbackFailure[] = []; value.forEach((item, index) => { validateFailure(item, `${path}[${index}]`, projectId, component); const failure = item as GenerationFallbackFailure; if (component !== "tts" && !shotIds.has(failure.shotId!)) fail("GENERATION_FALLBACK_FAILURE_INVALID", "failure-binding", `${path}[${index}].shotId`, "must reference a D05 shot"); result.push(failure); }); if (new Set(result.map((item) => item.shotId)).size !== result.length) fail("GENERATION_FALLBACK_FAILURE_INVALID", "failure-binding", path, "must contain at most one failure per component and shot"); return result; }

function validateFailure(value: unknown, path: string, projectId?: string, component?: GenerationFallbackComponent): void { if (!isFailure(value)) fail("GENERATION_FALLBACK_FAILURE_INVALID", "failure-binding", path, "must be a sanitized, versioned failure"); const item = value as GenerationFallbackFailure; if (projectId !== undefined && item.projectId !== projectId) fail("GENERATION_FALLBACK_PROJECT_MISMATCH", "project-binding", `${path}.projectId`, "failure belongs to another project"); if (component !== undefined && item.component !== component) fail("GENERATION_FALLBACK_FAILURE_INVALID", "failure-binding", `${path}.component`, "failure component does not match its collection"); }

function isFailure(value: unknown): value is GenerationFallbackFailure { if (!isPlainRecord(value) || Object.keys(value).length !== 6 || typeof value.projectId !== "string" || !isUuid(value.projectId) || !(value.component === "tts" || value.component === "image" || value.component === "animation") || value.stage !== value.component || !(GENERATION_FALLBACK_FAILURE_CODES as readonly unknown[]).includes(value.code) || typeof value.retryable !== "boolean") return false; if (value.component === "tts") return value.shotId === null; return typeof value.shotId === "string" && isId(value.shotId); }

function validateDiagnostic(value: unknown, path: string): void { const item = record(value, "GENERATION_FALLBACK_RESULT_INVALID", "result", path); exactKeys(item, ["code", "stage"], "GENERATION_FALLBACK_RESULT_INVALID", "result", path); const stages: Record<string, string> = { "FALLBACK_SOURCE_UNAVAILABLE": "selection", "FALLBACK_SOURCE_GAP": "storyboard", "FALLBACK_CANDIDATES_EXHAUSTED": "selection", "FALLBACK_D07_SOURCE_UNSUPPORTED": "d07-binding", "FALLBACK_TTS_AUDIO_UNAVAILABLE": "tts", "FALLBACK_D07_INPUT_INVALID": "d07-binding" }; if (stages[item.code as string] !== item.stage) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", path, "has an invalid diagnostic code/stage pair"); }

function validateMaterials(value: unknown, shotIds: ReadonlySet<string>): VideoAssemblyUserMaterial[] { if (!Array.isArray(value) || value.length > 32) fail("GENERATION_FALLBACK_CANDIDATE_INVALID", "candidate-binding", "$.userMaterials", "must be a bounded material list"); const result = value as VideoAssemblyUserMaterial[]; const seen = new Set<string>(); result.forEach((item, index) => { if (!isPlainRecord(item) || Object.keys(item).some((key) => !["sourceId", "shotId", "uri", "mediaType", "durationMs", "fingerprint", "provenanceId"].includes(key)) || !isId(item.sourceId) || !isId(item.shotId) || !shotIds.has(item.shotId) || item.uri !== `supervideo://asset/${item.sourceId}` || (item.mediaType !== "video" && item.mediaType !== "image") || (item.mediaType === "video" && !isInteger(item.durationMs, 1, 60_000)) || (item.durationMs !== undefined && !isInteger(item.durationMs, 1, 60_000)) || !isSha256(item.fingerprint) || !isId(item.provenanceId)) fail("GENERATION_FALLBACK_CANDIDATE_INVALID", "candidate-binding", `$.userMaterials[${index}]`, "is not a valid controlled D07 material"); if (seen.has(item.shotId) || seen.has(item.sourceId)) fail("GENERATION_FALLBACK_CANDIDATE_INVALID", "candidate-binding", "$.userMaterials", "materials must have unique shot and source identities"); seen.add(item.shotId); seen.add(item.sourceId); }); return result; }

function validateRemotionPlan(value: unknown, path: string): asserts value is GenerationFallbackRemotionPlan { const item = record(value, "GENERATION_FALLBACK_INPUT_INVALID", "input", path); exactKeys(item, ["contractVersion", "renderVersion", "runtimeMode", "templateId", "templateVersion", "bundleVersion", "compositionId"], "GENERATION_FALLBACK_INPUT_INVALID", "input", path); if (item.contractVersion !== REMOTION_CONTRACT_VERSION || item.renderVersion !== REMOTION_RENDER_VERSION || item.runtimeMode !== REMOTION_RUNTIME_MODE || item.templateId !== REMOTION_TEMPLATE_ID || item.templateVersion !== REMOTION_TEMPLATE_VERSION || item.bundleVersion !== REMOTION_BUNDLE_VERSION || item.compositionId !== "timeline-preview-v1") fail("GENERATION_FALLBACK_INPUT_INVALID", "input", path, "does not match the fixed D03 plan"); }

function inputDigest(input: GenerationFallbackRequest): unknown { return { schemaVersion: input.schemaVersion, contractVersion: input.contractVersion, policyVersion: input.policyVersion, projectId: input.projectId, timelineId: input.timelineId, assemblyId: input.assemblyId, storyboardDigest: input.storyboard.sourcePlanDigest, tts: input.tts ? { cacheKey: input.tts.cacheKey, durationMs: input.tts.durationMs, outputFingerprint: input.tts.output.outputFingerprint } : { failure: input.ttsFailure ? { component: input.ttsFailure.component, stage: input.ttsFailure.stage, code: input.ttsFailure.code, retryable: input.ttsFailure.retryable } : null }, imageResults: [...input.imageResults].sort((a, b) => a.shotId.localeCompare(b.shotId)).map((item) => ({ shotId: item.shotId, cacheKey: item.cacheKey, outputFingerprint: item.output.outputFingerprint })), imageFailures: [...input.imageFailures].sort((a, b) => a.shotId!.localeCompare(b.shotId!)).map(failureDigest), animationFailures: [...input.animationFailures].sort((a, b) => a.shotId!.localeCompare(b.shotId!)).map(failureDigest), textCardUnavailableShotIds: [...input.textCardUnavailableShotIds].sort(), userMaterials: [...input.userMaterials].sort((a, b) => a.shotId.localeCompare(b.shotId)).map((item) => ({ shotId: item.shotId, sourceId: item.sourceId, mediaType: item.mediaType, durationMs: item.durationMs ?? null, fingerprint: item.fingerprint })), }; }
function failureDigest(item: GenerationFallbackFailure): unknown { return { projectId: item.projectId, component: item.component, stage: item.stage, shotId: item.shotId, code: item.code, retryable: item.retryable }; }
function ttsDigest(item: GenerationFallbackTts): unknown { return { status: item.status, chosenSource: item.chosenSource, fallbackReason: item.fallbackReason, d07Binding: item.d07Binding, failure: item.failure ? failureDigest(item.failure) : null, provenance: [...item.provenance], diagnostic: item.diagnostic }; }
function shotDigest(item: GenerationFallbackShot): unknown { return { shotId: item.shotId, order: item.order, segmentId: item.segmentId, status: item.status, chosenSource: item.chosenSource, fallbackReason: item.fallbackReason, d05FallbackReason: item.d05FallbackReason, d07Binding: item.d07Binding, attempts: item.attempts.map((attempt) => ({ source: attempt.source, outcome: attempt.outcome, error: attempt.error, provenance: [...attempt.provenance] })), provenance: [...item.provenance], diagnostic: item.diagnostic }; }
function fallbackResultDigest(result: GenerationFallbackResult): string { return sha256Hex(canonicalJson({ schemaVersion: result.schemaVersion, contractVersion: result.contractVersion, policyVersion: result.policyVersion, projectId: result.projectId, timelineId: result.timelineId, assemblyId: result.assemblyId, status: result.status, d07Eligible: result.d07Eligible, inputDigest: result.inputDigest, storyboardDigest: result.storyboard.sourcePlanDigest, tts: ttsDigest(result.tts), shots: result.shots.map(shotDigest), d07Diagnostic: result.d07Diagnostic, resolvedStoryboard: result.resolvedStoryboard, videoAssemblyRequest: result.videoAssemblyRequest })); }

function findSegment(storyboard: ScriptStoryboardResult, segmentId: string) { const segment = getSegments(storyboard).find((item) => item.segmentId === segmentId); if (!segment) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", "$.shots", "shot segment is missing"); return segment; }
function getSegments(storyboard: ScriptStoryboardResult) { return [storyboard.script.hook, ...storyboard.script.body, storyboard.script.cta]; }
function getShots(storyboard: ScriptStoryboardResult): ScriptStoryboardShot[] { return [...storyboard.shots].sort((left, right) => left.order - right.order); }
function validateStringArray(value: unknown, path: string, maximum: number): void { if (!Array.isArray(value) || value.length > maximum || value.some((item) => !isId(item))) fail("GENERATION_FALLBACK_RESULT_INVALID", "result", path, "must be a bounded identifier list"); }
function isPlainRecord(value: unknown): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function record(value: unknown, code: GenerationFallbackErrorCode, stage: GenerationFallbackErrorStage, path: string): Record<string, any> { if (!isPlainRecord(value)) fail(code, stage, path, "must be a plain object"); return value; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[], code: GenerationFallbackErrorCode, stage: GenerationFallbackErrorStage, path: string): void { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code, stage, `${path}.${key}`, "unknown key is not allowed"); for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key)) fail(code, stage, `${path}.${key}`, "required key is missing"); }
function fail(code: GenerationFallbackErrorCode, stage: GenerationFallbackErrorStage, path: string, message: string): never { throw new GenerationFallbackValidationException({ code, stage, path, message }); }
function checkUuid(value: unknown, path: string, code: GenerationFallbackErrorCode, stage: GenerationFallbackErrorStage): void { if (!isUuid(value)) fail(code, stage, path, "must be a UUID"); }
function checkId(value: unknown, path: string, code: GenerationFallbackErrorCode, stage: GenerationFallbackErrorStage): void { if (!isId(value)) fail(code, stage, path, "must be a bounded identifier"); }
function checkSha256(value: unknown, path: string, code: GenerationFallbackErrorCode, stage: GenerationFallbackErrorStage): void { if (!isSha256(value)) fail(code, stage, path, "must be a lowercase SHA-256 digest"); }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function isId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function isSha256(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function isInteger(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function boundedJson(value: unknown, maximum: number): boolean { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maximum; } catch { return false; } }
function rejectForbidden(value: unknown, path: string, seen: Set<unknown>): void { if (seen.has(value)) fail("GENERATION_FALLBACK_INPUT_INVALID", "input", path, "cyclic input is not allowed"); if (value && typeof value === "object") { seen.add(value); if (Array.isArray(value)) value.forEach((item, index) => rejectForbidden(item, `${path}[${index}]`, seen)); else Object.entries(value).forEach(([key, item]) => { const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, ""); if (["secret", "credential", "credentialref", "token", "command", "executable", "authorization", "password", "apikey", "absolutepath", "rendererpath"].includes(normalized)) fail("GENERATION_FALLBACK_INPUT_INVALID", "input", `${path}.${key}`, "forbidden sensitive or executable field"); rejectForbidden(item, `${path}.${key}`, seen); }); seen.delete(value); } }
