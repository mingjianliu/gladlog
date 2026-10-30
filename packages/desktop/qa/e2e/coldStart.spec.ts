import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { BUDGET_MS, reportBudget } from "../budgets";
import { BOOT_TIMEOUT_MS, MAIN_ENTRY } from "../support/launch";

/**
 * Cold start budget: from `launch()` until the first screen is interactive.
 *
 * A separate file rather than piggybacking on flow 1 -- flow 1 is a
 * functional test whose failure should mean "the flow is broken", whereas a
 * budget failure means "it got slower". Mixed together, a single red light
 * has two meanings and the reader has to click in to find out which.
 *
 * Takes the median of 3 runs: a single sample on a shared runner is far too
 * easily disturbed by neighbours into a false red.
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
