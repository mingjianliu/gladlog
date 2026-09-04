import { contextBridge, ipcRenderer, webFrame } from "electron";

// Consumer-side parsing of the direct doc-bytes path: implementation and notes
// live in shared/parseDocBytes (the tests deep-equal it against the old
// pipeline directly).
import { parseDocBytes } from "../shared/parseDocBytes";
import { composeLazyDoc, parseRoundBytes } from "../shared/parseLazyDoc";
import { clampUiZoom } from "../shared/uiZoom";
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
    get: (id) =>
      ipcRenderer
        .invoke("gladlog:matches:get", id)
        .then((buf) => parseDocBytes(buf)),
    // perf-1: per-round lazy open. Any failure in the lazy compose falls back
    // to the whole-doc bytes (fail-open — worst case is the old cost).
    getLazy: async (id) => {
      const payload = (await ipcRenderer.invoke(
        "gladlog:matches:getLazy",
        id,
      )) as
        | { mode: "full"; bytes: unknown }
        | {
            mode: "perRound";
            shell: unknown;
            round0: unknown;
            roundCount: number;
          }
        | null;
      if (!payload) return null;
      if (payload.mode === "perRound") {
        const doc = composeLazyDoc(
          payload.shell,
          payload.round0,
          payload.roundCount,
        );
        if (doc) return doc;
      } else if (payload.mode === "full") {
        return parseDocBytes(payload.bytes);
      }
      return ipcRenderer
        .invoke("gladlog:matches:get", id)
        .then((buf) => parseDocBytes(buf));
    },
    getRound: (id, roundIndex) =>
      ipcRenderer
        .invoke("gladlog:matches:getRound", id, roundIndex)
        .then((buf) => parseRoundBytes(buf)),
    prefetch: (id) => ipcRenderer.invoke("gladlog:matches:prefetch", id),
    page: (opts) => ipcRenderer.invoke("gladlog:matches:page", opts),
    rebuildIndex: () => ipcRenderer.invoke("gladlog:matches:rebuildIndex"),
    onRebuildProgress: sub<{ i: number; n: number; id: string }>(
      "gladlog:matches:rebuildProgress",
    ),
    reparse: (id) => ipcRenderer.invoke("gladlog:matches:reparse", id),
    openDir: (id) => ipcRenderer.invoke("gladlog:matches:openDir", id),
    rawLine: (id, opts) =>
      ipcRenderer.invoke("gladlog:matches:rawLine", id, opts),
    exportImage: (opts) =>
      ipcRenderer.invoke("gladlog:matches:exportImage", opts),
    getRawStreams: (id, baseMs, roundDurationS) =>
      ipcRenderer.invoke(
        "gladlog:matches:getRawStreams",
        id,
        baseMs,
        roundDurationS,
      ),
  },
  settings: {
    get: () => ipcRenderer.invoke("gladlog:settings:get"),
    save: (partial) => ipcRenderer.invoke("gladlog:settings:save", partial),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("gladlog:app:getVersion"),
    selectDirectory: () => ipcRenderer.invoke("gladlog:app:selectDirectory"),
    openExternal: (url) => ipcRenderer.invoke("gladlog:app:openExternal", url),
    saveTextFile: (opts) =>
      ipcRenderer.invoke("gladlog:app:saveTextFile", opts),
  },
  update: {
    getState: () => ipcRenderer.invoke("gladlog:update:getState"),
    check: () => ipcRenderer.invoke("gladlog:update:check"),
    install: () => ipcRenderer.invoke("gladlog:update:install"),
    onState: sub("gladlog:update:state"),
  },
  compare: {
    run: (input) => ipcRenderer.invoke("gladlog:compare:run", input),
    cancel: () => ipcRenderer.invoke("gladlog:compare:cancel"),
    getCached: (matchId) =>
      ipcRenderer.invoke("gladlog:compare:getCached", matchId),
    getState: (matchId) =>
      ipcRenderer.invoke("gladlog:compare:getState", matchId),
    onDelta: sub<{ matchId: string; text: string }>("gladlog:compare:delta"),
    onDone: sub<{ matchId: string; result: unknown }>("gladlog:compare:done"),
    onError: sub<{ matchId: string; message: string }>("gladlog:compare:error"),
  },
  analysis: {
    run: (input) => ipcRenderer.invoke("gladlog:analysis:run", input),
    cancel: (matchId?: string) =>
      ipcRenderer.invoke("gladlog:analysis:cancel", matchId),
    getState: (matchId) =>
      ipcRenderer.invoke("gladlog:analysis:getState", matchId),
    getCached: (matchId, slotKey) =>
      ipcRenderer.invoke("gladlog:analysis:getCached", matchId, slotKey),
    getFlags: (matchId) =>
      ipcRenderer.invoke("gladlog:analysis:getFlags", matchId),
    aggregate: () => ipcRenderer.invoke("gladlog:analysis:aggregate"),
    listAnalyzed: () => ipcRenderer.invoke("gladlog:analysis:listAnalyzed"),
    notebook: () => ipcRenderer.invoke("gladlog:analysis:notebook"),
    deepen: (input) => ipcRenderer.invoke("gladlog:analysis:deepen", input),
    analyzeWindow: (input) =>
      ipcRenderer.invoke("gladlog:analysis:analyzeWindow", input),
    setFlag: (matchId, key, flag) =>
      ipcRenderer.invoke("gladlog:analysis:setFlag", matchId, key, flag),
    onDelta: sub<{ matchId: string; text: string }>("gladlog:analysis:delta"),
    onRetry: sub<{ matchId: string }>("gladlog:analysis:retry"),
    onDone: sub<{ matchId: string; result: unknown; slotKey?: string }>(
      "gladlog:analysis:done",
    ),
    onError: sub<{ matchId: string; message: string }>(
      "gladlog:analysis:error",
    ),
  },
  chat: {
    getState: (matchId) => ipcRenderer.invoke("gladlog:chat:getState", matchId),
    send: (input) => ipcRenderer.invoke("gladlog:chat:send", input),
    cancel: (matchId) => ipcRenderer.invoke("gladlog:chat:cancel", matchId),
  },
  learning: {
    getRules: () => ipcRenderer.invoke("gladlog:learning:getRules"),
    getState: () => ipcRenderer.invoke("gladlog:learning:getState"),
    consolidate: () => ipcRenderer.invoke("gladlog:learning:consolidate"),
    onProgress: sub<{ scanned: number; total: number }>(
      "gladlog:learning:progress",
    ),
    onDone: sub<{
      rules: number;
      distilled: number;
      dropped: number;
      distillError?: string;
    }>("gladlog:learning:done"),
    onError: sub<{ message: string }>("gladlog:learning:error"),
  },
  bugReport: {
    create: (input) => ipcRenderer.invoke("gladlog:bugreport:create", input),
  },
  recorder: {
    getStatus: () => ipcRenderer.invoke("gladlog:recorder:getStatus"),
    testConnection: (overrides) =>
      ipcRenderer.invoke("gladlog:recorder:testConnection", overrides),
    autoConfig: () => ipcRenderer.invoke("gladlog:recorder:autoConfig"),
    getForMatch: (matchId) =>
      ipcRenderer.invoke("gladlog:recorder:getForMatch", matchId),
    onStatus: sub("gladlog:recorder:status"),
    installObs: () => ipcRenderer.invoke("gladlog:recorder:installObs"),
    onInstallProgress: sub("gladlog:recorder:installProgress"),
    getObsInstallState: () =>
      ipcRenderer.invoke("gladlog:recorder:obsInstallState"),
    listAudioDevices: () =>
      ipcRenderer.invoke("gladlog:recorder:listAudioDevices"),
    importObsPrefs: () => ipcRenderer.invoke("gladlog:recorder:importObsPrefs"),
    selectRecordingDirectory: () =>
      ipcRenderer.invoke("gladlog:recorder:selectRecordingDirectory"),
  },
  icon: {
    get: (name) => ipcRenderer.invoke("gladlog:icon:get", name),
  },
  ui: {
    // Clamped here as well as in settingsStore, not out of superstition: this
    // is the last line before the value reaches Chromium, and it is also the
    // only guard on the "preview immediately" path, where the renderer applies
    // a factor it has not round-tripped through the main process yet. A 0 or
    // NaN factor blanks the window with no way back through the UI.
    setZoomFactor: (factor) => webFrame.setZoomFactor(clampUiZoom(factor)),
  },
  debug: {
    aiCalls: () => ipcRenderer.invoke("gladlog:debug:aiCalls"),
  },
  ai: {
    detectCli: (backend) => ipcRenderer.invoke("gladlog:ai:detectCli", backend),
  },
};
contextBridge.exposeInMainWorld("gladlog", api);
