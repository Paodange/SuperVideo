import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DESKTOP_IPC_CHANNELS,
  isValidAgentWorkerCommand,
  isJobTtsStartParams,
  isTtsStartRequest,
  isTtsSynthesisResult,
} from "@supervideo/shared";
import { ProviderConfigService, createDeterministicProviderRegistry } from "../apps/desktop/dist/main/providers/provider-service.js";
import { InMemoryProviderRegistry } from "../apps/desktop/dist/main/providers/provider-service.js";
import { ProviderConfigStore } from "../apps/desktop/dist/main/providers/provider-config-store.js";

const projectId = "11111111-1111-4111-8111-111111111111";

function request(voice = "alloy", providerId = "fake") {
  return {
    projectId,
    idempotencyKey: "tts-test-1",
    providerId,
    voice,
    sentences: [{ sentenceId: "s-1", text: "Hello.", provenanceIds: ["script-1"] }],
  };
}

test("D02 shared TTS boundaries are versioned and secret-free", () => {
  assert.equal(DESKTOP_IPC_CHANNELS.startTtsJob, "desktop:v2:start-tts-job");
  assert.equal(isTtsStartRequest(request()), true);
  assert.equal(isTtsStartRequest({ ...request(), secret: "never" }), false);
  assert.equal(isTtsStartRequest({ ...request(), credentialRef: "cred-leak" }), false);
  assert.equal(isJobTtsStartParams({ ...request(), model: "fake-tts-v1" }), true);

  const command = {
    protocolVersion: 1,
    type: "job-tts-start",
    operationId: "op-1",
    timestamp: 1,
    projectId,
    payload: { idempotencyKey: "tts-test-1", providerId: "fake", model: "fake-tts-v1", voice: "alloy", sentences: request().sentences },
  };
  assert.equal(isValidAgentWorkerCommand(command), true);
  assert.equal(isValidAgentWorkerCommand({ ...command, payload: { ...command.payload, secret: "never" } }), false);
});

test("Main resolves fake TTS through D01 capability metadata without returning a credential", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "supervideo-d02-provider-"));
  try {
    const vault = { list: async () => ({ items: [] }) };
    const service = new ProviderConfigService(vault, new ProviderConfigStore(path.join(directory, "providers.v1.json")), createDeterministicProviderRegistry());
    await service.upsert({ projectId, serviceKind: "tts", providerId: "fake", displayName: "Offline fake TTS", model: "fake-tts-v1" });
    const resolved = await service.resolveTts(request());
    assert.deepEqual(resolved, { ...request(), model: "fake-tts-v1" });
    assert.equal("credentialRef" in resolved, false);
    assert.equal("secret" in resolved, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("D02 result validation rejects output outside the project generated boundary", () => {
  const result = {
    schemaVersion: 1,
    contractVersion: 1,
    adapterVersion: "fake-tts-v1",
    projectId,
    cacheStatus: "created",
    cacheKey: "a".repeat(64),
    providerId: "fake",
    model: "fake-tts-v1",
    voice: "alloy",
    durationMs: 300,
    sentences: [{ sentenceId: "s-1", text: "Hello.", startMs: 0, endMs: 300, provenanceIds: [] }],
    output: { kind: "audio", relativePath: `generated/tts-v1/${"a".repeat(64)}.wav`, sizeBytes: 100, durationMs: 300, outputFingerprint: "b".repeat(64) },
    provenance: { kind: "generated", providerId: "fake", model: "fake-tts-v1", voice: "alloy", adapterVersion: "fake-tts-v1" },
  };
  assert.equal(isTtsSynthesisResult(result), true);
  assert.equal(isTtsSynthesisResult({ ...result, output: { ...result.output, relativePath: "C:/outside.wav" } }), false);
});

test("future real TTS adapters receive the secret only inside the Main vault callback", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "supervideo-d02-real-seam-"));
  try {
    let seenSecret = null;
    const registry = new InMemoryProviderRegistry();
    registry.register({
      descriptor: { providerId: "remote", serviceKind: "tts", capabilities: ["speech.synthesize"] },
      health: async () => null,
      synthesizeTts: async (secret, input) => {
        seenSecret = secret;
        assert.equal(input.projectId, projectId);
        assert.equal(input.model, "remote-v1");
        assert.equal("credentialRef" in input, false);
        return { audioBytes: new Uint8Array([1, 2, 3]), durationMs: 120 };
      },
    });
    const vault = {
      list: async () => ({ items: [{ credentialRef: "cred-remote", serviceKind: "tts", providerId: "remote", displayName: "remote", configured: true, createdAtMs: 1, updatedAtMs: 1 }] }),
      runWithSecret: async (ref, callback) => {
        assert.equal(ref, "cred-remote");
        return callback("secret-never-crosses-the-wire");
      },
    };
    const service = new ProviderConfigService(vault, new ProviderConfigStore(path.join(directory, "providers.v1.json")), registry);
    await service.upsert({ projectId, serviceKind: "tts", providerId: "remote", displayName: "Remote TTS", model: "remote-v1", credentialRef: "cred-remote" });
    const output = await service.synthesizeTts(request("alloy", "remote"));
    assert.equal(seenSecret, "secret-never-crosses-the-wire");
    assert.deepEqual(output, { audioBytes: new Uint8Array([1, 2, 3]), durationMs: 120 });
    assert.equal(JSON.stringify(output).includes("secret-never-crosses-the-wire"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
