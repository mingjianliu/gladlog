import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { _electron as electron, expect, test } from "@playwright/test";

// 相对路径而非包名:@gladlog/parser 的 main 指向 src/index.ts,没有 exports
// 映射,Node 解析不到深层子路径(Playwright 跑在 Node ESM 下,不过 Vite)。
import { synthArenaLog } from "../../../parser/src/testing/synthLog";

import { BUDGET_MS, reportBudget } from "../budgets";
import { BOOT_TIMEOUT_MS, MAIN_ENTRY, matchRows } from "../support/launch";

test("链路1:导入日志 → 比赛列表 → 三视图都有内容", async () => {
  const userData = mkdtempSync(join(tmpdir(), "gladlog-e2e-"));
  const logPath = join(userData, "WoWCombatLog-e2e.txt");
  writeFileSync(logPath, synthArenaLog(), "utf-8");

  const t0 = Date.now();
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      GLADLOG_E2E: "1",
      GLADLOG_E2E_USER_DATA: userData,
    },
  });
  const page = await app.firstWindow();

  // 冷启动:从 launch 到首屏可交互(空态引导可见)
  await expect(page.getByTestId("onboard")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  const coldStart = Date.now() - t0;
  reportBudget("coldStart", coldStart, 1);
  if (BUDGET_MS.coldStart !== null) {
    expect(coldStart).toBeLessThan(BUDGET_MS.coldStart);
  }

  // 原生文件对话框无法自动化 —— 在主进程里换掉它,返回我们造的日志
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, logPath);

  await page.getByRole("button", { name: "导入历史日志…" }).click();

  // 入库后经 matchStored 事件进列表
  const rows = matchRows(page);
  await expect(rows.first()).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await rows.first().click();

  // 战报:生命曲线在
  await expect(page.getByTestId("rpt-timeline")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });

  // 回放:场地在(合成日志带位置数据)
  await page.getByRole("button", { name: "回放" }).click();
  await expect(page.getByTestId("rpt-replay-field")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });

  // AI 分析:面板在(未配 key 时是空闲态按钮,只断言面板存在)
  await page.getByRole("button", { name: "AI 分析" }).click();
  await expect(page.locator(".rpt-match")).toBeVisible();

  await app.close();
});
