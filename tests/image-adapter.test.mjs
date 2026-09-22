import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DESKTOP_IPC_CHANNELS,
  isImageGenerationResult,
  isImageJobStartParams,
  isImageStartRequest,
  isValidAgentWorkerCommand,
} from "@supervideo/shared";
import { InMemoryProviderRegistry, ProviderConfigService, createDeterministicProviderRegistry } from "../apps/desktop/dist/main/providers/provider-service.js";
import { ProviderConfigStore } from "../apps/desktop/dist/main/providers/provider-config-store.js";

const projectId = "11111111-1111-4111-8111-111111111111";

function request(overrides = {}) {
  return {
    projectId,
    idempotencyKey: "image-test-1",
    providerId: "fake",
    shotId: "d05-shot-1",
    prompt: "A clean factory dormitory for a recruitment shot.",
    parameters: { width: 128, height: 128, steps: 8, seed: 7 },
    source: { kind: "d05-shot", id: "d05:shot:1" },
    provenance: [{ kind: "script", id: "d05:script:shot-1" }, { kind: "fact", id: "fact:verified-1" }],
    ...overrides,
  };
}

test("D06 image contract is versioned, bounded and secret/path-free", () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/d06_image_generation_v1.json", import.meta.url), "utf8"));
  assert.equal(isImageJobStartParams(fixture), true);
  assert.equal(DESKTOP_IPC_CHANNELS.startImageJob, "desktop:v2:start-image-job");
  assert.equal(isImageStartRequest(request()), true);
  assert.equal(isImageJobStartParams({ ...request(), model: "fake-image-v1" }), true);
  for (const invalid of [
    { ...request(), credentialRef: "cred-never" },
    { ...request(), prompt: "https://example.invalid/image" },
    { ...request(), prompt: "api_key=FAKE_SENTINEL" },
    { ...request(), prompt: "C:\\outside\\image.png" },
    { ...request(), parameters: { ...request().parameters, command: "curl" } },
  ]) assert.equal(isImageStartRequest(invalid), false);

  const command = {
    protocolVersion: 1,
    type: "job-image-start",
    operationId: "op-image-1",
    timestamp: 1,
    projectId,
    payload: { idempotencyKey: request().idempotencyKey, providerId: "fake", shotId: request().shotId, prompt: request().prompt, parameters: request().parameters, source: request().source, provenance: request().provenance },
  };
  assert.equal(isValidAgentWorkerCommand(command), true);
  assert.equal(isValidAgentWorkerCommand({ ...command, payload: { ...command.payload, token: "FAKE_SENTINEL" } }), false);
});

test("Main resolves image capability without moving credential metadata into Core", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "supervideo-d06-provider-"));
  try {
    const service = new ProviderConfigService({ list: async () => ({ items: [] }) }, new ProviderConfigStore(path.join(directory, "providers.v1.json")), createDeterministicProviderRegistry());
    await service.upsert({ projectId, serviceKind: "image", providerId: "fake", displayName: "Offline fake image", model: "fake-image-v1" });
    const resolved = await service.resolveImage(request());
    assert.deepEqual(resolved, { ...request(), model: "fake-image-v1" });
    assert.equal("credentialRef" in resolved, false);
    await assert.rejects(() => service.resolveImage({ ...request(), providerId: "missing" }), (error) => error.code === "PROVIDER_UNAVAILABLE");
    const badRegistry = new InMemoryProviderRegistry();
    badRegistry.register({ descriptor: { providerId: "bad-image", serviceKind: "image", capabilities: ["video.generate"] }, health: async () => null });
    const badService = new ProviderConfigService({ list: async () => ({ items: [] }) }, new ProviderConfigStore(path.join(directory, "bad-providers.v1.json")), badRegistry);
    await badService.upsert({ projectId, serviceKind: "image", providerId: "bad-image", displayName: "Wrong capability", model: "bad-v1" });
    await assert.rejects(() => badService.resolveImage({ ...request(), providerId: "bad-image" }), (error) => error.code === "PROVIDER_UNAVAILABLE");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("future real image adapter sees the secret only inside the Main callback", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "supervideo-d06-real-seam-"));
  try {
    let seenSecret = null;
    const registry = new InMemoryProviderRegistry();
    registry.register({
      descriptor: { providerId: "remote", serviceKind: "image", capabilities: ["image.generate"] },
      health: async () => null,
      generateImage: async (secret, input) => {
        seenSecret = secret;
        assert.equal(input.projectId, projectId);
        assert.equal(input.model, "remote-image-v1");
        assert.equal("credentialRef" in input, false);
        return { imageBytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
      },
    });
    const vault = {
      list: async () => ({ items: [{ credentialRef: "cred-remote", serviceKind: "image", providerId: "remote", displayName: "remote", configured: true, createdAtMs: 1, updatedAtMs: 1 }] }),
      runWithSecret: async (ref, callback) => { assert.equal(ref, "cred-remote"); return callback("secret-never-crosses-the-wire"); },
    };
    const service = new ProviderConfigService(vault, new ProviderConfigStore(path.join(directory, "providers.v1.json")), registry);
    await service.upsert({ projectId, serviceKind: "image", providerId: "remote", displayName: "Remote image", model: "remote-image-v1", credentialRef: "cred-remote" });
    const output = await service.generateImage({ ...request(), providerId: "remote" });
    assert.equal(seenSecret, "secret-never-crosses-the-wire");
    assert.deepEqual(output, { imageBytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" });
    assert.equal(JSON.stringify(output).includes("secret-never-crosses-the-wire"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("D06 result rejects output/path/cache mismatches", () => {
  const cacheKey = "a".repeat(64);
  const result = {
    schemaVersion: 1, contractVersion: 1, adapterVersion: "fake-image-v1", projectId,
    cacheStatus: "created", cacheKey, providerId: "fake", model: "fake-image-v1", shotId: "d05-shot-1",
    prompt: request().prompt, parameters: request().parameters, source: request().source, provenance: request().provenance,
    output: { kind: "image", mimeType: "image/png", relativePath: `generated/images-v1/${cacheKey}.png`, sizeBytes: 100, width: 128, height: 128, outputFingerprint: "b".repeat(64) },
    generationProvenance: { kind: "generated", providerId: "fake", model: "fake-image-v1", adapterVersion: "fake-image-v1", source: request().source, provenance: request().provenance },
  };
  assert.equal(isImageGenerationResult(result), true);
  assert.equal(isImageGenerationResult({ ...result, output: { ...result.output, relativePath: "C:/outside.png" } }), false);
  assert.equal(isImageGenerationResult({ ...result, cacheKey: "c".repeat(64) }), false);
  assert.equal(isImageGenerationResult({ ...result, generationProvenance: { ...result.generationProvenance, model: "other" } }), false);
});
