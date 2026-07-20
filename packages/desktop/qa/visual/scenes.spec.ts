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
 * 场景实测 ~2-3s(2026-07-19 把大 JSON 改成 JSON.parse 之后;在那之前是
 * ~24s,成因见 electron.vite.config.ts 的注释)。15s 留了足够余量应付 CI
 * 的慢 runner,又不至于让真坏掉的场景卡满一分钟才报错。
 */
const BOOT_TIMEOUT_MS = 15_000;

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
    // soft:截图不一致时**继续**跑 axe,否则视觉回归会遮蔽无障碍回归
    // ——一次运行只报一半问题,人还要来回跑两轮才看全。
    await expect.soft(page).toHaveScreenshot(`${scene}.png`, {
      fullPage: true,
    });

    // 无障碍:标准是 WCAG 2.1 A+AA,违规集合必须 ⊆ 显式豁免清单。
    // 四个标签一个都不能少:axe 把 2.1 新增的规则(autocomplete-valid、
    // avoid-inline-spacing、css-orientation-lock、label-content-name-mismatch)
    // 只挂 wcag21* 标签,漏掉它们就是「声称 2.1、实跑 2.0」。
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
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
