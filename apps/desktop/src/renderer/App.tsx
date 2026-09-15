import { useEffect, useRef, useState } from "react";
import type {
  AgentRunStatus,
  AgentWorkerStatusSnapshot,
  DesktopAgentEvent,
  DesktopEnvironment,
} from "@supervideo/shared";

const browserAgentStatus: AgentWorkerStatusSnapshot = {
  status: "unavailable",
  generation: 0,
  activeRunId: null,
  runStatus: "idle",
  restartCount: 0,
  lastErrorCode: "worker-unavailable",
  workerVersion: null,
  capabilities: [],
};

type ToolRow = {
  toolCallId: string;
  toolName: string;
  state: "started" | "progress" | "finished";
  progress: number;
  message: string;
};

export function App() {
  const [environment, setEnvironment] = useState<DesktopEnvironment | null>(null);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentWorkerStatusSnapshot>(browserAgentStatus);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<AgentRunStatus>("idle");
  const [assistantText, setAssistantText] = useState("");
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);
  const latestSequence = useRef(new Map<string, number>());

  useEffect(() => {
    const bridge = window.supervideo;
    if (!bridge) {
      setEnvironment({ mode: "development", platform: "browser preview", electron: "—" });
      return;
    }

    bridge.getEnvironment().then(setEnvironment).catch(() => setEnvironmentError("Desktop status is unavailable."));
    bridge.getAgentStatus().then((status) => {
      setAgentStatus(status);
      setRunId(status.activeRunId);
      setRunStatus(status.runStatus);
    }).catch(() => setAgentError("Agent Worker status is unavailable."));

    const unsubscribe = bridge.onAgentEvent((event) => applyAgentEvent(event));
    return unsubscribe;
  }, []);

  const runSmokeTask = (): void => {
    const bridge = window.supervideo;
    if (!bridge) {
      setAgentError("Open the desktop app to run the smoke task.");
      return;
    }
    setAssistantText("");
    setTools([]);
    setAgentError(null);
    latestSequence.current.clear();
    void bridge.runSmokeTask()
      .then((handle) => {
        setRunId(handle.runId);
        setRunStatus("running");
      })
      .catch((error: unknown) => setAgentError(publicErrorMessage(error, "The smoke task could not start.")));
  };

  const cancelSmokeTask = (): void => {
    const bridge = window.supervideo;
    if (!bridge || !runId) {
      return;
    }
    void bridge.cancelSmokeRun(runId)
      .catch((error: unknown) => setAgentError(publicErrorMessage(error, "The smoke task could not be cancelled.")));
  };

  const workerUnavailable = agentStatus.status === "unavailable" || agentStatus.status === "stopped";
  const canRun = agentStatus.status === "ready";
  const canCancel = Boolean(runId && runStatus === "running");

  function applyAgentEvent(event: DesktopAgentEvent): void {
    if (event.kind === "worker-status") {
      setAgentStatus(event.status);
      setRunId(event.status.activeRunId);
      setRunStatus(event.status.runStatus);
      return;
    }
    if (event.kind === "worker-error") {
      setAgentError(event.error.message);
      return;
    }
    const previousSequence = latestSequence.current.get(event.runId) ?? 0;
    if (event.sequence <= previousSequence) {
      return;
    }
    latestSequence.current.set(event.runId, event.sequence);
    setRunId(event.runId);
    if (event.kind === "run-finished") {
      setRunStatus(event.status);
      setAgentError(event.error?.message ?? null);
      return;
    }
    const runEvent = event.event;
    if (runEvent.kind === "run-started") {
      setRunStatus("running");
    } else if (runEvent.kind === "assistant-text-delta") {
      setAssistantText((current) => current + runEvent.delta);
    } else if (runEvent.kind === "tool-started") {
      setTools((current) => [
        ...current.filter((tool) => tool.toolCallId !== runEvent.toolCallId),
        { toolCallId: runEvent.toolCallId, toolName: runEvent.toolName, state: "started", progress: 0, message: "Tool started" },
      ]);
    } else if (runEvent.kind === "tool-progress") {
      setTools((current) => current.map((tool) => tool.toolCallId === runEvent.toolCallId
        ? { ...tool, state: "progress", progress: runEvent.progress, message: runEvent.message }
        : tool));
    } else if (runEvent.kind === "tool-finished") {
      setTools((current) => current.map((tool) => tool.toolCallId === runEvent.toolCallId
        ? { ...tool, state: "finished", progress: tool.progress || (runEvent.ok ? 1 : 0), message: runEvent.summary ?? "Tool finished" }
        : tool));
    }
  }

  return (
    <main className="shell">
      <section className="card" aria-labelledby="app-title">
        <div className="eyebrow">LOCAL VIDEO CREATION WORKSPACE</div>
        <h1 id="app-title">SuperVideo</h1>
        <p className="lead">A local-first desktop foundation with a bounded Pi Agent Worker.</p>

        <div className="status" aria-live="polite">
          <span className={`status-dot ${environmentError || agentError ? "status-dot-error" : ""}`} aria-hidden="true" />
          <span>{environmentError ?? agentError ?? (environment ? "Desktop is ready" : "Checking desktop status…")}</span>
        </div>

        <dl className="details">
          <div><dt>Desktop status</dt><dd>{environment ? "Ready" : "Checking"}</dd></div>
          <div><dt>Development environment</dt><dd>{environment?.mode ?? "development"}</dd></div>
          <div><dt>Platform</dt><dd>{environment?.platform ?? "Windows target"}</dd></div>
          <div><dt>Electron</dt><dd>{environment?.electron ?? "—"}</dd></div>
        </dl>

        <section className="agent-panel" aria-labelledby="agent-title">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">A03 ENGINEERING PANEL</div>
              <h2 id="agent-title">Agent Worker</h2>
            </div>
            <span className={`worker-badge worker-${agentStatus.status}`}>{agentStatus.status}</span>
          </div>
          <dl className="agent-details">
            <div><dt>Worker version</dt><dd>{agentStatus.workerVersion ?? "—"}</dd></div>
            <div><dt>Generation</dt><dd>{agentStatus.generation}</dd></div>
            <div><dt>Run status</dt><dd>{runStatus}</dd></div>
            <div><dt>Run ID</dt><dd className="run-id">{runId ?? "—"}</dd></div>
          </dl>
          {workerUnavailable && <p className="hint">The Worker is not available. Check the Main diagnostics before retrying.</p>}
          {agentStatus.status === "restarting" && <p className="hint">The Worker is restarting after an unexpected exit.</p>}
          <div className="actions">
            <button type="button" onClick={runSmokeTask} disabled={!canRun}>Run smoke task</button>
            <button type="button" className="secondary" onClick={cancelSmokeTask} disabled={!canCancel}>Cancel</button>
          </div>
          <div className="output" aria-live="polite">
            <div className="output-label">Streaming assistant text</div>
            <p>{assistantText || "Waiting for a smoke run…"}</p>
            <div className="output-label">Tool progress</div>
            {tools.length === 0 ? <p className="muted">No tool events yet.</p> : tools.map((tool) => (
              <div className="tool-row" key={tool.toolCallId}>
                <span>{tool.toolName}</span>
                <span>{tool.message}</span>
                <progress max="1" value={tool.progress} />
                <span>{tool.state}</span>
              </div>
            ))}
          </div>
        </section>

        <p className="scope">A03 smoke panel · Pi faux provider only · no Python Core, network, file, or shell tools.</p>
      </section>
    </main>
  );
}

function publicErrorMessage(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : fallback;
}
