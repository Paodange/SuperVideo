# B10 information-slot alignment V1

B10 exposes the versioned Core RPC method `media.script.align` and the typed
Worker/Desktop operation `media-script-align` / `alignScript`.

The request is bounded and auditable:

```json
{
  "projectId": "...",
  "inputKind": "copy",
  "inputText": "开头说明主题。\n月薪 8 千元，地点在上海。",
  "assetIds": ["..."],
  "candidateLimit": 5,
  "useRerank": true,
  "timeoutMs": 120000
}
```

`inputText` is limited to 8,192 characters, is retained verbatim in the
result, and is identified by a SHA-256 `sourceDigest`. The local splitter
`deterministic-slot-split-v1` uses line breaks, outline bullets and fixed
Chinese/English sentence punctuation. It classifies each slot with a fixed
keyword table and extracts only literal numeric/unit/date/ASCII fact tokens.
No LLM, network, credentials, paths, commands, or free-form prompt is
accepted or used.

Each slot is queried independently through B08. With `useRerank=true`, the
same bounded query is also sent through B09. B10 rechecks project and asset
binding and the preview URI, accepts only complete sentences, and refuses a
candidate unless every extracted key fact occurs verbatim in the candidate
text. Candidates contain the exact source sentence, asset ID, sentence cache
key, timecode, preview URI, score, origin, preserved facts, and a deterministic
selection reason. Empty slots are returned in order with a stable gap reason.

Stable B10 errors are `SLOT_INPUT_INVALID`, `SLOT_SOURCE_INVALID`,
`SLOT_SOURCE_STALE`, `SLOT_RETRIEVAL_INVALID`, `SLOT_OUTPUT_INVALID`,
`SLOT_TIMEOUT`, and `SLOT_CANCELLED`. B08/B09 invalid or stale cache/index results are never
silently substituted. The result is capped at 60 KiB and the Worker/Desktop
validators reject unexpected fields, cross-project candidates, arbitrary
paths, control characters, and out-of-range values.
