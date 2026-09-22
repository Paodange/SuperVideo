import {
  createDesktopPublicError,
  DESKTOP_IPC_CHANNELS,
  isDesktopIpcChannel,
  isDesktopPublicError,
  isDesktopPublicErrorCode,
  isProjectOperationErrorCode,
  isJobOperationErrorCode,
  isJobEventsListParams,
  isJobListParams,
  isJobReferenceParams,
  isJobSmokeStartParams,
  isSentenceQaParams,
  isSentenceQaSaveParams,
  isRetrievalParams,
  isRerankParams,
  isSlotAlignmentParams,
  isNarrativePlanParams,
  isValidAgentRunId,
  isCredentialRemoveRequest,
  isCredentialReplaceRequest,
  isCredentialSaveRequest,
  type CredentialListResult,
  type CredentialMetadata,
  type CredentialRemoveRequest,
  type CredentialRemoveResult,
  type CredentialReplaceRequest,
  type CredentialSaveRequest,
  type CredentialStorageStatus,
  type DiagnosticExportResult,
  type AgentRunHandle,
  type AgentWorkerMessage,
  type AgentWorkerStatusSnapshot,
  type DesktopAgentEvent,
  type DesktopEnvironment,
  type DesktopIpcResult,
  type GetEnvironmentRequest,
  type GetAgentStatusRequest,
  type RunAgentSmokeTaskRequest,
  type CancelAgentRunRequest,
  type AddAssetReferencesRequest,
  type CreateProjectRequest,
  type ListProjectAssetsRequest,
  type ProjectDialogResult,
  type ProjectSummary,
  type AssetReferenceBatchResult,
  type AssetListResult,
  type JobEventPage,
  type JobEventsListParams,
  type JobListParams,
  type JobPage,
  type JobReferenceParams,
  type JobSmokeStartParams,
  type JobSummary,
  type SentenceQaParams,
  type SentenceQaSaveParams,
  type SentenceQaContextResult,
  type SentenceQaSaveResult,
  type RetrievalParams,
  type RetrievalResult,
  type RerankParams,
  type RerankResult,
  type SlotAlignmentParams,
  type SlotAlignmentResult,
  type NarrativePlanParams,
  type NarrativePlanResult,
} from "@supervideo/shared";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { isTrustedRendererUrl, sanitizeUrlForDiagnostics, type RendererTrustPolicy } from "./policies";

export type SecurityLog = (event: string, details?: Readonly<Record<string, unknown>>) => void;

export type DesktopIpcDependencies = Readonly<{
  getEnvironment: () => DesktopEnvironment;
  getAgentStatus: () => AgentWorkerStatusSnapshot;
  runSmokeTask: () => AgentRunHandle;
  cancelSmokeRun: (runId: string) => void;
  createProject: (event: IpcMainInvokeEvent, input: CreateProjectRequest) => Promise<ProjectDialogResult<ProjectSummary>>;
  openProject: (event: IpcMainInvokeEvent) => Promise<ProjectDialogResult<ProjectSummary>>;
  addAssetReferences: (event: IpcMainInvokeEvent, input: AddAssetReferencesRequest) => Promise<ProjectDialogResult<AssetReferenceBatchResult>>;
  listProjectAssets: (event: IpcMainInvokeEvent, input: ListProjectAssetsRequest) => Promise<AssetListResult>;
  inspectSentenceQa: (event: IpcMainInvokeEvent, input: SentenceQaParams) => Promise<SentenceQaContextResult>;
  saveSentenceQa: (event: IpcMainInvokeEvent, input: SentenceQaSaveParams) => Promise<SentenceQaSaveResult>;
  retrieveSentences: (event: IpcMainInvokeEvent, input: RetrievalParams) => Promise<RetrievalResult>;
  rerankSentences: (event: IpcMainInvokeEvent, input: RerankParams) => Promise<RerankResult>;
  alignScript: (event: IpcMainInvokeEvent, input: SlotAlignmentParams) => Promise<SlotAlignmentResult>;
  createRemixPlan: (event: IpcMainInvokeEvent, input: NarrativePlanParams) => Promise<NarrativePlanResult>;
  startSmokeJob: (event: IpcMainInvokeEvent, input: JobSmokeStartParams) => Promise<JobSummary>;
  getJob: (event: IpcMainInvokeEvent, input: JobReferenceParams) => Promise<JobSummary>;
  listJobs: (event: IpcMainInvokeEvent, input: JobListParams) => Promise<JobPage>;
  listJobEvents: (event: IpcMainInvokeEvent, input: JobEventsListParams) => Promise<JobEventPage>;
  cancelJob: (event: IpcMainInvokeEvent, input: JobReferenceParams) => Promise<JobSummary>;
  retryJob: (event: IpcMainInvokeEvent, input: JobReferenceParams) => Promise<JobSummary>;
  credentialsStatus?: () => CredentialStorageStatus;
  credentialsList?: () => Promise<CredentialListResult>;
  credentialsSave?: (input: CredentialSaveRequest) => Promise<CredentialMetadata>;
  credentialsReplace?: (input: CredentialReplaceRequest) => Promise<CredentialMetadata>;
  credentialsRemove?: (input: CredentialRemoveRequest) => Promise<CredentialRemoveResult>;
  diagnosticsExport?: (event: IpcMainInvokeEvent) => Promise<DiagnosticExportResult>;
  rendererTrustPolicy: RendererTrustPolicy;
  log: SecurityLog;
}>;

export function isValidEmptyPayload(value: unknown): value is GetEnvironmentRequest {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 0
  );
}

export function registerDesktopIpcHandlers(
  ipc: Pick<IpcMain, "handle" | "removeHandler">,
  dependencies: DesktopIpcDependencies,
): () => void {
  const disposers = [
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.getEnvironment, isValidEmptyPayload, dependencies, () => dependencies.getEnvironment()),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.getAgentStatus, isValidEmptyPayload, dependencies, () => dependencies.getAgentStatus()),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.runAgentSmokeTask, isValidEmptyPayload, dependencies, () => dependencies.runSmokeTask()),
    registerInvokeHandler(
      ipc,
      DESKTOP_IPC_CHANNELS.cancelAgentRun,
      isValidCancelAgentRunPayload,
      dependencies,
      (payload) => {
        dependencies.cancelSmokeRun(payload.runId);
        return { runId: payload.runId } satisfies AgentRunHandle;
      },
    ),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.createProject, isValidCreateProjectPayload, dependencies, (payload, event) => dependencies.createProject(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.openProject, isValidEmptyPayload, dependencies, (_payload, event) => dependencies.openProject(event)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.addAssetReferences, isValidProjectIdPayload, dependencies, (payload, event) => dependencies.addAssetReferences(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.listProjectAssets, isValidProjectIdPayload, dependencies, (payload, event) => dependencies.listProjectAssets(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.inspectSentenceQa, isSentenceQaParams, dependencies, (payload, event) => dependencies.inspectSentenceQa(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.saveSentenceQa, isSentenceQaSaveParams, dependencies, (payload, event) => dependencies.saveSentenceQa(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.retrieveSentences, isRetrievalParams, dependencies, (payload, event) => dependencies.retrieveSentences(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.rerankSentences, isRerankParams, dependencies, (payload, event) => dependencies.rerankSentences(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.alignScript, isSlotAlignmentParams, dependencies, (payload, event) => dependencies.alignScript(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.createRemixPlan, isNarrativePlanParams, dependencies, (payload, event) => dependencies.createRemixPlan(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.startSmokeJob, isValidJobSmokeStartPayload, dependencies, (payload, event) => dependencies.startSmokeJob(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.getJob, isValidJobReferencePayload, dependencies, (payload, event) => dependencies.getJob(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.listJobs, isValidJobListPayload, dependencies, (payload, event) => dependencies.listJobs(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.listJobEvents, isValidJobEventsListPayload, dependencies, (payload, event) => dependencies.listJobEvents(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.cancelJob, isValidJobReferencePayload, dependencies, (payload, event) => dependencies.cancelJob(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.retryJob, isValidJobReferencePayload, dependencies, (payload, event) => dependencies.retryJob(event, payload)),
  ];

  if (dependencies.credentialsStatus && dependencies.credentialsList && dependencies.credentialsSave && dependencies.credentialsReplace && dependencies.credentialsRemove && dependencies.diagnosticsExport) {
    disposers.push(
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.credentialsStatus, isValidEmptyPayload, dependencies, () => dependencies.credentialsStatus!()),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.credentialsList, isValidEmptyPayload, dependencies, () => dependencies.credentialsList!()),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.credentialsSave, isValidCredentialSavePayload, dependencies, (payload) => dependencies.credentialsSave!(payload)),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.credentialsReplace, isValidCredentialReplacePayload, dependencies, (payload) => dependencies.credentialsReplace!(payload)),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.credentialsRemove, isValidCredentialRemovePayload, dependencies, (payload) => dependencies.credentialsRemove!(payload)),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.diagnosticsExport, isValidEmptyPayload, dependencies, (_payload, event) => dependencies.diagnosticsExport!(event)),
    );
  }

  let disposed = false;
  return () => {
    if (!disposed) {
      disposed = true;
      for (const dispose of disposers) {
        dispose();
      }
    }
  };
}

export function isKnownDesktopIpcChannel(value: unknown): boolean {
  return isDesktopIpcChannel(value);
}

function failure<T>(code: Parameters<typeof createDesktopPublicError>[0]): DesktopIpcResult<T> {
  return Object.freeze({ ok: false, error: createDesktopPublicError(code) });
}

function registerInvokeHandler<TPayload, TValue>(
  ipc: Pick<IpcMain, "handle" | "removeHandler">,
  channel: string,
  validatePayload: (value: unknown) => value is TPayload,
  dependencies: DesktopIpcDependencies,
  action: (payload: TPayload, event: IpcMainInvokeEvent) => TValue | Promise<TValue>,
): () => void {
  ipc.removeHandler(channel);
  ipc.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl || !isTrustedRendererUrl(senderUrl, dependencies.rendererTrustPolicy)) {
      dependencies.log("ipc-rejected", {
        channel,
        reason: "forbidden-sender",
        sender: senderUrl ? sanitizeUrlForDiagnostics(senderUrl) : "[missing-frame]",
      });
      return failure<TValue>("forbidden-sender");
    }

    if (!validatePayload(payload)) {
      dependencies.log("ipc-rejected", { channel, reason: "invalid-payload" });
      return failure<TValue>("invalid-payload");
    }

    try {
      return Object.freeze({ ok: true, value: await action(payload, event) }) as DesktopIpcResult<TValue>;
    } catch (error) {
      const code = publicErrorCode(error);
      dependencies.log("ipc-failed", { channel, reason: code });
      return failure<TValue>(code);
    }
  });

  return () => ipc.removeHandler(channel);
}

export function isValidCancelAgentRunPayload(value: unknown): value is CancelAgentRunRequest {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 1 &&
    isValidAgentRunId((value as { runId?: unknown }).runId)
  );
}

export function isValidCreateProjectPayload(value: unknown): value is CreateProjectRequest {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["name", "targetPlatform"])) return false;
  const name = value.name;
  const target = value.targetPlatform;
  return typeof name === "string" && name.length > 0 && name.length <= 200 && !hasControlCharacters(name)
    && typeof target === "string" && target.length > 0 && target.length <= 64 && !hasControlCharacters(target);
}

export function isValidProjectIdPayload(value: unknown): value is AddAssetReferencesRequest | ListProjectAssetsRequest {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId"])
    && typeof value.projectId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.projectId);
}

export function isValidJobSmokeStartPayload(value: unknown): value is JobSmokeStartParams { return isJobSmokeStartParams(value); }
export function isValidJobReferencePayload(value: unknown): value is JobReferenceParams { return isJobReferenceParams(value); }
export function isValidJobListPayload(value: unknown): value is JobListParams { return isJobListParams(value); }
export function isValidJobEventsListPayload(value: unknown): value is JobEventsListParams { return isJobEventsListParams(value); }

export function isValidCredentialSavePayload(value: unknown): value is CredentialSaveRequest { return isCredentialSaveRequest(value); }
export function isValidCredentialReplacePayload(value: unknown): value is CredentialReplaceRequest { return isCredentialReplaceRequest(value); }
export function isValidCredentialRemovePayload(value: unknown): value is CredentialRemoveRequest { return isCredentialRemoveRequest(value); }

export function toDesktopAgentEvent(message: AgentWorkerMessage): DesktopAgentEvent | undefined {
  if (message.type === "run-event") {
    return Object.freeze({
      kind: "run-event",
      timestamp: message.timestamp,
      runId: message.runId,
      sequence: message.sequence,
      event: message.event,
    });
  }
  if (message.type === "run-finished") {
    return Object.freeze({
      kind: "run-finished",
      timestamp: message.timestamp,
      runId: message.runId,
      sequence: message.sequence,
      status: message.status,
      ...(message.error ? { error: message.error } : {}),
    });
  }
  if (message.type === "worker-error") {
    return Object.freeze({ kind: "worker-error", timestamp: message.timestamp, error: message.error });
  }
  if (message.type === "job-event") {
    return Object.freeze({ kind: "job-event", timestamp: message.event.timestamp, projectId: message.projectId, jobId: message.jobId, event: message.event });
  }
  return undefined;
}

export function createDesktopAgentStatusEvent(status: AgentWorkerStatusSnapshot, timestamp = Date.now()): DesktopAgentEvent {
  return Object.freeze({ kind: "worker-status", timestamp, status });
}

function publicErrorCode(error: unknown): Parameters<typeof createDesktopPublicError>[0] {
  if (error && typeof error === "object" && isDesktopPublicError(error)) {
    return error.code;
  }
  if (error && typeof error === "object" && "publicError" in error && isDesktopPublicError(error.publicError)) {
    return error.publicError.code;
  }
  if (error && typeof error === "object" && "code" in error && isDesktopPublicErrorCode(error.code)) {
    return error.code;
  }
  if (error && typeof error === "object" && "operationError" in error) {
    const code = (error.operationError as { code?: unknown }).code;
    if (isProjectOperationErrorCode(code) || isJobOperationErrorCode(code)) return code;
  }
  return "internal-error";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key)) && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}
