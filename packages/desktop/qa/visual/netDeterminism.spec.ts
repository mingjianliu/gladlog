// 临时验证脚手架 —— 不入仓,验完即删。
// 断言:report-replay 的渲染像素不依赖外部网络可达性。
import { test } from "@playwright/test";
import fs from "node:fs";

import { FIXED_NOW } from "../../dev/fixtures/fixedNow";

const OUT = process.env["NETDET_OUT"]!;

for (const mode of ["online", "offline"] as const) {
  test(`netdet-${mode}`, async ({ page }) => {
    if (mode === "offline") {
      await page.route(
        (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
        (route) => route.abort(),
      );
    }
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    await page.goto(`/?scene=report-replay`);
    await page.waitForSelector("[data-scene-ready=report-replay]", {
      timeout: 15_000,
    });
    await page.waitForSelector("[data-testid=rpt-replay-field]", {
      state: "visible",
      timeout: 15_000,
    });
    // 给外部资源足够的落地时间,确保 online 档真的拿到了图
    await page.waitForTimeout(3000);
    const buf = await page.screenshot({
      fullPage: true,
      animations: "disabled",
    });
    fs.writeFileSync(`${OUT}/${mode}.png`, buf);
  });
}
