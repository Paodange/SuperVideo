import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { app, utilityProcess } from "electron";

const spikeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.join(spikeRoot, "src", "agent-worker-bootstrap.cjs");
const statePath = path.join(spikeRoot, "validation-session.json");
const reportPath = path.join(spikeRoot, "validation-report.json");

function waitForMessage(child, predicate, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs} ms waiting for utility-process message.`));
    }, timeoutMs);

    const onMessage = (message) => {
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`Utility process exited unexpectedly with code ${code}.`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };

    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

function startWorker(label, eventLog) {
  const child = utilityProcess.fork(workerPath, [], {
    cwd: spikeRoot,
    env: {
      ...process.env,
      SUPERVIDEO_SPIKE_ROOT: spikeRoot,
      SUPERVIDEO_SPIKE_STATE: statePath,
    },
    serviceName: `SuperVideo Spike ${label}`,
    stdio: "pipe",
  });
  child.on("spawn", () => {
    eventLog.push({ worker: label, at: new Date().toISOString(), type: "worker_spawn", pid: child.pid });
    console.log(`[${label}] worker_spawn pid=${child.pid}`);
  });
  child.on("exit", (code) => {
    eventLog.push({ worker: label, at: new Date().toISOString(), type: "worker_exit", code });
    console.log(`[${label}] worker_exit code=${code}`);
  });
  child.on("error", (type, location, report) => {
    eventLog.push({ worker: label, at: new Date().toISOString(), type: "worker_error", errorType: type, location, report });
    console.error(`[${label}] worker_error ${type} ${location}`);
  });
  child.stdout?.on("data", (chunk) => console.log(`[${label}:stdout] ${chunk.toString("utf8").trimEnd()}`));
  child.stderr?.on("data", (chunk) => console.error(`[${label}:stderr] ${chunk.toString("utf8").trimEnd()}`));
  child.on("message", (message) => {
    eventLog.push({ worker: label, at: new Date().toISOString(), ...message });
    if (message.type === "agent_event" || message.type === "python_cancelled") {
      console.log(`[${label}]`, message.type, message.eventType ?? message.toolCallId ?? "");
    }
  });
  return child;
}

async function stopWorker(child) {
  if (!child) return;
  child.postMessage({ type: "shutdown" });
  try {
    await waitForMessage(child, () => false, 250);
  } catch {
    child.kill();
  }
}

async function validate() {
  const startedAt = new Date().toISOString();
  const eventLog = [];
  let firstWorker;
  let secondWorker;

  try {
    firstWorker = startWorker("initial", eventLog);
    const initialReady = await waitForMessage(firstWorker, (m) => m.type === "ready");
    firstWorker.postMessage({ type: "run", scenario: "success" });
    const successFinished = await waitForMessage(
      firstWorker,
      (m) => m.type === "scenario_finished" && m.scenario === "success",
    );
    const successSaved = [...eventLog]
      .reverse()
      .find((m) => m.worker === "initial" && m.type === "state_saved" && m.scenario === "success");
    const savedCount = successSaved?.messageCount ?? successFinished.messageCount;
    await stopWorker(firstWorker);
    firstWorker = null;

    secondWorker = startWorker("restarted", eventLog);
    const restartedReady = await waitForMessage(secondWorker, (m) => m.type === "ready");
    secondWorker.postMessage({ type: "run", scenario: "cancel" });
    await waitForMessage(
      secondWorker,
      (m) =>
        m.type === "agent_event" &&
        m.scenario === "cancel" &&
        m.eventType === "tool_execution_update",
    );
    secondWorker.postMessage({ type: "abort" });
    const pythonCancelled = await waitForMessage(
      secondWorker,
      (m) => m.type === "python_cancelled" && m.toolCallId === "cancel-call",
    );
    const cancelFinished = await waitForMessage(
      secondWorker,
      (m) => m.type === "scenario_finished" && m.scenario === "cancel",
    );

    const successEvents = eventLog.filter(
      (m) => m.worker === "initial" && m.type === "agent_event" && m.scenario === "success",
    );
    const progressEvents = successEvents.filter((m) => m.eventType === "tool_execution_update");
    const checks = {
      electronUtilityProcess: Boolean(initialReady),
      piAgentLifecycle:
        successEvents.some((m) => m.eventType === "agent_start") &&
        successEvents.some((m) => m.eventType === "tool_execution_start") &&
        successEvents.some((m) => m.eventType === "tool_execution_end") &&
        successEvents.some((m) => m.eventType === "agent_end"),
      pythonJsonlProgress:
        progressEvents.length === 4 &&
        progressEvents.every((m) => m.partialResult?.details?.source === "python-jsonl"),
      openAICompatibleRegistration:
        initialReady.customProvider?.registered === true &&
        initialReady.customProvider?.api === "openai-completions",
      sessionPersistence:
        savedCount > 0 && restartedReady.restoredMessageCount === savedCount,
      cancellationPropagation:
        Boolean(pythonCancelled) && ["aborted", "error"].includes(cancelFinished.status),
    };
    const passed = Object.values(checks).every(Boolean);
    const report = {
      spike: "Pi Agent + Electron utilityProcess + Python JSONL bridge",
      startedAt,
      finishedAt: new Date().toISOString(),
      passed,
      checks,
      evidence: {
        versions: {
          electron: process.versions.electron,
          node: process.versions.node,
          chrome: process.versions.chrome,
        },
        initialRestoredMessageCount: initialReady.restoredMessageCount,
        savedMessageCount: savedCount,
        restartedMessageCount: restartedReady.restoredMessageCount,
        successProgressUpdates: progressEvents.length,
        cancelStatus: cancelFinished.status,
        customProvider: initialReady.customProvider,
      },
      limitations: [
        "LLM responses are deterministic faux responses, so no API key or network call is required.",
        "The OpenAI-compatible provider check validates registration/configuration only, not a real endpoint handshake.",
        "The Python task is a controlled stand-in for transcription, rendering, and Jianying automation.",
      ],
      events: eventLog,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ passed, checks, reportPath }, null, 2));
    process.exitCode = passed ? 0 : 1;
  } finally {
    await stopWorker(firstWorker);
    await stopWorker(secondWorker);
  }
}

app.whenReady().then(async () => {
  try {
    await validate();
  } catch (error) {
    const report = {
      spike: "Pi Agent + Electron utilityProcess + Python JSONL bridge",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      passed: false,
      fatalError: String(error?.stack ?? error),
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.exit(process.exitCode ?? 0);
  }
});
