import {
  DIAGNOSTICS_VERSION,
  DIAGNOSTICS_MAX_LOG_EVENTS,
  isCredentialStorageStatus,
  isDiagnosticDocument,
  isLogEvent,
  LOG_SCHEMA_VERSION,
  type AgentWorkerStatusSnapshot,
  type CredentialMetadata,
  type CredentialServiceKind,
  type CredentialStorageStatus,
  type DiagnosticDocument,
  type JobStatus,
  type JobSummary,
  type LogEvent,
} from "@supervideo/shared";
import type { CredentialVault } from "../security/credential-vault";
import type { StructuredLogger } from "../observability/logger";

export type DiagnosticProjectState = Readonly<{
  open: boolean;
  manifestSchemaVersion: number | null;
  databaseSchemaVersion: number | null;
}>;

export type DiagnosticCoreState = Readonly<{
  status: string;
  protocolVersion: number;
  coreVersion: string | null;
  capabilityCount: number;
}>;

export type DiagnosticsCollectorOptions = Readonly<{
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  pythonCoreVersion?: string;
  platform: string;
  release: string;
  architecture: string;
  getWorkerStatus: () => AgentWorkerStatusSnapshot;
  getCoreState?: () => DiagnosticCoreState;
  getProject: () => DiagnosticProjectState;
  getJobs: () => readonly JobSummary[];
  vault: Pick<CredentialVault, "status" | "list">;
  logger: StructuredLogger;
}>;

export class DiagnosticsCollector {
  private readonly options: DiagnosticsCollectorOptions;

  constructor(options: DiagnosticsCollectorOptions) {
    this.options = options;
  }

  async collect(): Promise<DiagnosticDocument> {
    const storageStatus = this.options.vault.status();
    const credentials = await this.readCredentialMetadata(storageStatus);
    const counts = emptyCredentialCounts();
    for (const item of credentials) counts[item.serviceKind] += 1;
    const jobs = this.options.getJobs();
    const countsByStatus: Record<string, number> = {};
    for (const status of ["queued", "running", "succeeded", "failed", "retrying", "cancelling", "cancelled", "needs_attention"] as const) {
      countsByStatus[status] = jobs.filter((job) => job.status === status).length;
    }
    const recentErrors = jobs
      .filter((job) => job.errorCode !== null)
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
      .slice(0, 10)
      .map((job) => Object.freeze({ errorCode: job.errorCode!, timestamp: job.updatedAtMs }));
    const worker = this.options.getWorkerStatus();
    const core = this.options.getCoreState?.() ?? {
      status: "unknown",
      protocolVersion: 1,
      coreVersion: this.options.pythonCoreVersion ?? null,
      capabilityCount: 0,
    };
    const logger = this.options.logger.getSnapshot();
    const document: DiagnosticDocument = {
      diagnosticsVersion: DIAGNOSTICS_VERSION,
      generatedAt: new Date().toISOString(),
      application: {
        version: bounded(this.options.appVersion, "unknown"),
        electronVersion: bounded(this.options.electronVersion, "unknown"),
        nodeVersion: bounded(this.options.nodeVersion, "unknown"),
        pythonCoreVersion: bounded(core.coreVersion ?? this.options.pythonCoreVersion ?? "unknown", "unknown"),
      },
      platform: {
        platform: bounded(this.options.platform, "unknown"),
        release: bounded(this.options.release, "unknown"),
        architecture: bounded(this.options.architecture, "unknown"),
      },
      worker: {
        status: worker.status,
        protocolVersion: 1,
        generation: worker.generation,
        workerVersion: worker.workerVersion,
        capabilityCount: worker.capabilities.length,
        restartCount: worker.restartCount,
        lastErrorCode: worker.lastErrorCode,
      },
      core,
      safeStorage: storageStatus,
      credentials: { configuredByServiceKind: counts },
      project: this.options.getProject(),
      jobs: { countsByStatus, recentErrors },
      logging: {
        schemaVersion: LOG_SCHEMA_VERSION,
        maxFileBytes: logger.maxFileBytes,
        maxFiles: logger.maxFiles,
        rotationCount: logger.rotationCount,
        droppedCount: logger.droppedCount,
        redactedCount: logger.redactedCount,
        writeErrorCount: logger.writeErrorCount,
      },
      recentLogs: this.options.logger.getRecentEvents(DIAGNOSTICS_MAX_LOG_EVENTS),
      truncated: false,
    };
    if (!isDiagnosticDocument(document)) throw new Error(diagnosticModelFailureReason(document));
    return Object.freeze(document);
  }

  private async readCredentialMetadata(status: CredentialStorageStatus): Promise<readonly CredentialMetadata[]> {
    if (!isCredentialStorageStatus(status) || status.state !== "available") return [];
    try {
      return (await this.options.vault.list()).items;
    } catch {
      return [];
    }
  }
}

function diagnosticModelFailureReason(document: DiagnosticDocument): string {
  const checks: readonly [string, boolean][] = [
    ["application", isPlainRecord(document.application) && Object.values(document.application).every((value) => typeof value === "string")],
    ["platform", isPlainRecord(document.platform) && Object.values(document.platform).every((value) => typeof value === "string")],
    ["worker", isPlainRecord(document.worker) && typeof document.worker.status === "string"],
    ["core", isPlainRecord(document.core) && typeof document.core.status === "string"],
    ["safeStorage", isCredentialStorageStatus(document.safeStorage)],
    ["credentials", isPlainRecord(document.credentials)],
    ["project", isPlainRecord(document.project)],
    ["jobs", isPlainRecord(document.jobs)],
    ["logging", isPlainRecord(document.logging)],
    ["recentLogs", Array.isArray(document.recentLogs) && document.recentLogs.every((event) => isLogEvent(event))],
  ];
  return `Diagnostic model failed validation: ${checks.find(([, valid]) => !valid)?.[0] ?? "document"}.`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function emptyCredentialCounts(): Record<CredentialServiceKind, number> {
  return { llm: 0, tts: 0, image: 0, video: 0 };
}

function bounded(value: string, fallback: string): string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : fallback;
}

export type { JobStatus, LogEvent };
