import {
  createDesktopPublicError,
  DESKTOP_IPC_CHANNELS,
  isAssetListResult,
  isAssetReferenceBatchResult,
  isJobEvent,
  isJobEventPage,
  isJobPage,
  isJobSummary,
  isJobReferenceParams,
  isTtsStartRequest,
  isTtsSynthesisResult,
  isProjectSummary,
  isDesktopPublicError,
  isAgentWorkerStatusSnapshot,
  isValidAgentRunId,
  isValidDesktopAgentEvent,
  isCredentialListResult,
  isCredentialMetadata,
  isCredentialRemoveRequest,
  isCredentialRemoveResult,
  isCredentialReplaceRequest,
  isCredentialSaveRequest,
  isCredentialStorageStatus,
  isDiagnosticExportResult,
  isProviderConfigListRequest,
  isProviderConfigInput,
  isProviderConfigDeleteRequest,
  isProviderConfigListResult,
  isProviderDeleteResult,
  isProviderConfig,
  isProviderHealth,
  isSentenceQaParams,
  isSentenceQaSaveParams,
  isSentenceQaContextResult,
  isSentenceQaSaveResult,
  isRetrievalParams,
  isRetrievalResult,
  isRerankParams,
  isRerankResult,
  isSlotAlignmentParams,
  isSlotAlignmentResult,
  isNarrativePlanParams,
  isNarrativePlanResult,
  isDurationOptimizationParams,
  isDurationOptimizationResult,
  isArollCutJoinParams,
  isArollCutJoinResult,
  isSubtitlePlanParams,
  isSubtitlePlanResult,
  isPreviewRenderParams,
  isPreviewRenderResult,
  isPreviewQualityCheckParams,
  isPreviewQualityCheckResult,
  isFinalMp4ExportParams,
  isFinalMp4ExportResult,
  isTimelineEditParams,
  isTimelineEditResult,
  isTimelineVersionCreateParams,
  isTimelineVersionApplyEditParams,
  isTimelineVersionListParams,
  isTimelineVersionReferenceParams,
  isTimelineVersionActivateParams,
  isTimelineVersionUndoParams,
  isTimelineVersionRedoParams,
  isTimelineVersionDiffParams,
  isTimelineVersionResult,
  isTimelineVersionListResult,
  isTimelineVersionDiffResult,
  type AgentRunHandle,
  type AgentWorkerStatusSnapshot,
  type DesktopAgentEvent,
  type DesktopApi,
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
  type JobEvent,
  type JobEventPage,
  type JobListParams,
  type JobEventsListParams,
  type JobReferenceParams,
  type JobSmokeStartParams,
  type JobPage,
  type JobSummary,
  type TtsStartRequest,
  type TtsSynthesisResult,
  type CredentialListResult,
  type CredentialMetadata,
  type CredentialRemoveRequest,
  type CredentialRemoveResult,
  type CredentialReplaceRequest,
  type CredentialSaveRequest,
  type CredentialStorageStatus,
  type DiagnosticExportResult,
  type ProviderConfig,
  type ProviderConfigListRequest,
  type ProviderConfigInput,
  type ProviderConfigDeleteRequest,
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
} from "@supervideo/shared";
import type { AssetListResult, AssetReferenceBatchResult, ProjectSummary } from "@supervideo/shared";

type Invoke = (
  channel:
    | typeof DESKTOP_IPC_CHANNELS.getEnvironment
    | typeof DESKTOP_IPC_CHANNELS.getAgentStatus
    | typeof DESKTOP_IPC_CHANNELS.runAgentSmokeTask
    | typeof DESKTOP_IPC_CHANNELS.cancelAgentRun
    | typeof DESKTOP_IPC_CHANNELS.createProject
    | typeof DESKTOP_IPC_CHANNELS.openProject
    | typeof DESKTOP_IPC_CHANNELS.addAssetReferences
    | typeof DESKTOP_IPC_CHANNELS.listProjectAssets
    | typeof DESKTOP_IPC_CHANNELS.inspectSentenceQa
    | typeof DESKTOP_IPC_CHANNELS.saveSentenceQa
    | typeof DESKTOP_IPC_CHANNELS.retrieveSentences
    | typeof DESKTOP_IPC_CHANNELS.rerankSentences
    | typeof DESKTOP_IPC_CHANNELS.alignScript
    | typeof DESKTOP_IPC_CHANNELS.createRemixPlan
    | typeof DESKTOP_IPC_CHANNELS.optimizeDuration
    | typeof DESKTOP_IPC_CHANNELS.cutJoinAroll
    | typeof DESKTOP_IPC_CHANNELS.planSubtitles
    | typeof DESKTOP_IPC_CHANNELS.renderPreview
    | typeof DESKTOP_IPC_CHANNELS.checkPreviewQuality
    | typeof DESKTOP_IPC_CHANNELS.exportFinalMp4
    | typeof DESKTOP_IPC_CHANNELS.editTimeline
    | typeof DESKTOP_IPC_CHANNELS.createTimelineVersion
    | typeof DESKTOP_IPC_CHANNELS.applyTimelineEditVersion
    | typeof DESKTOP_IPC_CHANNELS.listTimelineVersions
    | typeof DESKTOP_IPC_CHANNELS.getTimelineVersion
    | typeof DESKTOP_IPC_CHANNELS.activateTimelineVersion
    | typeof DESKTOP_IPC_CHANNELS.undoTimelineVersion
    | typeof DESKTOP_IPC_CHANNELS.redoTimelineVersion
    | typeof DESKTOP_IPC_CHANNELS.diffTimelineVersions
    | typeof DESKTOP_IPC_CHANNELS.startSmokeJob
    | typeof DESKTOP_IPC_CHANNELS.startTtsJob
    | typeof DESKTOP_IPC_CHANNELS.getJob
    | typeof DESKTOP_IPC_CHANNELS.getTtsJobResult
    | typeof DESKTOP_IPC_CHANNELS.listJobs
    | typeof DESKTOP_IPC_CHANNELS.listJobEvents
    | typeof DESKTOP_IPC_CHANNELS.cancelJob
    | typeof DESKTOP_IPC_CHANNELS.retryJob
    | typeof DESKTOP_IPC_CHANNELS.credentialsStatus
    | typeof DESKTOP_IPC_CHANNELS.credentialsList
    | typeof DESKTOP_IPC_CHANNELS.credentialsSave
    | typeof DESKTOP_IPC_CHANNELS.credentialsReplace
    | typeof DESKTOP_IPC_CHANNELS.credentialsRemove
    | typeof DESKTOP_IPC_CHANNELS.diagnosticsExport
    | typeof DESKTOP_IPC_CHANNELS.providersList
    | typeof DESKTOP_IPC_CHANNELS.providersUpsert
    | typeof DESKTOP_IPC_CHANNELS.providersRemove
    | typeof DESKTOP_IPC_CHANNELS.providersHealth,
  payload: unknown,
) => Promise<unknown>;

type Subscribe = (
  channel: typeof DESKTOP_IPC_CHANNELS.agentEvent,
  listener: (event: unknown, payload: unknown) => void,
) => () => void;

/**
 * This factory is the complete auditable Renderer surface. No channel,
 * MessagePort, sender, event object, or raw ipcRenderer method crosses it.
 */
export function createDesktopApi(invoke: Invoke, subscribe: Subscribe = () => () => {}): DesktopApi {
  const api: DesktopApi = {
    getEnvironment: () => invokeValue(DESKTOP_IPC_CHANNELS.getEnvironment, {}, invoke, isEnvironment),
    getAgentStatus: () => invokeValue(DESKTOP_IPC_CHANNELS.getAgentStatus, {}, invoke, isAgentWorkerStatusSnapshot),
    runSmokeTask: () => invokeValue(DESKTOP_IPC_CHANNELS.runAgentSmokeTask, {}, invoke, isAgentRunHandle),
    cancelSmokeRun: async (runId) => {
      if (!isValidAgentRunId(runId)) {
        throw createDesktopPublicError("invalid-run-id");
      }
      await invokeValue(
        DESKTOP_IPC_CHANNELS.cancelAgentRun,
        { runId },
        invoke,
        isAgentRunHandle,
      );
    },
    onAgentEvent: (listener) => {
      let disposed = false;
      const wrapped = (_event: unknown, payload: unknown): void => {
        if (!disposed && isValidDesktopAgentEvent(payload)) {
          listener(payload);
        }
      };
      const remove = subscribe(DESKTOP_IPC_CHANNELS.agentEvent, wrapped);
      return () => {
        if (!disposed) {
          disposed = true;
          remove();
        }
      };
    },
    createProject: (input) => invokeValue(
      DESKTOP_IPC_CHANNELS.createProject,
      input,
      invoke,
      (value): value is ProjectDialogResult<ProjectSummary> => isProjectDialogResult(value, isProjectSummary),
    ),
    openProject: () => invokeValue(
      DESKTOP_IPC_CHANNELS.openProject,
      {},
      invoke,
      (value): value is ProjectDialogResult<ProjectSummary> => isProjectDialogResult(value, isProjectSummary),
    ),
    addAssetReferences: (input) => invokeValue(
      DESKTOP_IPC_CHANNELS.addAssetReferences,
      input,
      invoke,
      (value): value is ProjectDialogResult<AssetReferenceBatchResult> => isProjectDialogResult(value, isAssetReferenceBatchResult),
    ),
    listProjectAssets: (input) => invokeValue(
      DESKTOP_IPC_CHANNELS.listProjectAssets,
      input,
      invoke,
      isAssetListResult,
    ),
    inspectSentenceQa: (input: SentenceQaParams) => {
      if (!isSentenceQaParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.inspectSentenceQa, input, invoke, isSentenceQaContextResult);
    },
    saveSentenceQa: (input: SentenceQaSaveParams) => {
      if (!isSentenceQaSaveParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.saveSentenceQa, input, invoke, isSentenceQaSaveResult);
    },
    retrieveSentences: (input: RetrievalParams) => {
      if (!isRetrievalParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.retrieveSentences, input, invoke, isRetrievalResult);
    },
    rerankSentences: (input: RerankParams) => {
      if (!isRerankParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.rerankSentences, input, invoke, isRerankResult);
    },
    alignScript: (input: SlotAlignmentParams) => {
      if (!isSlotAlignmentParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.alignScript, input, invoke, isSlotAlignmentResult);
    },
    createRemixPlan: (input: NarrativePlanParams) => {
      if (!isNarrativePlanParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.createRemixPlan, input, invoke, isNarrativePlanResult);
    },
    optimizeDuration: (input: DurationOptimizationParams) => {
      if (!isDurationOptimizationParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.optimizeDuration, input, invoke, isDurationOptimizationResult);
    },
    cutJoinAroll: (input: ArollCutJoinParams) => {
      if (!isArollCutJoinParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.cutJoinAroll, input, invoke, isArollCutJoinResult);
    },
    planSubtitles: (input: SubtitlePlanParams) => {
      if (!isSubtitlePlanParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.planSubtitles, input, invoke, isSubtitlePlanResult);
    },
    renderPreview: (input: PreviewRenderParams) => {
      if (!isPreviewRenderParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.renderPreview, input, invoke, isPreviewRenderResult);
    },
    checkPreviewQuality: (input: PreviewQualityCheckParams) => {
      if (!isPreviewQualityCheckParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.checkPreviewQuality, input, invoke, isPreviewQualityCheckResult);
    },
    exportFinalMp4: (input: FinalMp4ExportParams) => {
      if (!isFinalMp4ExportParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.exportFinalMp4, input, invoke, isFinalMp4ExportResult);
    },
    editTimeline: (input: TimelineEditParams) => {
      if (!isTimelineEditParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.editTimeline, input, invoke, isTimelineEditResult);
    },
    createTimelineVersion: (input: TimelineVersionCreateParams) => {
      if (!isTimelineVersionCreateParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.createTimelineVersion, input, invoke, isTimelineVersionResult);
    },
    applyTimelineEditVersion: (input: TimelineVersionApplyEditParams) => {
      if (!isTimelineVersionApplyEditParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.applyTimelineEditVersion, input, invoke, isTimelineVersionResult);
    },
    listTimelineVersions: (input: TimelineVersionListParams) => {
      if (!isTimelineVersionListParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.listTimelineVersions, input, invoke, isTimelineVersionListResult);
    },
    getTimelineVersion: (input: TimelineVersionReferenceParams) => {
      if (!isTimelineVersionReferenceParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.getTimelineVersion, input, invoke, isTimelineVersionResult);
    },
    activateTimelineVersion: (input: TimelineVersionActivateParams) => {
      if (!isTimelineVersionActivateParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.activateTimelineVersion, input, invoke, isTimelineVersionResult);
    },
    undoTimelineVersion: (input: TimelineVersionUndoParams) => {
      if (!isTimelineVersionUndoParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.undoTimelineVersion, input, invoke, isTimelineVersionResult);
    },
    redoTimelineVersion: (input: TimelineVersionRedoParams) => {
      if (!isTimelineVersionRedoParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.redoTimelineVersion, input, invoke, isTimelineVersionResult);
    },
    diffTimelineVersions: (input: TimelineVersionDiffParams) => {
      if (!isTimelineVersionDiffParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.diffTimelineVersions, input, invoke, isTimelineVersionDiffResult);
    },
    startSmokeJob: (input) => invokeValue(DESKTOP_IPC_CHANNELS.startSmokeJob, input, invoke, isJobSummary),
    startTtsJob: (input: TtsStartRequest) => {
      if (!isTtsStartRequest(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.startTtsJob, input, invoke, isJobSummary);
    },
    getJob: (input) => invokeValue(DESKTOP_IPC_CHANNELS.getJob, input, invoke, isJobSummary),
    getTtsJobResult: (input: JobReferenceParams) => {
      if (!isJobReferenceParams(input)) return Promise.reject(createDesktopPublicError("invalid-payload"));
      return invokeValue(DESKTOP_IPC_CHANNELS.getTtsJobResult, input, invoke, isTtsSynthesisResult);
    },
    listJobs: (input) => invokeValue(DESKTOP_IPC_CHANNELS.listJobs, input, invoke, isJobPage),
    listJobEvents: (input) => invokeValue(DESKTOP_IPC_CHANNELS.listJobEvents, input, invoke, isJobEventPage),
    cancelJob: (input) => invokeValue(DESKTOP_IPC_CHANNELS.cancelJob, input, invoke, isJobSummary),
    retryJob: (input) => invokeValue(DESKTOP_IPC_CHANNELS.retryJob, input, invoke, isJobSummary),
    onJobEvent: (listener) => {
      let disposed = false;
      const wrapped = (_event: unknown, payload: unknown): void => {
        if (!disposed && isValidDesktopAgentEvent(payload) && payload.kind === "job-event" && isJobEvent(payload.event)) listener(payload.event);
      };
      const remove = subscribe(DESKTOP_IPC_CHANNELS.agentEvent, wrapped);
      return () => { if (!disposed) { disposed = true; remove(); } };
    },
    credentials: Object.freeze({
      status: () => invokeValue(DESKTOP_IPC_CHANNELS.credentialsStatus, {}, invoke, isCredentialStorageStatus),
      list: () => invokeValue(DESKTOP_IPC_CHANNELS.credentialsList, {}, invoke, isCredentialListResult),
      save: (input) => {
        if (!isCredentialSaveRequest(input)) return Promise.reject(createDesktopPublicError("INVALID_CREDENTIAL_INPUT"));
        return invokeValue(DESKTOP_IPC_CHANNELS.credentialsSave, input, invoke, isCredentialMetadata);
      },
      replace: (input) => {
        if (!isCredentialReplaceRequest(input)) return Promise.reject(createDesktopPublicError("INVALID_CREDENTIAL_INPUT"));
        return invokeValue(DESKTOP_IPC_CHANNELS.credentialsReplace, input, invoke, isCredentialMetadata);
      },
      remove: (input) => {
        if (!isCredentialRemoveRequest(input)) return Promise.reject(createDesktopPublicError("INVALID_CREDENTIAL_INPUT"));
        return invokeValue(DESKTOP_IPC_CHANNELS.credentialsRemove, input, invoke, isCredentialRemoveResult);
      },
    }),
    diagnostics: Object.freeze({
      export: () => invokeValue(DESKTOP_IPC_CHANNELS.diagnosticsExport, {}, invoke, isDiagnosticExportResult),
    }),
    providers: Object.freeze({
      list: (input: ProviderConfigListRequest) => {
        if (!isProviderConfigListRequest(input)) return Promise.reject(createDesktopPublicError("PROVIDER_INVALID_CONFIG"));
        return invokeValue(DESKTOP_IPC_CHANNELS.providersList, input, invoke, isProviderConfigListResult);
      },
      upsert: (input: ProviderConfigInput) => {
        if (!isProviderConfigInput(input)) return Promise.reject(createDesktopPublicError("PROVIDER_INVALID_CONFIG"));
        return invokeValue(DESKTOP_IPC_CHANNELS.providersUpsert, input, invoke, isProviderConfig);
      },
      remove: (input: ProviderConfigDeleteRequest) => {
        if (!isProviderConfigDeleteRequest(input)) return Promise.reject(createDesktopPublicError("PROVIDER_INVALID_CONFIG"));
        return invokeValue(DESKTOP_IPC_CHANNELS.providersRemove, input, invoke, isProviderDeleteResult);
      },
      health: (input: ProviderConfigDeleteRequest) => {
        if (!isProviderConfigDeleteRequest(input)) return Promise.reject(createDesktopPublicError("PROVIDER_INVALID_CONFIG"));
        return invokeValue(DESKTOP_IPC_CHANNELS.providersHealth, input, invoke, isProviderHealth);
      },
    }),
  };

  return Object.freeze(api);
}

async function invokeValue<T>(
  channel: Parameters<Invoke>[0],
  payload: Parameters<Invoke>[1],
  invoke: Invoke,
  isValue: (value: unknown) => value is T,
): Promise<T> {
  try {
    const response = await invoke(channel, payload);
    if (isSuccessfulResponse(response) && isValue(response.value)) {
      return response.value;
    }
    if (isFailedResponse(response)) {
      throw response.error;
    }
    throw createDesktopPublicError("internal-error");
  } catch (error) {
    throw isDesktopPublicError(error) ? error : createDesktopPublicError("internal-error");
  }
}

function isSuccessfulResponse(value: unknown): value is Extract<DesktopIpcResult<unknown>, { ok: true }> {
  return value !== null && typeof value === "object" && (value as { ok?: unknown }).ok === true && "value" in value;
}

function isFailedResponse(value: unknown): value is Extract<DesktopIpcResult<unknown>, { ok: false }> {
  return value !== null && typeof value === "object" && (value as { ok?: unknown }).ok === false && isDesktopPublicError((value as { error?: unknown }).error);
}

function isEnvironment(value: unknown): value is DesktopEnvironment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DesktopEnvironment>;
  return (
    (candidate.mode === "development" || candidate.mode === "production") &&
    typeof candidate.platform === "string" &&
    typeof candidate.electron === "string"
  );
}

function isAgentRunHandle(value: unknown): value is AgentRunHandle {
  return value !== null && typeof value === "object" && isValidAgentRunId((value as { runId?: unknown }).runId);
}

function isProjectDialogResult<T>(value: unknown, isValue: (candidate: unknown) => candidate is T): value is ProjectDialogResult<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { cancelled?: unknown; value?: unknown };
  if (candidate.cancelled === true) return Object.keys(value).length === 1;
  return candidate.cancelled === false && Object.keys(value).length === 2 && isValue(candidate.value);
}

export type { AgentWorkerStatusSnapshot, DesktopAgentEvent };
