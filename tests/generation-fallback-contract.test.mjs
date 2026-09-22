import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoAssembly,
  isGenerationFallbackRequest,
  isGenerationFallbackResult,
  isVideoAssemblyRequest,
  resolveGenerationFallback,
  validateGenerationFallbackRequest,
  GenerationFallbackValidationException,
} from "@supervideo/shared";
import { request as d07Request } from "./fixtures/d07_video_assembly_v1.mjs";

const failure = (component, shotId = null, code = "GENERATION_FAILED") => ({
  projectId: d07Request.projectId,
  component,
  stage: component,
  shotId,
  code,
  retryable: false,
});

function makeRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    contractVersion: "generation-fallback-v1",
    policyVersion: "deterministic-generation-fallback-v1",
    runtimeMode: "offline-deterministic",
    projectId: d07Request.projectId,
    timelineId: d07Request.timelineId,
    assemblyId: "assembly-d08-demo",
    storyboard: structuredClone(d07Request.storyboard),
    tts: structuredClone(d07Request.tts),
    ttsFailure: null,
    imageResults: structuredClone(d07Request.imageResults),
    imageFailures: [],
    animationFailures: [],
    textCardUnavailableShotIds: [],
    d04Plan: structuredClone(d07Request.d04Plan),
    d03Plan: structuredClone(d07Request.d03Plan),
    userMaterials: [],
    ...overrides,
  };
}

test("D08 success resolves D05/D06 inputs and hands a valid request to strict D07", () => {
  const input = makeRequest();
  assert.equal(isGenerationFallbackRequest(input), true);
  const first = resolveGenerationFallback(input);
  const second = resolveGenerationFallback(structuredClone(input));
  assert.equal(isGenerationFallbackResult(first), true);
  assert.equal(first.status, "ready");
  assert.equal(first.d07Eligible, true);
  assert.ok(first.videoAssemblyRequest);
  assert.equal(isVideoAssemblyRequest(first.videoAssemblyRequest), true);
  assert.equal(buildVideoAssembly(first.videoAssemblyRequest).status, "assembled");
  assert.deepEqual(first, second);
  assert.equal(first.resultDigest, "528e2d0e7d284ea244ca76a0ef51f83aded8e1e7147c9596c18fdd4fa225dfc0");
  assert.equal(first.inputDigest, "7b6b8a11faaad3503f4be248a8613f1283078d398d8df661781313dbe96345c4");
});

test("D08 isolates a failed image and records the next deterministic visual fallback", () => {
  const input = makeRequest({ imageResults: d07Request.imageResults.slice(1), imageFailures: [failure("image", "shot-1", "OUTPUT_INVALID")] });
  const result = resolveGenerationFallback(input);
  const shot = result.shots[0];
  assert.equal(result.status, "partial");
  assert.equal(result.d07Eligible, false);
  assert.equal(shot.chosenSource, "remotion-template");
  assert.equal(shot.fallbackReason, "generation-failed");
  assert.deepEqual(shot.attempts.map((item) => item.outcome), ["unavailable", "failed", "selected"]);
  assert.deepEqual(shot.attempts[1].error, failure("image", "shot-1", "OUTPUT_INVALID"));
  assert.equal(result.shots[1].chosenSource, "ai-image");
  assert.equal(result.shots[2].chosenSource, "ai-image");
});

test("D08 records animation failure before falling through to text-card without pretending it is D07 media", () => {
  const input = makeRequest({
    imageResults: d07Request.imageResults.slice(1),
    animationFailures: [failure("animation", "shot-1", "TIMEOUT")],
  });
  const result = resolveGenerationFallback(input);
  const shot = result.shots[0];
  assert.equal(shot.chosenSource, "text-card");
  assert.equal(shot.d07Binding, null);
  assert.equal(shot.attempts[2].outcome, "failed");
  assert.equal(shot.attempts[2].error.stage, "animation");
  assert.equal(shot.attempts[3].source, "text-card");
  assert.equal(shot.attempts[3].outcome, "selected");
  assert.equal(result.d07Eligible, false);
});

test("D08 reports exhausted candidates instead of looping when every visual fallback is unavailable", () => {
  const result = resolveGenerationFallback(makeRequest({
    imageResults: d07Request.imageResults.slice(1),
    imageFailures: [failure("image", "shot-1", "GENERATION_FAILED")],
    animationFailures: [failure("animation", "shot-1", "OUTPUT_INVALID")],
    textCardUnavailableShotIds: ["shot-1"],
  }));
  assert.equal(result.shots[0].status, "unresolved");
  assert.equal(result.shots[0].chosenSource, null);
  assert.equal(result.shots[0].fallbackReason, "candidates-exhausted");
  assert.equal(result.shots[0].attempts.length, 4);
  assert.equal(result.shots[0].diagnostic.code, "FALLBACK_CANDIDATES_EXHAUSTED");
  assert.equal(result.shots[1].chosenSource, "ai-image");
});

test("D08 TTS failure is an auditable silence placeholder with no fabricated audio output", () => {
  const result = resolveGenerationFallback(makeRequest({ tts: null, ttsFailure: failure("tts", null, "PROVIDER_UNAVAILABLE") }));
  assert.equal(result.status, "blocked");
  assert.equal(result.tts.chosenSource, "silence-placeholder");
  assert.equal(result.tts.d07Binding, null);
  assert.equal(result.tts.failure.code, "PROVIDER_UNAVAILABLE");
  assert.equal(result.videoAssemblyRequest, null);
  assert.equal(JSON.stringify(result).includes("generated/tts-v1/"), false);
});

test("D08 preserves source gaps and never invents missing sentence/audio provenance", () => {
  const storyboard = structuredClone(d07Request.storyboard);
  storyboard.script.body[0] = { ...storyboard.script.body[0], status: "gap", sentenceId: null, text: null, source: null, durationMs: 0, factIds: [], confirmation: "not-required" };
  storyboard.facts = storyboard.facts.map((fact) => ({ ...fact, status: "unbound", segmentIds: [] }));
  storyboard.selectedDurationMs = 2000;
  storyboard.durationStatus = "outside-tolerance";
  storyboard.status = "gaps";
  storyboard.shots[1] = { ...storyboard.shots[1], durationMs: 0, fallbackReason: "source-gap", visualSourcePriority: ["remotion-template", "ai-image", "text-card"] };
  const result = resolveGenerationFallback(makeRequest({ storyboard }));
  assert.equal(result.shots[1].status, "unresolved");
  assert.equal(result.shots[1].fallbackReason, "source-gap");
  assert.equal(result.shots[1].diagnostic.code, "FALLBACK_SOURCE_GAP");
  assert.equal(result.d07Eligible, false);
  assert.equal(result.inputDigest, "7373c010c958c5c6d809eb875c4e0d177c8acb3947191199257b578b63107457");
  assert.equal(result.resultDigest, "52e3a2da7d3e104b6dd920b602b1fa55e88ab2155c94cd75333fee93ffcb67d2");
});

test("D08 input digest binds the actual storyboard beyond sourcePlanDigest", () => {
  const original = resolveGenerationFallback(makeRequest());
  const changedInput = makeRequest();
  changedInput.storyboard.brief.objective = "changed objective with the same source plan digest";
  const changed = resolveGenerationFallback(changedInput);
  assert.equal(changed.storyboard.sourcePlanDigest, original.storyboard.sourcePlanDigest);
  assert.notEqual(changed.inputDigest, original.inputDigest);
});

test("D08 keeps user-material priority when D05 planned it and accepts the resulting D07 request", () => {
  const storyboard = structuredClone(d07Request.storyboard);
  storyboard.shots = storyboard.shots.map((shot) => ({ ...shot, visualSourcePriority: ["user-material", "licensed-stock", "ai-image", "remotion-template", "text-card"], fallbackReason: "planned" }));
  const userMaterials = storyboard.shots.map((shot, index) => ({ sourceId: `user:material:${index + 1}`, shotId: shot.shotId, uri: `supervideo://asset/user:material:${index + 1}`, mediaType: "video", durationMs: 1000, fingerprint: ["a", "b", "c"][index].repeat(64), provenanceId: `user:provenance:${index + 1}` }));
  const result = resolveGenerationFallback(makeRequest({ storyboard, imageResults: [], userMaterials }));
  assert.equal(result.status, "ready");
  assert.equal(result.videoAssemblyRequest.userMaterials.length, 3);
  assert.equal(buildVideoAssembly(result.videoAssemblyRequest).timeline.tracks[0].clips.every((clip) => clip.kind === "video"), true);
});

test("D08 downgrades an unavailable planned user material to the D05 no-user-material priority before D07", () => {
  const storyboard = structuredClone(d07Request.storyboard);
  storyboard.shots = storyboard.shots.map((shot) => ({ ...shot, visualSourcePriority: ["user-material", "licensed-stock", "ai-image", "remotion-template", "text-card"], fallbackReason: "planned" }));
  const result = resolveGenerationFallback(makeRequest({ storyboard }));
  assert.equal(result.status, "ready");
  assert.equal(result.resolvedStoryboard.shots[0].fallbackReason, "no-user-material");
  assert.deepEqual(result.resolvedStoryboard.shots[0].visualSourcePriority, ["licensed-stock", "ai-image", "remotion-template", "text-card"]);
  assert.equal(result.videoAssemblyRequest.storyboard.shots[0].fallbackReason, "no-user-material");
  assert.equal(buildVideoAssembly(result.videoAssemblyRequest).status, "assembled");
});

test("D08 rejects project crossing, unknown fields, sensitive/path fields, invalid failure stages, and fallback loops", () => {
  const base = makeRequest();
  assert.equal(isGenerationFallbackRequest({ ...base, credentialRef: "never" }), false);
  assert.equal(isGenerationFallbackRequest({ ...base, tts: { ...base.tts, projectId: "22222222-2222-4222-8222-222222222222" } }), false);
  assert.equal(isGenerationFallbackRequest({ ...base, imageFailures: [{ ...failure("image", "shot-1"), stage: "tts" }] }), false);
  assert.equal(isGenerationFallbackRequest({ ...base, imageFailures: [{ ...failure("image", "shot-1"), secret: "never" }] }), false);
  assert.throws(() => validateGenerationFallbackRequest({ ...base, userMaterials: [{ sourceId: "user:1", shotId: "shot-1", uri: "C:/private.mp4", mediaType: "video", durationMs: 1000, fingerprint: "a".repeat(64), provenanceId: "user:p" }] }), GenerationFallbackValidationException);
  const result = resolveGenerationFallback(base);
  const tampered = structuredClone(result);
  tampered.shots[0].attempts.push({ source: "ai-image", outcome: "selected", error: null, provenance: [] });
  assert.equal(isGenerationFallbackResult(tampered), false);
});

test("D08 result digest rejects tampered status, input, resolved storyboard, and D07 request", () => {
  const base = resolveGenerationFallback(makeRequest());
  const mutations = [
    (value) => { value.status = "partial"; },
    (value) => { value.inputDigest = "0".repeat(64); },
    (value) => {
      value.resolvedStoryboard.shots[0].visualIntent = "tampered";
      value.videoAssemblyRequest.storyboard = structuredClone(value.resolvedStoryboard);
    },
    (value) => { value.videoAssemblyRequest.assemblyId = "assembly-d08-tampered"; },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(base);
    mutate(forged);
    assert.equal(isGenerationFallbackResult(forged), false);
  }
});
