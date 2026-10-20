import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { synthArenaLog } from "../../../parser/src/testing/synthLog";
import {
  BOOT_TIMEOUT_MS,
  firstMatchId,
  importLog,
  launchApp,
  openAiView,
} from "../support/launch";
import { seedAnalysis } from "../support/seedAnalysis";

test("链路2:点 finding 深挖 chip → 回放跳到该时刻", async () => {
  const userData = mkdtempSync(join(tmpdir(), "gladlog-e2e-"));
  const logPath = join(userData, "WoWCombatLog-e2e.txt");
  writeFileSync(logPath, synthArenaLog(), "utf-8");

  // First run: import and obtain the matchId
  const first = await launchApp(userData);
  await importLog(first.app, first.page, logPath);
  const matchId = firstMatchId(userData);
  await first.app.close();

  // Seed canned findings (no real API calls), then start a second run
  seedAnalysis(userData, matchId, [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      title: "被集火秒杀",
      explanation: "E2E 播种的 finding,用于验证证据链跳转。",
      deepDive: {
        text: "播种的深挖正文。",
        chips: [{ t: 12, label: "关键时刻", unitNames: [] }],
      },
    },
  ]);

  const second = await launchApp(userData);
  await openAiView(second.page);

  // The finding card is present and carries "replay this moment"
  await expect(second.page.getByText("被集火秒杀")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  // Click a deep-dive chip (which carries an explicit time) -> seeks directly
  // via onJumpT
  await second.page
    .locator("[data-testid=finding-deepdive] .rpt-finding-evt")
    .first()
    .click();

  // Jump result: the report's own tab switches to replay (the app's top bar
  // also uses rpt-view-tabs, so the selector must be narrowed to
  // rpt-head-tabs), the field renders, and the clock really sits at the chip's
  // 0:12
  await expect(second.page.locator(".rpt-head-tabs button.active")).toHaveText(
    "回放",
  );
  await expect(second.page.getByTestId("rpt-replay-field")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  await expect(second.page.locator(".rpt-replay-time")).toContainText("0:12");

  await second.app.close();

  // The temp userData holds the synthetic log and stored data; delete it after
  // the run so it does not pile up in /tmp
  rmSync(userData, { recursive: true, force: true });
});
