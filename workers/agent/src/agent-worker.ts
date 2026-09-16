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
  isProjectSummary,
  isValidAgentWorkerCommand,
  isValidAgentWorkerMessage,
  isAgentWorkerMessageWithinLimit,
  type AgentWorkerCommand,
  type AgentProjectOperationType,
  type ProjectOperationErrorCode,
  type AgentWorkerMessage,
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

async function ensureRuntime(): Promise<{ coreClient: PythonCoreClient; runner: SmokeAgentRunner }> {
  if (coreClient && runner) {
    return { coreClient, runner };
  }
  // Keep the utility-process ready path small. Project/RPC and Pi modules are
  // loaded only when a command needs them, so cold-start readiness does not
  // depend on unrelated heavy module initialization.
  const [{ PythonCoreClient }, { createSmokeAgentRunner }] = await Promise.all([
    import("./python-core-client.js"),
    import("./smoke-agent.js"),
  ]);
  coreClient ??= new PythonCoreClient({ rootDir: process.cwd() });
  runner ??= createSmokeAgentRunner(send);
  return { coreClient, runner };
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
    case "asset-list":
      await handleProjectOperation(command.type, command.operationId, command.payload);
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
        : isAssetListResult(result);
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

function coreMethod(operation: AgentProjectOperationType): string {
  if (operation === "project-create") return CORE_RPC_METHODS.projectCreate;
  if (operation === "project-open") return CORE_RPC_METHODS.projectOpen;
  if (operation === "project-inspect") return CORE_RPC_METHODS.projectInspect;
  if (operation === "asset-reference") return CORE_RPC_METHODS.assetReference;
  return CORE_RPC_METHODS.assetList;
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
    || value === "INVALID_RECORD";
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
