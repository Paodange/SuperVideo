# C05 Subtitle plan V1

C05 exposes `media.subtitle.plan` through the versioned Core RPC and the
desktop capability `planSubtitles`. It produces `subtitle-plan-v1` from a
Timeline IR V1 without rendering or reading media files.

The planner selects an explicitly requested `trackId`, otherwise a populated
subtitle track, otherwise populated video/audio tracks. Subtitle clips use
their `subtitle.text`; sentence clips resolve text from `sentenceSources`, a
bounded adapter for B03 sentence results. A sentence source may carry a
Timeline `sourceId`, source timecode, language and declared provenance. Cue
provenance is the stable, de-duplicated union of clip, sentence and source
provenance IDs.

The output is ordered by `timelineStartMs` and clip ID. Each cue retains the
sentence ID, source ID/timecode, timeline timecode and provenance. The digest
is SHA-256 over the canonical result fields excluding `planDigest`, using
sorted JSON keys and compact UTF-8 encoding, so identical inputs are
repeatable across runs.

The default layout policy allows at most two lines and 32 display columns
(East Asian wide characters count as two columns). `maxLines` and
`maxLineWidth` are bounded request fields. Invalid ranges, overlaps, source
references, text, line count or line width return stable C05 error codes. A
missing sentence source or missing subtitle text is represented as a bounded
`gaps` record; it never becomes an empty or guessed cue. `status` is `gaps`
when any gap exists.

Stable C05 error codes are `SUBTITLE_INPUT_INVALID`,
`SUBTITLE_TIMELINE_INVALID`, `SUBTITLE_SOURCE_INVALID`,
`SUBTITLE_TIMECODE_INVALID`, `SUBTITLE_OVERLAP`, `SUBTITLE_TEXT_INVALID`,
`SUBTITLE_LINE_COUNT_INVALID`, `SUBTITLE_LINE_WIDTH_INVALID`,
`SUBTITLE_OUTPUT_INVALID`, `SUBTITLE_TIMEOUT` and `SUBTITLE_CANCELLED`.

C05 intentionally does not render subtitles, create previews, inspect quality,
or export MP4/Jianying files. Those remain C06-C08 responsibilities.
(The default layout policy allows at most two lines and 32 display columns
