import path from "node:path";

import type { MediaOutput } from "@supervideo/shared";

const ASSET_ID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const ASSET_PATH_PATTERN = new RegExp(`^/(${ASSET_ID_PATTERN})$`);
const INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;
const PROXY_OUTPUT_PATTERN = /^cache\/media-cache-v1\/proxy\/[0-9a-f]{64}\/(audio\.m4a|video\.mp4)$/;
const PREVIEW_OUTPUT_PATTERN = /^previews\/preview-render-v1\/[0-9a-f]{64}\.mp4$/;
const MAX_TIMESTAMP_MS = 86_400_000;

export type SuperVideoPlaybackRequest = Readonly<{
  assetId: string;
  kind: "audio" | "video";
  startMs: number;
  endMs: number;
}>;

export function parseSuperVideoPlaybackRequest(rawUrl: string): SuperVideoPlaybackRequest | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "supervideo:" || url.hostname !== "asset" || url.username || url.password || url.port || url.hash) return undefined;
    const match = ASSET_PATH_PATTERN.exec(url.pathname);
    if (!match || url.searchParams.size !== 3 || url.searchParams.getAll("kind").length !== 1 || url.searchParams.getAll("startMs").length !== 1 || url.searchParams.getAll("endMs").length !== 1) return undefined;
    const kind = url.searchParams.get("kind");
    const startText = url.searchParams.get("startMs");
    const endText = url.searchParams.get("endMs");
    if ((kind !== "audio" && kind !== "video") || !startText || !endText || !INTEGER_PATTERN.test(startText) || !INTEGER_PATTERN.test(endText)) return undefined;
    const startMs = Number(startText);
    const endMs = Number(endText);
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs || endMs > MAX_TIMESTAMP_MS) return undefined;
    return { assetId: match[1]!, kind, startMs, endMs };
  } catch {
    return undefined;
  }
}

export function resolveProxyOutput(projectRoot: string, output: MediaOutput, kind: "audio" | "video"): string | undefined {
  const relativeOutput = output.relativePath.replaceAll("\\", "/");
  const expectedFile = kind === "audio" ? "audio.m4a" : "video.mp4";
  if (output.kind !== kind || !PROXY_OUTPUT_PATTERN.test(relativeOutput) || !relativeOutput.endsWith(expectedFile)) return undefined;
  const root = path.resolve(projectRoot);
  const candidate = path.resolve(root, relativeOutput);
  const relative = path.relative(root, candidate);
  return relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) ? candidate : undefined;
}

export function parseSuperVideoPreviewRequest(rawUrl: string): { projectId: string; digest: string } | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "supervideo:" || url.hostname !== "preview" || url.username || url.password || url.port || url.search || url.hash) return undefined;
    const match = new RegExp(`^/(${ASSET_ID_PATTERN})/([0-9a-f]{64})$`).exec(url.pathname);
    return match ? { projectId: match[1]!, digest: match[2]! } : undefined;
  } catch {
    return undefined;
  }
}

export function resolvePreviewOutput(projectRoot: string, digest: string): string | undefined {
  if (!/^[0-9a-f]{64}$/.test(digest)) return undefined;
  const relativeOutput = `previews/preview-render-v1/${digest}.mp4`;
  if (!PREVIEW_OUTPUT_PATTERN.test(relativeOutput)) return undefined;
  const root = path.resolve(projectRoot);
  const candidate = path.resolve(root, relativeOutput);
  const relative = path.relative(root, candidate);
  return relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) ? candidate : undefined;
}
