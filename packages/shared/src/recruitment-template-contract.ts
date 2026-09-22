/**
 * D04 recruitment template V1.
 *
 * This is an offline layout contract, not a Remotion renderer.  The input has
 * no component names, paths, coordinates, styles, or executable references;
 * those values come only from the fixed registry below.
 */

import {
  isTimelineProject,
  type TimelineProject,
} from "./timeline-ir";

export const RECRUITMENT_TEMPLATE_SCHEMA_VERSION = 1 as const;
export const RECRUITMENT_TEMPLATE_CONTRACT_VERSION = "recruitment-template-v1" as const;
export const RECRUITMENT_TEMPLATE_RUNTIME_MODE = "offline-layout" as const;
export const RECRUITMENT_CANVAS = Object.freeze({ width: 1080, height: 1920, fps: 30 });
export const RECRUITMENT_SAFE_AREA = Object.freeze({ left: 96, top: 192, right: 96, bottom: 240 });
export const RECRUITMENT_MIN_DURATION_MS = 1_000;
export const RECRUITMENT_MAX_DURATION_MS = 60_000;
export const RECRUITMENT_MAX_INPUT_BYTES = 768 * 1024;
export const RECRUITMENT_MAX_OUTPUT_BYTES = 256 * 1024;

export const RECRUITMENT_TEMPLATE_IDS = [
  "recruitment-classic",
  "recruitment-bold",
  "recruitment-split",
  "recruitment-photo-pan",
] as const;
export type RecruitmentTemplateId = (typeof RECRUITMENT_TEMPLATE_IDS)[number];
export type RecruitmentTemplateVersion =
  | "recruitment-classic-v1"
  | "recruitment-bold-v1"
  | "recruitment-split-v1"
  | "recruitment-photo-pan-v1";

export type RecruitmentTemplateProps = Readonly<{
  schemaVersion: typeof RECRUITMENT_TEMPLATE_SCHEMA_VERSION;
  contractVersion: typeof RECRUITMENT_TEMPLATE_CONTRACT_VERSION;
  runtimeMode: typeof RECRUITMENT_TEMPLATE_RUNTIME_MODE;
  projectId: string;
  templateId: RecruitmentTemplateId;
  templateVersion: RecruitmentTemplateVersion;
  timeline: TimelineProject;
  content: RecruitmentContent;
  media?: RecruitmentMedia;
}>;

export type RecruitmentContent = Readonly<{
  title: string;
  jobTitle: string;
  salary: string;
  location: string;
  benefits: readonly string[];
  cta: string;
  provenanceIds: readonly string[];
}>;

export type RecruitmentMedia = Readonly<{
  imageSourceId: string;
  provenanceIds: readonly string[];
}>;

export type RecruitmentBox = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type RecruitmentSafeArea = Readonly<{
  left: 96;
  top: 192;
  right: 96;
  bottom: 240;
}>;

export type RecruitmentTextComponent = Readonly<{
  id: "title" | "job" | "salary" | "location" | "benefits" | "cta";
  kind: "text";
  role: "title" | "job" | "salary" | "location" | "benefits" | "cta";
  box: RecruitmentBox;
  text: string;
  fontSize: number;
  lineHeight: number;
  maxLines: number;
  color: string;
  backgroundColor: string;
}>;

export type RecruitmentImagePanComponent = Readonly<{
  id: "image-pan";
  kind: "image-pan";
  sourceId: string;
  box: RecruitmentBox;
  motion: "slow-zoom-in";
  scaleFrom: 1;
  scaleTo: 1.08;
}>;

export type RecruitmentComponent = RecruitmentTextComponent | RecruitmentImagePanComponent;

export type RecruitmentTemplateRenderPlan = Readonly<{
  schemaVersion: typeof RECRUITMENT_TEMPLATE_SCHEMA_VERSION;
  contractVersion: typeof RECRUITMENT_TEMPLATE_CONTRACT_VERSION;
  runtimeMode: typeof RECRUITMENT_TEMPLATE_RUNTIME_MODE;
  projectId: string;
  timelineId: string;
  templateId: RecruitmentTemplateId;
  templateVersion: RecruitmentTemplateVersion;
  canvas: typeof RECRUITMENT_CANVAS;
  safeArea: RecruitmentSafeArea;
  components: readonly RecruitmentComponent[];
  sourceIds: readonly string[];
  provenanceIds: readonly string[];
  overlapRule: "background-image-pan-may-overlap-foreground" | "no-overlap";
}>;

export type RecruitmentTemplateDefinition = Readonly<{
  templateId: RecruitmentTemplateId;
  templateVersion: RecruitmentTemplateVersion;
  boxes: Readonly<Record<"title" | "job" | "salary" | "location" | "benefits" | "cta", RecruitmentBox>>;
  fontSizes: Readonly<Record<"title" | "job" | "salary" | "location" | "benefits" | "cta", number>>;
  colors: Readonly<Record<"title" | "job" | "salary" | "location" | "benefits" | "cta", string>>;
}>;

export const RECRUITMENT_TEMPLATE_REGISTRY: Readonly<Record<RecruitmentTemplateId, RecruitmentTemplateDefinition>> = Object.freeze({
  "recruitment-classic": definition("recruitment-classic", "recruitment-classic-v1", {
    title: box(128, 240, 824, 150), job: box(128, 430, 824, 150), salary: box(128, 640, 824, 160),
    location: box(128, 840, 824, 100), benefits: box(128, 990, 824, 240), cta: box(128, 1330, 824, 180),
  }, { title: 64, job: 52, salary: 72, location: 36, benefits: 32, cta: 42 }, {
    title: "#FFFFFF", job: "#FFFFFF", salary: "#FFD166", location: "#E8EEF7", benefits: "#E8EEF7", cta: "#111827",
  }),
  "recruitment-bold": definition("recruitment-bold", "recruitment-bold-v1", {
    title: box(128, 224, 824, 170), job: box(128, 430, 824, 155), salary: box(128, 660, 824, 180),
    location: box(128, 880, 824, 100), benefits: box(128, 1020, 824, 250), cta: box(128, 1370, 824, 190),
  }, { title: 70, job: 54, salary: 80, location: 38, benefits: 34, cta: 44 }, {
    title: "#111827", job: "#111827", salary: "#B42318", location: "#344054", benefits: "#344054", cta: "#FFFFFF",
  }),
  "recruitment-split": definition("recruitment-split", "recruitment-split-v1", {
    title: box(128, 228, 824, 145), job: box(128, 420, 824, 145), salary: box(128, 635, 824, 170),
    location: box(128, 850, 824, 105), benefits: box(128, 1010, 824, 270), cta: box(128, 1400, 824, 185),
  }, { title: 60, job: 50, salary: 76, location: 36, benefits: 32, cta: 44 }, {
    title: "#0B3B60", job: "#0B3B60", salary: "#0B3B60", location: "#276749", benefits: "#334155", cta: "#FFFFFF",
  }),
  "recruitment-photo-pan": definition("recruitment-photo-pan", "recruitment-photo-pan-v1", {
    title: box(128, 300, 824, 150), job: box(128, 480, 824, 150), salary: box(128, 690, 824, 170),
    location: box(128, 900, 824, 105), benefits: box(128, 1050, 824, 250), cta: box(128, 1390, 824, 190),
  }, { title: 62, job: 52, salary: 76, location: 36, benefits: 32, cta: 44 }, {
    title: "#FFFFFF", job: "#FFFFFF", salary: "#FFE08A", location: "#FFFFFF", benefits: "#FFFFFF", cta: "#111827",
  }),
});

export class RecruitmentTemplateValidationException extends Error {
  readonly errors: readonly RecruitmentTemplateValidationError[];

  constructor(errors: readonly RecruitmentTemplateValidationError[]) {
    super(errors.map((error) => `${error.path}: ${error.message}`).join("; "));
    this.name = "RecruitmentTemplateValidationException";
    this.errors = errors;
  }
}

export type RecruitmentTemplateValidationError = Readonly<{ path: string; message: string }>;

export function isRecruitmentTemplateProps(value: unknown): value is RecruitmentTemplateProps {
  try {
    validateRecruitmentTemplateProps(value);
    return true;
  } catch {
    return false;
  }
}

export function validateRecruitmentTemplateProps(value: unknown): RecruitmentTemplateProps {
  const errors: RecruitmentTemplateValidationError[] = [];
  const input = record(value, "$", errors);
  if (!input) throw new RecruitmentTemplateValidationException(errors);
  only(input, ["schemaVersion", "contractVersion", "runtimeMode", "projectId", "templateId", "templateVersion", "timeline", "content", "media"], "$", errors);
  if (input.schemaVersion !== 1) add(errors, "$.schemaVersion", "must be 1");
  if (input.contractVersion !== RECRUITMENT_TEMPLATE_CONTRACT_VERSION) add(errors, "$.contractVersion", "must be recruitment-template-v1");
  if (input.runtimeMode !== RECRUITMENT_TEMPLATE_RUNTIME_MODE) add(errors, "$.runtimeMode", "must be offline-layout");
  if (!isUuid(input.projectId)) add(errors, "$.projectId", "must be a UUID");
  const templateId = input.templateId;
  if (!isTemplateId(templateId)) add(errors, "$.templateId", "is not in the fixed allowlist");
  if (isTemplateId(templateId) && input.templateVersion !== RECRUITMENT_TEMPLATE_REGISTRY[templateId].templateVersion) add(errors, "$.templateVersion", "does not match templateId");
  const timeline = input.timeline;
  if (!isTimelineProject(timeline)) add(errors, "$.timeline", "must pass the C01 Timeline IR V1 validator");
  const content = validateContent(input.content, errors);
  const media = validateMedia(input.media, errors);
  if (isTimelineProject(timeline)) {
    if (timeline.canvas.width !== RECRUITMENT_CANVAS.width || timeline.canvas.height !== RECRUITMENT_CANVAS.height || timeline.canvas.fps !== RECRUITMENT_CANVAS.fps) add(errors, "$.timeline.canvas", "must be the fixed 1080x1920@30 canvas");
    if (!isSafeInteger(timeline.durationMs, RECRUITMENT_MIN_DURATION_MS, RECRUITMENT_MAX_DURATION_MS)) add(errors, "$.timeline.durationMs", "must be between 1000 and 60000 ms");
    validateTimelineBindings(timeline, content, media, templateId, errors);
  }
  rejectForbidden(value, errors);
  if (!boundedJson(value, RECRUITMENT_MAX_INPUT_BYTES)) add(errors, "$", "exceeds the D04 input size limit");
  if (errors.length > 0) throw new RecruitmentTemplateValidationException(errors);
  return value as RecruitmentTemplateProps;
}

export function isRecruitmentTemplateRenderPlan(value: unknown): value is RecruitmentTemplateRenderPlan {
  try {
    validateRecruitmentTemplateRenderPlan(value);
    return true;
  } catch {
    return false;
  }
}

export function validateRecruitmentTemplateRenderPlan(value: unknown): RecruitmentTemplateRenderPlan {
  const errors: RecruitmentTemplateValidationError[] = [];
  const plan = record(value, "$", errors);
  if (!plan) throw new RecruitmentTemplateValidationException(errors);
  only(plan, ["schemaVersion", "contractVersion", "runtimeMode", "projectId", "timelineId", "templateId", "templateVersion", "canvas", "safeArea", "components", "sourceIds", "provenanceIds", "overlapRule"], "$", errors);
  if (plan.schemaVersion !== 1 || plan.contractVersion !== RECRUITMENT_TEMPLATE_CONTRACT_VERSION || plan.runtimeMode !== RECRUITMENT_TEMPLATE_RUNTIME_MODE) add(errors, "$", "has an invalid fixed contract version");
  if (!isUuid(plan.projectId)) add(errors, "$.projectId", "must be a UUID");
  if (!isId(plan.timelineId)) add(errors, "$.timelineId", "must be a Timeline IR identifier");
  const templateId = plan.templateId;
  if (!isTemplateId(templateId)) add(errors, "$.templateId", "is not in the fixed allowlist");
  if (isTemplateId(templateId) && plan.templateVersion !== RECRUITMENT_TEMPLATE_REGISTRY[templateId].templateVersion) add(errors, "$.templateVersion", "does not match templateId");
  if (!sameRecord(plan.canvas, RECRUITMENT_CANVAS)) add(errors, "$.canvas", "must be the fixed 1080x1920@30 canvas");
  if (!sameRecord(plan.safeArea, RECRUITMENT_SAFE_AREA)) add(errors, "$.safeArea", "must be the fixed Douyin safe area");
  const components = array(plan.components, 7, "$.components", errors);
  if (isTemplateId(templateId) && components) validateComponents(components, RECRUITMENT_TEMPLATE_REGISTRY[templateId], plan.overlapRule, errors);
  validateIdArray(plan.sourceIds, "$.sourceIds", errors, false);
  validateIdArray(plan.provenanceIds, "$.provenanceIds", errors, true);
  if (isTemplateId(templateId)) {
    const sourceIds = Array.isArray(plan.sourceIds) ? plan.sourceIds : [];
    if (templateId === "recruitment-photo-pan" && sourceIds.length !== 1) add(errors, "$.sourceIds", "photo-pan must expose exactly one source identifier");
    if (templateId !== "recruitment-photo-pan" && sourceIds.length !== 0) add(errors, "$.sourceIds", "non-photo templates cannot expose media sources");
    if (templateId === "recruitment-photo-pan" && Array.isArray(plan.components)) {
      const image = plan.components.find((item) => isPlainRecord(item) && item.id === "image-pan");
      if (!image || sourceIds.length === 1 && image.sourceId !== sourceIds[0]) add(errors, "$.sourceIds", "must match the fixed image-pan source binding");
    }
  }
  if (plan.overlapRule !== "no-overlap" && plan.overlapRule !== "background-image-pan-may-overlap-foreground") add(errors, "$.overlapRule", "has an invalid overlap rule");
  rejectForbidden(value, errors);
  if (!boundedJson(value, RECRUITMENT_MAX_OUTPUT_BYTES)) add(errors, "$", "exceeds the D04 output size limit");
  if (errors.length > 0) throw new RecruitmentTemplateValidationException(errors);
  return value as RecruitmentTemplateRenderPlan;
}

export function buildRecruitmentTemplateRenderPlan(value: unknown): RecruitmentTemplateRenderPlan {
  const props = validateRecruitmentTemplateProps(value);
  const definition = RECRUITMENT_TEMPLATE_REGISTRY[props.templateId];
  const content = props.content;
  const components: RecruitmentComponent[] = [
    textComponent("title", content.title, definition),
    textComponent("job", content.jobTitle, definition),
    textComponent("salary", content.salary, definition),
    textComponent("location", content.location, definition),
    textComponent("benefits", content.benefits.join(" · "), definition),
    textComponent("cta", content.cta, definition),
  ];
  const sourceIds = props.media ? [props.media.imageSourceId] : [];
  if (props.templateId === "recruitment-photo-pan") {
    components.unshift({ id: "image-pan", kind: "image-pan", sourceId: props.media!.imageSourceId, box: box(RECRUITMENT_SAFE_AREA.left, RECRUITMENT_SAFE_AREA.top, RECRUITMENT_CANVAS.width - RECRUITMENT_SAFE_AREA.left - RECRUITMENT_SAFE_AREA.right, RECRUITMENT_CANVAS.height - RECRUITMENT_SAFE_AREA.top - RECRUITMENT_SAFE_AREA.bottom), motion: "slow-zoom-in", scaleFrom: 1, scaleTo: 1.08 });
  }
  const plan: RecruitmentTemplateRenderPlan = {
    schemaVersion: 1,
    contractVersion: RECRUITMENT_TEMPLATE_CONTRACT_VERSION,
    runtimeMode: RECRUITMENT_TEMPLATE_RUNTIME_MODE,
    projectId: props.projectId,
    timelineId: props.timeline.id,
    templateId: props.templateId,
    templateVersion: props.templateVersion,
    canvas: RECRUITMENT_CANVAS,
    safeArea: RECRUITMENT_SAFE_AREA,
    components,
    sourceIds,
    provenanceIds: [...new Set([...props.content.provenanceIds, ...(props.media?.provenanceIds ?? [])])],
    overlapRule: props.templateId === "recruitment-photo-pan" ? "background-image-pan-may-overlap-foreground" : "no-overlap",
  };
  return validateRecruitmentTemplateRenderPlan(plan);
}

function definition(templateId: RecruitmentTemplateId, templateVersion: RecruitmentTemplateVersion, boxes: RecruitmentTemplateDefinition["boxes"], fontSizes: RecruitmentTemplateDefinition["fontSizes"], colors: RecruitmentTemplateDefinition["colors"]): RecruitmentTemplateDefinition {
  return Object.freeze({ templateId, templateVersion, boxes: Object.freeze(boxes), fontSizes: Object.freeze(fontSizes), colors: Object.freeze(colors) });
}

function box(x: number, y: number, width: number, height: number): RecruitmentBox { return Object.freeze({ x, y, width, height }); }

function textComponent(role: RecruitmentTextComponent["role"], text: string, definition: RecruitmentTemplateDefinition): RecruitmentTextComponent {
  return { id: role, kind: "text", role, box: definition.boxes[role], text, fontSize: definition.fontSizes[role], lineHeight: 1.25, maxLines: role === "benefits" ? 4 : 2, color: definition.colors[role], backgroundColor: "#00000000" };
}

function validateContent(value: unknown, errors: RecruitmentTemplateValidationError[]): RecruitmentContent | undefined {
  const content = record(value, "$.content", errors);
  if (!content) return undefined;
  only(content, ["title", "jobTitle", "salary", "location", "benefits", "cta", "provenanceIds"], "$.content", errors);
  for (const [key, max] of [["title", 24], ["jobTitle", 32], ["salary", 24], ["location", 32], ["cta", 40]] as const) checkText(content[key], max, `$.content.${key}`, errors);
  const benefits = array(content.benefits, 5, "$.content.benefits", errors);
  if (!benefits || benefits.length === 0) add(errors, "$.content.benefits", "must contain 1 to 5 items");
  benefits?.forEach((item, index) => checkText(item, 20, `$.content.benefits[${index}]`, errors));
  const provenanceIds = validateIdArray(content.provenanceIds, "$.content.provenanceIds", errors, true);
  return typeof content.title === "string" && typeof content.jobTitle === "string" && typeof content.salary === "string" && typeof content.location === "string" && typeof content.cta === "string" && benefits?.every((item) => typeof item === "string") === true && provenanceIds !== undefined
    ? { title: content.title, jobTitle: content.jobTitle, salary: content.salary, location: content.location, benefits: benefits as string[], cta: content.cta, provenanceIds }
    : undefined;
}

function validateMedia(value: unknown, errors: RecruitmentTemplateValidationError[]): RecruitmentMedia | undefined {
  if (value === undefined) return undefined;
  const media = record(value, "$.media", errors);
  if (!media) return undefined;
  only(media, ["imageSourceId", "provenanceIds"], "$.media", errors);
  if (!isId(media.imageSourceId)) add(errors, "$.media.imageSourceId", "must be a Timeline source identifier");
  const provenanceIds = validateIdArray(media.provenanceIds, "$.media.provenanceIds", errors, true);
  return isId(media.imageSourceId) && provenanceIds !== undefined ? { imageSourceId: media.imageSourceId, provenanceIds } : undefined;
}

function validateTimelineBindings(timeline: TimelineProject, content: RecruitmentContent | undefined, media: RecruitmentMedia | undefined, templateId: unknown, errors: RecruitmentTemplateValidationError[]): void {
  const sourceIds = new Set(timeline.sources.map((source) => source.id));
  const provenance = new Map(timeline.provenance.map((item) => [item.id, item]));
  for (const id of content?.provenanceIds ?? []) if (!provenance.has(id)) add(errors, "$.content.provenanceIds", "must reference declared Timeline provenance");
  if (templateId === "recruitment-photo-pan") {
    if (!media) add(errors, "$.media", "is required by recruitment-photo-pan");
    if (media && (!sourceIds.has(media.imageSourceId) || timeline.sources.find((source) => source.id === media.imageSourceId)?.mediaType !== "image")) add(errors, "$.media.imageSourceId", "must reference a declared image source");
    for (const id of media?.provenanceIds ?? []) if (!provenance.has(id)) add(errors, "$.media.provenanceIds", "must reference declared Timeline provenance");
    const source = media ? timeline.sources.find((item) => item.id === media.imageSourceId) : undefined;
    if (source && media && !media.provenanceIds.every((id) => source.provenanceIds?.includes(id) === true)) add(errors, "$.media.provenanceIds", "must be bound to the image source provenance");
  } else if (media !== undefined) {
    add(errors, "$.media", "is only allowed for recruitment-photo-pan");
  }
  for (const source of timeline.sources) if (!CONTROLLED_URI.test(source.uri)) add(errors, "$.timeline.sources", "all source URIs must be controlled supervideo references");
  for (const item of timeline.provenance) if (item.uri !== undefined && !CONTROLLED_URI.test(item.uri)) add(errors, "$.timeline.provenance", "all provenance URIs must be controlled supervideo references");
}

function validateComponents(components: Record<string, unknown>[], definition: RecruitmentTemplateDefinition, overlapRule: unknown, errors: RecruitmentTemplateValidationError[]): void {
  const expected = ["title", "job", "salary", "location", "benefits", "cta"];
  const hasImage = components.length === 7;
  if (components.length !== (definition.templateId === "recruitment-photo-pan" ? 7 : 6)) add(errors, "$.components", "must contain the fixed component count");
  const boxes: Array<{ id: string; box: RecruitmentBox; kind: string }> = [];
  for (const [index, component] of components.entries()) {
    const path = `$.components[${index}]`;
    const id = component.id;
    if (id === "image-pan") {
      only(component, ["id", "kind", "sourceId", "box", "motion", "scaleFrom", "scaleTo"], path, errors);
      if (!hasImage || definition.templateId !== "recruitment-photo-pan" || component.kind !== "image-pan" || component.motion !== "slow-zoom-in" || component.scaleFrom !== 1 || component.scaleTo !== 1.08) add(errors, path, "image-pan is not the fixed allowed component");
      if (!isId(component.sourceId)) add(errors, `${path}.sourceId`, "must be a source identifier");
      const imageBox = readBox(component.box, `${path}.box`, errors);
      if (imageBox) boxes.push({ id: "image-pan", box: imageBox, kind: "image-pan" });
      continue;
    }
    if (!expected.includes(String(id))) { add(errors, `${path}.id`, "is not an allowlisted component"); continue; }
    only(component, ["id", "kind", "role", "box", "text", "fontSize", "lineHeight", "maxLines", "color", "backgroundColor"], path, errors);
    const role = id as RecruitmentTextComponent["role"];
    if (component.kind !== "text" || component.role !== role || !isPrintableText(component.text, 120)) add(errors, path, "is not a valid fixed text component");
    if (component.fontSize !== definition.fontSizes[role] || component.lineHeight !== 1.25 || component.maxLines !== (role === "benefits" ? 4 : 2) || component.color !== definition.colors[role] || component.backgroundColor !== "#00000000") add(errors, `${path}.style`, "must use the fixed registry style");
    const textBox = readBox(component.box, `${path}.box`, errors);
    if (textBox) boxes.push({ id: role, box: textBox, kind: "text" });
  }
  for (const role of expected) {
    const component = components.find((item) => item.id === role);
    const typedRole = role as RecruitmentTextComponent["role"];
    if (!component || !sameRecord(component.box, definition.boxes[typedRole])) add(errors, `$.components.${role}.box`, "must use the fixed registry coordinate");
  }
  if (overlapRule === "no-overlap" && hasOverlap(boxes)) add(errors, "$.components", "foreground components may not overlap");
  if (overlapRule === "background-image-pan-may-overlap-foreground" && boxes.some((item) => item.kind === "image-pan" && !insideSafeArea(item.box))) add(errors, "$.components.image-pan.box", "must stay inside the safe area");
}

function readBox(value: unknown, path: string, errors: RecruitmentTemplateValidationError[]): RecruitmentBox | undefined {
  const candidate = record(value, path, errors);
  if (!candidate) return undefined;
  only(candidate, ["x", "y", "width", "height"], path, errors);
  const result = [candidate.x, candidate.y, candidate.width, candidate.height];
  if (!result.every((item) => typeof item === "number" && Number.isSafeInteger(item) && item > 0)) add(errors, path, "must contain positive integer coordinates");
  const boxValue = candidate as unknown as RecruitmentBox;
  if (!insideSafeArea(boxValue)) add(errors, path, "must stay inside the fixed Douyin safe area");
  return result.every((item) => typeof item === "number" && Number.isSafeInteger(item) && item > 0) ? boxValue : undefined;
}

function insideSafeArea(value: RecruitmentBox): boolean {
  return value.x >= RECRUITMENT_SAFE_AREA.left && value.y >= RECRUITMENT_SAFE_AREA.top && value.x + value.width <= RECRUITMENT_CANVAS.width - RECRUITMENT_SAFE_AREA.right && value.y + value.height <= RECRUITMENT_CANVAS.height - RECRUITMENT_SAFE_AREA.bottom;
}

function hasOverlap(items: readonly { box: RecruitmentBox }[]): boolean {
  for (let left = 0; left < items.length; left += 1) for (let right = left + 1; right < items.length; right += 1) {
    const a = items[left]!.box; const b = items[right]!.box;
    if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) return true;
  }
  return false;
}

function validateIdArray(value: unknown, path: string, errors: RecruitmentTemplateValidationError[], required: boolean): string[] | undefined {
  const values = array(value, 32, path, errors);
  if (!values || (required && values.length === 0)) { if (required) add(errors, path, "must contain at least one identifier"); return undefined; }
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((item, index) => { if (!isId(item)) add(errors, `${path}[${index}]`, "must be a valid identifier"); else if (seen.has(item)) add(errors, path, "must not contain duplicate identifiers"); else { seen.add(item); result.push(item); } });
  return result.length === values.length ? result : undefined;
}

function checkText(value: unknown, maximum: number, path: string, errors: RecruitmentTemplateValidationError[]): void {
  if (!isPrintableText(value, maximum)) add(errors, path, `must be 1-${maximum} printable characters`);
}
function isPrintableText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length >= 1 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value) && value.trim().length > 0; }

function record(value: unknown, path: string, errors: RecruitmentTemplateValidationError[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) { add(errors, path, "must be a plain object"); return undefined; }
  return value as Record<string, unknown>;
}
function isPlainRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function array(value: unknown, maximum: number, path: string, errors: RecruitmentTemplateValidationError[]): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value) || value.length > maximum) { add(errors, path, `must be an array of at most ${maximum} items`); return undefined; }
  return value as Record<string, unknown>[];
}
function only(value: Record<string, unknown>, keys: readonly string[], path: string, errors: RecruitmentTemplateValidationError[]): void { for (const key of Object.keys(value)) if (!keys.includes(key)) add(errors, `${path}.${key}`, "unknown key is not allowed"); }
function add(errors: RecruitmentTemplateValidationError[], path: string, message: string): void { errors.push({ path, message }); }
function isTemplateId(value: unknown): value is RecruitmentTemplateId { return typeof value === "string" && (RECRUITMENT_TEMPLATE_IDS as readonly string[]).includes(value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function isId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function sameRecord(left: unknown, right: object): boolean { return typeof left === "object" && left !== null && !Array.isArray(left) && JSON.stringify(left) === JSON.stringify(right); }
function boundedJson(value: unknown, maximum: number): boolean { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maximum; } catch { return false; } }
function rejectForbidden(value: unknown, errors: RecruitmentTemplateValidationError[], depth = 0): void {
  if (depth > 16) { add(errors, "$", "nesting is too deep"); return; }
  if (Array.isArray(value)) { if (value.length > 2_048) add(errors, "$", "array is too large"); value.forEach((item) => rejectForbidden(item, errors, depth + 1)); return; }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) { if (/(?:secret|credential|token|password|command|executable|rendererpath|absolutepath)/i.test(key)) add(errors, `$.${key}`, "secret, credential, command, or absolute path fields are forbidden"); rejectForbidden(item, errors, depth + 1); }
}

const CONTROLLED_URI = /^supervideo:\/\/(?:asset|generated|external)\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?:\?[A-Za-z0-9._=&:-]{0,256})?$/;

export const D04_RECRUITMENT_CONTRACT = Object.freeze({
  schemaVersion: RECRUITMENT_TEMPLATE_SCHEMA_VERSION,
  contractVersion: RECRUITMENT_TEMPLATE_CONTRACT_VERSION,
  runtimeMode: RECRUITMENT_TEMPLATE_RUNTIME_MODE,
  canvas: RECRUITMENT_CANVAS,
  safeArea: RECRUITMENT_SAFE_AREA,
  templateIds: RECRUITMENT_TEMPLATE_IDS,
});
