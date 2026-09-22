import assert from "node:assert/strict";
import test from "node:test";
import { isScriptStoryboardInput, isScriptStoryboardResult, validateScriptStoryboardInput, validateScriptStoryboardResult } from "@supervideo/shared";
import { input, result } from "./fixtures/d05_script_storyboard_v1.mjs";

test("D05 fixture validates a complete hook/body/CTA storyboard", () => {
  assert.equal(isScriptStoryboardInput(input), true);
  assert.equal(isScriptStoryboardResult(result), true);
  const validated = validateScriptStoryboardResult(result);
  assert.deepEqual(validated.script.body[0].text, "装配线操作工在江苏昆山上班。");
  assert.deepEqual(validated.shots[0].visualSourcePriority, ["licensed-stock", "ai-image", "remotion-template", "text-card"]);
  assert.equal(validated.selectedDurationMs, 3000);
});

test("D05 rejects unsupported keys, secrets, paths, providers, and claims without provenance", () => {
  for (const candidate of [
    { ...input, provider: "llm" },
    { ...input, credentialRef: "opaque" },
    { ...input, brief: { ...input.brief, objective: "C:\\private\\brief.txt" } },
    { ...input, brief: { ...input.brief, objective: "apiKey=do-not-store" } },
    { ...input, facts: [{ ...input.facts[0], provenanceIds: ["missing"] }, input.facts[1]] },
  ]) assert.equal(isScriptStoryboardInput(candidate), false);
  assert.equal(isScriptStoryboardResult({ ...result, script: { ...result.script, hook: { ...result.script.hook, command: "ffmpeg" } } }), false);
  assert.equal(isScriptStoryboardResult({ ...result, shots: [{ ...result.shots[0], visualSourcePriority: ["arbitrary-provider"] }, ...result.shots.slice(1)] }), false);
});

test("D05 keeps visual selection declarative and bounded", () => {
  assert.equal(Object.hasOwn(result.shots[0], "provider"), false);
  assert.equal(Object.hasOwn(result.shots[0], "path"), false);
  assert.equal(Object.hasOwn(result.shots[0], "command"), false);
  assert.doesNotThrow(() => validateScriptStoryboardInput(input));
});

test("D05 rejects malformed C02 ordering, slot state, candidate state, and gap accounting", () => {
  const cases = [
    (value) => { value.sourcePlan.segments[1].slotKind = "provider"; },
    (value) => { value.sourcePlan.segments[1].candidateRank = 2; },
    (value) => { value.sourcePlan.segments[1].selectionReason = null; },
    (value) => { value.sourcePlan.segments[1].order = 3; },
    (value) => { value.sourcePlan.gaps = [{ segmentId: "segment-2", slotId: "slot-2", role: "body", code: "alignment-gap", detail: "fake" }]; },
    (value) => { value.sourcePlan.segments[1].status = "gap"; value.sourcePlan.segments[1].candidateSentenceId = null; value.sourcePlan.segments[1].candidateRank = null; value.sourcePlan.segments[1].sentenceText = null; value.sourcePlan.segments[1].source = null; value.sourcePlan.segments[1].durationMs = 0; value.sourcePlan.segments[1].selectionReason = null; value.sourcePlan.segments[1].gapReason = null; },
  ];
  for (const mutate of cases) {
    const candidate = structuredClone(input);
    mutate(candidate);
    assert.equal(isScriptStoryboardInput(candidate), false);
  }
});

function c03Plan() {
  const segments = input.sourcePlan.segments.map((segment) => ({ ...segment, operation: "keep" }));
  const sentence = (segment) => ({ sentenceId: segment.candidateSentenceId, sentenceText: segment.sentenceText, source: segment.source, durationMs: segment.durationMs, candidateRank: segment.candidateRank });
  return {
    schemaVersion: 1,
    optimizationVersion: "duration-optimization-v1",
    projectId: input.projectId,
    sourcePlanDigest: input.sourcePlan.planDigest,
    targetDurationMs: 3000,
    toleranceLowerMs: 2400,
    toleranceUpperMs: 3600,
    selectedDurationMs: 3000,
    durationStatus: "within-tolerance",
    status: "unchanged",
    selectionPolicy: "bounded-whole-sentence-knapsack-v1",
    segments,
    changes: input.sourcePlan.segments.map((segment) => ({ segmentId: segment.segmentId, slotId: segment.slotId, role: segment.role, operation: "keep", before: sentence(segment), after: sentence(segment), selectionReason: "keep;complete" })),
    gaps: [],
  };
}

test("D05 rejects malformed C03 duration/status/change accounting", () => {
  const cases = [
    (value) => { value.durationPlan.selectedDurationMs = 2000; },
    (value) => { value.durationPlan.status = "optimized"; },
    (value) => { value.durationPlan.segments[0].operation = "replace"; value.durationPlan.changes[0].operation = "keep"; },
    (value) => { value.durationPlan.changes[0].after.sentenceText = "tampered"; },
    (value) => { value.durationPlan.segments[1].order = 3; },
  ];
  for (const mutate of cases) {
    const candidate = structuredClone(input);
    candidate.durationPlan = c03Plan();
    mutate(candidate);
    assert.equal(isScriptStoryboardInput(candidate), false);
  }
});

test("D05 accepts a C03 source-gap without a change record", () => {
  const candidate = structuredClone(input);
  const durationPlan = c03Plan();
  const gapReason = { segmentId: "segment-2", slotId: "slot-2", role: "body", code: "alignment-gap", detail: "no complete sentence candidate" };
  const gap = durationPlan.segments[1];
  Object.assign(gap, {
    status: "gap",
    candidateSentenceId: null,
    candidateRank: null,
    sentenceText: null,
    source: null,
    durationMs: 0,
    selectionReason: null,
    gapReason,
  });
  durationPlan.selectedDurationMs = 2000;
  durationPlan.durationStatus = "outside-tolerance";
  durationPlan.status = "gaps";
  durationPlan.changes = durationPlan.changes.filter((change) => change.segmentId !== "segment-2");
  durationPlan.gaps = [gapReason, { segmentId: "duration-optimization", slotId: "duration", role: "body", code: "duration-outside-tolerance", detail: "selected duration remains outside tolerance" }];
  candidate.durationPlan = durationPlan;
  assert.equal(isScriptStoryboardInput(candidate), true);
});

test("D05 enforces complete shot priorities, fallback binding, and stable identities", () => {
  const planned = structuredClone(result);
  planned.shots = planned.shots.map((shot) => ({
    ...shot,
    fallbackReason: "planned",
    visualSourcePriority: ["user-material", "licensed-stock", "ai-image", "remotion-template", "text-card"],
  }));
  assert.equal(isScriptStoryboardResult(planned), true);

  const sourceGap = structuredClone(result);
  sourceGap.script.body[0] = { ...sourceGap.script.body[0], status: "gap", sentenceId: null, text: null, source: null, durationMs: 0, factIds: [], confirmation: "not-required" };
  sourceGap.facts = sourceGap.facts.map((fact) => ({ ...fact, status: "unbound", segmentIds: [] }));
  sourceGap.selectedDurationMs = 2000;
  sourceGap.durationStatus = "outside-tolerance";
  sourceGap.status = "gaps";
  sourceGap.shots[1] = { ...sourceGap.shots[1], durationMs: 0, fallbackReason: "source-gap", visualSourcePriority: ["remotion-template", "ai-image", "text-card"] };
  assert.equal(isScriptStoryboardResult(sourceGap), true);

  const forgedGapFallback = structuredClone(sourceGap);
  forgedGapFallback.shots[1] = { ...forgedGapFallback.shots[1], fallbackReason: "no-user-material", visualSourcePriority: ["licensed-stock", "ai-image", "remotion-template", "text-card"] };
  assert.equal(isScriptStoryboardResult(forgedGapFallback), false);

  for (const mutate of [
    (value) => { value.shots[1].shotId = value.shots[0].shotId; },
    (value) => { value.shots[1].segmentId = value.shots[0].segmentId; },
    (value) => { value.shots[1].order = 3; },
    (value) => { value.shots[0].fallbackReason = "planned"; },
  ]) {
    const candidate = structuredClone(result);
    mutate(candidate);
    assert.equal(isScriptStoryboardResult(candidate), false);
  }
});

test("D05 rejects forged result status, fact confirmation, relation, identity, and fallback priority", () => {
  const cases = [
    (value) => { value.status = "needs-user-confirmation"; },
    (value) => { value.script.body[0].confirmation = "needs-user-confirmation"; },
    (value) => { value.facts[1].segmentIds = []; },
    (value) => { value.facts[1].status = "unbound"; },
    (value) => { value.script.body[0].sourceSegmentId = value.script.hook.sourceSegmentId; },
    (value) => { value.shots[0].visualSourcePriority = ["remotion-template", "ai-image", "text-card"]; },
    (value) => { value.shots[1].order = 3; },
  ];
  for (const mutate of cases) {
    const candidate = structuredClone(result);
    mutate(candidate);
    assert.equal(isScriptStoryboardResult(candidate), false);
  }
});
