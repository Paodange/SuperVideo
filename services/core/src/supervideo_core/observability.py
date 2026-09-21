"""Small, stderr-only structured diagnostics boundary for Python Core.

stdout remains exclusively JSON-RPC. This module has no file or network sink;
the Agent Worker validates these bounded events before Main persists them.
"""

from __future__ import annotations

import math
import re
import sys
from datetime import datetime, timezone
from typing import Any, TextIO

LOG_SCHEMA_VERSION = 1
MAX_LINE_BYTES = 4 * 1024
REDACTED = "[REDACTED]"
REDACTED_PATH = "[REDACTED_PATH]"
REDACTED_PROMPT = "[REDACTED_PROMPT]"

SENSITIVE_KEY = re.compile(
    r"authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|bearer|cookie|set[-_]?cookie|password|secret|credential|ciphertext|prompt|input[-_]?json|result[-_]?json|checkpoint|headers?|request[-_]?body|response[-_]?body",
    re.IGNORECASE,
)
URL_PATTERN = re.compile(r"\bhttps?://[^\s\"'<>]+", re.IGNORECASE)
BEARER_PATTERN = re.compile(r"\bBearer\s+[^\s,;]+", re.IGNORECASE)
TOKEN_PATTERN = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{8,}|rk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[0-9A-Za-z_-]{16,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b")
WINDOWS_PATH_PATTERN = re.compile(r"(^|[\s\"'=(])((?:[A-Za-z]:[\\/]|\\\\)[^\s\"'<>;]+)")
POSIX_PATH_PATTERN = re.compile(r"/(?:Users|home|private|tmp|var|mnt|opt)/[^\s\"'<>;]+", re.IGNORECASE)
ALLOWED_DETAIL_KEYS = {
    "reason", "code", "kind", "url", "sender", "channel", "generation", "pid", "startupMs", "restartCount", "delayMs",
    "operation", "operationId", "projectId", "jobId", "runId", "requestId", "sequence", "status", "progress", "stage",
    "attempt", "eventType", "workerVersion", "capabilityCount", "configured", "serviceKind", "count", "durationMs", "truncated",
    "state", "available", "errorCode", "level", "coreVersion", "method",
}
EVENT_NAMES = {
    "app-started", "app-ready", "app-shutdown", "core-started", "core-ready", "core-request-started", "core-request-finished",
    "core-request-failed", "core-exit", "job-event", "core-stderr-rejected", "diagnostic-event-rejected",
}


def redact_string(value: str, stats: dict[str, int] | None = None) -> str:
    counters = stats if stats is not None else {"redacted": 0, "truncated": 0}

    def url_replacement(match: re.Match[str]) -> str:
        from urllib.parse import urlsplit

        try:
            parsed = urlsplit(match.group(0))
            counters["redacted"] += int(bool(parsed.query or parsed.fragment or parsed.username or parsed.password))
            port = f":{parsed.port}" if parsed.port else ""
            return f"{parsed.scheme}://{parsed.hostname}{port}{'/[path]' if parsed.path and parsed.path != '/' else '/'}"
        except ValueError:
            counters["redacted"] += 1
            return "[REDACTED_URL]"

    result = URL_PATTERN.sub(url_replacement, value)
    result = BEARER_PATTERN.sub(lambda _match: _redact(counters, "Bearer [REDACTED]"), result)
    result = re.sub(r"(\b[a-z][a-z0-9+.-]*://[^\s\"'<>:@]+:)[^\s\"'<>@]+(@)", lambda match: _redact(counters, f"{match.group(1)}{REDACTED}{match.group(2)}"), result, flags=re.IGNORECASE)
    result = TOKEN_PATTERN.sub(lambda _match: _redact(counters, REDACTED), result)
    result = WINDOWS_PATH_PATTERN.sub(lambda match: f"{match.group(1)}{_redact(counters, REDACTED_PATH)}", result)
    result = POSIX_PATH_PATTERN.sub(lambda _match: _redact(counters, REDACTED_PATH), result)
    if len(result) > 1024:
        counters["truncated"] += 1
        result = result[:1023] + "…"
    return result


def redact_value(value: Any, key: str = "", depth: int = 0, seen: set[int] | None = None, stats: dict[str, int] | None = None) -> Any:
    counters = stats if stats is not None else {"redacted": 0, "truncated": 0}
    visited = seen if seen is not None else set()
    if SENSITIVE_KEY.search(key):
        counters["redacted"] += 1
        return REDACTED_PROMPT if "prompt" in key.lower() else REDACTED
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str):
        return redact_string(value, counters)
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            counters["redacted"] += 1
            return REDACTED
        return value
    if depth >= 8:
        counters["truncated"] += 1
        return "[TRUNCATED]"
    identity = id(value)
    if identity in visited:
        counters["redacted"] += 1
        return "[CIRCULAR]"
    if isinstance(value, (list, tuple, dict)):
        visited.add(identity)
        try:
            if isinstance(value, (list, tuple)):
                output = [redact_value(item, depth=depth + 1, seen=visited, stats=counters) for item in list(value)[:64]]
                if len(value) > 64:
                    counters["truncated"] += 1
                    output.append("[TRUNCATED]")
                return output
            output = {}
            for child_key, child in list(value.items())[:64]:
                output[str(child_key)] = redact_value(child, str(child_key), depth + 1, visited, counters)
            if len(value) > 64:
                counters["truncated"] += 1
                output["_truncated"] = True
            return output
        finally:
            visited.remove(identity)
    counters["redacted"] += 1
    return REDACTED


class StructuredDiagnosticLogger:
    """Emit allowlisted, bounded events to Core stderr."""

    def __init__(self, stream: TextIO | None = None) -> None:
        self.stream = stream or sys.stderr

    def emit(
        self,
        event: str,
        *,
        level: str = "info",
        request_id: str | None = None,
        operation_id: str | None = None,
        project_id: str | None = None,
        job_id: str | None = None,
        details: dict[str, Any] | None = None,
        error_code: str | None = None,
    ) -> None:
        if event not in EVENT_NAMES or level not in {"debug", "info", "warn", "error"}:
            return
        counters = {"redacted": 0, "truncated": 0}
        safe_details: dict[str, Any] = {}
        for key, value in list((details or {}).items())[:24]:
            if key not in ALLOWED_DETAIL_KEYS or SENSITIVE_KEY.search(key):
                continue
            safe = redact_value(value, key, stats=counters)
            if isinstance(safe, str):
                safe = safe[:512]
            if safe is None or isinstance(safe, (str, bool)) or isinstance(safe, (int, float)) and not isinstance(safe, bool) and math.isfinite(safe):
                safe_details[key] = safe
        payload: dict[str, Any] = {
            "schemaVersion": LOG_SCHEMA_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": level,
            "component": "python-core",
            "event": event,
        }
        for key, value in (("operationId", operation_id), ("requestId", request_id), ("projectId", project_id), ("jobId", job_id), ("errorCode", error_code)):
            if isinstance(value, str) and value:
                payload[key] = value[:256]
        if safe_details:
            payload["details"] = safe_details
        try:
            line = __import__("json").dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            if len(line.encode("utf-8")) > MAX_LINE_BYTES:
                return
            self.stream.write(line + "\n")
            self.stream.flush()
        except (OSError, TypeError, ValueError):
            # Diagnostics are best effort and must never change job truth.
            return


def _redact(counters: dict[str, int], value: str) -> str:
    counters["redacted"] += 1
    return value
