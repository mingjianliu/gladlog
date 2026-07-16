import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron";
import {
  redactSettings,
  sanitizeSettingsPatch,
  type GladlogSettings,
  type SettingsStore,
} from "./settingsStore";
import type { MatchStore } from "./matchStore";
import type { LogsStatusSnapshot } from "../preload/api";
import type { CompareService } from "./compare";
import type { AnalysisService } from "./analysis";

export function registerIpc(deps: {
  store: MatchStore;
  settings: SettingsStore;
  getStatus: () => LogsStatusSnapshot | null;
  getWindow: () => BrowserWindow | null;
  onWowDirectoryChanged: (settings: GladlogSettings) => void;
  compare: CompareService;
  analysis: AnalysisService;
  icons: { get(name: string): Promise<string | null> };
}): void {
  ipcMain.handle("gladlog:logs:getStatus", () => deps.getStatus());
  ipcMain.handle("gladlog:icon:get", (_e, name: string) =>
    deps.icons.get(String(name)),
  );
  ipcMain.handle("gladlog:matches:list", () => deps.store.list());
  ipcMain.handle("gladlog:matches:get", (_e, id: string) => deps.store.get(id));
  ipcMain.handle(
    "gladlog:matches:page",
    (_e, opts: { before?: number; limit: number }) => deps.store.page(opts),
  );
  ipcMain.handle("gladlog:matches:rebuildIndex", () =>
    deps.store.rebuildIndex(),
  );
  ipcMain.handle("gladlog:settings:get", () =>
    redactSettings(deps.settings.get()),
  );
  ipcMain.handle(
    "gladlog:settings:save",
    (_e, rawPartial: Partial<GladlogSettings>) => {
      const partial = sanitizeSettingsPatch(rawPartial);
      const next = deps.settings.save(partial);
      if ("wowDirectory" in partial) deps.onWowDirectoryChanged(next);
      return redactSettings(next);
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
  ipcMain.handle("gladlog:compare:run", (_e, input) => deps.compare.run(input));
  ipcMain.handle("gladlog:compare:cancel", () => deps.compare.cancel());
  ipcMain.handle("gladlog:compare:getCached", (_e, matchId: string) =>
    deps.compare.getCached(matchId),
  );
  ipcMain.handle("gladlog:analysis:run", (_e, input) =>
    deps.analysis.run(input),
  );
  ipcMain.handle("gladlog:analysis:cancel", () => deps.analysis.cancel());
  ipcMain.handle("gladlog:analysis:getCached", (_e, matchId: string) =>
    deps.analysis.getCached(matchId),
  );
}
