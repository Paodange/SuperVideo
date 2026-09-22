# C04 A-roll cut/join V1

C04 exposes `media.aroll.cut_join` through the Core RPC, Agent Worker and
Desktop IPC as `media-aroll-cut-join` / `cutJoinAroll`. It accepts a validated
Timeline IR V1 and selects one bounded audio or video track. Each selected
clip must be an asset-backed, complete sentence with a positive source span;
the source span must equal the clip duration and remain inside the probed
source duration. Sources must use the `supervideo://asset/<asset-id>` reference
and the A-roll role marker. The ordered clips may come from different source
assets, but one clip cannot cross source boundaries.

The default `executionMode: "plan"` is the honest C04 minimum closed loop. It
returns `aroll-cut-join-plan-v1` with stable clip order, source/timecode
provenance, concatenated output timecodes, and explicit `timeline-gap` records
for gaps removed by concatenation. `executionStatus: "not-run"` and `output:
null` make it impossible to interpret a plan as a rendered media file.

`executionMode: "ffmpeg"` is optional and remains Core-owned: FFmpeg is
resolved from the existing allowlisted B02 boundary, the executable arguments
are built from structured clip fields, only project-referenced asset paths are
opened, output is written below `previews/aroll-cut-join-v1/`, source size and
fingerprint are rechecked, and the response is accepted only after a regular,
non-empty output file is verified. No command, filter, executable, or output
path crosses the RPC boundary. The original source files are never written.

Stable domain errors are `AROLL_CUT_JOIN_INPUT_INVALID`,
`AROLL_CUT_JOIN_TIMELINE_INVALID`, `AROLL_CUT_JOIN_SOURCE_INVALID`,
`AROLL_CUT_JOIN_OUTPUT_INVALID`, `AROLL_CUT_JOIN_TOOL_UNAVAILABLE`,
`AROLL_CUT_JOIN_TOOL_TIMEOUT`, `AROLL_CUT_JOIN_TIMEOUT`, and
`AROLL_CUT_JOIN_CANCELLED`. Absolute paths and tool stderr are not returned to
the caller or diagnostics logs.

C04 intentionally does not add subtitles, preview UI, quality inspection, or
final MP4 export orchestration; those remain C05–C08 responsibilities.
