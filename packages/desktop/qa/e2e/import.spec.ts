import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { _electron as electron, expect, test } from "@playwright/test";

// 相对路径而非包名:@gladlog/parser 的 main 指向 src/index.ts,没有 exports
// 映射,Node 解析不到深层子路径(Playwright 跑在 Node ESM 下,不过 Vite)。
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

  // AI 分析:面板在。锚点必须是 AI 视图**独有**的 .rpt-ai-panel ——
  // .rpt-match 是三视图共用的报表根节点,点击前就已可见,拿它做断言
  // 等于什么都没测(点击没生效/视图没切/面板抛异常都照样绿)。
  await page.getByRole("button", { name: "AI 分析" }).click();
  await expect(page.locator(".rpt-head-tabs button.active")).toHaveText(
    "AI 分析",
  );
  await expect(page.locator(".rpt-ai-primary")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });

  await app.close();

  // 临时 userData 里有合成日志与入库数据,跑完删掉,别在 /tmp 里堆积
  rmSync(userData, { recursive: true, force: true });
});
