import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const shared = await import(pathToFileURL(path.join(root, "packages", "shared", "dist", "index.js")).href);
const base = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "c06_preview_render_v1.json"), "utf8"));
const projectId = base.projectId;
const preview = {
  ...base,
  executionMode: "ffmpeg",
  executionStatus: "completed",
  log: { status: "completed", stdout: "", stderr: "" },
  output: {
    kind: "video",
    relativePath: `previews/preview-render-v1/${base.planDigest}.mp4`,
    playbackUri: `supervideo://preview/${projectId}/${base.planDigest}`,
    sizeBytes: 42,
    durationMs: base.timelineDurationMs,
    outputFingerprint: "a".repeat(64),
  },
};
const quality = {
  schemaVersion: 1,
  qaVersion: "preview-quality-v1",
  projectId,
  planDigest: base.planDigest,
  phase: "executed",
  status: "pass",
  readyForExport: true,
  executionVerified: true,
  issueCount: 1,
  issues: [{ checkId: "container", code: "QA_OUTPUT_CONTAINER_INVALID", severity: "pass", status: "verified", message: "Container verified." }],
};

test("C08 final export contract binds C06 and C07 and stays inside exports/videos", () => {
  const params = { projectId, previewResult: preview, qualityResult: quality };
  assert.equal(shared.isFinalMp4ExportParams(params), true);
  assert.equal(shared.isCoreRpcRequest({ jsonrpc: "2.0", id: "c08-1", method: "media.final.export", params }), true);
  const result = {
    schemaVersion: 1,
    exportVersion: "final-mp4-export-v1",
    exportPolicy: "verified-preview-copy-v1",
    projectId,
    timelineId: base.timelineId,
    planDigest: base.planDigest,
    qualityDigest: "b".repeat(64),
    status: "completed",
    output: {
      kind: "video",
      relativePath: `exports/videos/final-${base.planDigest}.mp4`,
      manifestRelativePath: `exports/videos/final-${base.planDigest}.manifest.json`,
      sizeBytes: 42,
      durationMs: base.timelineDurationMs,
      outputFingerprint: "c".repeat(64),
      container: { formatName: "mov,mp4,m4a", videoCodec: "h264", audioCodec: null, width: 1080, height: 1920, frameRate: 30 },
    },
  };
  assert.equal(shared.isFinalMp4ExportResult(result), true);
  assert.equal(shared.isFinalMp4ExportResult({ ...result, output: { ...result.output, relativePath: "exports/videos/../outside.mp4" } }), false);
  assert.equal(shared.isFinalMp4ExportParams({ ...params, qualityResult: { ...quality, readyForExport: false } }), true);
});
