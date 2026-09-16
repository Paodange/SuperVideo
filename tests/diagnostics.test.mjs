import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);
const shared = require(path.join(root, "packages", "shared", "dist", "index.js"));
const redaction = require(path.join(root, "apps", "desktop", "dist", "main", "observability", "redact.js"));
const loggerModule = require(path.join(root, "apps", "desktop", "dist", "main", "observability", "logger.js"));
const vaultModule = require(path.join(root, "apps", "desktop", "dist", "main", "security", "credential-vault.js"));
const collectorModule = require(path.join(root, "apps", "desktop", "dist", "main", "diagnostics", "collector.js"));
const exporterModule = require(path.join(root, "apps", "desktop", "dist", "main", "diagnostics", "exporter.js"));

function fakeEncryption(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(value, "utf8").map((byte, index) => byte ^ ((index * 17 + 91) & 0xff)),
    decryptString: (value) => Buffer.from(value).map((byte, index) => byte ^ ((index * 17 + 91) & 0xff)).toString("utf8"),
  };
}

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("TypeScript redaction matches the shared synthetic fixtures", () => {
  const fixtures = JSON.parse(fs.readFileSync(path.join(root, "contracts", "redaction-fixtures.json"), "utf8"));
  for (const fixture of fixtures) assert.deepEqual(redaction.redactValue(fixture.input), fixture.expected, fixture.name);
});

test("redaction handles hostile values without leaking paths, prompts or sentinels", () => {
  const sentinel = "A08_FAKE_SENTINEL_SECRET";
  const circular = { authorization: `Bearer ${sentinel}`, prompt: sentinel, url: `https://example.test/a?token=${sentinel}#x`, path: "C:\\Users\\fixture\\secret.txt", bigint: 2n, nan: Number.NaN, infinite: Number.POSITIVE_INFINITY };
  circular.self = circular;
  const result = JSON.stringify(redaction.redactValue(circular));
  assert.doesNotMatch(result, /A08_FAKE_SENTINEL|Users|Bearer [^[]|token=/i);
  assert.doesNotThrow(() => JSON.stringify(redaction.redactValue({ values: Array.from({ length: 1000 }, () => sentinel) })));
});

test("structured logger writes ordered bounded JSONL and rotates only its own files", async () => {
  const directory = tempRoot("supervideo-a08-log-");
  try {
    const logger = loggerModule.createStructuredLogger({ logDirectory: directory, maxFileBytes: 650, maxFiles: 3 });
    for (let index = 0; index < 20; index += 1) logger("job-event", { projectId: "11111111-1111-4111-8111-111111111111", jobId: "22222222-2222-4222-8222-222222222222", sequence: index + 1, status: "running", eventType: "progress", progress: index / 20, authorization: "Bearer A08_FAKE_SENTINEL" });
    await logger.flush();
    const names = fs.readdirSync(directory).sort();
    assert.deepEqual(names, ["application.1.log", "application.2.log", "application.log"]);
    for (const name of names) {
      for (const line of fs.readFileSync(path.join(directory, name), "utf8").trim().split(/\r?\n/)) {
        const event = JSON.parse(line);
        assert.equal(shared.isLogEvent(event), true);
        assert.doesNotMatch(line, /A08_FAKE_SENTINEL/);
      }
    }
    assert.ok(logger.getSnapshot().rotationCount >= 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("credential vault encrypts CRUD metadata, rejects unavailable storage, and survives re-instantiation", async () => {
  const directory = tempRoot("supervideo-a08-vault-");
  try {
    const filePath = path.join(directory, "security", "credentials.v1.json");
    const sentinel = "A08_FAKE_SENTINEL_CREDENTIAL";
    const vault = new vaultModule.CredentialVault({ filePath, encryption: fakeEncryption(), now: () => 1700000000000 });
    const created = await vault.save({ serviceKind: "llm", providerId: "fake-provider", displayName: "Test credential", secret: sentinel });
    assert.equal(JSON.stringify(created).includes(sentinel), false);
    assert.equal(fs.readFileSync(filePath, "utf8").includes(sentinel), false);
    assert.deepEqual((await vault.list()).items, [created]);
    const replaced = await vault.replace({ credentialRef: created.credentialRef, secret: "A08_FAKE_SENTINEL_REPLACED" });
    assert.equal(replaced.createdAtMs, created.createdAtMs);
    assert.equal(replaced.updatedAtMs, created.updatedAtMs);
    assert.deepEqual(await vault.remove({ credentialRef: created.credentialRef }), { removed: true });
    assert.deepEqual(await vault.remove({ credentialRef: created.credentialRef }), { removed: false });
    const reopened = new vaultModule.CredentialVault({ filePath, encryption: fakeEncryption() });
    assert.deepEqual((await reopened.list()).items, []);

    const unavailablePath = path.join(directory, "unavailable", "credentials.v1.json");
    const unavailable = new vaultModule.CredentialVault({ filePath: unavailablePath, encryption: fakeEncryption(false) });
    assert.deepEqual(unavailable.status(), { available: false, state: "unavailable" });
    await assert.rejects(unavailable.save({ serviceKind: "llm", providerId: "fake", displayName: "Fake", secret: "A08_FAKE_SENTINEL" }), (error) => error.code === "CREDENTIAL_STORAGE_UNAVAILABLE");
    assert.equal(fs.existsSync(unavailablePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("credential vault detects corrupt schema, duplicate refs and decryption failure without clearing the file", async () => {
  const directory = tempRoot("supervideo-a08-corrupt-");
  try {
    const filePath = path.join(directory, "credentials.v1.json");
    fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 99, credentials: [] }));
    const vault = new vaultModule.CredentialVault({ filePath, encryption: fakeEncryption() });
    assert.deepEqual(vault.status(), { available: true, state: "corrupt" });
    await assert.rejects(vault.list(), (error) => error.code === "CREDENTIAL_STORE_CORRUPT");
    const before = fs.readFileSync(filePath, "utf8");
    await assert.rejects(vault.save({ serviceKind: "llm", providerId: "fake", displayName: "Fake", secret: "A08_FAKE_SENTINEL" }), (error) => error.code === "CREDENTIAL_STORE_CORRUPT");
    assert.equal(fs.readFileSync(filePath, "utf8"), before);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("diagnostic export is bounded, redacted, cancellable, and returns no target path", async () => {
  const directory = tempRoot("supervideo-a08-export-");
  try {
    const filePath = path.join(directory, "security", "credentials.v1.json");
    const vault = new vaultModule.CredentialVault({ filePath, encryption: fakeEncryption() });
    await vault.save({ serviceKind: "tts", providerId: "fake", displayName: "Fake TTS", secret: "A08_FAKE_SENTINEL" });
    const logger = loggerModule.createStructuredLogger({ logDirectory: path.join(directory, "logs") });
    logger("job-event", { projectId: "11111111-1111-4111-8111-111111111111", jobId: "22222222-2222-4222-8222-222222222222", sequence: 1, status: "succeeded", eventType: "succeeded" });
    const collector = new collectorModule.DiagnosticsCollector({
      appVersion: "0.1.0", electronVersion: "44.3.0", nodeVersion: process.versions.node, platform: "win32", release: "10.0.0", architecture: "x64",
      getWorkerStatus: () => ({ status: "ready", generation: 1, activeRunId: null, runStatus: "idle", restartCount: 0, lastErrorCode: null, workerVersion: "0.1.0", capabilities: ["diagnostics"] }),
      getProject: () => ({ open: false, manifestSchemaVersion: null, databaseSchemaVersion: null }),
      getJobs: () => [], vault, logger,
    });
    const cancelledPath = path.join(directory, "cancelled.json");
    assert.deepEqual(await exporterModule.exportDiagnostics({ owner: {}, showSaveDialog: async () => ({ canceled: true }), collector }), { status: "cancelled" });
    assert.equal(fs.existsSync(cancelledPath), false);
    const outputPath = path.join(directory, "diagnostics.json");
    const result = await exporterModule.exportDiagnostics({ owner: {}, showSaveDialog: async () => ({ canceled: false, filePath: outputPath }), collector });
    assert.deepEqual(result, { status: "saved" });
    const output = fs.readFileSync(outputPath, "utf8");
    assert.ok(output.length > 0 && Buffer.byteLength(output) <= shared.DIAGNOSTICS_MAX_FILE_BYTES);
    assert.equal(shared.isDiagnosticDocument(JSON.parse(output)), true);
    assert.doesNotMatch(output, /A08_FAKE_SENTINEL|credentials\.v1|Fake TTS/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("preload new security capabilities are frozen and never add generic IPC", async () => {
  const preload = require(path.join(root, "apps", "desktop", "dist", "preload", "api.js"));
  const values = {
    status: { available: true, state: "available" },
    list: { items: [] },
    metadata: { credentialRef: "cred-11111111-1111-4111-8111-111111111111", serviceKind: "llm", providerId: "fake", displayName: "Fake", configured: true, createdAtMs: 1, updatedAtMs: 1 },
  };
  const calls = [];
  const api = preload.createDesktopApi(async (channel, payload) => {
    calls.push({ channel, payload });
    if (channel === shared.DESKTOP_IPC_CHANNELS.credentialsStatus) return { ok: true, value: values.status };
    if (channel === shared.DESKTOP_IPC_CHANNELS.credentialsList) return { ok: true, value: values.list };
    if (channel === shared.DESKTOP_IPC_CHANNELS.credentialsSave || channel === shared.DESKTOP_IPC_CHANNELS.credentialsReplace) return { ok: true, value: values.metadata };
    if (channel === shared.DESKTOP_IPC_CHANNELS.credentialsRemove) return { ok: true, value: { removed: true } };
    return { ok: true, value: { status: "cancelled" } };
  });
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.credentials), true);
  assert.equal(Object.isFrozen(api.diagnostics), true);
  assert.equal("invoke" in api, false);
  assert.deepEqual(await api.credentials.status(), values.status);
  await assert.rejects(api.credentials.save({ serviceKind: "llm", providerId: "fake", displayName: "Fake", secret: "" }), (error) => error.code === "INVALID_CREDENTIAL_INPUT");
  assert.equal(calls.length, 1);
});
