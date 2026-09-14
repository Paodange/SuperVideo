import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Agent } from "@earendil-works/pi-agent-core";
import {
  Type,
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

const parent = process.parentPort;
if (!parent) {
  throw new Error("This module must run inside an Electron utility process.");
}

const spikeRoot = process.env.SUPERVIDEO_SPIKE_ROOT;
const statePath = process.env.SUPERVIDEO_SPIKE_STATE;
if (!spikeRoot || !statePath) {
  throw new Error("Missing spike root or state path.");
}

function send(message) {
  parent.postMessage(message);
}

function textResult(text, details) {
  return { content: [{ type: "text", text }], details };
}

async function loadMessages() {
  try {
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    return Array.isArray(saved.messages) ? saved.messages : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function saveMessages(messages) {
  await writeFile(
    statePath,
    `${JSON.stringify({ schemaVersion: 1, messages }, null, 2)}\n`,
    "utf8",
  );
}

function runPythonCountdown(toolCallId, seconds, signal, onUpdate) {
  return new Promise((resolve, reject) => {
    const script = path.join(spikeRoot, "python", "fake_tool_server.py");
    const child = spawn("python", [script], {
      cwd: spikeRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback(value);
    };

    const abort = () => {
      child.kill();
      send({ type: "python_cancelled", toolCallId });
      const error = new Error("Python tool execution was cancelled.");
      error.name = "AbortError";
      finish(reject, error);
    };

    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.type === "progress") {
          onUpdate?.(
            textResult(message.message, {
              progress: message.progress,
              source: "python-jsonl",
            }),
          );
        } else if (message.type === "result") {
          finish(
            resolve,
            textResult(JSON.stringify(message.result), {
              ...message.result,
              source: "python-jsonl",
            }),
          );
        } else if (message.type === "error") {
          finish(reject, new Error(message.error));
        }
      }
    });

    child.on("error", (error) => finish(reject, error));
    child.on("exit", (code) => {
      if (!settled) {
        finish(
          reject,
          new Error(`Python tool exited before a result (code=${code}): ${stderrBuffer}`),
        );
      }
    });

    child.stdin.end(
      `${JSON.stringify({
        id: toolCallId,
        method: "fake_countdown",
        params: { seconds },
      })}\n`,
    );
  });
}

const countdownTool = {
  name: "fake_countdown",
  label: "Python countdown",
  description: "Runs a controlled Python task and streams progress.",
  parameters: Type.Object({
    seconds: Type.Integer({ minimum: 1, maximum: 20 }),
  }),
  replay: "safe",
  execute: (toolCallId, params, signal, onUpdate) =>
    runPythonCountdown(toolCallId, params.seconds, signal, onUpdate),
};

function checkOpenAICompatibleRegistration() {
  const model = {
    id: "supervideo-local-test",
    name: "SuperVideo local OpenAI-compatible test",
    api: "openai-completions",
    provider: "supervideo-local",
    baseUrl: "http://127.0.0.1:65535/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
  };
  const provider = createProvider({
    id: "supervideo-local",
    name: "SuperVideo local",
    baseUrl: model.baseUrl,
    auth: {
      apiKey: {
        name: "Keyless local endpoint",
        resolve: async () => ({ auth: {} }),
      },
    },
    models: [model],
    api: openAICompletionsApi(),
  });
  const registry = createModels();
  registry.setProvider(provider);
  const resolved = registry.getModel(model.provider, model.id);
  return {
    registered: Boolean(resolved),
    provider: resolved?.provider,
    modelId: resolved?.id,
    api: resolved?.api,
    baseUrl: resolved?.baseUrl,
    scope: "registration-only; no real endpoint request in this spike",
  };
}

const faux = fauxProvider({ tokensPerSecond: 80 });
const models = createModels();
models.setProvider(faux.provider);
const restoredMessages = await loadMessages();
const agent = new Agent({
  initialState: {
    systemPrompt: "You are a deterministic architecture validation agent.",
    model: faux.getModel(),
    thinkingLevel: "off",
    tools: [countdownTool],
    messages: restoredMessages,
  },
  streamFn: (model, context, options) => models.streamSimple(model, context, options),
});

let currentScenario = null;

agent.subscribe(async (event) => {
  const summary = { type: "agent_event", scenario: currentScenario, eventType: event.type };
  if ("toolCallId" in event) summary.toolCallId = event.toolCallId;
  if ("toolName" in event) summary.toolName = event.toolName;
  if (event.type === "tool_execution_update") {
    summary.partialResult = event.partialResult;
  }
  if (event.type === "tool_execution_end") {
    summary.result = event.result;
    summary.isError = event.isError;
  }
  send(summary);

  if (event.type === "agent_end") {
    await saveMessages(agent.state.messages);
    send({
      type: "state_saved",
      scenario: currentScenario,
      messageCount: agent.state.messages.length,
    });
  }
});

async function runScenario(scenario) {
  currentScenario = scenario;
  if (scenario === "success") {
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("fake_countdown", { seconds: 4 }, { id: "success-call" }),
      ),
      fauxAssistantMessage(fauxText("任务完成：Python 工具返回了四步进度。")),
    ]);
  } else if (scenario === "cancel") {
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("fake_countdown", { seconds: 20 }, { id: "cancel-call" }),
      ),
    ]);
  } else {
    throw new Error(`Unknown scenario: ${scenario}`);
  }

  try {
    await agent.prompt(`Run the ${scenario} validation scenario.`);
    send({
      type: "scenario_finished",
      scenario,
      status: agent.state.errorMessage ? "error" : "completed",
      errorMessage: agent.state.errorMessage,
      messageCount: agent.state.messages.length,
    });
  } catch (error) {
    send({
      type: "scenario_finished",
      scenario,
      status: error?.name === "AbortError" ? "aborted" : "error",
      errorMessage: String(error?.message ?? error),
      messageCount: agent.state.messages.length,
    });
  }
}

parent.on("message", (event) => {
  const message = event.data;
  if (message?.type === "run") {
    void runScenario(message.scenario).catch((error) => {
      send({ type: "worker_error", error: String(error?.stack ?? error) });
    });
  } else if (message?.type === "abort") {
    agent.abort();
  } else if (message?.type === "shutdown") {
    process.exit(0);
  }
});

send({
  type: "ready",
  restoredMessageCount: restoredMessages.length,
  customProvider: checkOpenAICompatibleRegistration(),
});
