import { createStructuredLogger, type StructuredLogger, type StructuredLoggerOptions } from "../observability/logger";
import type { SecurityLog } from "./ipc";

export function createSecurityLogger(options: StructuredLoggerOptions = {}): SecurityLog & StructuredLogger {
  return createStructuredLogger(options) as SecurityLog & StructuredLogger;
}
