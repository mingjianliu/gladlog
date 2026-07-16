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
    importFiles: () => ipcRenderer.invoke("gladlog:logs:importFiles"),
    onImportProgress: sub("gladlog:import:progress"),
  },
  matches: {
    list: () => ipcRenderer.invoke("gladlog:matches:list"),
    get: (id) => ipcRenderer.invoke("gladlog:matches:get", id),
    page: (opts) => ipcRenderer.invoke("gladlog:matches:page", opts),
    rebuildIndex: () => ipcRenderer.invoke("gladlog:matches:rebuildIndex"),
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
  compare: {
    run: (input) => ipcRenderer.invoke("gladlog:compare:run", input),
    cancel: () => ipcRenderer.invoke("gladlog:compare:cancel"),
    getCached: (matchId) =>
      ipcRenderer.invoke("gladlog:compare:getCached", matchId),
    onDelta: sub<{ matchId: string; text: string }>("gladlog:compare:delta"),
    onDone: sub<{ matchId: string; result: unknown }>("gladlog:compare:done"),
    onError: sub<{ matchId: string; message: string }>("gladlog:compare:error"),
  },
  analysis: {
    run: (input) => ipcRenderer.invoke("gladlog:analysis:run", input),
    cancel: () => ipcRenderer.invoke("gladlog:analysis:cancel"),
    getCached: (matchId) =>
      ipcRenderer.invoke("gladlog:analysis:getCached", matchId),
    getFlags: (matchId) =>
      ipcRenderer.invoke("gladlog:analysis:getFlags", matchId),
    aggregate: () => ipcRenderer.invoke("gladlog:analysis:aggregate"),
    setFlag: (matchId, key, flag) =>
      ipcRenderer.invoke("gladlog:analysis:setFlag", matchId, key, flag),
    onDone: sub<{ matchId: string; result: unknown }>("gladlog:analysis:done"),
    onError: sub<{ matchId: string; message: string }>(
      "gladlog:analysis:error",
    ),
  },
  icon: {
    get: (name) => ipcRenderer.invoke("gladlog:icon:get", name),
  },
};
contextBridge.exposeInMainWorld("gladlog", api);
