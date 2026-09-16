import type { LogDetailValue } from "@supervideo/shared";

export const REDACTED_VALUE = "[REDACTED]" as const;
export const REDACTED_PATH = "[REDACTED_PATH]" as const;
export const REDACTED_PROMPT = "[REDACTED_PROMPT]" as const;

export type RedactionStats = { redacted: number; truncated: number };

const SENSITIVE_KEY = /authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|bearer|cookie|set[-_]?cookie|password|secret|credential|ciphertext|prompt|input[-_]?json|result[-_]?json|checkpoint|headers?|request[-_]?body|response[-_]?body/i;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/gi;
const CONNECTION_PASSWORD_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>:@]+:)[^\s"'<>@]+(@)/gi;
const TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{8,}|rk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[0-9A-Za-z_-]{16,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;
const WINDOWS_PATH_PATTERN = /(^|[\s"'=(])((?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>;]+)/g;
const POSIX_PATH_PATTERN = /\/(?:Users|Users\/|home|private|tmp|var|mnt|opt)\/[^\s"'<>;]+/gi;
const MAX_DEPTH = 8;
const MAX_KEYS = 64;
const MAX_ARRAY_ITEMS = 64;
const MAX_STRING_LENGTH = 1_024;

/**
 * Convert arbitrary diagnostic input into bounded JSON-safe data. This is a
 * defensive layer only; callers still use field allowlists before logging.
 */
export function redactValue(value: unknown, stats: RedactionStats = { redacted: 0, truncated: 0 }): unknown {
  const seen = new WeakSet<object>();
  try {
    return redact(value, "", 0, seen, stats);
  } catch {
    stats.redacted += 1;
    return REDACTED_VALUE;
  }
}

export function redactString(value: string, stats: RedactionStats = { redacted: 0, truncated: 0 }): string {
  let result = value;
  result = result.replace(URL_PATTERN, (match) => sanitizeUrl(match, stats));
  result = result.replace(BEARER_PATTERN, () => {
    stats.redacted += 1;
    return "Bearer [REDACTED]";
  });
  result = result.replace(CONNECTION_PASSWORD_PATTERN, (_match, prefix: string, suffix: string) => {
    stats.redacted += 1;
    return `${prefix}${REDACTED_VALUE}${suffix}`;
  });
  result = result.replace(TOKEN_PATTERN, () => {
    stats.redacted += 1;
    return REDACTED_VALUE;
  });
  result = result.replace(WINDOWS_PATH_PATTERN, (_match, prefix: string) => {
    stats.redacted += 1;
    return `${prefix}${REDACTED_PATH}`;
  });
  result = result.replace(POSIX_PATH_PATTERN, () => {
    stats.redacted += 1;
    return REDACTED_PATH;
  });
  if (result.length > MAX_STRING_LENGTH) {
    stats.truncated += 1;
    return `${result.slice(0, MAX_STRING_LENGTH - 1)}…`;
  }
  return result;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function toSafeLogDetails(
  value: Readonly<Record<string, unknown>> | undefined,
  allowedKeys: ReadonlySet<string>,
  stats: RedactionStats,
): Readonly<Record<string, LogDetailValue>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, LogDetailValue> = {};
  try {
    for (const [key, raw] of Object.entries(value).slice(0, MAX_KEYS)) {
      if (!allowedKeys.has(key) || isSensitiveKey(key)) continue;
      const safe = redactValue(raw, stats);
      if (safe === null || typeof safe === "boolean" || typeof safe === "number" && Number.isFinite(safe)) {
        output[key] = safe;
      } else if (typeof safe === "string") {
        output[key] = safe.slice(0, 512);
      }
    }
  } catch {
    stats.redacted += 1;
  }
  return Object.freeze(output);
}

function redact(value: unknown, key: string, depth: number, seen: WeakSet<object>, stats: RedactionStats): unknown {
  if (isSensitiveKey(key)) {
    stats.redacted += 1;
    return key.toLowerCase().includes("prompt") ? REDACTED_PROMPT : REDACTED_VALUE;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return redactString(value, stats);
  if (typeof value === "number") return Number.isFinite(value) ? value : REDACTED_VALUE;
  if (typeof value === "bigint") {
    stats.redacted += 1;
    return REDACTED_VALUE;
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") {
    stats.redacted += 1;
    return REDACTED_VALUE;
  }
  if (value instanceof Error) {
    stats.redacted += value.stack ? 1 : 0;
    const error: Record<string, unknown> = { name: value.name || "Error", message: redactString(value.message, stats) };
    const code = (value as Error & { code?: unknown }).code;
    if (typeof code === "string" && code.length <= 128) error.code = redactString(code, stats);
    return error;
  }
  if (depth >= MAX_DEPTH) {
    stats.truncated += 1;
    return "[TRUNCATED]";
  }
  if (typeof value !== "object") {
    stats.redacted += 1;
    return REDACTED_VALUE;
  }
  if (seen.has(value)) {
    stats.redacted += 1;
    return "[CIRCULAR]";
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, "", depth + 1, seen, stats));
      if (value.length > MAX_ARRAY_ITEMS) {
        stats.truncated += 1;
        output.push("[TRUNCATED]");
      }
      return output;
    }
    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value).slice(0, MAX_KEYS)) {
      output[childKey] = redact(child, childKey, depth + 1, seen, stats);
    }
    if (Object.keys(value).length > MAX_KEYS) {
      stats.truncated += 1;
      output._truncated = true;
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function sanitizeUrl(value: string, stats: RedactionStats): string {
  try {
    const url = new URL(value);
    stats.redacted += url.search || url.hash || url.username || url.password ? 1 : 0;
    const port = url.port ? `:${url.port}` : "";
    const pathname = url.pathname && url.pathname !== "/" ? "/[path]" : "/";
    return `${url.protocol}//${url.hostname}${port}${pathname}`;
  } catch {
    stats.redacted += 1;
    return "[REDACTED_URL]";
  }
}
