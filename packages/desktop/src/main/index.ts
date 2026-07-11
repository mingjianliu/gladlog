import { app, BrowserWindow } from "electron";
import { join } from "path";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env["ELECTRON_RENDERER_URL"])
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  return win;
}
app.whenReady().then(() => createWindow());
app.on("window-all-closed", () => app.quit());
