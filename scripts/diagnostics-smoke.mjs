import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);
const shared = require(path.join(root, "packages", "shared", "dist", "index.js"));
const { CredentialVault } = require(path.join(root, "apps", "desktop", "dist", "main", "security", "credential-vault.js"));
const { createStructuredLogger } = require(path.join(root, "apps", "desktop", "dist", "main", "observability", "logger.js"));
const { DiagnosticsCollector } = require(path.join(root, "apps", "desktop", "dist", "main", "diagnostics", "collector.js"));
const { exportDiagnostics } = require(path.join(root, "apps", "desktop", "dist", "main", "diagnostics", "exporter.js"));
const { PythonCoreClient } = await import(pathToFileURL(path.join(root, "workers", "agent", "dist", "python-core-client.js")).href);

const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supervideo-a08-diagnostics-"));
const userData = path.join(smokeRoot, "user-data");
const projectRoot = path.join(smokeRoot, "project");
const logDirectory = path.join(userData, "logs");
const vaultPath = path.join(userData, "security", "credentials.v1.json");
const diagnosticsPath = path.join(smokeRoot, "supervideo-diagnostics.json");
const sentinel = `A08_FAKE_SENTINEL_${crypto.randomUUID().replaceAll("-", "")}`;
const operationId = "op-a08-smoke";

function createFakeEncryptionAdapter() {
  // Test-only reversible adapter. Production wiring uses Electron safeStorage.
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8").map((byte, index) => byte ^ ((index * 31 + 0xa5) & 0xff)),
    decryptString: (value) => Buffer.from(value).map((byte, index) => byte ^ ((index * 31 + 0xa5) & 0xff)).toString("utf8"),
  };
}

function collectFiles(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(candidate));
    else if (entry.isFile()) files.push(candidate);
  }
  return files;
}

function assertNoSentinel(files) {
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), file);
  }
}

async function main() {
  fs.mkdirSync(projectRoot);

  const vault = new CredentialVault({ filePath: vaultPath, encryption: createFakeEncryptionAdapter() });
  const metadata = await vault.save({ serviceKind: "llm", providerId: "fake-provider", displayName: "A08 smoke", secret: sentinel });
  assert.equal(metadata.configured, true);
  assert.equal(JSON.stringify(metadata).includes(sentinel), false);
  const vaultOnDisk = fs.readFileSync(vaultPath, "utf8");
  assert.equal(vaultOnDisk.includes(sentinel), false);
  assert.match(vaultOnDisk, /encryptedValueBase64/);

  const logger = createStructuredLogger({ logDirectory, maxFileBytes: 2 * 1024, maxFiles: 3 });
  logger("core-ready", { coreVersion: "0.1.0", capabilityCount: 8 });
  let project;
  let job;
  const core = new PythonCoreClient({ rootDir: root, onDiagnostic: (line) => {
    try {
      const event = JSON.parse(line);
      if (event && event.component === "python-core" && shared.isAgentDiagnosticEvent(event)) logger.writeDiagnostic(event);
    } catch {
      logger("core-stderr-rejected", { reason: "invalid-structured-stderr" });
    }
  }, onJobEvent: (event) => logger("job-event", { projectId: event.projectId, jobId: event.jobId, sequence: event.sequence, status: event.status, eventType: event.eventType, progress: event.progress }) });
  try {
  await core.start();
  project = await core.createProject({ name: "A08 smoke project", targetPlatform: "douyin", projectRoot });
  logger("job-operation-started", { operation: "job-smoke-start", operationId, projectId: project.projectId, prompt: sentinel, url: `https://example.test/run?token=${sentinel}#fragment`, path: "C:\\Users\\fixture\\private.mp4" });
  job = await core.startSmokeJob({ projectId: project.projectId, idempotencyKey: "a08-diagnostics-smoke", steps: 3, delayMs: 10, failAttempts: 0 });
  const deadline = Date.now() + 10_000;
  while (job.status !== "succeeded" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    job = await core.getJob({ projectId: project.projectId, jobId: job.jobId });
  }
  assert.equal(job.status, "succeeded");
  logger("job-event", { projectId: project.projectId, jobId: job.jobId, operationId, sequence: job.lastEventSequence, status: job.status, progress: job.progress, eventType: "succeeded", authorization: `Bearer ${sentinel}` });
  const collector = new DiagnosticsCollector({
    appVersion: "0.1.0", electronVersion: "44.3.0", nodeVersion: process.versions.node, pythonCoreVersion: "0.1.0",
    platform: process.platform, release: process.platform === "win32" ? "10.0.0" : process.platform, architecture: process.arch,
    getWorkerStatus: () => ({ status: "ready", generation: 1, activeRunId: null, runStatus: "idle", restartCount: 0, lastErrorCode: null, workerVersion: "0.1.0", capabilities: ["jobs", "diagnostics"] }),
    getCoreState: () => ({ status: "ready", protocolVersion: 1, coreVersion: "0.1.0", capabilityCount: 8 }),
    getProject: () => ({ open: true, manifestSchemaVersion: project.manifestSchemaVersion, databaseSchemaVersion: project.databaseSchemaVersion }),
    getJobs: () => [job],
    vault,
    logger,
  });

  const exportResult = await exportDiagnostics({ owner: {}, showSaveDialog: async () => ({ canceled: false, filePath: diagnosticsPath }), collector, now: () => 1700000003000 });
  assert.deepEqual(exportResult, { status: "saved" });
  await logger.flush();
  const diagnostics = JSON.parse(fs.readFileSync(diagnosticsPath, "utf8"));
  assert.equal(shared.isDiagnosticDocument(diagnostics), true);
  assert.equal(diagnostics.credentials.configuredByServiceKind.llm, 1);
  assert.equal(diagnostics.jobs.countsByStatus.succeeded, 1);
  assert.ok(diagnostics.recentLogs.some((event) => event.correlationId === job.jobId));
  assert.ok(fs.statSync(diagnosticsPath).size <= shared.DIAGNOSTICS_MAX_FILE_BYTES);
  assertNoSentinel([...collectFiles(logDirectory), diagnosticsPath, ...collectFiles(projectRoot)]);

  } finally {
    await core.shutdown();
  }

  const removed = await vault.remove({ credentialRef: metadata.credentialRef });
  assert.deepEqual(removed, { removed: true });
  assert.deepEqual((await vault.list()).items, []);
  console.log("Diagnostics, redaction and credential vault smoke passed.");
}

try {
  await main();
} catch (error) {
  console.error(`[diagnostics:smoke] ${error instanceof Error ? error.message : "failed"}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(smokeRoot, { recursive: true, force: true });
}
