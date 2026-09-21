# B09 quality rerank V1

B09 exposes the versioned Core RPC method `media.sentences.rerank`. It accepts
the B08 audited query fields (`projectId`, `query`, `mode`, `assetIds`,
`filters`) plus bounded `candidateLimit`, final `limit`, `timeoutMs`, and a
strictly bounded deterministic `config`. It never accepts paths, commands,
models, credentials, network options, or free-form ranking instructions.

The Core first executes B08 `media.sentences.retrieve`, then rechecks the
project/asset identity, B05 sentence cache digest, B07 index identity and
registered asset fingerprint before reading B06 QA markers. Missing QA marker
files mean no open marker. A corrupt QA manifest, mismatched digest, changed
asset, stale B05 result, or invalid B08 source fails with a stable B09 error;
no source is silently substituted.

The reranker is deterministic and local. It combines the original B08 score,
registered narration confidence, sentence completeness, open QA issue weights,
duplicate similarity, and source-asset diversity. Selection is greedy over
bounded candidates, applies `maxPerAsset`, and resolves ties by B08 rank and
sentence ID. Every result includes the original score, bounded component
scores, final score, quality status, ranking reasons, source asset, timecode,
preview URI, sentence identity, and QA explanation.

The public schema is `quality-rerank-v1`. The Worker, shared runtime
validator, and constrained Desktop API expose only the typed RPC operation
`media-sentence-rerank` / `rerankSentences`. B09 does not align information
slots, generate scripts, call an LLM, or access the network.
