import { contextBridge, ipcRenderer } from "electron";
import { createDesktopApi } from "./api";

const api = createDesktopApi(
  (channel, payload) => ipcRenderer.invoke(channel, payload),
  (channel, listener) => {
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
);

contextBridge.exposeInMainWorld("supervideo", api);
