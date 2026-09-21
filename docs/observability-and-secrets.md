# A08 observability, diagnostics and credentials

A08 keeps all security-sensitive storage in Electron Main. Renderer has only
the fixed `credentials.status/list/save/replace/remove` and
`diagnostics.export` capabilities exposed by preload. There is no generic IPC,
filesystem, decrypt, reveal or copy-secret method.

## Credential vault

On Windows the production adapter is Electron `safeStorage`, backed by the
current Windows user's DPAPI. The vault is stored outside project folders at:

```text
<Electron userData>\security\credentials.v1.json
```

The versioned file contains credential metadata and Base64 encoding of the
bytes returned by `safeStorage.encryptString()`. Base64 is only transport
encoding; it is not the encryption mechanism. Writes use a same-directory
temporary file, flush/sync, close and atomic replace. A failed write leaves the
old file in place.

If safe storage is unavailable, save/replace/remove/list fail with the stable
`CREDENTIAL_STORAGE_UNAVAILABLE` code and no plaintext fallback is attempted.
Malformed, newer, oversized, duplicate or undecryptable files report
`CREDENTIAL_STORE_CORRUPT`; the vault never silently clears or repairs them.
Delete is idempotent: deleting an unknown `credentialRef` returns
`{ removed: false }`. Secrets are cleared from the Renderer input immediately
after the one-way call and are never returned, logged, placed in project
SQLite/manifest data, or included in diagnostics.

## Structured logs

Main writes version 1 JSONL events to `<Electron userData>\logs\application.log`.
The current file is bounded to 5 MiB and at most two rotated files are kept
(three files total); rotation uses fixed names in that directory. Writes are
queued asynchronously, so a slow log sink does not block Renderer, Worker or
Core task loops. Each event has a UTC timestamp, level, component, stable event
name, Main `sessionId`, optional correlation IDs and scalar allowlisted details.

The correlation rule is fixed as `jobId > operationId > requestId > runId >
sessionId`. Main lifecycle, project/job operations, job terminal events,
credential metadata operations and diagnostic export are logged. Worker
lifecycle and Python Core stderr events use one fixed, size-limited
`diagnostic-event` Worker message and the existing A07 outbound validator.

The persisted boundary never contains API keys, bearer/cookie headers,
ciphertext, secret length or hash, prompts, RPC/IPC params/results, job
input/result/checkpoint payloads, stacks, environment variables, full command
lines, project/material names, absolute paths or the export target path. The
TypeScript redactor is a defensive second line: it handles sensitive keys,
URLs, common token prefixes, paths, errors, cycles, BigInt, non-finite numbers
and bounded recursion. The Python Core uses the same synthetic golden fixture
semantics and writes only structured diagnostics to stderr; stdout remains
JSON-RPC only.

## Diagnostics export

The user explicitly clicks **Export diagnostics**. Main opens the native save
dialog and writes one versioned JSON file named
`supervideo-diagnostics-YYYYMMDD-HHmmss.json`. The Renderer receives only
`{ status: "saved" }` or `{ status: "cancelled" }`; it does not receive the
selected path.

The document includes app/runtime/platform versions, Worker/Core state and
protocol versions, safe-storage availability, credential counts by service
kind, project/schema presence, job status counts and a few stable error codes,
log rotation counters, and at most 200 recent redacted events. Recent events
are capped at 256 KiB and the complete file at 512 KiB; oversized exports are
trimmed deterministically and marked `truncated: true`. It contains no project
ID/name/path, provider/display name, credential reference/ciphertext, media
data, SQLite pages/WAL/SHM, environment variables or browser/system logs.
Failed writes are atomic and leave no temporary export file.

`npm run diagnostics:smoke` exercises a temporary fake encryption adapter,
synthetic secret/log input, bounded export, metadata-only listing and cleanup.
It is offline and never uses real Electron user data or a real project.

A08 does not connect to providers, test network health, upload diagnostics,
copy secrets to the clipboard, or open external URLs. D01 may add provider
health checks and G08 may expand installation diagnostics, but Main remains the
only component allowed to decrypt credentials.
