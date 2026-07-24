import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { _electron as electron, expect, test } from "@playwright/test";

// 相对路径而非包名:@gladlog/parser 的 main 指向 src/index.ts,没有 exports
// 映射,Node 解析不到深层子路径(Playwright 跑在 Node ESM 下,不过 Vite)。
import { synthArenaLog } from "../../../parser/src/testing/synthLog";

import { BOOT_TIMEOUT_MS, MAIN_ENTRY, matchRows } from "../support/launch";

/**
 * C3 导出保真(图片路径):导出走离屏窗口渲染**同一个 renderer**,
 * 像素同源是构造保证;这条 E2E 锁的是管线本身 —— 真产出 PNG、
 * 宽度 = 导出宽度、高度 = 全文高度(不是被截断的视口)。
 */
test("链路4:导出图片 → 整页 PNG 落盘且尺寸为全文高度", async () => {
  const userData = mkdtempSync(join(tmpdir(), "gladlog-e2e-img-"));
  const logPath = join(userData, "WoWCombatLog-e2e.txt");
  writeFileSync(logPath, synthArenaLog(), "utf-8");

  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      GLADLOG_E2E: "1",
      GLADLOG_E2E_USER_DATA: userData,
    },
  });
  const page = await app.firstWindow();
  await expect(page.getByTestId("onboard")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, logPath);
  await page.getByRole("button", { name: "导入历史日志…" }).click();
  const rows = matchRows(page);
  await expect(rows.first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await rows.first().click();
  await expect(page.getByTestId("rpt-timeline")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });

  // 拿到入库 id,直接走 bridge(保存框跳过:savePath 直传)
  const outPath = join(userData, "export.png");
  const result = (await page.evaluate(async (savePath) => {
    const metas = await window.gladlog.matches.list();
    return window.gladlog.matches.exportImage({
      matchId: metas[0]!.id,
      savePath,
    });
  }, outPath)) as { path: string; width: number; height: number } | null;

  expect(result).not.toBeNull();
  expect(result!.path).toBe(outPath);
  expect(existsSync(outPath)).toBe(true);

  // PNG 魔数 + IHDR 尺寸(字节层验证,不信任返回值自报)
  const buf = readFileSync(outPath);
  expect(buf.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const pxWidth = buf.readUInt32BE(16);
  const pxHeight = buf.readUInt32BE(20);
  // 物理像素 = 逻辑宽 × scaleFactor(CI linux 一般 1)
  expect(pxWidth).toBeGreaterThanOrEqual(1280);
  // 全文高度:战报页(曲线+榜单+失误+打断/驱散+uptime)远超一个视口
  expect(pxHeight).toBeGreaterThan(1000);
  expect(result!.width).toBeGreaterThanOrEqual(1280);

  await app.close();
  rmSync(userData, { recursive: true, force: true });
});
