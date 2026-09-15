# SuperVideo

SuperVideo is a local-first desktop video creation agent. A01 establishes the formal monorepo and the smallest runnable development environment; it does not implement video generation yet.

## Environment

- Windows is the first-stage target and all root commands work from PowerShell.
- Node.js 20–24 and npm 10 or newer are required. The Electron runtime is installed locally by npm.
- Python 3.12 or newer is required for the Core health check. A01 uses only the Python standard library at runtime.

## First install

From the repository root:

```powershell
npm install
```

The Python package uses `src` layout. The root health command supplies the source path automatically. To install the package into a local virtual environment for development, use:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --editable .\services\core
```

## Common commands

```powershell
npm run dev
npm run build
npm run typecheck
npm run health
npm test
```

`npm run dev` builds the Electron Main and preload entries, starts the Vite renderer server, and opens the minimal Electron window. The window displays `SuperVideo`, desktop status, the development environment, target platform, and Electron version. Renderer changes use Vite reload; Main and preload changes require restarting the command.

`npm run health` runs the checks in order: desktop build entries, Agent Worker executable health module, and Python Core executable health module. Each service returns a stable JSON status and any failure exits non-zero.

## Repository layout

```text
apps/desktop/       Electron Main, preload, React renderer, and Vite build config
workers/agent/      Independent TypeScript Agent Worker placeholder and health entry
services/core/      Python supervideo_core package using src layout
packages/shared/    Versioned home for small cross-boundary types
scripts/            Cross-platform Node orchestration for root commands
docs/               Product architecture and development workflow
spikes/             Architecture validation evidence, kept separate from the app
tests/              Minimal workspace automation tests
```

The desktop workspace deliberately keeps `src/main`, `src/preload`, and `src/renderer` separate. Vite is used only for the React renderer's development server and bundle; TypeScript compiles Main and preload explicitly so the process boundaries remain visible. The Agent Worker is not imported by Electron in A01, and the Python Core is not started as an RPC service yet.

## Known limitations

A01 does not include Pi, formal JSON-RPC, SQLite, media analysis, FFmpeg, Whisper, Remotion, 剪映 integration, packaging, or real provider credentials. The preload exposes only one read-only environment-status operation as a placeholder; the complete permissioned IPC contract is an A02 concern. The existing `spikes/pi-electron-bridge` directory is untouched and remains runnable with its own `npm run validate` command.
