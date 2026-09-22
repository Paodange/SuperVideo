import { buildRecruitmentTemplateRenderPlan } from "@supervideo/shared";
import { result as storyboard } from "./d05_script_storyboard_v1.mjs";

export const projectId = storyboard.projectId;
export const timelineId = "timeline-d07-demo";

const layoutTimeline = {
  schemaVersion: 1,
  id: timelineId,
  canvas: { width: 1080, height: 1920, fps: 30 },
  durationMs: storyboard.selectedDurationMs,
  tracks: [{
    id: "layout-track",
    kind: "overlay",
    clips: [{
      id: "layout-seed",
      trackId: "layout-track",
      kind: "text",
      timelineStartMs: 0,
      durationMs: storyboard.selectedDurationMs,
      editableInJianying: false,
      provenanceIds: ["prov-layout"],
      metadata: { purpose: "D04 layout plan seed" },
    }],
  }],
  sources: [],
  provenance: [{ id: "prov-layout", kind: "user-supplied", uri: "supervideo://asset/layout-brief", license: "user-provided" }],
};

const d04Props = {
  schemaVersion: 1,
  contractVersion: "recruitment-template-v1",
  runtimeMode: "offline-layout",
  projectId,
  templateId: "recruitment-classic",
  templateVersion: "recruitment-classic-v1",
  timeline: layoutTimeline,
  content: {
    title: "招工直招",
    jobTitle: "装配线操作工",
    salary: "薪资以用户确认事实为准",
    location: "江苏昆山",
    benefits: ["岗位事实请确认"],
    cta: "私信岗位名称，确认报名信息",
    provenanceIds: ["prov-layout"],
  },
};

export const d04Plan = buildRecruitmentTemplateRenderPlan(d04Props);
export const d03Plan = {
  contractVersion: "remotion-runtime-v1",
  renderVersion: "remotion-render-v1",
  runtimeMode: "offline-contract",
  templateId: "timeline-preview",
  templateVersion: "timeline-preview-v1",
  bundleVersion: "remotion-bundle-v1",
  compositionId: "timeline-preview-v1",
};

export const tts = {
  schemaVersion: 1,
  contractVersion: 1,
  adapterVersion: "fake-tts-v1",
  projectId,
  cacheStatus: "created",
  cacheKey: "d".repeat(64),
  providerId: "fake",
  model: "fake-tts-v1",
  voice: "alloy",
  durationMs: storyboard.selectedDurationMs,
  sentences: [storyboard.script.hook, ...storyboard.script.body, storyboard.script.cta].map((segment, index) => ({
    sentenceId: segment.sentenceId,
    text: segment.text,
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
    provenanceIds: [`d05:${segment.segmentId}`],
  })),
  output: {
    kind: "audio",
    relativePath: `generated/tts-v1/${"d".repeat(64)}.wav`,
    sizeBytes: 100,
    durationMs: storyboard.selectedDurationMs,
    outputFingerprint: "e".repeat(64),
  },
  provenance: { kind: "generated", providerId: "fake", model: "fake-tts-v1", voice: "alloy", adapterVersion: "fake-tts-v1" },
};

export const imageResults = storyboard.shots.map((shot, index) => {
  const cacheKey = `${String.fromCharCode(97 + index)}`.repeat(64);
  return {
    schemaVersion: 1,
    contractVersion: 1,
    adapterVersion: "fake-image-v1",
    projectId,
    cacheStatus: "created",
    cacheKey,
    providerId: "fake",
    model: "fake-image-v1",
    shotId: shot.shotId,
    prompt: `A deterministic recruitment visual for ${shot.shotId}.`,
    parameters: { width: 128, height: 128, steps: 8, seed: 7 + index },
    source: { kind: "d05-shot", id: `d05:shot:${index + 1}` },
    provenance: [{ kind: "script", id: `d05:script:${shot.shotId}` }],
    output: { kind: "image", mimeType: "image/png", relativePath: `generated/images-v1/${cacheKey}.png`, sizeBytes: 100, width: 128, height: 128, outputFingerprint: ["f", "1", "2"][index].repeat(64) },
    generationProvenance: { kind: "generated", providerId: "fake", model: "fake-image-v1", adapterVersion: "fake-image-v1", source: { kind: "d05-shot", id: `d05:shot:${index + 1}` }, provenance: [{ kind: "script", id: `d05:script:${shot.shotId}` }] },
  };
});

export const request = {
  schemaVersion: 1,
  contractVersion: "video-assembly-v1",
  runtimeMode: "offline-deterministic",
  projectId,
  timelineId,
  assemblyId: "assembly-d07-demo",
  storyboard,
  tts,
  imageResults,
  d04Plan,
  d03Plan,
};
