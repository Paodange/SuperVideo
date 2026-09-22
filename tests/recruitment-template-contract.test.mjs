import assert from "node:assert/strict";
import test from "node:test";
import { isRecruitmentTemplateProps, isRecruitmentTemplateRenderPlan, buildRecruitmentTemplateRenderPlan } from "@supervideo/shared";
import timelineFixture from "./fixtures/c01_timeline_ir_v1.json" with { type: "json" };

const projectId = "11111111-1111-4111-8111-111111111111";

function props(templateId = "recruitment-classic", templateVersion = `${templateId}-v1`) {
  return {
    schemaVersion: 1,
    contractVersion: "recruitment-template-v1",
    runtimeMode: "offline-layout",
    projectId,
    templateId,
    templateVersion,
    timeline: structuredClone(timelineFixture),
    content: {
      title: "招工直招",
      jobTitle: "装配线操作工",
      salary: "6000-8500元/月",
      location: "江苏昆山",
      benefits: ["包吃住", "五险", "长白班"],
      cta: "私信岗位名称，马上报名",
      provenanceIds: ["prov-camera-a"],
    },
  };
}

function photoProps() {
  const value = props("recruitment-photo-pan", "recruitment-photo-pan-v1");
  value.timeline.sources.push({ id: "source-factory-image", kind: "external", uri: "supervideo://external/source-factory-image", mediaType: "image", provenanceIds: ["prov-factory-image"] });
  value.timeline.provenance.push({ id: "prov-factory-image", kind: "external", sourceId: "source-factory-image", uri: "supervideo://external/source-factory-image", license: "licensed-test" });
  value.media = { imageSourceId: "source-factory-image", provenanceIds: ["prov-factory-image"] };
  return value;
}

test("D04 fixed registry builds all four deterministic layout plans", () => {
  for (const [id, version] of [
    ["recruitment-classic", "recruitment-classic-v1"],
    ["recruitment-bold", "recruitment-bold-v1"],
    ["recruitment-split", "recruitment-split-v1"],
  ]) {
    const plan = buildRecruitmentTemplateRenderPlan(props(id, version));
    assert.equal(plan.runtimeMode, "offline-layout");
    assert.equal(plan.components.length, 6);
    assert.equal(plan.safeArea.left, 96);
    assert.equal(isRecruitmentTemplateRenderPlan(plan), true);
  }
  const photoPlan = buildRecruitmentTemplateRenderPlan(photoProps());
  assert.equal(photoPlan.components.length, 7);
  assert.equal(photoPlan.components[0].kind, "image-pan");
  assert.equal(photoPlan.overlapRule, "background-image-pan-may-overlap-foreground");
});

test("D04 rejects unknown keys, arbitrary versions, unsafe refs, and oversized text", () => {
  const valid = props();
  assert.equal(isRecruitmentTemplateProps(valid), true);
  assert.equal(isRecruitmentTemplateProps({ ...valid, rendererPath: "C:/escape" }), false);
  assert.equal(isRecruitmentTemplateProps({ ...valid, templateVersion: "attacker-v1" }), false);
  assert.equal(isRecruitmentTemplateProps({ ...valid, content: { ...valid.content, extra: true } }), false);
  assert.equal(isRecruitmentTemplateProps({ ...valid, content: { ...valid.content, title: "x".repeat(25) } }), false);
  assert.equal(isRecruitmentTemplateProps({ ...valid, timeline: { ...valid.timeline, durationMs: 60_001 } }), false);
  assert.equal(isRecruitmentTemplateProps({ ...valid, timeline: { ...valid.timeline, canvas: { ...valid.timeline.canvas, width: 1081 } } }), false);
  assert.equal(isRecruitmentTemplateProps({ ...valid, content: { ...valid.content, provenanceIds: ["missing"] } }), false);
});

test("D04 requires photo source/provenance binding and rejects arbitrary layout boxes", () => {
  const missingMedia = props("recruitment-photo-pan", "recruitment-photo-pan-v1");
  assert.equal(isRecruitmentTemplateProps(missingMedia), false);
  const validPlan = buildRecruitmentTemplateRenderPlan(photoProps());
  const outside = structuredClone(validPlan);
  outside.components[1].box.x = 0;
  assert.equal(isRecruitmentTemplateRenderPlan(outside), false);
  const overlap = structuredClone(buildRecruitmentTemplateRenderPlan(props()));
  overlap.components[1].box.y = overlap.components[0].box.y;
  assert.equal(isRecruitmentTemplateRenderPlan(overlap), false);
  const forbidden = structuredClone(validPlan);
  forbidden.secret = "never";
  assert.equal(isRecruitmentTemplateRenderPlan(forbidden), false);
});
