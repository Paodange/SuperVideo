# B06 sentence-boundary QA

B06 consumes an existing B05 `SentenceResult`; it does not re-segment audio,
run an LLM, or implement sentence indexing. A caller supplies only the active
`projectId`, registered `assetId`, B05 `sentenceCacheKey`, and a bounded sentence
index/context window.

## RPC contract

- `media.sentences.qa.context` returns at most three sentences before and after
  the selected sentence, the B05 quality reasons, saved QA markers, and a
  stable `supervideo://asset/{assetId}?kind={audio|video}&startMs={start}&endMs={end}` playback
  address. The address is an asset/time reference, never an arbitrary path.
- `media.sentences.qa.save` replaces the bounded marker set for one B05 cache
  key. Marker types are `missing-text`, `half-sentence`, `low-confidence`,
  `boundary-uncertain`, and `other`. Open missing-text markers require either
  an expected text or a note.

The Core revalidates the registered asset fingerprint and B05 cache digest
before use. Marker files are versioned under
`data/qa/sentence-qa-v1/{assetId}/{sentenceCacheKey}.json`, include a digest and
revision, and are written with a flushed temporary file followed by atomic
replace. Malformed persisted markers fail with a stable error; they are never
silently accepted or merged.

`tests/fixtures/b06_sentence_qa_regression_v1.json` contains 60 deterministic,
privacy-safe sentence samples, including complete, low-confidence, missing-text,
half-sentence, and uncertain-boundary cases.
