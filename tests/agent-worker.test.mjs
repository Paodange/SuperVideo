import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);
const shared = require(path.join(root, "packages", "shared", "dist", "index.js"));
const controllerModule = require(path.join(root, "apps", "desktop", "dist", "main", "agent-worker-controller.js"));
const preloadApi = require(path.join(root, "apps", "desktop", "dist", "preload", "api.js"));
const { createSmokeAgentRunner } = await import(pathToFileURL(path.join(root, "workers", "agent", "dist", "smoke-agent.js")));

const now = () => Date.now();

function readyMessage() {
  return {
    protocolVersion: 1,
    type: "ready",
    timestamp: now(),
    workerVersion: "0.1.0",
    capabilities: ["smoke-task", "cancel"],
  };
}

function eventMessage(runId, sequence, event) {
  return { protocolVersion: 1, type: "run-event", runId, sequence, timestamp: now(), event };
}

class FakeUtilityProcess extends EventEmitter {
  constructor(generation, options = {}) {
    super();
    this.generation = generation;
    this.pid = 10_000 + generation;
    this.commands = [];
    this.options = options;
  }

  postMessage(message) {
    this.commands.push(message);
    if (message.type === "shutdown" && this.options.exitOnShutdown !== false) {
      queueMicrotask(() => this.emit("exit", 0));
    }
  }

  kill() {
    this.killed = true;
    queueMicrotask(() => this.emit("exit", null));
  }
}

function sleep(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for test state.");
    }
    await sleep(5);
  }
}

test("Agent Worker protocol accepts valid messages and rejects malformed wire data", () => {
  const valid = [
    { protocolVersion: 1, type: "run-smoke-task", runId: "run-1", steps: 4 },
    { protocolVersion: 1, type: "cancel-run", runId: "run-1" },
    { protocolVersion: 1, type: "ping" },
    { protocolVersion: 1, type: "shutdown" },
    readyMessage(),
    { protocolVersion: 1, type: "pong", timestamp: now() },
    eventMessage("run-1", 1, { kind: "run-started" }),
    eventMessage("run-1", 2, { kind: "assistant-text-delta", delta: "hello" }),
    eventMessage("run-1", 3, { kind: "tool-started", toolCallId: "tool-1", toolName: "smoke_countdown" }),
    eventMessage("run-1", 4, { kind: "tool-progress", toolCallId: "tool-1", progress: 0.5, message: "step" }),
    eventMessage("run-1", 5, { kind: "tool-finished", toolCallId: "tool-1", toolName: "smoke_countdown", ok: true }),
    { protocolVersion: 1, type: "run-finished", runId: "run-1", sequence: 6, timestamp: now(), status: "completed" },
    { protocolVersion: 1, type: "worker-error", timestamp: now(), error: shared.createAgentPublicError("internal-error") },
  ];
  for (const message of valid) {
    assert.equal(shared.isValidAgentWireMessage(message), true, JSON.stringify(message));
  }

  const invalid = [
    { protocolVersion: 2, type: "ping" },
    { protocolVersion: 1, type: "unknown" },
    { protocolVersion: 1, type: "run-smoke-task", runId: "bad run id", steps: 4 },
    { protocolVersion: 1, type: "run-smoke-task", runId: "run-1", steps: 1 },
    { protocolVersion: 1, type: "run-event", runId: "run-1", sequence: 0, timestamp: now(), event: { kind: "run-started" } },
    { protocolVersion: 1, type: "run-event", runId: "run-1", sequence: 1, timestamp: now(), event: { kind: "not-a-product-event" } },
    { protocolVersion: 1, type: "run-finished", runId: "run-1", sequence: 1, timestamp: now(), status: "completed", error: { code: "internal-error", message: "wrong" } },
    { protocolVersion: 1, type: "ping", unexpected: true },
    { protocolVersion: 1, type: "run-event", runId: "run-1", sequence: 1, timestamp: now(), event: { kind: "assistant-text-delta", delta: "x".repeat(5_000) } },
    { protocolVersion: 1, type: "run-event", runId: "run-1", sequence: 1, timestamp: now(), event: { kind: "assistant-text-delta", delta: () => {} } },
  ];
  for (const message of invalid) {
    assert.equal(shared.isValidAgentWireMessage(message), false, String(message.type));
  }
  assert.equal(shared.isValidAgentWorkerMessage({ protocolVersion: 1, type: "ready", timestamp: now(), workerVersion: "0.1.0", capabilities: [] }), true);
  assert.equal(shared.isAgentWorkerMessageWithinLimit({ protocolVersion: 1, type: "run-event", runId: "run-1", sequence: 1, timestamp: now(), event: { kind: "assistant-text-delta", delta: "x".repeat(70_000) } }), false);
  assert.equal(shared.isValidAgentWorkerCommand({ protocolVersion: 1, type: "run-smoke-task", runId: "run-1", steps: 4, extra: undefined }), false);
  assert.equal(shared.isValidAgentWorkerCommand({ protocolVersion: 1, type: "ping", value: 1n }), false);
});

test("Pi faux smoke agent emits a complete ordered product event stream", async () => {
  const messages = [];
  const runner = createSmokeAgentRunner((message) => messages.push(message));
  await runner.run("smoke-success", 4);
  const runMessages = messages.filter((message) => message.runId === "smoke-success");
  const events = runMessages.filter((message) => message.type === "run-event");
  const finished = runMessages.at(-1);
  assert.deepEqual(events.map((message) => message.sequence), events.map((_message, index) => index + 1));
  assert.ok(events.some((message) => message.event.kind === "run-started"));
  assert.ok(events.some((message) => message.event.kind === "assistant-text-delta"));
  assert.ok(events.some((message) => message.event.kind === "tool-started"));
  assert.ok(events.filter((message) => message.event.kind === "tool-progress").length >= 2);
  assert.ok(events.some((message) => message.event.kind === "tool-finished"));
  assert.deepEqual(finished && { type: finished.type, status: finished.status }, { type: "run-finished", status: "completed" });
  assert.equal(runner.isBusy(), false);
});

test("Pi faux smoke agent enforces busy, scoped cancellation, and reuse", async () => {
  const messages = [];
  const runner = createSmokeAgentRunner((message) => messages.push(message));
  const first = runner.run("smoke-cancel", 6);
  await waitFor(() => messages.some((message) => message.type === "run-event" && message.runId === "smoke-cancel" && message.event.kind === "tool-progress"));
  await assert.rejects(runner.run("smoke-busy", 3), (error) => error.code === "busy");
  assert.equal(runner.cancel("other-run"), false);
  assert.equal(runner.isBusy(), true);
  assert.equal(runner.cancel("smoke-cancel"), true);
  await first;
  assert.equal(messages.find((message) => message.type === "run-finished" && message.runId === "smoke-cancel")?.status, "cancelled");
  await runner.run("smoke-after-cancel", 3);
  assert.equal(messages.find((message) => message.type === "run-finished" && message.runId === "smoke-after-cancel")?.status, "completed");
});

test("controller starts one generation, rejects busy runs, and ignores wrong cancellation ids", async () => {
  const children = [];
  const forwarded = [];
  const controller = controllerModule.createAgentWorkerController({
    workerPath: "worker.cjs",
    createProcess: (_workerPath, generation) => {
      const child = new FakeUtilityProcess(generation);
      children.push(child);
      return child;
    },
    restartBackoffMs: [0],
    onMessage: (message) => forwarded.push(message),
  });
  const starting = controller.start();
  assert.equal(controller.getStatus().status, "starting");
  children[0].emit("message", readyMessage());
  await starting;
  assert.equal(controller.getStatus().status, "ready");
  const handle = controller.runSmokeTask("controller-run");
  assert.deepEqual(handle, { runId: "controller-run" });
  assert.throws(() => controller.runSmokeTask("second-run"), (error) => error.code === "busy");
  assert.throws(() => controller.cancelRun("other-run"), (error) => error.code === "run-not-found");
  assert.equal(children[0].commands.filter((command) => command.type === "cancel-run").length, 0);
  children[0].emit("message", eventMessage("controller-run", 1, { kind: "run-started" }));
  children[0].emit("message", { protocolVersion: 1, type: "run-finished", runId: "controller-run", sequence: 2, timestamp: now(), status: "completed" });
  assert.equal(controller.getStatus().status, "ready");
  assert.equal(controller.getStatus().runStatus, "completed");
  assert.equal(forwarded.filter((message) => message.type === "run-finished").length, 1);
  await controller.shutdown();
  assert.equal(controller.getStatus().status, "stopped");
});

test("controller ready timeout is bounded and reaches unavailable when restarts are disabled", async () => {
  const children = [];
  const controller = controllerModule.createAgentWorkerController({
    workerPath: "worker.cjs",
    createProcess: (_workerPath, generation) => {
      const child = new FakeUtilityProcess(generation);
      children.push(child);
      return child;
    },
    startupTimeoutMs: 10,
    maxRestarts: 0,
  });
  await assert.rejects(controller.start(), (error) => error.code === "worker-ready-timeout");
  await sleep(30);
  assert.equal(children.length, 1);
  assert.equal(controller.getStatus().status, "unavailable");
  assert.equal(controller.getStatus().lastErrorCode, "worker-unavailable");
  await controller.shutdown();
});

test("controller restarts with a cap and marks an active run interrupted", async () => {
  const children = [];
  const forwarded = [];
  const controller = controllerModule.createAgentWorkerController({
    workerPath: "worker.cjs",
    createProcess: (_workerPath, generation) => {
      const child = new FakeUtilityProcess(generation);
      children.push(child);
      return child;
    },
    startupTimeoutMs: 1_000,
    restartBackoffMs: [0],
    maxRestarts: 2,
    restartWindowMs: 10_000,
    onMessage: (message) => forwarded.push(message),
  });
  const starting = controller.start();
  children[0].emit("message", readyMessage());
  await starting;
  controller.runSmokeTask("crash-run");
  children[0].emit("message", eventMessage("crash-run", 1, { kind: "run-started" }));
  children[0].emit("exit", 7);
  await waitFor(() => children.length === 2);
  assert.equal(forwarded.at(-1)?.status, "interrupted");
  children[0].emit("message", eventMessage("crash-run", 99, { kind: "tool-progress", toolCallId: "old", progress: 1, message: "late" }));
  assert.equal(forwarded.some((message) => message.type === "run-event" && message.sequence === 99), false);
  children[1].emit("message", readyMessage());
  children[1].emit("exit", 7);
  await waitFor(() => children.length === 3);
  children[2].emit("exit", 7);
  await sleep(20);
  assert.equal(controller.getStatus().status, "unavailable");
  assert.equal(children.length, 3);
  await controller.shutdown();
});

test("controller shutdown is intentional and never schedules a restart", async () => {
  const children = [];
  const controller = controllerModule.createAgentWorkerController({
    workerPath: "worker.cjs",
    createProcess: (_workerPath, generation) => {
      const child = new FakeUtilityProcess(generation);
      children.push(child);
      return child;
    },
    restartBackoffMs: [0],
  });
  const starting = controller.start();
  children[0].emit("message", readyMessage());
  await starting;
  await controller.shutdown();
  await sleep(20);
  assert.equal(children.length, 1);
  assert.equal(controller.getStatus().status, "stopped");
});

test("preload exposes only fixed Agent capabilities and removes subscriptions", async () => {
  const listeners = new Map();
  const calls = [];
  const status = {
    status: "ready",
    generation: 1,
    activeRunId: null,
    runStatus: "idle",
    restartCount: 0,
    lastErrorCode: null,
    workerVersion: "0.1.0",
    capabilities: ["smoke-task", "cancel"],
  };
  const api = preloadApi.createDesktopApi(async (channel, payload) => {
    calls.push({ channel, payload });
    if (channel === shared.DESKTOP_IPC_CHANNELS.getAgentStatus) return { ok: true, value: status };
    if (channel === shared.DESKTOP_IPC_CHANNELS.runAgentSmokeTask) return { ok: true, value: { runId: "preload-run" } };
    return { ok: true, value: { runId: payload.runId } };
  }, (channel, listener) => {
    listeners.set(channel, listener);
    return () => listeners.delete(channel);
  });
  const received = [];
  const unsubscribe = api.onAgentEvent((event) => received.push(event));
  listeners.get(shared.DESKTOP_IPC_CHANNELS.agentEvent)(null, { kind: "worker-error", timestamp: now(), error: { code: "internal-error", message: "wrong" } });
  listeners.get(shared.DESKTOP_IPC_CHANNELS.agentEvent)(null, { kind: "worker-status", timestamp: now(), status });
  assert.equal(received.length, 1);
  unsubscribe();
  unsubscribe();
  assert.equal(listeners.size, 0);
  assert.deepEqual(await api.getAgentStatus(), status);
  assert.deepEqual(await api.runSmokeTask(), { runId: "preload-run" });
  await api.cancelSmokeRun("preload-run");
  await assert.rejects(api.cancelSmokeRun("bad run id"), (error) => error.code === "invalid-run-id");
  assert.deepEqual(calls.map((call) => call.channel), [
    shared.DESKTOP_IPC_CHANNELS.getAgentStatus,
    shared.DESKTOP_IPC_CHANNELS.runAgentSmokeTask,
    shared.DESKTOP_IPC_CHANNELS.cancelAgentRun,
  ]);
  assert.equal("invoke" in api, false);
  assert.equal("send" in api, false);
  assert.equal("postMessage" in api, false);
});
