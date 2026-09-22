const projectId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const digest = "a".repeat(64);

function source(index) {
  const startMs = (index - 1) * 1000;
  const endMs = index * 1000;
  return {
    sourceAssetId: assetId,
    sourceSentenceCacheKey: "b".repeat(64),
    sentenceIndex: index,
    timecode: { startMs, endMs },
    previewUri: `supervideo://asset/${assetId}?kind=audio&startMs=${startMs}&endMs=${endMs}`,
  };
}

function c02Segment(index, role, text) {
  return {
    segmentId: `segment-${index}`,
    order: index,
    role,
    slotId: `slot-${index}`,
    slotKind: role === "hook" ? "hook" : role === "cta" ? "cta" : "claim",
    sourceText: text,
    status: "matched",
    candidateSentenceId: String(index).padStart(64, "0"),
    candidateRank: 1,
    sentenceText: text,
    source: source(index),
    durationMs: 1000,
    selectionReason: "b09-final-score;complete;facts-preserved",
    gapReason: null,
  };
}

const sourcePlan = {
  schemaVersion: 1,
  planVersion: "narrative-remix-plan-v1",
  inputVersion: "deterministic-narrative-input-v1",
  projectId,
  theme: "招聘",
  audience: "求职者",
  outline: "招工机会就在眼前。\n装配线操作工在江苏昆山上班。\n私信岗位名称，确认报名信息。",
  targetDurationMs: 3000,
  toleranceLowerMs: 2400,
  toleranceUpperMs: 3600,
  selectedDurationMs: 3000,
  durationStatus: "within-tolerance",
  status: "ready",
  selectionPolicy: "b10-first-complete-candidate-v1",
  alignmentVersion: "information-slot-alignment-v1",
  planDigest: digest,
  segments: [
    c02Segment(1, "hook", "招工机会就在眼前。"),
    c02Segment(2, "body", "装配线操作工在江苏昆山上班。"),
    c02Segment(3, "cta", "私信岗位名称，确认报名信息。"),
  ],
  gaps: [],
};

const provenance = [
  { id: "prov-brief", kind: "user-brief", label: "用户提供的招聘简报", verified: true },
  { id: `c02:${digest.slice(0, 16)}:segment-1`, kind: "c02-segment", label: "C02 complete-sentence source", sourceSegmentId: "segment-1", verified: true },
  { id: `c02:${digest.slice(0, 16)}:segment-2`, kind: "c02-segment", label: "C02 complete-sentence source", sourceSegmentId: "segment-2", verified: true },
  { id: `c02:${digest.slice(0, 16)}:segment-3`, kind: "c02-segment", label: "C02 complete-sentence source", sourceSegmentId: "segment-3", verified: true },
];

const facts = [
  { id: "fact-job", field: "jobTitle", value: "装配线操作工", provenanceIds: ["prov-brief"], verification: "verified" },
  { id: "fact-location", field: "location", value: "江苏昆山", provenanceIds: ["prov-brief"], verification: "verified" },
];

const input = {
  schemaVersion: 1,
  contractVersion: "script-storyboard-v1",
  projectId,
  brief: { theme: "招聘", audience: "求职者", objective: "说明岗位事实并引导用户确认报名", language: "zh-CN" },
  facts,
  forbiddenInferences: ["不得补充未提供的薪资、福利、资格或录用承诺"],
  target: { platform: "douyin", aspectRatio: "9:16", durationMs: 3000, tolerancePercent: 20 },
  visualContext: { hasUserMaterial: false },
  provenance: [provenance[0]],
  factBindings: [{ segmentId: "segment-2", factIds: ["fact-job", "fact-location"] }],
  sourcePlan,
};

function outputSegment(segment, index, factIds) {
  const derived = provenance[index].id;
  return {
    segmentId: segment.segmentId,
    sourceSegmentId: segment.segmentId,
    order: index + 1,
    role: segment.role,
    status: "matched",
    sentenceId: segment.candidateSentenceId,
    text: segment.sentenceText,
    source: segment.source,
    durationMs: segment.durationMs,
    provenanceIds: [...new Set([derived, ...factIds.flatMap((factId) => facts.find((item) => item.id === factId).provenanceIds)])],
    factIds,
    confirmation: factIds.length > 0 ? "verified" : "not-required",
  };
}

const hook = outputSegment(sourcePlan.segments[0], 0, []);
const body = outputSegment(sourcePlan.segments[1], 1, ["fact-job", "fact-location"]);
const cta = outputSegment(sourcePlan.segments[2], 2, []);
const result = {
  schemaVersion: 1,
  contractVersion: "script-storyboard-v1",
  plannerVersion: "deterministic-offline-script-storyboard-v1",
  projectId,
  sourcePlanDigest: digest,
  durationPlanSourceDigest: null,
  targetDurationMs: 3000,
  toleranceLowerMs: 2400,
  toleranceUpperMs: 3600,
  selectedDurationMs: 3000,
  durationStatus: "within-tolerance",
  durationPolicy: "c02-complete-sentence-v1",
  status: "ready",
  brief: input.brief,
  forbiddenInferences: input.forbiddenInferences,
  provenance,
  facts: [
    { factId: "fact-job", status: "bound", provenanceIds: ["prov-brief"], segmentIds: ["segment-2"] },
    { factId: "fact-location", status: "bound", provenanceIds: ["prov-brief"], segmentIds: ["segment-2"] },
  ],
  script: { hook, body: [body], cta },
  shots: [hook, body, cta].map((segment, index) => ({
    shotId: `shot-${index + 1}`,
    order: index + 1,
    segmentId: segment.segmentId,
    durationMs: segment.durationMs,
    visualSourcePriority: ["licensed-stock", "ai-image", "remotion-template", "text-card"],
    fallbackReason: "no-user-material",
    visualIntent: `support the ${segment.role} with an allowed visual source`,
  })),
};

export { input, result };
