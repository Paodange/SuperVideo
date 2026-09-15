import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";

const devServerArgumentPrefix = "--dev-server=";

function getDevServerUrl(): string | undefined {
  const argument = process.argv.find((value) => value.startsWith(devServerArgumentPrefix));
  return argument?.slice(devServerArgumentPrefix.length);
}

function registerDesktopStatusHandler(): void {
  ipcMain.handle("desktop:get-environment", () => ({
    mode: app.isPackaged ? "production" : "development",
    platform: process.platform,
    electron: process.versions.electron ?? "unknown",
  }));
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    title: "SuperVideo",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "..", "preload", "preload.js"),
    },
  });

  const devServerUrl = getDevServerUrl();
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    return;
  }

  void window.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  registerDesktopStatusHandler();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
