import { mkdtempSync, rmSync, writeFileSync } from "fs";
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

test("链路2:点 finding 深挖 chip → 回放跳到该时刻", async () => {
  const userData = mkdtempSync(join(tmpdir(), "gladlog-e2e-"));
  const logPath = join(userData, "WoWCombatLog-e2e.txt");
  writeFileSync(logPath, synthArenaLog(), "utf-8");

  // 第一程:导入,拿到 matchId
  const first = await launchApp(userData);
  await importLog(first.app, first.page, logPath);
  const matchId = firstMatchId(userData);
  await first.app.close();

  // 播种 canned findings(不打真 API),再启一程
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

  // finding 卡片在,且带「回放此刻」
  await expect(second.page.getByText("被集火秒杀")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  // 点深挖 chip(带显式时刻)→ 走 onJumpT 直接 seek
  await second.page
    .locator("[data-testid=finding-deepdive] .rpt-finding-evt")
    .first()
    .click();

  // 跳转结果:报表自己的 tab 切到「回放」(app 顶栏也用 rpt-view-tabs,
  // 必须用 rpt-head-tabs 收窄),场地渲染,且时间真的停在 chip 的 0:12
  await expect(
    second.page.locator(".rpt-head-tabs button.active"),
  ).toHaveText("回放");
  await expect(second.page.getByTestId("rpt-replay-field")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  await expect(second.page.locator(".rpt-replay-time")).toContainText("0:12");

  await second.app.close();

  // 临时 userData 里有合成日志与入库数据,跑完删掉,别在 /tmp 里堆积
  rmSync(userData, { recursive: true, force: true });
});
