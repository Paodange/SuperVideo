# B08 hybrid retrieval V1

B08 exposes the fixed Core RPC method `media.sentences.retrieve`:

```json
{
  "projectId": "...",
  "query": "工厂招聘薪资",
  "mode": "hybrid",
  "assetIds": ["..."],
  "limit": 20,
  "filters": {
    "topics": ["招聘就业"],
    "quality": "complete",
    "minConfidence": 0.8,
    "startMs": 0,
    "endMs": 60000
  }
}
```

Only the project identity, bounded query text, optional project asset IDs,
bounded limit, mode, filters and timeout are accepted. Paths, commands,
models, credentials and network options are not part of the contract.

The local adapter reads B07 `sentence-index-v1` manifests and revalidates the
manifest digest, index result, project/asset identity, B05 source digest and
cache identity, plus the registered asset fingerprint through the B07 cache-key
check. Invalid or stale indexes return stable retrieval errors; an index from a
different project is ignored and can never contribute candidates.

Lexical scoring is bounded keyword/topic overlap, vector scoring is cosine
similarity over the B07 deterministic `sha256-hash-v1` vector, and hybrid
scoring is `0.6 * lexical + 0.4 * vector`. Ties are resolved by sentence ID,
asset ID and sentence index. Results contain no internal paths and include the
source asset, timecode, text, sentence identity, all scores, matched keywords
and topics, formula/provider, preview URI and sentence quality fields.

B08 is intentionally retrieval-only. It does not rerank with quality models,
align information slots, call an LLM, or access the network.
