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

test("链路3:标记 finding → 战绩页聚合可见 → 重启后标记仍在", async () => {
  const userData = mkdtempSync(join(tmpdir(), "gladlog-e2e-"));
  const logPath = join(userData, "WoWCombatLog-e2e.txt");
  writeFileSync(logPath, synthArenaLog(), "utf-8");

  const first = await launchApp(userData);
  await importLog(first.app, first.page, logPath);
  const matchId = firstMatchId(userData);
  await first.app.close();

  seedAnalysis(userData, matchId, [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "目标选择",
      title: "爆发打进减伤",
      explanation: "E2E 播种的 finding,用于验证教练闭环。",
    },
  ]);

  // Second launch: mark the finding as "still doing it"
  const second = await launchApp(userData);
  await openAiView(second.page);
  await expect(second.page.getByText("爆发打进减伤")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  await second.page.getByRole("button", { name: "↻ 还在犯" }).first().click();
  // Persisting the mark is an asynchronous IPC — wait for the button to enter
  // its selected state before changing pages, or we may race ahead of the write
  await expect(
    second.page.locator(".rpt-finding-flags button.active"),
  ).toBeVisible();

  // Stats page: the mistake-notebook aggregate shows that category
  await second.page.getByRole("button", { name: "战绩" }).click();
  await expect(second.page.getByTestId("dash-notebook")).toContainText(
    "目标选择",
    { timeout: BOOT_TIMEOUT_MS },
  );
  await second.app.close();

  // Third launch: the mark survives a restart (persistence)
  const third = await launchApp(userData);
  await openAiView(third.page);
  await expect(
    third.page.locator(".rpt-finding-flags button.active"),
  ).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await third.app.close();

  // The temporary userData holds the synthetic log and the ingested data;
  // delete it when done so nothing piles up in /tmp
  rmSync(userData, { recursive: true, force: true });
});
