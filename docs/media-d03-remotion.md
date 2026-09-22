# D03 Remotion runtime V1

D03 establishes the versioned local seam for a future Remotion Player/renderMedia
integration. This branch intentionally does not add `remotion` or execute a
bundle supplied by Renderer input. The offline executor produces a deterministic
render-contract artifact so the Main → Worker → Python Core → A07 job path can
be demonstrated without network access, API keys, or an external command.

固定版本：

- contract: `remotion-runtime-v1`
- render request: `remotion-render-v1`
- bundle: `remotion-bundle-v1`
- allowlisted template: `timeline-preview` / `timeline-preview-v1`
- runtime mode: `offline-contract`

`RemotionRenderInputProps` contains the project UUID, fixed template/bundle
versions, and the validated C01 Timeline IR. Shared TypeScript and Python
validators use extra-key rejection, bounded JSON, project binding, controlled
`supervideo://` source references, and recursive secret/credential/command-key
rejection. The C01 validator remains the sole Timeline IR validator.

## Cache and output boundaries

All bundle metadata, render-contract artifacts and manifests are below the active
project's `generated/remotion-v1` directory. Cache keys include the contract,
render, project, template, bundle and Timeline digest. Every path is relative,
checked against the canonical project root, rejects `..`, and rejects symlinked
components. Writes are temporary-file + fsync + atomic replace. A cache hit
re-verifies the manifest, file size and SHA-256 before returning it.

The manifest records only relative paths, fixed versions, digests, source IDs and
`sourcePathsIncluded: false`; absolute source paths, credentials and secrets do
not enter job input, events, results or manifests. A failed render cannot publish
a success result because the artifact and manifest are written only after all
validation and the job transitions to `succeeded` only after the executor
returns a validated result.

## Player and render seam

The fixed preload IPC surface is `startRemotionJob` and `getRemotionJobResult`.
The worker/Core methods are `job.remotion.start` and `job.remotion.result`; all
payloads and results pass explicit allowlists. The returned `player` contract
has `availability: "contract-only"` and a fixed composition ID. It must not be
rendered as a real Remotion Player until a later task adds a pinned dependency,
bundle build, Electron-safe asset resolver, and visual verification. D04 template
components, D05 script/storyboarding, D06 image adapters and E/F work are out of
scope.

## Durable jobs

`remotion.render` reuses A07 SQLite as the source of truth. The idempotency key is
scoped by project and job type; identical normalized input returns the existing
job, while a conflicting payload returns `IDEMPOTENCY_CONFLICT`. Events expose
only stage/progress/cache summaries. Checkpoints record the executor version,
cache key and Timeline digest, allowing A07 recovery/retry without re-running a
foreign command. `job.get`, `job.events.list`, `job.cancel`, `job.retry` and the
result method retain the existing project isolation rules.
