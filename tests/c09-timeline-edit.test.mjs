import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const shared = await import(pathToFileURL(path.join(root, "packages", "shared", "dist", "index.js")).href);
const timeline = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "c01_timeline_ir_v1.json"), "utf8"));
const projectId = "123e4567-e89b-12d3-a456-426614174000";

test("C09 shared wire validator accepts natural-language and structured edit requests", () => {
  const natural = {
    jsonrpc: "2.0", id: "c09-natural", method: "timeline.edit",
    params: { schemaVersion: 1, editVersion: "timeline-edit-v1", policy: "deterministic-natural-language-v1", projectId, timeline, instruction: "删除 clip-camera-a" },
  };
  assert.equal(shared.isCoreRpcRequest(natural), true);

  const structured = {
    ...natural,
    id: "c09-structured",
    params: {
      schemaVersion: 1, editVersion: "timeline-edit-v1", policy: "deterministic-natural-language-v1", projectId, timeline,
      intent: { schemaVersion: 1, editVersion: "edit-intent-v1", policy: "deterministic-natural-language-v1", operation: "subtitle", targetText: "字幕片段", text: "新的字幕" },
    },
  };
  assert.equal(shared.isCoreRpcRequest(structured), true);
  assert.equal(shared.isCoreRpcRequest({ ...natural, params: { ...natural.params, unexpected: true } }), false);
  assert.equal(shared.isCoreRpcRequest({ ...natural, params: { ...natural.params, policy: "future-policy" } }), false);
});
