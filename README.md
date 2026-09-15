# SuperVideo

SuperVideo is a local-first desktop video creation agent. A04 adds a bounded,
versioned JSON-RPC boundary from the Pi Agent Worker to a local Python Core;
the media core and real model providers remain out of scope.

## Environment

- Windows is the first-stage target and all root commands work from PowerShell.
- Node.js 20–24 and npm 10 or newer are required. The Electron runtime is installed locally by npm.
- Python 3.12 or newer is required for the Python Core. The verified development runtime is Python 3.14.4.

## First install

From the repository root:

```powershell
npm install
npm run core:setup
```

`npm run core:setup` creates the repository-local `.venv`, installs the locked
Pydantic 2.x dependencies, and installs the `services/core` package in editable
mode. It does not modify the system Python. Commands prefer
`.venv\Scripts\python.exe` on Windows and provide a clear development fallback
when the environment has not yet been created.

## Common commands

```powershell
npm run dev
npm run build
npm run agent:smoke
npm run core:rpc:smoke
npm run core:test
npm run typecheck
npm run health
npm test
```

`npm run dev` builds the shared contract, Agent Worker, and Electron entries, starts the Vite renderer server on `http://127.0.0.1:5173`, starts one utility-process Agent Worker, and opens the engineering window. The A03 panel displays Worker status, run IDs, streaming faux text, tool progress, and completed/cancelled/error states. Renderer changes use Vite reload; Main, preload, and Worker changes require restarting the command. The desktop shell accepts only the local loopback dev-server URL; packaged/production content is always loaded from the local renderer bundle.

`npm run agent:smoke` uses the current build output and automatically launches
Electron without a `BrowserWindow`. It verifies a real utility process,
ordered Pi faux-agent events, cancellation, and graceful shutdown. It requires
`npm run build` first.

`npm run health` runs the checks in order: shared contract, Agent Worker
executable/build entries, desktop build entries, and Python Core executable
health module. Each service returns a stable JSON status and any failure exits
non-zero.

`npm run core:rpc:smoke` starts the formal `python -m supervideo_core.rpc`
subprocess, verifies health, streaming progress, and the timeout cancellation
path, then shuts it down. `npm run core:test` runs the Pydantic and Python JSONL
server tests.

## Repository layout

```text
apps/desktop/       Electron Main, preload, React renderer, and Vite build config
workers/agent/      Independent TypeScript Pi Agent Worker and health entry
services/core/      Python supervideo_core package using src layout
packages/shared/    Versioned home for small cross-boundary types
contracts/          Checked-in cross-language Core RPC golden fixtures
scripts/            Cross-platform Node orchestration for root commands
docs/               Product architecture and development workflow
spikes/             Architecture validation evidence, kept separate from the app
tests/              Minimal workspace automation tests
```

The desktop workspace deliberately keeps `src/main`, `src/preload`, and `src/renderer` separate. Vite is used only for the React renderer's development server and bundle; TypeScript compiles Main, preload, and Worker entries explicitly so the process boundaries remain visible. The Worker build is copied into `apps/desktop/dist/worker` with its ESM package boundary, so Main never resolves TypeScript source or the spike directory. `workers/agent/src/python-core-client.ts` owns the reusable Python process boundary; see [docs/agent-worker.md](docs/agent-worker.md) and [docs/python-rpc.md](docs/python-rpc.md).

## Desktop security boundary

A02 keeps `contextIsolation`, sandboxing, `nodeIntegration: false`, `webSecurity`, and the minimal preload bridge enabled. Renderer navigation, new windows, downloads, and session permissions are denied unless explicitly trusted. The only current IPC capability is the versioned, read-only environment status operation from `@supervideo/shared`; it validates the sender frame and an empty payload, and never returns Main internals. See [docs/electron-security.md](docs/electron-security.md) for the trust model, CSP differences, and current limitations.

## Known limitations

A03 uses only a deterministic, keyless Pi faux provider and an in-memory smoke tool. A04's Python Core contains only the health and deterministic countdown RPC methods; it does not include SQLite, media analysis, FFmpeg, Whisper, Remotion, 剪映 integration, formal Pi tool registration, task recovery, packaging, or real provider credentials. Worker restart state, Core requests, and conversations are not persisted across application restarts. The existing `spikes/pi-electron-bridge` directory is untouched and remains runnable with its own `npm run validate` command.
