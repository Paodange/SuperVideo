import { contextBridge, ipcRenderer } from "electron";

type DesktopEnvironment = {
  mode: "development" | "production";
  platform: string;
  electron: string;
};

contextBridge.exposeInMainWorld("supervideo", {
  getEnvironment: (): Promise<DesktopEnvironment> => ipcRenderer.invoke("desktop:get-environment"),
});
