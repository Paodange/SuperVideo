/** E01 bounded, versioned research and source provenance contract. */
export const RESEARCH_SCHEMA_VERSION = 1 as const;
export const RESEARCH_CONTRACT_VERSION = "research-v1" as const;
export const RESEARCH_MAX_RESULTS = 10;
export const RESEARCH_MAX_CITATIONS = 8;
export const RESEARCH_MAX_FACTS = 8;
export const RESEARCH_TRANSPORTS = ["deterministic-fake-v1"] as const;
export type ResearchTransportKind = (typeof RESEARCH_TRANSPORTS)[number];

export type ResearchCitation = Readonly<{ citationId: string; locator: "title" | "summary"; quote: string }>;
export type ResearchFact = Readonly<{ factId: string; statement: string; citationIds: readonly string[] }>;
export type ResearchEvidence = Readonly<{ status: "unverified"; citations: readonly ResearchCitation[]; facts: readonly ResearchFact[] }>;
export type ResearchProvenance = Readonly<{ transport: ResearchTransportKind; fixtureId: string }>;
export type ResearchSourceInput = Readonly<{
  url: string;
  title: string;
  summary: string;
  siteName: string | null;
  author: string | null;
  fetchedAtMs: number;
  contentDigest: string;
  sourceDigest: string;
  evidence: ResearchEvidence;
  provenance: ResearchProvenance;
}>;
export type ResearchSourceRecord = ResearchSourceInput & Readonly<{ sourceId: string; projectId: string; createdAtMs: number }>;
export type ResearchSearchHit = ResearchSourceInput & Readonly<{ rank: number; matchScore: number }>;
export type ResearchSearchParams = Readonly<{
  schemaVersion: 1;
  contractVersion: typeof RESEARCH_CONTRACT_VERSION;
  projectId: string;
  requestId: string;
  idempotencyKey: string;
  topic: string;
  audience: string;
  query: string;
  limit?: number;
  timeoutMs?: number;
}>;
export type ResearchSearchResult = Readonly<{
  schemaVersion: 1;
  contractVersion: typeof RESEARCH_CONTRACT_VERSION;
  projectId: string;
  requestId: string;
  idempotencyKey: string;
  searchId: string;
  status: "fresh" | "replayed";
  topic: string;
  audience: string;
  query: string;
  limit: number;
  transport: ResearchTransportKind;
  createdAtMs: number;
  results: readonly ResearchSearchHit[];
}>;
export type ResearchSaveSourceParams = Readonly<{
  schemaVersion: 1;
  contractVersion: typeof RESEARCH_CONTRACT_VERSION;
  projectId: string;
  requestId: string;
  idempotencyKey: string;
  source: ResearchSourceInput;
}>;
export type ResearchSaveSourceResult = Readonly<{
  schemaVersion: 1;
  contractVersion: typeof RESEARCH_CONTRACT_VERSION;
  projectId: string;
  requestId: string;
  idempotencyKey: string;
  status: "created" | "existing" | "duplicate";
  record: ResearchSourceRecord;
}>;

export function isResearchSearchParams(value: unknown): value is ResearchSearchParams {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "contractVersion", "projectId", "requestId", "idempotencyKey", "topic", "audience", "query", "limit", "timeoutMs"])) return false;
  return value.schemaVersion === 1 && value.contractVersion === RESEARCH_CONTRACT_VERSION
    && isUuid(value.projectId) && isId(value.requestId, 64) && isId(value.idempotencyKey, 128)
    && isBoundedText(value.topic, 160) && isBoundedText(value.audience, 160) && isBoundedText(value.query, 512)
    && (value.limit === undefined || isSafeInteger(value.limit, 1, RESEARCH_MAX_RESULTS))
    && (value.timeoutMs === undefined || isSafeInteger(value.timeoutMs, 1, 120_000));
}

export function isResearchSaveSourceParams(value: unknown): value is ResearchSaveSourceParams {
  return isRecord(value) && hasExactKeys(value, ["schemaVersion", "contractVersion", "projectId", "requestId", "idempotencyKey", "source"])
    && value.schemaVersion === 1 && value.contractVersion === RESEARCH_CONTRACT_VERSION
    && isUuid(value.projectId) && isId(value.requestId, 64) && isId(value.idempotencyKey, 128)
    && isResearchSourceInput(value.source);
}

export function isResearchSearchResult(value: unknown): value is ResearchSearchResult {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "contractVersion", "projectId", "requestId", "idempotencyKey", "searchId", "status", "topic", "audience", "query", "limit", "transport", "createdAtMs", "results"])) return false;
  if (value.schemaVersion !== 1 || value.contractVersion !== RESEARCH_CONTRACT_VERSION || !isUuid(value.projectId)
    || !isId(value.requestId, 64) || !isId(value.idempotencyKey, 128) || !isId(value.searchId, 128)
    || !["fresh", "replayed"].includes(value.status as string) || !isBoundedText(value.topic, 160)
    || !isBoundedText(value.audience, 160) || !isBoundedText(value.query, 512) || !isSafeInteger(value.limit, 1, RESEARCH_MAX_RESULTS)
    || !isResearchTransport(value.transport) || !isTimestamp(value.createdAtMs) || !Array.isArray(value.results)
    || value.results.length > RESEARCH_MAX_RESULTS) return false;
  return value.results.every((item, index) => isResearchSearchHit(item) && item.rank === index + 1);
}

export function isResearchSaveSourceResult(value: unknown): value is ResearchSaveSourceResult {
  return isRecord(value) && hasExactKeys(value, ["schemaVersion", "contractVersion", "projectId", "requestId", "idempotencyKey", "status", "record"])
    && value.schemaVersion === 1 && value.contractVersion === RESEARCH_CONTRACT_VERSION && isUuid(value.projectId)
    && isId(value.requestId, 64) && isId(value.idempotencyKey, 128)
    && ["created", "existing", "duplicate"].includes(value.status as string)
    && isResearchSourceRecord(value.record) && value.record.projectId === value.projectId;
}

export function isResearchSourceInput(value: unknown): value is ResearchSourceInput {
  return isResearchSourceFields(value);
}

function isResearchSourceFields(value: unknown): value is ResearchSourceInput {
  if (!isRecord(value) || !hasExactKeys(value, ["url", "title", "summary", "siteName", "author", "fetchedAtMs", "contentDigest", "sourceDigest", "evidence", "provenance"])) return false;
  return isResearchUrl(value.url) && isBoundedText(value.title, 240) && isBoundedText(value.summary, 4_000)
    && (value.siteName === null || isBoundedText(value.siteName, 160))
    && (value.author === null || isBoundedText(value.author, 160)) && isTimestamp(value.fetchedAtMs)
    && isDigest(value.contentDigest) && isDigest(value.sourceDigest) && isResearchEvidence(value.evidence)
    && isResearchProvenance(value.provenance);
}

export function isResearchSourceRecord(value: unknown): value is ResearchSourceRecord {
  return isRecord(value) && hasExactKeys(value, ["url", "title", "summary", "siteName", "author", "fetchedAtMs", "contentDigest", "sourceDigest", "evidence", "provenance", "sourceId", "projectId", "createdAtMs"])
    && isResearchSourceFields({ url: value.url, title: value.title, summary: value.summary, siteName: value.siteName, author: value.author, fetchedAtMs: value.fetchedAtMs, contentDigest: value.contentDigest, sourceDigest: value.sourceDigest, evidence: value.evidence, provenance: value.provenance })
    && isId(value.sourceId, 128) && isUuid(value.projectId) && isTimestamp(value.createdAtMs);
}

function isResearchSearchHit(value: unknown): value is ResearchSearchHit {
  return isRecord(value) && hasExactKeys(value, ["url", "title", "summary", "siteName", "author", "fetchedAtMs", "contentDigest", "sourceDigest", "evidence", "provenance", "rank", "matchScore"])
    && isResearchSourceFields({ url: value.url, title: value.title, summary: value.summary, siteName: value.siteName, author: value.author, fetchedAtMs: value.fetchedAtMs, contentDigest: value.contentDigest, sourceDigest: value.sourceDigest, evidence: value.evidence, provenance: value.provenance })
    && isSafeInteger(value.rank, 1, RESEARCH_MAX_RESULTS) && isFiniteInRange(value.matchScore, 0, 1);
}

function isResearchEvidence(value: unknown): value is ResearchEvidence {
  if (!isRecord(value) || !hasExactKeys(value, ["status", "citations", "facts"]) || value.status !== "unverified" || !Array.isArray(value.citations) || !Array.isArray(value.facts)) return false;
  if (value.citations.length > RESEARCH_MAX_CITATIONS || value.facts.length > RESEARCH_MAX_FACTS) return false;
  const citationIds = new Set<string>();
  for (const citation of value.citations) {
    if (!isRecord(citation) || !hasExactKeys(citation, ["citationId", "locator", "quote"]) || !isId(citation.citationId, 64) || !["title", "summary"].includes(citation.locator as string) || !isBoundedText(citation.quote, 512) || citationIds.has(citation.citationId)) return false;
    citationIds.add(citation.citationId);
  }
  const factIds = new Set<string>();
  for (const fact of value.facts) {
    if (!isRecord(fact) || !hasExactKeys(fact, ["factId", "statement", "citationIds"]) || !isId(fact.factId, 64) || !isBoundedText(fact.statement, 512) || !Array.isArray(fact.citationIds) || fact.citationIds.length === 0 || fact.citationIds.length > RESEARCH_MAX_CITATIONS || factIds.has(fact.factId)) return false;
    factIds.add(fact.factId);
    if (new Set(fact.citationIds).size !== fact.citationIds.length || !fact.citationIds.every((id) => isId(id, 64) && citationIds.has(id))) return false;
  }
  return true;
}

function isResearchProvenance(value: unknown): value is ResearchProvenance {
  return isRecord(value) && hasExactKeys(value, ["transport", "fixtureId"]) && isResearchTransport(value.transport) && isId(value.fixtureId, 64);
}

function isResearchTransport(value: unknown): value is ResearchTransportKind {
  return (RESEARCH_TRANSPORTS as readonly unknown[]).includes(value);
}

function isResearchUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048 || /[\s\\\u0000-\u001f\u007f]/.test(value) || /%(?:2e|2f|5c)/i.test(value) || /\/(?:\.{1,2})(?:\/|$)/.test(value)) return false;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || !host || host === "localhost" || [".localhost", ".local", ".internal", ".intranet", ".lan"].some((suffix) => host.endsWith(suffix)) || !host.includes(".")) return false;
  if (isDisallowedIp(host)) return false;
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(parsed.pathname); } catch { return false; }
  if (/[\u0000-\u001f\u007f]/.test(decodedPath) || decodedPath.split("/").some((part) => part === "." || part === "..")) return false;
  for (const [key, item] of parsed.searchParams.entries()) if (/(?:^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|credential|authorization|auth|cookie|signature|sig)(?:$|[_-])/i.test(key) || /(?:bearer\s+|sk-[A-Za-z0-9]{12,}|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=])/i.test(item)) return false;
  return true;
}

function isDisallowedIp(host: string): boolean {
  if (/^127\./.test(host) || host === "0.0.0.0" || host === "::1" || host === "::" || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31) || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}

function isRecord(value: unknown): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys); }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function isId(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function isBoundedText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value) && !/(?:^[A-Za-z]:[\\/]|^\\\\|^\/(?!\/)|sk-[A-Za-z0-9]{12,}|(?:api[_-]?key|access[_-]?token|bearer|password|secret)\s*[:=]|https?:\/\/|(?:file|data|javascript):)/i.test(value); }
function isDigest(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function isTimestamp(value: unknown): value is number { return isSafeInteger(value, 0, Number.MAX_SAFE_INTEGER); }
function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum; }
