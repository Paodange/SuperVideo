import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const shared = await import(pathToFileURL(path.join(root, "packages", "shared", "dist", "index.js")).href);
const timeline = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "c01_timeline_ir_v1.json"), "utf8"));

function input(templateId, templateVersion) {
  return {
    schemaVersion: 1,
    contractVersion: "recruitment-template-v1",
    runtimeMode: "offline-layout",
    projectId: "11111111-1111-4111-8111-111111111111",
    templateId,
    templateVersion,
    timeline: structuredClone(timeline),
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

const results = [];
for (const [templateId, templateVersion] of [
  ["recruitment-classic", "recruitment-classic-v1"],
  ["recruitment-bold", "recruitment-bold-v1"],
  ["recruitment-split", "recruitment-split-v1"],
  ["recruitment-photo-pan", "recruitment-photo-pan-v1"],
]) {
  const value = input(templateId, templateVersion);
  if (templateId === "recruitment-photo-pan") {
    value.timeline.sources.push({ id: "source-factory-image", kind: "external", uri: "supervideo://external/source-factory-image", mediaType: "image", provenanceIds: ["prov-factory-image"] });
    value.timeline.provenance.push({ id: "prov-factory-image", kind: "external", sourceId: "source-factory-image", uri: "supervideo://external/source-factory-image", license: "licensed-test" });
    value.media = { imageSourceId: "source-factory-image", provenanceIds: ["prov-factory-image"] };
  }
  const plan = shared.buildRecruitmentTemplateRenderPlan(value);
  results.push({ templateId: plan.templateId, templateVersion: plan.templateVersion, runtimeMode: plan.runtimeMode, componentCount: plan.components.length, canvas: plan.canvas, safeArea: plan.safeArea });
}

console.log(JSON.stringify({ contractVersion: "recruitment-template-v1", results }, null, 2));
