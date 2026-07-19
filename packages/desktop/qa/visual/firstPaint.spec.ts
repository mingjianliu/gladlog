import { expect, test } from "@playwright/test";

import { FIXED_NOW } from "../../dev/fixtures/fixedNow";
import { BUDGET_MS, reportBudget } from "../budgets";

/** 大号载荷的首渲天然比普通场景慢,用例总预算要压得住三次采样。 */
test.setTimeout(300_000);

test("大号对局的报表首渲在预算内(未锁定时只测量)", async ({ page }) => {
  await page.clock.setFixedTime(new Date(FIXED_NOW));

  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    // i 只为绕开可能的缓存,让每次都是真的重新加载
    await page.goto(`/?scene=report-heavy&i=${i}`);
    await expect(page.getByTestId("rpt-timeline")).toBeVisible({
      timeout: 90_000,
    });
    samples.push(Date.now() - t0);
  }
  const median = samples.sort((a, b) => a - b)[1]!;
  reportBudget("firstPaint", median, samples.length);
  if (BUDGET_MS.firstPaint !== null) {
    expect(median).toBeLessThan(BUDGET_MS.firstPaint);
  }
});
