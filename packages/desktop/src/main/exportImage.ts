import { BrowserWindow, dialog } from "electron";
import { writeFileSync } from "node:fs";

/**
 * C3 导出图片:离屏窗口加载**同一个 renderer**(hash 路由进导出页),
 * 等页面自报就绪后按内容高度撑满窗口再 capturePage —— 导出像素 == 渲染
 * 像素是构造保证(同 renderer、同 derive、同数据),不存在第二条绘制路径。
 *
 * capturePage 只保证可见区域,所以先 setContentSize 到全文高度;高度设
 * 上限防极端长报告把 GPU 纹理撑爆。
 */

const EXPORT_WIDTH = 1280;
const MAX_HEIGHT = 20_000;
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 200;
/** 尺寸落定后再等一帧合成器,避免截到布局中间态。 */
const SETTLE_MS = 250;

export interface ExportImageOptions {
  matchId: string;
  roundSeq?: number | null;
  range?: { fromS: number; toS: number } | null;
  /** 明确给出保存路径(E2E/脚本);省略时弹系统保存框。 */
  savePath?: string;
  parent: BrowserWindow | null;
  preloadPath: string;
  /** dev server URL(ELECTRON_RENDERER_URL);null → loadFile 生产路径 */
  rendererUrl: string | null;
  rendererFile: string;
}

export async function exportReportImage(
  opts: ExportImageOptions,
): Promise<{ path: string; width: number; height: number } | null> {
  // 保存路径先问(用户取消就不必渲染);E2E 直传跳过对话框
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

  // 初始高度故意小于任何真实战报:内容高于视口时 scrollHeight 才是真实
  // 全文高度,也让 E2E 能证明「捕获超出了初始视口」而非截了首屏。
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

    // 等导出页自报就绪(数据加载 + 字体 + 两帧渲染)
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
