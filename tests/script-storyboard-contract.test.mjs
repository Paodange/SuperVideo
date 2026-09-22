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
