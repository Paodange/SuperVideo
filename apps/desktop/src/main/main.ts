import { app, BrowserWindow, ipcMain, session, utilityProcess } from "electron";
import path from "node:path";
import {
  DESKTOP_IPC_CHANNELS,
  isValidDesktopAgentEvent,
  type AgentWorkerMessage,
  type DesktopAgentEvent,
  type DesktopEnvironment,
} from "@supervideo/shared";
import {
  createBrowserWindowOptions,
  createContentSecurityPolicy,
  createRuntimeConfig,
  getPreloadPath,
  type RuntimeConfig,
} from "./security/config";
import { createSecurityLogger } from "./security/diagnostics";
import {
  createDesktopAgentStatusEvent,
  registerDesktopIpcHandlers,
  toDesktopAgentEvent,
} from "./security/ipc";
import { denyWindowOpen, isTrustedRendererUrl, sanitizeUrlForDiagnostics } from "./security/policies";
import { registerSessionSecurity } from "./security/session";
import { createAgentWorkerController, type AgentWorkerController, type UtilityProcessLike } from "./agent-worker-controller";

const log = createSecurityLogger();

function getRendererPath(): string {
  // __dirname is the compiled Main directory. Renderer input is not involved in
  // resolving either the local document or the preload script.
  return path.join(__dirname, "..", "renderer", "index.html");
}

function getAgentWorkerPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "worker", "agent-worker-bootstrap.cjs")
    : path.join(__dirname, "..", "worker", "agent-worker-bootstrap.cjs");
}

function getDesktopEnvironment(runtime: RuntimeConfig): DesktopEnvironment {
  return {
    mode: runtime.mode,
    platform: process.platform,
    electron: process.versions.electron ?? "unknown",
  };
}

function createWindow(runtime: RuntimeConfig): BrowserWindow {
  const window = new BrowserWindow(createBrowserWindowOptions(getPreloadPath(__dirname), runtime.mode === "production"));
  let loadState: "loading" | "ready" | "failed" = "loading";

  const rejectUntrustedNavigation = (event: Electron.Event, url: string, kind: string): void => {
    if (!isTrustedRendererUrl(url, runtime)) {
      event.preventDefault();
      log("navigation-rejected", { kind, url: sanitizeUrlForDiagnostics(url) });
    }
  };

  // These listeners are installed before loadURL/loadFile so untrusted page
  // content never gets a chance to navigate or open a privileged child window.
  window.webContents.on("will-navigate", (event, url) => rejectUntrustedNavigation(event, url, "navigate"));
  window.webContents.on("will-redirect", (event, url) => rejectUntrustedNavigation(event, url, "redirect"));
  window.webContents.setWindowOpenHandler(({ url }) => {
    log("window-open-rejected", { url: sanitizeUrlForDiagnostics(url) });
    return denyWindowOpen();
  });

  window.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      loadState = "failed";
      log("renderer-load-failed", {
        code: errorCode,
        url: sanitizeUrlForDiagnostics(validatedURL),
      });
    }
  });

  window.once("ready-to-show", () => {
    loadState = "ready";
    window.show();
  });

  const load = runtime.devServerUrl ? window.loadURL(runtime.devServerUrl) : window.loadFile(runtime.rendererPath);
  void load.catch(() => {
    if (loadState !== "failed") {
      loadState = "failed";
      log("renderer-load-failed", { code: "load-rejected", url: "[local-renderer]" });
    }
  });

  return window;
}

function publishAgentEvent(event: DesktopAgentEvent): void {
  if (!isValidDesktopAgentEvent(event)) {
    log("agent-event-rejected", { reason: "invalid-product-event" });
    return;
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(DESKTOP_IPC_CHANNELS.agentEvent, event);
    }
  }
}

function createAgentController(smokeMessages: AgentWorkerMessage[]): AgentWorkerController {
  return createAgentWorkerController({
    workerPath: getAgentWorkerPath(),
    createProcess: (workerPath, generation) => {
      return utilityProcess.fork(workerPath, [], {
        serviceName: `SuperVideo Agent Worker ${generation}`,
        stdio: "ignore",
      }) as unknown as UtilityProcessLike;
    },
    log: (event, details) => log(`agent-${event}`, details),
    onMessage: (message) => {
      smokeMessages.push(message);
      const event = toDesktopAgentEvent(message);
      if (event) {
        publishAgentEvent(event);
      }
    },
    onStatusChange: (status) => publishAgentEvent(createDesktopAgentStatusEvent(status)),
  });
}

function waitForAgentMessage(
  messages: readonly AgentWorkerMessage[],
  predicate: (message: AgentWorkerMessage) => boolean,
  timeoutMs = 10_000,
): Promise<AgentWorkerMessage> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const message = messages.find(predicate);
      if (message) {
        clearInterval(timer);
        resolve(message);
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for Agent Worker smoke event."));
      }
    }, 20);
  });
}

async function runAgentIntegrationSmoke(controller: AgentWorkerController, messages: AgentWorkerMessage[]): Promise<void> {
  await controller.start();
  controller.runSmokeTask("integration-success");
  const successFinished = await waitForAgentMessage(
    messages,
    (message) => message.type === "run-finished" && message.runId === "integration-success",
  );
  type RunMessage = Extract<AgentWorkerMessage, { type: "run-event" | "run-finished" }>;
  const successMessages: RunMessage[] = messages.filter(
    (message): message is RunMessage => (message.type === "run-event" || message.type === "run-finished") && message.runId === "integration-success",
  );
  const successEvents = successMessages.filter(
    (message): message is Extract<RunMessage, { type: "run-event" }> => message.type === "run-event",
  );
  const successProgress = successEvents.filter((message) => message.event.kind === "tool-progress");
  if (
    successFinished.type !== "run-finished" ||
    successFinished.status !== "completed" ||
    !successEvents.some((message) => message.event.kind === "run-started") ||
    !successEvents.some((message) => message.event.kind === "assistant-text-delta") ||
    !successEvents.some((message) => message.event.kind === "tool-started") ||
    successProgress.length < 2 ||
    !successEvents.some((message) => message.event.kind === "tool-finished") ||
    !successMessages.every((message, index, all) => {
      const previous = all[index - 1];
      return index === 0 || (previous !== undefined && message.sequence > previous.sequence);
    })
  ) {
    throw new Error("Agent Worker smoke task did not produce the expected ordered event set.");
  }

  controller.runSmokeTask("integration-cancel");
  await waitForAgentMessage(
    messages,
    (message) => message.type === "run-event" && message.runId === "integration-cancel" && message.event.kind === "tool-progress",
  );
  controller.cancelRun("integration-cancel");
  const cancelled = await waitForAgentMessage(
    messages,
    (message) => message.type === "run-finished" && message.runId === "integration-cancel",
  );
  if (cancelled.type !== "run-finished" || cancelled.status !== "cancelled") {
    throw new Error("Agent Worker smoke cancellation did not produce a cancelled terminal event.");
  }
}

app.whenReady().then(() => {
  const runtime = createRuntimeConfig({
    isPackaged: app.isPackaged,
    argv: process.argv,
    rendererPath: getRendererPath(),
  });

  if (runtime.rejectedDevServerArgument) {
    log("dev-server-rejected", { reason: "not-a-local-http-origin" });
  }

  // The session boundary and IPC allowlist are installed before the first
  // renderer document is loaded. Every later window reuses the same policy.
  registerSessionSecurity(session.defaultSession, {
    contentSecurityPolicy: createContentSecurityPolicy(runtime),
    log,
  });
  const smokeMessages: AgentWorkerMessage[] = [];
  const agentController = createAgentController(smokeMessages);
  activeAgentController = agentController;

  registerDesktopIpcHandlers(ipcMain, {
    rendererTrustPolicy: runtime,
    getEnvironment: () => getDesktopEnvironment(runtime),
    getAgentStatus: () => agentController.getStatus(),
    runSmokeTask: () => agentController.runSmokeTask(),
    cancelSmokeRun: (runId) => agentController.cancelRun(runId),
    log,
  });

  void agentController.start().catch((error: unknown) => {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "internal-error";
    log("agent-start-failed", { reason: code });
  });

  if (process.argv.includes("--agent-smoke")) {
    void runAgentIntegrationSmoke(agentController, smokeMessages)
      .then(() => agentController.shutdown().then(() => app.exit(0)))
      .catch((error: unknown) => {
        console.error(`[agent-smoke] ${error instanceof Error ? error.message : "failed"}`);
        void agentController.shutdown().finally(() => app.exit(1));
      });
  } else {
    createWindow(runtime);
  }

  if (!process.argv.includes("--agent-smoke")) {
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(runtime);
      }
    });
  }
});

let quitting = false;

app.on("before-quit", (event) => {
  if (quitting) {
    return;
  }
  event.preventDefault();
  quitting = true;
  const shutdown = activeAgentController?.shutdown() ?? Promise.resolve();
  void shutdown.finally(() => app.exit(0));
});

let activeAgentController: AgentWorkerController | undefined;

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
