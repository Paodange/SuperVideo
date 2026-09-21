import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BrowserWindowConstructorOptions } from "electron";

export type RuntimeMode = "development" | "production";

export type RuntimeConfig = Readonly<{
  mode: RuntimeMode;
  devServerUrl?: string;
  rendererPath: string;
  allowedRendererOrigins: readonly string[];
  allowedRendererUrls: readonly string[];
  rejectedDevServerArgument?: boolean;
}>;

export type ContentSecurityPolicyOptions = Readonly<{
  mode: RuntimeMode;
  devServerUrl?: string;
}>;

const DEV_SERVER_ARGUMENT_PREFIX = "--dev-server=";
const LOCAL_DEV_SERVER_PATTERN = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/;

/**
 * The dev server is an input boundary even though it comes from a local command
 * line. Keeping this parser strict prevents a typo or copied argument from
 * turning the desktop shell into a remote privileged page.
 */
export function parseAllowedDevServerUrl(value: string): string | undefined {
  const match = LOCAL_DEV_SERVER_PATTERN.exec(value);
  if (!match) {
    return undefined;
  }

  const port = Number(match[1]);
  return port >= 1 && port <= 65_535 ? `http://127.0.0.1:${port}` : undefined;
}

export function readDevServerArgument(argv: readonly string[]): string | undefined {
  const candidates = argv.filter((argument) => argument.startsWith(DEV_SERVER_ARGUMENT_PREFIX));
  return candidates.length === 1 ? candidates[0]?.slice(DEV_SERVER_ARGUMENT_PREFIX.length) : undefined;
}

export function createRuntimeConfig(options: {
  isPackaged: boolean;
  argv: readonly string[];
  rendererPath: string;
}): RuntimeConfig {
  const rendererPath = path.resolve(options.rendererPath);
  const localRendererUrl = pathToFileURL(rendererPath).toString();
  const mode: RuntimeMode = options.isPackaged ? "production" : "development";

  // Packaged applications deliberately never inspect --dev-server. The local
  // file is the only production content source, even when extra argv is present.
  if (options.isPackaged) {
    return Object.freeze({
      mode,
      rendererPath,
      allowedRendererOrigins: Object.freeze(["file://"]),
      allowedRendererUrls: Object.freeze([localRendererUrl]),
    });
  }

  const requestedDevServer = readDevServerArgument(options.argv);
  const devServerUrl = requestedDevServer ? parseAllowedDevServerUrl(requestedDevServer) : undefined;
  const rejectedDevServerArgument = requestedDevServer !== undefined && devServerUrl === undefined;

  return Object.freeze({
    mode,
    ...(devServerUrl ? { devServerUrl } : {}),
    ...(rejectedDevServerArgument ? { rejectedDevServerArgument: true } : {}),
    rendererPath,
    allowedRendererOrigins: Object.freeze([devServerUrl ? new URL(devServerUrl).origin : "file://"]),
    allowedRendererUrls: Object.freeze(devServerUrl ? [] : [localRendererUrl]),
  });
}

export function getPreloadPath(mainDirectory: string): string {
  // This path is derived only by Main from its compiled location. It is never
  // accepted from Renderer input or from a command-line override.
  return path.join(mainDirectory, "..", "preload", "preload.js");
}

export function createBrowserWindowOptions(
  preloadPath: string,
  isPackaged = false,
): BrowserWindowConstructorOptions {
  return {
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    title: "SuperVideo",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !isPackaged,
      preload: preloadPath,
    },
  };
}

export function createContentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  if (options.mode === "production") {
    return [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "media-src 'self' supervideo:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-src 'none'",
    ].join("; ");
  }

  const devServerUrl = options.devServerUrl ? parseAllowedDevServerUrl(options.devServerUrl) : undefined;
  const devOrigin = devServerUrl ? new URL(devServerUrl).origin : undefined;
  const devWebSocketOrigin = devOrigin?.replace(/^http:/, "ws:");
  const connectSources = ["'self'", ...(devOrigin ? [devOrigin] : []), ...(devWebSocketOrigin ? [devWebSocketOrigin] : [])];
  const scriptSources = ["'self'", ...(devOrigin ? [devOrigin] : []), "'unsafe-eval'"];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self' supervideo:",
    "font-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join("; ");
}

export function rendererPathFromFileUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "file:" && !url.search && !url.hash ? fileURLToPath(url) : undefined;
  } catch {
    return undefined;
  }
}
