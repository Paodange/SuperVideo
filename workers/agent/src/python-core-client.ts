import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CORE_RPC_ERROR_MESSAGES,
  CORE_RPC_ERROR_NUMBERS,
  CORE_RPC_MAX_LINE_BYTES,
  CORE_RPC_METHODS,
  CORE_RPC_PROTOCOL_VERSION,
  createCoreRpcRequest,
  isCoreHealth,
  isCoreJobEventNotification,
  isCoreProgressNotification,
  isCoreRpcErrorCode,
  isCoreRpcRequest,
  isCoreRpcServerMessage,
  isCoreSmokeCountdownParams,
  isCoreSmokeCountdownResult,
  isJobEventPage,
  isJobEventsListParams,
  isJobListParams,
  isJobReferenceParams,
  isJobSmokeStartParams,
  isJobPage,
  isJobSummary,
  isAssetListResult,
  isAssetReferenceBatchResult,
  isAssetScanResult,
  isMediaProbeResult,
  isMediaProxyResult,
  isTranscriptionResult,
  isVadResult,
  isSentenceResult,
  isSentenceQaContextResult,
  isSentenceQaSaveResult,
  isProjectSummary,
  serializeCoreRpcMessage,
  type CoreHealth,
  type CoreProgress,
  type CoreRpcErrorCode,
  type CoreRpcServerMessage,
  type CoreSmokeCountdownParams,
  type CoreSmokeCountdownResult,
  type AssetListParams,
  type AssetListResult,
  type AssetReferenceBatchResult,
  type AssetReferenceParams,
  type AssetScanParams,
  type AssetScanResult,
  type MediaParams,
  type MediaProbeResult,
  type MediaProxyResult,
  type TranscriptionParams,
  type TranscriptionResult,
  type VadParams,
  type VadResult,
  type SentenceParams,
  type SentenceResult,
  type SentenceQaParams,
  type SentenceQaContextResult,
  type SentenceQaSaveParams,
  type SentenceQaSaveResult,
  type ProjectCreateParams,
  type ProjectOpenParams,
  type ProjectSummary,
  type JobEvent,
  type JobEventPage,
  type JobEventsListParams,
  type JobListParams,
  type JobPage,
  type JobReferenceParams,
  type JobSmokeStartParams,
  type JobSummary,
} from "@supervideo/shared";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_PENDING_REQUESTS = 16;
const MAX_DIAGNOSTIC_BYTES = 4 * 1024;

export type CoreClientStatus = "stopped" | "starting" | "ready" | "closing" | "failed";

export type CoreRpcRequestOptions = Readonly<{
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: CoreProgress) => void;
}>;

export type JobEventListener = (event: JobEvent) => void;

export type PythonCoreClientOptions = Readonly<{
  rootDir?: string;
  requestTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  maxPendingRequests?: number;
  onProgress?: (progress: CoreProgress) => void;
  onDiagnostic?: (message: string) => void;
  onJobEvent?: JobEventListener;
  /** Test-only transport seam. It cannot change the executable or arguments. */
  spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => CoreProcessLike;
}>;

export type CoreProcessLike = {
  readonly pid?: number;
  readonly stdin: CoreWritableLike;
  readonly stdout: CoreEventSource;
  readonly stderr: CoreEventSource;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
  removeListener: (event: string, listener: (...args: any[]) => void) => unknown;
  kill: (signal?: NodeJS.Signals | number) => boolean;
};

export type CoreEventSource = {
  on: (event: string, listener: (...args: any[]) => void) => unknown;
  removeListener?: (event: string, listener: (...args: any[]) => void) => unknown;
};

export type CoreWritableLike = CoreEventSource & {
  write: (chunk: string, encoding?: BufferEncoding, callback?: (error?: Error | null) => void) => boolean;
  end: (callback?: () => void) => void;
};

export class CoreRpcError extends Error {
  readonly numericCode: number;

  constructor(readonly code: CoreRpcErrorCode) {
    super(CORE_RPC_ERROR_MESSAGES[code]);
    this.name = "CoreRpcError";
    this.numericCode = CORE_RPC_ERROR_NUMBERS[code];
  }
}

type PendingRequest = {
  id: string;
  timer: ReturnType<typeof globalThis.setTimeout>;
  signal?: AbortSignal;
  abortListener?: () => void;
  lastProgressSequence: number;
  onProgress?: (progress: CoreProgress) => void;
  resolve: (result: unknown) => void;
  reject: (error: CoreRpcError) => void;
};

type PythonLaunch = Readonly<{
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}>;

type ProcessHandlers = Readonly<{
  stdoutData: (chunk: unknown) => void;
  stdoutEnd: () => void;
  stderrData: (chunk: unknown) => void;
  processError: (error: NodeJS.ErrnoException) => void;
  processExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  stdinError: (error: Error) => void;
}>;

export class PythonCoreClient {
  private readonly rootDir: string;
  private readonly requestTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly maxPendingRequests: number;
  private readonly progressListener?: (progress: CoreProgress) => void;
  private readonly diagnosticListener?: (message: string) => void;
  private readonly jobEventListeners = new Set<JobEventListener>();
  private readonly jobEventSequences = new Map<string, number>();
  private readonly spawnProcess: NonNullable<PythonCoreClientOptions["spawnProcess"]>;
  private readonly pending = new Map<string, PendingRequest>();
  private process?: CoreProcessLike;
  private processHandlers?: ProcessHandlers;
  private stdoutBuffer = "";
  private readonly stdoutDecoder = new TextDecoder("utf-8", { fatal: true });
 private diagnosticLineBuffer = "";
  private status: CoreClientStatus = "stopped";
  private healthResult?: CoreHealth;
  private startPromise?: Promise<CoreHealth>;
  private shutdownPromise?: Promise<void>;
  private shutdownResolve?: () => void;
  private shutdownTimer?: ReturnType<typeof globalThis.setTimeout>;
  private shuttingDown = false;

  constructor(options: PythonCoreClientOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? defaultRootDir());
    this.requestTimeoutMs = clampTimeout(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
    this.handshakeTimeoutMs = clampTimeout(options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS, DEFAULT_HANDSHAKE_TIMEOUT_MS);
    this.shutdownTimeoutMs = clampTimeout(options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS, DEFAULT_SHUTDOWN_TIMEOUT_MS);
    this.maxPendingRequests = clampInteger(options.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS, 1, 64);
    this.progressListener = options.onProgress;
    this.diagnosticListener = options.onDiagnostic;
    if (options.onJobEvent) this.jobEventListeners.add(options.onJobEvent);
    this.spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, [...args], spawnOptions) as unknown as CoreProcessLike);
  }

  async start(): Promise<CoreHealth> {
    if (this.status === "ready" && this.healthResult) {
      return this.healthResult;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    if (this.shuttingDown || this.status === "closing") {
      throw new CoreRpcError("TRANSPORT_CLOSED");
    }
    this.status = "starting";
    const promise = this.startCore();
    this.startPromise = promise;
    promise.finally(() => {
      if (this.startPromise === promise) {
        this.startPromise = undefined;
      }
    }).catch(() => undefined);
    return promise;
  }

  async request<T>(method: string, params: unknown, options: CoreRpcRequestOptions = {}): Promise<T> {
    if (this.status !== "ready" || !this.process) {
      throw new CoreRpcError("TRANSPORT_CLOSED");
    }
    return this.requestInternal<T>(method, params, options);
  }

  async health(): Promise<CoreHealth> {
    const result = await this.request<CoreHealth>(CORE_RPC_METHODS.health, {});
    if (!isCoreHealth(result)) {
      throw new CoreRpcError("PROTOCOL_MISMATCH");
    }
    return result;
  }

  async runSmokeCountdown(
    params: CoreSmokeCountdownParams,
    options: CoreRpcRequestOptions = {},
  ): Promise<CoreSmokeCountdownResult> {
    if (!isCoreSmokeCountdownParams(params)) {
      throw new CoreRpcError("INVALID_PARAMS");
    }
    const result = await this.request<CoreSmokeCountdownResult>(CORE_RPC_METHODS.smokeCountdown, params, options);
    if (!isCoreSmokeCountdownResult(result)) {
      throw new CoreRpcError("PROTOCOL_ERROR");
    }
    return result;
  }

  async createProject(params: ProjectCreateParams, options: CoreRpcRequestOptions = {}): Promise<ProjectSummary> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.projectCreate, params, options);
    if (!isProjectSummary(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async openProject(params: ProjectOpenParams, options: CoreRpcRequestOptions = {}): Promise<ProjectSummary> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.projectOpen, params, options);
    if (!isProjectSummary(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async inspectProject(params: ProjectOpenParams, options: CoreRpcRequestOptions = {}): Promise<ProjectSummary> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.projectInspect, params, options);
    if (!isProjectSummary(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async referenceAssets(params: AssetReferenceParams, options: CoreRpcRequestOptions = {}): Promise<AssetReferenceBatchResult> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.assetReference, params, options);
    if (!isAssetReferenceBatchResult(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async listAssets(params: AssetListParams, options: CoreRpcRequestOptions = {}): Promise<AssetListResult> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.assetList, params, options);
    if (!isAssetListResult(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async scanAssets(params: AssetScanParams, options: CoreRpcRequestOptions = {}): Promise<AssetScanResult> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.assetScan, params, options);
    if (!isAssetScanResult(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async probeMedia(params: MediaParams, options: CoreRpcRequestOptions = {}): Promise<MediaProbeResult> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.mediaProbe, params, options);
    if (!isMediaProbeResult(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async proxyMedia(params: MediaParams, options: CoreRpcRequestOptions = {}): Promise<MediaProxyResult> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.mediaProxy, params, options);
    if (!isMediaProxyResult(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async transcribeMedia(params: TranscriptionParams, options: CoreRpcRequestOptions = {}): Promise<TranscriptionResult> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.mediaTranscribe, params, options);
    if (!isTranscriptionResult(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async detectVoiceActivity(params: VadParams, options: CoreRpcRequestOptions = {}): Promise<VadResult> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.mediaVad, params, options);
    if (!isVadResult(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async splitSentences(params: SentenceParams, options: CoreRpcRequestOptions = {}): Promise<SentenceResult> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.mediaSentences, params, options);
    if (!isSentenceResult(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async inspectSentenceQa(params: SentenceQaParams, options: CoreRpcRequestOptions = {}): Promise<SentenceQaContextResult> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.mediaSentenceQaContext, params, options);
    if (!isSentenceQaContextResult(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async saveSentenceQa(params: SentenceQaSaveParams, options: CoreRpcRequestOptions = {}): Promise<SentenceQaSaveResult> {
    const result = await this.request<unknown>(CORE_RPC_METHODS.mediaSentenceQaSave, params, options);
    if (!isSentenceQaSaveResult(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async startSmokeJob(params: JobSmokeStartParams, options: CoreRpcRequestOptions = {}): Promise<JobSummary> {
    if (!isJobSmokeStartParams(params)) throw new CoreRpcError("INVALID_PARAMS");
    const result = await this.request<unknown>(CORE_RPC_METHODS.jobSmokeStart, params, options);
    if (!isJobSummary(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async getJob(params: JobReferenceParams, options: CoreRpcRequestOptions = {}): Promise<JobSummary> {
    if (!isJobReferenceParams(params)) throw new CoreRpcError("INVALID_PARAMS");
    const result = await this.request<unknown>(CORE_RPC_METHODS.jobGet, params, options);
    if (!isJobSummary(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async listJobs(params: JobListParams, options: CoreRpcRequestOptions = {}): Promise<JobPage> {
    if (!isJobListParams(params)) throw new CoreRpcError("INVALID_PARAMS");
    const result = await this.request<unknown>(CORE_RPC_METHODS.jobList, params, options);
    if (!isJobPage(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async listJobEvents(params: JobEventsListParams, options: CoreRpcRequestOptions = {}): Promise<JobEventPage> {
    if (!isJobEventsListParams(params)) throw new CoreRpcError("INVALID_PARAMS");
    const result = await this.request<unknown>(CORE_RPC_METHODS.jobEventsList, params, options);
    if (!isJobEventPage(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async cancelJob(params: JobReferenceParams, options: CoreRpcRequestOptions = {}): Promise<JobSummary> {
    if (!isJobReferenceParams(params)) throw new CoreRpcError("INVALID_PARAMS");
    const result = await this.request<unknown>(CORE_RPC_METHODS.jobCancel, params, options);
    if (!isJobSummary(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  async retryJob(params: JobReferenceParams, options: CoreRpcRequestOptions = {}): Promise<JobSummary> {
    if (!isJobReferenceParams(params)) throw new CoreRpcError("INVALID_PARAMS");
    const result = await this.request<unknown>(CORE_RPC_METHODS.jobRetry, params, options);
    if (!isJobSummary(result)) throw new CoreRpcError("PROTOCOL_ERROR");
    return result;
  }

  onJobEvent(listener: JobEventListener): () => void {
    this.jobEventListeners.add(listener);
    return () => this.jobEventListeners.delete(listener);
  }

  getStatus(): CoreClientStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    this.shuttingDown = true;
    this.shutdownPromise = this.closeProcess("TRANSPORT_CLOSED");
    return this.shutdownPromise;
  }

  private async startCore(): Promise<CoreHealth> {
    try {
      this.launch();
      const result = await this.requestInternal<CoreHealth>(CORE_RPC_METHODS.health, {}, { timeoutMs: this.handshakeTimeoutMs });
      if (!isCoreHealth(result) || result.protocolVersion !== CORE_RPC_PROTOCOL_VERSION) {
        throw new CoreRpcError("PROTOCOL_MISMATCH");
      }
      this.healthResult = result;
      this.status = "ready";
      return result;
    } catch (error) {
      const rpcError = asCoreRpcError(error, "TRANSPORT_CLOSED");
      await this.closeProcess(rpcError.code);
      this.status = "failed";
      throw rpcError;
    }
  }

  private launch(): void {
    const launch = resolvePythonLaunch(this.rootDir);
    let child: CoreProcessLike;
    try {
      child = this.spawnProcess(launch.command, launch.args, launch.options);
    } catch (error) {
      throw new CoreRpcError("PYTHON_NOT_FOUND");
    }
    this.process = child;
    const handlers: ProcessHandlers = {
      stdoutData: (chunk) => this.handleStdoutData(chunk),
      stdoutEnd: () => this.handleStdoutEnd(),
      stderrData: (chunk) => this.handleStderrData(chunk),
      processError: (error) => this.handleProcessError(error),
      processExit: (code, signal) => this.handleProcessExit(code, signal),
      stdinError: (error) => this.handleStdinError(error),
    };
    this.processHandlers = handlers;
    child.stdout.on("data", handlers.stdoutData);
    child.stdout.on("end", handlers.stdoutEnd);
    child.stderr.on("data", handlers.stderrData);
    child.on("error", handlers.processError);
    child.on("exit", handlers.processExit);
    child.stdin.on("error", handlers.stdinError);
  }

  private requestInternal<T>(method: string, params: unknown, options: CoreRpcRequestOptions): Promise<T> {
    if (!this.process || this.shuttingDown) {
      return Promise.reject(new CoreRpcError("TRANSPORT_CLOSED"));
    }
    if (this.pending.size >= this.maxPendingRequests) {
      return Promise.reject(new CoreRpcError("BUSY"));
    }
    const id = `rpc-${crypto.randomUUID()}`;
    const candidate = createCoreRpcRequest(id, method, params as Readonly<Record<string, unknown>>);
    if (!isCoreRpcRequest(candidate)) {
      return Promise.reject(new CoreRpcError("INVALID_PARAMS"));
    }
    const timeoutMs = clampTimeout(options.timeoutMs ?? this.requestTimeoutMs, this.requestTimeoutMs);
    return new Promise<T>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.removePending(pending);
        this.sendCancel(id);
        reject(new CoreRpcError("REQUEST_TIMEOUT"));
      }, timeoutMs);
      const pending: PendingRequest = {
        id,
        timer,
        signal: options.signal,
        lastProgressSequence: 0,
        onProgress: options.onProgress,
        resolve: (result) => resolve(result as T),
        reject,
      };
      pending.abortListener = () => {
        if (!this.pending.has(id)) return;
        this.removePending(pending);
        this.sendCancel(id);
        reject(new CoreRpcError("REQUEST_CANCELLED"));
      };
      this.pending.set(id, pending);
      if (options.signal?.aborted) {
        pending.abortListener();
        return;
      }
      options.signal?.addEventListener("abort", pending.abortListener, { once: true });
      try {
        this.writeMessage(candidate);
      } catch (error) {
        this.removePending(pending);
        reject(asCoreRpcError(error, "TRANSPORT_CLOSED"));
      }
    });
  }

  private writeMessage(message: Parameters<typeof serializeCoreRpcMessage>[0]): void {
    let line: string;
    try {
      line = `${serializeCoreRpcMessage(message)}\n`;
    } catch (error) {
      throw new CoreRpcError("MESSAGE_TOO_LARGE");
    }
    if (!this.process) {
      throw new CoreRpcError("TRANSPORT_CLOSED");
    }
    try {
      this.process.stdin.write(line, "utf8");
    } catch {
      throw new CoreRpcError("TRANSPORT_CLOSED");
    }
  }

  private sendCancel(requestId: string): void {
    if (!this.process || this.shuttingDown) return;
    try {
      this.writeMessage({
        jsonrpc: "2.0",
        method: CORE_RPC_METHODS.cancel,
        params: { requestId },
      });
    } catch {
      // The original timeout/cancel outcome is more useful to the caller.
    }
  }

  private handleStdoutData(chunk: unknown): void {
    try {
      const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk));
      this.stdoutBuffer += this.stdoutDecoder.decode(bytes, { stream: true });
      const lastNewline = this.stdoutBuffer.lastIndexOf("\n");
      const unfinishedLine = lastNewline >= 0 ? this.stdoutBuffer.slice(lastNewline + 1) : this.stdoutBuffer;
      if (new TextEncoder().encode(unfinishedLine).byteLength > CORE_RPC_MAX_LINE_BYTES) {
        this.handleProtocolFailure();
        return;
      }
      let newlineIndex = this.stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        let line = this.stdoutBuffer.slice(0, newlineIndex);
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (new TextEncoder().encode(line).byteLength > CORE_RPC_MAX_LINE_BYTES) {
          this.handleProtocolFailure();
          return;
        }
        if (line.length > 0) {
          this.handleLine(line);
        }
        newlineIndex = this.stdoutBuffer.indexOf("\n");
      }
    } catch {
      this.handleProtocolFailure();
    }
  }

  private handleStdoutEnd(): void {
    try {
      this.stdoutBuffer += this.stdoutDecoder.decode();
    } catch {
      this.handleProtocolFailure();
      return;
    }
    if (this.stdoutBuffer.trim().length > 0) {
      this.handleProtocolFailure();
    }
  }

  private handleLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.handleProtocolFailure();
      return;
    }
    if (!isCoreRpcServerMessage(value)) {
      this.handleProtocolFailure();
      return;
    }
    this.routeMessage(value);
  }

  private routeMessage(message: CoreRpcServerMessage): void {
    if (isCoreJobEventNotification(message)) {
      const key = `${message.params.projectId}:${message.params.jobId}`;
      const previous = this.jobEventSequences.get(key) ?? 0;
      if (message.params.sequence <= previous) return;
      this.jobEventSequences.set(key, message.params.sequence);
      for (const listener of this.jobEventListeners) {
        try { listener(message.params); } catch { this.emitDiagnostic("Job event listener failed."); }
      }
      return;
    }
    if (isCoreProgressNotification(message)) {
      const pending = this.pending.get(message.params.requestId);
      if (!pending || message.params.sequence <= pending.lastProgressSequence) {
        return;
      }
      pending.lastProgressSequence = message.params.sequence;
      try {
        pending.onProgress?.(message.params);
        this.progressListener?.(message.params);
      } catch {
        this.emitDiagnostic("Progress listener failed.");
      }
      return;
    }
    if (message.id === null) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.removePending(pending);
    if ("error" in message) {
      const errorCode = message.error?.data.errorCode;
      pending.reject(new CoreRpcError(isCoreRpcErrorCode(errorCode) ? errorCode : "PROTOCOL_ERROR"));
      return;
    }
    pending.resolve(message.result);
  }

  private handleStderrData(chunk: unknown): void {
    const text = typeof chunk === "string" ? chunk : chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : String(chunk);
    this.diagnosticLineBuffer += text;
    if (this.diagnosticLineBuffer.length > MAX_DIAGNOSTIC_BYTES) {
      this.diagnosticLineBuffer = this.diagnosticLineBuffer.slice(-MAX_DIAGNOSTIC_BYTES);
    }
    let newlineIndex = this.diagnosticLineBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.diagnosticLineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.diagnosticLineBuffer = this.diagnosticLineBuffer.slice(newlineIndex + 1);
      if (line) this.emitDiagnostic(line.slice(0, 2_048));
      newlineIndex = this.diagnosticLineBuffer.indexOf("\n");
    }
  }

  private handleProcessError(error: NodeJS.ErrnoException): void {
    const code = error?.code === "ENOENT" ? "PYTHON_NOT_FOUND" : "TRANSPORT_CLOSED";
    this.emitDiagnostic(code);
    this.rejectAll(code);
    if (!this.shuttingDown) {
      this.status = "failed";
    }
  }

  private handleStdinError(_error: Error): void {
    this.rejectAll("TRANSPORT_CLOSED");
    if (!this.shuttingDown) {
      this.status = "failed";
    }
  }

  private handleProcessExit(_code: number | null, _signal: NodeJS.Signals | null): void {
    const child = this.process;
    if (!child) return;
    this.detachProcess(child);
    this.process = undefined;
    this.processHandlers = undefined;
    this.stdoutBuffer = "";
   this.diagnosticLineBuffer = "";
    this.rejectAll("TRANSPORT_CLOSED");
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = undefined;
    }
    const resolve = this.shutdownResolve;
    this.shutdownResolve = undefined;
    if (this.shuttingDown) {
      this.status = "stopped";
    } else {
      this.status = "failed";
    }
    resolve?.();
  }

  private handleProtocolFailure(): void {
    this.rejectAll("PROTOCOL_ERROR");
    this.status = "failed";
    try {
      this.process?.kill();
    } catch {
      // The exit handler performs the remaining cleanup.
    }
  }

  private rejectAll(code: CoreRpcErrorCode): void {
    const error = new CoreRpcError(code);
    for (const pending of [...this.pending.values()]) {
      this.removePending(pending);
      pending.reject(error);
    }
  }

  private removePending(pending: PendingRequest): void {
    if (!this.pending.delete(pending.id)) return;
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
  }

  private async closeProcess(reason: CoreRpcErrorCode): Promise<void> {
    this.rejectAll(reason);
    const child = this.process;
    if (!child) {
      this.status = "stopped";
      return;
    }
    this.status = "closing";
    await new Promise<void>((resolve) => {
      this.shutdownResolve = resolve;
      this.shutdownTimer = globalThis.setTimeout(() => {
        this.shutdownTimer = undefined;
        try {
          child.kill();
        } catch {
          // The process may already have exited; resolve below either way.
        }
        if (this.process === child) {
          this.detachProcess(child);
          this.process = undefined;
          this.processHandlers = undefined;
          this.status = "stopped";
          this.shutdownResolve = undefined;
          resolve();
        }
      }, this.shutdownTimeoutMs);
      try {
        child.stdin.end();
      } catch {
        try {
          child.kill();
        } catch {
          // resolve via the bounded shutdown timer
        }
      }
    });
  }

  private detachProcess(child: CoreProcessLike): void {
    const handlers = this.processHandlers;
    if (!handlers) return;
    child.stdout.removeListener?.("data", handlers.stdoutData);
    child.stdout.removeListener?.("end", handlers.stdoutEnd);
    child.stderr.removeListener?.("data", handlers.stderrData);
    child.stdin.removeListener?.("error", handlers.stdinError);
    child.removeListener("error", handlers.processError);
    child.removeListener("exit", handlers.processExit);
  }

  private emitDiagnostic(message: string): void {
    if (!message) return;
    this.diagnosticListener?.(message.slice(0, 2_048));
  }
}

export function resolvePythonLaunch(rootDir: string): PythonLaunch {
  const coreSource = path.join(rootDir, "services", "core", "src");
  const isWindows = process.platform === "win32";
  const venvPython = path.join(rootDir, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");
  const command = existsSync(venvPython) ? venvPython : isWindows ? "py.exe" : "python3";
  const args = existsSync(venvPython)
    ? ["-m", "supervideo_core.rpc"]
    : isWindows
      ? ["-3", "-m", "supervideo_core.rpc"]
      : ["-m", "supervideo_core.rpc"];
  const existingPythonPath = process.env.PYTHONPATH;
  const pythonPath = existingPythonPath ? `${coreSource}${path.delimiter}${existingPythonPath}` : coreSource;
  return {
    command,
    args,
    options: {
      cwd: rootDir,
      env: { ...process.env, PYTHONPATH: pythonPath },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    },
  };
}

function defaultRootDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function clampTimeout(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), MAX_REQUEST_TIMEOUT_MS);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function asCoreRpcError(error: unknown, fallback: CoreRpcErrorCode): CoreRpcError {
  return error instanceof CoreRpcError ? error : new CoreRpcError(fallback);
}
