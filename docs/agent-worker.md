# A03 Agent Worker

## Boundary

The Electron Main process owns one `utilityProcess` for the Agent Worker. The
Renderer only sees the frozen, typed preload API; it never receives a
`MessagePort`, `UtilityProcess`, Pi object, model object, or raw IPC method.
The Worker has Node.js because it is a separate process, but A03 registers only
the in-memory `smoke_countdown` tool. It does not read files, spawn commands,
access the network, or start Python Core.

```text
Renderer -> preload allowlist -> Electron Main controller -> utilityProcess -> Pi faux agent
```

## Protocol

`packages/shared/src/agent-protocol.ts` owns the versioned Worker wire contract
(`protocolVersion: 1`). Main-to-Worker commands are `run-smoke-task`,
`cancel-run`, `ping`, and `shutdown`. Worker-to-Main messages are `ready`,
`pong`, `run-event`, `run-finished`, `worker-error`, `project-operation-result`,
and `project-operation-error`.

Every message is checked at runtime for its version, type, required fields,
run-id format, JSON-safe values, and the 64 KiB message limit. Product events
are stable summaries: run lifecycle, assistant text deltas, tool start,
progress, finish, and terminal status. Pi internal state, transcripts,
provider objects, prompts, and stacks never cross the boundary.

The same run uses a strictly increasing `sequence` so a future UI or
persistence layer can deduplicate events. The desktop event channel is a
separate versioned allowlist and is validated again in preload before reaching
React.

## Lifecycle and restart policy

`AgentWorkerController` is the single Main owner. It exposes `start`,
`getStatus`, `runSmokeTask`, `cancelRun`, and `shutdown`. It waits up to five
seconds for `ready`, records generation/PID/startup duration in Main
diagnostics, and ignores messages from old generations. Unexpected exits are
retried with 100 ms, 250 ms, and 750 ms backoff, with at most three restart
attempts in a 30-second window. After the limit, status becomes `unavailable`;
there is no crash loop. App shutdown marks the process intentional, asks the
Worker to exit gracefully, and kills it only after the shutdown timeout.

If a Worker exits during a run, Main emits an `interrupted` terminal event.
There is no cross-restart A03 smoke-run persistence. A07 persistence and
recovery belong to the Python/SQLite job system and use a separate `jobId`.

A06 adds fixed Main-to-Worker project commands: `project-create`,
`project-open`, `project-inspect`, `asset-reference`, and `asset-list`. B01 adds
the fixed `asset-scan` command; its payload is still a typed project operation,
not a generic filesystem request, and the directory is expected to originate
from a Main-owned native directory dialog.
B02/B03/B04 add the fixed `media-probe`, `media-proxy`, `media-transcribe`, and
`media-vad` commands. `media-transcribe` carries only project/asset IDs and a
bounded timeout; its result remains below the Worker message limit.
`media-vad` additionally carries only a bounded structured VAD configuration;
it never carries a tool, model, command, or output path.
They carry an operation ID and strict, bounded payload. They are controller
commands, not Pi tools. The controller permits at most one project operation or
A03 smoke run at a time, applies a bounded operation timeout, rejects duplicate
or stale generation responses, and resolves all pending project operations with
a stable error on Worker exit.

The Worker emits `ready` before loading the Python/RPC and faux-agent modules;
those modules are dynamically loaded on the first command. Main records the
bounded cold-start duration and the ready timeout remains finite. Every Worker
outbound project/job result, error, and event uses the single `send()`出口,
which performs runtime shape and 64 KiB validation before `postMessage`.

A07 adds fixed job commands and forwards durable `core.job.event` messages.
The Worker does not persist job state and does not expose generic
RPC/notifications; after a restart, the caller reopens the project and reads
SQLite-backed jobs/events.

Media requests use the same single active project-operation slot. Core
`core.cancel` is sent by the reusable Python client on timeout/abort, and a
transcription retry is safe because only a complete versioned cache manifest
is a cache hit.

A08 adds one fixed `diagnostic-event` Worker-to-Main message. It carries only a
versioned, allowlisted, scalar diagnostic summary and uses the same `send()`
runtime shape and 64 KiB validator as every other outbound message. Pi
messages, tool arguments/results, prompts and raw Core stderr are not
forwarded.

The Worker lazily starts one `PythonCoreClient` for the current session. A
successful project open/create leaves that Core session active for subsequent
asset calls. Normal Worker shutdown closes Core before exit; Python receives
stdin EOF and the client has a bounded kill fallback, so a restart does not
leave an orphan Core process. A new Worker has no active project until the user
opens one again.

A07 adds `job-smoke-start`, `job-get`, `job-list`, `job-events-list`,
`job-cancel`, and `job-retry`, plus `job-event`. Job operations have
bounded operation timeouts and stale-generation checks; long-running work is
never held by the operation request.

## Cancellation

The Main controller sends `cancel-run` only for the matching active run. The
Worker calls `Agent.abort()`, and the in-memory tool observes the same
`AbortSignal`. A cancelled run emits a stable `cancelled` terminal event and
releases the active-run slot, so a later run can start. An unknown run ID is
rejected without affecting the active task.

## Development and verification

```powershell
npm install
npm run build
npm run agent:smoke
npm run jobs:smoke
npm run dev
```

`npm run agent:smoke` launches the built Electron Main in headless smoke mode,
starts a real `utilityProcess`, verifies a completed faux run and a cancelled
run, then performs graceful shutdown. `npm run dev` starts the same Worker and
shows the A03 engineering panel in the Renderer.

`npm run jobs:smoke` runs the real Electron → Worker → Python Core → SQLite
reopen/recovery path for the deterministic smoke executor.

The faux provider is deterministic and keyless for engineering verification;
it is not a real LLM integration. A04 adds the reusable
`PythonCoreClient`/Python JSON-RPC boundary described in
[docs/python-rpc.md](python-rpc.md). Persistent conversations, real media
executors, real providers, and later media tools remain intentionally out of scope;
persistent job recovery is provided by A07.
