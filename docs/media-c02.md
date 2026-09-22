# C02 narrative planner V1

C02 exposes the deterministic Core RPC method `plan.create_remix` and the
typed Worker/Desktop operation `plan-create-remix` / `createRemixPlan`.

The request contains a bounded `theme`, `audience`, `targetDurationMs` and an
optional outline. It may restrict the asset IDs and the B10 candidate limit.
The Core converts the request to a fixed B10 outline when no outline is
provided, then selects only B10's rank-1 complete candidate for each slot.
The selection policy is versioned as `b10-first-complete-candidate-v1`.

The response is `narrative-remix-plan-v1`. Segments keep the B10 `slotId`,
candidate sentence ID, exact sentence text, source asset, sentence cache key,
preview URI and source timecode. A segment with no eligible candidate has no
text or source reference and carries a structured, stable `gapReason`; it is
never silently replaced or rewritten. The plan also reports the selected
whole-sentence duration and its target ±20% status.

C02 does not trim, rewrite, add, remove or optimize sentences. A plan outside
the duration tolerance is returned as `needs-duration-optimization` for C03;
the caller passes that plan together with the same-source B10 alignment result
to `plan.optimize_duration`. Candidate shortages remain reproducible segment gaps. The implementation is
local and deterministic: it uses B08/B09/B10 only and does not call an LLM,
network, credential or arbitrary path/command.

Stable C02 errors are `PLAN_INPUT_INVALID`, `PLAN_SOURCE_INVALID`,
`PLAN_SOURCE_STALE`, `PLAN_ALIGNMENT_INVALID`, `PLAN_OUTPUT_INVALID`,
`PLAN_TIMEOUT` and `PLAN_CANCELLED`.
