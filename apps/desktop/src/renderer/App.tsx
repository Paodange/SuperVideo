import { useEffect, useRef, useState } from "react";
import type {
  AgentRunStatus,
  AgentWorkerStatusSnapshot,
  AssetSummary,
  DesktopAgentEvent,
  DesktopEnvironment,
  ProjectSummary,
  JobEvent,
  JobSummary,
  CredentialMetadata,
  CredentialServiceKind,
  CredentialStorageStatus,
  SentenceQaContextResult,
  SentenceQaMarkerInput,
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
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobEvents, setJobEvents] = useState<Record<string, JobEvent[]>>({});
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<CredentialStorageStatus>({ available: false, state: "unavailable" });
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([]);
  const [credentialServiceKind, setCredentialServiceKind] = useState<CredentialServiceKind>("llm");
  const [credentialProviderId, setCredentialProviderId] = useState("");
  const [credentialDisplayName, setCredentialDisplayName] = useState("");
  const [credentialReplaceRef, setCredentialReplaceRef] = useState<string | null>(null);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [credentialNotice, setCredentialNotice] = useState<string | null>(null);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticNotice, setDiagnosticNotice] = useState<string | null>(null);
  const [qaContext, setQaContext] = useState<SentenceQaContextResult | null>(null);
  const [qaCacheKey, setQaCacheKey] = useState("");
  const [qaIndex, setQaIndex] = useState("0");
  const [qaBusy, setQaBusy] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaPlaybackUri, setQaPlaybackUri] = useState<string | null>(null);
  const credentialSecretInput = useRef<HTMLInputElement>(null);
  const latestSequence = useRef(new Map<string, number>());
  const projectRequest = useRef(0);
  const jobSequences = useRef(new Map<string, number>());
  const projectRef = useRef<ProjectSummary | null>(null);
  projectRef.current = project;

  useEffect(() => {
    const bridge = window.supervideo;
    if (!bridge) { setEnvironment({ mode: "development", platform: "browser preview", electron: "—" }); return; }
    bridge.getEnvironment().then(setEnvironment).catch(() => setEnvironmentError("Desktop status is unavailable."));
    bridge.getAgentStatus().then((status) => { setAgentStatus(status); setRunId(status.activeRunId); setRunStatus(status.runStatus); }).catch(() => setAgentError("Agent Worker status is unavailable."));
    bridge.credentials.status().then(setCredentialStatus).catch(() => setCredentialStatus({ available: false, state: "unavailable" }));
    bridge.credentials.list().then((result) => setCredentials([...result.items])).catch((error: unknown) => setCredentialError(publicErrorMessage(error, "Secure credentials are unavailable.")));
    const removeAgent = bridge.onAgentEvent((event) => applyAgentEvent(event));
    const removeJobs = bridge.onJobEvent((event) => applyJobEvent(event));
    return () => { removeAgent(); removeJobs(); };
  }, []);

  const createProject = (): void => {
    const bridge = window.supervideo;
    if (!bridge || !projectName.trim()) { setProjectError("Enter a project name before choosing a folder."); return; }
    const request = ++projectRequest.current;
    setProjectBusy(true); setProjectError(null);
    void bridge.createProject({ name: projectName, targetPlatform }).then((result) => {
      if (request !== projectRequest.current || result.cancelled) return;
       setProject(result.value); setAssets([]); setQaContext(null); setQaPlaybackUri(null); setJobs([]); setJobEvents({}); jobSequences.current.clear(); void loadJobs(result.value.projectId, request);
    }).catch((error: unknown) => setProjectError(publicErrorMessage(error, "The project could not be created."))).finally(() => { if (request === projectRequest.current) setProjectBusy(false); });
  };

  const openProject = (): void => {
    const bridge = window.supervideo;
    if (!bridge) { setProjectError("Open the desktop app to choose a project folder."); return; }
    const request = ++projectRequest.current;
    setProjectBusy(true); setProjectError(null); setProject(null); setAssets([]); setQaContext(null); setQaPlaybackUri(null); setJobs([]); setJobEvents({}); jobSequences.current.clear();
    void bridge.openProject().then(async (result) => {
      if (request !== projectRequest.current || result.cancelled) return;
      setProject(result.value);
      const listed = await bridge.listProjectAssets({ projectId: result.value.projectId });
      if (request === projectRequest.current) setAssets([...listed.items]);
      await loadJobs(result.value.projectId, request);
    }).catch((error: unknown) => setProjectError(publicErrorMessage(error, "The project could not be opened."))).finally(() => { if (request === projectRequest.current) setProjectBusy(false); });
  };

  const loadJobs = async (projectId: string, request: number): Promise<void> => {
    const bridge = window.supervideo;
    if (!bridge) return;
    try {
      const page = await bridge.listJobs({ projectId, limit: 100 });
      if (request === projectRequest.current) {
        setJobs([...page.items]);
        jobSequences.current = new Map(page.items.map((job) => [job.jobId, job.lastEventSequence]));
        void Promise.all(page.items.map((job) => bridge.listJobEvents({ projectId, jobId: job.jobId, afterSequence: 0, limit: 100 })))
          .then((pages) => { if (request === projectRequest.current) setJobEvents(Object.fromEntries(pages.map((page) => [page.jobId, [...page.items]]))); })
          .catch(() => undefined);
      }
    } catch (error: unknown) {
      if (request === projectRequest.current) setJobError(publicErrorMessage(error, "The jobs could not be loaded."));
    }
  };

  const startSmokeJob = (): void => {
    const bridge = window.supervideo;
    if (!bridge || !project) return;
    setJobBusy(true); setJobError(null);
    const idempotencyKey = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    void bridge.startSmokeJob({ projectId: project.projectId, idempotencyKey, steps: 8, delayMs: 150, failAttempts: 0 })
      .then((job) => { setJobs((current) => mergeJobs(current, [job])); jobSequences.current.set(job.jobId, job.lastEventSequence); })
      .catch((error: unknown) => setJobError(publicErrorMessage(error, "The job could not be started.")))
      .finally(() => setJobBusy(false));
  };

  const cancelJob = (jobId: string): void => {
    const bridge = window.supervideo;
    if (!bridge || !project) return;
    void bridge.cancelJob({ projectId: project.projectId, jobId })
      .then((job) => { jobSequences.current.set(job.jobId, Math.max(jobSequences.current.get(job.jobId) ?? 0, job.lastEventSequence)); setJobs((current) => mergeJobs(current, [job])); })
      .catch((error: unknown) => setJobError(publicErrorMessage(error, "The job could not be cancelled.")));
  };

  const retryJob = (jobId: string): void => {
    const bridge = window.supervideo;
    if (!bridge || !project) return;
    void bridge.retryJob({ projectId: project.projectId, jobId })
      .then((job) => { jobSequences.current.set(job.jobId, Math.max(jobSequences.current.get(job.jobId) ?? 0, job.lastEventSequence)); setJobs((current) => mergeJobs(current, [job])); })
      .catch((error: unknown) => setJobError(publicErrorMessage(error, "The job could not be retried.")));
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

  const inspectSentenceQa = (): void => {
    const bridge = window.supervideo;
    const asset = assets[0];
    const sentenceIndex = Number(qaIndex);
    if (!bridge || !project || !asset || !/^[0-9a-f]{64}$/.test(qaCacheKey.trim()) || !Number.isSafeInteger(sentenceIndex) || sentenceIndex < 0) {
      setQaError("Enter a B05 cache key and choose an indexed asset before loading QA context.");
      return;
    }
    setQaBusy(true); setQaError(null);
    void bridge.inspectSentenceQa({ projectId: project.projectId, assetId: asset.assetId, sentenceCacheKey: qaCacheKey.trim(), sentenceIndex, contextBefore: 1, contextAfter: 1 })
      .then((result) => { setQaContext(result); setQaPlaybackUri(result.items.find((item) => item.relation === "selected")?.playback.uri ?? null); })
      .catch((error: unknown) => setQaError(publicErrorMessage(error, "The sentence QA context could not be loaded.")))
      .finally(() => setQaBusy(false));
  };

  const saveSentenceQaMarker = (issueType: SentenceQaMarkerInput["issueType"]): void => {
    const bridge = window.supervideo;
    const asset = assets[0];
    if (!bridge || !project || !asset || !qaContext) return;
    const selected = qaContext.items.find((item) => item.relation === "selected");
    if (!selected) return;
    const existing = qaContext.markers.find((marker) => marker.sentenceIndex === selected.sentence.index && marker.issueType === issueType);
    const nextMarkers = existing
      ? qaContext.markers.filter((marker) => marker.markerId !== existing.markerId).map((marker): SentenceQaMarkerInput => ({ sentenceIndex: marker.sentenceIndex, issueType: marker.issueType, status: marker.status, source: marker.source, note: marker.note, expectedText: marker.expectedText }))
      : [...qaContext.markers.map((marker): SentenceQaMarkerInput => ({ sentenceIndex: marker.sentenceIndex, issueType: marker.issueType, status: marker.status, source: marker.source, note: marker.note, expectedText: marker.expectedText })), { sentenceIndex: selected.sentence.index, issueType, source: "manual" as const, note: issueType === "missing-text" ? "Check transcript against audio." : "Marked during sentence-boundary QA." }];
    setQaBusy(true); setQaError(null);
    void bridge.saveSentenceQa({ projectId: project.projectId, assetId: asset.assetId, sentenceCacheKey: qaContext.sentenceCacheKey, sentenceIndex: qaContext.selectedIndex, markers: nextMarkers })
      .then(() => inspectSentenceQa())
      .catch((error: unknown) => setQaError(publicErrorMessage(error, "The QA marker could not be saved.")))
      .finally(() => setQaBusy(false));
  };

  const saveCredential = (): void => {
    const bridge = window.supervideo;
    const secret = credentialSecretInput.current?.value ?? "";
    if (!bridge) { setCredentialError("Open the desktop app to configure secure credentials."); return; }
    if (!credentialProviderId.trim() || !credentialDisplayName.trim() || !secret) { setCredentialError("Enter a provider, display name and secret."); return; }
    setCredentialBusy(true); setCredentialError(null); setCredentialNotice(null);
    // The secret is never placed in React state and is cleared as soon as the
    // one-way Main call is made, including when the call fails.
    if (credentialSecretInput.current) credentialSecretInput.current.value = "";
    void bridge.credentials.save({ serviceKind: credentialServiceKind, providerId: credentialProviderId.trim(), displayName: credentialDisplayName.trim(), secret })
      .then((metadata) => { setCredentials((current) => [...current, metadata]); setCredentialStatus({ available: true, state: "available" }); setCredentialNotice("Credential saved. The secret cannot be viewed here."); })
      .catch((error: unknown) => setCredentialError(publicErrorMessage(error, "The credential could not be saved.")))
      .finally(() => setCredentialBusy(false));
  };

  const replaceCredential = (): void => {
    const bridge = window.supervideo;
    const secret = credentialSecretInput.current?.value ?? "";
    if (!bridge || !credentialReplaceRef) { setCredentialError("Select a configured credential to replace."); return; }
    if (!secret) { setCredentialError("Enter a new secret before replacing."); return; }
    const credentialRef = credentialReplaceRef;
    setCredentialBusy(true); setCredentialError(null); setCredentialNotice(null);
    if (credentialSecretInput.current) credentialSecretInput.current.value = "";
    void bridge.credentials.replace({ credentialRef, secret })
      .then((metadata) => { setCredentials((current) => current.map((item) => item.credentialRef === metadata.credentialRef ? metadata : item)); setCredentialNotice("Credential replaced. The previous secret was not displayed."); setCredentialReplaceRef(null); })
      .catch((error: unknown) => setCredentialError(publicErrorMessage(error, "The credential could not be replaced.")))
      .finally(() => setCredentialBusy(false));
  };

  const removeCredential = (credentialRef: string): void => {
    const bridge = window.supervideo;
    if (!bridge || !window.confirm("Delete this saved credential? The secret cannot be recovered by SuperVideo.")) return;
    setCredentialBusy(true); setCredentialError(null); setCredentialNotice(null);
    void bridge.credentials.remove({ credentialRef })
      .then((result) => { if (result.removed) setCredentials((current) => current.filter((item) => item.credentialRef !== credentialRef)); if (credentialReplaceRef === credentialRef) setCredentialReplaceRef(null); setCredentialNotice("Credential deleted."); })
      .catch((error: unknown) => setCredentialError(publicErrorMessage(error, "The credential could not be deleted.")))
      .finally(() => setCredentialBusy(false));
  };

  const exportDiagnostics = (): void => {
    const bridge = window.supervideo;
    if (!bridge) { setDiagnosticNotice("Open the desktop app to export diagnostics."); return; }
    setDiagnosticBusy(true); setDiagnosticNotice(null);
    void bridge.diagnostics.export()
      .then((result) => setDiagnosticNotice(result.status === "saved" ? "Diagnostics exported. The file is redacted and was not uploaded." : "Diagnostics export cancelled."))
      .catch((error: unknown) => setDiagnosticNotice(publicErrorMessage(error, "Diagnostics could not be exported.")))
      .finally(() => setDiagnosticBusy(false));
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
    if (event.kind === "job-event") { return; }
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

  function applyJobEvent(event: JobEvent): void {
    const activeProject = projectRef.current;
    if (!activeProject || event.projectId !== activeProject.projectId) return;
    const previous = jobSequences.current.get(event.jobId) ?? 0;
    if (event.sequence <= previous) return;
    jobSequences.current.set(event.jobId, event.sequence);
    const bridge = window.supervideo;
    if (!bridge) return;
    setJobEvents((current) => ({ ...current, [event.jobId]: mergeJobEvents(current[event.jobId] ?? [], [event]) }));
    const hydrate = (afterSequence: number): void => {
      void bridge.getJob({ projectId: activeProject.projectId, jobId: event.jobId })
        .then((job) => { const currentProject = projectRef.current; if (currentProject && job.projectId === currentProject.projectId) { jobSequences.current.set(job.jobId, Math.max(jobSequences.current.get(job.jobId) ?? 0, job.lastEventSequence)); setJobs((current) => mergeJobs(current, [job])); } })
        .catch(() => undefined);
      if (afterSequence < event.sequence - 1) {
        void bridge.listJobEvents({ projectId: activeProject.projectId, jobId: event.jobId, afterSequence, limit: 100 })
          .then((page) => {
            const currentProject = projectRef.current;
            if (!currentProject || page.projectId !== currentProject.projectId || page.jobId !== event.jobId) return;
            setJobEvents((current) => ({ ...current, [event.jobId]: mergeJobEvents(current[event.jobId] ?? [], page.items) }));
            for (const persisted of page.items) {
              if (persisted.sequence > (jobSequences.current.get(event.jobId) ?? 0)) jobSequences.current.set(event.jobId, persisted.sequence);
            }
          })
          .catch(() => undefined);
      }
    };
    hydrate(previous);
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
      <section className="agent-panel qa-panel" aria-labelledby="qa-title"><div className="panel-heading"><div><div className="eyebrow">B06 SENTENCE QA</div><h2 id="qa-title">Sentence boundary review</h2></div><span className="worker-badge">v1</span></div><p className="hint">Load a B05 SentenceResult cache to review one sentence with bounded context. The fixture set contains 60 privacy-safe regression sentences.</p><div className="qa-form"><label>B05 cache key<input value={qaCacheKey} onChange={(event) => setQaCacheKey(event.target.value)} maxLength={64} placeholder="64-character sentence cache key" /></label><label>Sentence index<input type="number" min="0" max="1999" value={qaIndex} onChange={(event) => setQaIndex(event.target.value)} /></label></div><div className="actions"><button type="button" onClick={inspectSentenceQa} disabled={qaBusy || !project || assets.length === 0}>{qaBusy ? "Loading…" : "Load sentence context"}</button></div>{qaError && <p className="error-text">{qaError}</p>}{qaContext && <><div className="qa-context" aria-live="polite">{qaContext.items.map((item) => <article className={`qa-sentence qa-${item.relation}`} key={item.sentence.index}><div className="qa-sentence-heading"><span>{item.relation === "selected" ? "Selected" : item.relation === "before" ? "Previous" : "Next"} · #{item.sentence.index}</span><span>{item.sentence.quality}</span></div><p>{item.sentence.text}</p><button type="button" className="secondary" onClick={() => setQaPlaybackUri(item.playback.uri)}>Use playback range</button><code>{item.playback.uri}</code></article>)}</div><div className="qa-markers"><span className="output-label">Mark selected sentence</span><div className="actions"><button type="button" className="secondary" onClick={() => saveSentenceQaMarker("missing-text")} disabled={qaBusy}>Missing text</button><button type="button" className="secondary" onClick={() => saveSentenceQaMarker("half-sentence")} disabled={qaBusy}>Half sentence</button><button type="button" className="secondary" onClick={() => saveSentenceQaMarker("low-confidence")} disabled={qaBusy}>Low confidence</button><button type="button" className="secondary" onClick={() => saveSentenceQaMarker("boundary-uncertain")} disabled={qaBusy}>Uncertain boundary</button></div>{qaPlaybackUri && <p className="hint">Addressed range: <code>{qaPlaybackUri}</code></p>}<p className="hint">Saved markers: {qaContext.markers.length}</p></div></>}</section>
      <section className="agent-panel" aria-labelledby="agent-title"><div className="panel-heading"><div><div className="eyebrow">A03 ENGINEERING PANEL</div><h2 id="agent-title">Agent Worker</h2></div><span className={`worker-badge worker-${agentStatus.status}`}>{agentStatus.status}</span></div><dl className="agent-details"><div><dt>Worker version</dt><dd>{agentStatus.workerVersion ?? "—"}</dd></div><div><dt>Generation</dt><dd>{agentStatus.generation}</dd></div><div><dt>Run status</dt><dd>{runStatus}</dd></div><div><dt>Run ID</dt><dd className="run-id">{runId ?? "—"}</dd></div></dl>{workerUnavailable && <p className="hint">The Worker is not available. Check Main diagnostics before retrying.</p>}<div className="actions"><button type="button" onClick={runSmokeTask} disabled={!canRun}>Run smoke task</button><button type="button" className="secondary" onClick={cancelSmokeTask} disabled={!canCancel}>Cancel</button></div><div className="output" aria-live="polite"><div className="output-label">Streaming assistant text</div><p>{assistantText || "Waiting for a smoke run…"}</p><div className="output-label">Tool progress</div>{tools.length === 0 ? <p className="muted">No tool events yet.</p> : tools.map((tool) => <div className="tool-row" key={tool.toolCallId}><span>{tool.toolName}</span><span>{tool.message}</span><progress max="1" value={tool.progress} /><span>{tool.state}</span></div>)}</div></section>
      {project && <section className="agent-panel jobs-panel" aria-labelledby="jobs-title"><div className="panel-heading"><div><div className="eyebrow">A07 PERSISTENT JOBS</div><h2 id="jobs-title">Jobs</h2></div><span className="worker-badge">{jobs.length}</span></div><p className="hint">SQLite-backed smoke jobs survive Worker/Core restart and stream best-effort events.</p><div className="actions"><button type="button" onClick={startSmokeJob} disabled={jobBusy}>Start 8-step smoke job</button></div>{jobError && <p className="error-text">{jobError}</p>}{jobs.length === 0 ? <p className="muted">No persistent jobs yet.</p> : <div className="job-list">{jobs.map((job) => <JobRow key={job.jobId} job={job} events={jobEvents[job.jobId] ?? []} onCancel={cancelJob} onRetry={retryJob} />)}</div>}</section>}
      <section className="agent-panel security-panel" aria-labelledby="credentials-title"><div className="panel-heading"><div><div className="eyebrow">A08 SECURE SETTINGS</div><h2 id="credentials-title">Service credentials</h2></div><span className={`worker-badge ${credentialStatus.state === "available" ? "worker-ready" : "worker-unavailable"}`}>{credentialStatus.state}</span></div><p className="hint">Secrets are encrypted by the Windows secure storage boundary, never returned to this page, and never uploaded.</p><div className="form-grid credential-grid"><label>Service<select value={credentialServiceKind} onChange={(event) => setCredentialServiceKind(event.target.value as CredentialServiceKind)} disabled={credentialBusy || credentialStatus.state !== "available"}><option value="llm">LLM</option><option value="tts">TTS</option><option value="image">Image</option><option value="video">Video</option></select></label><label>Provider ID<input value={credentialProviderId} onChange={(event) => setCredentialProviderId(event.target.value)} maxLength={64} placeholder="example-provider" disabled={credentialBusy || credentialStatus.state !== "available"} /></label><label>Display name<input value={credentialDisplayName} onChange={(event) => setCredentialDisplayName(event.target.value)} maxLength={80} placeholder="Default provider" disabled={credentialBusy || credentialStatus.state !== "available"} /></label><label>Secret<input ref={credentialSecretInput} type="password" maxLength={8192} autoComplete="new-password" placeholder="Enter once; it will be cleared" disabled={credentialBusy || credentialStatus.state !== "available"} /></label></div><div className="actions"><button type="button" onClick={saveCredential} disabled={credentialBusy || credentialStatus.state !== "available"}>Save credential</button>{credentialReplaceRef && <button type="button" className="secondary" onClick={replaceCredential} disabled={credentialBusy || credentialStatus.state !== "available"}>Replace selected</button>}</div>{credentialError && <p className="error-text">{credentialError}</p>}{credentialNotice && <p className="hint" aria-live="polite">{credentialNotice}</p>}<h3>Configured services</h3>{credentials.length === 0 ? <p className="muted">No credentials are configured.</p> : <div className="credential-list">{credentials.map((credential) => <article className="credential-row" key={credential.credentialRef}><div><strong>{credential.displayName}</strong><span>{credential.serviceKind} · {credential.providerId} · configured</span></div><div className="actions"><button type="button" className="secondary" onClick={() => setCredentialReplaceRef(credential.credentialRef)} disabled={credentialBusy}>{credentialReplaceRef === credential.credentialRef ? "Selected" : "Replace"}</button><button type="button" className="secondary" onClick={() => removeCredential(credential.credentialRef)} disabled={credentialBusy}>Delete</button></div></article>)}</div>}</section>
      <section className="agent-panel diagnostics-panel" aria-labelledby="diagnostics-title"><div className="panel-heading"><div><div className="eyebrow">A08 SUPPORT</div><h2 id="diagnostics-title">Diagnostics</h2></div></div><p className="hint">Export a bounded, redacted JSON file for local troubleshooting. SuperVideo does not upload it or open an external page.</p><div className="actions"><button type="button" onClick={exportDiagnostics} disabled={diagnosticBusy}>{diagnosticBusy ? "Exporting…" : "Export diagnostics"}</button></div>{diagnosticNotice && <p className="hint" aria-live="polite">{diagnosticNotice}</p>}</section>
      <p className="scope">A08 adds secure local credentials, correlated redacted logs, and user-triggered diagnostics. Real providers and media executors remain out of scope.</p>
    </section></main>
  );
}

function AssetRow({ asset }: { asset: AssetSummary }) { return <article className="asset-row"><div><strong>{asset.fileName}</strong><span>{asset.absolutePath}</span></div><span>{asset.kind} · {formatBytes(asset.sizeBytes)}</span><span>{new Date(asset.modifiedAtMs).toLocaleString()}</span><span className="asset-status">{asset.referenceStatus}</span></article>; }
function mergeAssets(current: AssetSummary[], incoming: readonly AssetSummary[]): AssetSummary[] { const merged = new Map(current.map((asset) => [asset.assetId, asset])); for (const asset of incoming) merged.set(asset.assetId, asset); return [...merged.values()]; }
function mergeJobs(current: JobSummary[], incoming: readonly JobSummary[]): JobSummary[] { const merged = new Map(current.map((job) => [job.jobId, job])); for (const job of incoming) merged.set(job.jobId, job); return [...merged.values()].sort((a, b) => a.createdAtMs - b.createdAtMs || a.jobId.localeCompare(b.jobId)); }
function mergeJobEvents(current: JobEvent[], incoming: readonly JobEvent[]): JobEvent[] { const merged = new Map(current.map((event) => [event.sequence, event])); for (const event of incoming) merged.set(event.sequence, event); return [...merged.values()].sort((a, b) => a.sequence - b.sequence).slice(-100); }
function JobRow({ job, events, onCancel, onRetry }: { job: JobSummary; events: readonly JobEvent[]; onCancel: (jobId: string) => void; onRetry: (jobId: string) => void }) { const cancellable = job.status === "queued" || job.status === "running"; return <article className="job-row"><div className="job-row-heading"><strong>{job.jobType}</strong><span className={`job-status job-${job.status}`}>{job.status}</span></div><div className="job-meta"><span>{Math.round(job.progress * 100)}%</span><span>{job.stage ?? "—"}</span><span>attempt {job.attempt}</span><span>event {job.lastEventSequence}</span><span>{new Date(job.updatedAtMs).toLocaleTimeString()}</span></div><progress max="1" value={job.progress} /><div className="job-events" aria-label="Job events">{events.slice(-6).map((event) => <span key={event.sequence}>#{event.sequence} {event.eventType}</span>)}</div>{cancellable && <button type="button" className="secondary" onClick={() => onCancel(job.jobId)}>Cancel</button>}{job.status === "failed" && <button type="button" className="secondary" onClick={() => onRetry(job.jobId)}>Retry</button>}</article>; }
function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`; return `${(value / (1024 * 1024)).toFixed(1)} MiB`; }
function publicErrorMessage(error: unknown, fallback: string): string { return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : fallback; }
