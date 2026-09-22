# C06 Preview render V1

C06 exposes `media.preview.render` through the versioned Core RPC, Agent Worker,
and Desktop capability `renderPreview`. The request accepts only the validated
C04 `arollPlan` and C05 `subtitlePlan`; it does not accept a command, executable,
path, filter, or arbitrary timeline data.

The result is `preview-render-plan-v1`. Its digest binds the project and timeline
IDs, both upstream plan digests, A-roll source URI/fingerprint bindings, mapped
subtitle timecodes, cue provenance, and explicit gaps. C05 cues are translated
from timeline time to the concatenated C04 output time. A plan with no tool run
has `executionStatus: "not-run"`, `log.status: "not-run"`, and `output: null`.

`executionMode: "ffmpeg"` is optional and Core-owned. It requires a completed
C04 video output at `previews/aroll-cut-join-v1/<C04-plan-digest>.video.mp4`,
rechecks that path and its byte size against C04 `output.sizeBytes`, and
requires each subtitle cue `sourceId` to match its bound C04 segment. It then
writes a temporary ASS
subtitle file and FFmpeg output below `previews/preview-render-v1/`, then atomically
renames an idempotent digest-named MP4 after verifying size and SHA-256. FFmpeg
also writes a bounded digest-named manifest; cache hits require that manifest,
the current file size, and a freshly recomputed SHA-256 to match. FFmpeg is
invoked with an argument array and bounded timeout/cancellation/stdout/stderr;
the source and any external path are never overwritten. A missing FFmpeg or
invalid/stale output returns a stable `PREVIEW_RENDER_*` error instead of a fake
ready result.

Desktop playback uses the allowlisted `supervideo://preview/<project-id>/<digest>`
address. Main resolves that address only to the active project's C06 preview
directory; absolute paths, traversal, symlinks, and other projects are rejected.

C06 is preview-only. It does not run quality gates, create final MP4 exports,
edit natural-language intents, or manage versions. In environments without a
usable local FFmpeg, `plan` mode remains the supported honest demonstration path.
