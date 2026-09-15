import { app, BrowserWindow, dialog, ipcMain, session, utilityProcess } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDesktopPublicError,
  DESKTOP_IPC_CHANNELS,
  isAssetListResult,
  isAssetReferenceBatchResult,
  isValidDesktopAgentEvent,
  isProjectSummary,
  type AgentWorkerMessage,
  type DesktopAgentEvent,
  type DesktopEnvironment,
  type AddAssetReferencesRequest,
  type CreateProjectRequest,
  type ListProjectAssetsRequest,
  type ProjectDialogResult,
  type ProjectSummary,
  type AssetReferenceBatchResult,
  type AssetListResult,
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

function projectSummary(value: Readonly<Record<string, unknown>>): ProjectSummary {
  if (!isProjectSummary(value)) {
    throw createDesktopPublicError("CORE_UNAVAILABLE");
  }
  return value;
}

function assetReferenceResult(value: Readonly<Record<string, unknown>>): AssetReferenceBatchResult {
  if (!isAssetReferenceBatchResult(value)) {
    throw createDesktopPublicError("CORE_UNAVAILABLE");
  }
  return value;
}

function assetListResult(value: Readonly<Record<string, unknown>>): AssetListResult {
  if (!isAssetListResult(value)) {
    throw createDesktopPublicError("CORE_UNAVAILABLE");
  }
  return value;
}

function dialogOwner(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || owner.isDestroyed()) {
    throw createDesktopPublicError("internal-error");
  }
  return owner;
}

function validateProjectDirectorySelection(value: string): string {
  if (!path.isAbsolute(value) || value.includes("\x00") || isUncPath(value)) {
    throw createDesktopPublicError(isUncPath(value) ? "UNSUPPORTED_PROJECT_LOCATION" : "INVALID_PROJECT_ROOT");
  }
  let resolved: string;
  try {
    resolved = fs.realpathSync.native(value);
    const stats = fs.statSync(resolved);
    if (!stats.isDirectory() || path.parse(resolved).root === resolved) {
      throw new Error("invalid directory");
    }
  } catch {
    throw createDesktopPublicError("INVALID_PROJECT_ROOT");
  }
  return resolved;
}

function validateAssetSelections(values: readonly string[]): string[] {
  return values.map((value) => {
    if (!path.isAbsolute(value) || value.includes("\x00")) {
      throw createDesktopPublicError("FILE_ACCESS_DENIED");
    }
    try {
      const resolved = fs.realpathSync.native(value);
      if (!fs.statSync(resolved).isFile()) {
        throw new Error("not a file");
      }
      return resolved;
    } catch {
      throw createDesktopPublicError("FILE_ACCESS_DENIED");
    }
  });
}

function isUncPath(value: string): boolean {
  return value.startsWith("\\\\") || value.startsWith("//");
}

function createProjectDialogHandler(
  controller: AgentWorkerController,
  event: Electron.IpcMainInvokeEvent,
  input: CreateProjectRequest,
): Promise<ProjectDialogResult<ProjectSummary>> {
  return dialog.showOpenDialog(dialogOwner(event), {
    properties: ["openDirectory", "createDirectory"],
  }).then(async (selection) => {
    if (selection.canceled) return { cancelled: true } as const;
    if (selection.filePaths.length !== 1) throw createDesktopPublicError("INVALID_PROJECT_ROOT");
    const projectRoot = validateProjectDirectorySelection(selection.filePaths[0]!);
    const result = await controller.runProjectOperation("project-create", {
      name: input.name,
      targetPlatform: input.targetPlatform,
      projectRoot,
    });
    return { cancelled: false, value: projectSummary(result) } as const;
  });
}

function openProjectDialogHandler(
  controller: AgentWorkerController,
  event: Electron.IpcMainInvokeEvent,
): Promise<ProjectDialogResult<ProjectSummary>> {
  return dialog.showOpenDialog(dialogOwner(event), {
    properties: ["openDirectory"],
  }).then(async (selection) => {
    if (selection.canceled) return { cancelled: true } as const;
    if (selection.filePaths.length !== 1) throw createDesktopPublicError("INVALID_PROJECT_ROOT");
    const projectRoot = validateProjectDirectorySelection(selection.filePaths[0]!);
    const result = await controller.runProjectOperation("project-open", { projectRoot });
    return { cancelled: false, value: projectSummary(result) } as const;
  });
}

function addAssetDialogHandler(
  controller: AgentWorkerController,
  event: Electron.IpcMainInvokeEvent,
  input: AddAssetReferencesRequest,
): Promise<ProjectDialogResult<AssetReferenceBatchResult>> {
  return dialog.showOpenDialog(dialogOwner(event), {
    properties: ["openFile", "multiSelections"],
  }).then(async (selection) => {
    if (selection.canceled) return { cancelled: true } as const;
    const paths = validateAssetSelections(selection.filePaths);
    const result = await controller.runProjectOperation("asset-reference", { projectId: input.projectId, paths }, input.projectId);
    return { cancelled: false, value: assetReferenceResult(result) } as const;
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

async function runProjectIntegrationSmoke(firstController: AgentWorkerController): Promise<void> {
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supervideo-project-smoke-"));
  const projectRoot = path.join(smokeRoot, "项目 with spaces");
  const assetPath = path.join(smokeRoot, "外部口播 sample.mp4");
  const fixtureBytes = Buffer.from("fixed A06 project smoke fixture\n", "utf8");
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(assetPath, fixtureBytes, { flag: "wx" });
  const before = fs.statSync(assetPath);
  try {
    await firstController.start();
    const created = projectSummary(await firstController.runProjectOperation("project-create", {
      name: "A06 smoke 项目",
      targetPlatform: "douyin",
      projectRoot,
    }));
    const referenced = assetReferenceResult(await firstController.runProjectOperation("asset-reference", {
      projectId: created.projectId,
      paths: [assetPath],
    }, created.projectId));
    const listed = assetListResult(await firstController.runProjectOperation("asset-list", {
      projectId: created.projectId,
      limit: 100,
    }, created.projectId));
    if (listed.items.length !== 1 || referenced.items.length !== 1 || listed.items[0]?.assetId !== referenced.items[0]?.assetId) {
      throw new Error("asset reference did not persist");
    }
    if (!fs.existsSync(path.join(projectRoot, "project.supervideo.json")) || !fs.existsSync(path.join(projectRoot, "data", "project.db"))) {
      throw new Error("project structure is incomplete");
    }
    if (fs.existsSync(path.join(projectRoot, "materials")) || containsFixture(projectRoot, fixtureBytes)) {
      throw new Error("original media was copied into the project");
    }
    const after = fs.statSync(assetPath);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || !fs.readFileSync(assetPath).equals(fixtureBytes)) {
      throw new Error("original media changed");
    }
    await firstController.shutdown();

    const secondController = createAgentController([]);
    activeAgentController = secondController;
    try {
      await secondController.start();
      const reopened = projectSummary(await secondController.runProjectOperation("project-open", { projectRoot }));
      const reopenedAssets = assetListResult(await secondController.runProjectOperation("asset-list", {
        projectId: reopened.projectId,
        limit: 100,
      }, reopened.projectId));
      const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "project.supervideo.json"), "utf8")) as { projectId?: string };
      if (reopened.projectId !== created.projectId || manifest.projectId !== created.projectId || reopenedAssets.items[0]?.assetId !== listed.items[0]?.assetId) {
        throw new Error("reopen did not restore the same project and asset");
      }
    } finally {
      await secondController.shutdown();
    }
  } finally {
    try {
      if (firstController.getStatus().status !== "stopped") await firstController.shutdown();
    } finally {
      fs.rmSync(smokeRoot, { recursive: true, force: true });
    }
  }
}

function containsFixture(root: string, fixture: Buffer): boolean {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && fs.statSync(candidate).size === fixture.length && fs.readFileSync(candidate).equals(fixture)) return true;
    }
  }
  return false;
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

  let projectDialogBusy = false;
  const withDialogLock = async <T>(kind: string, action: () => Promise<T>): Promise<T> => {
    if (projectDialogBusy) {
      throw createDesktopPublicError("busy");
    }
    projectDialogBusy = true;
    try {
      return await action();
    } finally {
      projectDialogBusy = false;
      log("project-dialog-finished", { kind });
    }
  };

  registerDesktopIpcHandlers(ipcMain, {
    rendererTrustPolicy: runtime,
    getEnvironment: () => getDesktopEnvironment(runtime),
    getAgentStatus: () => agentController.getStatus(),
    runSmokeTask: () => agentController.runSmokeTask(),
    cancelSmokeRun: (runId) => agentController.cancelRun(runId),
    createProject: (event, input) => withDialogLock("create", () => createProjectDialogHandler(agentController, event, input)),
    openProject: (event) => withDialogLock("open", () => openProjectDialogHandler(agentController, event)),
    addAssetReferences: (event, input) => withDialogLock("asset", () => addAssetDialogHandler(agentController, event, input)),
    listProjectAssets: async (_event, input) => {
      const result = await agentController.runProjectOperation("asset-list", { projectId: input.projectId, limit: 100 }, input.projectId);
      return assetListResult(result);
    },
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
  } else if (process.argv.includes("--project-smoke")) {
    void runProjectIntegrationSmoke(agentController)
      .then(() => app.exit(0))
      .catch((error: unknown) => {
        console.error(`[project-smoke] ${error instanceof Error ? error.message : "failed"}`);
        void agentController.shutdown().finally(() => app.exit(1));
      });
  } else {
    createWindow(runtime);
  }

  if (!process.argv.includes("--agent-smoke") && !process.argv.includes("--project-smoke")) {
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
