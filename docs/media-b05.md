# B05 complete sentence segmentation V1

B05 adds the fixed Core RPC method:

- `media.sentences({ projectId, assetId, timeoutMs?, config? })`

The request accepts only an asset already registered in the active project and
bounded structured parameters. Core revalidates the canonical asset path,
size, modification time, and B01 fingerprint before and after the operation.
It never accepts a command, model, output path, or natural-language path.

The deterministic V1 adapter consumes the version-1 B03 transcription and B04
speech-interval results. ASR sentence punctuation is preferred; bounded pauses,
word/segment timestamps, the maximum sentence duration, and short-candidate
merging provide fallbacks. Candidate source and end points are expanded only
inside a B04 speech interval and the media duration. Text whitespace and
repeated punctuation are normalized without using an LLM or network service.

Each candidate contains the source asset ID, source segment indexes, text,
timestamps, confidence, and either `complete` or `needs_review`. Missing
punctuation, a pause boundary, a maximum-length split, low confidence, a VAD
gap, no speech overlap, or a clipped VAD boundary is retained as a quality
reason; an uncertain boundary is never presented as a confirmed sentence.

The result schema and cache are versioned (`sentence-segmentation-v1` and
`sentence-cache-v1`). The cache key covers project, canonical asset path,
size/mtime/fingerprint, B03/B04 schema and adapter versions, and every sentence
parameter. Cache manifests include a digest of the result; malformed,
tampered, partial, or fingerprint-invalid caches are rebuilt atomically. No
SQLite migration is required and original assets remain read-only.

Sentence segmentation shares the single cancellable Core media slot with
probe, proxy, transcription, and VAD. Stable errors distinguish unavailable or
invalid prerequisites, output validation, timeout, and cancellation. Tests use
injected deterministic transcription/VAD fakes and do not download models or
commit media.
