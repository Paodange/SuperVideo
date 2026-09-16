import {
  AGENT_WORKER_PROTOCOL_VERSION,
  createAgentPublicError,
  isAgentWorkerMessageWithinLimit,
  isValidAgentRunId,
  isValidAgentWorkerMessage,
  isJobEvent,
  type AgentPublicErrorCode,
  type AgentJobOperationType,
  type AgentProjectOperationPayload,
  type AgentProjectOperationType,
  type AgentRunHandle,
  type AgentRunStatus,
  type AgentWorkerCommand,
  type AgentWorkerMessage,
  type AgentWorkerStatusSnapshot,
  type ProjectOperationError,
  type JobOperationError,
  type JobEvent,
} from "@supervideo/shared";

export type UtilityProcessLike = {
  readonly pid?: number;
  postMessage: (message: AgentWorkerCommand) => void;
  kill: () => void;
  on: (event: any, listener: (...args: any[]) => void) => void;
  removeListener: (event: any, listener: (...args: any[]) => void) => void;
};

export type AgentWorkerLog = (event: string, details?: Readonly<Record<string, string | number | boolean>>) => void;

export type AgentWorkerControllerOptions = Readonly<{
  workerPath: string;
  createProcess: (workerPath: string, generation: number) => UtilityProcessLike;
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof globalThis.setTimeout>) => void;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  maxRestarts?: number;
  restartWindowMs?: number;
  restartBackoffMs?: readonly number[];
  log?: AgentWorkerLog;
  onMessage?: (message: AgentWorkerMessage) => void;
  onStatusChange?: (status: AgentWorkerStatusSnapshot) => void;
}>;

export class AgentWorkerControllerError extends Error {
  readonly publicError: ReturnType<typeof createAgentPublicError>;

  constructor(readonly code: AgentPublicErrorCode) {
    const publicError = createAgentPublicError(code);
    super(publicError.message);
    this.name = "AgentWorkerControllerError";
    this.publicError = publicError;
  }
}

export class ProjectOperationControllerError extends Error {
  constructor(readonly operationError: ProjectOperationError) {
    super(operationError.message);
    this.name = "ProjectOperationControllerError";
  }
}

export class JobOperationControllerError extends Error {
  constructor(readonly operationError: JobOperationError) {
    super(operationError.message);
    this.name = "JobOperationControllerError";
  }
}

type ActiveProcess = {
  child: UtilityProcessLike;
  generation: number;
  spawnedAt: number;
  ready: boolean;
  readyTimer?: ReturnType<typeof globalThis.setTimeout>;
  shutdownTimer?: ReturnType<typeof globalThis.setTimeout>;
  handlers: {
    spawn: (...args: any[]) => void;
    message: (...args: any[]) => void;
    error: (...args: any[]) => void;
    exit: (...args: any[]) => void;
  };
};

type ActiveRun = {
  runId: string;
  sequence: number;
};

type PendingProjectOperation = {
  operationId: string;
  operation: AgentProjectOperationType;
  generation: number;
  timer: ReturnType<typeof globalThis.setTimeout>;
  resolve: (payload: Readonly<Record<string, unknown>>) => void;
  reject: (error: Error) => void;
};
type PendingJobOperation = {
  operationId: string;
  operation: AgentJobOperationType;
  generation: number;
  timer: ReturnType<typeof globalThis.setTimeout>;
  resolve: (payload: Readonly<Record<string, unknown>>) => void;
  reject: (error: Error) => void;
};

const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_RESTARTS = 3;
const DEFAULT_RESTART_WINDOW_MS = 30_000;
const DEFAULT_RESTART_BACKOFF_MS = [100, 250, 750] as const;
const DEFAULT_PROJECT_OPERATION_TIMEOUT_MS = 30_000;

export class AgentWorkerController {
  private readonly now: () => number;
  private readonly workerPath: string;
  private readonly optionsCreateProcess: AgentWorkerControllerOptions["createProcess"];
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof globalThis.setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof globalThis.setTimeout>) => void;
  private readonly startupTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly maxRestarts: number;
  private readonly restartWindowMs: number;
  private readonly restartBackoffMs: readonly number[];
  private readonly log: AgentWorkerLog;
  private readonly onMessage?: (message: AgentWorkerMessage) => void;
  private readonly onStatusChange?: (status: AgentWorkerStatusSnapshot) => void;
  private activeProcess?: ActiveProcess;
  private activeRun?: ActiveRun;
  private readonly pendingProjectOperations = new Map<string, PendingProjectOperation>();
  private readonly pendingJobOperations = new Map<string, PendingJobOperation>();
  private readonly jobEventSequences = new Map<string, number>();
  private startupWaiter?: { resolve: () => void; reject: (error: AgentWorkerControllerError) => void };
  private restartTimer?: ReturnType<typeof globalThis.setTimeout>;
  private shutdownPromise?: Promise<void>;
  private shutdownResolve?: () => void;
  private shutdownRequested = false;
  private generation = 0;
  private runCounter = 0;
  private runStatus: AgentRunStatus = "idle";
  private status: AgentWorkerStatusSnapshot["status"] = "stopped";
  private restartTimestamps: number[] = [];
  private lastErrorCode: AgentPublicErrorCode | null = null;
  private workerVersion: string | null = null;
  private capabilities: readonly string[] = [];

  constructor(options: AgentWorkerControllerOptions) {
    this.workerPath = options.workerPath;
    this.optionsCreateProcess = options.createProcess;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimeout ?? globalThis.setTimeout;
    this.clearTimer = options.clearTimeout ?? globalThis.clearTimeout;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    this.restartWindowMs = options.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS;
    this.restartBackoffMs = options.restartBackoffMs ?? DEFAULT_RESTART_BACKOFF_MS;
    this.log = options.log ?? (() => {});
    this.onMessage = options.onMessage;
    this.onStatusChange = options.onStatusChange;
  }

  start(): Promise<void> {
    if (this.shutdownRequested) {
      return Promise.reject(new AgentWorkerControllerError("worker-unavailable"));
    }
    if (this.activeProcess?.ready) {
      return Promise.resolve();
    }
    if (this.startupWaiter) {
      return new Promise<void>((resolve, reject) => {
        const current = this.startupWaiter;
        if (!current) {
          reject(new AgentWorkerControllerError("worker-not-ready"));
          return;
        }
        const originalResolve = current.resolve;
        const originalReject = current.reject;
        current.resolve = () => {
          originalResolve();
          resolve();
        };
        current.reject = (error) => {
          originalReject(error);
          reject(error);
        };
      });
    }
    if (this.status === "unavailable") {
      return Promise.reject(new AgentWorkerControllerError("worker-unavailable"));
    }

    this.setStatus(this.restartTimestamps.length > 0 ? "restarting" : "starting");
    const promise = new Promise<void>((resolve, reject) => {
      this.startupWaiter = { resolve, reject };
    });
    this.spawnProcess();
    return promise;
  }

  getStatus(): AgentWorkerStatusSnapshot {
    return Object.freeze({
      status: this.status,
      generation: this.generation,
      activeRunId: this.activeRun?.runId ?? null,
      runStatus: this.runStatus,
      restartCount: this.restartTimestamps.length,
      lastErrorCode: this.lastErrorCode,
      workerVersion: this.workerVersion,
      capabilities: Object.freeze([...this.capabilities]),
    });
  }

  runSmokeTask(runId = this.createRunId()): AgentRunHandle {
    if (!isValidAgentRunId(runId)) {
      throw new AgentWorkerControllerError("invalid-run-id");
    }
    if (this.activeRun || this.pendingProjectOperations.size > 0 || this.pendingJobOperations.size > 0) {
      throw new AgentWorkerControllerError("busy");
    }
    const process = this.activeProcess;
    if (!process?.ready || this.status === "unavailable" || this.shutdownRequested) {
      throw new AgentWorkerControllerError(this.status === "unavailable" ? "worker-unavailable" : "worker-not-ready");
    }

    this.activeRun = { runId, sequence: 0 };
    this.runStatus = "running";
    this.setStatus("running");
    try {
      process.child.postMessage({
        protocolVersion: AGENT_WORKER_PROTOCOL_VERSION,
        type: "run-smoke-task",
        runId,
        steps: 6,
      });
      return Object.freeze({ runId });
    } catch {
      this.activeRun = undefined;
      this.runStatus = "error";
      this.setStatus("ready");
      throw new AgentWorkerControllerError("internal-error");
    }
  }

  runJobOperation(
    operation: AgentJobOperationType,
    projectId: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (this.activeRun || this.pendingProjectOperations.size > 0 || this.pendingJobOperations.size > 0) {
      return Promise.reject(new AgentWorkerControllerError("busy"));
    }
    const process = this.activeProcess;
    if (!process?.ready || this.status === "unavailable" || this.shutdownRequested) {
      return Promise.reject(new AgentWorkerControllerError(this.status === "unavailable" ? "worker-unavailable" : "worker-not-ready"));
    }
    const operationId = `op-${this.now()}-${++this.runCounter}`;
    this.setStatus("running");
    return new Promise<Readonly<Record<string, unknown>>>((resolve, reject) => {
      const timer = this.setTimer(() => {
        const pending = this.pendingJobOperations.get(operationId);
        if (!pending) return;
        this.pendingJobOperations.delete(operationId);
        reject(new JobOperationControllerError({ code: "JOB_STATE_CONFLICT", message: "The job state changed concurrently." }));
        this.setStatus(this.shutdownRequested ? "stopped" : "ready");
      }, DEFAULT_PROJECT_OPERATION_TIMEOUT_MS);
      this.pendingJobOperations.set(operationId, { operationId, operation, generation: process.generation, timer, resolve, reject });
      try {
        process.child.postMessage({
          protocolVersion: AGENT_WORKER_PROTOCOL_VERSION, type: operation, operationId,
          timestamp: this.now(), projectId, payload,
        });
      } catch {
        this.pendingJobOperations.delete(operationId);
        this.clearTimer(timer);
        this.setStatus("ready");
        reject(new AgentWorkerControllerError("internal-error"));
      }
    });
  }

  runProjectOperation(
    operation: AgentProjectOperationType,
    payload: AgentProjectOperationPayload,
    projectId?: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (this.activeRun || this.pendingProjectOperations.size > 0 || this.pendingJobOperations.size > 0) {
      return Promise.reject(new AgentWorkerControllerError("busy"));
    }
    const process = this.activeProcess;
    if (!process?.ready || this.status === "unavailable" || this.shutdownRequested) {
      return Promise.reject(new AgentWorkerControllerError(this.status === "unavailable" ? "worker-unavailable" : "worker-not-ready"));
    }
    const operationId = `op-${this.now()}-${++this.runCounter}`;
    this.setStatus("running");
    return new Promise<Readonly<Record<string, unknown>>>((resolve, reject) => {
      const timer = this.setTimer(() => {
        const pending = this.pendingProjectOperations.get(operationId);
        if (!pending) return;
        this.pendingProjectOperations.delete(operationId);
        reject(new ProjectOperationControllerError({ code: "OPERATION_TIMEOUT", message: "The project operation timed out." }));
        this.setStatus(this.shutdownRequested ? "stopped" : "ready");
      }, DEFAULT_PROJECT_OPERATION_TIMEOUT_MS);
      this.pendingProjectOperations.set(operationId, {
        operationId,
        operation,
        generation: process.generation,
        timer,
        resolve,
        reject,
      });
      try {
        process.child.postMessage({
          protocolVersion: AGENT_WORKER_PROTOCOL_VERSION,
          type: operation,
          operationId,
          timestamp: this.now(),
          ...(projectId ? { projectId } : {}),
          payload,
        });
      } catch {
        this.pendingProjectOperations.delete(operationId);
        this.clearTimer(timer);
        this.setStatus("ready");
        reject(new AgentWorkerControllerError("internal-error"));
      }
    });
  }

  cancelRun(runId: string): void {
    if (!isValidAgentRunId(runId)) {
      throw new AgentWorkerControllerError("invalid-run-id");
    }
    if (!this.activeRun || this.activeRun.runId !== runId) {
      throw new AgentWorkerControllerError("run-not-found");
    }
    const process = this.activeProcess;
    if (!process?.ready || this.shutdownRequested) {
      throw new AgentWorkerControllerError("worker-not-ready");
    }
    try {
      process.child.postMessage({ protocolVersion: AGENT_WORKER_PROTOCOL_VERSION, type: "cancel-run", runId });
    } catch {
      throw new AgentWorkerControllerError("internal-error");
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    this.shutdownRequested = true;
    if (this.restartTimer) {
      this.clearTimer(this.restartTimer);
      this.restartTimer = undefined;
    }
    const process = this.activeProcess;
    if (!process) {
      this.rejectProjectOperations(new AgentWorkerControllerError("worker-unavailable"));
      this.rejectJobOperations(new AgentWorkerControllerError("worker-unavailable"));
      this.rejectStartup("worker-unavailable");
      this.setStatus("stopped");
      return;
    }

    this.shutdownPromise = new Promise<void>((resolve) => {
      this.shutdownResolve = resolve;
    });
    this.setStatus("stopped");
    this.rejectProjectOperations(new AgentWorkerControllerError("worker-unavailable"));
    try {
      process.child.postMessage({ protocolVersion: AGENT_WORKER_PROTOCOL_VERSION, type: "shutdown" });
    } catch {
      this.finishShutdown(process);
      return this.shutdownPromise;
    }
    process.shutdownTimer = this.setTimer(() => {
      this.log("agent-worker-shutdown-timeout", { generation: process.generation });
      process.child.kill();
      if (this.activeProcess === process) {
        this.finishShutdown(process);
      }
    }, this.shutdownTimeoutMs);
    return this.shutdownPromise;
  }

  private createRunId(): string {
    this.runCounter += 1;
    return `run-${this.now()}-${this.runCounter}`;
  }

  private spawnProcess(): void {
    if (this.shutdownRequested || this.status === "unavailable") {
      return;
    }
    const generation = ++this.generation;
    let child: UtilityProcessLike;
    try {
      child = this.createProcess(generation);
    } catch {
      this.handleSpawnFailure(generation);
      return;
    }

    const active: ActiveProcess = {
      child,
      generation,
      spawnedAt: this.now(),
      ready: false,
      handlers: {
        spawn: () => this.handleSpawn(active),
        message: (message: unknown) => this.handleRawMessage(active, message),
        error: () => this.handleProcessError(active),
        exit: (code: number | null) => this.handleExit(active, code),
      },
    };
    this.activeProcess = active;
    child.on("spawn", active.handlers.spawn);
    child.on("message", active.handlers.message);
    child.on("error", active.handlers.error);
    child.on("exit", active.handlers.exit);
    active.readyTimer = this.setTimer(() => this.handleReadyTimeout(active), this.startupTimeoutMs);
    this.log("agent-worker-spawn", { generation, pid: child.pid ?? 0 });
  }

  private createProcess(generation: number): UtilityProcessLike {
    return this.optionsCreateProcess(this.workerPath, generation);
  }

  private handleSpawn(process: ActiveProcess): void {
    if (!this.isCurrent(process)) {
      return;
    }
    this.log("agent-worker-process-spawned", { generation: process.generation, pid: process.child.pid ?? 0 });
  }

  private handleRawMessage(process: ActiveProcess, rawMessage: unknown): void {
    if (!this.isCurrent(process) || !isValidAgentWorkerMessage(rawMessage) || !isAgentWorkerMessageWithinLimit(rawMessage)) {
      this.log("agent-worker-message-rejected", { generation: process.generation, reason: "invalid-message" });
      return;
    }
    const message = rawMessage;
    if (message.type === "ready") {
      this.handleReady(process, message);
      return;
    }
    if (message.type === "run-event") {
      if (!this.activeRun || this.activeRun.runId !== message.runId || message.sequence <= this.activeRun.sequence) {
        this.log("agent-worker-message-rejected", { generation: process.generation, reason: "stale-run-event" });
        return;
      }
      this.activeRun.sequence = message.sequence;
      this.onMessage?.(message);
      return;
    }
    if (message.type === "run-finished") {
      if (!this.activeRun || this.activeRun.runId !== message.runId || message.sequence <= this.activeRun.sequence) {
        this.log("agent-worker-message-rejected", { generation: process.generation, reason: "stale-run-finished" });
        return;
      }
      this.activeRun.sequence = message.sequence;
      this.runStatus = message.status;
      this.activeRun = undefined;
      this.setStatus(this.shutdownRequested ? "stopped" : "ready");
      this.onMessage?.(message);
      return;
    }
    if (message.type === "worker-error") {
      this.lastErrorCode = message.error.code;
      this.onMessage?.(message);
      this.notifyStatus();
      return;
    }
    if (message.type === "project-operation-result" || message.type === "project-operation-error") {
      const pending = this.pendingProjectOperations.get(message.operationId);
      if (!pending || pending.generation !== process.generation || pending.operation !== message.operation) {
        this.log("agent-worker-message-rejected", { generation: process.generation, reason: "stale-project-operation" });
        return;
      }
      this.pendingProjectOperations.delete(message.operationId);
      this.clearTimer(pending.timer);
      this.setStatus(this.shutdownRequested ? "stopped" : "ready");
      if (message.type === "project-operation-error") {
        pending.reject(new ProjectOperationControllerError(message.error));
      } else {
        pending.resolve(message.payload);
      }
      return;
    }
    if (message.type === "job-event") {
      if (!isJobEvent(message.event) || message.event.projectId !== message.projectId || message.event.jobId !== message.jobId) return;
      const key = `${message.projectId}:${message.jobId}`;
      const previous = this.jobEventSequences.get(key) ?? 0;
      if (message.event.sequence <= previous) return;
      this.jobEventSequences.set(key, message.event.sequence);
      this.onMessage?.(message);
      return;
    }
    if (message.type === "job-operation-result" || message.type === "job-operation-error") {
      const pending = this.pendingJobOperations.get(message.operationId);
      if (!pending || pending.generation !== process.generation || pending.operation !== message.operation) {
        this.log("agent-worker-message-rejected", { generation: process.generation, reason: "stale-job-operation" });
        return;
      }
      this.pendingJobOperations.delete(message.operationId);
      this.clearTimer(pending.timer);
      this.setStatus(this.shutdownRequested ? "stopped" : "ready");
      if (message.type === "job-operation-error") pending.reject(new JobOperationControllerError(message.error));
      else pending.resolve(message.payload);
      return;
    }
  }

  private handleReady(process: ActiveProcess, message: Extract<AgentWorkerMessage, { type: "ready" }>): void {
    if (!this.isCurrent(process)) {
      return;
    }
    process.ready = true;
    if (process.readyTimer) {
      this.clearTimer(process.readyTimer);
      process.readyTimer = undefined;
    }
    this.workerVersion = message.workerVersion;
    this.capabilities = [...message.capabilities];
    this.lastErrorCode = null;
    this.log("agent-worker-ready", {
      generation: process.generation,
      pid: process.child.pid ?? 0,
      startupMs: Math.max(0, this.now() - process.spawnedAt),
    });
    if (this.shutdownRequested) {
      try {
        process.child.postMessage({ protocolVersion: AGENT_WORKER_PROTOCOL_VERSION, type: "shutdown" });
      } catch {
        this.finishShutdown(process);
      }
      return;
    }
    this.setStatus(this.activeRun ? "running" : "ready");
    const waiter = this.startupWaiter;
    this.startupWaiter = undefined;
    waiter?.resolve();
  }

  private handleReadyTimeout(process: ActiveProcess): void {
    if (!this.isCurrent(process) || process.ready) {
      return;
    }
    this.log("agent-worker-ready-timeout", { generation: process.generation });
    this.lastErrorCode = "worker-ready-timeout";
    this.rejectStartup("worker-ready-timeout");
    process.child.kill();
  }

  private handleProcessError(process: ActiveProcess): void {
    if (!this.isCurrent(process)) {
      return;
    }
    this.log("agent-worker-error", { generation: process.generation, reason: "process-error" });
  }

  private handleExit(process: ActiveProcess, code: number | null): void {
    if (!this.isCurrent(process)) {
      return;
    }
    this.log("agent-worker-exit", { generation: process.generation, pid: process.child.pid ?? 0, code: code ?? -1 });
    if (this.shutdownRequested) {
      this.finishShutdown(process);
      return;
    }
    this.clearProcessTimers(process);
    this.detachProcess(process);
    this.activeProcess = undefined;
    if (this.activeRun) {
      this.emitInterruptedRun(process);
    }
    this.rejectProjectOperations(new AgentWorkerControllerError("worker-exited"));
    this.rejectJobOperations(new AgentWorkerControllerError("worker-exited"));
    if (this.startupWaiter && !process.ready) {
      this.rejectStartup(process.ready ? "worker-exited" : this.lastErrorCode === "worker-ready-timeout" ? "worker-ready-timeout" : "worker-exited");
    }
    this.lastErrorCode = this.lastErrorCode === "worker-ready-timeout" ? this.lastErrorCode : "worker-exited";
    this.scheduleRestart(this.lastErrorCode);
  }

  private handleSpawnFailure(generation: number): void {
    this.lastErrorCode = "worker-exited";
    this.log("agent-worker-spawn-failed", { generation, reason: "spawn-failed" });
    this.rejectStartup("worker-exited");
    this.scheduleRestart("worker-exited");
  }

  private scheduleRestart(errorCode: AgentPublicErrorCode): void {
    if (this.shutdownRequested) {
      return;
    }
    const now = this.now();
    this.restartTimestamps = this.restartTimestamps.filter((startedAt) => now - startedAt <= this.restartWindowMs);
    if (this.restartTimestamps.length >= this.maxRestarts) {
      this.status = "unavailable";
      this.lastErrorCode = "worker-unavailable";
      this.log("agent-worker-unavailable", { restartCount: this.restartTimestamps.length, reason: errorCode });
      this.notifyStatus();
      return;
    }
    this.restartTimestamps.push(now);
    const restartNumber = this.restartTimestamps.length;
    const delayMs = this.restartBackoffMs[Math.min(restartNumber - 1, this.restartBackoffMs.length - 1)] ?? 0;
    this.status = "restarting";
    this.lastErrorCode = errorCode;
    this.log("agent-worker-restart-scheduled", { restartCount: restartNumber, delayMs, reason: errorCode });
    this.notifyStatus();
    this.restartTimer = this.setTimer(() => {
      this.restartTimer = undefined;
      if (this.shutdownRequested || this.status === "unavailable") {
        return;
      }
      this.spawnProcess();
    }, delayMs);
  }

  private emitInterruptedRun(process: ActiveProcess): void {
    const run = this.activeRun;
    if (!run) {
      return;
    }
    run.sequence += 1;
    const message: AgentWorkerMessage = {
      protocolVersion: AGENT_WORKER_PROTOCOL_VERSION,
      type: "run-finished",
      runId: run.runId,
      sequence: run.sequence,
      timestamp: this.now(),
      status: "interrupted",
      error: createAgentPublicError("worker-exited"),
    };
    this.activeRun = undefined;
    this.runStatus = "interrupted";
    this.onMessage?.(message);
    this.log("agent-worker-run-interrupted", { generation: process.generation, reason: "worker-exited" });
    this.notifyStatus();
  }

  private finishShutdown(process: ActiveProcess): void {
    if (this.activeProcess !== process) {
      return;
    }
    this.clearProcessTimers(process);
    this.detachProcess(process);
    this.activeProcess = undefined;
    this.rejectProjectOperations(new AgentWorkerControllerError("worker-exited"));
    this.rejectJobOperations(new AgentWorkerControllerError("worker-exited"));
    this.status = "stopped";
    this.notifyStatus();
    const resolve = this.shutdownResolve;
    this.shutdownResolve = undefined;
    resolve?.();
  }

  private rejectStartup(code: AgentPublicErrorCode): void {
    const waiter = this.startupWaiter;
    this.startupWaiter = undefined;
    waiter?.reject(new AgentWorkerControllerError(code));
  }

  private clearProcessTimers(process: ActiveProcess): void {
    if (process.readyTimer) {
      this.clearTimer(process.readyTimer);
      process.readyTimer = undefined;
    }
    if (process.shutdownTimer) {
      this.clearTimer(process.shutdownTimer);
      process.shutdownTimer = undefined;
    }
  }

  private detachProcess(process: ActiveProcess): void {
    process.child.removeListener("spawn", process.handlers.spawn);
    process.child.removeListener("message", process.handlers.message);
    process.child.removeListener("error", process.handlers.error);
    process.child.removeListener("exit", process.handlers.exit);
  }

  private isCurrent(process: ActiveProcess): boolean {
    return this.activeProcess === process && process.generation === this.generation;
  }

  private setStatus(status: AgentWorkerStatusSnapshot["status"]): void {
    this.status = status;
    this.notifyStatus();
  }

  private notifyStatus(): void {
    this.onStatusChange?.(this.getStatus());
  }

  private rejectProjectOperations(error: Error): void {
    for (const pending of this.pendingProjectOperations.values()) {
      this.clearTimer(pending.timer);
      pending.reject(error);
    }
    this.pendingProjectOperations.clear();
  }

  private rejectJobOperations(error: Error): void {
    for (const pending of this.pendingJobOperations.values()) {
      this.clearTimer(pending.timer);
      pending.reject(error);
    }
    this.pendingJobOperations.clear();
  }
}

export function createAgentWorkerController(options: AgentWorkerControllerOptions): AgentWorkerController {
  return new AgentWorkerController(options);
}
