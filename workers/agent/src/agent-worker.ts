import process from "node:process";
import {
  AGENT_WORKER_CAPABILITIES,
  AGENT_WORKER_MAX_MESSAGE_BYTES,
  AGENT_WORKER_PROTOCOL_VERSION,
  AGENT_WORKER_VERSION,
  createAgentPublicError,
  CORE_RPC_ERROR_MESSAGES,
  CORE_RPC_METHODS,
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
  isSentenceIndexResult,
  isRetrievalResult,
  isRerankResult,
  isAgentDiagnosticEvent,
  isJobEvent,
  isProjectSummary,
  isValidAgentWorkerCommand,
  isValidAgentWorkerMessage,
  isAgentWorkerMessageWithinLimit,
  type AgentWorkerCommand,
  type AgentProjectOperationType,
  type AgentJobOperationType,
  type JobEvent,
  type JobOperationErrorCode,
  type ProjectOperationErrorCode,
  type AgentWorkerMessage,
  type AgentDiagnosticEvent,
} from "@supervideo/shared";
import type { PythonCoreClient } from "./python-core-client.js";
import type { SmokeAgentRunner } from "./smoke-agent.js";

type ParentPortLike = {
  postMessage: (message: AgentWorkerMessage) => void;
  on: (event: "message", listener: (event: { data: unknown }) => void) => void;
};

const parentPort = (process as typeof process & { parentPort?: ParentPortLike }).parentPort;

if (!parentPort) {
  throw new Error("This module must run inside an Electron utility process.");
}

const parent: ParentPortLike = parentPort;

let shuttingDown = false;
let shutdownPromise: Promise<void> | undefined;
let projectOperationBusy = false;
let coreClient: PythonCoreClient | undefined;
let runner: SmokeAgentRunner | undefined;
let runtimePromise: Promise<{ coreClient: PythonCoreClient; runner: SmokeAgentRunner }> | undefined;

async function ensureRuntime(): Promise<{ coreClient: PythonCoreClient; runner: SmokeAgentRunner }> {
  if (coreClient && runner) {
    return { coreClient, runner };
  }
  // Keep the utility-process ready path small. Project/RPC and Pi modules are
  // loaded only when a command needs them, so cold-start readiness does not
  // depend on unrelated heavy module initialization.
  if (runtimePromise) return runtimePromise;
  runtimePromise = Promise.all([
    import("./python-core-client.js"),
    import("./smoke-agent.js"),
  ]).then(([{ PythonCoreClient }, { createSmokeAgentRunner }]) => {
    coreClient ??= new PythonCoreClient({ rootDir: process.cwd(), onJobEvent: forwardJobEvent, onDiagnostic: forwardCoreDiagnostic });
    runner ??= createSmokeAgentRunner(send);
    return { coreClient, runner };
  });
  return runtimePromise;
}

function send(message: AgentWorkerMessage): void {
  if (!isValidAgentWorkerMessage(message) || !isAgentWorkerMessageWithinLimit(message)) {
    throw new Error(`Refusing to send an invalid Agent Worker message (limit=${AGENT_WORKER_MAX_MESSAGE_BYTES}).`);
  }
  parent.postMessage(message);
}

function sendError(code: Parameters<typeof createAgentPublicError>[0]): void {
  send({
    protocolVersion: AGENT_WORKER_PROTOCOL_VERSION,
    type: "worker-error",
    timestamp: Date.now(),
    error: createAgentPublicError(code),
  });
}

function sendDiagnostic(event: AgentDiagnosticEvent): void {
  if (!isAgentDiagnosticEvent(event)) return;
  send({ protocolVersion: AGENT_WORKER_PROTOCOL_VERSION, type: "diagnostic-event", event });
}

function forwardCoreDiagnostic(line: string): void {
  try {
    const value = JSON.parse(line) as unknown;
    if (isAgentDiagnosticEvent(value) && value.component === "python-core") {
      sendDiagnostic(value);
      return;
    }
  } catch {
    // stderr is intentionally never forwarded verbatim.
  }
  sendDiagnostic({
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    level: "warn",
    component: "agent-worker",
    event: "core-stderr-rejected",
    details: { reason: "invalid-structured-stderr" },
  });
}

async function handleCommand(command: AgentWorkerCommand): Promise<void> {
  switch (command.type) {
    case "run-smoke-task":
      {
        const runtime = await ensureRuntime();
        if (runtime.runner.isBusy()) {
          sendError("busy");
          return;
        }
        await runtime.runner.run(command.runId, command.steps);
      }
      return;
    case "cancel-run":
      if (!runner || !runner.cancel(command.runId)) {
        sendError("run-not-found");
      }
      return;
    case "ping":
      send({ protocolVersion: AGENT_WORKER_PROTOCOL_VERSION, type: "pong", timestamp: Date.now() });
      return;
    case "shutdown":
      await shutdown();
      return;
    case "project-create":
    case "project-open":
    case "project-inspect":
    case "asset-reference":
    case "asset-scan":
    case "asset-list":
    case "media-probe":
    case "media-proxy":
    case "media-transcribe":
    case "media-vad":
    case "media-sentences":
    case "media-sentence-qa-context":
    case "media-sentence-qa-save":
    case "media-sentence-index":
    case "media-sentence-retrieve":
    case "media-sentence-rerank":
      await handleProjectOperation(command.type, command.operationId, command.payload);
      return;
    case "job-smoke-start":
    case "job-get":
    case "job-list":
    case "job-events-list":
    case "job-cancel":
    case "job-retry":
      await handleJobOperation(command.type, command.operationId, command.projectId, command.payload);
      return;
    default:
      return;
  }
}

async function handleProjectOperation(
  operation: AgentProjectOperationType,
  operationId: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (projectOperationBusy || runner?.isBusy()) {
    sendProjectError(operationId, operation, "CORE_UNAVAILABLE");
    return;
  }
  projectOperationBusy = true;
  try {
    const runtime = await ensureRuntime();
    await runtime.coreClient.start();
    const result = await runtime.coreClient.request<unknown>(coreMethod(operation), payload, { timeoutMs: 120_000 });
    const valid = operation === "project-create" || operation === "project-open" || operation === "project-inspect"
      ? isProjectSummary(result)
      : operation === "asset-reference"
        ? isAssetReferenceBatchResult(result)
      : operation === "asset-scan"
        ? isAssetScanResult(result)
        : operation === "asset-list"
          ? isAssetListResult(result)
          : operation === "media-probe"
            ? isMediaProbeResult(result)
            : operation === "media-proxy"
              ? isMediaProxyResult(result)
              : operation === "media-transcribe"
                ? isTranscriptionResult(result)
                : operation === "media-vad"
                  ? isVadResult(result)
              : operation === "media-sentences"
                ? isSentenceResult(result)
              : operation === "media-sentence-qa-context"
                ? isSentenceQaContextResult(result)
              : operation === "media-sentence-qa-save"
                ? isSentenceQaSaveResult(result)
                : operation === "media-sentence-index"
                  ? isSentenceIndexResult(result)
                  : operation === "media-sentence-rerank"
                    ? isRerankResult(result)
                    : isRetrievalResult(result);
    if (!valid) {
      sendProjectError(operationId, operation, "CORE_UNAVAILABLE");
      return;
    }
    const projectId = result && typeof result === "object" && "projectId" in result && typeof result.projectId === "string"
      ? result.projectId
      : undefined;
    send({
      protocolVersion: AGENT_WORKER_PROTOCOL_VERSION,
      type: "project-operation-result",
      operationId,
      operation,
      timestamp: Date.now(),
      ...(projectId ? { projectId } : {}),
      payload: result as Readonly<Record<string, unknown>>,
    });
  } catch (error) {
    const code = isCoreProjectError(error) ? error.code : "CORE_UNAVAILABLE";
    sendProjectError(operationId, operation, code);
  } finally {
    projectOperationBusy = false;
  }
}

function isCoreProjectError(error: unknown): error is { code: ProjectOperationErrorCode } {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return isProjectOperationErrorCode(String(error.code));
}

async function handleJobOperation(
  operation: AgentJobOperationType,
  operationId: string,
  projectId: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (projectOperationBusy || runner?.isBusy()) {
    sendJobError(operationId, operation, "JOB_STATE_CONFLICT");
    return;
  }
  projectOperationBusy = true;
  try {
    const runtime = await ensureRuntime();
    let result: unknown;
    if (operation === "job-smoke-start") result = await runtime.coreClient.startSmokeJob({ projectId, ...payload } as never);
    else if (operation === "job-get") result = await runtime.coreClient.getJob({ projectId, ...payload } as never);
    else if (operation === "job-list") result = await runtime.coreClient.listJobs({ projectId, ...payload } as never);
    else if (operation === "job-events-list") result = await runtime.coreClient.listJobEvents({ projectId, ...payload } as never);
    else if (operation === "job-cancel") result = await runtime.coreClient.cancelJob({ projectId, ...payload } as never);
    else result = await runtime.coreClient.retryJob({ projectId, ...payload } as never);
    send({
      protocolVersion: AGENT_WORKER_PROTOCOL_VERSION,
      type: "job-operation-result",
      operationId,
      operation,
      timestamp: Date.now(),
      projectId,
      payload: result as Readonly<Record<string, unknown>>,
    });
  } catch (error) {
    const code = isJobErrorCode(error) ? error.code : "JOB_STATE_CONFLICT";
    sendJobError(operationId, operation, code);
  } finally {
    projectOperationBusy = false;
  }
}

function forwardJobEvent(event: JobEvent): void {
  if (!isJobEvent(event)) return;
  send({ protocolVersion: AGENT_WORKER_PROTOCOL_VERSION, type: "job-event", projectId: event.projectId, jobId: event.jobId, event });
}

function isJobErrorCode(error: unknown): error is { code: JobOperationErrorCode } {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return JOB_ERROR_CODES.has(String(error.code));
}

function sendJobError(operationId: string, operation: AgentJobOperationType, code: JobErrorCode): void {
  send({
    protocolVersion: AGENT_WORKER_PROTOCOL_VERSION,
    type: "job-operation-error",
    operationId,
    operation,
    timestamp: Date.now(),
    error: { code, message: (CORE_RPC_ERROR_MESSAGES as Readonly<Record<string, string>>)[code] ?? "Job operation failed." },
  });
}

type JobErrorCode = JobOperationErrorCode;

const JOB_ERROR_CODES = new Set<string>([
  "JOB_NOT_FOUND", "JOB_STATE_CONFLICT", "JOB_NOT_CANCELLABLE", "JOB_NOT_RETRYABLE", "JOB_RETRY_LIMIT",
  "JOB_QUEUE_FULL", "JOB_EXECUTOR_UNAVAILABLE", "JOB_CHECKPOINT_INVALID", "JOB_EVENT_GAP",
  "IDEMPOTENCY_CONFLICT", "JOB_SHUTTING_DOWN", "JOB_EXECUTION_FAILED",
  "PROJECT_NOT_ACTIVE", "CORE_UNAVAILABLE", "DATABASE_BUSY", "DATABASE_CORRUPT",
]);

function coreMethod(operation: AgentProjectOperationType): string {
  if (operation === "project-create") return CORE_RPC_METHODS.projectCreate;
  if (operation === "project-open") return CORE_RPC_METHODS.projectOpen;
  if (operation === "project-inspect") return CORE_RPC_METHODS.projectInspect;
  if (operation === "asset-reference") return CORE_RPC_METHODS.assetReference;
  if (operation === "asset-scan") return CORE_RPC_METHODS.assetScan;
  if (operation === "asset-list") return CORE_RPC_METHODS.assetList;
  if (operation === "media-probe") return CORE_RPC_METHODS.mediaProbe;
  if (operation === "media-proxy") return CORE_RPC_METHODS.mediaProxy;
  if (operation === "media-transcribe") return CORE_RPC_METHODS.mediaTranscribe;
  if (operation === "media-vad") return CORE_RPC_METHODS.mediaVad;
  if (operation === "media-sentences") return CORE_RPC_METHODS.mediaSentences;
  if (operation === "media-sentence-qa-context") return CORE_RPC_METHODS.mediaSentenceQaContext;
  if (operation === "media-sentence-qa-save") return CORE_RPC_METHODS.mediaSentenceQaSave;
  if (operation === "media-sentence-retrieve") return CORE_RPC_METHODS.mediaSentenceRetrieve;
  if (operation === "media-sentence-rerank") return CORE_RPC_METHODS.mediaSentenceRerank;
  return CORE_RPC_METHODS.mediaSentenceIndex;
}

function sendProjectError(operationId: string, operation: AgentProjectOperationType, code: ProjectOperationErrorCode): void {
  send({
    protocolVersion: AGENT_WORKER_PROTOCOL_VERSION,
    type: "project-operation-error",
    operationId,
    operation,
    timestamp: Date.now(),
    error: { code, message: (CORE_RPC_ERROR_MESSAGES as Readonly<Record<string, string>>)[code] ?? "Project operation failed." },
  });
}

function isProjectOperationErrorCode(value: string): value is ProjectOperationErrorCode {
  return value in CORE_RPC_ERROR_MESSAGES && value.startsWith("PROJECT_")
    || value === "DIALOG_CANCELLED"
    || value === "INVALID_PROJECT_NAME"
    || value === "INVALID_PROJECT_ROOT"
    || value === "UNSUPPORTED_PROJECT_LOCATION"
    || value === "PROJECT_DIRECTORY_NOT_EMPTY"
    || value === "UNSUPPORTED_ASSET_TYPE"
    || value === "TOO_MANY_ASSETS"
    || value === "ASSET_CHANGED"
    || value === "ASSET_CHANGED_DURING_REFERENCE"
    || value === "FILE_ACCESS_DENIED"
    || value === "OPERATION_TIMEOUT"
    || value === "CORE_UNAVAILABLE"
    || value === "DATABASE_OPEN_FAILED"
    || value === "DATABASE_READ_ONLY"
    || value === "DATABASE_BUSY"
    || value === "DATABASE_CORRUPT"
    || value === "MIGRATION_FAILED"
    || value === "MIGRATION_CHECKSUM_MISMATCH"
    || value === "SCHEMA_TOO_NEW"
    || value === "CONSTRAINT_VIOLATION"
    || value === "RECORD_NOT_FOUND"
    || value === "INVALID_RECORD"
    || value === "MEDIA_TOOL_UNAVAILABLE"
    || value === "MEDIA_TOOL_TIMEOUT"
    || value === "MEDIA_PROBE_PARSE_ERROR"
    || value === "MEDIA_NOT_MEDIA"
    || value === "MEDIA_OUTPUT_INVALID"
    || value === "MEDIA_CANCELLED"
    || value === "TRANSCRIPTION_TOOL_UNAVAILABLE"
    || value === "TRANSCRIPTION_MODEL_UNAVAILABLE"
    || value === "TRANSCRIPTION_OUTPUT_INVALID"
    || value === "TRANSCRIPTION_TIMEOUT"
    || value === "TRANSCRIPTION_CANCELLED"
    || value === "VAD_TOOL_UNAVAILABLE"
    || value === "VAD_OUTPUT_INVALID"
    || value === "VAD_TIMEOUT"
    || value === "VAD_CANCELLED"
    || value === "SENTENCE_PREREQUISITE_UNAVAILABLE"
    || value === "SENTENCE_PREREQUISITE_INVALID"
    || value === "SENTENCE_OUTPUT_INVALID"
    || value === "SENTENCE_TIMEOUT"
    || value === "SENTENCE_CANCELLED"
    || value === "SENTENCE_QA_RESULT_NOT_FOUND"
    || value === "SENTENCE_QA_RESULT_INVALID"
    || value === "SENTENCE_QA_INDEX_INVALID"
    || value === "SENTENCE_QA_STORAGE_INVALID"
    || value === "SENTENCE_QA_OUTPUT_INVALID";
}

async function shutdown(): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }
  shuttingDown = true;
  shutdownPromise = Promise.allSettled([
    runner?.waitForIdle() ?? Promise.resolve(),
    coreClient?.shutdown() ?? Promise.resolve(),
  ]).then(() => {
    process.exit(0);
  });
  return shutdownPromise;
}

parent.on("message", (event) => {
  if (shuttingDown) {
    return;
  }
  if (!isValidAgentWorkerCommand(event.data)) {
    try {
      sendError("invalid-message");
    } catch {
      process.exit(1);
    }
    return;
  }
  void handleCommand(event.data).catch(() => {
    try {
      sendError("internal-error");
    } catch {
      process.exit(1);
    }
  });
});

process.on("uncaughtException", () => {
  if (!shuttingDown) {
    try {
      sendError("internal-error");
    } catch {
      // The utility process is already in a failed state; Main handles exit.
    }
  }
  process.exit(1);
});

send({
  protocolVersion: AGENT_WORKER_PROTOCOL_VERSION,
  type: "ready",
  timestamp: Date.now(),
  workerVersion: AGENT_WORKER_VERSION,
  capabilities: AGENT_WORKER_CAPABILITIES,
});
