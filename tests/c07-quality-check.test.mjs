import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const shared = await import(pathToFileURL(path.join(root, "packages", "shared", "dist", "index.js")).href);
const previewResult = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "c06_preview_render_v1.json"), "utf8"));
const projectId = previewResult.projectId;

test("C07 quality contract keeps plan execution honest", () => {
  const params = { projectId, previewResult };
  assert.equal(shared.isPreviewQualityCheckParams(params), true);
  assert.equal(shared.isCoreRpcRequest({ jsonrpc: "2.0", id: "c07-1", method: "media.preview.quality_check", params }), true);
  const result = {
    schemaVersion: 1,
    qaVersion: "preview-quality-v1",
    projectId,
    planDigest: previewResult.planDigest,
    phase: "plan",
    status: "warning",
    readyForExport: false,
    executionVerified: false,
    issueCount: 5,
    issues: [
      { checkId: "plan-binding", code: "QA_PLAN_BINDING_INVALID", severity: "pass", status: "verified", message: "C04 source bindings are unique and non-empty." },
      { checkId: "plan-order", code: "QA_PLAN_ORDER_INVALID", severity: "pass", status: "verified", message: "C05 cues retain stable order and bind to a C04 source." },
      { checkId: "plan-ranges", code: "QA_PLAN_RANGE_INVALID", severity: "pass", status: "verified", message: "C05 cue ranges are ordered, bounded, and non-overlapping." },
      { checkId: "plan-gaps", code: "QA_PLAN_GAP", severity: "pass", status: "verified", message: "No C04/C05 mapping gaps remain." },
      { checkId: "execution", code: "QA_EXECUTION_NOT_RUN", severity: "warning", status: "not-run", message: "Preview execution has not run; output checks were not performed." },
    ],
  };
  assert.equal(shared.isPreviewQualityCheckResult(result), true);
  assert.equal(shared.isPreviewQualityCheckResult({ ...result, readyForExport: true }), false);
  assert.equal(shared.isPreviewQualityCheckResult({ ...result, status: "pass" }), false);
});
