import { useEffect, useRef, useState } from "react";
import type {
  AgentRunStatus,
  AgentWorkerStatusSnapshot,
  AssetSummary,
  DesktopAgentEvent,
  DesktopEnvironment,
  ProjectSummary,
} from "@supervideo/shared";

const browserAgentStatus: AgentWorkerStatusSnapshot = {
  status: "unavailable", generation: 0, activeRunId: null, runStatus: "idle", restartCount: 0,
  lastErrorCode: "worker-unavailable", workerVersion: null, capabilities: [],
};

type ToolRow = { toolCallId: string; toolName: string; state: "started" | "progress" | "finished"; progress: number; message: string };

export function App() {
  const [environment, setEnvironment] = useState<DesktopEnvironment | null>(null);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentWorkerStatusSnapshot>(browserAgentStatus);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<AgentRunStatus>("idle");
  const [assistantText, setAssistantText] = useState("");
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [projectName, setProjectName] = useState("");
  const [targetPlatform, setTargetPlatform] = useState("douyin");
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const latestSequence = useRef(new Map<string, number>());
  const projectRequest = useRef(0);

  useEffect(() => {
    const bridge = window.supervideo;
    if (!bridge) { setEnvironment({ mode: "development", platform: "browser preview", electron: "—" }); return; }
    bridge.getEnvironment().then(setEnvironment).catch(() => setEnvironmentError("Desktop status is unavailable."));
    bridge.getAgentStatus().then((status) => { setAgentStatus(status); setRunId(status.activeRunId); setRunStatus(status.runStatus); }).catch(() => setAgentError("Agent Worker status is unavailable."));
    return bridge.onAgentEvent((event) => applyAgentEvent(event));
  }, []);

  const createProject = (): void => {
    const bridge = window.supervideo;
    if (!bridge || !projectName.trim()) { setProjectError("Enter a project name before choosing a folder."); return; }
    const request = ++projectRequest.current;
    setProjectBusy(true); setProjectError(null);
    void bridge.createProject({ name: projectName, targetPlatform }).then((result) => {
      if (request !== projectRequest.current || result.cancelled) return;
      setProject(result.value); setAssets([]);
    }).catch((error: unknown) => setProjectError(publicErrorMessage(error, "The project could not be created."))).finally(() => { if (request === projectRequest.current) setProjectBusy(false); });
  };

  const openProject = (): void => {
    const bridge = window.supervideo;
    if (!bridge) { setProjectError("Open the desktop app to choose a project folder."); return; }
    const request = ++projectRequest.current;
    setProjectBusy(true); setProjectError(null); setProject(null); setAssets([]);
    void bridge.openProject().then(async (result) => {
      if (request !== projectRequest.current || result.cancelled) return;
      setProject(result.value);
      const listed = await bridge.listProjectAssets({ projectId: result.value.projectId });
      if (request === projectRequest.current) setAssets([...listed.items]);
    }).catch((error: unknown) => setProjectError(publicErrorMessage(error, "The project could not be opened."))).finally(() => { if (request === projectRequest.current) setProjectBusy(false); });
  };

  const addAssets = (): void => {
    const bridge = window.supervideo;
    if (!bridge || !project) return;
    const request = ++projectRequest.current;
    setProjectBusy(true); setProjectError(null);
    void bridge.addAssetReferences({ projectId: project.projectId }).then((result) => {
      if (request !== projectRequest.current || result.cancelled) return;
      setAssets((current) => mergeAssets(current, result.value.items));
      setProject((current) => current ? { ...current, assetCount: current.assetCount + result.value.items.filter((item) => item.referenceStatus === "added").length } : current);
    }).catch((error: unknown) => setProjectError(publicErrorMessage(error, "The assets could not be referenced."))).finally(() => { if (request === projectRequest.current) setProjectBusy(false); });
  };

  const refreshAssets = (): void => {
    const bridge = window.supervideo;
    if (!bridge || !project) return;
    const request = ++projectRequest.current;
    setProjectBusy(true);
    void bridge.listProjectAssets({ projectId: project.projectId }).then((result) => { if (request === projectRequest.current) setAssets([...result.items]); }).catch((error: unknown) => setProjectError(publicErrorMessage(error, "The asset list could not be loaded."))).finally(() => { if (request === projectRequest.current) setProjectBusy(false); });
  };

  const runSmokeTask = (): void => {
    const bridge = window.supervideo;
    if (!bridge) { setAgentError("Open the desktop app to run the smoke task."); return; }
    setAssistantText(""); setTools([]); setAgentError(null); latestSequence.current.clear();
    void bridge.runSmokeTask().then((handle) => { setRunId(handle.runId); setRunStatus("running"); }).catch((error: unknown) => setAgentError(publicErrorMessage(error, "The smoke task could not start.")));
  };

  const cancelSmokeTask = (): void => {
    const bridge = window.supervideo;
    if (!bridge || !runId) return;
    void bridge.cancelSmokeRun(runId).catch((error: unknown) => setAgentError(publicErrorMessage(error, "The smoke task could not be cancelled.")));
  };

  function applyAgentEvent(event: DesktopAgentEvent): void {
    if (event.kind === "worker-status") { setAgentStatus(event.status); setRunId(event.status.activeRunId); setRunStatus(event.status.runStatus); return; }
    if (event.kind === "worker-error") { setAgentError(event.error.message); return; }
    const previousSequence = latestSequence.current.get(event.runId) ?? 0;
    if (event.sequence <= previousSequence) return;
    latestSequence.current.set(event.runId, event.sequence); setRunId(event.runId);
    if (event.kind === "run-finished") { setRunStatus(event.status); setAgentError(event.error?.message ?? null); return; }
    const runEvent = event.event;
    if (runEvent.kind === "run-started") setRunStatus("running");
    else if (runEvent.kind === "assistant-text-delta") setAssistantText((current) => current + runEvent.delta);
    else if (runEvent.kind === "tool-started") setTools((current) => [...current.filter((tool) => tool.toolCallId !== runEvent.toolCallId), { toolCallId: runEvent.toolCallId, toolName: runEvent.toolName, state: "started", progress: 0, message: "Tool started" }]);
    else if (runEvent.kind === "tool-progress") setTools((current) => current.map((tool) => tool.toolCallId === runEvent.toolCallId ? { ...tool, state: "progress", progress: runEvent.progress, message: runEvent.message } : tool));
    else if (runEvent.kind === "tool-finished") setTools((current) => current.map((tool) => tool.toolCallId === runEvent.toolCallId ? { ...tool, state: "finished", progress: tool.progress || (runEvent.ok ? 1 : 0), message: runEvent.summary ?? "Tool finished" } : tool));
  }

  const workerUnavailable = agentStatus.status === "unavailable" || agentStatus.status === "stopped";
  const canRun = agentStatus.status === "ready";
  const canCancel = Boolean(runId && runStatus === "running");

  return (
    <main className="shell"><section className="card" aria-labelledby="app-title">
      <div className="eyebrow">LOCAL VIDEO CREATION WORKSPACE</div><h1 id="app-title">SuperVideo</h1>
      <p className="lead">Create a local project and reference original media without copying it.</p>
      <div className="status" aria-live="polite"><span className={`status-dot ${environmentError || agentError || projectError ? "status-dot-error" : ""}`} aria-hidden="true" /><span>{environmentError ?? projectError ?? agentError ?? (environment ? "Desktop is ready" : "Checking desktop status…")}</span></div>

      <section className="project-panel" aria-labelledby="project-title"><div className="panel-heading"><div><div className="eyebrow">A06 PROJECT WORKFLOW</div><h2 id="project-title">Project</h2></div><span className="worker-badge">{project ? "active" : "not opened"}</span></div>
        {!project && <><div className="form-grid"><label>Project name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={200} placeholder="招聘口播项目" /></label><label>Target platform<select value={targetPlatform} onChange={(event) => setTargetPlatform(event.target.value)}><option value="douyin">douyin</option></select></label></div><div className="actions"><button type="button" onClick={createProject} disabled={projectBusy}>Choose folder and create</button><button type="button" className="secondary" onClick={openProject} disabled={projectBusy}>Open project</button></div><p className="hint">The folder is chosen by a native dialog. The page never sends a path.</p></>}
        {project && <><dl className="details project-details"><div><dt>Name</dt><dd>{project.name}</dd></div><div><dt>Platform</dt><dd>{project.targetPlatform}</dd></div><div><dt>Project ID</dt><dd className="run-id">{project.projectId}</dd></div><div><dt>Assets</dt><dd>{project.assetCount}</dd></div><div className="wide"><dt>Root</dt><dd className="path-value">{project.projectRoot}</dd></div></dl><div className="actions"><button type="button" onClick={addAssets} disabled={projectBusy}>Add local video files</button><button type="button" className="secondary" onClick={refreshAssets} disabled={projectBusy}>Refresh assets</button></div><h3>Referenced assets</h3>{assets.length === 0 ? <p className="muted">No external media has been referenced yet.</p> : <div className="asset-list">{assets.map((asset) => <AssetRow key={asset.assetId} asset={asset} />)}</div>}</>}
      </section>

      <dl className="details"><div><dt>Environment</dt><dd>{environment?.mode ?? "development"}</dd></div><div><dt>Platform</dt><dd>{environment?.platform ?? "Windows target"}</dd></div><div><dt>Electron</dt><dd>{environment?.electron ?? "—"}</dd></div></dl>
      <section className="agent-panel" aria-labelledby="agent-title"><div className="panel-heading"><div><div className="eyebrow">A03 ENGINEERING PANEL</div><h2 id="agent-title">Agent Worker</h2></div><span className={`worker-badge worker-${agentStatus.status}`}>{agentStatus.status}</span></div><dl className="agent-details"><div><dt>Worker version</dt><dd>{agentStatus.workerVersion ?? "—"}</dd></div><div><dt>Generation</dt><dd>{agentStatus.generation}</dd></div><div><dt>Run status</dt><dd>{runStatus}</dd></div><div><dt>Run ID</dt><dd className="run-id">{runId ?? "—"}</dd></div></dl>{workerUnavailable && <p className="hint">The Worker is not available. Check Main diagnostics before retrying.</p>}<div className="actions"><button type="button" onClick={runSmokeTask} disabled={!canRun}>Run smoke task</button><button type="button" className="secondary" onClick={cancelSmokeTask} disabled={!canCancel}>Cancel</button></div><div className="output" aria-live="polite"><div className="output-label">Streaming assistant text</div><p>{assistantText || "Waiting for a smoke run…"}</p><div className="output-label">Tool progress</div>{tools.length === 0 ? <p className="muted">No tool events yet.</p> : tools.map((tool) => <div className="tool-row" key={tool.toolCallId}><span>{tool.toolName}</span><span>{tool.message}</span><progress max="1" value={tool.progress} /><span>{tool.state}</span></div>)}</div></section>
      <p className="scope">A06 references external files read-only. No recursive scanning, media analysis, chat, or recent-project auto-open is included.</p>
    </section></main>
  );
}

function AssetRow({ asset }: { asset: AssetSummary }) { return <article className="asset-row"><div><strong>{asset.fileName}</strong><span>{asset.absolutePath}</span></div><span>{asset.kind} · {formatBytes(asset.sizeBytes)}</span><span>{new Date(asset.modifiedAtMs).toLocaleString()}</span><span className="asset-status">{asset.referenceStatus}</span></article>; }
function mergeAssets(current: AssetSummary[], incoming: readonly AssetSummary[]): AssetSummary[] { const merged = new Map(current.map((asset) => [asset.assetId, asset])); for (const asset of incoming) merged.set(asset.assetId, asset); return [...merged.values()]; }
function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`; return `${(value / (1024 * 1024)).toFixed(1)} MiB`; }
function publicErrorMessage(error: unknown, fallback: string): string { return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : fallback; }
