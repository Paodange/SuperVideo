import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const shared = await import(pathToFileURL(path.join(root, "packages", "shared", "dist", "index.js")).href);
const clientModule = await import(pathToFileURL(path.join(root, "workers", "agent", "dist", "python-core-client.js")).href);
const playback = await import(pathToFileURL(path.join(root, "apps", "desktop", "dist", "main", "media-playback.js")).href);
const { CoreRpcError, PythonCoreClient } = clientModule;

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function emitChunks(stream, value, splitAt = []) {
  const bytes = Buffer.from(value, "utf8");
  const cuts = [0, ...splitAt.filter((cut) => cut > 0 && cut < bytes.length), bytes.length].sort((a, b) => a - b);
  for (let index = 1; index < cuts.length; index += 1) {
    stream.emit("data", bytes.subarray(cuts[index - 1], cuts[index]));
  }
}

class FakeChild extends EventEmitter {
  constructor(onWrite) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killed = false;
    this.stdin = new EventEmitter();
    this.stdin.write = (chunk) => {
      onWrite(JSON.parse(String(chunk)));
      return true;
    };
    this.stdin.end = () => {
      this.emit("exit", 0, null);
    };
  }

  kill() {
    this.killed = true;
    this.emit("exit", null, "SIGTERM");
    return true;
  }
}

function fakeLaunch(onRequest) {
  let child;
  child = new FakeChild((request) => onRequest(child, request));
  return {
    child,
    spawnProcess(command, args, options) {
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.equal(args.at(-2), "-m");
      assert.equal(args.at(-1), "supervideo_core.rpc");
      return child;
    },
  };
}

test("golden fixtures are checked by the TypeScript runtime validator", () => {
  const fixtures = JSON.parse(readFileSync(path.join(root, "contracts", "core-rpc-fixtures.json"), "utf8"));
  for (const fixture of fixtures) {
    assert.equal(shared.isCoreRpcMessage(fixture.message), fixture.valid, fixture.name);
  }
});

test("B10 slot alignment validators enforce bounded input, order, and source binding", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const assetId = "22222222-2222-4222-8222-222222222222";
  const sentenceId = "a".repeat(64);
  const sourceDigest = "b".repeat(64);
  const params = { projectId, inputKind: "outline", inputText: "岗位介绍。\n月薪 8000 元。", candidateLimit: 3, useRerank: true, timeoutMs: 120000 };
  assert.equal(shared.isSlotAlignmentParams(params), true);
  assert.equal(shared.isSlotAlignmentParams({ ...params, inputText: "x".repeat(8193) }), false);
  const candidate = {
    rank: 1, origin: "b08-retrieval", sentenceId, sourceAssetId: assetId, sourceSentenceCacheKey: sourceDigest,
    sentenceIndex: 0, timecode: { startMs: 0, endMs: 1000 }, text: "岗位介绍。", score: 1, quality: "complete",
    previewUri: `supervideo://asset/${assetId}?kind=audio&startMs=0&endMs=1000`, selectionReason: "b08-hybrid-score;all-key-facts-preserved", preservedFacts: [],
  };
  const result = {
    schemaVersion: 1, alignmentVersion: "information-slot-alignment-v1", splitterVersion: "deterministic-slot-split-v1", projectId,
    inputKind: "outline", inputText: "岗位介绍。", sourceDigest: "c".repeat(64), slotCount: 1, matchedCount: 1,
    slots: [{ slotId: "slot-1", order: 1, kind: "context", sourceText: "岗位介绍。", query: "岗位介绍。", keyFacts: [], status: "matched", selectedCandidateRank: 1, candidates: [candidate], selectionReason: "b08-hybrid-score;all-key-facts-preserved", gapReason: null }],
  };
  assert.equal(shared.isSlotAlignmentResult(result), true, "shared validator checks the bounded digest shape; Core verifies its value");
  const unsafe = {
    ...result,
    inputText: "工资 7000 元。",
    slots: [{ ...result.slots[0], sourceText: "工资 7000 元。", query: "工资 7000 元。", keyFacts: ["7000 元"], candidates: [{ ...candidate, text: "工资 17000 元", preservedFacts: ["7000 元"] }] }],
  };
  assert.equal(shared.isSlotAlignmentResult(unsafe), false, "preserved facts must be extracted whole tokens, not substrings");
  const incomplete = {
    ...result,
    inputText: "工资 7000 元，地点上海。",
    slots: [{ ...result.slots[0], sourceText: "工资 7000 元，地点上海。", query: "工资 7000 元，地点上海。", keyFacts: ["7000 元", "上海"], candidates: [{ ...candidate, text: "工资 7000 元，地点上海。", preservedFacts: ["7000 元"] }] }],
  };
  assert.equal(shared.isSlotAlignmentResult(incomplete), false, "matched candidates must cover every slot fact");
});

test("C02 narrative plan validators keep hook-body-CTA provenance and deterministic gaps bounded", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const assetId = "22222222-2222-4222-8222-222222222222";
  const source = (startMs, endMs, index) => ({
    sourceAssetId: assetId, sourceSentenceCacheKey: "b".repeat(64), sentenceIndex: index,
    timecode: { startMs, endMs }, previewUri: `supervideo://asset/${assetId}?kind=audio&startMs=${startMs}&endMs=${endMs}`,
  });
  const segments = [
    { segmentId: "segment-1", order: 1, role: "hook", slotId: "slot-1", slotKind: "hook", sourceText: "开头。", status: "matched", candidateSentenceId: "a".repeat(64), candidateRank: 1, sentenceText: "开头。", source: source(0, 1000, 0), durationMs: 1000, selectionReason: "b09-quality-rerank;rank-1;complete;facts-preserved", gapReason: null },
    { segmentId: "segment-2", order: 2, role: "body", slotId: "slot-2", slotKind: "claim", sourceText: "主体。", status: "matched", candidateSentenceId: "c".repeat(64), candidateRank: 1, sentenceText: "主体。", source: source(1000, 2000, 1), durationMs: 1000, selectionReason: "b09-quality-rerank;rank-1;complete;facts-preserved", gapReason: null },
    { segmentId: "segment-3", order: 3, role: "cta", slotId: "slot-3", slotKind: "cta", sourceText: "CTA。", status: "gap", candidateSentenceId: null, candidateRank: null, sentenceText: null, source: null, durationMs: 0, selectionReason: null, gapReason: { segmentId: "segment-3", slotId: "slot-3", role: "cta", code: "alignment-gap", detail: "no-retrieval-candidates" } },
  ];
  const result = {
    schemaVersion: 1, planVersion: "narrative-remix-plan-v1", inputVersion: "deterministic-narrative-input-v1", projectId,
    theme: "招聘", audience: "求职者", outline: "开头。\n主体。\nCTA。", targetDurationMs: 2000, toleranceLowerMs: 1600, toleranceUpperMs: 2400,
    selectedDurationMs: 2000, durationStatus: "within-tolerance", status: "gaps", selectionPolicy: "b10-first-complete-candidate-v1", alignmentVersion: "information-slot-alignment-v1", planDigest: "d".repeat(64),
    segments, gaps: [segments[2].gapReason],
  };
  assert.equal(shared.isNarrativePlanParams({ projectId, theme: "招聘", audience: "求职者", targetDurationMs: 2000 }), true);
  assert.equal(shared.isNarrativePlanResult(result), true);
  assert.equal(shared.isNarrativePlanResult({ ...result, segments: [{ ...segments[0], sentenceText: "截断" }, ...segments.slice(1)] }), true, "runtime preserves bounded source text; Core owns source sentence completeness");
  assert.equal(shared.isNarrativePlanResult({ ...result, segments: [{ ...segments[0], source: { ...segments[0].source, timecode: { startMs: 0, endMs: 900 } } }, ...segments.slice(1)] }), false);
});

test("C03 duration optimization validators preserve whole-sentence operations and provenance", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const assetId = "22222222-2222-4222-8222-222222222222";
  const sentenceId = "a".repeat(64);
  const cacheKey = "b".repeat(64);
  const source = { sourceAssetId: assetId, sourceSentenceCacheKey: cacheKey, sentenceIndex: 0, timecode: { startMs: 0, endMs: 1000 }, previewUri: `supervideo://asset/${assetId}?kind=audio&startMs=0&endMs=1000` };
  const candidate = { rank: 1, origin: "b09-quality-rerank", sentenceId, sourceAssetId: assetId, sourceSentenceCacheKey: cacheKey, sentenceIndex: 0, timecode: { startMs: 0, endMs: 1000 }, text: "完整句子。", score: 1, quality: "complete", previewUri: source.previewUri, selectionReason: "complete", preservedFacts: [] };
  const alignment = { schemaVersion: 1, alignmentVersion: "information-slot-alignment-v1", splitterVersion: "deterministic-slot-split-v1", projectId, inputKind: "outline", inputText: "完整句子。", sourceDigest: "c".repeat(64), slotCount: 1, matchedCount: 1, slots: [{ slotId: "slot-1", order: 1, kind: "hook", sourceText: "完整句子。", query: "完整句子。", keyFacts: [], status: "matched", selectedCandidateRank: 1, candidates: [candidate], selectionReason: "complete", gapReason: null }] };
  const plan = { schemaVersion: 1, planVersion: "narrative-remix-plan-v1", inputVersion: "deterministic-narrative-input-v1", projectId, theme: "招聘", audience: "求职者", outline: "完整句子。", targetDurationMs: 1000, toleranceLowerMs: 800, toleranceUpperMs: 1200, selectedDurationMs: 1000, durationStatus: "within-tolerance", status: "ready", selectionPolicy: "b10-first-complete-candidate-v1", alignmentVersion: "information-slot-alignment-v1", planDigest: "d".repeat(64), segments: [{ segmentId: "segment-1", order: 1, role: "hook", slotId: "slot-1", slotKind: "hook", sourceText: "完整句子。", status: "matched", candidateSentenceId: sentenceId, candidateRank: 1, sentenceText: "完整句子。", source, durationMs: 1000, selectionReason: "complete", gapReason: null }], gaps: [] };
  const params = { projectId, sourcePlan: plan, alignment, timeoutMs: 120000 };
  assert.equal(shared.isDurationOptimizationParams(params), true);
  const sentence = { sentenceId, sentenceText: "完整句子。", source, durationMs: 1000, candidateRank: 1 };
  const result = { schemaVersion: 1, optimizationVersion: "duration-optimization-v1", projectId, sourcePlanDigest: plan.planDigest, targetDurationMs: 1000, toleranceLowerMs: 800, toleranceUpperMs: 1200, selectedDurationMs: 1000, durationStatus: "within-tolerance", status: "unchanged", selectionPolicy: "bounded-whole-sentence-knapsack-v1", segments: [{ segmentId: "segment-1", order: 1, role: "hook", slotId: "slot-1", slotKind: "hook", sourceText: "完整句子。", status: "matched", operation: "keep", candidateSentenceId: sentenceId, candidateRank: 1, sentenceText: "完整句子。", source, durationMs: 1000, selectionReason: "complete", gapReason: null }], changes: [{ segmentId: "segment-1", slotId: "slot-1", role: "hook", operation: "keep", before: sentence, after: sentence, selectionReason: "complete" }], gaps: [] };
  assert.equal(shared.isDurationOptimizationResult(result), true);
  assert.equal(shared.isDurationOptimizationResult({ ...result, changes: [{ ...result.changes[0], after: { ...sentence, source: { ...source, timecode: { startMs: 0, endMs: 900 }, previewUri: `supervideo://asset/${assetId}?kind=audio&startMs=0&endMs=900` }, durationMs: 900 } }] }), false);
  assert.equal(shared.isDurationOptimizationParams({ ...params, alignment: { ...alignment, projectId: "33333333-3333-4333-8333-333333333333" } }), false);
});

test("VAD runtime validator rejects a gap between otherwise valid intervals", () => {
  const base = {
    schemaVersion: 1,
    projectId: "11111111-1111-4111-8111-111111111111",
    assetId: "22222222-2222-4222-8222-222222222222",
    cacheStatus: "created",
    cacheKey: "a".repeat(64),
    adapterVersion: "ffmpeg-silencedetect-v1",
    durationMs: 1_000,
    config: { thresholdDb: -35, minSpeechMs: 120, minSilenceMs: 120, preRollMs: 120, postRollMs: 180, mergeGapMs: 120 },
    intervals: [
      { index: 0, startMs: 0, endMs: 300, isSpeech: true, confidence: null, quality: "detected" },
      { index: 1, startMs: 400, endMs: 1_000, isSpeech: false, confidence: null, quality: "silence" },
    ],
  };
  assert.equal(shared.isVadResult(base), false);
  assert.equal(shared.isVadResult({ ...base, intervals: [
    { ...base.intervals[0], endMs: 400 },
    { ...base.intervals[1], startMs: 400 },
  ] }), true);
});

test("sentence QA validators enforce the Python cache/text contract", () => {
  const base = {
    projectId: "11111111-1111-4111-8111-111111111111",
    assetId: "22222222-2222-4222-8222-222222222222",
    sentenceCacheKey: "a".repeat(64),
    sentenceIndex: 0,
  };
  assert.equal(shared.isSentenceQaParams(base), true);
  assert.equal(shared.isSentenceQaParams({ ...base, sentenceCacheKey: "A".repeat(64) }), false);
  assert.equal(shared.isSentenceQaSaveParams({ ...base, markers: [{ sentenceIndex: 0, issueType: "half-sentence", note: "", expectedText: "" }] }), true);
  assert.equal(shared.isSentenceQaSaveParams({ ...base, markers: [{ sentenceIndex: 0, issueType: "half-sentence", note: "\u0000" }] }), false);
});

test("retrieval validator binds preview URI to the source asset and timecode", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const assetId = "22222222-2222-4222-8222-222222222222";
  const candidate = {
    rank: 1,
    sentenceId: "a".repeat(64),
    sourceAssetId: assetId,
    sourceSentenceCacheKey: "b".repeat(64),
    sentenceIndex: 0,
    timecode: { startMs: 100, endMs: 500 },
    text: "招聘岗位",
    lexicalScore: 1,
    vectorScore: 0.5,
    hybridScore: 0.8,
    score: 0.8,
    explanation: {
      queryKeywords: ["招聘"],
      matchedKeywords: ["招聘"],
      matchedTopics: ["招聘就业"],
      vectorProvider: "sha256-hash-v1",
      scoreFormula: "hybrid-0.6-0.4-v1",
    },
    confidence: 0.9,
    quality: "complete",
    qualityReasons: [],
    previewUri: `supervideo://asset/${assetId}?kind=audio&startMs=100&endMs=500`,
  };
  const result = {
    schemaVersion: 1,
    retrievalVersion: "hybrid-retrieval-v1",
    projectId,
    query: "招聘",
    mode: "hybrid",
    limit: 1,
    candidateCount: 1,
    candidates: [candidate],
  };
  assert.equal(shared.isRetrievalResult(result), true);
  assert.equal(shared.isRetrievalResult({ ...result, candidates: [{ ...candidate, previewUri: `supervideo://asset/${assetId}?kind=audio&startMs=101&endMs=500` }] }), false);
  assert.equal(shared.isRetrievalResult({ ...result, candidates: [{ ...candidate, previewUri: `supervideo://asset/33333333-3333-4333-8333-333333333333?kind=audio&startMs=100&endMs=500` }] }), false);
});

test("desktop playback protocol parser keeps asset and range inputs bounded", () => {
  const assetId = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(playback.parseSuperVideoPlaybackRequest(`supervideo://asset/${assetId}?kind=video&startMs=100&endMs=500`), { assetId, kind: "video", startMs: 100, endMs: 500 });
  assert.equal(playback.parseSuperVideoPlaybackRequest(`supervideo://asset/${assetId}?kind=video&startMs=500&endMs=100`), undefined);
  assert.equal(playback.parseSuperVideoPlaybackRequest(`supervideo://asset/${assetId}/..?kind=video&startMs=100&endMs=500`), undefined);
  assert.equal(playback.parseSuperVideoPlaybackRequest(`supervideo://asset/${assetId}?kind=video&startMs=100&endMs=500&path=C%3A%5Csecret`), undefined);
  const proxyKey = "a".repeat(64);
  assert.equal(playback.resolveProxyOutput("C:\\project", { kind: "video", relativePath: `cache/media-cache-v1/proxy/${proxyKey}/video.mp4`, sizeBytes: 1 }, "video"), path.join("C:\\project", "cache", "media-cache-v1", "proxy", proxyKey, "video.mp4"));
  assert.equal(playback.resolveProxyOutput("C:\\project", { kind: "video", relativePath: "cache/media-cache-v1/../../secret.mp4", sizeBytes: 1 }, "video"), undefined);
});

test("client frames CRLF/chunked messages and ignores stale progress or responses", async () => {
  const progress = [];
  const fake = fakeLaunch((child, request) => {
    if (request.method === "core.health") {
      emitChunks(
        child.stdout,
        `${JSON.stringify(response(request.id, {
          service: "python-core",
          status: "ok",
          protocolVersion: 1,
          coreVersion: "0.1.0",
          capabilities: ["core.health", "core.smoke.countdown", "core.cancel"],
        }))}\r\n`,
        [1, 4, 9],
      );
      return;
    }
    if (request.method === "core.smoke.countdown") {
      const events = [
        { jsonrpc: "2.0", method: "core.progress", params: { requestId: request.id, sequence: 1, progress: 0.25, message: "one" } },
        { jsonrpc: "2.0", method: "core.progress", params: { requestId: request.id, sequence: 2, progress: 0.5, message: "two" } },
        { jsonrpc: "2.0", method: "core.progress", params: { requestId: request.id, sequence: 2, progress: 0.5, message: "duplicate" } },
        { jsonrpc: "2.0", method: "core.progress", params: { requestId: "unknown-id", sequence: 99, progress: 1, message: "unknown" } },
        response(request.id, { status: "completed", steps: 4 }),
      ];
      emitChunks(child.stdout, `${events.map((event) => JSON.stringify(event)).join("\r\n")}\r\n`, [7, 23, 81]);
      // A late response must not be routed to a later request.
      child.stdout.emit("data", Buffer.from(`${JSON.stringify(response(request.id, { status: "completed", steps: 4 }))}\n`));
    }
  });
  const client = new PythonCoreClient({ rootDir: root, spawnProcess: fake.spawnProcess });
  await client.start();
  const result = await client.runSmokeCountdown({ steps: 4, delayMs: 10 }, { onProgress: (event) => progress.push(event) });
  assert.deepEqual(result, { status: "completed", steps: 4 });
  assert.deepEqual(progress.map((event) => event.sequence), [1, 2]);
  await client.shutdown();
  await client.shutdown();
  assert.equal(client.getStatus(), "stopped");
});

test("client exposes a scoped job-event subscription with sequence deduplication", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const jobId = "22222222-2222-4222-8222-222222222222";
  const summary = {
    jobId, projectId, jobType: "smoke.countdown", status: "queued", progress: 0,
    stage: "queued", attempt: 0, revision: 1, lastEventSequence: 1,
    createdAtMs: 1700000000000, updatedAtMs: 1700000000000,
    startedAtMs: null, finishedAtMs: null, errorCode: null,
  };
  const event = (sequence) => ({
    jsonrpc: "2.0", method: "core.job.event",
    params: {
      projectId, jobId, sequence, eventType: "progress", status: "running",
      progress: 0.25, stage: "step-1", attempt: 1, timestamp: 1700000000000 + sequence, payload: {},
    },
  });
  const fake = fakeLaunch((child, request) => {
    if (request.method === "core.health") {
      emitChunks(child.stdout, JSON.stringify(response(request.id, {
        service: "python-core", status: "ok", protocolVersion: 1, coreVersion: "0.1.0", capabilities: ["job.smoke.start"],
      })) + "\n");
    } else if (request.method === "job.smoke.start") {
      emitChunks(child.stdout, JSON.stringify(event(2)) + "\n" + JSON.stringify(event(1)) + "\n" + JSON.stringify(event(2)) + "\n" + JSON.stringify(response(request.id, summary)) + "\n");
    }
  });
  const client = new PythonCoreClient({ rootDir: root, spawnProcess: fake.spawnProcess });
  const received = [];
  await client.start();
  const unsubscribe = client.onJobEvent((value) => received.push(value));
  await client.startSmokeJob({ projectId, idempotencyKey: "job-key", steps: 8, delayMs: 150, failAttempts: 0 });
  assert.deepEqual(received.map((value) => value.sequence), [2]);
  unsubscribe();
  fake.child.stdout.emit("data", Buffer.from(JSON.stringify(event(3)) + "\n"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received.map((value) => value.sequence), [2]);
  await client.shutdown();
});

test("timeout and AbortSignal cancel only the target request and clean pending work", async () => {
  const held = new Map();
  const fake = fakeLaunch((child, request) => {
    if (request.method === "core.health") {
      emitChunks(child.stdout, `${JSON.stringify(response(request.id, {
        service: "python-core", status: "ok", protocolVersion: 1, coreVersion: "0.1.0", capabilities: [],
      }))}\n`);
    } else if (request.method === "core.smoke.countdown") {
      held.set(request.id, child);
    } else if (request.method === "core.cancel") {
      // The original request is deliberately allowed to become a late result.
      const originalId = request.params.requestId;
      const original = [...held.keys()].find((id) => id === originalId);
      if (original) {
        child.stdout.emit("data", Buffer.from(`${JSON.stringify(response(original, { status: "completed", steps: 3 }))}\n`));
      }
    }
  });
  const client = new PythonCoreClient({ rootDir: root, spawnProcess: fake.spawnProcess, requestTimeoutMs: 50 });
  await client.start();
  const controller = new AbortController();
  const aborted = client.runSmokeCountdown({ steps: 3, delayMs: 10 }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted, (error) => error instanceof CoreRpcError && error.code === "REQUEST_CANCELLED");
  await assert.rejects(
    client.runSmokeCountdown({ steps: 3, delayMs: 10 }, { timeoutMs: 15 }),
    (error) => error instanceof CoreRpcError && error.code === "REQUEST_TIMEOUT",
  );
  assert.equal(client.getStatus(), "ready");
  await client.shutdown();
});

test("sudden process exit rejects every pending request with a stable error", async () => {
  let child;
  const fake = fakeLaunch((createdChild, request) => {
    child = createdChild;
    if (request.method === "core.health") {
      emitChunks(createdChild.stdout, `${JSON.stringify(response(request.id, {
        service: "python-core", status: "ok", protocolVersion: 1, coreVersion: "0.1.0", capabilities: [],
      }))}\n`);
    }
  });
  const client = new PythonCoreClient({ rootDir: root, spawnProcess: fake.spawnProcess });
  await client.start();
  const first = client.request("core.future.one", {});
  const second = client.request("core.future.two", {});
  child.emit("exit", 1, null);
  await assert.rejects(first, (error) => error instanceof CoreRpcError && error.code === "TRANSPORT_CLOSED");
  await assert.rejects(second, (error) => error instanceof CoreRpcError && error.code === "TRANSPORT_CLOSED");
  assert.equal(client.getStatus(), "failed");
  await client.shutdown();
});

test("malformed server output fails the transport without completing another request", async () => {
  let child;
  const fake = fakeLaunch((createdChild, request) => {
    child = createdChild;
    if (request.method === "core.health") {
      emitChunks(createdChild.stdout, `${JSON.stringify(response(request.id, {
        service: "python-core", status: "ok", protocolVersion: 1, coreVersion: "0.1.0", capabilities: [],
      }))}\n`);
    } else if (request.method === "core.future.pending") {
      createdChild.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":"other","result":}\n'));
    }
  });
  const client = new PythonCoreClient({ rootDir: root, spawnProcess: fake.spawnProcess });
  await client.start();
  const pending = client.request("core.future.pending", {});
  await assert.rejects(pending, (error) => error instanceof CoreRpcError && error.code === "PROTOCOL_ERROR");
  assert.equal(client.getStatus(), "failed");
  assert.equal(child.killed, true);
  await client.shutdown();
});

test("client enforces the shared 256 KiB line limit", async () => {
  const fake = fakeLaunch((child, request) => {
    if (request.method === "core.health") {
      emitChunks(child.stdout, `${JSON.stringify(response(request.id, {
        service: "python-core", status: "ok", protocolVersion: 1, coreVersion: "0.1.0", capabilities: [],
      }))}\n`);
    }
  });
  const client = new PythonCoreClient({ rootDir: root, spawnProcess: fake.spawnProcess });
  await client.start();
  await assert.rejects(
    client.request("core.future.large", { payload: "x".repeat(256 * 1024) }),
    (error) => error instanceof CoreRpcError && error.code === "MESSAGE_TOO_LARGE",
  );
  assert.equal(client.getStatus(), "ready");
  await client.shutdown();
});

test("real TypeScript to Python Core integration covers health, validation, progress, timeout and shutdown", async () => {
  const progress = [];
  const client = new PythonCoreClient({ rootDir: root, onProgress: (event) => progress.push(event) });
  try {
    const health = await client.start();
    assert.equal(health.service, "python-core");
    await assert.rejects(
      client.request("core.health", { unexpected: true }),
      (error) => error instanceof CoreRpcError && error.code === "INVALID_PARAMS",
    );
    await assert.rejects(
      client.request("core.unknown", {}),
      (error) => error instanceof CoreRpcError && error.code === "METHOD_NOT_FOUND",
    );
    const result = await client.runSmokeCountdown({ steps: 3, delayMs: 15 });
    assert.deepEqual(result, { status: "completed", steps: 3 });
    assert.ok(progress.length >= 2);
    await assert.rejects(
      client.runSmokeCountdown({ steps: 3, delayMs: 100 }, { timeoutMs: 25 }),
      (error) => error instanceof CoreRpcError && error.code === "REQUEST_TIMEOUT",
    );
  } finally {
    await client.shutdown();
  }
  assert.equal(client.getStatus(), "stopped");
});

test("real PythonCoreClient timeline.edit returns the shared C09 wire shape", async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), "supervideo-c09-"));
  const timeline = JSON.parse(readFileSync(path.join(root, "tests", "fixtures", "c01_timeline_ir_v1.json"), "utf8"));
  const client = new PythonCoreClient({ rootDir: root });
  try {
    await client.start();
    const project = await client.createProject({ name: "C09 RPC", targetPlatform: "douyin", projectRoot });
    const result = await client.editTimeline({
      schemaVersion: 1,
      editVersion: "timeline-edit-v1",
      policy: "deterministic-natural-language-v1",
      projectId: project.projectId,
      timeline,
      instruction: "删除 clip-camera-a",
    });
    assert.equal(shared.isTimelineEditResult(result), true);
    assert.equal(result.status, "applied");
    assert.equal(result.rejection, null);
    assert.equal(result.resultTimeline.id.startsWith(`${timeline.id}:edit-`), true);
    const rejected = await client.editTimeline({
      schemaVersion: 1,
      editVersion: "timeline-edit-v1",
      policy: "deterministic-natural-language-v1",
      projectId: project.projectId,
      timeline,
      instruction: "控制到一分钟左右，但不要截断句子",
    });
    assert.equal(shared.isTimelineEditResult(rejected), true);
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejection.code, "EDIT_UNSUPPORTED_INSTRUCTION");
  } finally {
    await client.shutdown();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
