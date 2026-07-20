import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { _electron as electron, expect, test } from "@playwright/test";

import { BUDGET_MS, reportBudget } from "../budgets";
import { BOOT_TIMEOUT_MS, MAIN_ENTRY } from "../support/launch";

/**
 * 冷启动预算:从 `launch()` 到首屏可交互。
 *
 * 单独成文件而不是搭在链路1 上 —— 链路1 是功能测试,失败原因该是「链路断了」;
 * 预算失败原因是「变慢了」。混在一起时,一个红灯有两种含义,读的人得点进去
 * 才知道是哪种。
 *
 * 取 3 次的中位数:单次采样在共享 runner 上太容易被邻居干扰而假红。
 */
test("应用冷启动在预算内(未锁定时只测量)", async () => {
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const userData = mkdtempSync(join(tmpdir(), "gladlog-e2e-cold-"));
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
    await expect(page.getByTestId("onboard")).toBeVisible({
      timeout: BOOT_TIMEOUT_MS,
    });
    samples.push(Date.now() - t0);
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }

  const median = samples.sort((a, b) => a - b)[1]!;
  reportBudget("coldStart", median, samples.length);
  if (BUDGET_MS.coldStart !== null) {
    expect(median).toBeLessThan(BUDGET_MS.coldStart);
  }
});
