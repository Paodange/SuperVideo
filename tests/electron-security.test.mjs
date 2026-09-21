import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);
const config = require(path.join(root, "apps", "desktop", "dist", "main", "security", "config.js"));
const ipc = require(path.join(root, "apps", "desktop", "dist", "main", "security", "ipc.js"));
const policies = require(path.join(root, "apps", "desktop", "dist", "main", "security", "policies.js"));
const preloadApi = require(path.join(root, "apps", "desktop", "dist", "preload", "api.js"));
const shared = require(path.join(root, "packages", "shared", "dist", "index.js"));

const rendererPath = path.join(root, "apps", "desktop", "dist", "renderer", "index.html");
const devServerUrl = "http://127.0.0.1:5173";

test("BrowserWindow security defaults keep the renderer outside Node", () => {
  const options = config.createBrowserWindowOptions("C:\\internal\\preload.js", false);

  assert.equal(options.show, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.allowRunningInsecureContent, false);
  assert.equal(options.webPreferences.preload, "C:\\internal\\preload.js");
});

test("only a canonical loopback dev server URL is accepted", () => {
  assert.equal(config.parseAllowedDevServerUrl("http://127.0.0.1:5173"), devServerUrl);
  assert.equal(config.parseAllowedDevServerUrl("http://127.0.0.1:5173/"), devServerUrl);

  for (const value of [
    "https://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.2:5173",
    "file:///C:/renderer/index.html",
    "http://user:password@127.0.0.1:5173",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:5173/path",
    "http://127.0.0.1:5173?remote=true",
    "not a URL",
  ]) {
    assert.equal(config.parseAllowedDevServerUrl(value), undefined, value);
  }
});

test("production ignores dev-server arguments and uses local content only", () => {
  const runtime = config.createRuntimeConfig({
    isPackaged: true,
    argv: [`--dev-server=${devServerUrl}`],
    rendererPath,
  });
  const csp = config.createContentSecurityPolicy(runtime);

  assert.equal(runtime.mode, "production");
  assert.equal(runtime.devServerUrl, undefined);
  assert.deepEqual(runtime.allowedRendererOrigins, ["file://"]);
  assert.deepEqual(runtime.allowedRendererUrls, [pathToFileURL(rendererPath).toString()]);
  assert.doesNotMatch(csp, /localhost|127\.0\.0\.1|unsafe-/);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /frame-src 'none'/);
});

test("development CSP explicitly permits only the validated Vite origin", () => {
  const runtime = config.createRuntimeConfig({
    isPackaged: false,
    argv: [`--dev-server=${devServerUrl}`],
    rendererPath,
  });
  const csp = config.createContentSecurityPolicy(runtime);

  assert.equal(runtime.devServerUrl, devServerUrl);
  assert.deepEqual(runtime.allowedRendererOrigins, [devServerUrl]);
  assert.deepEqual(runtime.allowedRendererUrls, []);
  assert.match(csp, /script-src 'self' http:\/\/127\.0\.0\.1:5173 'unsafe-eval'/);
  assert.match(csp, /connect-src 'self' http:\/\/127\.0\.0\.1:5173 ws:\/\/127\.0\.0\.1:5173/);
  assert.doesNotMatch(csp, /https?:\/\/(?!127\.0\.0\.1)/);
});

test("navigation policy allows only the active renderer location", () => {
  const devRuntime = config.createRuntimeConfig({ isPackaged: false, argv: [`--dev-server=${devServerUrl}`], rendererPath });
  const localRuntime = config.createRuntimeConfig({ isPackaged: true, argv: [], rendererPath });
  const localUrl = pathToFileURL(rendererPath).toString();

  assert.equal(policies.isTrustedRendererUrl(`${devServerUrl}/src/renderer/main.tsx`, devRuntime), true);
  assert.equal(policies.isTrustedRendererUrl("https://example.com/", devRuntime), false);
  assert.equal(policies.isTrustedRendererUrl(localUrl, devRuntime), false);
  assert.equal(policies.isTrustedRendererUrl(localUrl, localRuntime), true);
  assert.equal(policies.isTrustedRendererUrl(`${localUrl}?external=true`, localRuntime), false);
  assert.deepEqual(policies.denyWindowOpen(), { action: "deny" });
  assert.equal(policies.denyPermissionRequest(), false);
  assert.equal(policies.sanitizeUrlForDiagnostics("https://example.com/private?token=secret"), "https://example.com");
});

function createFakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      if (handlers.has(channel)) {
        throw new Error(`duplicate handler: ${channel}`);
      }
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
}

function trustedEvent(url = `${devServerUrl}/`) {
  return { senderFrame: { url } };
}

test("trusted sender reaches the versioned IPC allowlist and untrusted sender does not", async () => {
  const fakeIpcMain = createFakeIpcMain();
  const runtime = config.createRuntimeConfig({ isPackaged: false, argv: [`--dev-server=${devServerUrl}`], rendererPath });
  let businessCalls = 0;
  const logs = [];
  const dispose = ipc.registerDesktopIpcHandlers(fakeIpcMain, {
    rendererTrustPolicy: runtime,
    getEnvironment: () => {
      businessCalls += 1;
      return { mode: "development", platform: "win32", electron: "44.3.0" };
    },
    log: (event, details) => logs.push({ event, details }),
  });
  const handler = fakeIpcMain.handlers.get(shared.DESKTOP_IPC_CHANNELS.getEnvironment);

  assert.ok(handler);
  assert.deepEqual(await handler(trustedEvent(), {}), {
    ok: true,
    value: { mode: "development", platform: "win32", electron: "44.3.0" },
  });
  const rejected = await handler(trustedEvent("https://example.com/"), {});
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "forbidden-sender");
  assert.equal(businessCalls, 1);
  assert.equal(logs.at(-1).event, "ipc-rejected");
  dispose();
});

test("Agent IPC uses explicit channels, payload schemas, and stable public errors", async () => {
  const fakeIpcMain = createFakeIpcMain();
  const runtime = config.createRuntimeConfig({ isPackaged: false, argv: [`--dev-server=${devServerUrl}`], rendererPath });
  const calls = [];
  const dispose = ipc.registerDesktopIpcHandlers(fakeIpcMain, {
    rendererTrustPolicy: runtime,
    getEnvironment: () => ({ mode: "development", platform: "win32", electron: "44.3.0" }),
    getAgentStatus: () => ({
      status: "ready",
      generation: 1,
      activeRunId: null,
      runStatus: "idle",
      restartCount: 0,
      lastErrorCode: null,
      workerVersion: "0.1.0",
      capabilities: ["smoke-task", "cancel"],
    }),
    runSmokeTask: () => {
      calls.push("run");
      return { runId: "ipc-run" };
    },
    cancelSmokeRun: (runId) => calls.push(`cancel:${runId}`),
    log: () => {},
  });
  assert.equal(fakeIpcMain.handlers.size, 19);
  const statusHandler = fakeIpcMain.handlers.get(shared.DESKTOP_IPC_CHANNELS.getAgentStatus);
  const runHandler = fakeIpcMain.handlers.get(shared.DESKTOP_IPC_CHANNELS.runAgentSmokeTask);
  const cancelHandler = fakeIpcMain.handlers.get(shared.DESKTOP_IPC_CHANNELS.cancelAgentRun);
  assert.equal((await statusHandler(trustedEvent(), {})).ok, true);
  assert.deepEqual(await runHandler(trustedEvent(), {}), { ok: true, value: { runId: "ipc-run" } });
  assert.deepEqual(await cancelHandler(trustedEvent(), { runId: "ipc-run" }), { ok: true, value: { runId: "ipc-run" } });
  assert.deepEqual(calls, ["run", "cancel:ipc-run"]);
  assert.equal((await cancelHandler(trustedEvent(), { runId: "bad run id" })).error.code, "invalid-payload");
  dispose();
});

test("invalid payloads are rejected before the business handler", async () => {
  const fakeIpcMain = createFakeIpcMain();
  const runtime = config.createRuntimeConfig({ isPackaged: false, argv: [`--dev-server=${devServerUrl}`], rendererPath });
  let businessCalls = 0;
  const dispose = ipc.registerDesktopIpcHandlers(fakeIpcMain, {
    rendererTrustPolicy: runtime,
    getEnvironment: () => {
      businessCalls += 1;
      return { mode: "development", platform: "win32", electron: "44.3.0" };
    },
    log: () => {},
  });
  const handler = fakeIpcMain.handlers.get(shared.DESKTOP_IPC_CHANNELS.getEnvironment);

  for (const payload of [undefined, null, [], { unexpected: true }]) {
    const result = await handler(trustedEvent(), payload);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid-payload");
  }
  assert.equal(businessCalls, 0);
  dispose();
});

test("IPC errors are stable and do not expose Main internals", async () => {
  const fakeIpcMain = createFakeIpcMain();
  const runtime = config.createRuntimeConfig({ isPackaged: false, argv: [`--dev-server=${devServerUrl}`], rendererPath });
  const dispose = ipc.registerDesktopIpcHandlers(fakeIpcMain, {
    rendererTrustPolicy: runtime,
    getEnvironment: () => {
      throw new Error(`C:\\private\\secret.env ${process.env.PATH}`);
    },
    log: () => {},
  });
  const handler = fakeIpcMain.handlers.get(shared.DESKTOP_IPC_CHANNELS.getEnvironment);
  const result = await handler(trustedEvent(), {});

  assert.deepEqual(result, {
    ok: false,
    error: { code: "internal-error", message: "The desktop request could not be completed." },
  });
  assert.doesNotMatch(JSON.stringify(result), /private|secret|C:\\|PATH|stack/i);
  dispose();
});

test("IPC registration can be disposed and registered again", () => {
  const fakeIpcMain = createFakeIpcMain();
  const runtime = config.createRuntimeConfig({ isPackaged: false, argv: [`--dev-server=${devServerUrl}`], rendererPath });
  const dependencies = { rendererTrustPolicy: runtime, getEnvironment: () => ({ mode: "development", platform: "win32", electron: "44.3.0" }), log: () => {} };

  const dispose = ipc.registerDesktopIpcHandlers(fakeIpcMain, dependencies);
  dispose();
  assert.equal(fakeIpcMain.handlers.size, 0);
  assert.doesNotThrow(() => ipc.registerDesktopIpcHandlers(fakeIpcMain, dependencies));
});

test("preload exposes one frozen typed capability and no arbitrary channel", async () => {
  const calls = [];
  const api = preloadApi.createDesktopApi(async (channel, payload) => {
    calls.push({ channel, payload });
    return { ok: true, value: { mode: "development", platform: "win32", electron: "44.3.0" } };
  });

  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(api), [
    "getEnvironment", "getAgentStatus", "runSmokeTask", "cancelSmokeRun", "onAgentEvent",
    "createProject", "openProject", "addAssetReferences", "listProjectAssets", "inspectSentenceQa", "saveSentenceQa", "retrieveSentences", "rerankSentences", "alignScript",
    "startSmokeJob", "getJob", "listJobs", "listJobEvents", "cancelJob", "retryJob", "onJobEvent",
    "credentials", "diagnostics",
  ]);
  assert.equal("invoke" in api, false);
  assert.equal("send" in api, false);
  assert.equal("postMessage" in api, false);
  assert.deepEqual(await api.getEnvironment(), { mode: "development", platform: "win32", electron: "44.3.0" });
  assert.deepEqual(calls, [{ channel: shared.DESKTOP_IPC_CHANNELS.getEnvironment, payload: {} }]);
});

test("sandboxed preload is bundled and does not load the workspace package at runtime", () => {
  const preloadBundle = readFileSync(path.join(root, "apps", "desktop", "dist", "preload", "preload.js"), "utf8");
  assert.doesNotMatch(preloadBundle, /require\(["']@supervideo\/shared["']\)/);
  assert.match(preloadBundle, /require\(["']electron["']\)/);
});

test("unknown IPC channel is outside the allowlist", () => {
  assert.equal(ipc.isKnownDesktopIpcChannel(shared.DESKTOP_IPC_CHANNELS.getEnvironment), true);
  assert.equal(ipc.isKnownDesktopIpcChannel(shared.DESKTOP_IPC_CHANNELS.agentEvent), true);
  assert.equal(ipc.isKnownDesktopIpcChannel("desktop:v1:unknown"), false);
});
