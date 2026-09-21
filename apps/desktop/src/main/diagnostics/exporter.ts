import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DIAGNOSTICS_MAX_FILE_BYTES,
  DIAGNOSTICS_MAX_LOG_BYTES,
  isDiagnosticDocument,
  type DiagnosticDocument,
  type DiagnosticExportResult,
} from "@supervideo/shared";
import { redactValue } from "../observability/redact";
import type { DiagnosticsCollector } from "./collector";

export type DiagnosticsSaveDialog = (owner: unknown, options: Readonly<{
  defaultPath: string;
  filters: readonly Readonly<{ name: string; extensions: readonly string[] }>[];
  title: string;
}>) => Promise<Readonly<{ canceled: boolean; filePath?: string }> | { canceled: boolean; filePath?: string }>;

export class DiagnosticsExporterError extends Error {
  readonly code = "DIAGNOSTIC_EXPORT_FAILED" as const;

  constructor(readonly phase: "dialog" | "collect" | "validate" | "write" = "validate") {
    super("Diagnostics could not be exported.");
    this.name = "DiagnosticsExporterError";
  }
}

export async function exportDiagnostics(options: Readonly<{
  owner: unknown;
  showSaveDialog: DiagnosticsSaveDialog;
  collector: DiagnosticsCollector;
  now?: () => number;
}>): Promise<DiagnosticExportResult> {
  const now = options.now ?? Date.now;
  let selection: Readonly<{ canceled: boolean; filePath?: string }>;
  try {
    selection = await options.showSaveDialog(options.owner, {
      title: "Export SuperVideo diagnostics",
      defaultPath: `supervideo-diagnostics-${formatFilenameTimestamp(now())}.json`,
      filters: [{ name: "JSON diagnostics", extensions: ["json"] }],
    });
  } catch {
    throw new DiagnosticsExporterError("dialog");
  }
  if (selection.canceled || !selection.filePath) return Object.freeze({ status: "cancelled" });
  if (!path.isAbsolute(selection.filePath) || selection.filePath.includes("\u0000")) throw new DiagnosticsExporterError("validate");

  let collected: DiagnosticDocument;
  try {
    collected = await options.collector.collect();
  } catch {
    throw new DiagnosticsExporterError("collect");
  }
  let document: DiagnosticDocument;
  try {
    document = fitWithinLimit(collected);
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > DIAGNOSTICS_MAX_FILE_BYTES || !isDiagnosticDocument(document)) throw new Error("invalid-document");
    await writeAtomic(selection.filePath, serialized);
  } catch (error) {
    if (error instanceof DiagnosticsExporterError) throw error;
    throw new DiagnosticsExporterError("write");
  }
  return Object.freeze({ status: "saved" });
}

export function fitWithinLimit(document: DiagnosticDocument): DiagnosticDocument {
  let recentLogs = [...document.recentLogs];
  let truncated = false;
  for (;;) {
    const candidate = sanitizeDocument({ ...document, recentLogs, truncated });
    const encoded = JSON.stringify(candidate, null, 2);
    const logBytes = Buffer.byteLength(JSON.stringify(candidate.recentLogs), "utf8");
    if (logBytes <= DIAGNOSTICS_MAX_LOG_BYTES && Buffer.byteLength(encoded, "utf8") + 1 <= DIAGNOSTICS_MAX_FILE_BYTES) return Object.freeze(candidate);
    if (recentLogs.length === 0) throw new DiagnosticsExporterError("validate");
    recentLogs = recentLogs.slice(1);
    truncated = true;
  }
}

export async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(temporaryPath, "wx");
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.promises.rename(temporaryPath, filePath);
  } catch {
    if (handle !== undefined) {
      try { await handle.close(); } catch { /* best effort */ }
    }
    try { await fs.promises.rm(temporaryPath, { force: true }); } catch { /* old target remains untouched */ }
    throw new DiagnosticsExporterError();
  }
}

function sanitizeDocument(document: DiagnosticDocument): DiagnosticDocument {
  const stats = { redacted: 0, truncated: 0 };
  const redactedLogs = redactValue(document.recentLogs, stats);
  const redacted = { ...document, recentLogs: redactedLogs };
  if (!isDiagnosticDocument(redacted)) throw new DiagnosticsExporterError();
  return Object.freeze({ ...redacted, truncated: document.truncated || stats.truncated > 0 });
}

function formatFilenameTimestamp(value: number): string {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
