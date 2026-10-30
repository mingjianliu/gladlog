import { _electron as electron, expect, test } from "@playwright/test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// A relative path rather than the package name: @gladlog/parser's main points
// at src/index.ts and there is no exports map, so Node cannot resolve deep
// subpaths (Playwright runs under Node ESM, not through Vite).
import { synthArenaLog } from "../../../parser/src/testing/synthLog";
import { BOOT_TIMEOUT_MS, MAIN_ENTRY, matchRows } from "../support/launch";

/**
 * C3 export fidelity (image path): export renders **the same renderer** in an
 * offscreen window, so pixel identity is guaranteed by construction; what this
 * E2E pins is the PIPELINE — a real PNG lands on disk, its width equals the
 * export width and its height equals the full document height (not a truncated
 * viewport).
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

  // Grab the stored match id and go straight through the bridge (the save
  // dialog is skipped: savePath is passed directly)
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

  // PNG magic number + IHDR dimensions (verified at the byte level; the
  // return value's self-report is not trusted)
  const buf = readFileSync(outPath);
  expect(buf.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const pxWidth = buf.readUInt32BE(16);
  const pxHeight = buf.readUInt32BE(20);
  // Physical pixels = logical width × scaleFactor (usually 1 on CI linux)
  expect(pxWidth).toBeGreaterThanOrEqual(1280);
  // The offscreen window starts 500 tall (exportImage.ts keeps it small on
  // purpose): >600 proves the capture went beyond the initial viewport (the
  // whole page, not just the first screen). A synthetic-log report measures
  // ~873px; a real match is taller.
  expect(pxHeight).toBeGreaterThan(600);
  expect(result!.width).toBeGreaterThanOrEqual(1280);
  // The return value is self-consistent with the PNG bytes
  expect(result!.height).toBe(pxHeight);

  await app.close();
  rmSync(userData, { recursive: true, force: true });
});
