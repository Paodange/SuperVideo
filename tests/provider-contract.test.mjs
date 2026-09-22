import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProviderConfigStore } from "../apps/desktop/dist/main/providers/provider-config-store.js";
import { ProviderConfigService, createDeterministicProviderRegistry } from "../apps/desktop/dist/main/providers/provider-service.js";
import {
  isProviderConfigInput,
  isProviderConfig,
  isProviderHealth,
  isProviderConfigListResult,
  isDesktopPublicErrorCode,
} from "../packages/shared/dist/index.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const input = {
  projectId,
  serviceKind: "llm",
  providerId: "fake",
  displayName: "Offline fake",
  model: "fake-pass",
  endpoint: null,
  credentialRef: "cred-test",
  capabilities: ["chat.generate", "chat.stream"],
  enabled: true,
};

test("D01 rejects extra keys, unsafe endpoints and oversized text", () => {
  assert.equal(isProviderConfigInput(input), true);
  assert.equal(isProviderConfigInput({ ...input, secret: "DO_NOT_USE" }), false);
  assert.equal(isProviderConfigInput({ ...input, endpoint: "javascript:alert(1)" }), false);
  assert.equal(isProviderConfigInput({ ...input, endpoint: "http://example.invalid/api" }), false);
  assert.equal(isProviderConfigInput({ ...input, displayName: "x".repeat(81) }), false);
});

test("D01 config and health wire shapes are bounded and secret-free", () => {
  const config = {
    schemaVersion: 1,
    protocolVersion: 1,
    ...input,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
  assert.equal(isProviderConfig(config), true);
  assert.equal(isProviderConfigListResult({ projectId, items: [config] }), true);
  assert.equal(isProviderConfigListResult({ projectId, items: [{ ...config, projectId: "22222222-2222-4222-8222-222222222222" }] }), false);
  assert.equal(isProviderHealth({
    schemaVersion: 1,
    protocolVersion: 1,
    projectId,
    serviceKind: "llm",
    providerId: "fake",
    status: "healthy",
    capabilities: ["chat.generate"],
    checkedAtMs: 1,
    latencyMs: 2,
    error: null,
  }), true);
});

test("Main provider service isolates projects and classifies offline health outcomes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "supervideo-d01-"));
  try {
    const credential = { credentialRef: "cred-test", serviceKind: "llm", providerId: "fake", displayName: "fake", configured: true, createdAtMs: 1, updatedAtMs: 1 };
    const vault = { list: async () => ({ items: [credential] }), runWithSecret: async (_ref, callback) => callback("secret-never-returned") };
    const service = new ProviderConfigService(vault, new ProviderConfigStore(path.join(directory, "providers.v1.json")), createDeterministicProviderRegistry());
    const make = (projectId, model) => service.upsert({ ...input, projectId, model });
    await make(projectId, "fake-pass");
    await make("22222222-2222-4222-8222-222222222222", "fake-auth");
    assert.equal(service.list(projectId).items.length, 1);
    assert.equal(service.list("33333333-3333-4333-8333-333333333333").items.length, 0);
    assert.equal((await service.health({ projectId, serviceKind: "llm", providerId: "fake" })).status, "healthy");
    for (const [model, errorCode] of [["fake-fail", "NETWORK_ERROR"], ["fake-auth", "AUTH_FAILED"], ["fake-timeout", "TIMEOUT"]]) {
      await make(projectId, model);
      const result = await service.health({ projectId, serviceKind: "llm", providerId: "fake" });
      assert.equal(result.status, "unhealthy");
      assert.equal(result.error.code, errorCode);
      assert.equal(JSON.stringify(result).includes("secret-never-returned"), false);
    }
    await assert.rejects(() => service.upsert({ ...input, providerId: "unknown" }), (error) => error.code === "PROVIDER_UNKNOWN");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("provider configs may be saved without a credential and report unconfigured health", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "supervideo-d01-no-credential-"));
  try {
    const vault = { list: async () => ({ items: [] }), runWithSecret: async () => { throw new Error("must not decrypt"); } };
    const service = new ProviderConfigService(vault, new ProviderConfigStore(path.join(directory, "providers.v1.json")), createDeterministicProviderRegistry());
    const config = { ...input, credentialRef: undefined };
    const saved = await service.upsert(config);
    assert.equal(saved.credentialRef, null);
    const health = await service.health({ projectId, serviceKind: "llm", providerId: "fake" });
    assert.equal(health.status, "unconfigured");
    assert.equal(health.error.code, "MISSING_CREDENTIAL");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unknown provider public error codes are rejected", () => {
  assert.equal(isDesktopPublicErrorCode("PROVIDER_NOT_DEFINED"), false);
  assert.equal(isDesktopPublicErrorCode("PROVIDER_UNKNOWN"), true);
});
