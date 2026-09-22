import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { PythonCoreClient } = await import(pathToFileURL(path.join(root, "workers", "agent", "dist", "python-core-client.js")).href);
const client = new PythonCoreClient({ rootDir: root, requestTimeoutMs: 5_000 });
const projectRoot = await mkdtemp(path.join(os.tmpdir(), "supervideo-e01-"));

try {
  await client.start();
  const project = await client.createProject({ name: "E01 research smoke", targetPlatform: "douyin", projectRoot });
  const request = {
    schemaVersion: 1,
    contractVersion: "research-v1",
    projectId: project.projectId,
    requestId: "smoke-search-1",
    idempotencyKey: "smoke-search-key-1",
    topic: "招聘岗位",
    audience: "求职者",
    query: "招聘岗位",
    limit: 2,
    timeoutMs: 1000,
  };
  const search = await client.searchResearch(request);
  assert.equal(search.results.length, 2);
  assert.deepEqual(search.results.map((item) => item.rank), [1, 2]);
  const { rank: _rank, matchScore: _matchScore, ...source } = search.results[0];
  const saveRequest = {
    schemaVersion: 1,
    contractVersion: "research-v1",
    projectId: project.projectId,
    requestId: "smoke-save-1",
    idempotencyKey: "smoke-save-key-1",
    source,
  };
  const created = await client.saveResearchSource(saveRequest);
  const existing = await client.saveResearchSource(saveRequest);
  assert.equal(created.status, "created");
  assert.equal(existing.status, "existing");
  assert.equal(created.record.sourceId, existing.record.sourceId);
  console.log(`E01 research API smoke passed (${search.results.length} deterministic results, source=${created.record.sourceId}).`);
} finally {
  await client.shutdown();
  await rm(projectRoot, { recursive: true, force: true });
}
