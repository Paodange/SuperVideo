import process from "node:process";
import {
  AGENT_WORKER_CAPABILITIES,
  AGENT_WORKER_MAX_MESSAGE_BYTES,
  AGENT_WORKER_PROTOCOL_VERSION,
  AGENT_WORKER_VERSION,
  createAgentPublicError,
  isValidAgentWorkerCommand,
  isValidAgentWorkerMessage,
  isAgentWorkerMessageWithinLimit,
  type AgentWorkerCommand,
  type AgentWorkerMessage,
} from "@supervideo/shared";
import { createSmokeAgentRunner } from "./smoke-agent.js";

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

const runner = createSmokeAgentRunner(send);

async function handleCommand(command: AgentWorkerCommand): Promise<void> {
  switch (command.type) {
    case "run-smoke-task":
      if (runner.isBusy()) {
        sendError("busy");
        return;
      }
      await runner.run(command.runId, command.steps);
      return;
    case "cancel-run":
      if (!runner.cancel(command.runId)) {
        sendError("run-not-found");
      }
      return;
    case "ping":
      send({ protocolVersion: AGENT_WORKER_PROTOCOL_VERSION, type: "pong", timestamp: Date.now() });
      return;
    case "shutdown":
      await shutdown();
      return;
    default:
      return;
  }
}

async function shutdown(): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }
  shuttingDown = true;
  shutdownPromise = runner.waitForIdle().then(() => {
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
