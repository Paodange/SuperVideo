# B07 sentence index V1

B07 exposes the fixed Core RPC method `media.sentences.index`:

```json
{
  "projectId": "...",
  "assetId": "...",
  "sentenceCacheKey": "64-character B05 cache key",
  "timeoutMs": 120000
}
```

The method consumes one validated B05 `SentenceResult`. It rechecks the B05
manifest digest, project/asset/cache identity, the registered asset
fingerprint, and the cache key computed from the current asset before indexing.
Malformed, tampered, missing, or stale B05 data produces a stable B07 error;
it is never partially indexed.

The V1 adapter is local and deterministic. It derives bounded keywords from
text, applies a small deterministic topic taxonomy with a stable fallback, and
creates a 32-dimensional normalized SHA-256 hash vector. No network, model,
credential, or arbitrary path is used. Each entry retains the source asset,
sentence index, B05 cache key, sentence identity, text, timecode, confidence,
quality and quality reasons.

Indexes are written below `cache/sentence-index-v1/indexes/` using a versioned
manifest, source-result digest, bounded JSON validation, flushed temporary files
and atomic replacement. Parent directories and target files are checked for
symlinks and non-regular objects. A valid index cache is returned as a
`cache-hit`; a damaged index is safely rebuilt. When the B05 cache key changes,
entries with the same stable sentence identity are reused within the active
project and the result reports `reusedCount`/`rebuiltCount`.

B07 stops at indexing. Retrieval ranking, hybrid search, metadata filtering,
and narrative slot alignment belong to B08+.
