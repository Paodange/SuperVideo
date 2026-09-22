import { isTimelineProject, type TimelineProject } from "./timeline-ir";

/**
 * Versioned contract shared by the Agent Worker and the Python Core.
 *
 * This module deliberately contains runtime checks as well as TypeScript
 * types.  JSON crossing the process boundary is untrusted input, even when
 * both processes are started by the same application.
 */

import { isTtsJobStartParams, isTtsSynthesisResult, type TtsJobStartParams, type TtsSynthesisResult } from "./tts-contract";
import { isRemotionRenderParams, isRemotionRenderResult, type RemotionRenderParams, type RemotionRenderResult } from "./remotion-contract";
import { isImageJobStartParams, isImageGenerationResult, type ImageJobStartParams, type ImageGenerationResult } from "./image-contract";
export * from "./remotion-contract";
export * from "./image-contract";
export type { TtsJobStartParams, TtsJobResultParams, TtsStartRequest, TtsSentenceInput, TtsSentenceTimestamp, TtsSynthesisResult } from "./tts-contract";

export const JSON_RPC_VERSION = "2.0" as const;
export const CORE_RPC_PROTOCOL_VERSION = 1 as const;
export const CORE_RPC_MAX_LINE_BYTES = 256 * 1024;
export const CORE_RPC_MAX_REQUEST_ID_LENGTH = 64;
export const CORE_RPC_MAX_METHOD_LENGTH = 128;
export const CORE_RPC_MAX_PROGRESS_MESSAGE_LENGTH = 256;
export const CORE_RPC_MAX_ERROR_MESSAGE_LENGTH = 128;

export const CORE_RPC_METHODS = {
  health: "core.health",
  smokeCountdown: "core.smoke.countdown",
  progress: "core.progress",
  cancel: "core.cancel",
  projectCreate: "project.create",
  projectOpen: "project.open",
  projectInspect: "project.inspect",
  assetReference: "asset.reference",
  assetScan: "asset.scan",
  assetList: "asset.list",
  mediaProbe: "media.probe",
  mediaProxy: "media.proxy",
  mediaTranscribe: "media.transcribe",
  mediaVad: "media.vad",
  mediaSentences: "media.sentences",
  mediaSentenceQaContext: "media.sentences.qa.context",
  mediaSentenceQaSave: "media.sentences.qa.save",
  mediaSentenceIndex: "media.sentences.index",
  mediaSentenceRetrieve: "media.sentences.retrieve",
  mediaSentenceRerank: "media.sentences.rerank",
  mediaScriptAlign: "media.script.align",
  planCreateRemix: "plan.create_remix",
  planOptimizeDuration: "plan.optimize_duration",
  mediaArollCutJoin: "media.aroll.cut_join",
  mediaSubtitlePlan: "media.subtitle.plan",
  mediaPreviewRender: "media.preview.render",
  mediaPreviewQualityCheck: "media.preview.quality_check",
  mediaFinalExport: "media.final.export",
  timelineEdit: "timeline.edit",
  timelineVersionCreate: "timeline.version.create",
  timelineVersionApplyEdit: "timeline.version.apply_edit",
  timelineVersionList: "timeline.version.list",
  timelineVersionGet: "timeline.version.get",
  timelineVersionActivate: "timeline.version.activate",
  timelineVersionUndo: "timeline.version.undo",
  timelineVersionRedo: "timeline.version.redo",
  timelineVersionDiff: "timeline.version.diff",
  jobSmokeStart: "job.smoke.start",
  jobTtsStart: "job.tts.start",
  jobTtsResult: "job.tts.result",
  jobRemotionStart: "job.remotion.start",
  jobRemotionResult: "job.remotion.result",
  jobImageStart: "job.image.start",
  jobImageResult: "job.image.result",
  jobGet: "job.get",
  jobList: "job.list",
  jobEventsList: "job.events.list",
  jobCancel: "job.cancel",
  jobRetry: "job.retry",
  jobEvent: "core.job.event",
} as const;

export type CoreRpcMethod = (typeof CORE_RPC_METHODS)[keyof typeof CORE_RPC_METHODS];
export type CoreRpcCallableMethod =
  | typeof CORE_RPC_METHODS.health
  | typeof CORE_RPC_METHODS.smokeCountdown
  | typeof CORE_RPC_METHODS.projectCreate
  | typeof CORE_RPC_METHODS.projectOpen
  | typeof CORE_RPC_METHODS.projectInspect
  | typeof CORE_RPC_METHODS.assetReference
  | typeof CORE_RPC_METHODS.assetScan
  | typeof CORE_RPC_METHODS.assetList
  | typeof CORE_RPC_METHODS.mediaProbe
  | typeof CORE_RPC_METHODS.mediaProxy
  | typeof CORE_RPC_METHODS.mediaTranscribe
  | typeof CORE_RPC_METHODS.mediaVad
  | typeof CORE_RPC_METHODS.mediaSentences
  | typeof CORE_RPC_METHODS.mediaSentenceQaContext
  | typeof CORE_RPC_METHODS.mediaSentenceQaSave
  | typeof CORE_RPC_METHODS.mediaSentenceIndex
  | typeof CORE_RPC_METHODS.mediaSentenceRetrieve
  | typeof CORE_RPC_METHODS.mediaSentenceRerank
  | typeof CORE_RPC_METHODS.mediaScriptAlign
  | typeof CORE_RPC_METHODS.planCreateRemix
  | typeof CORE_RPC_METHODS.planOptimizeDuration
  | typeof CORE_RPC_METHODS.mediaArollCutJoin
  | typeof CORE_RPC_METHODS.mediaSubtitlePlan
  | typeof CORE_RPC_METHODS.mediaPreviewRender
  | typeof CORE_RPC_METHODS.mediaPreviewQualityCheck
  | typeof CORE_RPC_METHODS.mediaFinalExport
  | typeof CORE_RPC_METHODS.timelineEdit
  | typeof CORE_RPC_METHODS.timelineVersionCreate
  | typeof CORE_RPC_METHODS.timelineVersionApplyEdit
  | typeof CORE_RPC_METHODS.timelineVersionList
  | typeof CORE_RPC_METHODS.timelineVersionGet
  | typeof CORE_RPC_METHODS.timelineVersionActivate
  | typeof CORE_RPC_METHODS.timelineVersionUndo
  | typeof CORE_RPC_METHODS.timelineVersionRedo
  | typeof CORE_RPC_METHODS.timelineVersionDiff
  | typeof CORE_RPC_METHODS.jobSmokeStart
  | typeof CORE_RPC_METHODS.jobTtsStart
  | typeof CORE_RPC_METHODS.jobTtsResult
  | typeof CORE_RPC_METHODS.jobRemotionStart
  | typeof CORE_RPC_METHODS.jobRemotionResult
  | typeof CORE_RPC_METHODS.jobImageStart
  | typeof CORE_RPC_METHODS.jobImageResult
  | typeof CORE_RPC_METHODS.jobGet
  | typeof CORE_RPC_METHODS.jobList
  | typeof CORE_RPC_METHODS.jobEventsList
  | typeof CORE_RPC_METHODS.jobCancel
  | typeof CORE_RPC_METHODS.jobRetry;
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "retrying" | "cancelling" | "cancelled" | "needs_attention";

export const CORE_RPC_ERROR_CODES = {
  parseError: "PARSE_ERROR",
  invalidRequest: "INVALID_REQUEST",
  methodNotFound: "METHOD_NOT_FOUND",
  invalidParams: "INVALID_PARAMS",
  internalError: "INTERNAL_ERROR",
  messageTooLarge: "MESSAGE_TOO_LARGE",
  protocolMismatch: "PROTOCOL_MISMATCH",
  duplicateRequestId: "DUPLICATE_REQUEST_ID",
  busy: "BUSY",
  requestCancelled: "REQUEST_CANCELLED",
  requestTimeout: "REQUEST_TIMEOUT",
  transportClosed: "TRANSPORT_CLOSED",
  pythonNotFound: "PYTHON_NOT_FOUND",
  protocolError: "PROTOCOL_ERROR",
  dialogCancelled: "DIALOG_CANCELLED",
  invalidProjectName: "INVALID_PROJECT_NAME",
  invalidProjectRoot: "INVALID_PROJECT_ROOT",
  unsupportedProjectLocation: "UNSUPPORTED_PROJECT_LOCATION",
  projectDirectoryNotEmpty: "PROJECT_DIRECTORY_NOT_EMPTY",
  projectAlreadyExists: "PROJECT_ALREADY_EXISTS",
  projectNotFound: "PROJECT_NOT_FOUND",
  projectManifestInvalid: "PROJECT_MANIFEST_INVALID",
  projectSchemaTooNew: "PROJECT_SCHEMA_TOO_NEW",
  projectDatabaseMissing: "PROJECT_DATABASE_MISSING",
  projectIdMismatch: "PROJECT_ID_MISMATCH",
  projectPathConflict: "PROJECT_PATH_CONFLICT",
  projectNotActive: "PROJECT_NOT_ACTIVE",
  assetNotFound: "ASSET_NOT_FOUND",
  unsupportedAssetType: "UNSUPPORTED_ASSET_TYPE",
  tooManyAssets: "TOO_MANY_ASSETS",
  assetChanged: "ASSET_CHANGED",
  assetChangedDuringReference: "ASSET_CHANGED_DURING_REFERENCE",
  fileAccessDenied: "FILE_ACCESS_DENIED",
  operationTimeout: "OPERATION_TIMEOUT",
  coreUnavailable: "CORE_UNAVAILABLE",
  databaseOpenFailed: "DATABASE_OPEN_FAILED",
  databaseReadOnly: "DATABASE_READ_ONLY",
  databaseBusy: "DATABASE_BUSY",
  databaseCorrupt: "DATABASE_CORRUPT",
  migrationFailed: "MIGRATION_FAILED",
  migrationChecksumMismatch: "MIGRATION_CHECKSUM_MISMATCH",
  schemaTooNew: "SCHEMA_TOO_NEW",
  constraintViolation: "CONSTRAINT_VIOLATION",
  recordNotFound: "RECORD_NOT_FOUND",
  invalidRecord: "INVALID_RECORD",
  jobNotFound: "JOB_NOT_FOUND",
  jobStateConflict: "JOB_STATE_CONFLICT",
  jobNotCancellable: "JOB_NOT_CANCELLABLE",
  jobNotRetryable: "JOB_NOT_RETRYABLE",
  jobRetryLimit: "JOB_RETRY_LIMIT",
  jobQueueFull: "JOB_QUEUE_FULL",
  jobExecutorUnavailable: "JOB_EXECUTOR_UNAVAILABLE",
  jobCheckpointInvalid: "JOB_CHECKPOINT_INVALID",
  jobEventGap: "JOB_EVENT_GAP",
  idempotencyConflict: "IDEMPOTENCY_CONFLICT",
  jobShuttingDown: "JOB_SHUTTING_DOWN",
  jobExecutionFailed: "JOB_EXECUTION_FAILED",
  remotionInputInvalid: "REMOTION_INPUT_INVALID",
  remotionSourceInvalid: "REMOTION_SOURCE_INVALID",
  remotionOutputInvalid: "REMOTION_OUTPUT_INVALID",
  remotionRuntimeUnavailable: "REMOTION_RUNTIME_UNAVAILABLE",
  mediaToolUnavailable: "MEDIA_TOOL_UNAVAILABLE",
  mediaToolTimeout: "MEDIA_TOOL_TIMEOUT",
  mediaProbeParseError: "MEDIA_PROBE_PARSE_ERROR",
  mediaNotMedia: "MEDIA_NOT_MEDIA",
  mediaOutputInvalid: "MEDIA_OUTPUT_INVALID",
  mediaCancelled: "MEDIA_CANCELLED",
  transcriptionToolUnavailable: "TRANSCRIPTION_TOOL_UNAVAILABLE",
  transcriptionModelUnavailable: "TRANSCRIPTION_MODEL_UNAVAILABLE",
  transcriptionOutputInvalid: "TRANSCRIPTION_OUTPUT_INVALID",
  transcriptionTimeout: "TRANSCRIPTION_TIMEOUT",
  transcriptionCancelled: "TRANSCRIPTION_CANCELLED",
  vadToolUnavailable: "VAD_TOOL_UNAVAILABLE",
  vadOutputInvalid: "VAD_OUTPUT_INVALID",
  vadTimeout: "VAD_TIMEOUT",
  vadCancelled: "VAD_CANCELLED",
  sentencePrerequisiteUnavailable: "SENTENCE_PREREQUISITE_UNAVAILABLE",
  sentencePrerequisiteInvalid: "SENTENCE_PREREQUISITE_INVALID",
  sentenceOutputInvalid: "SENTENCE_OUTPUT_INVALID",
  sentenceTimeout: "SENTENCE_TIMEOUT",
  sentenceCancelled: "SENTENCE_CANCELLED",
  sentenceQaResultNotFound: "SENTENCE_QA_RESULT_NOT_FOUND",
  sentenceQaResultInvalid: "SENTENCE_QA_RESULT_INVALID",
  sentenceQaIndexInvalid: "SENTENCE_QA_INDEX_INVALID",
  sentenceQaStorageInvalid: "SENTENCE_QA_STORAGE_INVALID",
  sentenceQaOutputInvalid: "SENTENCE_QA_OUTPUT_INVALID",
  sentenceIndexSourceNotFound: "SENTENCE_INDEX_SOURCE_NOT_FOUND",
  sentenceIndexSourceInvalid: "SENTENCE_INDEX_SOURCE_INVALID",
  sentenceIndexSourceStale: "SENTENCE_INDEX_SOURCE_STALE",
  sentenceIndexStorageInvalid: "SENTENCE_INDEX_STORAGE_INVALID",
  sentenceIndexOutputInvalid: "SENTENCE_INDEX_OUTPUT_INVALID",
  sentenceIndexTimeout: "SENTENCE_INDEX_TIMEOUT",
  sentenceIndexCancelled: "SENTENCE_INDEX_CANCELLED",
  retrievalIndexNotFound: "RETRIEVAL_INDEX_NOT_FOUND",
  retrievalIndexInvalid: "RETRIEVAL_INDEX_INVALID",
  retrievalIndexStale: "RETRIEVAL_INDEX_STALE",
  retrievalStorageInvalid: "RETRIEVAL_STORAGE_INVALID",
  retrievalOutputInvalid: "RETRIEVAL_OUTPUT_INVALID",
  retrievalTimeout: "RETRIEVAL_TIMEOUT",
  retrievalCancelled: "RETRIEVAL_CANCELLED",
  rerankRetrievalInvalid: "RERANK_RETRIEVAL_INVALID",
  rerankSourceInvalid: "RERANK_SOURCE_INVALID",
  rerankSourceStale: "RERANK_SOURCE_STALE",
  rerankQaStorageInvalid: "RERANK_QA_STORAGE_INVALID",
  rerankOutputInvalid: "RERANK_OUTPUT_INVALID",
  rerankTimeout: "RERANK_TIMEOUT",
  rerankCancelled: "RERANK_CANCELLED",
  slotInputInvalid: "SLOT_INPUT_INVALID",
  slotSourceInvalid: "SLOT_SOURCE_INVALID",
  slotSourceStale: "SLOT_SOURCE_STALE",
  slotRetrievalInvalid: "SLOT_RETRIEVAL_INVALID",
  slotOutputInvalid: "SLOT_OUTPUT_INVALID",
  slotTimeout: "SLOT_TIMEOUT",
  slotCancelled: "SLOT_CANCELLED",
  planInputInvalid: "PLAN_INPUT_INVALID",
  planSourceInvalid: "PLAN_SOURCE_INVALID",
  planSourceStale: "PLAN_SOURCE_STALE",
  planAlignmentInvalid: "PLAN_ALIGNMENT_INVALID",
  planOutputInvalid: "PLAN_OUTPUT_INVALID",
  planTimeout: "PLAN_TIMEOUT",
  planCancelled: "PLAN_CANCELLED",
  durationOptimizationInputInvalid: "DURATION_OPTIMIZATION_INPUT_INVALID",
  durationOptimizationSourceInvalid: "DURATION_OPTIMIZATION_SOURCE_INVALID",
  durationOptimizationAlignmentInvalid: "DURATION_OPTIMIZATION_ALIGNMENT_INVALID",
  durationOptimizationOutputInvalid: "DURATION_OPTIMIZATION_OUTPUT_INVALID",
  durationOptimizationTimeout: "DURATION_OPTIMIZATION_TIMEOUT",
  durationOptimizationCancelled: "DURATION_OPTIMIZATION_CANCELLED",
  arollCutJoinInputInvalid: "AROLL_CUT_JOIN_INPUT_INVALID",
  arollCutJoinTimelineInvalid: "AROLL_CUT_JOIN_TIMELINE_INVALID",
  arollCutJoinSourceInvalid: "AROLL_CUT_JOIN_SOURCE_INVALID",
  arollCutJoinOutputInvalid: "AROLL_CUT_JOIN_OUTPUT_INVALID",
  arollCutJoinToolUnavailable: "AROLL_CUT_JOIN_TOOL_UNAVAILABLE",
  arollCutJoinToolTimeout: "AROLL_CUT_JOIN_TOOL_TIMEOUT",
  arollCutJoinTimeout: "AROLL_CUT_JOIN_TIMEOUT",
  arollCutJoinCancelled: "AROLL_CUT_JOIN_CANCELLED",
  subtitleInputInvalid: "SUBTITLE_INPUT_INVALID",
  subtitleTimelineInvalid: "SUBTITLE_TIMELINE_INVALID",
  subtitleSourceInvalid: "SUBTITLE_SOURCE_INVALID",
  subtitleTimecodeInvalid: "SUBTITLE_TIMECODE_INVALID",
  subtitleOverlap: "SUBTITLE_OVERLAP",
  subtitleTextInvalid: "SUBTITLE_TEXT_INVALID",
  subtitleLineCountInvalid: "SUBTITLE_LINE_COUNT_INVALID",
  subtitleLineWidthInvalid: "SUBTITLE_LINE_WIDTH_INVALID",
  subtitleOutputInvalid: "SUBTITLE_OUTPUT_INVALID",
  subtitleTimeout: "SUBTITLE_TIMEOUT",
  subtitleCancelled: "SUBTITLE_CANCELLED",
  previewRenderInputInvalid: "PREVIEW_RENDER_INPUT_INVALID",
  previewRenderSourceInvalid: "PREVIEW_RENDER_SOURCE_INVALID",
  previewRenderSubtitleInvalid: "PREVIEW_RENDER_SUBTITLE_INVALID",
  previewRenderOutputInvalid: "PREVIEW_RENDER_OUTPUT_INVALID",
  previewRenderToolUnavailable: "PREVIEW_RENDER_TOOL_UNAVAILABLE",
  previewRenderToolTimeout: "PREVIEW_RENDER_TOOL_TIMEOUT",
  previewRenderTimeout: "PREVIEW_RENDER_TIMEOUT",
  previewRenderCancelled: "PREVIEW_RENDER_CANCELLED",
  previewQualityInputInvalid: "PREVIEW_QUALITY_INPUT_INVALID",
  previewQualityOutputInvalid: "PREVIEW_QUALITY_OUTPUT_INVALID",
  previewQualityTimeout: "PREVIEW_QUALITY_TIMEOUT",
  previewQualityCancelled: "PREVIEW_QUALITY_CANCELLED",
  finalExportInputInvalid: "FINAL_EXPORT_INPUT_INVALID",
  finalExportPreviewNotReady: "FINAL_EXPORT_PREVIEW_NOT_READY",
  finalExportAudioNotReady: "FINAL_EXPORT_AUDIO_NOT_READY",
  finalExportAudioInvalid: "FINAL_EXPORT_AUDIO_INVALID",
  finalExportAudioTampered: "FINAL_EXPORT_AUDIO_TAMPERED",
  finalExportQualityNotReady: "FINAL_EXPORT_QUALITY_NOT_READY",
  finalExportSourceInvalid: "FINAL_EXPORT_SOURCE_INVALID",
  finalExportSourceTampered: "FINAL_EXPORT_SOURCE_TAMPERED",
  finalExportOutputInvalid: "FINAL_EXPORT_OUTPUT_INVALID",
  finalExportOutputConflict: "FINAL_EXPORT_OUTPUT_CONFLICT",
  finalExportContainerInvalid: "FINAL_EXPORT_CONTAINER_INVALID",
  finalExportToolUnavailable: "FINAL_EXPORT_TOOL_UNAVAILABLE",
  finalExportTimeout: "FINAL_EXPORT_TIMEOUT",
  finalExportCancelled: "FINAL_EXPORT_CANCELLED",
  editUnsupportedInstruction: "EDIT_UNSUPPORTED_INSTRUCTION",
  editTargetNotFound: "EDIT_TARGET_NOT_FOUND",
  editAmbiguousTarget: "EDIT_AMBIGUOUS_TARGET",
  editReplacementNotFound: "EDIT_REPLACEMENT_NOT_FOUND",
  editCompleteSentenceRequired: "EDIT_COMPLETE_SENTENCE_REQUIRED",
  editTimelineEmpty: "EDIT_TIMELINE_EMPTY",
  editOperationUnsafe: "EDIT_OPERATION_UNSAFE",
  editTimelineInvalid: "EDIT_TIMELINE_INVALID",
  timelineVersionNotFound: "TIMELINE_VERSION_NOT_FOUND",
  timelineVersionProjectMismatch: "TIMELINE_VERSION_PROJECT_MISMATCH",
  timelineActiveVersionMissing: "TIMELINE_ACTIVE_VERSION_MISSING",
  timelineNoUndo: "TIMELINE_NO_UNDO",
  timelineNoRedo: "TIMELINE_NO_REDO",
  timelineRedoAmbiguous: "TIMELINE_REDO_AMBIGUOUS",
  timelineVersionConflict: "TIMELINE_VERSION_CONFLICT",
  timelineVersionInvalid: "TIMELINE_VERSION_INVALID",
  timelineDiffNotAvailable: "TIMELINE_DIFF_NOT_AVAILABLE",
} as const;

export type CoreRpcErrorCode = (typeof CORE_RPC_ERROR_CODES)[keyof typeof CORE_RPC_ERROR_CODES];

export const CORE_RPC_ERROR_NUMBERS: Readonly<Record<CoreRpcErrorCode, number>> = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  MESSAGE_TOO_LARGE: -32001,
  PROTOCOL_MISMATCH: -32002,
  DUPLICATE_REQUEST_ID: -32003,
  BUSY: -32004,
  REQUEST_CANCELLED: -32005,
  TRANSPORT_CLOSED: -32006,
  REQUEST_TIMEOUT: -32007,
  PYTHON_NOT_FOUND: -32008,
  PROTOCOL_ERROR: -32009,
  DIALOG_CANCELLED: -32100,
  INVALID_PROJECT_NAME: -32101,
  INVALID_PROJECT_ROOT: -32102,
  UNSUPPORTED_PROJECT_LOCATION: -32103,
  PROJECT_DIRECTORY_NOT_EMPTY: -32104,
  PROJECT_ALREADY_EXISTS: -32105,
  PROJECT_NOT_FOUND: -32106,
  PROJECT_MANIFEST_INVALID: -32107,
  PROJECT_SCHEMA_TOO_NEW: -32108,
  PROJECT_DATABASE_MISSING: -32109,
  PROJECT_ID_MISMATCH: -32110,
  PROJECT_PATH_CONFLICT: -32111,
  PROJECT_NOT_ACTIVE: -32112,
  ASSET_NOT_FOUND: -32113,
  UNSUPPORTED_ASSET_TYPE: -32114,
  TOO_MANY_ASSETS: -32115,
  ASSET_CHANGED: -32116,
  ASSET_CHANGED_DURING_REFERENCE: -32117,
  FILE_ACCESS_DENIED: -32118,
  OPERATION_TIMEOUT: -32119,
  CORE_UNAVAILABLE: -32120,
  DATABASE_OPEN_FAILED: -32121,
  DATABASE_READ_ONLY: -32122,
  DATABASE_BUSY: -32123,
  DATABASE_CORRUPT: -32124,
  MIGRATION_FAILED: -32125,
  MIGRATION_CHECKSUM_MISMATCH: -32126,
  SCHEMA_TOO_NEW: -32127,
  CONSTRAINT_VIOLATION: -32128,
  RECORD_NOT_FOUND: -32129,
  INVALID_RECORD: -32130,
  JOB_NOT_FOUND: -32200,
  JOB_STATE_CONFLICT: -32201,
  JOB_NOT_CANCELLABLE: -32202,
  JOB_NOT_RETRYABLE: -32203,
  JOB_RETRY_LIMIT: -32204,
  JOB_QUEUE_FULL: -32205,
  JOB_EXECUTOR_UNAVAILABLE: -32206,
  JOB_CHECKPOINT_INVALID: -32207,
  JOB_EVENT_GAP: -32208,
  IDEMPOTENCY_CONFLICT: -32209,
  JOB_SHUTTING_DOWN: -32210,
  JOB_EXECUTION_FAILED: -32211,
  REMOTION_INPUT_INVALID: -32440,
  REMOTION_SOURCE_INVALID: -32441,
  REMOTION_OUTPUT_INVALID: -32442,
  REMOTION_RUNTIME_UNAVAILABLE: -32443,
  MEDIA_TOOL_UNAVAILABLE: -32300,
  MEDIA_TOOL_TIMEOUT: -32301,
  MEDIA_PROBE_PARSE_ERROR: -32302,
  MEDIA_NOT_MEDIA: -32303,
  MEDIA_OUTPUT_INVALID: -32304,
  MEDIA_CANCELLED: -32305,
  TRANSCRIPTION_TOOL_UNAVAILABLE: -32306,
  TRANSCRIPTION_MODEL_UNAVAILABLE: -32307,
  TRANSCRIPTION_OUTPUT_INVALID: -32308,
  TRANSCRIPTION_TIMEOUT: -32309,
  TRANSCRIPTION_CANCELLED: -32310,
  VAD_TOOL_UNAVAILABLE: -32311,
  VAD_OUTPUT_INVALID: -32312,
  VAD_TIMEOUT: -32313,
  VAD_CANCELLED: -32314,
  SENTENCE_PREREQUISITE_UNAVAILABLE: -32315,
  SENTENCE_PREREQUISITE_INVALID: -32316,
  SENTENCE_OUTPUT_INVALID: -32317,
  SENTENCE_TIMEOUT: -32318,
  SENTENCE_CANCELLED: -32319,
  SENTENCE_QA_RESULT_NOT_FOUND: -32320,
  SENTENCE_QA_RESULT_INVALID: -32321,
  SENTENCE_QA_INDEX_INVALID: -32322,
  SENTENCE_QA_STORAGE_INVALID: -32323,
  SENTENCE_QA_OUTPUT_INVALID: -32324,
  SENTENCE_INDEX_SOURCE_NOT_FOUND: -32325,
  SENTENCE_INDEX_SOURCE_INVALID: -32326,
  SENTENCE_INDEX_SOURCE_STALE: -32327,
  SENTENCE_INDEX_STORAGE_INVALID: -32328,
  SENTENCE_INDEX_OUTPUT_INVALID: -32329,
  SENTENCE_INDEX_TIMEOUT: -32330,
  SENTENCE_INDEX_CANCELLED: -32331,
  RETRIEVAL_INDEX_NOT_FOUND: -32332,
  RETRIEVAL_INDEX_INVALID: -32333,
  RETRIEVAL_INDEX_STALE: -32334,
  RETRIEVAL_STORAGE_INVALID: -32335,
  RETRIEVAL_OUTPUT_INVALID: -32336,
  RETRIEVAL_TIMEOUT: -32337,
  RETRIEVAL_CANCELLED: -32338,
  RERANK_RETRIEVAL_INVALID: -32339,
  RERANK_SOURCE_INVALID: -32340,
  RERANK_SOURCE_STALE: -32341,
  RERANK_QA_STORAGE_INVALID: -32342,
  RERANK_OUTPUT_INVALID: -32343,
  RERANK_TIMEOUT: -32344,
  RERANK_CANCELLED: -32345,
  SLOT_INPUT_INVALID: -32346,
  SLOT_SOURCE_INVALID: -32347,
  SLOT_SOURCE_STALE: -32348,
  SLOT_RETRIEVAL_INVALID: -32349,
  SLOT_OUTPUT_INVALID: -32350,
  SLOT_TIMEOUT: -32351,
  SLOT_CANCELLED: -32352,
  PLAN_INPUT_INVALID: -32353,
  PLAN_SOURCE_INVALID: -32354,
  PLAN_SOURCE_STALE: -32355,
  PLAN_ALIGNMENT_INVALID: -32356,
  PLAN_OUTPUT_INVALID: -32357,
  PLAN_TIMEOUT: -32358,
  PLAN_CANCELLED: -32359,
  DURATION_OPTIMIZATION_INPUT_INVALID: -32360,
  DURATION_OPTIMIZATION_SOURCE_INVALID: -32361,
  DURATION_OPTIMIZATION_ALIGNMENT_INVALID: -32362,
  DURATION_OPTIMIZATION_OUTPUT_INVALID: -32363,
  DURATION_OPTIMIZATION_TIMEOUT: -32364,
  DURATION_OPTIMIZATION_CANCELLED: -32365,
  AROLL_CUT_JOIN_INPUT_INVALID: -32366,
  AROLL_CUT_JOIN_TIMELINE_INVALID: -32367,
  AROLL_CUT_JOIN_SOURCE_INVALID: -32368,
  AROLL_CUT_JOIN_OUTPUT_INVALID: -32369,
  AROLL_CUT_JOIN_TOOL_UNAVAILABLE: -32370,
  AROLL_CUT_JOIN_TOOL_TIMEOUT: -32371,
  AROLL_CUT_JOIN_CANCELLED: -32372,
  AROLL_CUT_JOIN_TIMEOUT: -32373,
  SUBTITLE_INPUT_INVALID: -32374,
  SUBTITLE_TIMELINE_INVALID: -32375,
  SUBTITLE_SOURCE_INVALID: -32376,
  SUBTITLE_TIMECODE_INVALID: -32377,
  SUBTITLE_OVERLAP: -32378,
  SUBTITLE_TEXT_INVALID: -32379,
  SUBTITLE_LINE_COUNT_INVALID: -32380,
  SUBTITLE_LINE_WIDTH_INVALID: -32381,
  SUBTITLE_OUTPUT_INVALID: -32382,
  SUBTITLE_TIMEOUT: -32383,
  SUBTITLE_CANCELLED: -32384,
  PREVIEW_RENDER_INPUT_INVALID: -32385,
  PREVIEW_RENDER_SOURCE_INVALID: -32386,
  PREVIEW_RENDER_SUBTITLE_INVALID: -32387,
  PREVIEW_RENDER_OUTPUT_INVALID: -32388,
  PREVIEW_RENDER_TOOL_UNAVAILABLE: -32389,
  PREVIEW_RENDER_TOOL_TIMEOUT: -32390,
  PREVIEW_RENDER_TIMEOUT: -32391,
  PREVIEW_RENDER_CANCELLED: -32392,
  PREVIEW_QUALITY_INPUT_INVALID: -32393,
  PREVIEW_QUALITY_OUTPUT_INVALID: -32394,
  PREVIEW_QUALITY_TIMEOUT: -32395,
  PREVIEW_QUALITY_CANCELLED: -32396,
  FINAL_EXPORT_INPUT_INVALID: -32397,
  FINAL_EXPORT_PREVIEW_NOT_READY: -32398,
  FINAL_EXPORT_AUDIO_NOT_READY: -32408,
  FINAL_EXPORT_AUDIO_INVALID: -32409,
  FINAL_EXPORT_AUDIO_TAMPERED: -32410,
  FINAL_EXPORT_QUALITY_NOT_READY: -32399,
  FINAL_EXPORT_SOURCE_INVALID: -32400,
  FINAL_EXPORT_SOURCE_TAMPERED: -32401,
  FINAL_EXPORT_OUTPUT_INVALID: -32402,
  FINAL_EXPORT_OUTPUT_CONFLICT: -32403,
  FINAL_EXPORT_CONTAINER_INVALID: -32404,
  FINAL_EXPORT_TOOL_UNAVAILABLE: -32405,
  FINAL_EXPORT_TIMEOUT: -32406,
  FINAL_EXPORT_CANCELLED: -32407,
  EDIT_UNSUPPORTED_INSTRUCTION: -32420,
  EDIT_TARGET_NOT_FOUND: -32421,
  EDIT_AMBIGUOUS_TARGET: -32422,
  EDIT_REPLACEMENT_NOT_FOUND: -32423,
  EDIT_COMPLETE_SENTENCE_REQUIRED: -32424,
  EDIT_TIMELINE_EMPTY: -32425,
  EDIT_OPERATION_UNSAFE: -32426,
  EDIT_TIMELINE_INVALID: -32427,
  TIMELINE_VERSION_NOT_FOUND: -32430,
  TIMELINE_VERSION_PROJECT_MISMATCH: -32431,
  TIMELINE_ACTIVE_VERSION_MISSING: -32432,
  TIMELINE_NO_UNDO: -32433,
  TIMELINE_NO_REDO: -32434,
  TIMELINE_REDO_AMBIGUOUS: -32435,
  TIMELINE_VERSION_CONFLICT: -32436,
  TIMELINE_VERSION_INVALID: -32437,
  TIMELINE_DIFF_NOT_AVAILABLE: -32438,
};

export const CORE_RPC_ERROR_MESSAGES: Readonly<Record<CoreRpcErrorCode, string>> = {
  PARSE_ERROR: "Parse error.",
  INVALID_REQUEST: "Invalid request.",
  METHOD_NOT_FOUND: "Method not found.",
  INVALID_PARAMS: "Invalid params.",
  INTERNAL_ERROR: "Internal error.",
  MESSAGE_TOO_LARGE: "Message too large.",
  PROTOCOL_MISMATCH: "Protocol mismatch.",
  DUPLICATE_REQUEST_ID: "Duplicate request ID.",
  BUSY: "Core is busy.",
  REQUEST_CANCELLED: "Request cancelled.",
  REQUEST_TIMEOUT: "Request timed out.",
  TRANSPORT_CLOSED: "Core transport closed.",
  PYTHON_NOT_FOUND: "Python Core could not be started.",
  PROTOCOL_ERROR: "Core protocol error.",
  DIALOG_CANCELLED: "The dialog was cancelled.",
  INVALID_PROJECT_NAME: "The project name is invalid.",
  INVALID_PROJECT_ROOT: "The project location is invalid.",
  UNSUPPORTED_PROJECT_LOCATION: "The project location is not supported.",
  PROJECT_DIRECTORY_NOT_EMPTY: "The project directory is not empty.",
  PROJECT_ALREADY_EXISTS: "A SuperVideo project already exists there.",
  PROJECT_NOT_FOUND: "The project was not found.",
  PROJECT_MANIFEST_INVALID: "The project manifest is invalid.",
  PROJECT_SCHEMA_TOO_NEW: "The project schema is newer than supported.",
  PROJECT_DATABASE_MISSING: "The project database is missing.",
  PROJECT_ID_MISMATCH: "The project identity does not match.",
  PROJECT_PATH_CONFLICT: "The project location conflicts with another project.",
  PROJECT_NOT_ACTIVE: "No project is currently active.",
  ASSET_NOT_FOUND: "The asset was not found.",
  UNSUPPORTED_ASSET_TYPE: "The asset type is not supported.",
  TOO_MANY_ASSETS: "Too many assets were selected.",
  ASSET_CHANGED: "The asset has changed since it was referenced.",
  ASSET_CHANGED_DURING_REFERENCE: "The asset changed while it was being referenced.",
  FILE_ACCESS_DENIED: "The selected file could not be accessed.",
  OPERATION_TIMEOUT: "The project operation timed out.",
  CORE_UNAVAILABLE: "The Python Core is unavailable.",
  DATABASE_OPEN_FAILED: "Database could not be opened.",
  DATABASE_READ_ONLY: "Database is read-only.",
  DATABASE_BUSY: "Database is busy.",
  DATABASE_CORRUPT: "Database is corrupt.",
  MIGRATION_FAILED: "Database migration failed.",
  MIGRATION_CHECKSUM_MISMATCH: "Database migration checksum mismatch.",
  SCHEMA_TOO_NEW: "Database schema is newer than supported.",
  CONSTRAINT_VIOLATION: "Storage constraint was violated.",
  RECORD_NOT_FOUND: "Storage record was not found.",
  INVALID_RECORD: "Storage record is invalid.",
  JOB_NOT_FOUND: "The job was not found.",
  JOB_STATE_CONFLICT: "The job state changed concurrently.",
  JOB_NOT_CANCELLABLE: "The job cannot be cancelled.",
  JOB_NOT_RETRYABLE: "The job cannot be retried.",
  JOB_RETRY_LIMIT: "The job retry limit was reached.",
  JOB_QUEUE_FULL: "The job queue is full.",
  JOB_EXECUTOR_UNAVAILABLE: "The job executor is unavailable.",
  JOB_CHECKPOINT_INVALID: "The job checkpoint is invalid.",
  JOB_EVENT_GAP: "The job event sequence has a gap.",
  IDEMPOTENCY_CONFLICT: "The idempotency key conflicts with another job.",
  JOB_SHUTTING_DOWN: "The job service is shutting down.",
  JOB_EXECUTION_FAILED: "The simulated job failed.",
  REMOTION_INPUT_INVALID: "The Remotion render input is invalid.",
  REMOTION_SOURCE_INVALID: "The Remotion source reference is invalid.",
  REMOTION_OUTPUT_INVALID: "The Remotion render output is invalid.",
  REMOTION_RUNTIME_UNAVAILABLE: "The fixed Remotion runtime is unavailable.",
  MEDIA_TOOL_UNAVAILABLE: "The configured media tool is unavailable.",
  MEDIA_TOOL_TIMEOUT: "The media tool timed out.",
  MEDIA_PROBE_PARSE_ERROR: "The media probe output was invalid.",
  MEDIA_NOT_MEDIA: "The selected asset is not a valid media file.",
  MEDIA_OUTPUT_INVALID: "The generated media output was invalid.",
  MEDIA_CANCELLED: "The media operation was cancelled.",
  TRANSCRIPTION_TOOL_UNAVAILABLE: "The local transcription tool is unavailable.",
  TRANSCRIPTION_MODEL_UNAVAILABLE: "The local transcription model is unavailable.",
  TRANSCRIPTION_OUTPUT_INVALID: "The local transcription output was invalid.",
  TRANSCRIPTION_TIMEOUT: "The local transcription timed out.",
  TRANSCRIPTION_CANCELLED: "The local transcription was cancelled.",
  VAD_TOOL_UNAVAILABLE: "The local VAD backend is unavailable.",
  VAD_OUTPUT_INVALID: "The local VAD output was invalid.",
  VAD_TIMEOUT: "The local VAD timed out.",
  VAD_CANCELLED: "The local VAD operation was cancelled.",
  SENTENCE_PREREQUISITE_UNAVAILABLE: "The transcription or speech interval result is unavailable.",
  SENTENCE_PREREQUISITE_INVALID: "The transcription or speech interval result is invalid.",
  SENTENCE_OUTPUT_INVALID: "The sentence segmentation output was invalid.",
  SENTENCE_TIMEOUT: "The sentence segmentation timed out.",
  SENTENCE_CANCELLED: "The sentence segmentation was cancelled.",
  SENTENCE_QA_RESULT_NOT_FOUND: "The requested B05 sentence result is unavailable.",
  SENTENCE_QA_RESULT_INVALID: "The requested B05 sentence result is invalid.",
  SENTENCE_QA_INDEX_INVALID: "The requested sentence index is invalid.",
  SENTENCE_QA_STORAGE_INVALID: "The saved sentence QA markers are invalid.",
  SENTENCE_QA_OUTPUT_INVALID: "The sentence QA output was invalid.",
  SENTENCE_INDEX_SOURCE_NOT_FOUND: "The requested B05 sentence result is unavailable for indexing.",
  SENTENCE_INDEX_SOURCE_INVALID: "The requested B05 sentence result is invalid for indexing.",
  SENTENCE_INDEX_SOURCE_STALE: "The requested B05 sentence result is stale for the referenced asset.",
  SENTENCE_INDEX_STORAGE_INVALID: "The sentence index storage is invalid.",
  SENTENCE_INDEX_OUTPUT_INVALID: "The sentence index output was invalid.",
  SENTENCE_INDEX_TIMEOUT: "The sentence index operation timed out.",
  SENTENCE_INDEX_CANCELLED: "The sentence index operation was cancelled.",
  RETRIEVAL_INDEX_NOT_FOUND: "A valid sentence index is unavailable for retrieval.",
  RETRIEVAL_INDEX_INVALID: "The sentence index is invalid for retrieval.",
  RETRIEVAL_INDEX_STALE: "The sentence index is stale for the referenced asset.",
  RETRIEVAL_STORAGE_INVALID: "The sentence retrieval storage is invalid.",
  RETRIEVAL_OUTPUT_INVALID: "The sentence retrieval output was invalid.",
  RETRIEVAL_TIMEOUT: "The sentence retrieval operation timed out.",
  RETRIEVAL_CANCELLED: "The sentence retrieval operation was cancelled.",
  RERANK_RETRIEVAL_INVALID: "The B08 retrieval result is invalid for reranking.",
  RERANK_SOURCE_INVALID: "The B05/B07 source is invalid for reranking.",
  RERANK_SOURCE_STALE: "The B05/B07 source is stale for reranking.",
  RERANK_QA_STORAGE_INVALID: "The B06 sentence QA storage is invalid.",
  RERANK_OUTPUT_INVALID: "The sentence reranking output was invalid.",
  RERANK_TIMEOUT: "The sentence reranking operation timed out.",
  RERANK_CANCELLED: "The sentence reranking operation was cancelled.",
  SLOT_INPUT_INVALID: "The information-slot input is invalid or exceeds its bounds.",
  SLOT_SOURCE_INVALID: "The B08/B09 source is invalid for slot alignment.",
  SLOT_SOURCE_STALE: "The B08/B09 source is stale for slot alignment.",
  SLOT_RETRIEVAL_INVALID: "The B08/B09 retrieval result is invalid for slot alignment.",
  SLOT_OUTPUT_INVALID: "The information-slot alignment output was invalid.",
  SLOT_TIMEOUT: "The information-slot alignment operation timed out.",
  SLOT_CANCELLED: "The information-slot alignment operation was cancelled.",
  PLAN_INPUT_INVALID: "The narrative plan input is invalid or exceeds its bounds.",
  PLAN_SOURCE_INVALID: "The B10 source is invalid for narrative planning.",
  PLAN_SOURCE_STALE: "The B10 source is stale for narrative planning.",
  PLAN_ALIGNMENT_INVALID: "The B10 alignment result is invalid for narrative planning.",
  PLAN_OUTPUT_INVALID: "The narrative plan output was invalid.",
  PLAN_TIMEOUT: "The narrative planning operation timed out.",
  PLAN_CANCELLED: "The narrative planning operation was cancelled.",
  DURATION_OPTIMIZATION_INPUT_INVALID: "The duration optimization input is invalid or exceeds its bounds.",
  DURATION_OPTIMIZATION_SOURCE_INVALID: "The C02 source plan is invalid for duration optimization.",
  DURATION_OPTIMIZATION_ALIGNMENT_INVALID: "The B10 candidate pool is invalid for duration optimization.",
  DURATION_OPTIMIZATION_OUTPUT_INVALID: "The duration optimization output was invalid.",
  DURATION_OPTIMIZATION_TIMEOUT: "The duration optimization operation timed out.",
  DURATION_OPTIMIZATION_CANCELLED: "The duration optimization operation was cancelled.",
  AROLL_CUT_JOIN_INPUT_INVALID: "The A-roll cut/join input is invalid or exceeds its bounds.",
  AROLL_CUT_JOIN_TIMELINE_INVALID: "The Timeline IR is invalid for A-roll cut/join.",
  AROLL_CUT_JOIN_SOURCE_INVALID: "An A-roll source reference is invalid or stale.",
  AROLL_CUT_JOIN_OUTPUT_INVALID: "The A-roll cut/join plan or output was invalid.",
  AROLL_CUT_JOIN_TOOL_UNAVAILABLE: "The configured A-roll media tool is unavailable.",
  AROLL_CUT_JOIN_TOOL_TIMEOUT: "The A-roll media tool timed out.",
  AROLL_CUT_JOIN_CANCELLED: "The A-roll cut/join operation was cancelled.",
  AROLL_CUT_JOIN_TIMEOUT: "The A-roll cut/join operation timed out.",
  SUBTITLE_INPUT_INVALID: "The subtitle plan input is invalid or exceeds its bounds.",
  SUBTITLE_TIMELINE_INVALID: "The Timeline IR is invalid for subtitle planning.",
  SUBTITLE_SOURCE_INVALID: "A subtitle source reference is invalid.",
  SUBTITLE_TIMECODE_INVALID: "A subtitle timecode is invalid or outside the timeline.",
  SUBTITLE_OVERLAP: "Subtitle cues overlap in timeline order.",
  SUBTITLE_TEXT_INVALID: "Subtitle text is invalid or exceeds its bounds.",
  SUBTITLE_LINE_COUNT_INVALID: "Subtitle text exceeds the configured line count.",
  SUBTITLE_LINE_WIDTH_INVALID: "Subtitle text exceeds the configured display width.",
  SUBTITLE_OUTPUT_INVALID: "The generated subtitle plan was invalid.",
  SUBTITLE_TIMEOUT: "The subtitle planning operation timed out.",
  SUBTITLE_CANCELLED: "The subtitle planning operation was cancelled.",
  PREVIEW_RENDER_INPUT_INVALID: "The preview render input is invalid or exceeds its bounds.",
  PREVIEW_RENDER_SOURCE_INVALID: "The preview source is invalid, stale, or outside the preview boundary.",
  PREVIEW_RENDER_SUBTITLE_INVALID: "The subtitle plan cannot be bound to the preview timeline.",
  PREVIEW_RENDER_OUTPUT_INVALID: "The generated preview output was invalid.",
  PREVIEW_RENDER_TOOL_UNAVAILABLE: "The configured preview media tool is unavailable.",
  PREVIEW_RENDER_TOOL_TIMEOUT: "The preview media tool timed out.",
  PREVIEW_RENDER_TIMEOUT: "The preview render operation timed out.",
  PREVIEW_RENDER_CANCELLED: "The preview render operation was cancelled.",
  PREVIEW_QUALITY_INPUT_INVALID: "The preview quality-check input is invalid.",
  PREVIEW_QUALITY_OUTPUT_INVALID: "The preview quality-check result was invalid.",
  PREVIEW_QUALITY_TIMEOUT: "The preview quality check timed out.",
  PREVIEW_QUALITY_CANCELLED: "The preview quality check was cancelled.",
  FINAL_EXPORT_INPUT_INVALID: "The final export input is invalid or does not bind to the verified preview.",
  FINAL_EXPORT_PREVIEW_NOT_READY: "The preview has not completed successfully and cannot be exported.",
  FINAL_EXPORT_AUDIO_NOT_READY: "The C04 audio result has not completed successfully and cannot be muxed.",
  FINAL_EXPORT_AUDIO_INVALID: "The C04 audio output is not a verified AAC stream of the expected duration.",
  FINAL_EXPORT_AUDIO_TAMPERED: "The C04 audio output changed or does not match its recorded fingerprint.",
  FINAL_EXPORT_QUALITY_NOT_READY: "The preview quality gate is not ready for final export.",
  FINAL_EXPORT_SOURCE_INVALID: "The verified preview source is missing or outside the project boundary.",
  FINAL_EXPORT_SOURCE_TAMPERED: "The verified preview source changed or does not match its recorded fingerprint.",
  FINAL_EXPORT_OUTPUT_INVALID: "The final MP4 output or manifest was invalid.",
  FINAL_EXPORT_OUTPUT_CONFLICT: "The requested final export path already contains a different output.",
  FINAL_EXPORT_CONTAINER_INVALID: "The final MP4 container or media streams could not be verified.",
  FINAL_EXPORT_TOOL_UNAVAILABLE: "The final export media verification tool is unavailable.",
  FINAL_EXPORT_TIMEOUT: "The final MP4 export timed out.",
  FINAL_EXPORT_CANCELLED: "The final MP4 export was cancelled.",
  EDIT_UNSUPPORTED_INSTRUCTION: "The edit instruction is not a supported deterministic C09 template.",
  EDIT_TARGET_NOT_FOUND: "The C09 edit target was not found.",
  EDIT_AMBIGUOUS_TARGET: "The C09 edit target is ambiguous.",
  EDIT_REPLACEMENT_NOT_FOUND: "The C09 replacement clip was not found.",
  EDIT_COMPLETE_SENTENCE_REQUIRED: "The requested edit would violate the complete-sentence constraint.",
  EDIT_TIMELINE_EMPTY: "The edit would produce an empty Timeline IR.",
  EDIT_OPERATION_UNSAFE: "The requested edit cannot be applied without guessing or losing source fidelity.",
  EDIT_TIMELINE_INVALID: "The edited Timeline IR failed validation.",
  TIMELINE_VERSION_NOT_FOUND: "The requested Timeline version was not found.",
  TIMELINE_VERSION_PROJECT_MISMATCH: "The Timeline version does not belong to the requested project.",
  TIMELINE_ACTIVE_VERSION_MISSING: "The project has no active Timeline version.",
  TIMELINE_NO_UNDO: "There is no previous Timeline version to undo to.",
  TIMELINE_NO_REDO: "There is no next Timeline version to redo to.",
  TIMELINE_REDO_AMBIGUOUS: "Redo has multiple child versions; choose a version explicitly.",
  TIMELINE_VERSION_CONFLICT: "The active Timeline version changed concurrently.",
  TIMELINE_VERSION_INVALID: "The Timeline version request is invalid.",
  TIMELINE_DIFF_NOT_AVAILABLE: "The requested Timeline diff is not available.",
};

export type CoreRpcId = string;

export type CoreHealth = Readonly<{
  service: "python-core";
  status: "ok";
  protocolVersion: typeof CORE_RPC_PROTOCOL_VERSION;
  coreVersion: string;
  capabilities: readonly string[];
}>;

export type CoreSmokeCountdownParams = Readonly<{ steps: number; delayMs: number }>;
export type CoreSmokeCountdownResult = Readonly<{ status: "completed"; steps: number }>;
export type ProjectCreateParams = Readonly<{ name: string; targetPlatform: string; projectRoot: string }>;
export type ProjectOpenParams = Readonly<{ projectRoot: string }>;
export type ProjectSummary = Readonly<{
  projectId: string;
  name: string;
  targetPlatform: string;
  projectRoot: string;
  manifestSchemaVersion: number;
  databaseSchemaVersion: number;
  assetCount: number;
  createdAtMs: number;
  updatedAtMs: number;
}>;
export type AssetReferenceParams = Readonly<{ projectId: string; paths: readonly string[] }>;
export type AssetScanParams = Readonly<{ projectId: string; directory: string }>;
export type AssetListParams = Readonly<{ projectId: string; limit: number }>;
export type JobSmokeStartParams = Readonly<{ projectId: string; idempotencyKey: string; steps?: number; delayMs?: number; failAttempts?: number }>;
export type { RemotionRenderParams, RemotionRenderResult } from "./remotion-contract";
export type { ImageJobStartParams, ImageGenerationResult } from "./image-contract";
export type JobReferenceParams = Readonly<{ projectId: string; jobId: string }>;
export type JobListParams = Readonly<{ projectId: string; statuses?: readonly JobStatus[]; cursor?: string | null; limit?: number }>;
export type JobEventsListParams = Readonly<{ projectId: string; jobId: string; afterSequence?: number; cursor?: string | null; limit?: number }>;
export type JobSummary = Readonly<{
  jobId: string; projectId: string; jobType: "smoke.countdown" | "tts.synthesize" | "remotion.render" | "image.generate"; status: JobStatus; progress: number;
  stage: string | null; attempt: number; revision: number; lastEventSequence: number;
  createdAtMs: number; updatedAtMs: number; startedAtMs: number | null; finishedAtMs: number | null; errorCode: string | null;
}>;
export type JobEvent = Readonly<{
  projectId: string; jobId: string; sequence: number; eventType: string; status: JobStatus;
  progress: number; stage: string | null; attempt: number; timestamp: number; payload: unknown;
}>;
export type JobPage = Readonly<{ projectId: string; items: readonly JobSummary[]; nextCursor: string | null; hasMore: boolean }>;
export type JobEventPage = Readonly<{ projectId: string; jobId: string; items: readonly JobEvent[]; nextCursor: string | null; hasMore: boolean }>;
export type AssetSummary = Readonly<{
  assetId: string;
  projectId: string;
  fileName: string;
  absolutePath: string;
  kind: string;
  sizeBytes: number;
  modifiedAtMs: number;
  fingerprintAlgorithm: string;
  referenceStatus: "added" | "existing";
}>;
export type AssetReferenceBatchResult = Readonly<{ projectId: string; items: readonly AssetSummary[] }>;
export type AssetScanResult = Readonly<{ projectId: string; directory: string; items: readonly AssetSummary[] }>;
export type AssetListResult = Readonly<{ projectId: string; items: readonly AssetSummary[] }>;
export type MediaParams = Readonly<{ projectId: string; assetId: string; timeoutMs?: number }>;
export type TranscriptionParams = MediaParams;
export type EditOperation = "delete" | "replace" | "move-forward" | "move-backward" | "shorten" | "extend" | "subtitle" | "cta";
export type EditIntent = Readonly<{
  schemaVersion: 1; editVersion: "edit-intent-v1"; policy: "deterministic-natural-language-v1";
  operation: EditOperation; targetClipId?: string; targetSentenceId?: string; targetText?: string;
  replacementClipId?: string; text?: string; amountMs?: number;
}>;
export type TimelineEditParams = Readonly<{
  schemaVersion: 1; editVersion: "timeline-edit-v1"; policy: "deterministic-natural-language-v1";
  projectId: string; timeline: TimelineProject; instruction?: string; intent?: EditIntent; timeoutMs?: number;
}>;
export type TimelineEditDiff = Readonly<{
  changedClipIds: readonly string[]; removedClipIds: readonly string[]; movedClipIds: readonly string[];
  durationDeltaMs: number; summary: string; preservedSourceIds: readonly string[]; preservedProvenanceIds: readonly string[];
}>;
export type TimelineEditResult = Readonly<{
  schemaVersion: 1; editVersion: "timeline-edit-v1"; policy: "deterministic-natural-language-v1"; projectId: string;
  inputKind: "natural-language" | "structured"; status: "applied" | "rejected"; sourceTimelineId: string;
  resultTimeline: TimelineProject; intent: EditIntent; diff: TimelineEditDiff;
  rejection: Readonly<{ code: string; message: string; targetClipId?: string }> | null; determinismDigest: string;
}>;
export type TimelineVersionContract = Readonly<{ schemaVersion: 1; versioningVersion: "timeline-version-v1" }>;
export type TimelineVersionCreateParams = TimelineVersionContract & Readonly<{ projectId: string; timeline: TimelineProject; expectedActiveVersionId?: string; idempotencyKey?: string }>;
export type TimelineVersionListParams = TimelineVersionContract & Readonly<{ projectId: string; limit?: number }>;
export type TimelineVersionReferenceParams = TimelineVersionContract & Readonly<{ projectId: string; versionId: string }>;
export type TimelineVersionActivateParams = TimelineVersionReferenceParams & Readonly<{ expectedActiveVersionId?: string }>;
export type TimelineVersionUndoParams = TimelineVersionContract & Readonly<{ projectId: string; expectedActiveVersionId?: string }>;
export type TimelineVersionRedoParams = TimelineVersionUndoParams & Readonly<{ versionId?: string }>;
export type TimelineVersionApplyEditParams = TimelineVersionContract & Readonly<{ projectId: string; sourceVersionId?: string; expectedActiveVersionId?: string; instruction?: string; intent?: EditIntent; idempotencyKey?: string }>;
export type TimelineVersionSnapshot = TimelineVersionContract & Readonly<{ projectId: string; versionId: string; timelineId: string; versionNumber: number; parentVersionId: string | null; sourceType: "root" | "edit"; createdAtMs: number; isActive: boolean; editIntent: Readonly<Record<string, unknown>>; diffSummary: Readonly<Record<string, unknown>>; timeline: TimelineProject }>;
export type TimelineVersionResult = TimelineVersionContract & Readonly<{ projectId: string; operation: "created" | "applied" | "activated" | "undo" | "redo"; activeVersionId: string | null; activeRevision: number; version: TimelineVersionSnapshot | null; editResult?: TimelineEditResult | null; status?: "rejected" }>;
export type TimelineVersionListResult = TimelineVersionContract & Readonly<{ projectId: string; activeVersionId: string | null; items: readonly TimelineVersionSnapshot[] }>;
export type TimelineVersionDiffParams = TimelineVersionContract & Readonly<{ projectId: string; fromVersionId: string; toVersionId: string }>;
export type TimelineVersionDiffResult = TimelineVersionContract & Readonly<{ projectId: string; fromVersionId: string; toVersionId: string; summary: Readonly<Record<string, unknown>> }>;
export type VadConfig = Readonly<{
  thresholdDb: number;
  minSpeechMs: number;
  minSilenceMs: number;
  preRollMs: number;
  postRollMs: number;
  mergeGapMs: number;
}>;
export type VadParams = Readonly<{ projectId: string; assetId: string; timeoutMs?: number; config?: Partial<VadConfig> }>;
export type MediaStream = Readonly<{ index: number; codecType: "video" | "audio" | "data" | "subtitle" | "attachment" | "unknown"; codecName: string | null; width: number | null; height: number | null; frameRate: number | null; sampleRate: number | null; channels: number | null; channelLayout: string | null; language: string | null }>;
export type MediaMetadata = Readonly<{ schemaVersion: 1; formatName: string | null; formatLongName: string | null; durationMs: number | null; bitRate: number | null; streams: readonly MediaStream[] }>;
export type MediaProbeResult = Readonly<{ schemaVersion: 1; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; metadata: MediaMetadata }>;
export type MediaOutput = Readonly<{ kind: "audio" | "video" | "thumbnail"; relativePath: string; sizeBytes: number }>;
export type MediaProxyResult = Readonly<{ schemaVersion: 1; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; outputs: readonly MediaOutput[] }>;
export type TranscriptionModelInfo = Readonly<{ adapterVersion: "faster-whisper-v1"; provider: "faster-whisper"; modelName: "tiny" | "base" | "small" | "medium" | "large-v3"; device: "cpu" | "cuda"; computeType: "int8" | "float16" | "float32" | "int8_float16" }>;
export type TranscriptionWord = Readonly<{ startMs: number; endMs: number; text: string; probability: number | null }>;
export type TranscriptionSegment = Readonly<{ index: number; startMs: number; endMs: number; text: string; confidence: number | null; avgLogprob: number | null; noSpeechProbability: number | null; compressionRatio: number | null; words: readonly TranscriptionWord[] }>;
export type TranscriptionResult = Readonly<{ schemaVersion: 1; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; model: TranscriptionModelInfo; language: string | null; languageProbability: number | null; durationMs: number | null; segments: readonly TranscriptionSegment[] }>;
export type SpeechInterval = Readonly<{ index: number; startMs: number; endMs: number; isSpeech: boolean; confidence: number | null; quality: "detected" | "silence" | "boundary-expanded" | "boundary-clipped" | "merged" }>;
export type VadResult = Readonly<{ schemaVersion: 1; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; adapterVersion: "ffmpeg-silencedetect-v1"; durationMs: number; config: VadConfig; intervals: readonly SpeechInterval[] }>;
export type SentenceConfig = Readonly<{ maxSentenceMs: number; pauseBoundaryMs: number; minSentenceMs: number; preRollMs: number; postRollMs: number }>;
export type SentenceParams = Readonly<{ projectId: string; assetId: string; timeoutMs?: number; config?: Partial<SentenceConfig> }>;
export type SentenceCandidate = Readonly<{ index: number; sourceAssetId: string; startMs: number; endMs: number; text: string; confidence: number | null; quality: "complete" | "needs_review"; qualityReasons: readonly string[]; sourceSegmentIndexes: readonly number[] }>;
export type SentenceResult = Readonly<{ schemaVersion: 1; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; adapterVersion: "sentence-segmentation-v1"; durationMs: number; config: SentenceConfig; sentences: readonly SentenceCandidate[] }>;
export type SentenceIndexParams = Readonly<{ projectId: string; assetId: string; sentenceCacheKey: string; timeoutMs?: number }>;
export type SentenceIndexEntry = Readonly<{ sentenceId: string; sourceAssetId: string; sentenceIndex: number; sourceSentenceCacheKey: string; startMs: number; endMs: number; text: string; keywords: readonly string[]; topics: readonly string[]; vector: readonly number[]; confidence: number | null; quality: "complete" | "needs_review"; qualityReasons: readonly string[] }>;
export type SentenceIndexResult = Readonly<{ schemaVersion: 1; indexVersion: "sentence-index-v1"; projectId: string; assetId: string; cacheStatus: "created" | "cache-hit"; cacheKey: string; sourceSentenceCacheKey: string; sourceSentenceResultDigest: string; adapterVersion: "deterministic-keyword-topic-vector-v1"; vectorProvider: "sha256-hash-v1"; vectorDimension: 32; reusedCount: number; rebuiltCount: number; entries: readonly SentenceIndexEntry[] }>;
export type RetrievalFilters = Readonly<{ topics?: readonly string[]; quality?: "complete" | "needs_review"; minConfidence?: number; startMs?: number; endMs?: number }>;
export type RetrievalParams = Readonly<{ projectId: string; query: string; mode?: "lexical" | "vector" | "hybrid"; assetIds?: readonly string[]; limit?: number; filters?: RetrievalFilters; timeoutMs?: number }>;
export type RetrievalTimecode = Readonly<{ startMs: number; endMs: number }>;
export type RetrievalExplanation = Readonly<{ queryKeywords: readonly string[]; matchedKeywords: readonly string[]; matchedTopics: readonly string[]; vectorProvider: "sha256-hash-v1"; scoreFormula: "lexical-keyword-overlap-v1" | "vector-cosine-v1" | "hybrid-0.6-0.4-v1" }>;
export type RetrievalCandidate = Readonly<{ rank: number; sentenceId: string; sourceAssetId: string; sourceSentenceCacheKey: string; sentenceIndex: number; timecode: RetrievalTimecode; text: string; lexicalScore: number; vectorScore: number; hybridScore: number; score: number; explanation: RetrievalExplanation; confidence: number | null; quality: "complete" | "needs_review"; qualityReasons: readonly string[]; previewUri: string }>;
export type RetrievalResult = Readonly<{ schemaVersion: 1; retrievalVersion: "hybrid-retrieval-v1"; projectId: string; query: string; mode: "lexical" | "vector" | "hybrid"; limit: number; candidateCount: number; candidates: readonly RetrievalCandidate[] }>;
export type RerankWeights = Readonly<{ originalScore?: number; narrationClarity?: number; visualQuality?: number; sentenceCompleteness?: number; sentenceIndependence?: number; qaQuality?: number; sourceDiversity?: number }>;
export type RerankConfig = Readonly<{ weights?: RerankWeights; duplicatePenalty?: number; diversityReward?: number; duplicateThreshold?: number; maxPerAsset?: number }>;
export type RerankParams = Readonly<{ projectId: string; query: string; mode?: "lexical" | "vector" | "hybrid"; assetIds?: readonly string[]; filters?: RetrievalFilters; candidateLimit?: number; limit?: number; config?: RerankConfig; timeoutMs?: number }>;
export type RerankTimecode = Readonly<{ startMs: number; endMs: number }>;
export type RerankScores = Readonly<{ originalScore: number; narrationClarityScore: number; narrationQualityScore: number; visualQualityScore: number; sentenceCompletenessScore: number; sentenceIndependenceScore: number; qaScore: number; duplicatePenalty: number; sourceDiversityReward: number; finalScore: number }>;
export type RerankExplanation = Readonly<{ reasons: readonly string[]; qaOpenMarkerCount: number; qaIssueTypes: readonly string[]; duplicateOfSentenceId: string | null; selectedSourceAssetCount: number; visualQualityStatus: "measured" | "degraded"; visualQualityReason: string }>;
export type RerankCandidate = Readonly<{ rank: number; retrievalRank: number; sentenceId: string; sourceAssetId: string; sourceSentenceCacheKey: string; sentenceIndex: number; timecode: RerankTimecode; text: string; quality: "complete" | "needs_review"; qualityStatus: "complete" | "needs_review"; qualityReasons: readonly string[]; previewUri: string; scores: RerankScores; explanation: RerankExplanation }>;
export type RerankResult = Readonly<{ schemaVersion: 1; rerankVersion: "quality-rerank-v1"; projectId: string; query: string; mode: "lexical" | "vector" | "hybrid"; candidateLimit: number; limit: number; candidateCount: number; candidates: readonly RerankCandidate[] }>;
export type SlotAlignmentParams = Readonly<{ projectId: string; inputKind?: "copy" | "outline"; inputText: string; assetIds?: readonly string[]; candidateLimit?: number; useRerank?: boolean; timeoutMs?: number }>;
export type SlotAlignmentTimecode = Readonly<{ startMs: number; endMs: number }>;
export type SlotAlignmentCandidate = Readonly<{ rank: number; origin: "b08-retrieval" | "b09-quality-rerank"; sentenceId: string; sourceAssetId: string; sourceSentenceCacheKey: string; sentenceIndex: number; timecode: SlotAlignmentTimecode; text: string; score: number; quality: "complete"; previewUri: string; selectionReason: string; preservedFacts: readonly string[] }>;
export type InformationSlot = Readonly<{ slotId: string; order: number; kind: "hook" | "context" | "claim" | "evidence" | "benefit" | "requirement" | "process" | "cta" | "closing" | "other"; sourceText: string; query: string; keyFacts: readonly string[]; status: "matched" | "gap"; selectedCandidateRank: number | null; candidates: readonly SlotAlignmentCandidate[]; selectionReason: string | null; gapReason: string | null }>;
export type SlotAlignmentResult = Readonly<{ schemaVersion: 1; alignmentVersion: "information-slot-alignment-v1"; splitterVersion: "deterministic-slot-split-v1"; projectId: string; inputKind: "copy" | "outline"; inputText: string; sourceDigest: string; slotCount: number; matchedCount: number; slots: readonly InformationSlot[] }>;
export type NarrativePlanParams = Readonly<{ projectId: string; theme: string; audience: string; targetDurationMs: number; outline?: string | null; assetIds?: readonly string[]; candidateLimit?: number; useRerank?: boolean; timeoutMs?: number }>;
export type NarrativePlanTimecode = Readonly<{ startMs: number; endMs: number }>;
export type NarrativePlanSource = Readonly<{ sourceAssetId: string; sourceSentenceCacheKey: string; sentenceIndex: number; timecode: NarrativePlanTimecode; previewUri: string }>;
export type NarrativePlanGap = Readonly<{ segmentId: string; slotId: string; role: "hook" | "body" | "cta"; code: "alignment-gap" | "missing-narrative-role" | "duration-outside-tolerance"; detail: string }>;
export type NarrativePlanSegment = Readonly<{ segmentId: string; order: number; role: "hook" | "body" | "cta"; slotId: string; slotKind: InformationSlot["kind"]; sourceText: string; status: "matched" | "gap"; candidateSentenceId: string | null; candidateRank: number | null; sentenceText: string | null; source: NarrativePlanSource | null; durationMs: number; selectionReason: string | null; gapReason: NarrativePlanGap | null }>;
export type NarrativePlanResult = Readonly<{ schemaVersion: 1; planVersion: "narrative-remix-plan-v1"; inputVersion: "deterministic-narrative-input-v1"; projectId: string; theme: string; audience: string; outline: string | null; targetDurationMs: number; toleranceLowerMs: number; toleranceUpperMs: number; selectedDurationMs: number; durationStatus: "within-tolerance" | "outside-tolerance"; status: "ready" | "gaps" | "needs-duration-optimization"; selectionPolicy: "b10-first-complete-candidate-v1"; alignmentVersion: "information-slot-alignment-v1"; planDigest: string; segments: readonly NarrativePlanSegment[]; gaps: readonly NarrativePlanGap[] }>;
export type DurationOptimizationParams = Readonly<{ projectId: string; sourcePlan: NarrativePlanResult; alignment: SlotAlignmentResult; timeoutMs?: number }>;
export type DurationOptimizationSentence = Readonly<{ sentenceId: string; sentenceText: string; source: NarrativePlanSource; durationMs: number; candidateRank: number }>;
export type DurationOptimizationSegment = Readonly<{ segmentId: string; order: number; role: "hook" | "body" | "cta"; slotId: string; slotKind: InformationSlot["kind"]; sourceText: string; status: "matched" | "gap"; operation: "keep" | "replace" | "add"; candidateSentenceId: string | null; candidateRank: number | null; sentenceText: string | null; source: NarrativePlanSource | null; durationMs: number; selectionReason: string | null; gapReason: NarrativePlanGap | null }>;
export type DurationOptimizationChange = Readonly<{ segmentId: string; slotId: string; role: "hook" | "body" | "cta"; operation: "keep" | "replace" | "add" | "remove"; before: DurationOptimizationSentence | null; after: DurationOptimizationSentence | null; selectionReason: string }>;
export type DurationOptimizationResult = Readonly<{ schemaVersion: 1; optimizationVersion: "duration-optimization-v1"; projectId: string; sourcePlanDigest: string; targetDurationMs: number; toleranceLowerMs: number; toleranceUpperMs: number; selectedDurationMs: number; durationStatus: "within-tolerance" | "outside-tolerance"; status: "optimized" | "unchanged" | "gaps" | "needs-duration-optimization"; selectionPolicy: "bounded-whole-sentence-knapsack-v1"; segments: readonly DurationOptimizationSegment[]; changes: readonly DurationOptimizationChange[]; gaps: readonly NarrativePlanGap[] }>;
export type ArollCutJoinParams = Readonly<{ projectId: string; timeline: TimelineProject; mode: "audio" | "video"; trackId?: string; executionMode?: "plan" | "ffmpeg"; timeoutMs?: number }>;
export type ArollSourceRef = Readonly<{ sourceId: string; uri: string; mediaType: "audio" | "video"; durationMs: number; fingerprint: string | null }>;
export type ArollCutJoinSegment = Readonly<{ order: number; clipId: string; sentenceId: string; source: ArollSourceRef; sourceInMs: number; sourceOutMs: number; durationMs: number; timelineStartMs: number; outputStartMs: number; outputEndMs: number }>;
export type ArollCutJoinGap = Readonly<{ code: "timeline-gap"; beforeClipId: string | null; afterClipId: string | null; startMs: number; endMs: number; durationMs: number }>;
export type ArollCutJoinOutput = Readonly<{ kind: "audio" | "video"; relativePath: string; sizeBytes: number }>;
export type ArollCutJoinResult = Readonly<{ schemaVersion: 1; planVersion: "aroll-cut-join-plan-v1"; projectId: string; timelineId: string; trackId: string; mode: "audio" | "video"; executionMode: "plan" | "ffmpeg"; executionStatus: "not-run" | "completed"; status: "ready" | "gaps"; selectionPolicy: "ordered-complete-sentence-v1"; gapPolicy: "concatenate-without-timeline-gaps-v1"; planDigest: string; selectedDurationMs: number; segments: readonly ArollCutJoinSegment[]; gaps: readonly ArollCutJoinGap[]; output: ArollCutJoinOutput | null }>;
export type SubtitleSentenceSource = Readonly<{ sentenceId: string; sourceId?: string | null; sourceInMs: number; sourceOutMs: number; text: string; language?: string | null; provenanceIds?: readonly string[] }>;
export type SubtitlePlanParams = Readonly<{ projectId: string; timeline: TimelineProject; sentenceSources?: readonly SubtitleSentenceSource[]; trackId?: string; maxLines?: number; maxLineWidth?: number; timeoutMs?: number }>;
export type SubtitlePlanGap = Readonly<{ code: "missing-sentence-source" | "missing-subtitle-text"; clipId: string; sentenceId: string | null; detail: string }>;
export type SubtitleCue = Readonly<{ order: number; cueId: string; clipId: string; sentenceId: string | null; sourceId: string | null; sourceInMs: number | null; sourceOutMs: number | null; provenanceIds: readonly string[]; text: string; language: string | null; timelineStartMs: number; durationMs: number; timelineEndMs: number }>;
export type SubtitlePlanResult = Readonly<{ schemaVersion: 1; planVersion: "subtitle-plan-v1"; projectId: string; timelineId: string; status: "ready" | "gaps"; selectionPolicy: "timeline-subtitles-or-sentence-clips-v1"; layoutPolicy: "bounded-display-width-v1"; maxLines: number; maxLineWidth: number; totalDurationMs: number; cueCount: number; planDigest: string; cues: readonly SubtitleCue[]; gaps: readonly SubtitlePlanGap[] }>;
export type PreviewRenderParams = Readonly<{ projectId: string; arollPlan: ArollCutJoinResult; subtitlePlan: SubtitlePlanResult; executionMode?: "plan" | "ffmpeg"; timeoutMs?: number }>;
export type PreviewSourceBinding = Readonly<{ sourceId: string; uri: string; fingerprint: string | null; segmentCount: number }>;
export type PreviewRenderCue = Readonly<{ order: number; cueId: string; clipId: string; sentenceId: string | null; sourceId: string | null; provenanceIds: readonly string[]; text: string; timelineStartMs: number; durationMs: number; outputStartMs: number; outputEndMs: number }>;
export type PreviewRenderGap = Readonly<{ code: "subtitle-plan-gap" | "subtitle-cue-unmapped" | "subtitle-cue-range-invalid"; clipId: string | null; cueId: string | null; detail: string }>;
export type PreviewRenderOutput = Readonly<{ kind: "video"; relativePath: string; playbackUri: string; sizeBytes: number; durationMs: number; outputFingerprint: string }>;
export type PreviewRenderLog = Readonly<{ status: "not-run" | "cache-hit" | "completed"; stdout: string; stderr: string }>;
export type PreviewRenderResult = Readonly<{ schemaVersion: 1; planVersion: "preview-render-plan-v1"; projectId: string; timelineId: string; arollPlanDigest: string; subtitlePlanDigest: string; executionMode: "plan" | "ffmpeg"; executionStatus: "not-run" | "completed"; status: "ready" | "gaps"; renderPolicy: "ffmpeg-low-bitrate-subtitle-overlay-v1"; selectedDurationMs: number; timelineDurationMs: number; cueCount: number; planDigest: string; sourceBindings: readonly PreviewSourceBinding[]; cues: readonly PreviewRenderCue[]; gaps: readonly PreviewRenderGap[]; log: PreviewRenderLog; output: PreviewRenderOutput | null }>;
export type PreviewQualityCheckParams = Readonly<{ projectId: string; previewResult: PreviewRenderResult; timeoutMs?: number }>;
export type PreviewQualityIssue = Readonly<{ checkId: string; code: "QA_PLAN_BINDING_INVALID" | "QA_PLAN_DIGEST_MISMATCH" | "QA_PLAN_ORDER_INVALID" | "QA_PLAN_RANGE_INVALID" | "QA_PLAN_GAP" | "QA_EXECUTION_NOT_RUN" | "QA_OUTPUT_MISSING" | "QA_OUTPUT_PLAYBACK_URI_INVALID" | "QA_OUTPUT_PATH_INVALID" | "QA_OUTPUT_FILE_INVALID" | "QA_OUTPUT_SIZE_MISMATCH" | "QA_OUTPUT_FINGERPRINT_MISMATCH" | "QA_OUTPUT_MANIFEST_INVALID" | "QA_OUTPUT_DURATION_MISMATCH" | "QA_OUTPUT_CONTAINER_UNVERIFIED" | "QA_OUTPUT_CONTAINER_INVALID"; severity: "pass" | "warning" | "fail"; status: "verified" | "not-run"; message: string }>;
export type PreviewQualityCheckResult = Readonly<{ schemaVersion: 1; qaVersion: "preview-quality-v1"; projectId: string; planDigest: string; phase: "plan" | "executed"; status: "pass" | "warning" | "fail"; readyForExport: boolean; executionVerified: boolean; issueCount: number; issues: readonly PreviewQualityIssue[] }>;
export type FinalMp4ExportParams = Readonly<{ projectId: string; previewResult: PreviewRenderResult; qualityResult: PreviewQualityCheckResult; audioResult: ArollCutJoinResult; audioFingerprint: string; outputName?: string; timeoutMs?: number }>;
export type FinalMp4Container = Readonly<{ formatName: string; videoCodec: "h264"; audioCodec: "aac"; width: 1080; height: 1920; frameRate: number | null }>;
export type FinalMp4Output = Readonly<{ kind: "video"; relativePath: string; manifestRelativePath: string; sizeBytes: number; durationMs: number; outputFingerprint: string; container: FinalMp4Container }>;
export type FinalMp4ExportResult = Readonly<{ schemaVersion: 1; exportVersion: "final-mp4-export-v1"; exportPolicy: "verified-preview-mux-v1"; projectId: string; timelineId: string; planDigest: string; qualityDigest: string; audioPlanDigest: string; audioFingerprint: string; status: "completed" | "cache-hit"; output: FinalMp4Output }>;
export type SentenceQaParams = Readonly<{ projectId: string; assetId: string; sentenceCacheKey: string; sentenceIndex: number; contextBefore?: number; contextAfter?: number }>;
export type SentenceQaMarkerInput = Readonly<{ sentenceIndex: number; issueType: "missing-text" | "half-sentence" | "low-confidence" | "boundary-uncertain" | "other"; status?: "open" | "resolved"; source?: "manual" | "automatic"; note?: string; expectedText?: string | null }>;
export type SentenceQaMarker = SentenceQaMarkerInput & Readonly<{ markerId: string; status: "open" | "resolved"; source: "manual" | "automatic"; note: string; expectedText: string | null; createdAtMs: number; updatedAtMs: number }>;
export type SentencePlaybackAddress = Readonly<{ scheme: "supervideo"; assetId: string; kind: "audio" | "video"; startMs: number; endMs: number; uri: string }>;
export type SentenceQaContextItem = Readonly<{ relation: "before" | "selected" | "after"; sentence: SentenceCandidate; playback: SentencePlaybackAddress }>;
export type SentenceQaContextResult = Readonly<{ schemaVersion: 1; qaVersion: "sentence-qa-v1"; projectId: string; assetId: string; sentenceCacheKey: string; selectedIndex: number; items: readonly SentenceQaContextItem[]; markers: readonly SentenceQaMarker[] }>;
export type SentenceQaSaveParams = SentenceQaParams & Readonly<{ markers?: readonly SentenceQaMarkerInput[] }>;
export type SentenceQaSaveResult = Readonly<{ schemaVersion: 1; qaVersion: "sentence-qa-v1"; projectId: string; assetId: string; sentenceCacheKey: string; revision: number; markers: readonly SentenceQaMarker[] }>;
export type CoreProgress = Readonly<{
  requestId: CoreRpcId;
  sequence: number;
  progress: number;
  message: string;
}>;

export type CoreRpcRequest = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  id: CoreRpcId;
  method: string;
  params: Readonly<Record<string, unknown>>;
}>;

export type CoreRpcErrorData = Readonly<{ errorCode: CoreRpcErrorCode }>;
export type CoreRpcErrorObject = Readonly<{
  code: number;
  message: string;
  data: CoreRpcErrorData;
}>;

export type CoreRpcResponse = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  id: CoreRpcId | null;
  result?: unknown;
  error?: CoreRpcErrorObject;
}>;

export type CoreProgressNotification = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  method: typeof CORE_RPC_METHODS.progress;
  params: CoreProgress;
}>;

export type CoreCancelNotification = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  method: typeof CORE_RPC_METHODS.cancel;
  params: Readonly<{ requestId: CoreRpcId }>;
}>;

export type CoreJobEventNotification = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  method: typeof CORE_RPC_METHODS.jobEvent;
  params: JobEvent;
}>;

export type CoreRpcMessage = CoreRpcRequest | CoreRpcResponse | CoreProgressNotification | CoreCancelNotification | CoreJobEventNotification;
export type CoreRpcServerMessage = CoreRpcResponse | CoreProgressNotification | CoreJobEventNotification;

export function createCoreRpcError(errorCode: CoreRpcErrorCode): CoreRpcErrorObject {
  return Object.freeze({
    code: CORE_RPC_ERROR_NUMBERS[errorCode],
    message: CORE_RPC_ERROR_MESSAGES[errorCode],
    data: Object.freeze({ errorCode }),
  });
}

export function createCoreRpcRequest(id: CoreRpcId, method: string, params: Readonly<Record<string, unknown>>): CoreRpcRequest {
  return Object.freeze({ jsonrpc: JSON_RPC_VERSION, id, method, params });
}

export function isCoreRpcErrorCode(value: unknown): value is CoreRpcErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CORE_RPC_ERROR_MESSAGES, value);
}

export function isCoreRpcId(value: unknown): value is CoreRpcId {
  return typeof value === "string"
    && value.length > 0
    && value.length <= CORE_RPC_MAX_REQUEST_ID_LENGTH
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

export function isCoreJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 16) {
    return false;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isCoreJsonValue(item, depth + 1));
  }
  if (!isPlainRecord(value)) {
    return false;
  }
  return Object.entries(value).every(([key, item]) =>
    key.length <= 128 && isCoreJsonValue(item, depth + 1));
}

export function isCoreRpcRequest(value: unknown): value is CoreRpcRequest {
  if (!isPlainRecord(value) || !isCoreJsonValue(value)) {
    return false;
  }
  if (!hasOnlyKeys(value, ["jsonrpc", "id", "method", "params"])) {
    return false;
  }
  if (value.jsonrpc !== JSON_RPC_VERSION || !isCoreRpcId(value.id)) {
    return false;
  }
  if (typeof value.method !== "string" || value.method.length === 0 || value.method.length > CORE_RPC_MAX_METHOD_LENGTH) {
    return false;
  }
  if (!isPlainRecord(value.params)) {
    return false;
  }
  if (value.method === CORE_RPC_METHODS.health) {
    return isEmptyRecord(value.params);
  }
  if (value.method === CORE_RPC_METHODS.smokeCountdown) {
    return isCoreSmokeCountdownParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.cancel) {
    return false;
  }
  if (value.method === CORE_RPC_METHODS.projectCreate) {
    return isProjectCreateParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.projectOpen || value.method === CORE_RPC_METHODS.projectInspect) {
    return isProjectOpenParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.assetReference) {
    return isAssetReferenceParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.assetScan) {
    return isAssetScanParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.assetList) {
    return isAssetListParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.mediaProbe || value.method === CORE_RPC_METHODS.mediaProxy || value.method === CORE_RPC_METHODS.mediaTranscribe) {
    return isMediaParams(value.params);
  }
  if (value.method === CORE_RPC_METHODS.mediaVad) return isVadParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentences) return isSentenceParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentenceQaContext) return isSentenceQaParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentenceQaSave) return isSentenceQaSaveParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentenceIndex) return isSentenceIndexParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentenceRetrieve) return isRetrievalParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSentenceRerank) return isRerankParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaScriptAlign) return isSlotAlignmentParams(value.params);
  if (value.method === CORE_RPC_METHODS.planCreateRemix) return isNarrativePlanParams(value.params);
  if (value.method === CORE_RPC_METHODS.planOptimizeDuration) return isDurationOptimizationParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaArollCutJoin) return isArollCutJoinParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaSubtitlePlan) return isSubtitlePlanParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaPreviewRender) return isPreviewRenderParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaPreviewQualityCheck) return isPreviewQualityCheckParams(value.params);
  if (value.method === CORE_RPC_METHODS.mediaFinalExport) return isFinalMp4ExportParams(value.params);
  if (value.method === CORE_RPC_METHODS.timelineEdit) return isTimelineEditParams(value.params);
  if (value.method === CORE_RPC_METHODS.timelineVersionCreate) return isTimelineVersionCreateParams(value.params);
  if (value.method === CORE_RPC_METHODS.timelineVersionApplyEdit) return isTimelineVersionApplyEditParams(value.params);
  if (value.method === CORE_RPC_METHODS.timelineVersionList) return isTimelineVersionListParams(value.params);
  if (value.method === CORE_RPC_METHODS.timelineVersionGet) return isTimelineVersionReferenceParams(value.params);
  if (value.method === CORE_RPC_METHODS.timelineVersionActivate) return isTimelineVersionActivateParams(value.params);
  if (value.method === CORE_RPC_METHODS.timelineVersionUndo) return isTimelineVersionUndoParams(value.params);
  if (value.method === CORE_RPC_METHODS.timelineVersionRedo) return isTimelineVersionRedoParams(value.params);
  if (value.method === CORE_RPC_METHODS.timelineVersionDiff) return isTimelineVersionDiffParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobSmokeStart) return isJobSmokeStartParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobTtsStart) return isTtsJobStartParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobTtsResult) return isJobReferenceParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobRemotionStart) return isRemotionRenderParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobRemotionResult) return isJobReferenceParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobImageStart) return isImageJobStartParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobImageResult) return isJobReferenceParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobGet || value.method === CORE_RPC_METHODS.jobCancel || value.method === CORE_RPC_METHODS.jobRetry) return isJobReferenceParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobList) return isJobListParams(value.params);
  if (value.method === CORE_RPC_METHODS.jobEventsList) return isJobEventsListParams(value.params);
  return true;
}

export function isCoreRpcResponse(value: unknown): value is CoreRpcResponse {
  if (!isPlainRecord(value) || !isCoreJsonValue(value)) {
    return false;
  }
  if (value.jsonrpc !== JSON_RPC_VERSION || (value.id !== null && !isCoreRpcId(value.id))) {
    return false;
  }
  const hasResult = Object.prototype.hasOwnProperty.call(value, "result");
  const hasError = Object.prototype.hasOwnProperty.call(value, "error");
  if (hasResult === hasError) {
    return false;
  }
  if (!hasOnlyKeys(value, hasResult ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"])) {
    return false;
  }
  return hasResult ? isCoreJsonValue(value.result) : isCoreRpcErrorObject(value.error);
}

export function isCoreProgressNotification(value: unknown): value is CoreProgressNotification {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["jsonrpc", "method", "params"])) {
    return false;
  }
  return value.jsonrpc === JSON_RPC_VERSION
    && value.method === CORE_RPC_METHODS.progress
    && isCoreProgress(value.params);
}

export function isCoreJobEventNotification(value: unknown): value is CoreJobEventNotification {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["jsonrpc", "method", "params"])) return false;
  return value.jsonrpc === JSON_RPC_VERSION && value.method === CORE_RPC_METHODS.jobEvent && isJobEvent(value.params);
}

export function isCoreCancelNotification(value: unknown): value is CoreCancelNotification {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["jsonrpc", "method", "params"])) {
    return false;
  }
  return value.jsonrpc === JSON_RPC_VERSION
    && value.method === CORE_RPC_METHODS.cancel
    && isPlainRecord(value.params)
    && hasOnlyKeys(value.params, ["requestId"])
    && isCoreRpcId(value.params.requestId);
}

export function isCoreRpcMessage(value: unknown): value is CoreRpcMessage {
  return isCoreRpcRequest(value)
    || isCoreRpcResponse(value)
    || isCoreProgressNotification(value)
    || isCoreCancelNotification(value)
    || isCoreJobEventNotification(value);
}

export function isCoreRpcServerMessage(value: unknown): value is CoreRpcServerMessage {
  return isCoreRpcResponse(value) || isCoreProgressNotification(value) || isCoreJobEventNotification(value);
}

export function isCoreHealth(value: unknown): value is CoreHealth {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["service", "status", "protocolVersion", "coreVersion", "capabilities"])) {
    return false;
  }
  return value.service === "python-core"
    && value.status === "ok"
    && value.protocolVersion === CORE_RPC_PROTOCOL_VERSION
    && typeof value.coreVersion === "string"
    && value.coreVersion.length > 0
    && value.coreVersion.length <= 32
    && Array.isArray(value.capabilities)
    && value.capabilities.length <= 64
    && value.capabilities.every((capability) => typeof capability === "string" && capability.length > 0 && capability.length <= 64);
}

export function isCoreSmokeCountdownParams(value: unknown): value is CoreSmokeCountdownParams {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["steps", "delayMs"])) {
    return false;
  }
  return isSafeInteger(value.steps, 3, 8) && isSafeInteger(value.delayMs, 1, 1_000);
}

export function isCoreSmokeCountdownResult(value: unknown): value is CoreSmokeCountdownResult {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["status", "steps"])) {
    return false;
  }
  return value.status === "completed" && isSafeInteger(value.steps, 3, 8);
}

export function isProjectSummary(value: unknown): value is ProjectSummary {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "name", "targetPlatform", "projectRoot", "manifestSchemaVersion", "databaseSchemaVersion", "assetCount", "createdAtMs", "updatedAtMs"])
    && isUuid(value.projectId)
    && isSafeString(value.name, 200)
    && isSafeString(value.targetPlatform, 64)
    && isAbsolutePath(value.projectRoot)
    && isSafeInteger(value.manifestSchemaVersion, 1, Number.MAX_SAFE_INTEGER)
    && isSafeInteger(value.databaseSchemaVersion, 1, Number.MAX_SAFE_INTEGER)
    && isSafeInteger(value.assetCount, 0, 1_000_000)
    && isTimestamp(value.createdAtMs)
    && isTimestamp(value.updatedAtMs);
}

export function isAssetSummary(value: unknown): value is AssetSummary {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["assetId", "projectId", "fileName", "absolutePath", "kind", "sizeBytes", "modifiedAtMs", "fingerprintAlgorithm", "referenceStatus"])
    && isUuid(value.assetId)
    && isUuid(value.projectId)
    && isSafeString(value.fileName, 255)
    && isAbsolutePath(value.absolutePath)
    && isSafeString(value.kind, 64)
    && isSafeInteger(value.sizeBytes, 0, Number.MAX_SAFE_INTEGER)
    && isTimestamp(value.modifiedAtMs)
    && isSafeString(value.fingerprintAlgorithm, 64)
    && (value.referenceStatus === "added" || value.referenceStatus === "existing");
}

export function isAssetReferenceBatchResult(value: unknown): value is AssetReferenceBatchResult {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "items"])
    && isUuid(value.projectId)
    && Array.isArray(value.items)
    && value.items.length <= 100
    && value.items.every(isAssetSummary);
}

export function isAssetListResult(value: unknown): value is AssetListResult {
  return isAssetReferenceBatchResult(value);
}

export function isAssetScanResult(value: unknown): value is AssetScanResult {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "directory", "items"])
    && isUuid(value.projectId)
    && isAbsolutePath(value.directory)
    && Array.isArray(value.items)
    && value.items.length <= 100
    && value.items.every(isAssetSummary);
}

export function isMediaProbeResult(value: unknown): value is MediaProbeResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "metadata"])
    && value.schemaVersion === 1 && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSafeString(value.cacheKey, 128) && isMediaMetadata(value.metadata);
}

export function isMediaProxyResult(value: unknown): value is MediaProxyResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "outputs"])
    && value.schemaVersion === 1 && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSafeString(value.cacheKey, 128)
    && Array.isArray(value.outputs) && value.outputs.length === 3 && value.outputs.every(isMediaOutput);
}

export function isTranscriptionResult(value: unknown): value is TranscriptionResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "model", "language", "languageProbability", "durationMs", "segments"])
    && value.schemaVersion === 1 && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSafeString(value.cacheKey, 128)
    && isTranscriptionModelInfo(value.model)
    && (value.language === null || isSafeString(value.language, 64))
    && (value.languageProbability === null || isFiniteInRange(value.languageProbability, 0, 1))
    && (value.durationMs === null || isSafeInteger(value.durationMs, 0, 86_400_000))
    && Array.isArray(value.segments) && value.segments.length <= 2_000 && value.segments.every(isTranscriptionSegment)
    && isBoundedCoreJsonValue(value, 48 * 1024);
}

export function isVadResult(value: unknown): value is VadResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "adapterVersion", "durationMs", "config", "intervals"])
    && value.schemaVersion === 1 && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSafeString(value.cacheKey, 128)
    && value.adapterVersion === "ffmpeg-silencedetect-v1"
    && isSafeInteger(value.durationMs, 0, 86_400_000)
    && isVadConfig(value.config)
    && isVadIntervals(value.intervals, value.durationMs)
    && isBoundedCoreJsonValue(value, 48 * 1024);
}

export function isSentenceResult(value: unknown): value is SentenceResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "adapterVersion", "durationMs", "config", "sentences"])
    && value.schemaVersion === 1 && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSafeString(value.cacheKey, 128)
    && value.adapterVersion === "sentence-segmentation-v1"
    && isSafeInteger(value.durationMs, 0, 86_400_000)
    && isSentenceConfig(value.config)
    && Array.isArray(value.sentences) && value.sentences.length <= 2_000
    && value.sentences.every((item, index) => isSentenceCandidate(item, index, value.assetId as string, value.durationMs as number))
    && isBoundedCoreJsonValue(value, 48 * 1024);
}

export function isSentenceIndexResult(value: unknown): value is SentenceIndexResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "indexVersion", "projectId", "assetId", "cacheStatus", "cacheKey", "sourceSentenceCacheKey", "sourceSentenceResultDigest", "adapterVersion", "vectorProvider", "vectorDimension", "reusedCount", "rebuiltCount", "entries"])
    && value.schemaVersion === 1 && value.indexVersion === "sentence-index-v1" && isUuid(value.projectId) && isUuid(value.assetId)
    && isMediaCacheStatus(value.cacheStatus) && isSentenceCacheKey(value.cacheKey) && isSentenceCacheKey(value.sourceSentenceCacheKey) && isSentenceCacheKey(value.sourceSentenceResultDigest)
    && value.adapterVersion === "deterministic-keyword-topic-vector-v1" && value.vectorProvider === "sha256-hash-v1" && value.vectorDimension === 32
    && isSafeInteger(value.reusedCount, 0, 2_000) && isSafeInteger(value.rebuiltCount, 0, 2_000)
    && Array.isArray(value.entries) && value.entries.length <= 2_000 && value.reusedCount + value.rebuiltCount === value.entries.length
    && value.entries.every((entry, index) => isSentenceIndexEntry(entry, index, value.assetId as string, value.sourceSentenceCacheKey as string))
    && isBoundedCoreJsonValue(value, 60 * 1024);
}

export function isRetrievalResult(value: unknown): value is RetrievalResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "retrievalVersion", "projectId", "query", "mode", "limit", "candidateCount", "candidates"])
    && value.schemaVersion === 1 && value.retrievalVersion === "hybrid-retrieval-v1" && isUuid(value.projectId)
    && isBoundedText(value.query, 512) && ["lexical", "vector", "hybrid"].includes(value.mode as string)
    && isSafeInteger(value.limit, 1, 50) && isSafeInteger(value.candidateCount, 0, 50)
    && Array.isArray(value.candidates) && value.candidates.length === value.candidateCount
    && value.candidates.every((item, index) => isRetrievalCandidate(item, index + 1))
    && isBoundedCoreJsonValue(value, 60 * 1024);
}

export function isRerankResult(value: unknown): value is RerankResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "rerankVersion", "projectId", "query", "mode", "candidateLimit", "limit", "candidateCount", "candidates"])
    && value.schemaVersion === 1 && value.rerankVersion === "quality-rerank-v1" && isUuid(value.projectId)
    && isBoundedText(value.query, 512) && ["lexical", "vector", "hybrid"].includes(value.mode as string)
    && isSafeInteger(value.candidateLimit, 1, 50) && isSafeInteger(value.limit, 1, 50) && value.limit <= value.candidateLimit
    && isSafeInteger(value.candidateCount, 0, 50) && Array.isArray(value.candidates) && value.candidates.length === value.candidateCount
    && value.candidates.every((item, index) => isRerankCandidate(item, index + 1))
    && isBoundedCoreJsonValue(value, 60 * 1024);
}

export function isSlotAlignmentResult(value: unknown): value is SlotAlignmentResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "alignmentVersion", "splitterVersion", "projectId", "inputKind", "inputText", "sourceDigest", "slotCount", "matchedCount", "slots"])
    && value.schemaVersion === 1 && value.alignmentVersion === "information-slot-alignment-v1" && value.splitterVersion === "deterministic-slot-split-v1"
    && isUuid(value.projectId) && (value.inputKind === "copy" || value.inputKind === "outline")
    && isBoundedMultilineText(value.inputText, 8_192) && isSentenceCacheKey(value.sourceDigest)
    && isSafeInteger(value.slotCount, 1, 32) && isSafeInteger(value.matchedCount, 0, 32)
    && Array.isArray(value.slots) && value.slots.length === value.slotCount
    && value.slots.every((slot, index) => isInformationSlot(slot, index + 1))
    && value.matchedCount === value.slots.filter((slot) => (slot as Record<string, unknown>).status === "matched").length
    && isBoundedCoreJsonValue(value, 60 * 1024);
}

export function isNarrativePlanResult(value: unknown): value is NarrativePlanResult {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "planVersion", "inputVersion", "projectId", "theme", "audience", "outline", "targetDurationMs", "toleranceLowerMs", "toleranceUpperMs", "selectedDurationMs", "durationStatus", "status", "selectionPolicy", "alignmentVersion", "planDigest", "segments", "gaps"])) return false;
  if (value.schemaVersion !== 1 || value.planVersion !== "narrative-remix-plan-v1" || value.inputVersion !== "deterministic-narrative-input-v1" || !isUuid(value.projectId)) return false;
  if (!isBoundedText(value.theme, 512) || !isBoundedText(value.audience, 256) || (value.outline !== null && !isBoundedMultilineText(value.outline, 8_192))) return false;
  if (!isSafeInteger(value.targetDurationMs, 1_000, 600_000) || !isSafeInteger(value.toleranceLowerMs, 800, 600_000) || !isSafeInteger(value.toleranceUpperMs, 800, 720_000)) return false;
  if (value.toleranceLowerMs !== Math.floor(value.targetDurationMs * 0.8) || value.toleranceUpperMs !== Math.floor(value.targetDurationMs * 1.2)) return false;
  if (!isSafeInteger(value.selectedDurationMs, 0, 86_400_000) || (value.durationStatus !== "within-tolerance" && value.durationStatus !== "outside-tolerance")) return false;
  if (value.status !== "ready" && value.status !== "gaps" && value.status !== "needs-duration-optimization") return false;
  if (value.selectionPolicy !== "b10-first-complete-candidate-v1" || value.alignmentVersion !== "information-slot-alignment-v1" || !isSentenceCacheKey(value.planDigest)) return false;
  if (!Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > 32 || !value.segments.every((segment, index) => isNarrativePlanSegment(segment, index + 1))) return false;
  if (value.selectedDurationMs !== value.segments.reduce((total, segment) => total + (segment as NarrativePlanSegment).durationMs, 0)) return false;
  const expectedDurationStatus = value.toleranceLowerMs <= value.selectedDurationMs && value.selectedDurationMs <= value.toleranceUpperMs ? "within-tolerance" : "outside-tolerance";
  if (value.durationStatus !== expectedDurationStatus) return false;
  if (!Array.isArray(value.gaps) || value.gaps.length > 32 || !value.gaps.every(isNarrativePlanGap)) return false;
  const segmentGaps = value.segments.filter((segment) => (segment as NarrativePlanSegment).gapReason !== null).map((segment) => (segment as NarrativePlanSegment).gapReason);
  if (value.gaps.length !== segmentGaps.length || value.gaps.some((gap, index) => JSON.stringify(gap) !== JSON.stringify(segmentGaps[index]))) return false;
  const expectedStatus = value.gaps.length > 0 ? "gaps" : value.durationStatus === "within-tolerance" ? "ready" : "needs-duration-optimization";
  return value.status === expectedStatus && isBoundedCoreJsonValue(value, 60 * 1024);
}

export function isDurationOptimizationResult(value: unknown): value is DurationOptimizationResult {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "optimizationVersion", "projectId", "sourcePlanDigest", "targetDurationMs", "toleranceLowerMs", "toleranceUpperMs", "selectedDurationMs", "durationStatus", "status", "selectionPolicy", "segments", "changes", "gaps"])) return false;
  if (value.schemaVersion !== 1 || value.optimizationVersion !== "duration-optimization-v1" || !isUuid(value.projectId) || !isSentenceCacheKey(value.sourcePlanDigest)) return false;
  if (!isSafeInteger(value.targetDurationMs, 1_000, 600_000) || !isSafeInteger(value.toleranceLowerMs, 800, 600_000) || !isSafeInteger(value.toleranceUpperMs, 800, 720_000)) return false;
  if (value.toleranceLowerMs !== Math.floor(value.targetDurationMs * 0.8) || value.toleranceUpperMs !== Math.floor(value.targetDurationMs * 1.2)) return false;
  if (!isSafeInteger(value.selectedDurationMs, 0, 86_400_000) || (value.durationStatus !== "within-tolerance" && value.durationStatus !== "outside-tolerance")) return false;
  if (!["optimized", "unchanged", "gaps", "needs-duration-optimization"].includes(value.status as string) || value.selectionPolicy !== "bounded-whole-sentence-knapsack-v1") return false;
  if (!Array.isArray(value.segments) || value.segments.length > 32 || !value.segments.every((segment, index) => isDurationOptimizationSegment(segment, index + 1))) return false;
  if (value.selectedDurationMs !== value.segments.reduce((total, segment) => total + (segment as DurationOptimizationSegment).durationMs, 0)) return false;
  const expectedDurationStatus = value.toleranceLowerMs <= value.selectedDurationMs && value.selectedDurationMs <= value.toleranceUpperMs ? "within-tolerance" : "outside-tolerance";
  if (value.durationStatus !== expectedDurationStatus) return false;
  if (!Array.isArray(value.changes) || value.changes.length > 64 || !value.changes.every(isDurationOptimizationChange)) return false;
  if (!Array.isArray(value.gaps) || value.gaps.length > 33 || !value.gaps.every(isNarrativePlanGap)) return false;
  const expectedStatus = value.gaps.length > 0 ? "gaps" : value.durationStatus === "within-tolerance" ? (value.changes.some((change) => (change as DurationOptimizationChange).operation !== "keep") ? "optimized" : "unchanged") : "needs-duration-optimization";
  return value.status === expectedStatus && isBoundedCoreJsonValue(value, 60 * 1024);
}

export function isArollCutJoinResult(value: unknown): value is ArollCutJoinResult {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "planVersion", "projectId", "timelineId", "trackId", "mode", "executionMode", "executionStatus", "status", "selectionPolicy", "gapPolicy", "planDigest", "selectedDurationMs", "segments", "gaps", "output"])) return false;
  if (value.schemaVersion !== 1 || value.planVersion !== "aroll-cut-join-plan-v1" || !isUuid(value.projectId) || !isTimelineId(value.timelineId) || !isTimelineId(value.trackId)) return false;
  if (value.mode !== "audio" && value.mode !== "video") return false;
  if (value.executionMode !== "plan" && value.executionMode !== "ffmpeg") return false;
  if (value.executionStatus !== "not-run" && value.executionStatus !== "completed") return false;
  if (value.status !== "ready" && value.status !== "gaps") return false;
  if (value.selectionPolicy !== "ordered-complete-sentence-v1" || value.gapPolicy !== "concatenate-without-timeline-gaps-v1" || !isSentenceCacheKey(value.planDigest)) return false;
  if (!isSafeInteger(value.selectedDurationMs, 1, 86_400_000)) return false;
  if (!Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > 64 || !value.segments.every((segment, index) => isArollCutJoinSegment(segment, index + 1, value.mode as "audio" | "video"))) return false;
  if (!Array.isArray(value.gaps) || value.gaps.length > 65 || !value.gaps.every(isArollCutJoinGap)) return false;
  if (value.selectedDurationMs !== value.segments.reduce((total, segment) => total + (segment as ArollCutJoinSegment).durationMs, 0)) return false;
  let outputCursor = 0;
  for (const segment of value.segments as readonly ArollCutJoinSegment[]) {
    if (segment.outputStartMs !== outputCursor) return false;
    outputCursor = segment.outputEndMs;
  }
  if (value.status !== (value.gaps.length > 0 ? "gaps" : "ready")) return false;
  if (value.executionMode === "plan" && (value.executionStatus !== "not-run" || value.output !== null)) return false;
  if (value.executionMode === "ffmpeg" && (value.executionStatus !== "completed" || !isArollCutJoinOutput(value.output) || (value.output as ArollCutJoinOutput).kind !== value.mode)) return false;
  return isBoundedCoreJsonValue(value, 128 * 1024);
}

export function isSubtitlePlanResult(value: unknown): value is SubtitlePlanResult {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "planVersion", "projectId", "timelineId", "status", "selectionPolicy", "layoutPolicy", "maxLines", "maxLineWidth", "totalDurationMs", "cueCount", "planDigest", "cues", "gaps"])) return false;
  if (value.schemaVersion !== 1 || value.planVersion !== "subtitle-plan-v1" || !isUuid(value.projectId) || !isTimelineId(value.timelineId)) return false;
  if (value.status !== "ready" && value.status !== "gaps") return false;
  if (value.selectionPolicy !== "timeline-subtitles-or-sentence-clips-v1" || value.layoutPolicy !== "bounded-display-width-v1") return false;
  if (!isSafeInteger(value.maxLines, 1, 4) || !isSafeInteger(value.maxLineWidth, 8, 64) || !isSafeInteger(value.totalDurationMs, 0, 86_400_000) || !isSafeInteger(value.cueCount, 0, 2_048) || !isSentenceCacheKey(value.planDigest)) return false;
  if (!Array.isArray(value.cues) || value.cues.length > 2_048 || value.cueCount !== value.cues.length || !value.cues.every((cue, index) => isSubtitleCue(cue, index + 1, value.maxLines as number, value.maxLineWidth as number))) return false;
  if (!Array.isArray(value.gaps) || value.gaps.length > 2_048 || !value.gaps.every(isSubtitlePlanGap)) return false;
  if (value.cues.length === 0 && value.gaps.length === 0) return false;
  if ((value.cues as readonly SubtitleCue[]).reduce((total, cue) => total + cue.text.length, 0) > 180_000) return false;
  if (value.status !== (value.gaps.length > 0 ? "gaps" : "ready")) return false;
  if (value.totalDurationMs !== value.cues.reduce((total, cue) => total + (cue as SubtitleCue).durationMs, 0)) return false;
  let cursor = 0;
  for (const cue of value.cues as readonly SubtitleCue[]) {
    if (cue.timelineStartMs < cursor) return false;
    cursor = cue.timelineEndMs;
  }
  return isBoundedCoreJsonValue(value, 256 * 1024);
}

export function isPreviewRenderResult(value: unknown): value is PreviewRenderResult {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "planVersion", "projectId", "timelineId", "arollPlanDigest", "subtitlePlanDigest", "executionMode", "executionStatus", "status", "renderPolicy", "selectedDurationMs", "timelineDurationMs", "cueCount", "planDigest", "sourceBindings", "cues", "gaps", "log", "output"])) return false;
  if (value.schemaVersion !== 1 || value.planVersion !== "preview-render-plan-v1" || !isUuid(value.projectId) || !isTimelineId(value.timelineId)) return false;
  if (!isSentenceCacheKey(value.arollPlanDigest) || !isSentenceCacheKey(value.subtitlePlanDigest) || !isSentenceCacheKey(value.planDigest)) return false;
  if ((value.executionMode !== "plan" && value.executionMode !== "ffmpeg") || (value.executionStatus !== "not-run" && value.executionStatus !== "completed") || (value.status !== "ready" && value.status !== "gaps")) return false;
  if (value.renderPolicy !== "ffmpeg-low-bitrate-subtitle-overlay-v1" || !isSafeInteger(value.selectedDurationMs, 1, 86_400_000) || value.timelineDurationMs !== value.selectedDurationMs) return false;
  if (!Array.isArray(value.sourceBindings) || value.sourceBindings.length > 64 || !value.sourceBindings.every(isPreviewSourceBinding)) return false;
  if (!Array.isArray(value.cues) || value.cues.length > 2_048 || value.cueCount !== value.cues.length || !value.cues.every((cue, index) => isPreviewRenderCue(cue, index + 1, value.selectedDurationMs as number))) return false;
  if (!Array.isArray(value.gaps) || value.gaps.length > 2_048 || !value.gaps.every(isPreviewRenderGap)) return false;
  if (!isPreviewRenderLog(value.log)) return false;
  if (value.status !== (value.gaps.length > 0 ? "gaps" : "ready")) return false;
  if (value.executionMode === "plan" && (value.executionStatus !== "not-run" || value.output !== null || (value.log as PreviewRenderLog).status !== "not-run")) return false;
  if (value.executionMode === "ffmpeg" && (value.executionStatus !== "completed" || !isPreviewRenderOutput(value.output) || !["cache-hit", "completed"].includes((value.log as PreviewRenderLog).status))) return false;
  return isBoundedCoreJsonValue(value, 256 * 1024);
}

export function isPreviewQualityCheckResult(value: unknown): value is PreviewQualityCheckResult {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "qaVersion", "projectId", "planDigest", "phase", "status", "readyForExport", "executionVerified", "issueCount", "issues"])) return false;
  if (value.schemaVersion !== 1 || value.qaVersion !== "preview-quality-v1" || !isUuid(value.projectId) || !isSentenceCacheKey(value.planDigest)) return false;
  if ((value.phase !== "plan" && value.phase !== "executed") || (value.status !== "pass" && value.status !== "warning" && value.status !== "fail") || typeof value.readyForExport !== "boolean" || typeof value.executionVerified !== "boolean") return false;
  if (!isSafeInteger(value.issueCount, 1, 64) || !Array.isArray(value.issues) || value.issues.length !== value.issueCount || !value.issues.every(isPreviewQualityIssue)) return false;
  if (value.phase === "plan" && value.executionVerified) return false;
  const severities = new Set((value.issues as readonly PreviewQualityIssue[]).map((issue) => issue.severity));
  const expected = severities.has("fail") ? "fail" : severities.has("warning") ? "warning" : "pass";
  if (value.status !== expected || (!value.executionVerified && value.readyForExport) || (severities.has("fail") && value.readyForExport)) return false;
  return isBoundedCoreJsonValue(value, 64 * 1024);
}

export function isSentenceQaContextResult(value: unknown): value is SentenceQaContextResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "qaVersion", "projectId", "assetId", "sentenceCacheKey", "selectedIndex", "items", "markers"])
    && value.schemaVersion === 1 && value.qaVersion === "sentence-qa-v1" && isUuid(value.projectId) && isUuid(value.assetId)
    && isSentenceCacheKey(value.sentenceCacheKey) && isSafeInteger(value.selectedIndex, 0, 1_999)
    && Array.isArray(value.items) && value.items.length <= 7 && value.items.every((item) => isSentenceQaContextItem(item, value.assetId as string))
    && Array.isArray(value.markers) && value.markers.length <= 500 && value.markers.every(isSentenceQaMarker)
    && isBoundedCoreJsonValue(value, 64 * 1024);
}

export function isSentenceQaSaveResult(value: unknown): value is SentenceQaSaveResult {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "qaVersion", "projectId", "assetId", "sentenceCacheKey", "revision", "markers"])
    && value.schemaVersion === 1 && value.qaVersion === "sentence-qa-v1" && isUuid(value.projectId) && isUuid(value.assetId)
    && isSentenceCacheKey(value.sentenceCacheKey) && isSafeInteger(value.revision, 1, 2_000_000_000)
    && Array.isArray(value.markers) && value.markers.length <= 500 && value.markers.every(isSentenceQaMarker)
    && isBoundedCoreJsonValue(value, 64 * 1024);
}

function isVadIntervals(value: unknown, durationMs: number): value is readonly SpeechInterval[] {
  if (!Array.isArray(value) || value.length > 4_000) return false;
  let cursor = 0;
  for (let index = 0; index < value.length; index += 1) {
    const interval = value[index];
    if (!isSpeechInterval(interval) || interval.index !== index || interval.startMs !== cursor || interval.endMs > durationMs) return false;
    cursor = interval.endMs;
  }
  return durationMs === 0 ? value.length === 0 : cursor === durationMs;
}

export function isCoreProgress(value: unknown): value is CoreProgress {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["requestId", "sequence", "progress", "message"])) {
    return false;
  }
  return isCoreRpcId(value.requestId)
    && isSafeInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER)
    && typeof value.progress === "number"
    && Number.isFinite(value.progress)
    && value.progress >= 0
    && value.progress <= 1
    && typeof value.message === "string"
    && value.message.length <= CORE_RPC_MAX_PROGRESS_MESSAGE_LENGTH;
}

export function isJobSummary(value: unknown): value is JobSummary {
  return isPlainRecord(value) && hasOnlyKeys(value, ["jobId", "projectId", "jobType", "status", "progress", "stage", "attempt", "revision", "lastEventSequence", "createdAtMs", "updatedAtMs", "startedAtMs", "finishedAtMs", "errorCode"])
    && isUuid(value.jobId) && isUuid(value.projectId) && (value.jobType === "smoke.countdown" || value.jobType === "tts.synthesize" || value.jobType === "remotion.render" || value.jobType === "image.generate") && isJobStatus(value.status)
    && isFiniteProgress(value.progress) && (value.stage === null || isSafeString(value.stage, 128))
    && isSafeInteger(value.attempt, 0, Number.MAX_SAFE_INTEGER)
    && isSafeInteger(value.revision, 0, Number.MAX_SAFE_INTEGER) && isSafeInteger(value.lastEventSequence, 0, Number.MAX_SAFE_INTEGER)
    && isTimestamp(value.createdAtMs) && isTimestamp(value.updatedAtMs)
    && (value.startedAtMs === null || isTimestamp(value.startedAtMs)) && (value.finishedAtMs === null || isTimestamp(value.finishedAtMs))
    && (value.errorCode === null || isSafeString(value.errorCode, 128));
}

export function isJobEvent(value: unknown): value is JobEvent {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectId", "jobId", "sequence", "eventType", "status", "progress", "stage", "attempt", "timestamp", "payload"])
    && isUuid(value.projectId) && isUuid(value.jobId) && isSafeInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER)
    && isSafeString(value.eventType, 64) && isJobStatus(value.status) && isFiniteProgress(value.progress)
    && (value.stage === null || isSafeString(value.stage, 128)) && isSafeInteger(value.attempt, 0, Number.MAX_SAFE_INTEGER)
    && isTimestamp(value.timestamp) && isBoundedCoreJsonValue(value.payload, 16 * 1024);
}

export function isJobPage(value: unknown): value is JobPage {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectId", "items", "nextCursor", "hasMore"])
    && isUuid(value.projectId) && Array.isArray(value.items) && value.items.length <= 100
    && value.items.every(isJobSummary) && (value.nextCursor === null || isSafeString(value.nextCursor, 512)) && typeof value.hasMore === "boolean";
}

export function isJobEventPage(value: unknown): value is JobEventPage {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectId", "jobId", "items", "nextCursor", "hasMore"])
    && isUuid(value.projectId) && isUuid(value.jobId) && Array.isArray(value.items) && value.items.length <= 100
    && value.items.every(isJobEvent) && (value.nextCursor === null || isSafeString(value.nextCursor, 64)) && typeof value.hasMore === "boolean";
}

export function isCoreRpcErrorObject(value: unknown): value is CoreRpcErrorObject {
  if (!isPlainRecord(value) || !isCoreJsonValue(value) || !hasOnlyKeys(value, ["code", "message", "data"])) {
    return false;
  }
  if (!Object.values(CORE_RPC_ERROR_NUMBERS).includes(value.code as number)
    || typeof value.message !== "string"
    || value.message.length > CORE_RPC_MAX_ERROR_MESSAGE_LENGTH) {
    return false;
  }
  if (!isPlainRecord(value.data) || !hasOnlyKeys(value.data, ["errorCode"]) || !isCoreRpcErrorCode(value.data.errorCode)) {
    return false;
  }
  return value.code === CORE_RPC_ERROR_NUMBERS[value.data.errorCode]
    && value.message === CORE_RPC_ERROR_MESSAGES[value.data.errorCode];
}

export function serializeCoreRpcMessage(value: CoreRpcMessage | CoreRpcServerMessage): string {
  if (!isCoreJsonValue(value)) {
    throw new Error("Core RPC message is not JSON-safe.");
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined || utf8ByteLength(serialized) > CORE_RPC_MAX_LINE_BYTES) {
    throw new Error("Core RPC message exceeds the line limit.");
  }
  return serialized;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key)) && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return isPlainRecord(value) && Object.keys(value).length === 0;
}

function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isTimestamp(value: unknown): value is number {
  return isSafeInteger(value, 0, Number.MAX_SAFE_INTEGER);
}

function isProjectCreateParams(value: unknown): value is ProjectCreateParams {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["name", "targetPlatform", "projectRoot"])
    && isSafeString(value.name, 200)
    && !/[\u0000-\u001f\u007f]/.test(value.name)
    && isSafeString(value.targetPlatform, 64)
    && !/[\u0000-\u001f\u007f]/.test(value.targetPlatform)
    && isAbsolutePath(value.projectRoot);
}

function isProjectOpenParams(value: unknown): value is ProjectOpenParams {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectRoot"]) && isAbsolutePath(value.projectRoot);
}

function isAssetReferenceParams(value: unknown): value is AssetReferenceParams {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "paths"])
    && isUuid(value.projectId)
    && Array.isArray(value.paths)
    && value.paths.length > 0
    && value.paths.length <= 100
    && value.paths.every((item) => isAbsolutePath(item));
}

function isAssetListParams(value: unknown): value is AssetListParams {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "limit"])
    && isUuid(value.projectId)
    && isSafeInteger(value.limit, 1, 1_000);
}

function isAssetScanParams(value: unknown): value is AssetScanParams {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["projectId", "directory"])
    && isUuid(value.projectId)
    && isAbsolutePath(value.directory);
}

function isMediaParams(value: unknown): value is MediaParams {
  return isPlainRecord(value) && hasNoUnexpectedKeys(value, ["projectId", "assetId", "timeoutMs"])
    && isUuid(value.projectId) && isUuid(value.assetId)
    && (value.timeoutMs === undefined || isSafeInteger(value.timeoutMs, 1_000, 120_000));
}

function isVadParams(value: unknown): value is VadParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "assetId", "timeoutMs", "config"])) return false;
  if (!isUuid(value.projectId) || !isUuid(value.assetId) || (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000))) return false;
  if (value.config === undefined) return true;
  if (!isPlainRecord(value.config)) return false;
  return hasNoUnexpectedKeys(value.config, ["thresholdDb", "minSpeechMs", "minSilenceMs", "preRollMs", "postRollMs", "mergeGapMs"])
    && (value.config.thresholdDb === undefined || isFiniteInRange(value.config.thresholdDb, -60, -5))
    && (value.config.minSpeechMs === undefined || isSafeInteger(value.config.minSpeechMs, 20, 5_000))
    && (value.config.minSilenceMs === undefined || isSafeInteger(value.config.minSilenceMs, 20, 5_000))
    && (value.config.preRollMs === undefined || isSafeInteger(value.config.preRollMs, 0, 180))
    && (value.config.postRollMs === undefined || isSafeInteger(value.config.postRollMs, 0, 250))
    && (value.config.mergeGapMs === undefined || isSafeInteger(value.config.mergeGapMs, 0, 1_000));
}

function isSentenceParams(value: unknown): value is SentenceParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "assetId", "timeoutMs", "config"])) return false;
  if (!isUuid(value.projectId) || !isUuid(value.assetId) || (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000))) return false;
  if (value.config === undefined) return true;
  return isPlainRecord(value.config) && hasNoUnexpectedKeys(value.config, ["maxSentenceMs", "pauseBoundaryMs", "minSentenceMs", "preRollMs", "postRollMs"])
    && (value.config.maxSentenceMs === undefined || isSafeInteger(value.config.maxSentenceMs, 1_000, 30_000))
    && (value.config.pauseBoundaryMs === undefined || isSafeInteger(value.config.pauseBoundaryMs, 100, 3_000))
    && (value.config.minSentenceMs === undefined || isSafeInteger(value.config.minSentenceMs, 0, 5_000))
    && (value.config.preRollMs === undefined || isSafeInteger(value.config.preRollMs, 0, 180))
    && (value.config.postRollMs === undefined || isSafeInteger(value.config.postRollMs, 0, 250));
}

export function isSentenceQaParams(value: unknown): value is SentenceQaParams {
  return isPlainRecord(value) && hasNoUnexpectedKeys(value, ["projectId", "assetId", "sentenceCacheKey", "sentenceIndex", "contextBefore", "contextAfter"])
    && isUuid(value.projectId) && isUuid(value.assetId) && isSentenceCacheKey(value.sentenceCacheKey)
    && isSafeInteger(value.sentenceIndex, 0, 1_999)
    && (value.contextBefore === undefined || isSafeInteger(value.contextBefore, 0, 3))
    && (value.contextAfter === undefined || isSafeInteger(value.contextAfter, 0, 3));
}

export function isSentenceIndexParams(value: unknown): value is SentenceIndexParams {
  return isPlainRecord(value) && hasNoUnexpectedKeys(value, ["projectId", "assetId", "sentenceCacheKey", "timeoutMs"])
    && isUuid(value.projectId) && isUuid(value.assetId) && isSentenceCacheKey(value.sentenceCacheKey)
    && (value.timeoutMs === undefined || isSafeInteger(value.timeoutMs, 1_000, 120_000));
}

export function isRetrievalParams(value: unknown): value is RetrievalParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "query", "mode", "assetIds", "limit", "filters", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || !isBoundedText(value.query, 512) || !(value.query as string).trim()) return false;
  if (value.mode !== undefined && !["lexical", "vector", "hybrid"].includes(value.mode as string)) return false;
  if (value.limit !== undefined && !isSafeInteger(value.limit, 1, 50)) return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  if (value.assetIds !== undefined && (!Array.isArray(value.assetIds) || value.assetIds.length > 100 || value.assetIds.length !== new Set(value.assetIds).size || !value.assetIds.every(isUuid))) return false;
  if (value.filters === undefined) return true;
  const filters = value.filters;
  if (!isPlainRecord(filters) || !hasNoUnexpectedKeys(filters, ["topics", "quality", "minConfidence", "startMs", "endMs"])) return false;
  if (filters.topics !== undefined && (!Array.isArray(filters.topics) || filters.topics.length > 8 || filters.topics.length !== new Set(filters.topics).size || !filters.topics.every((item) => isBoundedText(item, 64)))) return false;
  if (filters.quality !== undefined && filters.quality !== "complete" && filters.quality !== "needs_review") return false;
  if (filters.minConfidence !== undefined && !isFiniteInRange(filters.minConfidence, 0, 1)) return false;
  if (filters.startMs !== undefined && !isSafeInteger(filters.startMs, 0, 86_400_000)) return false;
  if (filters.endMs !== undefined && !isSafeInteger(filters.endMs, 1, 86_400_000)) return false;
  return filters.startMs === undefined || filters.endMs === undefined || filters.endMs > filters.startMs;
}

export function isRerankParams(value: unknown): value is RerankParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "query", "mode", "assetIds", "filters", "candidateLimit", "limit", "config", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || !isBoundedText(value.query, 512) || !(value.query as string).trim()) return false;
  if (value.mode !== undefined && !["lexical", "vector", "hybrid"].includes(value.mode as string)) return false;
  if (value.candidateLimit !== undefined && !isSafeInteger(value.candidateLimit, 1, 50)) return false;
  if (value.limit !== undefined && !isSafeInteger(value.limit, 1, 50)) return false;
  if (value.limit !== undefined && value.candidateLimit !== undefined && value.limit > value.candidateLimit) return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  if (value.assetIds !== undefined && (!Array.isArray(value.assetIds) || value.assetIds.length > 100 || value.assetIds.length !== new Set(value.assetIds).size || !value.assetIds.every(isUuid))) return false;
  if (value.filters !== undefined && !isRetrievalParams({ projectId: value.projectId, query: value.query, filters: value.filters })) return false;
  if (value.config === undefined) return true;
  const config = value.config;
  if (!isPlainRecord(config) || !hasNoUnexpectedKeys(config, ["weights", "duplicatePenalty", "diversityReward", "duplicateThreshold", "maxPerAsset"])) return false;
  if (config.duplicatePenalty !== undefined && !isFiniteInRange(config.duplicatePenalty, 0, 1)) return false;
  if (config.diversityReward !== undefined && !isFiniteInRange(config.diversityReward, 0, 1)) return false;
  if (config.duplicateThreshold !== undefined && !isFiniteInRange(config.duplicateThreshold, 0, 1)) return false;
  if (config.maxPerAsset !== undefined && !isSafeInteger(config.maxPerAsset, 1, 50)) return false;
  if (config.weights === undefined) return true;
  const weights = config.weights;
  if (!isPlainRecord(weights) || !hasNoUnexpectedKeys(weights, ["originalScore", "narrationClarity", "visualQuality", "sentenceCompleteness", "sentenceIndependence", "qaQuality", "sourceDiversity"])) return false;
  const values = [weights.originalScore, weights.narrationClarity, weights.visualQuality, weights.sentenceCompleteness, weights.sentenceIndependence, weights.qaQuality, weights.sourceDiversity];
  return values.every((item) => item === undefined || isFiniteInRange(item, 0, 1))
    && (values.every((item) => item === undefined) || values.some((item) => item !== undefined && item > 0));
}

export function isSlotAlignmentParams(value: unknown): value is SlotAlignmentParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "inputKind", "inputText", "assetIds", "candidateLimit", "useRerank", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || (value.inputKind !== undefined && value.inputKind !== "copy" && value.inputKind !== "outline")) return false;
  if (!isBoundedMultilineText(value.inputText, 8_192)) return false;
  if (value.candidateLimit !== undefined && !isSafeInteger(value.candidateLimit, 1, 8)) return false;
  if (value.useRerank !== undefined && typeof value.useRerank !== "boolean") return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  return value.assetIds === undefined || Array.isArray(value.assetIds) && value.assetIds.length >= 1 && value.assetIds.length <= 100
    && value.assetIds.length === new Set(value.assetIds).size && value.assetIds.every(isUuid);
}

export function isNarrativePlanParams(value: unknown): value is NarrativePlanParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "theme", "audience", "targetDurationMs", "outline", "assetIds", "candidateLimit", "useRerank", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || !isBoundedText(value.theme, 512) || !isBoundedText(value.audience, 256) || !isSafeInteger(value.targetDurationMs, 1_000, 600_000)) return false;
  if (value.outline !== undefined && value.outline !== null && !isBoundedMultilineText(value.outline, 8_192)) return false;
  if (value.candidateLimit !== undefined && !isSafeInteger(value.candidateLimit, 1, 8)) return false;
  if (value.useRerank !== undefined && typeof value.useRerank !== "boolean") return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  return value.assetIds === undefined || Array.isArray(value.assetIds) && value.assetIds.length >= 1 && value.assetIds.length <= 100
    && value.assetIds.length === new Set(value.assetIds).size && value.assetIds.every(isUuid);
}

export function isDurationOptimizationParams(value: unknown): value is DurationOptimizationParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "sourcePlan", "alignment", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || !isNarrativePlanResult(value.sourcePlan) || !isSlotAlignmentResult(value.alignment)) return false;
  if ((value.sourcePlan as NarrativePlanResult).projectId !== value.projectId || (value.alignment as SlotAlignmentResult).projectId !== value.projectId) return false;
  return (value.timeoutMs === undefined || isSafeInteger(value.timeoutMs, 1_000, 120_000)) && isBoundedCoreJsonValue(value, 120 * 1024);
}

export function isArollCutJoinParams(value: unknown): value is ArollCutJoinParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "timeline", "mode", "trackId", "executionMode", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || !isTimelineProject(value.timeline) || (value.mode !== "audio" && value.mode !== "video")) return false;
  if (value.trackId !== undefined && !isTimelineId(value.trackId)) return false;
  if (value.executionMode !== undefined && value.executionMode !== "plan" && value.executionMode !== "ffmpeg") return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  return isArollTimelineInput(value.timeline as TimelineProject, value.mode as "audio" | "video", value.trackId as string | undefined)
    && isBoundedCoreJsonValue(value, 512 * 1024);
}

export function isSubtitlePlanParams(value: unknown): value is SubtitlePlanParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "timeline", "sentenceSources", "trackId", "maxLines", "maxLineWidth", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || !isTimelineProject(value.timeline)) return false;
  if (value.trackId !== undefined && !isTimelineId(value.trackId)) return false;
  if (value.maxLines !== undefined && !isSafeInteger(value.maxLines, 1, 4)) return false;
  if (value.maxLineWidth !== undefined && !isSafeInteger(value.maxLineWidth, 8, 64)) return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  if (value.sentenceSources !== undefined && (!Array.isArray(value.sentenceSources) || value.sentenceSources.length > 2_048 || !value.sentenceSources.every(isSubtitleSentenceSource))) return false;
  return isBoundedCoreJsonValue(value, 512 * 1024);
}

export function isPreviewRenderParams(value: unknown): value is PreviewRenderParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "arollPlan", "subtitlePlan", "executionMode", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || !isArollCutJoinResult(value.arollPlan) || !isSubtitlePlanResult(value.subtitlePlan)) return false;
  if ((value.arollPlan as ArollCutJoinResult).projectId !== value.projectId || (value.subtitlePlan as SubtitlePlanResult).projectId !== value.projectId) return false;
  if ((value.arollPlan as ArollCutJoinResult).timelineId !== (value.subtitlePlan as SubtitlePlanResult).timelineId) return false;
  if (value.executionMode !== undefined && value.executionMode !== "plan" && value.executionMode !== "ffmpeg") return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  return isBoundedCoreJsonValue(value, 512 * 1024);
}

export function isPreviewQualityCheckParams(value: unknown): value is PreviewQualityCheckParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "previewResult", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || !isPreviewRenderResult(value.previewResult) || (value.previewResult as PreviewRenderResult).projectId !== value.projectId) return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  return isBoundedCoreJsonValue(value, 512 * 1024);
}

export function isFinalMp4ExportParams(value: unknown): value is FinalMp4ExportParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "previewResult", "qualityResult", "audioResult", "audioFingerprint", "outputName", "timeoutMs"])) return false;
  if (!isUuid(value.projectId) || !isPreviewRenderResult(value.previewResult) || !isPreviewQualityCheckResult(value.qualityResult) || !isArollCutJoinResult(value.audioResult)) return false;
  if ((value.previewResult as PreviewRenderResult).projectId !== value.projectId || (value.qualityResult as PreviewQualityCheckResult).projectId !== value.projectId) return false;
  if ((value.qualityResult as PreviewQualityCheckResult).planDigest !== (value.previewResult as PreviewRenderResult).planDigest) return false;
  if ((value.audioResult as ArollCutJoinResult).projectId !== value.projectId || (value.audioResult as ArollCutJoinResult).timelineId !== (value.previewResult as PreviewRenderResult).timelineId) return false;
  if (typeof value.audioFingerprint !== "string" || !isSentenceCacheKey(value.audioFingerprint)) return false;
  if (value.outputName !== undefined && (typeof value.outputName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.mp4$/.test(value.outputName))) return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  return isBoundedCoreJsonValue(value, 512 * 1024);
}

export function isTimelineEditParams(value: unknown): value is TimelineEditParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["schemaVersion", "editVersion", "policy", "projectId", "timeline", "instruction", "intent", "timeoutMs"])) return false;
  if (value.schemaVersion !== 1 || value.editVersion !== "timeline-edit-v1" || value.policy !== "deterministic-natural-language-v1" || !isUuid(value.projectId) || !isTimelineProject(value.timeline)) return false;
  if (value.timeoutMs !== undefined && !isSafeInteger(value.timeoutMs, 1_000, 120_000)) return false;
  const hasInstruction = typeof value.instruction === "string" && value.instruction.trim().length > 0 && isBoundedText(value.instruction, 2_048);
  const hasIntent = value.intent !== undefined && isEditIntent(value.intent);
  return hasInstruction !== hasIntent && isBoundedCoreJsonValue(value, 512 * 1024);
}

export function isEditIntent(value: unknown): value is EditIntent {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["schemaVersion", "editVersion", "policy", "operation", "targetClipId", "targetSentenceId", "targetText", "replacementClipId", "text", "amountMs"])) return false;
  if (value.schemaVersion !== 1 || value.editVersion !== "edit-intent-v1" || value.policy !== "deterministic-natural-language-v1") return false;
  if (!["delete", "replace", "move-forward", "move-backward", "shorten", "extend", "subtitle", "cta"].includes(value.operation as string)) return false;
  const selectors = [value.targetClipId, value.targetSentenceId, value.targetText].filter((item) => item !== undefined);
  if (selectors.length !== 1) return false;
  if (value.targetClipId !== undefined && !isTimelineId(value.targetClipId)) return false;
  if (value.targetSentenceId !== undefined && !isTimelineId(value.targetSentenceId)) return false;
  if (value.targetText !== undefined && (!isBoundedText(value.targetText, 256) || !value.targetText.trim())) return false;
  if (value.replacementClipId !== undefined && (!isTimelineId(value.replacementClipId) || value.operation !== "replace")) return false;
  if (value.operation === "replace" && value.replacementClipId === undefined) return false;
  if (value.text !== undefined && (!isBoundedMultilineText(value.text, 8_192) || value.operation !== "subtitle" && value.operation !== "cta")) return false;
  if ((value.operation === "subtitle" || value.operation === "cta") !== (value.text !== undefined)) return false;
  if (value.amountMs !== undefined && (!isSafeInteger(value.amountMs, 1, 60_000) || value.operation !== "shorten" && value.operation !== "extend")) return false;
  if ((value.operation === "shorten" || value.operation === "extend") !== (value.amountMs !== undefined)) return false;
  return isBoundedCoreJsonValue(value, 16 * 1024);
}

export function isTimelineEditResult(value: unknown): value is TimelineEditResult {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "editVersion", "policy", "projectId", "inputKind", "status", "sourceTimelineId", "resultTimeline", "intent", "diff", "rejection", "determinismDigest"])) return false;
  if (value.schemaVersion !== 1 || value.editVersion !== "timeline-edit-v1" || value.policy !== "deterministic-natural-language-v1" || !isUuid(value.projectId) || !isTimelineId(value.sourceTimelineId) || !isTimelineProject(value.resultTimeline) || !isEditIntent(value.intent) || !isSentenceCacheKey(value.determinismDigest)) return false;
  if (value.inputKind !== "natural-language" && value.inputKind !== "structured") return false;
  if (value.status !== "applied" && value.status !== "rejected") return false;
  if (!isTimelineEditDiff(value.diff)) return false;
  if (value.status === "applied" && value.resultTimeline.id === value.sourceTimelineId) return false;
  if (value.status === "rejected" && value.resultTimeline.id !== value.sourceTimelineId) return false;
  if (value.status === "applied" && value.rejection !== null || value.status === "rejected" && !isTimelineEditRejection(value.rejection)) return false;
  return isBoundedCoreJsonValue(value, 512 * 1024);
}

function isTimelineEditDiff(value: unknown): value is TimelineEditDiff {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["changedClipIds", "removedClipIds", "movedClipIds", "durationDeltaMs", "summary", "preservedSourceIds", "preservedProvenanceIds"])) return false;
  return [value.changedClipIds, value.removedClipIds, value.movedClipIds, value.preservedSourceIds, value.preservedProvenanceIds].every((items) => Array.isArray(items) && items.length <= 4_096 && items.every(isTimelineId))
    && isSafeInteger(value.durationDeltaMs, -86_400_000, 86_400_000) && isBoundedText(value.summary, 256);
}

function isTimelineEditRejection(value: unknown): boolean {
  return isPlainRecord(value) && hasNoUnexpectedKeys(value, ["code", "message", "targetClipId"])
    && typeof value.code === "string" && ["EDIT_UNSUPPORTED_INSTRUCTION", "EDIT_TARGET_NOT_FOUND", "EDIT_AMBIGUOUS_TARGET", "EDIT_REPLACEMENT_NOT_FOUND", "EDIT_COMPLETE_SENTENCE_REQUIRED", "EDIT_TIMELINE_EMPTY", "EDIT_OPERATION_UNSAFE", "EDIT_TIMELINE_INVALID"].includes(value.code)
    && isBoundedText(value.message, 256) && (value.targetClipId === undefined || isTimelineId(value.targetClipId));
}

export function isTimelineVersionSnapshot(value: unknown): value is TimelineVersionSnapshot {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "versioningVersion", "projectId", "versionId", "timelineId", "versionNumber", "parentVersionId", "sourceType", "createdAtMs", "isActive", "editIntent", "diffSummary", "timeline"])) return false;
  return value.schemaVersion === 1 && value.versioningVersion === "timeline-version-v1" && isUuid(value.projectId) && isUuid(value.versionId) && isTimelineId(value.timelineId) && isSafeInteger(value.versionNumber, 1, 1_000_000) && (value.parentVersionId === null || isUuid(value.parentVersionId)) && (value.sourceType === "root" || value.sourceType === "edit") && isSafeInteger(value.createdAtMs, 0, Number.MAX_SAFE_INTEGER) && typeof value.isActive === "boolean" && isPlainRecord(value.editIntent) && isPlainRecord(value.diffSummary) && isTimelineProject(value.timeline);
}
export function isTimelineVersionResult(value: unknown): value is TimelineVersionResult {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["schemaVersion", "versioningVersion", "projectId", "operation", "activeVersionId", "activeRevision", "version", "editResult", "status"])) return false;
  return value.schemaVersion === 1 && value.versioningVersion === "timeline-version-v1" && isUuid(value.projectId) && ["created", "applied", "activated", "undo", "redo"].includes(value.operation as string) && (value.activeVersionId === null || isUuid(value.activeVersionId)) && isSafeInteger(value.activeRevision, 0, Number.MAX_SAFE_INTEGER) && (value.version === null || (isTimelineVersionSnapshot(value.version) && value.version.projectId === value.projectId)) && (value.editResult === undefined || value.editResult === null || isTimelineEditResult(value.editResult)) && (value.status === undefined || value.status === "rejected") && isBoundedCoreJsonValue(value, 512 * 1024);
}
export function isTimelineVersionListResult(value: unknown): value is TimelineVersionListResult {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "versioningVersion", "projectId", "activeVersionId", "items"])) return false;
  return value.schemaVersion === 1 && value.versioningVersion === "timeline-version-v1" && isUuid(value.projectId) && (value.activeVersionId === null || isUuid(value.activeVersionId)) && Array.isArray(value.items) && value.items.length <= 100 && value.items.every((item) => isTimelineVersionSnapshot(item) && item.projectId === value.projectId) && isBoundedCoreJsonValue(value, 512 * 1024);
}
export function isTimelineVersionDiffResult(value: unknown): value is TimelineVersionDiffResult {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "versioningVersion", "projectId", "fromVersionId", "toVersionId", "summary"])) return false;
  return value.schemaVersion === 1 && value.versioningVersion === "timeline-version-v1" && isUuid(value.projectId) && isUuid(value.fromVersionId) && isUuid(value.toVersionId) && isPlainRecord(value.summary) && isBoundedCoreJsonValue(value, 32 * 1024);
}

type TimelineVersionContractValue = { schemaVersion: 1; versioningVersion: "timeline-version-v1"; projectId: string };
function isTimelineVersionContract(value: unknown, keys: readonly string[]): value is TimelineVersionContractValue & Record<string, any> {
  return isPlainRecord(value) && hasNoUnexpectedKeys(value, keys) && value.schemaVersion === 1 && value.versioningVersion === "timeline-version-v1" && isUuid(value.projectId);
}
function isOptionalVersionId(value: unknown): boolean { return value === undefined || isUuid(value); }
function isOptionalVersionKey(value: unknown): boolean { return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 128); }
export function isTimelineVersionCreateParams(value: unknown): value is TimelineVersionCreateParams {
  if (!isTimelineVersionContract(value, ["schemaVersion", "versioningVersion", "projectId", "timeline", "expectedActiveVersionId", "idempotencyKey"]) || !isTimelineProject(value.timeline)) return false;
  if (!isOptionalVersionId(value.expectedActiveVersionId) || !isOptionalVersionKey(value.idempotencyKey)) return false;
  return isBoundedCoreJsonValue(value, 512 * 1024);
}
export function isTimelineVersionListParams(value: unknown): value is TimelineVersionListParams {
  if (!isTimelineVersionContract(value, ["schemaVersion", "versioningVersion", "projectId", "limit"])) return false;
  return (value.limit === undefined || isSafeInteger(value.limit, 1, 100)) && isBoundedCoreJsonValue(value, 32 * 1024);
}
export function isTimelineVersionReferenceParams(value: unknown): value is TimelineVersionReferenceParams {
  if (!isTimelineVersionContract(value, ["schemaVersion", "versioningVersion", "projectId", "versionId"])) return false;
  return isUuid(value.versionId) && isBoundedCoreJsonValue(value, 16 * 1024);
}
export function isTimelineVersionActivateParams(value: unknown): value is TimelineVersionActivateParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["schemaVersion", "versioningVersion", "projectId", "versionId", "expectedActiveVersionId"]) || !isUuid(value.projectId) || value.schemaVersion !== 1 || value.versioningVersion !== "timeline-version-v1") return false;
  return isUuid(value.versionId) && isOptionalVersionId(value.expectedActiveVersionId) && isBoundedCoreJsonValue(value, 16 * 1024);
}
export function isTimelineVersionUndoParams(value: unknown): value is TimelineVersionUndoParams {
  if (!isTimelineVersionContract(value, ["schemaVersion", "versioningVersion", "projectId", "expectedActiveVersionId"])) return false;
  return isOptionalVersionId(value.expectedActiveVersionId) && isBoundedCoreJsonValue(value, 16 * 1024);
}
export function isTimelineVersionRedoParams(value: unknown): value is TimelineVersionRedoParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["schemaVersion", "versioningVersion", "projectId", "expectedActiveVersionId", "versionId"]) || !isUuid(value.projectId) || value.schemaVersion !== 1 || value.versioningVersion !== "timeline-version-v1") return false;
  return isOptionalVersionId(value.expectedActiveVersionId) && isOptionalVersionId(value.versionId) && isBoundedCoreJsonValue(value, 16 * 1024);
}
export function isTimelineVersionApplyEditParams(value: unknown): value is TimelineVersionApplyEditParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["schemaVersion", "versioningVersion", "projectId", "sourceVersionId", "expectedActiveVersionId", "instruction", "intent", "idempotencyKey"]) || value.schemaVersion !== 1 || value.versioningVersion !== "timeline-version-v1" || !isUuid(value.projectId)) return false;
  const hasInstruction = typeof value.instruction === "string" && value.instruction.trim().length > 0 && isBoundedText(value.instruction, 2_048);
  const hasIntent = value.intent !== undefined && isEditIntent(value.intent);
  return hasInstruction !== hasIntent && isOptionalVersionId(value.sourceVersionId) && isOptionalVersionId(value.expectedActiveVersionId) && isOptionalVersionKey(value.idempotencyKey) && isBoundedCoreJsonValue(value, 64 * 1024);
}
export function isTimelineVersionDiffParams(value: unknown): value is TimelineVersionDiffParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["schemaVersion", "versioningVersion", "projectId", "fromVersionId", "toVersionId"]) || value.schemaVersion !== 1 || value.versioningVersion !== "timeline-version-v1" || !isUuid(value.projectId)) return false;
  return isUuid(value.fromVersionId) && isUuid(value.toVersionId) && isBoundedCoreJsonValue(value, 16 * 1024);
}

export function isFinalMp4ExportResult(value: unknown): value is FinalMp4ExportResult {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "exportVersion", "exportPolicy", "projectId", "timelineId", "planDigest", "qualityDigest", "audioPlanDigest", "audioFingerprint", "status", "output"])) return false;
  if (value.schemaVersion !== 1 || value.exportVersion !== "final-mp4-export-v1" || value.exportPolicy !== "verified-preview-mux-v1" || !isUuid(value.projectId) || !isTimelineId(value.timelineId) || !isSentenceCacheKey(value.planDigest) || !isSentenceCacheKey(value.qualityDigest) || !isSentenceCacheKey(value.audioPlanDigest) || !isSentenceCacheKey(value.audioFingerprint) || (value.status !== "completed" && value.status !== "cache-hit")) return false;
  if (!isFinalMp4Output(value.output)) return false;
  return isBoundedCoreJsonValue(value, 64 * 1024);
}

function isFinalMp4Output(value: unknown): value is FinalMp4Output {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["kind", "relativePath", "manifestRelativePath", "sizeBytes", "durationMs", "outputFingerprint", "container"])) return false;
  if (value.kind !== "video" || typeof value.relativePath !== "string" || !/^exports\/videos\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.mp4$/.test(value.relativePath)) return false;
  if (value.manifestRelativePath !== value.relativePath.slice(0, -4) + ".manifest.json" || !/^exports\/videos\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.manifest\.json$/.test(value.manifestRelativePath)) return false;
  if (!isSafeInteger(value.sizeBytes, 1, 512 * 1024 * 1024) || !isSafeInteger(value.durationMs, 1, 86_400_000) || !isSentenceCacheKey(value.outputFingerprint)) return false;
  return isFinalMp4Container(value.container);
}

function isFinalMp4Container(value: unknown): value is FinalMp4Container {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["formatName", "videoCodec", "audioCodec", "width", "height", "frameRate"])) return false;
  return isSafeString(value.formatName, 128) && value.formatName.split(",").some((part) => part.trim().toLowerCase() === "mp4") && value.videoCodec === "h264" && value.audioCodec === "aac"
    && value.width === 1080 && value.height === 1920
    && (value.frameRate === null || isFiniteInRange(value.frameRate, 0, 1_000));
}

export function isSentenceQaSaveParams(value: unknown): value is SentenceQaSaveParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "assetId", "sentenceCacheKey", "sentenceIndex", "contextBefore", "contextAfter", "markers"])) return false;
  const base = { ...value };
  delete base.markers;
  if (!isSentenceQaParams(base)) return false;
  const markers = (value as SentenceQaSaveParams).markers;
  return markers === undefined || Array.isArray(markers) && markers.length <= 500 && markers.every(isSentenceQaMarkerInput);
}

function isSentenceQaMarkerInput(value: unknown): value is SentenceQaMarkerInput {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["sentenceIndex", "issueType", "status", "source", "note", "expectedText"])) return false;
  const validFields = isSafeInteger(value.sentenceIndex, 0, 1_999)
    && ["missing-text", "half-sentence", "low-confidence", "boundary-uncertain", "other"].includes(value.issueType as string)
    && (value.status === undefined || value.status === "open" || value.status === "resolved")
    && (value.source === undefined || value.source === "manual" || value.source === "automatic")
    && (value.note === undefined || isBoundedText(value.note, 256))
    && (value.expectedText === undefined || value.expectedText === null || isBoundedText(value.expectedText, 2_048));
  if (!validFields) return false;
  return value.issueType !== "missing-text" || value.status === "resolved" || (value.expectedText !== undefined && value.expectedText !== null) || (typeof value.note === "string" && value.note.length > 0);
}

export function isSentenceCacheKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length <= maximumLength && !/[\u0000-\u001f]/.test(value);
}

function isBoundedMultilineText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length <= maximumLength && value.trim().length > 0
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function isSentenceQaMarker(value: unknown): value is SentenceQaMarker {
  if (!isSentenceQaMarkerInput(value) || !isPlainRecord(value)) return false;
  const marker = value as SentenceQaMarker;
  return hasOnlyKeys(value, ["sentenceIndex", "issueType", "status", "source", "note", "expectedText", "markerId", "createdAtMs", "updatedAtMs"])
    && isUuid(marker.markerId) && marker.status !== undefined && marker.source !== undefined && marker.note !== undefined
    && marker.expectedText !== undefined && isTimestamp(marker.createdAtMs) && isTimestamp(marker.updatedAtMs)
    && marker.updatedAtMs >= marker.createdAtMs;
}

function isSentenceQaContextItem(value: unknown, assetId: string): value is SentenceQaContextItem {
  return isPlainRecord(value) && hasOnlyKeys(value, ["relation", "sentence", "playback"])
    && (value.relation === "before" || value.relation === "selected" || value.relation === "after")
    && isPlainRecord(value.sentence) && isSentenceCandidate(value.sentence, value.sentence.index as number, assetId, 86_400_000)
    && isPlainRecord(value.playback) && hasOnlyKeys(value.playback, ["scheme", "assetId", "kind", "startMs", "endMs", "uri"])
    && value.playback.scheme === "supervideo" && value.playback.assetId === assetId
    && (value.playback.kind === "audio" || value.playback.kind === "video")
    && isSafeInteger(value.playback.startMs, 0, 86_400_000) && isSafeInteger(value.playback.endMs, 1, 86_400_000)
    && value.playback.endMs > value.playback.startMs
    && value.playback.uri === `supervideo://asset/${assetId}?kind=${value.playback.kind}&startMs=${value.playback.startMs}&endMs=${value.playback.endMs}`;
}

function isVadConfig(value: unknown): value is VadConfig {
  return isPlainRecord(value) && hasOnlyKeys(value, ["thresholdDb", "minSpeechMs", "minSilenceMs", "preRollMs", "postRollMs", "mergeGapMs"])
    && isFiniteInRange(value.thresholdDb, -60, -5)
    && isSafeInteger(value.minSpeechMs, 20, 5_000)
    && isSafeInteger(value.minSilenceMs, 20, 5_000)
    && isSafeInteger(value.preRollMs, 0, 180)
    && isSafeInteger(value.postRollMs, 0, 250)
    && isSafeInteger(value.mergeGapMs, 0, 1_000);
}

function isSentenceConfig(value: unknown): value is SentenceConfig {
  return isPlainRecord(value) && hasOnlyKeys(value, ["maxSentenceMs", "pauseBoundaryMs", "minSentenceMs", "preRollMs", "postRollMs"])
    && isSafeInteger(value.maxSentenceMs, 1_000, 30_000)
    && isSafeInteger(value.pauseBoundaryMs, 100, 3_000)
    && isSafeInteger(value.minSentenceMs, 0, 5_000)
    && isSafeInteger(value.preRollMs, 0, 180)
    && isSafeInteger(value.postRollMs, 0, 250);
}

function isSentenceCandidate(value: unknown, index: number, assetId: string, durationMs: number): value is SentenceCandidate {
  return isPlainRecord(value) && hasOnlyKeys(value, ["index", "sourceAssetId", "startMs", "endMs", "text", "confidence", "quality", "qualityReasons", "sourceSegmentIndexes"])
    && value.index === index && value.sourceAssetId === assetId
    && isSafeInteger(value.startMs, 0, durationMs) && isSafeInteger(value.endMs, value.startMs + 1, durationMs)
    && isSafeString(value.text, 2_048)
    && (value.confidence === null || isFiniteInRange(value.confidence, 0, 1))
    && (value.quality === "complete" && Array.isArray(value.qualityReasons) && value.qualityReasons.length === 0 || value.quality === "needs_review" && Array.isArray(value.qualityReasons) && value.qualityReasons.length > 0)
    && Array.isArray(value.qualityReasons) && value.qualityReasons.length <= 8 && value.qualityReasons.every((reason) => isSafeString(reason, 64))
    && Array.isArray(value.sourceSegmentIndexes) && value.sourceSegmentIndexes.length <= 2_000
    && value.sourceSegmentIndexes.every((sourceIndex) => isSafeInteger(sourceIndex, 0, 1_999));
}

function isSentenceIndexEntry(value: unknown, index: number, assetId: string, sourceCacheKey: string): value is SentenceIndexEntry {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["sentenceId", "sourceAssetId", "sentenceIndex", "sourceSentenceCacheKey", "startMs", "endMs", "text", "keywords", "topics", "vector", "confidence", "quality", "qualityReasons"])) return false;
  return isSentenceCacheKey(value.sentenceId) && value.sourceAssetId === assetId && value.sentenceIndex === index && value.sourceSentenceCacheKey === sourceCacheKey
    && isSafeInteger(value.startMs, 0, 86_400_000) && isSafeInteger(value.endMs, value.startMs + 1, 86_400_000)
    && isSafeString(value.text, 2_048)
    && Array.isArray(value.keywords) && value.keywords.length <= 32 && value.keywords.length > 0 && value.keywords.every((item) => isSafeString(item, 64))
    && Array.isArray(value.topics) && value.topics.length <= 8 && value.topics.length > 0 && value.topics.every((item) => isSafeString(item, 64))
    && Array.isArray(value.vector) && value.vector.length === 32 && value.vector.every((item) => isFiniteInRange(item, -1, 1))
    && (value.confidence === null || isFiniteInRange(value.confidence, 0, 1))
    && (value.quality === "complete" && Array.isArray(value.qualityReasons) && value.qualityReasons.length === 0 || value.quality === "needs_review" && Array.isArray(value.qualityReasons) && value.qualityReasons.length > 0)
    && Array.isArray(value.qualityReasons) && value.qualityReasons.length <= 8 && value.qualityReasons.every((reason) => isSafeString(reason, 64));
}

function isRetrievalCandidate(value: unknown, rank: number): value is RetrievalCandidate {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["rank", "sentenceId", "sourceAssetId", "sourceSentenceCacheKey", "sentenceIndex", "timecode", "text", "lexicalScore", "vectorScore", "hybridScore", "score", "explanation", "confidence", "quality", "qualityReasons", "previewUri"])) return false;
  if (value.rank !== rank || !isSentenceCacheKey(value.sentenceId) || !isUuid(value.sourceAssetId) || !isSentenceCacheKey(value.sourceSentenceCacheKey)) return false;
  if (!isSafeInteger(value.sentenceIndex, 0, 1_999) || !isSafeString(value.text, 2_048)) return false;
  if (!isPlainRecord(value.timecode) || !hasOnlyKeys(value.timecode, ["startMs", "endMs"]) || !isSafeInteger(value.timecode.startMs, 0, 86_400_000) || !isSafeInteger(value.timecode.endMs, 1, 86_400_000) || value.timecode.endMs <= value.timecode.startMs) return false;
  if (!isFiniteInRange(value.lexicalScore, 0, 1) || !isFiniteInRange(value.vectorScore, 0, 1) || !isFiniteInRange(value.hybridScore, 0, 1) || !isFiniteInRange(value.score, 0, 1)) return false;
  if (!isPlainRecord(value.explanation) || !hasOnlyKeys(value.explanation, ["queryKeywords", "matchedKeywords", "matchedTopics", "vectorProvider", "scoreFormula"])) return false;
  if (!Array.isArray(value.explanation.queryKeywords) || value.explanation.queryKeywords.length > 32 || !value.explanation.queryKeywords.every((item) => isSafeString(item, 64))) return false;
  if (!Array.isArray(value.explanation.matchedKeywords) || value.explanation.matchedKeywords.length > 32 || !value.explanation.matchedKeywords.every((item) => isSafeString(item, 64))) return false;
  if (!Array.isArray(value.explanation.matchedTopics) || value.explanation.matchedTopics.length > 8 || !value.explanation.matchedTopics.every((item) => isSafeString(item, 64))) return false;
  if (value.explanation.vectorProvider !== "sha256-hash-v1" || !["lexical-keyword-overlap-v1", "vector-cosine-v1", "hybrid-0.6-0.4-v1"].includes(value.explanation.scoreFormula as string)) return false;
  if (value.confidence !== null && !isFiniteInRange(value.confidence, 0, 1)) return false;
  if (value.quality !== "complete" && value.quality !== "needs_review") return false;
  if (!Array.isArray(value.qualityReasons) || value.qualityReasons.length > 8 || !value.qualityReasons.every((item) => isSafeString(item, 256))) return false;
  return value.previewUri === `supervideo://asset/${value.sourceAssetId}?kind=audio&startMs=${value.timecode.startMs}&endMs=${value.timecode.endMs}`;
}

function isRerankCandidate(value: unknown, rank: number): value is RerankCandidate {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["rank", "retrievalRank", "sentenceId", "sourceAssetId", "sourceSentenceCacheKey", "sentenceIndex", "timecode", "text", "quality", "qualityStatus", "qualityReasons", "previewUri", "scores", "explanation"])) return false;
  if (value.rank !== rank || !isSafeInteger(value.retrievalRank, 1, 50) || !isSentenceCacheKey(value.sentenceId) || !isUuid(value.sourceAssetId) || !isSentenceCacheKey(value.sourceSentenceCacheKey)) return false;
  if (!isSafeInteger(value.sentenceIndex, 0, 1_999) || !isSafeString(value.text, 2_048)) return false;
  if (!isPlainRecord(value.timecode) || !hasOnlyKeys(value.timecode, ["startMs", "endMs"]) || !isSafeInteger(value.timecode.startMs, 0, 86_400_000) || !isSafeInteger(value.timecode.endMs, 1, 86_400_000) || value.timecode.endMs <= value.timecode.startMs) return false;
  if ((value.quality !== "complete" && value.quality !== "needs_review") || value.qualityStatus !== value.quality) return false;
  if (!Array.isArray(value.qualityReasons) || value.qualityReasons.length > 8 || !value.qualityReasons.every((item) => isSafeString(item, 2_048))) return false;
  if (value.quality === "complete" && value.qualityReasons.length > 0 || value.quality === "needs_review" && value.qualityReasons.length === 0) return false;
  if (value.previewUri !== `supervideo://asset/${value.sourceAssetId}?kind=audio&startMs=${value.timecode.startMs}&endMs=${value.timecode.endMs}`) return false;
  if (!isPlainRecord(value.scores) || !hasOnlyKeys(value.scores, ["originalScore", "narrationClarityScore", "narrationQualityScore", "visualQualityScore", "sentenceCompletenessScore", "sentenceIndependenceScore", "qaScore", "duplicatePenalty", "sourceDiversityReward", "finalScore"])) return false;
  if (![value.scores.originalScore, value.scores.narrationClarityScore, value.scores.narrationQualityScore, value.scores.visualQualityScore, value.scores.sentenceCompletenessScore, value.scores.sentenceIndependenceScore, value.scores.qaScore, value.scores.duplicatePenalty, value.scores.sourceDiversityReward, value.scores.finalScore].every((item) => isFiniteInRange(item, 0, 1))) return false;
  if (!isPlainRecord(value.explanation) || !hasOnlyKeys(value.explanation, ["reasons", "qaOpenMarkerCount", "qaIssueTypes", "duplicateOfSentenceId", "selectedSourceAssetCount", "visualQualityStatus", "visualQualityReason"])) return false;
  if (!Array.isArray(value.explanation.reasons) || value.explanation.reasons.length > 8 || !value.explanation.reasons.every((item) => isSafeString(item, 96))) return false;
  if (!isSafeInteger(value.explanation.qaOpenMarkerCount, 0, 500) || !Array.isArray(value.explanation.qaIssueTypes) || value.explanation.qaIssueTypes.length > 5 || !value.explanation.qaIssueTypes.every((item) => isSafeString(item, 64))) return false;
  if (value.explanation.duplicateOfSentenceId !== null && !isSentenceCacheKey(value.explanation.duplicateOfSentenceId)) return false;
  return isSafeInteger(value.explanation.selectedSourceAssetCount, 1, 50)
    && (value.explanation.visualQualityStatus === "measured" || value.explanation.visualQualityStatus === "degraded")
    && isSafeString(value.explanation.visualQualityReason, 96);
}

function isArollTimelineInput(timeline: TimelineProject, mode: "audio" | "video", trackId?: string): boolean {
  const tracks = timeline.tracks.filter((track) => track.kind === mode && (trackId === undefined || track.id === trackId));
  const track = tracks[0];
  if (tracks.length !== 1 || track === undefined || track.clips.length < 1 || track.clips.length > 64) return false;
  const sources = new Map(timeline.sources.map((source) => [source.id, source]));
  const clips = [...track.clips].sort((left, right) => left.timelineStartMs - right.timelineStartMs || left.id.localeCompare(right.id));
  let previousEnd = 0;
  for (const clip of clips) {
    if (clip.kind !== mode || clip.sourceId === undefined || clip.sentenceId === undefined || clip.sourceInMs === undefined || clip.sourceOutMs === undefined) return false;
    if (clip.sourceOutMs - clip.sourceInMs !== clip.durationMs || clip.timelineStartMs < previousEnd) return false;
    const metadata = clip.metadata;
    if (!isPlainRecord(metadata) || metadata.sentenceStatus !== "complete") return false;
    const source = sources.get(clip.sourceId);
    if (!source || source.kind !== "asset" || source.mediaType !== mode || source.durationMs === undefined || clip.sourceOutMs > source.durationMs) return false;
    if (!isSafeString(source.uri, 32_767) || !/^supervideo:\/\/asset\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(source.uri)) return false;
    if (!isPlainRecord(source.metadata) || source.metadata.role !== "a-roll") return false;
    previousEnd = clip.timelineStartMs + clip.durationMs;
  }
  return true;
}

function isArollCutJoinSegment(value: unknown, order: number, mode: "audio" | "video"): value is ArollCutJoinSegment {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["order", "clipId", "sentenceId", "source", "sourceInMs", "sourceOutMs", "durationMs", "timelineStartMs", "outputStartMs", "outputEndMs"])) return false;
  if (!isSafeInteger(value.order, 1, 64) || value.order !== order || !isTimelineId(value.clipId) || !isSafeString(value.sentenceId, 128)) return false;
  if (!isArollSourceRef(value.source, mode)) return false;
  if (!isSafeInteger(value.sourceInMs, 0, 86_400_000) || !isSafeInteger(value.sourceOutMs, 1, 86_400_000) || !isSafeInteger(value.durationMs, 1, 86_400_000)) return false;
  if (!isSafeInteger(value.timelineStartMs, 0, 86_400_000) || !isSafeInteger(value.outputStartMs, 0, 86_400_000) || !isSafeInteger(value.outputEndMs, 1, 86_400_000)) return false;
  return value.sourceOutMs > value.sourceInMs && value.sourceOutMs <= value.source.durationMs
    && value.sourceOutMs - value.sourceInMs === value.durationMs && value.outputEndMs - value.outputStartMs === value.durationMs;
}

function isArollSourceRef(value: unknown, mode: "audio" | "video"): value is ArollSourceRef {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["sourceId", "uri", "mediaType", "durationMs", "fingerprint"])) return false;
  return isTimelineId(value.sourceId) && isSafeString(value.uri, 32_767) && new RegExp(`^supervideo://asset/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).test(value.uri)
    && value.mediaType === mode && isSafeInteger(value.durationMs, 1, 86_400_000) && (value.fingerprint === null || isSentenceCacheKey(value.fingerprint));
}

function isArollCutJoinGap(value: unknown): value is ArollCutJoinGap {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["code", "beforeClipId", "afterClipId", "startMs", "endMs", "durationMs"])) return false;
  if (value.code !== "timeline-gap" || (value.beforeClipId === null && value.afterClipId === null)) return false;
  if (value.beforeClipId !== null && !isTimelineId(value.beforeClipId) || value.afterClipId !== null && !isTimelineId(value.afterClipId)) return false;
  return isSafeInteger(value.startMs, 0, 86_400_000) && isSafeInteger(value.endMs, 1, 86_400_000) && isSafeInteger(value.durationMs, 1, 86_400_000)
    && value.endMs > value.startMs && value.endMs - value.startMs === value.durationMs;
}

function isArollCutJoinOutput(value: unknown): value is ArollCutJoinOutput {
  return isPlainRecord(value) && hasOnlyKeys(value, ["kind", "relativePath", "sizeBytes"])
    && (value.kind === "audio" || value.kind === "video") && isSafeString(value.relativePath, 512)
    && !value.relativePath.startsWith("/") && !value.relativePath.startsWith("\\")
    && !value.relativePath.includes("\\") && !value.relativePath.includes(":")
    && !value.relativePath.split("/").some((part) => part === "" || part === "." || part === "..")
    && isSafeInteger(value.sizeBytes, 1, 2 ** 53 - 1);
}

function isPreviewSourceBinding(value: unknown): value is PreviewSourceBinding {
  return isPlainRecord(value) && hasOnlyKeys(value, ["sourceId", "uri", "fingerprint", "segmentCount"])
    && isTimelineId(value.sourceId) && isSafeString(value.uri, 32_767)
    && /^supervideo:\/\/asset\/[0-9a-f-]{36}$/.test(value.uri)
    && (value.fingerprint === null || isSentenceCacheKey(value.fingerprint))
    && isSafeInteger(value.segmentCount, 1, 64);
}

function isPreviewRenderCue(value: unknown, order: number, durationMs: number): value is PreviewRenderCue {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["order", "cueId", "clipId", "sentenceId", "sourceId", "provenanceIds", "text", "timelineStartMs", "durationMs", "outputStartMs", "outputEndMs"])) return false;
  if (!isSafeInteger(value.order, 1, 2_048) || value.order !== order || !isTimelineId(value.cueId) || !isTimelineId(value.clipId)) return false;
  if (value.sentenceId !== null && !isTimelineId(value.sentenceId) || value.sourceId !== null && !isTimelineId(value.sourceId)) return false;
  if (!Array.isArray(value.provenanceIds) || value.provenanceIds.length > 32 || !value.provenanceIds.every(isTimelineId)) return false;
  if (!isBoundedText(value.text, 256) || value.text.trim().length === 0) return false;
  if (!isSafeInteger(value.timelineStartMs, 0, 86_400_000) || !isSafeInteger(value.durationMs, 1, 86_400_000) || !isSafeInteger(value.outputStartMs, 0, 86_400_000) || !isSafeInteger(value.outputEndMs, 1, 86_400_000)) return false;
  return value.outputEndMs - value.outputStartMs === value.durationMs && value.outputEndMs <= durationMs;
}

function isPreviewRenderGap(value: unknown): value is PreviewRenderGap {
  return isPlainRecord(value) && hasOnlyKeys(value, ["code", "clipId", "cueId", "detail"])
    && ["subtitle-plan-gap", "subtitle-cue-unmapped", "subtitle-cue-range-invalid"].includes(value.code as string)
    && (value.clipId === null || isTimelineId(value.clipId)) && (value.cueId === null || isTimelineId(value.cueId)) && isSafeString(value.detail, 256);
}

function isPreviewRenderLog(value: unknown): value is PreviewRenderLog {
  return isPlainRecord(value) && hasOnlyKeys(value, ["status", "stdout", "stderr"])
    && ["not-run", "cache-hit", "completed"].includes(value.status as string)
    && isBoundedText(value.stdout, 4_096) && isBoundedText(value.stderr, 4_096);
}

function isPreviewRenderOutput(value: unknown): value is PreviewRenderOutput {
  return isPlainRecord(value) && hasOnlyKeys(value, ["kind", "relativePath", "playbackUri", "sizeBytes", "durationMs", "outputFingerprint"])
    && value.kind === "video" && isSafeString(value.relativePath, 512) && /^previews\/preview-render-v1\/[0-9a-f]{64}\.mp4$/.test(value.relativePath)
    && isSafeString(value.playbackUri, 256) && /^supervideo:\/\/preview\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{64}$/.test(value.playbackUri)
    && isSafeInteger(value.sizeBytes, 1, 512 * 1024 * 1024) && isSafeInteger(value.durationMs, 1, 86_400_000) && isSentenceCacheKey(value.outputFingerprint);
}

function isPreviewQualityIssue(value: unknown): value is PreviewQualityIssue {
  return isPlainRecord(value) && hasOnlyKeys(value, ["checkId", "code", "severity", "status", "message"])
    && isSafeString(value.checkId, 64)
    && ["QA_PLAN_BINDING_INVALID", "QA_PLAN_DIGEST_MISMATCH", "QA_PLAN_ORDER_INVALID", "QA_PLAN_RANGE_INVALID", "QA_PLAN_GAP", "QA_EXECUTION_NOT_RUN", "QA_OUTPUT_MISSING", "QA_OUTPUT_PLAYBACK_URI_INVALID", "QA_OUTPUT_PATH_INVALID", "QA_OUTPUT_FILE_INVALID", "QA_OUTPUT_SIZE_MISMATCH", "QA_OUTPUT_FINGERPRINT_MISMATCH", "QA_OUTPUT_MANIFEST_INVALID", "QA_OUTPUT_DURATION_MISMATCH", "QA_OUTPUT_CONTAINER_UNVERIFIED", "QA_OUTPUT_CONTAINER_INVALID"].includes(value.code as string)
    && ["pass", "warning", "fail"].includes(value.severity as string)
    && (value.status === "verified" || value.status === "not-run")
    && isSafeString(value.message, 256);
}

function isSubtitleSentenceSource(value: unknown): value is SubtitleSentenceSource {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["sentenceId", "sourceId", "sourceInMs", "sourceOutMs", "text", "language", "provenanceIds"])) return false;
  if (!isTimelineId(value.sentenceId) || value.sourceId !== undefined && value.sourceId !== null && !isTimelineId(value.sourceId)) return false;
  if (!isSafeInteger(value.sourceInMs, 0, 86_400_000) || !isSafeInteger(value.sourceOutMs, 1, 86_400_000) || value.sourceOutMs <= value.sourceInMs || !isBoundedText(value.text, 256)) return false;
  if (value.language !== undefined && value.language !== null && !isSafeString(value.language, 32)) return false;
  return value.provenanceIds === undefined || Array.isArray(value.provenanceIds) && value.provenanceIds.length <= 32 && value.provenanceIds.every(isTimelineId);
}

function isSubtitlePlanGap(value: unknown): value is SubtitlePlanGap {
  return isPlainRecord(value) && hasOnlyKeys(value, ["code", "clipId", "sentenceId", "detail"])
    && (value.code === "missing-sentence-source" || value.code === "missing-subtitle-text")
    && isTimelineId(value.clipId) && (value.sentenceId === null || isTimelineId(value.sentenceId)) && isSafeString(value.detail, 256);
}

function isSubtitleCue(value: unknown, order: number, maxLines: number, maxLineWidth: number): value is SubtitleCue {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["order", "cueId", "clipId", "sentenceId", "sourceId", "sourceInMs", "sourceOutMs", "provenanceIds", "text", "language", "timelineStartMs", "durationMs", "timelineEndMs"])) return false;
  if (!isSafeInteger(value.order, 1, 2_048) || value.order !== order || !isTimelineId(value.cueId) || !isTimelineId(value.clipId)) return false;
  if (value.sentenceId !== null && !isTimelineId(value.sentenceId) || value.sourceId !== null && !isTimelineId(value.sourceId)) return false;
  if (!Array.isArray(value.provenanceIds) || value.provenanceIds.length > 32 || !value.provenanceIds.every(isTimelineId)) return false;
  if (!isBoundedText(value.text, 256) || value.text.trim().length === 0 || (value.language !== null && !isSafeString(value.language, 32))) return false;
  if (!isSafeInteger(value.timelineStartMs, 0, 86_400_000) || !isSafeInteger(value.durationMs, 1, 86_400_000) || !isSafeInteger(value.timelineEndMs, 1, 86_400_000) || value.timelineEndMs - value.timelineStartMs !== value.durationMs) return false;
  if ((value.sourceInMs === null) !== (value.sourceOutMs === null)) return false;
  if (value.sourceInMs !== null && (!isSafeInteger(value.sourceInMs, 0, 86_400_000) || !isSafeInteger(value.sourceOutMs, 1, 86_400_000) || value.sourceOutMs <= value.sourceInMs)) return false;
  const lines = value.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return lines.length <= maxLines && lines.every((line) => displayWidth(line) <= maxLineWidth);
}

function displayWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    if (/\p{Mark}/u.test(character)) continue;
    width += /[\u1100-\u115f\u2329\u232a\u2e80-\u303e\u3040-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(character) ? 2 : 1;
  }
  return width;
}

function isTimelineId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function isNarrativePlanGap(value: unknown): value is NarrativePlanGap {
  return isPlainRecord(value) && hasOnlyKeys(value, ["segmentId", "slotId", "role", "code", "detail"])
    && isSafeString(value.segmentId, 64) && isSafeString(value.slotId, 32)
    && ["hook", "body", "cta"].includes(value.role as string)
    && ["alignment-gap", "missing-narrative-role", "duration-outside-tolerance"].includes(value.code as string)
    && isSafeString(value.detail, 160);
}

function isNarrativePlanSource(value: unknown): value is NarrativePlanSource {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["sourceAssetId", "sourceSentenceCacheKey", "sentenceIndex", "timecode", "previewUri"])) return false;
  if (!isUuid(value.sourceAssetId) || !isSentenceCacheKey(value.sourceSentenceCacheKey) || !isSafeInteger(value.sentenceIndex, 0, 1_999) || !isBoundedText(value.previewUri, 256)) return false;
  if (!isPlainRecord(value.timecode) || !hasOnlyKeys(value.timecode, ["startMs", "endMs"]) || !isSafeInteger(value.timecode.startMs, 0, 86_400_000) || !isSafeInteger(value.timecode.endMs, 1, 86_400_000) || value.timecode.endMs <= value.timecode.startMs) return false;
  return value.previewUri === `supervideo://asset/${value.sourceAssetId}?kind=audio&startMs=${value.timecode.startMs}&endMs=${value.timecode.endMs}`;
}

function isNarrativePlanSegment(value: unknown, order: number): value is NarrativePlanSegment {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["segmentId", "order", "role", "slotId", "slotKind", "sourceText", "status", "candidateSentenceId", "candidateRank", "sentenceText", "source", "durationMs", "selectionReason", "gapReason"])) return false;
  if (!isSafeString(value.segmentId, 64) || value.order !== order || !["hook", "body", "cta"].includes(value.role as string) || !isSafeString(value.slotId, 32) || !["hook", "context", "claim", "evidence", "benefit", "requirement", "process", "cta", "closing", "other"].includes(value.slotKind as string) || !isBoundedText(value.sourceText, 512)) return false;
  if (!isSafeInteger(value.durationMs, 0, 86_400_000) || !isNarrativePlanGap(value.gapReason) && value.gapReason !== null) return false;
  if (value.status === "matched") {
    return isSentenceCacheKey(value.candidateSentenceId) && value.candidateRank === 1 && isBoundedText(value.sentenceText, 2_048)
      && isNarrativePlanSource(value.source) && value.durationMs > 0 && isSafeString(value.selectionReason, 160) && value.gapReason === null;
  }
  return value.status === "gap" && value.candidateSentenceId === null && value.candidateRank === null && value.sentenceText === null && value.source === null && value.durationMs === 0 && value.selectionReason === null && isNarrativePlanGap(value.gapReason);
}

function isDurationOptimizationSentence(value: unknown): value is DurationOptimizationSentence {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["sentenceId", "sentenceText", "source", "durationMs", "candidateRank"])) return false;
  return isSentenceCacheKey(value.sentenceId) && isBoundedText(value.sentenceText, 2_048) && isNarrativePlanSource(value.source)
    && isSafeInteger(value.durationMs, 1, 86_400_000) && value.durationMs === value.source.timecode.endMs - value.source.timecode.startMs
    && isSafeInteger(value.candidateRank, 1, 8);
}

function isDurationOptimizationSegment(value: unknown, order: number): value is DurationOptimizationSegment {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["segmentId", "order", "role", "slotId", "slotKind", "sourceText", "status", "operation", "candidateSentenceId", "candidateRank", "sentenceText", "source", "durationMs", "selectionReason", "gapReason"])) return false;
  if (!isSafeString(value.segmentId, 64) || value.order !== order || !["hook", "body", "cta"].includes(value.role as string) || !isSafeString(value.slotId, 32) || !["hook", "context", "claim", "evidence", "benefit", "requirement", "process", "cta", "closing", "other"].includes(value.slotKind as string) || !isBoundedText(value.sourceText, 512)) return false;
  if (!isSafeInteger(value.durationMs, 0, 86_400_000) || !isNarrativePlanGap(value.gapReason) && value.gapReason !== null) return false;
  if (value.status === "matched") {
    return ["keep", "replace", "add"].includes(value.operation as string) && isSentenceCacheKey(value.candidateSentenceId) && isSafeInteger(value.candidateRank, 1, 8)
      && isBoundedText(value.sentenceText, 2_048) && isNarrativePlanSource(value.source) && value.durationMs > 0 && isSafeString(value.selectionReason, 160) && value.gapReason === null;
  }
  return value.status === "gap" && value.operation === "keep" && value.candidateSentenceId === null && value.candidateRank === null && value.sentenceText === null && value.source === null && value.durationMs === 0 && value.selectionReason === null && isNarrativePlanGap(value.gapReason);
}

function isDurationOptimizationChange(value: unknown): value is DurationOptimizationChange {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["segmentId", "slotId", "role", "operation", "before", "after", "selectionReason"])) return false;
  if (!isSafeString(value.segmentId, 64) || !isSafeString(value.slotId, 32) || !["hook", "body", "cta"].includes(value.role as string) || !isSafeString(value.selectionReason, 160)) return false;
  const before = value.before === null || isDurationOptimizationSentence(value.before);
  const after = value.after === null || isDurationOptimizationSentence(value.after);
  if (!before || !after) return false;
  const beforeSentence = value.before as DurationOptimizationSentence | null;
  const afterSentence = value.after as DurationOptimizationSentence | null;
  if (value.operation === "keep") return beforeSentence !== null && afterSentence !== null && JSON.stringify(beforeSentence) === JSON.stringify(afterSentence);
  if (value.operation === "replace") return beforeSentence !== null && afterSentence !== null && beforeSentence.sentenceId !== afterSentence.sentenceId;
  if (value.operation === "add") return value.before === null && value.after !== null;
  return value.operation === "remove" && value.before !== null && value.after === null;
}

function isInformationSlot(value: unknown, order: number): value is InformationSlot {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["slotId", "order", "kind", "sourceText", "query", "keyFacts", "status", "selectedCandidateRank", "candidates", "selectionReason", "gapReason"])) return false;
  if (value.slotId !== `slot-${order}` || value.order !== order || !["hook", "context", "claim", "evidence", "benefit", "requirement", "process", "cta", "closing", "other"].includes(value.kind as string)) return false;
  if (!isBoundedText(value.sourceText, 512) || !isBoundedText(value.query, 512)) return false;
  if (!Array.isArray(value.keyFacts) || value.keyFacts.length > 8 || !value.keyFacts.every((item) => isBoundedText(item, 64))) return false;
  const keyFacts = value.keyFacts as readonly string[];
  if (!Array.isArray(value.candidates) || value.candidates.length > 8 || !value.candidates.every((candidate, index) => isSlotAlignmentCandidate(candidate, index + 1, keyFacts))) return false;
  if (value.status === "matched") {
    return value.candidates.length > 0
      && value.candidates.every((candidate) => candidate.preservedFacts.length === keyFacts.length && keyFacts.every((fact) => candidate.preservedFacts.includes(fact)))
      && value.selectedCandidateRank === 1 && isBoundedText(value.selectionReason, 128) && value.gapReason === null;
  }
  return value.status === "gap" && value.candidates.length === 0 && value.selectedCandidateRank === null && value.selectionReason === null && isBoundedText(value.gapReason, 128);
}

function isSlotAlignmentCandidate(value: unknown, rank: number, keyFacts: readonly string[]): value is SlotAlignmentCandidate {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["rank", "origin", "sentenceId", "sourceAssetId", "sourceSentenceCacheKey", "sentenceIndex", "timecode", "text", "score", "quality", "previewUri", "selectionReason", "preservedFacts"])) return false;
  if (value.rank !== rank || (value.origin !== "b08-retrieval" && value.origin !== "b09-quality-rerank") || !isSentenceCacheKey(value.sentenceId) || !isUuid(value.sourceAssetId) || !isSentenceCacheKey(value.sourceSentenceCacheKey)) return false;
  if (!isSafeInteger(value.sentenceIndex, 0, 1_999) || !isBoundedText(value.text, 2_048) || !isFiniteInRange(value.score, 0, 1) || value.quality !== "complete") return false;
  if (!isPlainRecord(value.timecode) || !hasOnlyKeys(value.timecode, ["startMs", "endMs"]) || !isSafeInteger(value.timecode.startMs, 0, 86_400_000) || !isSafeInteger(value.timecode.endMs, 1, 86_400_000) || value.timecode.endMs <= value.timecode.startMs) return false;
  if (value.previewUri !== `supervideo://asset/${value.sourceAssetId}?kind=audio&startMs=${value.timecode.startMs}&endMs=${value.timecode.endMs}`) return false;
  return isBoundedText(value.selectionReason, 128)
    && Array.isArray(value.preservedFacts)
    && value.preservedFacts.length <= 8
    && value.preservedFacts.every((item) => isBoundedText(item, 64) && keyFacts.includes(item) && extractSlotFacts(value.text as string).includes(item));
}

function extractSlotFacts(text: string): string[] {
  const source = text.replace(/^\s*\d{1,3}[.)、]\s*/gm, "");
  const patterns = [
    /\d{4}年\d{1,2}月\d{1,2}日/g,
    /\d{1,2}月\d{1,2}日/g,
    /\d+(?:\.\d+)?\s*(?:(?:万|千)?元|万|千|岁|人|天|月|年|分钟|秒|小时|%|％)/g,
    /\b[A-Z][A-Za-z0-9_-]{1,31}\b/g,
    /(?<![A-Za-z0-9])\d+(?:\.\d+)?(?![A-Za-z0-9])/g,
  ];
  const matches: Array<{ position: number; value: string }> = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match.index !== undefined) matches.push({ position: match.index, value: match[0] });
    }
  }
  const values: string[] = [];
  for (const item of matches.sort((left, right) => left.position - right.position || (left.value < right.value ? -1 : left.value > right.value ? 1 : 0))) {
    if (item.value && !values.includes(item.value)) values.push(item.value);
  }
  return values.filter((item) => !values.some((other) => item !== other && other.includes(item))).slice(0, 8);
}

function isSpeechInterval(value: unknown): value is SpeechInterval {
  return isPlainRecord(value) && hasOnlyKeys(value, ["index", "startMs", "endMs", "isSpeech", "confidence", "quality"])
    && isSafeInteger(value.index, 0, 3_999)
    && isSafeInteger(value.startMs, 0, 86_400_000)
    && isSafeInteger(value.endMs, value.startMs + 1, 86_400_000)
    && typeof value.isSpeech === "boolean"
    && (value.confidence === null || isFiniteInRange(value.confidence, 0, 1))
    && ["detected", "silence", "boundary-expanded", "boundary-clipped", "merged"].includes(value.quality as string);
}

function isTranscriptionModelInfo(value: unknown): value is TranscriptionModelInfo {
  return isPlainRecord(value) && hasOnlyKeys(value, ["adapterVersion", "provider", "modelName", "device", "computeType"])
    && value.adapterVersion === "faster-whisper-v1" && value.provider === "faster-whisper"
    && ["tiny", "base", "small", "medium", "large-v3"].includes(value.modelName as string)
    && ["cpu", "cuda"].includes(value.device as string)
    && ["int8", "float16", "float32", "int8_float16"].includes(value.computeType as string);
}

function isTranscriptionSegment(value: unknown): value is TranscriptionSegment {
  return isPlainRecord(value) && hasOnlyKeys(value, ["index", "startMs", "endMs", "text", "confidence", "avgLogprob", "noSpeechProbability", "compressionRatio", "words"])
    && isSafeInteger(value.index, 0, 1_999)
    && isSafeInteger(value.startMs, 0, 86_400_000)
    && isSafeInteger(value.endMs, value.startMs, 86_400_000)
    && isSafeString(value.text, 2_048)
    && (value.confidence === null || isFiniteInRange(value.confidence, 0, 1))
    && (value.avgLogprob === null || isFiniteInRange(value.avgLogprob, -100, 100))
    && (value.noSpeechProbability === null || isFiniteInRange(value.noSpeechProbability, 0, 1))
    && (value.compressionRatio === null || isFiniteInRange(value.compressionRatio, 0, 100))
    && Array.isArray(value.words) && value.words.length <= 128 && value.words.every(isTranscriptionWord);
}

function isTranscriptionWord(value: unknown): value is TranscriptionWord {
  return isPlainRecord(value) && hasOnlyKeys(value, ["startMs", "endMs", "text", "probability"])
    && isSafeInteger(value.startMs, 0, 86_400_000)
    && isSafeInteger(value.endMs, value.startMs, 86_400_000)
    && isSafeString(value.text, 2_048)
    && (value.probability === null || isFiniteInRange(value.probability, 0, 1));
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isMediaMetadata(value: unknown): value is MediaMetadata {
  return isPlainRecord(value) && hasOnlyKeys(value, ["schemaVersion", "formatName", "formatLongName", "durationMs", "bitRate", "streams"])
    && value.schemaVersion === 1
    && (value.formatName === null || isSafeString(value.formatName, 128))
    && (value.formatLongName === null || isSafeString(value.formatLongName, 256))
    && (value.durationMs === null || isSafeInteger(value.durationMs, 0, 86_400_000_000))
    && (value.bitRate === null || isSafeInteger(value.bitRate, 0, 10_000_000_000))
    && Array.isArray(value.streams) && value.streams.length <= 64 && value.streams.every(isMediaStream);
}

function isMediaStream(value: unknown): value is MediaStream {
  return isPlainRecord(value) && hasOnlyKeys(value, ["index", "codecType", "codecName", "width", "height", "frameRate", "sampleRate", "channels", "channelLayout", "language"])
    && isSafeInteger(value.index, 0, 100_000)
    && ["video", "audio", "data", "subtitle", "attachment", "unknown"].includes(value.codecType as string)
    && (value.codecName === null || isSafeString(value.codecName, 64))
    && (value.width === null || isSafeInteger(value.width, 1, 100_000))
    && (value.height === null || isSafeInteger(value.height, 1, 100_000))
    && (value.frameRate === null || typeof value.frameRate === "number" && Number.isFinite(value.frameRate) && value.frameRate >= 0 && value.frameRate <= 1_000)
    && (value.sampleRate === null || isSafeInteger(value.sampleRate, 1, 1_000_000))
    && (value.channels === null || isSafeInteger(value.channels, 1, 256))
    && (value.channelLayout === null || isSafeString(value.channelLayout, 64))
    && (value.language === null || isSafeString(value.language, 32));
}

function isMediaOutput(value: unknown): value is MediaOutput {
  return isPlainRecord(value) && hasOnlyKeys(value, ["kind", "relativePath", "sizeBytes"])
    && (value.kind === "audio" || value.kind === "video" || value.kind === "thumbnail")
    && isSafeString(value.relativePath, 512) && value.relativePath.startsWith("cache/media-cache-v1/")
    && isSafeInteger(value.sizeBytes, 1, Number.MAX_SAFE_INTEGER);
}

function isMediaCacheStatus(value: unknown): value is "created" | "cache-hit" {
  return value === "created" || value === "cache-hit";
}

function hasNoUnexpectedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key));
}

function isJobStatus(value: unknown): value is JobStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "retrying" || value === "cancelling" || value === "cancelled" || value === "needs_attention";
}

function isFiniteProgress(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isJobSmokeStartParams(value: unknown): value is JobSmokeStartParams {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectId", "idempotencyKey", "steps", "delayMs", "failAttempts"])
    && isUuid(value.projectId) && isSafeString(value.idempotencyKey, 256)
    && (value.steps === undefined || isSafeInteger(value.steps, 3, 8))
    && (value.delayMs === undefined || isSafeInteger(value.delayMs, 1, 1_000))
    && (value.failAttempts === undefined || isSafeInteger(value.failAttempts, 0, 1));
}

export function isJobTtsStartParams(value: unknown): value is TtsJobStartParams {
  return isTtsJobStartParams(value);
}

export function isTtsResult(value: unknown): value is TtsSynthesisResult {
  return isTtsSynthesisResult(value);
}

export function isJobReferenceParams(value: unknown): value is JobReferenceParams {
  return isPlainRecord(value) && hasOnlyKeys(value, ["projectId", "jobId"]) && isUuid(value.projectId) && isUuid(value.jobId);
}

export function isJobListParams(value: unknown): value is JobListParams {
  if (!isPlainRecord(value) || !hasNoUnexpectedKeys(value, ["projectId", "statuses", "cursor", "limit"]) || !isUuid(value.projectId)) return false;
  return (value.statuses === undefined || Array.isArray(value.statuses) && value.statuses.length <= 8 && value.statuses.every(isJobStatus))
    && (value.cursor === undefined || value.cursor === null || isSafeString(value.cursor, 512))
    && (value.limit === undefined || isSafeInteger(value.limit, 1, 100));
}

export function isJobEventsListParams(value: unknown): value is JobEventsListParams {
  return isPlainRecord(value) && hasNoUnexpectedKeys(value, ["projectId", "jobId", "afterSequence", "cursor", "limit"])
    && isUuid(value.projectId) && isUuid(value.jobId) && (value.afterSequence === undefined || isSafeInteger(value.afterSequence, 0, Number.MAX_SAFE_INTEGER))
    && (value.cursor === undefined || value.cursor === null || isSafeString(value.cursor, 64))
    && (value.limit === undefined || isSafeInteger(value.limit, 1, 100));
}

function isBoundedCoreJsonValue(value: unknown, maximumBytes: number): boolean {
  if (!isCoreJsonValue(value)) return false;
  try {
    return utf8ByteLength(JSON.stringify(value)) <= maximumBytes;
  } catch {
    return false;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 32_767
    && !value.includes("\u0000")
    && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/"));
}

function isSafeString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}
