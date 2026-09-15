import { contextBridge, ipcRenderer } from "electron";
import { createDesktopApi } from "./api";

const api = createDesktopApi((channel, payload) => ipcRenderer.invoke(channel, payload));

contextBridge.exposeInMainWorld("supervideo", api);
