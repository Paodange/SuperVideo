import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";
import type { DesktopEnvironment } from "@supervideo/shared";
import {
  createBrowserWindowOptions,
  createContentSecurityPolicy,
  createRuntimeConfig,
  getPreloadPath,
  type RuntimeConfig,
} from "./security/config";
import { createSecurityLogger } from "./security/diagnostics";
import { registerDesktopIpcHandlers } from "./security/ipc";
import { denyWindowOpen, isTrustedRendererUrl, sanitizeUrlForDiagnostics } from "./security/policies";
import { registerSessionSecurity } from "./security/session";

const log = createSecurityLogger();

function getRendererPath(): string {
  // __dirname is the compiled Main directory. Renderer input is not involved in
  // resolving either the local document or the preload script.
  return path.join(__dirname, "..", "renderer", "index.html");
}

function getDesktopEnvironment(runtime: RuntimeConfig): DesktopEnvironment {
  return {
    mode: runtime.mode,
    platform: process.platform,
    electron: process.versions.electron ?? "unknown",
  };
}

function createWindow(runtime: RuntimeConfig): BrowserWindow {
  const window = new BrowserWindow(createBrowserWindowOptions(getPreloadPath(__dirname), runtime.mode === "production"));
  let loadState: "loading" | "ready" | "failed" = "loading";

  const rejectUntrustedNavigation = (event: Electron.Event, url: string, kind: string): void => {
    if (!isTrustedRendererUrl(url, runtime)) {
      event.preventDefault();
      log("navigation-rejected", { kind, url: sanitizeUrlForDiagnostics(url) });
    }
  };

  // These listeners are installed before loadURL/loadFile so untrusted page
  // content never gets a chance to navigate or open a privileged child window.
  window.webContents.on("will-navigate", (event, url) => rejectUntrustedNavigation(event, url, "navigate"));
  window.webContents.on("will-redirect", (event, url) => rejectUntrustedNavigation(event, url, "redirect"));
  window.webContents.setWindowOpenHandler(({ url }) => {
    log("window-open-rejected", { url: sanitizeUrlForDiagnostics(url) });
    return denyWindowOpen();
  });

  window.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      loadState = "failed";
      log("renderer-load-failed", {
        code: errorCode,
        url: sanitizeUrlForDiagnostics(validatedURL),
      });
    }
  });

  window.once("ready-to-show", () => {
    loadState = "ready";
    window.show();
  });

  const load = runtime.devServerUrl ? window.loadURL(runtime.devServerUrl) : window.loadFile(runtime.rendererPath);
  void load.catch(() => {
    if (loadState !== "failed") {
      loadState = "failed";
      log("renderer-load-failed", { code: "load-rejected", url: "[local-renderer]" });
    }
  });

  return window;
}

app.whenReady().then(() => {
  const runtime = createRuntimeConfig({
    isPackaged: app.isPackaged,
    argv: process.argv,
    rendererPath: getRendererPath(),
  });

  if (runtime.rejectedDevServerArgument) {
    log("dev-server-rejected", { reason: "not-a-local-http-origin" });
  }

  // The session boundary and IPC allowlist are installed before the first
  // renderer document is loaded. Every later window reuses the same policy.
  registerSessionSecurity(session.defaultSession, {
    contentSecurityPolicy: createContentSecurityPolicy(runtime),
    log,
  });
  registerDesktopIpcHandlers(ipcMain, {
    rendererTrustPolicy: runtime,
    getEnvironment: () => getDesktopEnvironment(runtime),
    log,
  });

  createWindow(runtime);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(runtime);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
