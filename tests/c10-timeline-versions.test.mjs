import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const shared = await import(pathToFileURL(path.join(root, "packages", "shared", "dist", "index.js")).href);
const timeline = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "c01_timeline_ir_v1.json"), "utf8"));
const projectId = "123e4567-e89b-12d3-a456-426614174000";
const versionId = "223e4567-e89b-12d3-a456-426614174001";

const contract = { schemaVersion: 1, versioningVersion: "timeline-version-v1" };

test("C10 shared validators enforce version contract and bounded operation shapes", () => {
  const create = { ...contract, projectId, timeline, idempotencyKey: "create-1" };
  assert.equal(shared.isTimelineVersionCreateParams(create), true);
  assert.equal(shared.isTimelineVersionCreateParams({ ...create, versioningVersion: "future" }), false);

  const apply = { ...contract, projectId, instruction: "删除 clip-camera-a" };
  assert.equal(shared.isTimelineVersionApplyEditParams(apply), true);
  assert.equal(shared.isTimelineVersionApplyEditParams({ ...apply, instruction: "" }), false);

  const snapshot = {
    ...contract,
    projectId,
    versionId,
    timelineId: timeline.id,
    versionNumber: 1,
    parentVersionId: null,
    sourceType: "root",
    createdAtMs: 1,
    isActive: true,
    editIntent: {},
    diffSummary: {},
    timeline,
  };
  const result = {
    ...contract,
    projectId,
    operation: "created",
    activeVersionId: versionId,
    activeRevision: 1,
    version: snapshot,
  };
  assert.equal(shared.isTimelineVersionResult(result), true);
  assert.equal(shared.isTimelineVersionResult({ ...result, version: { ...snapshot, projectId: "323e4567-e89b-12d3-a456-426614174002" } }), false);
});
