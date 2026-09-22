import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as shared from "../packages/shared/dist/index.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const timeline = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "c01_timeline_ir_v1.json"), "utf8"));
const projectId = "11111111-1111-4111-8111-111111111111";

test("C05 subtitle params are versioned and bounded at the Core boundary", () => {
  const params = { projectId, timeline, maxLines: 2, maxLineWidth: 32, sentenceSources: [] };
  assert.equal(shared.isSubtitlePlanParams(params), true);
  assert.equal(shared.isCoreRpcRequest({ jsonrpc: "2.0", id: "c05-1", method: "media.subtitle.plan", params }), true);
  assert.equal(shared.isSubtitlePlanParams({ ...params, maxLineWidth: 7 }), false);
  assert.equal(shared.isSubtitlePlanParams({ ...params, unexpected: true }), false);
});

test("C05 result validator enforces cue order, accounting and bounded layout", () => {
  const cue = {
    order: 1,
    cueId: "subtitle-clip-subtitle-0001",
    clipId: "clip-subtitle-0001",
    sentenceId: null,
    sourceId: null,
    sourceInMs: null,
    sourceOutMs: null,
    provenanceIds: [],
    text: "这是一个可编辑的字幕片段。",
    language: "zh-CN",
    timelineStartMs: 500,
    durationMs: 4000,
    timelineEndMs: 4500,
  };
  const result = {
    schemaVersion: 1,
    planVersion: "subtitle-plan-v1",
    projectId,
    timelineId: "project-c01-demo",
    status: "ready",
    selectionPolicy: "timeline-subtitles-or-sentence-clips-v1",
    layoutPolicy: "bounded-display-width-v1",
    maxLines: 2,
    maxLineWidth: 32,
    totalDurationMs: 4000,
    cueCount: 1,
    planDigest: "a".repeat(64),
    cues: [cue],
    gaps: [],
  };
  assert.equal(shared.isSubtitlePlanResult(result), true);
  assert.equal(shared.isSubtitlePlanResult({ ...result, totalDurationMs: 1 }), false);
  assert.equal(shared.isSubtitlePlanResult({ ...result, cues: [{ ...cue, durationMs: 3999 }] }), false);
});
