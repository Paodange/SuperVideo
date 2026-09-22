import { isScriptStoryboardInput, isScriptStoryboardResult, validateScriptStoryboardResult } from "@supervideo/shared";
import { input, result } from "../tests/fixtures/d05_script_storyboard_v1.mjs";

if (!isScriptStoryboardInput(input) || !isScriptStoryboardResult(result)) {
  throw new Error("D05 script/storyboard fixture did not validate");
}

const tampered = structuredClone(result);
tampered.shots[0].visualSourcePriority = ["arbitrary-provider"];
if (isScriptStoryboardResult(tampered)) throw new Error("D05 accepted an unsupported visual provider");

const summary = validateScriptStoryboardResult(result);
console.log(JSON.stringify({
  contractVersion: summary.contractVersion,
  plannerVersion: summary.plannerVersion,
  status: summary.status,
  structure: [summary.script.hook.role, ...summary.script.body.map((item) => item.role), summary.script.cta.role],
  segmentIds: [summary.script.hook.segmentId, ...summary.script.body.map((item) => item.segmentId), summary.script.cta.segmentId],
  selectedDurationMs: summary.selectedDurationMs,
  visualPriorities: summary.shots.map((shot) => shot.visualSourcePriority),
  forbiddenInferenceCount: summary.forbiddenInferences.length,
}));
