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
`pong`, `run-event`, `run-finished`, and `worker-error`.

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
There is no cross-restart task persistence or recovery in A03; that belongs to
the Python/SQLite task system in later work packages.

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
npm run dev
```

`npm run agent:smoke` launches the built Electron Main in headless smoke mode,
starts a real `utilityProcess`, verifies a completed faux run and a cancelled
run, then performs graceful shutdown. `npm run dev` starts the same Worker and
shows the A03 engineering panel in the Renderer.

The faux provider is deterministic and keyless for engineering verification;
it is not a real LLM integration. A04 will add the formal Python JSON-RPC
boundary. Persistent conversations, long tasks, SQLite, real providers, and
media tools are intentionally out of scope.
