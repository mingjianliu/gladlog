import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { isExempt } from "../axe-allowlist";

// 从零 import 的叶子模块取,别从 appShell 取 —— 后者会把 fixtureBridge 的
// JSON 导入拖进 Playwright 的 Node 进程,直接报 import-attribute 错。
import { FIXED_NOW } from "../../dev/fixtures/fixedNow";
import { SCENE_NAMES, type SceneName } from "../../dev/scenes";

/** 每个场景的「渲染完成」锚点:等它出现再截图,避免拍到半渲染帧。 */
// report-heavy 是首渲计时专用的大号载荷,不做像素基线(见 firstPaint.spec.ts)
const SNAPSHOT_SCENES = SCENE_NAMES.filter((s) => s !== "report-heavy");

const ANCHOR: Partial<Record<SceneName, string>> = {
  "report-battle": "[data-testid=rpt-timeline]",
  "report-replay": "[data-testid=rpt-replay-field]",
  "report-ai": ".rpt-match",
  "report-synth": "[data-testid=rpt-timeline]",
  dashboard: "[data-testid=stats-dashboard]",
  settings: "[data-testid=settings-panel]",
  matchlist: "[data-testid=match-list]",
};

/**
 * 首屏就绪超时。
 *
 * 报表页首次渲染要 ~25s —— 不是打包或网络的锅:`spellEffectData.ts` 顶层
 * `await import("./spellNames.json")`(12MB)会阻塞整个模块图求值,任何
 * import 它的模块都得等这 12MB 下完并解析。实测 dev(22.4s 卡在
 * spellNames.json)与 build+preview(~23s 卡在 spellNames chunk)一致。
 *
 * 每开一个新页面都要重付这笔钱,摊销不掉,所以这里给足超时。真把
 * spellNames 改成惰性加载后,这个常量应当跟着降下来 —— 别忘了改。
 */
const BOOT_TIMEOUT_MS = 60_000;

for (const scene of SNAPSHOT_SCENES) {
  test(`场景 ${scene} 与基线一致`, async ({ page }) => {
    // 只钉死 Date.now()/new Date(),不接管定时器 —— App 的后台补载用 setTimeout,
    // 假定时器会把它冻住。
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    await page.goto(`/?scene=${scene}`);
    await expect(page.locator(`[data-scene-ready=${scene}]`)).toBeAttached({
      timeout: BOOT_TIMEOUT_MS,
    });
    await expect(page.locator(ANCHOR[scene]!)).toBeVisible({
      timeout: BOOT_TIMEOUT_MS,
    });
    await expect(page).toHaveScreenshot(`${scene}.png`, { fullPage: true });

    // 无障碍:标准是 WCAG 2.1 A+AA,违规集合必须 ⊆ 显式豁免清单
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const unexpected = axe.violations.flatMap((v) =>
      v.nodes
        .map((n) => ({ rule: v.id, target: n.target.join(" ") }))
        .filter((x) => !isExempt(x.rule, x.target)),
    );
    expect(
      unexpected,
      `场景 ${scene} 出现未豁免的无障碍违规;修掉它,或写进 qa/axe-allowlist.ts 并说明理由`,
    ).toEqual([]);
  });
}
