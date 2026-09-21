# B03 local transcription adapter

B03 adds the fixed Core RPC method:

- `media.transcribe({ projectId, assetId, timeoutMs? })`

The request accepts only a project asset reference and a bounded timeout. Core
revalidates the active project, canonical asset path, size, modification time,
and B01 content fingerprint before reading the original. A changed or missing
asset returns the existing stable asset error. The original file is never
written.

The adapter boundary is `TranscriptionRunner`. Production uses a lazy,
controlled `faster-whisper` runner. The optional package is loaded only when a
transcription is requested; package and model failures return stable
`TRANSCRIPTION_TOOL_UNAVAILABLE` or `TRANSCRIPTION_MODEL_UNAVAILABLE` errors.
Tests inject a fake runner and never download a model. RPC cannot supply a
command, executable, model path, or output path.

Environment configuration is deliberately allowlisted:

- `SUPERVIDEO_WHISPER_MODEL`: `tiny`, `base`, `small`, `medium`, or `large-v3`
  (default `base`)
- `SUPERVIDEO_WHISPER_DEVICE`: `cpu` or `cuda` (default `cpu`)
- `SUPERVIDEO_WHISPER_COMPUTE_TYPE`: `int8`, `float16`, `float32`, or
  `int8_float16` (default `int8`)

The versioned result schema is 1. It contains the selected model metadata,
language and probability, duration, bounded segment timestamps/text/quality
fields (`confidence`, `avgLogprob`, `noSpeechProbability`, and
`compressionRatio`), and bounded word timestamps/probabilities. Results are
limited to 2,000 segments, 128 words per segment, and 48 KiB serialized so
they remain inside both the Core JSONL and Worker message limits.
cached under `cache/transcription-cache-v1/transcripts/` with a SHA-256 key
covering the project, canonical path, asset signature/fingerprint, adapter
version, and controlled model configuration. Cache files are strict manifests
and are written atomically; malformed or missing files are regenerated.

The Core keeps transcription as one cancellable active RPC, compatible with
`core.cancel`, bounded stdout/response limits, and the Worker project-operation
boundary (`media-transcribe`). Reissuing the same fixed operation is safe after
an interrupted request because incomplete cache files are not valid hits. No
SQLite schema or migration changes are required in B03.

Stable transcription errors are:

- `TRANSCRIPTION_TOOL_UNAVAILABLE`
- `TRANSCRIPTION_MODEL_UNAVAILABLE`
- `TRANSCRIPTION_OUTPUT_INVALID`
- `TRANSCRIPTION_TIMEOUT`
- `TRANSCRIPTION_CANCELLED`
