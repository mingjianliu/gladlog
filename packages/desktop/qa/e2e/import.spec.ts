import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// A relative path rather than the package name: @gladlog/parser's main points at
// src/index.ts and there is no exports map, so Node cannot resolve deep
// subpaths (Playwright runs under Node ESM, not through Vite).
import { synthArenaLog } from "../../../parser/src/testing/synthLog";
import { BOOT_TIMEOUT_MS, MAIN_ENTRY, matchRows } from "../support/launch";

test("链路1:导入日志 → 比赛列表 → 三视图都有内容", async () => {
  const userData = mkdtempSync(join(tmpdir(), "gladlog-e2e-"));
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

  // The native file dialog cannot be automated — swap it out in the main process
  // so it returns the log we synthesized
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, logPath);

  await page.getByRole("button", { name: "导入历史日志…" }).click();

  // Once stored, it reaches the list through the matchStored event
  const rows = matchRows(page);
  await expect(rows.first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await rows.first().click();

  // Report: the HP curve is present
  await expect(page.getByTestId("rpt-timeline")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });

  // Replay: the arena field is present (the synthetic log carries position data)
  await page.getByRole("button", { name: "回放", exact: true }).click();
  await expect(page.getByTestId("rpt-replay-field")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });

  // AI analysis: the panel is present. The anchor must be .rpt-ai-panel, which is
  // **unique** to the AI view — .rpt-match is the report root shared by all three
  // views and is already visible before the click, so asserting on it tests
  // nothing (a click that did nothing, a view that never switched, or a panel
  // that threw would all still be green).
  await page.getByRole("button", { name: "AI 分析", exact: true }).click();
  await expect(page.locator(".rpt-head-tabs button.active")).toHaveText(
    "AI 分析",
  );
  await expect(page.locator(".rpt-ai-primary")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });

  await app.close();

  // The temp userData holds the synthetic log and the stored data; delete it
  // after the run so nothing piles up in /tmp
  rmSync(userData, { recursive: true, force: true });
});
