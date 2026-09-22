import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const shared = await import(pathToFileURL(path.join(root, "packages", "shared", "dist", "index.js")).href);
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "c06_preview_render_v1.json"), "utf8"));
const projectId = "99999999-9999-4999-8999-999999999999";

test("C06 preview result is versioned, bounded, and honest about plan mode", () => {
  assert.equal(shared.isPreviewRenderResult(fixture), true);
  assert.equal(shared.isCoreRpcRequest({ jsonrpc: "2.0", id: "c06-1", method: "media.preview.render", params: {
    projectId,
    arollPlan: { projectId, timelineId: fixture.timelineId },
    subtitlePlan: { projectId, timelineId: fixture.timelineId },
  }}), false);
  const dishonest = structuredClone(fixture);
  dishonest.executionStatus = "completed";
  assert.equal(shared.isPreviewRenderResult(dishonest), false);
  const unmapped = structuredClone(fixture);
  unmapped.gaps = [{ code: "subtitle-cue-unmapped", clipId: "clip-missing", cueId: "cue-missing", detail: "not bound" }];
  unmapped.status = "gaps";
  assert.equal(shared.isPreviewRenderResult(unmapped), true);
  const executed = {
    ...fixture,
    executionMode: "ffmpeg",
    executionStatus: "completed",
    log: { status: "completed", stdout: "", stderr: "" },
    output: {
      kind: "video",
      relativePath: `previews/preview-render-v1/${"a".repeat(64)}.mp4`,
      playbackUri: `supervideo://preview/${projectId}/${"a".repeat(64)}`,
      sizeBytes: 1,
      durationMs: 3500,
      outputFingerprint: "b".repeat(64),
    },
  };
  assert.equal(shared.isPreviewRenderResult(executed), true);
  assert.equal(shared.isPreviewRenderResult({ ...executed, output: { ...executed.output, relativePath: `previews/preview-render-v1/${"a".repeat(64)}.mkv` } }), false);
  assert.equal(shared.isPreviewRenderResult({ ...executed, output: { ...executed.output, relativePath: `previews/preview-render-v1/../${"a".repeat(64)}.mp4` } }), false);
  assert.equal(shared.isPreviewRenderResult({ ...executed, output: { ...executed.output, playbackUri: `supervideo://preview/not-a-project/${"a".repeat(64)}` } }), false);
});
