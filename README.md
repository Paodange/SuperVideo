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
npm run project:smoke
npm run jobs:smoke
npm run diagnostics:smoke
npm run core:rpc:smoke
npm run core:storage:smoke
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

`npm run core:storage:smoke` creates a temporary project directory containing
spaces and Chinese characters, runs the SQLite migration and fixed repository
fixture in one real Python process, reopens it in a second process, verifies
integrity and persistence, then removes the temporary directory. It does not
touch project files or external media. See [docs/storage.md](docs/storage.md)
for the storage boundary, migration workflow, repository API, and diagnostic
checks.

`npm run project:smoke` runs the real Electron Main → Agent Worker → Python
Core project workflow in a test-only mode. It creates a temporary project and
fixed external `.mp4` fixture, verifies create/reference/reopen persistence and
proves the original file is not copied or changed. It accepts no user path and
removes only its own temporary tree. See [docs/projects.md](docs/projects.md).

`npm run jobs:smoke` runs the real Electron Main → utility Worker → Python Core
→ SQLite persistent-job workflow in a temporary project. It verifies fast job
start, durable progress/checkpoints, shutdown/reopen recovery, cancellation,
failure/retry, event sequence reconstruction, and cleanup without opening a
dialog or touching real media. See [docs/jobs.md](docs/jobs.md).

`npm run diagnostics:smoke` uses only temporary directories and a test-only
fake encryption adapter. It verifies metadata-only credentials, correlated
redacted JSONL logs, bounded diagnostics export, and cleanup. It does not use
real Electron user data, network services, or real keys.

## Repository layout

```text
apps/desktop/       Electron Main, preload, React renderer, and Vite build config
workers/agent/      Independent TypeScript Pi Agent Worker and health entry
services/core/      Python supervideo_core package using src layout
                    (storage/ contains SQLite connection, migrations, SQL, and repositories)
packages/shared/    Versioned home for small cross-boundary types
contracts/          Checked-in cross-language Core RPC golden fixtures
scripts/            Cross-platform Node orchestration for root commands
docs/               Product architecture and development workflow
spikes/             Architecture validation evidence, kept separate from the app
tests/              Minimal workspace automation tests
```

The desktop workspace deliberately keeps `src/main`, `src/preload`, and `src/renderer` separate. Vite is used only for the React renderer's development server and bundle; TypeScript compiles Main, preload, and Worker entries explicitly so the process boundaries remain visible. The Worker build is copied into `apps/desktop/dist/worker` with its ESM package boundary, so Main never resolves TypeScript source or the spike directory. `workers/agent/src/python-core-client.ts` owns the reusable Python process boundary; see [docs/agent-worker.md](docs/agent-worker.md) and [docs/python-rpc.md](docs/python-rpc.md).

## Desktop security boundary

A02 keeps `contextIsolation`, sandboxing, `nodeIntegration: false`, `webSecurity`, and the minimal preload bridge enabled. Renderer navigation, new windows, downloads, and session permissions are denied unless explicitly trusted. A06 adds only fixed project/asset capabilities: Main obtains paths from a native dialog, while Renderer requests contain project metadata or an existing project ID, never a disk path. See [docs/electron-security.md](docs/electron-security.md) for the trust model, dialog grant boundary, CSP differences, and current limitations.

## Known limitations

A03 uses only a deterministic, keyless Pi faux provider and an in-memory smoke tool. A04's Python Core contains the health/countdown and A06 project/asset RPC methods; A05 adds the internal per-project SQLite foundation, A06 adds trusted project creation/open plus read-only external references, B01 adds shallow video/audio directory scanning with versioned sampled fingerprints, B02 adds fixed ffprobe/FFmpeg media probe and proxy RPC methods with project cache, and A07 adds one deterministic persistent smoke executor with cancel/retry/reopen recovery. A08 adds Windows `safeStorage` credentials outside project folders, redacted rotating JSONL logs, and explicit bounded diagnostics export; it never uploads diagnostics or exposes a saved secret. The product still excludes natural-language paths, recursive scanning, Whisper, Remotion, 剪映 integration, formal Pi tool registration, backup/restore, cross-machine recovery, and background services. A03 smoke runs and raw RPC requests are not persisted; select **Open project** again to restore the project and rebuild A07 jobs from SQLite. The existing `spikes/pi-electron-bridge` directory is untouched and remains runnable with its own `npm run validate` command.
