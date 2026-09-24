import { BrowserWindow, dialog } from "electron";
import { writeFileSync } from "node:fs";

/**
 * C3 image export: an offscreen window loads **the same renderer** (hash
 * routing into the export page), waits for the page to report itself ready,
 * grows the window to the content height, and only then calls capturePage --
 * exported pixels == rendered pixels is guaranteed by construction (same
 * renderer, same derive, same data); there is no second drawing path.
 *
 * capturePage only covers the visible area, hence setContentSize to the full
 * document height first; the height is capped so an extremely long report
 * can't blow out the GPU texture.
 */

const EXPORT_WIDTH = 1280;
const MAX_HEIGHT = 20_000;
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 200;
/** Wait one more compositor frame after the size settles, so we don't capture
 * an intermediate layout state. */
const SETTLE_MS = 250;

interface ExportImageOptions {
  matchId: string;
  roundSeq?: number | null;
  range?: { fromS: number; toS: number } | null;
  /** An explicit save path (E2E / scripts); when omitted the system save
   * dialog is shown. */
  savePath?: string;
  parent: BrowserWindow | null;
  preloadPath: string;
  /** dev server URL (ELECTRON_RENDERER_URL); null -> the loadFile production path */
  rendererUrl: string | null;
  rendererFile: string;
}

export async function exportReportImage(
  opts: ExportImageOptions,
): Promise<{ path: string; width: number; height: number } | null> {
  // Ask for the save path first (if the user cancels there is nothing to
  // render); E2E passes it in directly and skips the dialog
  let savePath = opts.savePath ?? null;
  if (!savePath) {
    const dialogOpts = {
      title: "导出战报图片",
      defaultPath: `gladlog-${opts.matchId.slice(0, 8)}.png`,
      filters: [{ name: "PNG", extensions: ["png"] }],
    };
    const r = opts.parent
      ? await dialog.showSaveDialog(opts.parent, dialogOpts)
      : await dialog.showSaveDialog(dialogOpts);
    if (r.canceled || !r.filePath) return null;
    savePath = r.filePath;
  }

  const hash =
    `export-report=${encodeURIComponent(opts.matchId)}` +
    (opts.roundSeq != null ? `&round=${opts.roundSeq}` : "") +
    (opts.range ? `&from=${opts.range.fromS}&to=${opts.range.toS}` : "");

  // The initial height is deliberately smaller than any real report: only
  // when the content exceeds the viewport does scrollHeight give the true
  // full-document height, and it also lets E2E prove the capture went beyond
  // the initial viewport rather than grabbing just the first screen.
  const w = new BrowserWindow({
    show: false,
    width: EXPORT_WIDTH,
    height: 500,
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false,
    },
  });
  try {
    if (opts.rendererUrl) {
      await w.loadURL(`${opts.rendererUrl}#${hash}`);
    } else {
      await w.loadFile(opts.rendererFile, { hash });
    }

    // Wait for the export page to report itself ready (data loaded + fonts +
    // two rendered frames)
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      const ready = (await w.webContents.executeJavaScript(
        "window.__gladlogExportReady === true",
      )) as boolean;
      if (ready) break;
      if (Date.now() > deadline) throw new Error("export page never ready");
      await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }

    const contentHeight = Math.min(
      MAX_HEIGHT,
      (await w.webContents.executeJavaScript(
        "Math.ceil(document.documentElement.scrollHeight)",
      )) as number,
    );
    w.setContentSize(EXPORT_WIDTH, Math.max(400, contentHeight));
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const image = await w.webContents.capturePage();
    const png = image.toPNG();
    writeFileSync(savePath, png);
    const size = image.getSize();
    return { path: savePath, width: size.width, height: size.height };
  } finally {
    if (!w.isDestroyed()) w.destroy();
  }
}
