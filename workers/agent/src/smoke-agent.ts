import { Agent, type AgentEvent, type AgentTool, type AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  Type,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Model,
} from "@earendil-works/pi-ai";
import {
  AGENT_WORKER_PROTOCOL_VERSION,
  createAgentPublicError,
  isValidAgentRunId,
  type AgentRunEvent,
  type AgentWorkerMessage,
} from "@supervideo/shared";

const SMOKE_TOOL_NAME = "smoke_countdown";
const SMOKE_TOOL_LABEL = "In-memory smoke countdown";
const STEP_DELAY_MS = 120;

type SmokeToolDetails = Readonly<{ progress: number; message: string }>;
type SmokeAgentEmitter = (message: AgentWorkerMessage) => void;

export type SmokeAgentRunner = Readonly<{
  run: (runId: string, steps: number) => Promise<void>;
  cancel: (runId: string) => boolean;
  isBusy: () => boolean;
  waitForIdle: () => Promise<void>;
}>;

class SmokeAgentError extends Error {
  constructor(readonly code: "busy" | "invalid-run-id") {
    super(code);
    this.name = "SmokeAgentError";
  }
}

/**
 * A deliberately small Pi runtime. The only registered tool is an in-memory
 * countdown, so this module cannot read files, spawn processes, or call a
 * provider endpoint while exercising the real Agent event loop.
 */
export function createSmokeAgentRunner(emit: SmokeAgentEmitter): SmokeAgentRunner {
  const faux = fauxProvider({ tokensPerSecond: 0, tokenSize: { min: 1, max: 1 } });
  const models = createModels();
  models.setProvider(faux.provider);
  let active: ActiveRun | undefined;

  const runner: SmokeAgentRunner = {
    run: async (runId, steps) => {
      if (!isValidAgentRunId(runId)) {
        throw new SmokeAgentError("invalid-run-id");
      }
      if (active) {
        throw new SmokeAgentError("busy");
      }

      const run: ActiveRun = {
        runId,
        sequence: 0,
        cancelRequested: false,
        completion: Promise.resolve(),
      };
      active = run;
      run.completion = executeRun(run, steps, emit, faux, models).finally(() => {
        if (active === run) {
          active = undefined;
        }
      });
      await run.completion;
    },
    cancel: (runId) => {
      if (!active || active.runId !== runId) {
        return false;
      }
      active.cancelRequested = true;
      active.agent?.abort();
      return true;
    },
    isBusy: () => active !== undefined,
    waitForIdle: () => active?.completion ?? Promise.resolve(),
  };

  return Object.freeze(runner);
}

type ActiveRun = {
  runId: string;
  sequence: number;
  cancelRequested: boolean;
  agent?: Agent;
  completion: Promise<void>;
};

const smokeStepsSchema = Type.Object({
  steps: Type.Integer({ minimum: 3, maximum: 8 }),
});

const smokeTool: AgentTool<typeof smokeStepsSchema, SmokeToolDetails> = {
  name: SMOKE_TOOL_NAME,
  label: SMOKE_TOOL_LABEL,
  description: "Runs a deterministic in-memory countdown and reports progress.",
  parameters: smokeStepsSchema,
  replay: "safe",
  execute: async (_toolCallId, params, signal, onUpdate): Promise<AgentToolResult<SmokeToolDetails>> => {
    for (let step = 1; step <= params.steps; step += 1) {
      await waitForDelay(STEP_DELAY_MS, signal);
      const details: SmokeToolDetails = {
        progress: step / params.steps,
        message: `Smoke step ${step} of ${params.steps}`,
      };
      onUpdate?.({ content: [{ type: "text", text: details.message }], details });
    }
    return {
      content: [{ type: "text", text: "In-memory smoke countdown completed." }],
      details: { progress: 1, message: "In-memory smoke countdown completed." },
    };
  },
};

async function executeRun(
  run: ActiveRun,
  steps: number,
  emit: SmokeAgentEmitter,
  faux: ReturnType<typeof fauxProvider>,
  models: ReturnType<typeof createModels>,
): Promise<void> {
  const agent = new Agent({
    initialState: {
      systemPrompt: "You are a deterministic SuperVideo smoke agent.",
      model: faux.getModel(),
      thinkingLevel: "off",
      tools: [smokeTool],
    },
    streamFn: (model: Model<string>, context, options) => models.streamSimple(model, context, options),
  });
  run.agent = agent;

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    mapPiEvent(run, event, emit);
  });

  faux.setResponses([
    fauxAssistantMessage(fauxToolCall(SMOKE_TOOL_NAME, { steps }, { id: `tool-${run.runId}` })),
    fauxAssistantMessage(fauxText("Smoke task completed without network access.")),
  ]);

  let status: "completed" | "cancelled" | "error" = "completed";
  try {
    await agent.prompt("Run the deterministic smoke task.");
    if (run.cancelRequested) {
      status = "cancelled";
    } else if (agent.state.errorMessage) {
      status = "error";
    }
  } catch {
    status = run.cancelRequested ? "cancelled" : "error";
  } finally {
    unsubscribe();
    run.agent = undefined;
    sendFinished(run, status, emit);
  }
}

function mapPiEvent(run: ActiveRun, event: AgentEvent, emit: SmokeAgentEmitter): void {
  if (event.type === "agent_start") {
    sendEvent(run, { kind: "run-started" }, emit);
  } else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    sendEvent(run, { kind: "assistant-text-delta", delta: event.assistantMessageEvent.delta }, emit);
  } else if (event.type === "tool_execution_start") {
    sendEvent(run, { kind: "tool-started", toolCallId: event.toolCallId, toolName: event.toolName }, emit);
  } else if (event.type === "tool_execution_update") {
    const details = event.partialResult?.details;
    if (isSmokeToolDetails(details)) {
      sendEvent(
        run,
        {
          kind: "tool-progress",
          toolCallId: event.toolCallId,
          progress: details.progress,
          message: details.message,
        },
        emit,
      );
    }
  } else if (event.type === "tool_execution_end") {
    sendEvent(
      run,
      {
        kind: "tool-finished",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        ok: !event.isError,
        summary: event.isError ? "The smoke tool did not complete." : "The smoke tool completed.",
      },
      emit,
    );
  }
}

function sendEvent(run: ActiveRun, event: AgentRunEvent, emit: SmokeAgentEmitter): void {
  run.sequence += 1;
  emit({
    protocolVersion: AGENT_WORKER_PROTOCOL_VERSION,
    type: "run-event",
    runId: run.runId,
    sequence: run.sequence,
    timestamp: Date.now(),
    event,
  });
}

function sendFinished(run: ActiveRun, status: "completed" | "cancelled" | "error", emit: SmokeAgentEmitter): void {
  run.sequence += 1;
  emit({
    protocolVersion: AGENT_WORKER_PROTOCOL_VERSION,
    type: "run-finished",
    runId: run.runId,
    sequence: run.sequence,
    timestamp: Date.now(),
    status,
    ...(status === "cancelled" ? { error: createAgentPublicError("cancelled") } : {}),
    ...(status === "error" ? { error: createAgentPublicError("internal-error") } : {}),
  });
}

function isSmokeToolDetails(value: unknown): value is SmokeToolDetails {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { progress?: unknown }).progress === "number" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

function waitForDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(resolve), milliseconds);
    const onAbort = () => {
      const error = new Error("Smoke task cancelled.");
      error.name = "AbortError";
      finish(() => reject(error));
    };
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
