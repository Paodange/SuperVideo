import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, utilityProcess } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDesktopPublicError,
  DESKTOP_IPC_CHANNELS,
  isAssetListResult,
  isAssetReferenceBatchResult,
  isMediaProxyResult,
  isJobEventPage,
  isJobPage,
  isJobSummary,
  isValidDesktopAgentEvent,
  isProjectSummary,
  isSentenceQaContextResult,
  isSentenceQaSaveResult,
  isRetrievalResult,
  isRerankResult,
  isSlotAlignmentResult,
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
  type JobEventPage,
  type JobEventsListParams,
  type JobListParams,
  type JobPage,
  type JobReferenceParams,
  type JobSmokeStartParams,
  type JobSummary,
  type SentenceQaContextResult,
  type SentenceQaSaveResult,
  type RetrievalParams,
  type RetrievalResult,
  type RerankParams,
  type RerankResult,
  type SlotAlignmentParams,
  type SlotAlignmentResult,
} from "@supervideo/shared";
import {
  createBrowserWindowOptions,
  createContentSecurityPolicy,
  createRuntimeConfig,
  getPreloadPath,
  type RuntimeConfig,
} from "./security/config";
import { createSecurityLogger } from "./security/diagnostics";
import { createElectronCredentialEncryptionAdapter, CredentialVault } from "./security/credential-vault";
import { DiagnosticsCollector } from "./diagnostics/collector";
import { DiagnosticsExporterError, exportDiagnostics } from "./diagnostics/exporter";
import {
  createDesktopAgentStatusEvent,
  registerDesktopIpcHandlers,
  toDesktopAgentEvent,
} from "./security/ipc";
import { denyWindowOpen, isTrustedRendererUrl, sanitizeUrlForDiagnostics } from "./security/policies";
import { registerSessionSecurity } from "./security/session";
import { createAgentWorkerController, type AgentWorkerController, type UtilityProcessLike } from "./agent-worker-controller";
import { parseSuperVideoPlaybackRequest, resolveProxyOutput } from "./media-playback";

protocol.registerSchemesAsPrivileged([{
  scheme: "supervideo",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const logger = createSecurityLogger({ getLogDirectory: () => path.join(app.getPath("userData"), "logs") });
const log = logger;
let latestCoreState = {
  status: "unknown",
  protocolVersion: 1,
  coreVersion: null as string | null,
  capabilityCount: 0,
};
let activePlaybackProject: { projectId: string; projectRoot: string } | undefined;

function registerSuperVideoProtocol(): void {
  protocol.handle("supervideo", async (request) => {
    const playback = parseSuperVideoPlaybackRequest(request.url);
    const project = activePlaybackProject;
    const controller = activeAgentController;
    if (!playback || !project || !controller) return new Response(null, { status: 404 });
    try {
      const result = await controller.runProjectOperation("media-proxy", { projectId: project.projectId, assetId: playback.assetId }, project.projectId);
      if (!isMediaProxyResult(result)) return new Response(null, { status: 404 });
      const output = result.outputs.find((item) => item.kind === playback.kind);
      if (!output || result.projectId !== project.projectId || result.assetId !== playback.assetId) return new Response(null, { status: 404 });
      const outputPath = resolveProxyOutput(project.projectRoot, output, playback.kind);
      if (!outputPath) return new Response(null, { status: 404 });
      const outputStat = fs.lstatSync(outputPath);
      if (outputStat.isSymbolicLink()) return new Response(null, { status: 404 });
      const rootRealPath = fs.realpathSync.native(project.projectRoot);
      const outputRealPath = fs.realpathSync.native(outputPath);
      const realRelative = path.relative(rootRealPath, outputRealPath);
      if (path.isAbsolute(realRelative) || realRelative === ".." || realRelative.startsWith(`..${path.sep}`)) return new Response(null, { status: 404 });
      const stat = fs.statSync(outputRealPath);
      if (!stat.isFile() || stat.size <= 0) return new Response(null, { status: 404 });
      return net.fetch(pathToFileURL(outputRealPath).toString());
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

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
      log: (event, details) => log(event, details),
      onMessage: (message) => {
        smokeMessages.push(message);
        if (message.type === "diagnostic-event") {
          logger.writeDiagnostic(message.event);
          if (message.event.component === "python-core") {
            if (message.event.event === "core-started") {
              latestCoreState = { ...latestCoreState, status: "starting" };
            } else if (message.event.event === "core-ready") {
              const details = message.event.details ?? {};
              latestCoreState = {
                status: "ready",
                protocolVersion: 1,
                coreVersion: typeof details.coreVersion === "string" ? details.coreVersion : latestCoreState.coreVersion,
                capabilityCount: typeof details.capabilityCount === "number" ? details.capabilityCount : latestCoreState.capabilityCount,
              };
            } else if (message.event.event === "core-exit") {
              latestCoreState = { ...latestCoreState, status: "stopped" };
            }
          }
        }
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

function sentenceQaContextResult(value: Readonly<Record<string, unknown>>): SentenceQaContextResult {
  if (!isSentenceQaContextResult(value)) throw createDesktopPublicError("CORE_UNAVAILABLE");
  return value;
}

function sentenceQaSaveResult(value: Readonly<Record<string, unknown>>): SentenceQaSaveResult {
  if (!isSentenceQaSaveResult(value)) throw createDesktopPublicError("CORE_UNAVAILABLE");
  return value;
}

function jobEventPageResult(value: Readonly<Record<string, unknown>>): JobEventPage {
  if (!isJobEventPage(value)) throw new Error("invalid job event page");
  return value;
}

function jobSummary(value: Readonly<Record<string, unknown>>): JobSummary {
  if (!isJobSummary(value)) throw createDesktopPublicError("CORE_UNAVAILABLE");
  return value;
}
function jobPage(value: Readonly<Record<string, unknown>>): JobPage {
  if (!isJobPage(value)) throw createDesktopPublicError("CORE_UNAVAILABLE");
  return value;
}
function jobEventPage(value: Readonly<Record<string, unknown>>): JobEventPage {
  if (!isJobEventPage(value)) throw createDesktopPublicError("CORE_UNAVAILABLE");
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

async function runJobsIntegrationSmoke(firstController: AgentWorkerController, firstMessages: AgentWorkerMessage[]): Promise<void> {
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supervideo-jobs-smoke-"));
  const projectRoot = path.join(smokeRoot, "persistent jobs project");
  fs.mkdirSync(projectRoot);
  try {
    await firstController.start();
    const created = projectSummary(await firstController.runProjectOperation("project-create", {
      name: "A07 jobs smoke", targetPlatform: "douyin", projectRoot,
    }));
    const firstJob = jobSummary(await firstController.runJobOperation("job-smoke-start", created.projectId, {
      idempotencyKey: "a07-success", steps: 8, delayMs: 40, failAttempts: 0,
    }));
    await waitForJobMessage(firstController, firstMessages, firstJob.jobId, (event) => event.status === "running" && event.progress >= 0.25);
    await firstController.shutdown();

    const secondMessages: AgentWorkerMessage[] = [];
    const secondController = createAgentController(secondMessages);
    activeAgentController = secondController;
    try {
      await secondController.start();
      const reopened = projectSummary(await secondController.runProjectOperation("project-open", { projectRoot }));
      if (reopened.projectId !== created.projectId) throw new Error("jobs smoke reopen changed project identity");
      const recovered = await waitForJobMessage(secondController, secondMessages, firstJob.jobId, (event) => event.status === "succeeded");
      const recoveredJob = jobSummary(await secondController.runJobOperation("job-get", created.projectId, { jobId: firstJob.jobId }));
      const recoveredEvents = jobEventPageResult(await secondController.runJobOperation("job-events-list", created.projectId, {
        jobId: firstJob.jobId, afterSequence: 0, cursor: null, limit: 100,
      }));
      if (recoveredJob.status !== "succeeded" || recoveredJob.attempt < 2 || recoveredEvents.items.filter((event) => event.status === "succeeded").length !== 1 || !strictlyIncreasing(recoveredEvents.items.map((event) => event.sequence))) {
        throw new Error("jobs smoke recovery did not continue from a durable checkpoint");
      }
      if (recovered.sequence !== recoveredJob.lastEventSequence) throw new Error("jobs smoke event and summary diverged");

      const cancelJob = jobSummary(await secondController.runJobOperation("job-smoke-start", created.projectId, {
        idempotencyKey: "a07-cancel", steps: 8, delayMs: 45, failAttempts: 0,
      }));
      await waitForJobMessage(secondController, secondMessages, cancelJob.jobId, (event) => event.status === "running" && event.progress >= 0.125);
      const cancelling = jobSummary(await secondController.runJobOperation("job-cancel", created.projectId, { jobId: cancelJob.jobId }));
      if (cancelling.status !== "cancelling") throw new Error("jobs smoke did not persist cancelling");
      await waitForJobMessage(secondController, secondMessages, cancelJob.jobId, (event) => event.status === "cancelled");
      const cancelled = jobSummary(await secondController.runJobOperation("job-get", created.projectId, { jobId: cancelJob.jobId }));
      if (cancelled.status !== "cancelled") throw new Error("jobs smoke cancellation was not durable");

      await secondController.shutdown();
      const thirdMessages: AgentWorkerMessage[] = [];
      const thirdController = createAgentController(thirdMessages);
      activeAgentController = thirdController;
      try {
        await thirdController.start();
        await thirdController.runProjectOperation("project-open", { projectRoot });
        const stillCancelled = jobSummary(await thirdController.runJobOperation("job-get", created.projectId, { jobId: cancelJob.jobId }));
        if (stillCancelled.status !== "cancelled") throw new Error("cancelled job was resumed after reopen");
        const failedJob = jobSummary(await thirdController.runJobOperation("job-smoke-start", created.projectId, {
          idempotencyKey: "a07-retry", steps: 8, delayMs: 20, failAttempts: 1,
        }));
        await waitForJobMessage(thirdController, thirdMessages, failedJob.jobId, (event) => event.status === "failed");
        const retrying = jobSummary(await thirdController.runJobOperation("job-retry", created.projectId, { jobId: failedJob.jobId }));
        if (retrying.status !== "retrying") throw new Error("jobs smoke retry did not enqueue");
        await waitForJobMessage(thirdController, thirdMessages, failedJob.jobId, (event) => event.status === "succeeded");
        const retried = jobSummary(await thirdController.runJobOperation("job-get", created.projectId, { jobId: failedJob.jobId }));
        if (retried.status !== "succeeded" || retried.attempt !== 2) throw new Error("jobs smoke retry did not advance attempt");
      } finally {
        await thirdController.shutdown();
      }
    } finally {
      if (secondController.getStatus().status !== "stopped") await secondController.shutdown();
    }
  } finally {
    if (firstController.getStatus().status !== "stopped") await firstController.shutdown();
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }
}

async function waitForJobMessage(
  controller: AgentWorkerController,
  messages: AgentWorkerMessage[],
  jobId: string,
  predicate: (event: Extract<AgentWorkerMessage, { type: "job-event" }>['event']) => boolean,
  timeoutMs = 30_000,
): Promise<Extract<AgentWorkerMessage, { type: "job-event" }>['event']> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const found = messages.find((message): message is Extract<AgentWorkerMessage, { type: "job-event" }> => message.type === "job-event" && message.jobId === jobId && predicate(message.event));
      if (found) { clearInterval(timer); resolve(found.event); }
      else if (Date.now() - startedAt >= timeoutMs) { clearInterval(timer); reject(new Error("Timed out waiting for persistent job event.")); }
    }, 20);
  });
}

function strictlyIncreasing(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value > values[index - 1]!);
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
  log("app-ready");
  registerSuperVideoProtocol();
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

  const credentialVault = new CredentialVault({
    filePath: path.join(app.getPath("userData"), "security", "credentials.v1.json"),
    encryption: createElectronCredentialEncryptionAdapter(safeStorage),
  });
  let diagnosticProject = { open: false, manifestSchemaVersion: null as number | null, databaseSchemaVersion: null as number | null };
  let diagnosticJobs: JobSummary[] = [];
  const rememberJob = (job: JobSummary): JobSummary => {
    const index = diagnosticJobs.findIndex((item) => item.jobId === job.jobId);
    if (index < 0) diagnosticJobs = [...diagnosticJobs, job];
    else diagnosticJobs = diagnosticJobs.map((item, itemIndex) => itemIndex === index ? job : item);
    return job;
  };
  const diagnosticsCollector = new DiagnosticsCollector({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? "unknown",
    nodeVersion: process.versions.node ?? "unknown",
    platform: process.platform,
    release: process.platform === "win32" ? os.release() : process.platform,
    architecture: process.arch,
    getWorkerStatus: () => agentController.getStatus(),
    getCoreState: () => latestCoreState,
    getProject: () => diagnosticProject,
    getJobs: () => diagnosticJobs,
    vault: credentialVault,
    logger,
  });

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
    createProject: async (event, input) => {
      const result = await withDialogLock("create", () => createProjectDialogHandler(agentController, event, input));
      if (!result.cancelled) {
        diagnosticProject = { open: true, manifestSchemaVersion: result.value.manifestSchemaVersion, databaseSchemaVersion: result.value.databaseSchemaVersion };
        activePlaybackProject = { projectId: result.value.projectId, projectRoot: result.value.projectRoot };
        diagnosticJobs = [];
      }
      return result;
    },
    openProject: async (event) => {
      const result = await withDialogLock("open", () => openProjectDialogHandler(agentController, event));
      if (!result.cancelled) {
        diagnosticProject = { open: true, manifestSchemaVersion: result.value.manifestSchemaVersion, databaseSchemaVersion: result.value.databaseSchemaVersion };
        activePlaybackProject = { projectId: result.value.projectId, projectRoot: result.value.projectRoot };
      }
      return result;
    },
    addAssetReferences: (event, input) => withDialogLock("asset", () => addAssetDialogHandler(agentController, event, input)),
    listProjectAssets: async (_event, input) => {
      const result = await agentController.runProjectOperation("asset-list", { projectId: input.projectId, limit: 100 }, input.projectId);
      return assetListResult(result);
    },
    inspectSentenceQa: async (_event, input) => sentenceQaContextResult(await agentController.runProjectOperation("media-sentence-qa-context", input, input.projectId)),
    saveSentenceQa: async (_event, input) => sentenceQaSaveResult(await agentController.runProjectOperation("media-sentence-qa-save", input, input.projectId)),
    retrieveSentences: async (_event, input: RetrievalParams): Promise<RetrievalResult> => {
      const result = await agentController.runProjectOperation("media-sentence-retrieve", input, input.projectId);
      if (!isRetrievalResult(result)) throw createDesktopPublicError("CORE_UNAVAILABLE");
      return result;
    },
    rerankSentences: async (_event, input: RerankParams): Promise<RerankResult> => {
      const result = await agentController.runProjectOperation("media-sentence-rerank", input, input.projectId);
      if (!isRerankResult(result)) throw createDesktopPublicError("CORE_UNAVAILABLE");
      return result;
    },
    alignScript: async (_event, input: SlotAlignmentParams): Promise<SlotAlignmentResult> => {
      const result = await agentController.runProjectOperation("media-script-align", input, input.projectId);
      if (!isSlotAlignmentResult(result)) throw createDesktopPublicError("CORE_UNAVAILABLE");
      return result;
    },
    startSmokeJob: async (_event, input) => rememberJob(jobSummary(await agentController.runJobOperation(
      "job-smoke-start", input.projectId,
      {
        idempotencyKey: input.idempotencyKey,
        ...(input.steps === undefined ? {} : { steps: input.steps }),
        ...(input.delayMs === undefined ? {} : { delayMs: input.delayMs }),
        ...(input.failAttempts === undefined ? {} : { failAttempts: input.failAttempts }),
      },
    ))),
    getJob: async (_event, input) => rememberJob(jobSummary(await agentController.runJobOperation("job-get", input.projectId, { jobId: input.jobId }))),
    listJobs: async (_event, input) => {
      const result = jobPage(await agentController.runJobOperation(
        "job-list", input.projectId,
        {
          ...(input.statuses === undefined ? {} : { statuses: input.statuses }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        },
      ));
      diagnosticJobs = [...result.items];
      return result;
    },
    listJobEvents: async (_event, input) => jobEventPage(await agentController.runJobOperation(
      "job-events-list", input.projectId,
      {
        jobId: input.jobId,
        ...(input.afterSequence === undefined ? {} : { afterSequence: input.afterSequence }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      },
    )),
    cancelJob: async (_event, input) => rememberJob(jobSummary(await agentController.runJobOperation("job-cancel", input.projectId, { jobId: input.jobId }))),
    retryJob: async (_event, input) => rememberJob(jobSummary(await agentController.runJobOperation("job-retry", input.projectId, { jobId: input.jobId }))),
    credentialsStatus: () => {
      const status = credentialVault.status();
      log("credential-status", { available: status.available, state: status.state });
      return status;
    },
    credentialsList: async () => {
      const result = await credentialVault.list();
      log("credential-status", { count: result.items.length });
      return result;
    },
    credentialsSave: async (input) => {
      const result = await credentialVault.save(input);
      log("credential-saved", { serviceKind: result.serviceKind, configured: true });
      return result;
    },
    credentialsReplace: async (input) => {
      const result = await credentialVault.replace(input);
      log("credential-replaced", { serviceKind: result.serviceKind, configured: true });
      return result;
    },
    credentialsRemove: async (input) => {
      const result = await credentialVault.remove(input);
      log("credential-removed", { configured: false });
      return result;
    },
    diagnosticsExport: async (event) => {
      log("diagnostic-export-started");
      try {
        const result = await exportDiagnostics({
          owner: dialogOwner(event),
          showSaveDialog: (owner, options) => dialog.showSaveDialog(owner as BrowserWindow, options as Electron.SaveDialogOptions),
          collector: diagnosticsCollector,
        });
        log("diagnostic-export-finished", { status: result.status });
        return result;
      } catch (error) {
        log("diagnostic-export-failed", {
          errorCode: "DIAGNOSTIC_EXPORT_FAILED",
          reason: error instanceof DiagnosticsExporterError ? error.phase : "unknown",
        });
        throw error;
      }
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
      .catch((_error: unknown) => {
        log("agent-start-failed", { reason: "agent-smoke-failed" });
        void agentController.shutdown().finally(() => app.exit(1));
      });
  } else if (process.argv.includes("--project-smoke")) {
    void runProjectIntegrationSmoke(agentController)
      .then(() => app.exit(0))
      .catch((_error: unknown) => {
        log("agent-start-failed", { reason: "project-smoke-failed" });
        void agentController.shutdown().finally(() => app.exit(1));
      });
  } else if (process.argv.includes("--jobs-smoke")) {
    void runJobsIntegrationSmoke(agentController, smokeMessages)
      .then(() => app.exit(0))
      .catch((_error: unknown) => {
        log("agent-start-failed", { reason: "jobs-smoke-failed" });
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
  log("app-shutdown");
  const shutdown = activeAgentController?.shutdown() ?? Promise.resolve();
  void shutdown.finally(() => logger.flush().finally(() => app.exit(0)));
});

let activeAgentController: AgentWorkerController | undefined;

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
