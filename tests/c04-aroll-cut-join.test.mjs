import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const shared = await import(pathToFileURL(path.join(root, "packages", "shared", "dist", "index.js")).href);
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "c04_aroll_cut_join_v1.json"), "utf8"));
const projectId = "99999999-9999-4999-8999-999999999999";

test("C04 params accept bounded audio/video complete-sentence Timeline IR", () => {
  const video = { projectId, timeline: fixture, mode: "video", trackId: "track-video-aroll" };
  const audio = { projectId, timeline: fixture, mode: "audio", trackId: "track-audio-aroll" };
  assert.equal(shared.isArollCutJoinParams(video), true);
  assert.equal(shared.isArollCutJoinParams(audio), true);
  assert.equal(shared.isCoreRpcRequest({ jsonrpc: "2.0", id: "c04-1", method: "media.aroll.cut_join", params: video }), true);
  const invalidSpan = structuredClone(video);
  invalidSpan.timeline.tracks[0].clips[0].sourceOutMs = 2_999;
  assert.equal(shared.isArollCutJoinParams(invalidSpan), false);
  const partial = structuredClone(video);
  partial.timeline.tracks[0].clips[0].metadata.sentenceStatus = "partial";
  assert.equal(shared.isArollCutJoinParams(partial), false);
  const crossMedia = structuredClone(video);
  crossMedia.timeline.tracks[0].clips[0].sourceId = "source-aroll-audio-a";
  assert.equal(shared.isArollCutJoinParams(crossMedia), false);
});

test("C04 result validator enforces contiguous output spans and execution honesty", () => {
  const source = {
    sourceId: "source-aroll-video-a",
    uri: "supervideo://asset/11111111-1111-4111-8111-111111111111",
    mediaType: "video",
    durationMs: 10000,
    fingerprint: "a".repeat(64),
  };
  const result = {
    schemaVersion: 1,
    planVersion: "aroll-cut-join-plan-v1",
    projectId,
    timelineId: "timeline-c04-demo",
    trackId: "track-video-aroll",
    mode: "video",
    executionMode: "plan",
    executionStatus: "not-run",
    status: "gaps",
    selectionPolicy: "ordered-complete-sentence-v1",
    gapPolicy: "concatenate-without-timeline-gaps-v1",
    planDigest: "d".repeat(64),
    selectedDurationMs: 3500,
    segments: [
      { order: 1, clipId: "clip-video-1", sentenceId: "sentence-video-1", source, sourceInMs: 1000, sourceOutMs: 3000, durationMs: 2000, timelineStartMs: 0, outputStartMs: 0, outputEndMs: 2000 },
      { order: 2, clipId: "clip-video-2", sentenceId: "sentence-video-2", source: { ...source, sourceId: "source-aroll-video-b", uri: "supervideo://asset/22222222-2222-4222-8222-222222222222", durationMs: 12000, fingerprint: "b".repeat(64) }, sourceInMs: 4000, sourceOutMs: 5500, durationMs: 1500, timelineStartMs: 2500, outputStartMs: 2000, outputEndMs: 3500 },
    ],
    gaps: [{ code: "timeline-gap", beforeClipId: "clip-video-1", afterClipId: "clip-video-2", startMs: 2000, endMs: 2500, durationMs: 500 }],
    output: null,
  };
  assert.equal(shared.isArollCutJoinResult(result), true);
  const nonContiguous = structuredClone(result);
  nonContiguous.segments[1].outputStartMs = 2100;
  nonContiguous.segments[1].outputEndMs = 3600;
  assert.equal(shared.isArollCutJoinResult(nonContiguous), false);
  const dishonest = structuredClone(result);
  dishonest.executionStatus = "completed";
  assert.equal(shared.isArollCutJoinResult(dishonest), false);
  assert.equal(shared.isArollCutJoinResult({ ...result, output: { kind: "video", relativePath: "C:\\secret.mp4", sizeBytes: 1 } }), false);
});
