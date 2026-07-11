import { app, BrowserWindow } from "electron";
import log from "electron-log/main";
import { join } from "path";
import type { WorkerConfig, WorkerToMain } from "../shared/protocol";
import type { LogsStatusSnapshot } from "../preload/api";
import {
  detectWowDirCandidates,
  realFsProbe,
  resolveLogsDir,
} from "./detectWowDir";
import { registerIpc } from "./ipc";
import { MatchStore } from "./matchStore";
import { SettingsStore, type GladlogSettings } from "./settingsStore";
import { WorkerHost } from "./workerHost";
import { createAiService, realClientFactory } from "./ai";
import { createIconCache } from "./iconCache";

app.setName("gladlog");
log.initialize();
process.on("uncaughtException", (e) => log.error("[main] uncaught:", e));
process.on("unhandledRejection", (e) =>
  log.error("[main] unhandled rejection:", e),
);

let win: BrowserWindow | null = null;
let lastStatus: LogsStatusSnapshot | null = null;
let quarantined: string[] = [];

const userData = () => app.getPath("userData");
const settings = new SettingsStore(
  join(app.getPath("userData"), "settings.json"),
);
let store: MatchStore;
let host: WorkerHost | null = null;

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.env["ELECTRON_RENDERER_URL"])
    w.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  else w.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  return w;
}

function workerConfig(wowDirectory: string): WorkerConfig {
  return {
    logsDir: resolveLogsDir(wowDirectory),
    checkpointsPath: join(userData(), "checkpoints.json"),
    quarantined,
    flushIntervalMs: 2000,
    quietPeriodMs: 5000,
  };
}

function onWorkerMessage(msg: WorkerToMain): void {
  if (msg.type === "match" || msg.type === "shuffle") {
    const r = store.store(msg.payload);
    if (r.stored && r.meta)
      win?.webContents.send("gladlog:logs:matchStored", r.meta);
  } else if (msg.type === "status") {
    lastStatus = {
      watching: msg.watching,
      logsDir: msg.logsDir,
      files: msg.files,
    };
    win?.webContents.send("gladlog:logs:statusChanged", lastStatus);
  } else if (msg.type === "diagnostic") {
    const entry = {
      fileKey: msg.fileKey,
      code: msg.code,
      detail: msg.detail,
      at: Date.now(),
    };
    log.warn("[worker diagnostic]", JSON.stringify(entry));
    win?.webContents.send("gladlog:logs:diagnostic", entry);
  }
}

function startMonitoring(s: GladlogSettings): void {
  let dir = s.wowDirectory;
  if (!dir) {
    dir =
      detectWowDirCandidates({
        platform: process.platform,
        probe: realFsProbe(),
      })[0] ?? null;
    if (dir) settings.save({ wowDirectory: dir });
  }
  if (!dir) return; // 等用户手选
  const config = workerConfig(dir);
  if (host) host.reconfigure(config);
  else {
    host = new WorkerHost({
      workerModulePath: join(import.meta.dirname, "worker.js"),
      onMessage: onWorkerMessage,
      onQuarantine: (fileKey) => {
        quarantined.push(fileKey);
        log.error(`quarantined ${fileKey}`);
      },
      log: { info: (m) => log.info(m), error: (m) => log.error(m) },
    });
    host.start(config);
  }
}

const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.whenReady().then(() => {
    store = new MatchStore(join(userData(), "matches"));
    store.init();
    win = createWindow();
    const ai = createAiService({
      getSettings: () => settings.get(),
      matchesDir: join(userData(), "matches"),
      clientFactory: realClientFactory,
      emit: (ch, payload) => win?.webContents.send(ch, payload),
    });
    const icons = createIconCache({ cacheDir: join(app.getPath("userData"), "icons") });
    registerIpc({
      store,
      settings,
      getStatus: () => lastStatus,
      getWindow: () => win,
      onWowDirectoryChanged: (s) => startMonitoring(s),
      ai,
      icons,
    });
    startMonitoring(settings.get());
  });
  app.on("window-all-closed", () => {
    host?.stop();
    app.quit();
  });
}
