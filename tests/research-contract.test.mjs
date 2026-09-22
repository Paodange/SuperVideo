import assert from "node:assert/strict";
import test from "node:test";
import {
  isResearchSaveSourceParams,
  isResearchSaveSourceResult,
  isResearchSearchParams,
  isResearchSearchResult,
} from "@supervideo/shared";

const projectId = "11111111-1111-4111-8111-111111111111";
const digest = "a".repeat(64);

function source(index = "a") {
  return {
    url: `https://example.com/research/${index}`,
    title: `离线样例 ${index}`,
    summary: "这是用于契约测试的未核实摘要。",
    siteName: "example.com",
    author: null,
    fetchedAtMs: 1760000000000,
    contentDigest: digest,
    sourceDigest: digest,
    evidence: {
      status: "unverified",
      citations: [{ citationId: "citation-1", locator: "summary", quote: "这是用于契约测试的未核实摘要。" }],
      facts: [{ factId: "fact-1", statement: "该陈述需要用户核实。", citationIds: ["citation-1"] }],
    },
    provenance: { transport: "deterministic-fake-v1", fixtureId: `fixture-${index}` },
  };
}

function searchParams(overrides = {}) {
  return {
    schemaVersion: 1,
    contractVersion: "research-v1",
    projectId,
    requestId: "request-1",
    idempotencyKey: "search-key-1",
    topic: "招聘岗位",
    audience: "求职者",
    query: "招聘岗位",
    limit: 2,
    timeoutMs: 1000,
    ...overrides,
  };
}

test("E01 TS contract accepts bounded search/save shapes and deterministic ranks", () => {
  assert.equal(isResearchSearchParams(searchParams()), true);
  const first = source("a");
  const second = source("b");
  const result = {
    schemaVersion: 1,
    contractVersion: "research-v1",
    projectId,
    requestId: "request-1",
    idempotencyKey: "search-key-1",
    searchId: "search-1",
    status: "fresh",
    topic: "招聘岗位",
    audience: "求职者",
    query: "招聘岗位",
    limit: 2,
    transport: "deterministic-fake-v1",
    createdAtMs: 1760000000000,
    results: [{ ...first, rank: 1, matchScore: 0.9 }, { ...second, rank: 2, matchScore: 0.8 }],
  };
  assert.equal(isResearchSearchResult(result), true);
  const save = { schemaVersion: 1, contractVersion: "research-v1", projectId, requestId: "save-1", idempotencyKey: "save-1", source: first };
  assert.equal(isResearchSaveSourceParams(save), true);
  assert.equal(isResearchSaveSourceResult({ schemaVersion: 1, contractVersion: "research-v1", projectId, requestId: "save-1", idempotencyKey: "save-1", status: "created", record: { ...first, sourceId: "source-1", projectId, createdAtMs: 1760000000000 } }), true);
});

test("E01 TS contract rejects unknown fields, secrets, internal URLs, and forged evidence status", () => {
  assert.equal(isResearchSearchParams({ ...searchParams(), unknown: true }), false);
  assert.equal(isResearchSearchParams(searchParams({ query: "apiKey=do-not-store" })), false);
  assert.equal(isResearchSearchParams(searchParams({ topic: "C:\\private\\topic.txt" })), false);
  for (const url of [
    "file:///private/source",
    "javascript:alert(1)",
    "https://user:pass@example.com/source",
    "https://127.0.0.1/source",
    "https://192.168.1.2/source",
    "https://example.com/source?signature=fixture-value",
    "https://example.com/a/../b",
  ]) assert.equal(isResearchSaveSourceParams({ schemaVersion: 1, contractVersion: "research-v1", projectId, requestId: "save-1", idempotencyKey: "save-1", source: { ...source(), url } }), false);
  assert.equal(isResearchSaveSourceParams({ schemaVersion: 1, contractVersion: "research-v1", projectId, requestId: "save-1", idempotencyKey: "save-1", source: { ...source(), evidence: { ...source().evidence, status: "verified" } } }), false);
});
