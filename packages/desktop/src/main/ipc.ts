import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron";
import type { GladlogSettings, SettingsStore } from "./settingsStore";
import type { MatchStore } from "./matchStore";
import type { LogsStatusSnapshot } from "../preload/api";

export function registerIpc(deps: {
  store: MatchStore;
  settings: SettingsStore;
  getStatus: () => LogsStatusSnapshot | null;
  getWindow: () => BrowserWindow | null;
  onWowDirectoryChanged: (settings: GladlogSettings) => void;
}): void {
  ipcMain.handle("gladlog:logs:getStatus", () => deps.getStatus());
  ipcMain.handle("gladlog:matches:list", () => deps.store.list());
  ipcMain.handle("gladlog:matches:get", (_e, id: string) => deps.store.get(id));
  ipcMain.handle("gladlog:settings:get", () => deps.settings.get());
  ipcMain.handle(
    "gladlog:settings:save",
    (_e, partial: Partial<GladlogSettings>) => {
      const next = deps.settings.save(partial);
      if ("wowDirectory" in partial) deps.onWowDirectoryChanged(next);
      return next;
    },
  );
  ipcMain.handle("gladlog:app:getVersion", () => app.getVersion());
  ipcMain.handle("gladlog:app:selectDirectory", async () => {
    const win = deps.getWindow();
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    const dirPath = r.filePaths[0]!;
    deps.onWowDirectoryChanged(deps.settings.save({ wowDirectory: dirPath }));
    return dirPath;
  });
  ipcMain.handle("gladlog:app:openExternal", (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
    return undefined;
  });
}
