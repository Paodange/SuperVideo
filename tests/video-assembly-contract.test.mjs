import assert from "node:assert/strict";
import test from "node:test";
import {
  VIDEO_ASSEMBLY_CONTRACT_VERSION,
  buildVideoAssembly,
  isVideoAssemblyRequest,
  isVideoAssemblyResult,
  sha256Hex,
  validateVideoAssemblyRequest,
  validateVideoAssemblyResult,
  VideoAssemblyValidationException,
} from "@supervideo/shared";
import { request } from "./fixtures/d07_video_assembly_v1.mjs";

test("D07 assembles a complete no-human-material preview input", () => {
  assert.equal(VIDEO_ASSEMBLY_CONTRACT_VERSION, "video-assembly-v1");
  assert.equal(isVideoAssemblyRequest(request), true);
  const result = buildVideoAssembly(request);
  assert.equal(isVideoAssemblyResult(result), true);
  assert.equal(result.status, "assembled");
  assert.equal(result.runtimeMode, "offline-deterministic");
  assert.equal(result.contentStatus, "ready");
  assert.equal(result.durationMs, 3000);
  assert.match(result.output.relativePath, /^generated\/video-assembly-v1\/[0-9a-f]{64}\.json$/);
  assert.equal(result.preview.availability, "contract-only");
  assert.equal(result.timeline.tracks.map((track) => track.kind).join(","), "video,audio,subtitle,overlay");
  assert.equal(result.timeline.tracks[0].clips.length, 3);
  assert.equal(result.timeline.tracks[1].clips[0].durationMs, 3000);
  assert.equal(result.timeline.tracks[2].clips.every((clip) => clip.kind === "subtitle"), true);
  assert.equal(result.timeline.tracks[3].clips.every((clip) => clip.kind === "template"), true);
  assert.equal(result.provenance.imageCacheKeys.length, 3);
  assert.equal(result.timeline.sources.some((source) => source.uri.startsWith("C:")), false);
});

test("D07 is deterministic for identical D02/D05/D06/D04/D03 inputs", () => {
  const first = buildVideoAssembly(request);
  const second = buildVideoAssembly(structuredClone(request));
  assert.equal(first.timelineDigest, second.timelineDigest);
  assert.deepEqual(first, second);
});

test("D07 canonical digest matches the cross-runtime SHA-256 contract", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(buildVideoAssembly(request).timelineDigest, "3aa8f13a147a50065143330b7037fef0f3349ad9b72ff2bd8fcbdbc7d08d785f");
});

test("D07 preserves user-material selection when D05 planned it", () => {
  const planned = structuredClone(request);
  planned.storyboard.shots = planned.storyboard.shots.map((shot) => ({
    ...shot,
    visualSourcePriority: ["user-material", "licensed-stock", "ai-image", "remotion-template", "text-card"],
    fallbackReason: "planned",
  }));
  planned.imageResults = [];
  planned.userMaterials = planned.storyboard.shots.map((shot, index) => ({
    sourceId: `user:material:${index + 1}`,
    shotId: shot.shotId,
    uri: `supervideo://asset/user:material:${index + 1}`,
    mediaType: "video",
    durationMs: 1000,
    fingerprint: ["a", "b", "c"][index].repeat(64),
    provenanceId: `user:provenance:${index + 1}`,
  }));
  const result = buildVideoAssembly(planned);
  assert.equal(result.timeline.tracks[0].clips.every((clip) => clip.kind === "video" && clip.editableInJianying), true);
  assert.equal(result.provenance.userMaterialSourceIds.length, 3);
});

test("D07 rejects cross-object binding, gaps, paths, secrets, commands, and unknown fields diagnostically", () => {
  const cases = [
    { value: { ...request, tts: { ...request.tts, projectId: "22222222-2222-4222-8222-222222222222" } }, code: "VIDEO_ASSEMBLY_PROJECT_MISMATCH", stage: "tts-binding" },
    { value: { ...request, imageResults: request.imageResults.slice(0, 2) }, code: "VIDEO_ASSEMBLY_IMAGE_BINDING_INVALID", stage: "image-binding" },
    { value: { ...request, storyboard: { ...request.storyboard, status: "gaps" } }, code: "VIDEO_ASSEMBLY_STORYBOARD_INVALID", stage: "storyboard-binding" },
    { value: { ...request, d03Plan: { ...request.d03Plan, command: "ffmpeg" } }, code: "VIDEO_ASSEMBLY_PLAN_INVALID", stage: "plan-binding" },
    { value: { ...request, userMaterials: [{ sourceId: "user:1", shotId: "shot-1", uri: "C:/outside.mp4", mediaType: "video", durationMs: 1000, fingerprint: "a".repeat(64), provenanceId: "user:p" }] }, code: "VIDEO_ASSEMBLY_MATERIAL_INVALID", stage: "material-binding" },
  ];
  for (const item of cases) {
    assert.throws(() => buildVideoAssembly(item.value), (error) => error instanceof VideoAssemblyValidationException && error.error.code === item.code && error.error.stage === item.stage);
  }
  assert.equal(isVideoAssemblyRequest({ ...request, credentialRef: "never" }), false);
  assert.equal(isVideoAssemblyRequest({ ...request, d04Plan: { ...request.d04Plan, provider: "never" } }), false);
});

test("D07 result validation protects the C01 Timeline IR and digest boundary", () => {
  const result = buildVideoAssembly(request);
  assert.equal(isVideoAssemblyResult(result), true);
  assert.equal(isVideoAssemblyResult({ ...result, timelineDigest: "0".repeat(64) }), false);
  const unknown = structuredClone(result);
  unknown.timeline.tracks[0].clips[0].metadata.secret = "never";
  assert.equal(isVideoAssemblyResult(unknown), false);
  assert.doesNotThrow(() => validateVideoAssemblyRequest(request));
  assert.doesNotThrow(() => validateVideoAssemblyResult(result));
});
