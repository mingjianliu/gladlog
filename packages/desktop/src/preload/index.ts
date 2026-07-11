import { contextBridge, ipcRenderer } from "electron";
import type { GladlogApi } from "./api";

function sub<T>(channel: string) {
  return (cb: (payload: T) => void): (() => void) => {
    const listener = (_e: unknown, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const api: GladlogApi = {
  logs: {
    getStatus: () => ipcRenderer.invoke("gladlog:logs:getStatus"),
    onStatusChanged: sub("gladlog:logs:statusChanged"),
    onMatchStored: sub("gladlog:logs:matchStored"),
    onDiagnostic: sub("gladlog:logs:diagnostic"),
  },
  matches: {
    list: () => ipcRenderer.invoke("gladlog:matches:list"),
    get: (id) => ipcRenderer.invoke("gladlog:matches:get", id),
  },
  settings: {
    get: () => ipcRenderer.invoke("gladlog:settings:get"),
    save: (partial) => ipcRenderer.invoke("gladlog:settings:save", partial),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("gladlog:app:getVersion"),
    selectDirectory: () => ipcRenderer.invoke("gladlog:app:selectDirectory"),
    openExternal: (url) => ipcRenderer.invoke("gladlog:app:openExternal", url),
  },
  ai: {
    analyze: (matchId, context) =>
      ipcRenderer.invoke("gladlog:ai:analyze", matchId, context),
    cancel: () => ipcRenderer.invoke("gladlog:ai:cancel"),
    getCached: (matchId) => ipcRenderer.invoke("gladlog:ai:getCached", matchId),
    onDelta: sub<{ matchId: string; text: string }>("gladlog:ai:delta"),
    onDone: sub<{ matchId: string; content: string }>("gladlog:ai:done"),
    onError: sub<{ matchId: string; message: string }>("gladlog:ai:error"),
  },
};
contextBridge.exposeInMainWorld("gladlog", api);
