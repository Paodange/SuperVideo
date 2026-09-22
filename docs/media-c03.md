# C03 whole-sentence duration optimization V1

C03 exposes the deterministic Core RPC method `plan.optimize_duration` and
the typed Worker/Desktop operation `plan-optimize-duration` /
`optimizeDuration`.

The request carries the C02 `sourcePlan` and the same-project B10 `alignment`
result. B10 candidates are therefore explicit, bounded, complete-sentence
inputs; C03 never searches, rewrites, trims, concatenates, or calls a model.

Before optimization, every B10 slot is audited for duplicate sentence IDs and
each C02 matched segment is compared field-by-field with its same-slot B10
candidate, including exact text, source identity, cache key, sentence index,
timecode, preview URI, rank and duration. Stale or tampered C02 evidence is
rejected as a source error.

The optimizer uses `bounded-whole-sentence-knapsack-v1`. It considers each
source-plan segment in stable order, keeps at most one candidate per segment,
and may keep, replace, add, or remove a complete sentence. Candidate duration
is always `endMs - startMs`, and ties are resolved by: within the target
tolerance, absolute target distance, number of changes, candidate rank sum,
then stable candidate order. The frontier is bounded at 20,000 states.
The DP checks cancellation and the monotonic deadline at fixed inner-loop
intervals and yields at each check.

The response is `duration-optimization-v1`. It includes the selected segments
and a change ledger whose `before`/`after` records retain sentence ID, exact
text, source asset, sentence cache key and source timecode. `keep`, `replace`,
`add`, and `remove` are explicit operations. Duplicate sentence IDs, invalid
timecodes, cross-project plans or alignments, and missing source candidates are
rejected; no source is silently substituted.

If no whole-sentence selection reaches target ±20%, C03 returns the stable
`duration-outside-tolerance` gap with the best bounded result. Existing C02
alignment gaps remain in order. Stable RPC errors are
`DURATION_OPTIMIZATION_INPUT_INVALID`, `DURATION_OPTIMIZATION_SOURCE_INVALID`,
`DURATION_OPTIMIZATION_ALIGNMENT_INVALID`, `DURATION_OPTIMIZATION_OUTPUT_INVALID`,
`DURATION_OPTIMIZATION_TIMEOUT`, and `DURATION_OPTIMIZATION_CANCELLED`.
