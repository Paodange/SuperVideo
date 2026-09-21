# B04 VAD and speech intervals

B04 adds the fixed Core RPC method `media.vad({ projectId, assetId,
timeoutMs?, config? })`. The request accepts only an asset already registered
in the active project and revalidates its canonical path, size, modification
time, and B01 fingerprint before and after analysis. It never accepts a
command, executable, model, output path, or natural-language path. Production
uses an allowlisted FFmpeg executable and its built-in `silencedetect` filter;
tests inject a deterministic fake runner and never download a model.

The version-1 result contains media duration, normalized configuration, and
ordered non-overlapping intervals with `startMs`, `endMs`, `isSpeech`, optional
confidence, and a quality label. Intervals cover the duration, so silence is
explicit; these are speech activity intervals, not complete sentences. The
default policy keeps 120 ms before speech and 180 ms after speech (within the
80–180 ms / 120–250 ms design ranges), clamps at media edges, and merges
speech separated by at most 120 ms. All VAD parameters are strictly bounded.

Results are cached below `cache/vad-cache-v1/intervals/`. The SHA-256 key
includes project, normalized asset path, size/mtime, B01 fingerprint, adapter
version, and every VAD parameter. Cache manifests are schema-validated and
written with a temporary file plus atomic replacement; malformed or partial
caches are rebuilt. No SQLite migration is required.

`media.vad` occupies the same single active Core request slot as probe, proxy,
and transcription. `core.cancel` maps to `VAD_CANCELLED`; timeout, unavailable
backend, and malformed output have stable VAD error codes. Reissuing the fixed
operation is safe because incomplete cache writes cannot be hits.
