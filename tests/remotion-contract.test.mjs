import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_IPC_CHANNELS,
  isRemotionRenderParams,
  isRemotionRenderResult,
  isValidAgentWorkerCommand,
} from "@supervideo/shared";
import timeline from "./fixtures/c01_timeline_ir_v1.json" with { type: "json" };

const projectId = "11111111-1111-4111-8111-111111111111";
const params = {
  schemaVersion: 1,
  renderVersion: "remotion-render-v1",
  projectId,
  idempotencyKey: "remotion-contract-test",
  inputProps: {
    contractVersion: "remotion-runtime-v1",
    projectId,
    templateId: "timeline-preview",
    templateVersion: "timeline-preview-v1",
    bundleVersion: "remotion-bundle-v1",
    timeline,
  },
};

test("D03 shared contract is fixed, strict, and secret-free", () => {
  assert.equal(DESKTOP_IPC_CHANNELS.startRemotionJob, "desktop:v2:start-remotion-job");
  assert.equal(isRemotionRenderParams(params), true);
  assert.equal(isRemotionRenderParams({ ...params, credentialRef: "never" }), false);
  assert.equal(isRemotionRenderParams({ ...params, inputProps: { ...params.inputProps, templateVersion: "attacker" } }), false);
  assert.equal(isRemotionRenderParams({ ...params, inputProps: { ...params.inputProps, timeline: { ...timeline, sources: [{ ...timeline.sources[0], metadata: { secret: "never" } }, ...timeline.sources.slice(1)] } } }), false);
});

test("D03 Worker command payload rejects generic renderer paths and secrets", () => {
  const command = {
    protocolVersion: 1,
    type: "job-remotion-start",
    operationId: "op-d03-1",
    timestamp: 1,
    projectId,
    payload: { schemaVersion: 1, renderVersion: "remotion-render-v1", idempotencyKey: params.idempotencyKey, inputProps: params.inputProps },
  };
  assert.equal(isValidAgentWorkerCommand(command), true);
  assert.equal(isValidAgentWorkerCommand({ ...command, payload: { ...command.payload, rendererPath: "C:/run.js" } }), false);
  assert.equal(isValidAgentWorkerCommand({ ...command, payload: { ...command.payload, credentialRef: "secret-ref" } }), false);
});

test("D03 result contract exposes only project-relative controlled outputs", () => {
  const result = {
    schemaVersion: 1,
    resultVersion: "remotion-render-result-v1",
    projectId,
    runtimeMode: "offline-contract",
    templateId: "timeline-preview",
    templateVersion: "timeline-preview-v1",
    bundleVersion: "remotion-bundle-v1",
    cacheStatus: "created",
    cacheKey: "a".repeat(64),
    bundleCacheKey: "b".repeat(64),
    timelineDigest: "c".repeat(64),
    output: { artifactKind: "render-contract", relativePath: `generated/remotion-v1/renders/${"a".repeat(64)}.json`, manifestPath: `generated/remotion-v1/renders/${"a".repeat(64)}.manifest.json`, sizeBytes: 10, sha256: "d".repeat(64) },
    player: { availability: "contract-only", compositionId: "timeline-preview-v1", playbackUri: `supervideo://remotion/${projectId}/${"a".repeat(64)}` },
  };
  assert.equal(isRemotionRenderResult(result), true);
  assert.equal(isRemotionRenderResult({ ...result, output: { ...result.output, relativePath: "C:/outside.json" } }), false);
  assert.equal(isRemotionRenderResult({ ...result, player: { ...result.player, playbackUri: "file:///secret" } }), false);
});
