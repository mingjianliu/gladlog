import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { expect, test } from "@playwright/test";

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

  // 第二程:标记「还在犯」
  const second = await launchApp(userData);
  await openAiView(second.page);
  await expect(second.page.getByText("爆发打进减伤")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  await second.page.getByRole("button", { name: "↻ 还在犯" }).first().click();
  // 标记落盘是异步 IPC —— 等到按钮进入选中态再切页,否则可能抢在写盘前
  await expect(
    second.page.locator(".rpt-finding-flags button.active"),
  ).toBeVisible();

  // 战绩页:错题本聚合出现该分类
  await second.page.getByRole("button", { name: "战绩" }).click();
  await expect(second.page.getByTestId("dash-notebook")).toContainText(
    "目标选择",
    { timeout: BOOT_TIMEOUT_MS },
  );
  await second.app.close();

  // 第三程:重启后标记仍在(持久化)
  const third = await launchApp(userData);
  await openAiView(third.page);
  await expect(
    third.page.locator(".rpt-finding-flags button.active"),
  ).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
  await third.app.close();
});
