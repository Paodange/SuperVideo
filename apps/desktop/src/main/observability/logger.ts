import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  isLogEventName,
  isLogEvent,
  LOG_MAX_DETAIL_KEY_LENGTH,
  LOG_MAX_DETAIL_STRING_LENGTH,
  LOG_MAX_DETAILS,
  LOG_MAX_FILE_BYTES,
  LOG_MAX_FILES,
  LOG_SCHEMA_VERSION,
  type AgentDiagnosticEvent,
  type LogComponent,
  type LogEvent,
  type LogLevel,
} from "@supervideo/shared";
import { redactValue, toSafeLogDetails, type RedactionStats } from "./redact";

export type StructuredLoggerOptions = Readonly<{
  logDirectory?: string;
  getLogDirectory?: () => string;
  now?: () => number;
  maxFileBytes?: number;
  maxFiles?: number;
}>;

export type LoggerSnapshot = Readonly<{
  sessionId: string;
  maxFileBytes: number;
  maxFiles: number;
  rotationCount: number;
  droppedCount: number;
  redactedCount: number;
  writeErrorCount: number;
}>;

export type StructuredLogger = ((event: string, details?: Readonly<Record<string, unknown>>) => void) & {
  readonly sessionId: string;
  write: (event: string, details?: Readonly<Record<string, unknown>>, context?: Readonly<{ component?: LogComponent; level?: LogLevel }>) => void;
  writeDiagnostic: (event: AgentDiagnosticEvent) => void;
  getRecentEvents: (limit?: number) => readonly LogEvent[];
  getSnapshot: () => LoggerSnapshot;
  flush: () => Promise<void>;
};

const ALLOWED_DETAIL_KEYS = new Set([
  "reason", "code", "kind", "url", "sender", "channel", "generation", "pid", "startupMs", "restartCount", "delayMs",
  "operation", "operationId", "projectId", "jobId", "runId", "requestId", "sequence", "status", "progress", "stage",
  "attempt", "eventType", "workerVersion", "capabilityCount", "configured", "serviceKind", "count", "durationMs", "truncated",
  "state", "available", "errorCode", "level", "coreVersion", "method",
]);

const CURRENT_LOG_FILE = "application.log";

export function createStructuredLogger(options: StructuredLoggerOptions = {}): StructuredLogger {
  const now = options.now ?? Date.now;
  const maxFileBytes = Number.isSafeInteger(options.maxFileBytes) ? Math.max(1, options.maxFileBytes!) : LOG_MAX_FILE_BYTES;
  const maxFiles = Number.isSafeInteger(options.maxFiles) ? Math.min(16, Math.max(1, options.maxFiles!)) : LOG_MAX_FILES;
  const sessionId = `session-${crypto.randomUUID()}`;
  const recentEvents: LogEvent[] = [];
  const queue: string[] = [];
  let draining = false;
  let drainPromise: Promise<void> = Promise.resolve();
  let currentBytes = 0;
  let rotationCount = 0;
  let droppedCount = 0;
  let redactedCount = 0;
  let writeErrorCount = 0;
  let initialized = false;

  const logger = ((event: string, details?: Readonly<Record<string, unknown>>) => write(event, details)) as StructuredLogger;
  Object.defineProperties(logger, {
    sessionId: { value: sessionId, enumerable: true },
    write: { value: write, enumerable: false },
    writeDiagnostic: { value: writeDiagnostic, enumerable: false },
    getRecentEvents: { value: getRecentEvents, enumerable: false },
    getSnapshot: { value: getSnapshot, enumerable: false },
    flush: { value: flush, enumerable: false },
  });

  function write(event: string, details: Readonly<Record<string, unknown>> = {}, context: Readonly<{ component?: LogComponent; level?: LogLevel }> = {}): void {
    if (!isLogEventName(event)) {
      droppedCount += 1;
      return;
    }
    const stats: RedactionStats = { redacted: 0, truncated: 0 };
    const fields: Record<string, unknown> = details && typeof details === "object" && !Array.isArray(details)
      ? details as Record<string, unknown>
      : {};
    const safeDetails = toSafeLogDetails(fields, ALLOWED_DETAIL_KEYS, stats);
    const eventValue: LogEvent = {
      schemaVersion: LOG_SCHEMA_VERSION,
      timestamp: new Date(now()).toISOString(),
      level: context.level ?? levelFor(event),
      component: context.component ?? "electron-main",
      event,
      sessionId,
      ...(stringField(fields.operationId) ? { operationId: stringField(fields.operationId) } : {}),
      ...(stringField(fields.runId) ? { runId: stringField(fields.runId) } : {}),
      ...(stringField(fields.requestId) ? { requestId: stringField(fields.requestId) } : {}),
      ...(stringField(fields.projectId) ? { projectId: stringField(fields.projectId) } : {}),
      ...(stringField(fields.jobId) ? { jobId: stringField(fields.jobId) } : {}),
      ...(stringField(fields.errorCode) ? { errorCode: stringField(fields.errorCode) } : {}),
      ...(stringField(fields.code) && isErrorCode(fields.code) ? { errorCode: stringField(fields.code) } : {}),
      correlationId: selectCorrelation(fields, sessionId),
      ...(Object.keys(safeDetails).length > 0 ? { details: safeDetails } : {}),
    };
    enqueue(eventValue, stats);
  }

  function writeDiagnostic(event: AgentDiagnosticEvent): void {
    if (!isLogEventName(event.event)) {
      droppedCount += 1;
      return;
    }
    write(event.event, {
      ...(event.operationId ? { operationId: event.operationId } : {}),
      ...(event.runId ? { runId: event.runId } : {}),
      ...(event.requestId ? { requestId: event.requestId } : {}),
      ...(event.projectId ? { projectId: event.projectId } : {}),
      ...(event.jobId ? { jobId: event.jobId } : {}),
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      ...(event.details ?? {}),
    }, { component: event.component, level: event.level });
  }

  function enqueue(event: LogEvent, stats: RedactionStats): void {
    if (!isLogEvent(event)) {
      droppedCount += 1;
      return;
    }
    const line = `${JSON.stringify(event)}\n`;
    const byteLength = Buffer.byteLength(line, "utf8");
    if (byteLength > maxFileBytes) {
      droppedCount += 1;
      return;
    }
    redactedCount += stats.redacted + stats.truncated;
    recentEvents.push(event);
    while (recentEvents.length > 200) recentEvents.shift();
    queue.push(line);
    void drain();
  }

  async function drain(): Promise<void> {
    if (draining) return drainPromise;
    draining = true;
    drainPromise = (async () => {
      try {
        const directory = options.logDirectory ?? options.getLogDirectory?.();
        if (!directory) throw new Error("log directory unavailable");
        await fs.promises.mkdir(directory, { recursive: true });
        if (!initialized) {
          currentBytes = await fileSize(path.join(directory, CURRENT_LOG_FILE));
          initialized = true;
        }
        while (queue.length > 0) {
          const line = queue.shift();
          if (line === undefined) continue;
          const bytes = Buffer.byteLength(line, "utf8");
          if (currentBytes > 0 && currentBytes + bytes > maxFileBytes) {
            await rotate(directory);
          }
          await fs.promises.appendFile(path.join(directory, CURRENT_LOG_FILE), line, { encoding: "utf8" });
          currentBytes += bytes;
        }
      } catch {
        writeErrorCount += 1;
        queue.length = 0;
      } finally {
        draining = false;
      }
    })();
    return drainPromise;
  }

  async function rotate(directory: string): Promise<void> {
    if (maxFiles === 1) {
      await fs.promises.rm(path.join(directory, CURRENT_LOG_FILE), { force: true });
      currentBytes = 0;
      rotationCount += 1;
      return;
    }
    const oldest = path.join(directory, `application.${maxFiles - 1}.log`);
    await fs.promises.rm(oldest, { force: true });
    for (let index = maxFiles - 2; index >= 1; index -= 1) {
      await renameIfExists(path.join(directory, `application.${index}.log`), path.join(directory, `application.${index + 1}.log`));
    }
    await renameIfExists(path.join(directory, CURRENT_LOG_FILE), path.join(directory, "application.1.log"));
    currentBytes = 0;
    rotationCount += 1;
  }

  async function flush(): Promise<void> {
    while (draining || queue.length > 0) {
      await drainPromise;
    }
  }

  function getRecentEvents(limit = 200): readonly LogEvent[] {
    return Object.freeze(recentEvents.slice(Math.max(0, recentEvents.length - Math.min(200, Math.max(0, limit)))));
  }

  function getSnapshot(): LoggerSnapshot {
    return Object.freeze({ sessionId, maxFileBytes, maxFiles, rotationCount, droppedCount, redactedCount, writeErrorCount });
  }

  return Object.freeze(logger);
}

function levelFor(event: string): LogLevel {
  return event.includes("failed") || event.includes("error") ? "error" : event.includes("rejected") || event.includes("timeout") || event.includes("unavailable") ? "warn" : "info";
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : undefined;
}

function selectCorrelation(fields: Record<string, unknown>, sessionId: string): string {
  return stringField(fields.jobId) ?? stringField(fields.operationId) ?? stringField(fields.requestId) ?? stringField(fields.runId) ?? sessionId;
}

function isErrorCode(value: unknown): boolean {
  return typeof value === "string" && value.length <= 128 && /^[A-Z0-9_-]+$/.test(value);
}

async function fileSize(value: string): Promise<number> {
  try {
    return (await fs.promises.stat(value)).size;
  } catch {
    return 0;
  }
}

async function renameIfExists(source: string, destination: string): Promise<void> {
  try {
    await fs.promises.rename(source, destination);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") throw error;
  }
}
