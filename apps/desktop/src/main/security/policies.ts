import path from "node:path";
import { fileURLToPath } from "node:url";

export type RendererTrustPolicy = Readonly<{
  allowedRendererOrigins: readonly string[];
  allowedRendererUrls: readonly string[];
}>;

export function isTrustedRendererUrl(url: string, policy: RendererTrustPolicy): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol === "file:") {
    if (parsed.search || parsed.hash) {
      return false;
    }

    const candidatePath = safeFilePath(parsed);
    return candidatePath !== undefined && policy.allowedRendererUrls.some((allowedUrl) => {
      const allowedPath = safeFilePathFromValue(allowedUrl);
      return allowedPath !== undefined && candidatePath === allowedPath;
    });
  }

  return policy.allowedRendererOrigins.includes(parsed.origin);
}

export function denyWindowOpen(): { action: "deny" } {
  return { action: "deny" };
}

export function denyPermissionRequest(): false {
  return false;
}

export function sanitizeUrlForDiagnostics(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "file:") {
      return "file://";
    }

    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol}//${url.hostname}${port}`;
  } catch {
    return "[invalid-url]";
  }
}

function safeFilePath(url: URL): string | undefined {
  try {
    return path.normalize(path.resolve(fileURLToPath(url)));
  } catch {
    return undefined;
  }
}

function safeFilePathFromValue(value: string): string | undefined {
  try {
    return safeFilePath(new URL(value));
  } catch {
    return undefined;
  }
}
