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
  isTtsStartRequest,
  isImageStartRequest,
  isRemotionRenderParams,
  isSentenceQaParams,
  isSentenceQaSaveParams,
  isRetrievalParams,
  isRerankParams,
  isSlotAlignmentParams,
  isNarrativePlanParams,
  isDurationOptimizationParams,
  isArollCutJoinParams,
  isSubtitlePlanParams,
  isPreviewRenderParams,
  isPreviewQualityCheckParams,
  isFinalMp4ExportParams,
  isTimelineVersionCreateParams,
  isTimelineVersionApplyEditParams,
  isTimelineVersionListParams,
  isTimelineVersionReferenceParams,
  isTimelineVersionActivateParams,
  isTimelineVersionUndoParams,
  isTimelineVersionRedoParams,
  isTimelineVersionDiffParams,
  isValidAgentRunId,
  isCredentialRemoveRequest,
  isCredentialReplaceRequest,
  isCredentialSaveRequest,
  isProviderConfigListRequest,
  isProviderConfigInput,
  isProviderConfigDeleteRequest,
  type CredentialListResult,
  type CredentialMetadata,
  type CredentialRemoveRequest,
  type CredentialRemoveResult,
  type CredentialReplaceRequest,
  type CredentialSaveRequest,
  type CredentialStorageStatus,
  type ProviderConfigInput,
  type ProviderConfig,
  type ProviderConfigDeleteRequest,
  type ProviderConfigListRequest,
  type ProviderConfigListResult,
  type ProviderDeleteResult,
  type ProviderHealth,
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
  type TtsStartRequest,
  type TtsSynthesisResult,
  type ImageStartRequest,
  type ImageGenerationResult,
  type RemotionRenderParams,
  type RemotionRenderResult,
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
  type DurationOptimizationParams,
  type DurationOptimizationResult,
  type ArollCutJoinParams,
  type ArollCutJoinResult,
  type SubtitlePlanParams,
  type SubtitlePlanResult,
  type PreviewRenderParams,
  type PreviewRenderResult,
  type PreviewQualityCheckParams,
  type PreviewQualityCheckResult,
  type FinalMp4ExportParams,
  type FinalMp4ExportResult,
  type TimelineEditParams,
  type TimelineEditResult,
  type TimelineVersionCreateParams,
  type TimelineVersionApplyEditParams,
  type TimelineVersionListParams,
  type TimelineVersionReferenceParams,
  type TimelineVersionActivateParams,
  type TimelineVersionUndoParams,
  type TimelineVersionRedoParams,
  type TimelineVersionDiffParams,
  type TimelineVersionResult,
  type TimelineVersionListResult,
  type TimelineVersionDiffResult,
  isTimelineEditParams,
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
  optimizeDuration: (event: IpcMainInvokeEvent, input: DurationOptimizationParams) => Promise<DurationOptimizationResult>;
  cutJoinAroll: (event: IpcMainInvokeEvent, input: ArollCutJoinParams) => Promise<ArollCutJoinResult>;
  planSubtitles: (event: IpcMainInvokeEvent, input: SubtitlePlanParams) => Promise<SubtitlePlanResult>;
  renderPreview: (event: IpcMainInvokeEvent, input: PreviewRenderParams) => Promise<PreviewRenderResult>;
  checkPreviewQuality: (event: IpcMainInvokeEvent, input: PreviewQualityCheckParams) => Promise<PreviewQualityCheckResult>;
  exportFinalMp4: (event: IpcMainInvokeEvent, input: FinalMp4ExportParams) => Promise<FinalMp4ExportResult>;
  editTimeline: (event: IpcMainInvokeEvent, input: TimelineEditParams) => Promise<TimelineEditResult>;
  createTimelineVersion: (event: IpcMainInvokeEvent, input: TimelineVersionCreateParams) => Promise<TimelineVersionResult>;
  applyTimelineEditVersion: (event: IpcMainInvokeEvent, input: TimelineVersionApplyEditParams) => Promise<TimelineVersionResult>;
  listTimelineVersions: (event: IpcMainInvokeEvent, input: TimelineVersionListParams) => Promise<TimelineVersionListResult>;
  getTimelineVersion: (event: IpcMainInvokeEvent, input: TimelineVersionReferenceParams) => Promise<TimelineVersionResult>;
  activateTimelineVersion: (event: IpcMainInvokeEvent, input: TimelineVersionActivateParams) => Promise<TimelineVersionResult>;
  undoTimelineVersion: (event: IpcMainInvokeEvent, input: TimelineVersionUndoParams) => Promise<TimelineVersionResult>;
  redoTimelineVersion: (event: IpcMainInvokeEvent, input: TimelineVersionRedoParams) => Promise<TimelineVersionResult>;
  diffTimelineVersions: (event: IpcMainInvokeEvent, input: TimelineVersionDiffParams) => Promise<TimelineVersionDiffResult>;
  startSmokeJob: (event: IpcMainInvokeEvent, input: JobSmokeStartParams) => Promise<JobSummary>;
  startTtsJob: (event: IpcMainInvokeEvent, input: TtsStartRequest) => Promise<JobSummary>;
  startImageJob: (event: IpcMainInvokeEvent, input: ImageStartRequest) => Promise<JobSummary>;
  getJob: (event: IpcMainInvokeEvent, input: JobReferenceParams) => Promise<JobSummary>;
  getTtsJobResult: (event: IpcMainInvokeEvent, input: JobReferenceParams) => Promise<TtsSynthesisResult>;
  getImageJobResult: (event: IpcMainInvokeEvent, input: JobReferenceParams) => Promise<ImageGenerationResult>;
  startRemotionJob: (event: IpcMainInvokeEvent, input: RemotionRenderParams) => Promise<JobSummary>;
  getRemotionJobResult: (event: IpcMainInvokeEvent, input: JobReferenceParams) => Promise<RemotionRenderResult>;
  listJobs: (event: IpcMainInvokeEvent, input: JobListParams) => Promise<JobPage>;
  listJobEvents: (event: IpcMainInvokeEvent, input: JobEventsListParams) => Promise<JobEventPage>;
  cancelJob: (event: IpcMainInvokeEvent, input: JobReferenceParams) => Promise<JobSummary>;
  retryJob: (event: IpcMainInvokeEvent, input: JobReferenceParams) => Promise<JobSummary>;
  credentialsStatus?: () => CredentialStorageStatus;
  credentialsList?: () => Promise<CredentialListResult>;
  credentialsSave?: (input: CredentialSaveRequest) => Promise<CredentialMetadata>;
  credentialsReplace?: (input: CredentialReplaceRequest) => Promise<CredentialMetadata>;
  credentialsRemove?: (input: CredentialRemoveRequest) => Promise<CredentialRemoveResult>;
  providersList?: (input: ProviderConfigListRequest) => ProviderConfigListResult;
  providersUpsert?: (input: ProviderConfigInput) => Promise<ProviderConfig>;
  providersRemove?: (input: ProviderConfigDeleteRequest) => Promise<ProviderDeleteResult>;
  providersHealth?: (input: ProviderConfigDeleteRequest) => Promise<ProviderHealth>;
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
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.optimizeDuration, isDurationOptimizationParams, dependencies, (payload, event) => dependencies.optimizeDuration(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.cutJoinAroll, isArollCutJoinParams, dependencies, (payload, event) => dependencies.cutJoinAroll(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.planSubtitles, isSubtitlePlanParams, dependencies, (payload, event) => dependencies.planSubtitles(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.renderPreview, isPreviewRenderParams, dependencies, (payload, event) => dependencies.renderPreview(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.checkPreviewQuality, isPreviewQualityCheckParams, dependencies, (payload, event) => dependencies.checkPreviewQuality(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.exportFinalMp4, isFinalMp4ExportParams, dependencies, (payload, event) => dependencies.exportFinalMp4(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.editTimeline, isTimelineEditParams, dependencies, (payload, event) => dependencies.editTimeline(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.createTimelineVersion, isTimelineVersionCreateParams, dependencies, (payload, event) => dependencies.createTimelineVersion(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.applyTimelineEditVersion, isTimelineVersionApplyEditParams, dependencies, (payload, event) => dependencies.applyTimelineEditVersion(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.listTimelineVersions, isTimelineVersionListParams, dependencies, (payload, event) => dependencies.listTimelineVersions(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.getTimelineVersion, isTimelineVersionReferenceParams, dependencies, (payload, event) => dependencies.getTimelineVersion(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.activateTimelineVersion, isTimelineVersionActivateParams, dependencies, (payload, event) => dependencies.activateTimelineVersion(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.undoTimelineVersion, isTimelineVersionUndoParams, dependencies, (payload, event) => dependencies.undoTimelineVersion(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.redoTimelineVersion, isTimelineVersionRedoParams, dependencies, (payload, event) => dependencies.redoTimelineVersion(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.diffTimelineVersions, isTimelineVersionDiffParams, dependencies, (payload, event) => dependencies.diffTimelineVersions(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.startSmokeJob, isValidJobSmokeStartPayload, dependencies, (payload, event) => dependencies.startSmokeJob(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.startTtsJob, isTtsStartRequest, dependencies, (payload, event) => dependencies.startTtsJob(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.startImageJob, isImageStartRequest, dependencies, (payload, event) => dependencies.startImageJob(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.getJob, isValidJobReferencePayload, dependencies, (payload, event) => dependencies.getJob(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.getTtsJobResult, isValidJobReferencePayload, dependencies, (payload, event) => dependencies.getTtsJobResult(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.getImageJobResult, isValidJobReferencePayload, dependencies, (payload, event) => dependencies.getImageJobResult(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.startRemotionJob, isRemotionRenderParams, dependencies, (payload, event) => dependencies.startRemotionJob(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.getRemotionJobResult, isValidJobReferencePayload, dependencies, (payload, event) => dependencies.getRemotionJobResult(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.listJobs, isValidJobListPayload, dependencies, (payload, event) => dependencies.listJobs(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.listJobEvents, isValidJobEventsListPayload, dependencies, (payload, event) => dependencies.listJobEvents(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.cancelJob, isValidJobReferencePayload, dependencies, (payload, event) => dependencies.cancelJob(event, payload)),
    registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.retryJob, isValidJobReferencePayload, dependencies, (payload, event) => dependencies.retryJob(event, payload)),
  ];

  if (dependencies.credentialsStatus && dependencies.credentialsList && dependencies.credentialsSave && dependencies.credentialsReplace && dependencies.credentialsRemove && dependencies.diagnosticsExport && dependencies.providersList && dependencies.providersUpsert && dependencies.providersRemove && dependencies.providersHealth) {
    disposers.push(
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.credentialsStatus, isValidEmptyPayload, dependencies, () => dependencies.credentialsStatus!()),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.credentialsList, isValidEmptyPayload, dependencies, () => dependencies.credentialsList!()),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.credentialsSave, isValidCredentialSavePayload, dependencies, (payload) => dependencies.credentialsSave!(payload)),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.credentialsReplace, isValidCredentialReplacePayload, dependencies, (payload) => dependencies.credentialsReplace!(payload)),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.credentialsRemove, isValidCredentialRemovePayload, dependencies, (payload) => dependencies.credentialsRemove!(payload)),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.diagnosticsExport, isValidEmptyPayload, dependencies, (_payload, event) => dependencies.diagnosticsExport!(event)),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.providersList, isProviderConfigListRequest, dependencies, (payload) => dependencies.providersList!(payload)),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.providersUpsert, isProviderConfigInput, dependencies, (payload) => dependencies.providersUpsert!(payload)),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.providersRemove, isProviderConfigDeleteRequest, dependencies, (payload) => dependencies.providersRemove!(payload)),
      registerInvokeHandler(ipc, DESKTOP_IPC_CHANNELS.providersHealth, isProviderConfigDeleteRequest, dependencies, (payload) => dependencies.providersHealth!(payload)),
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
