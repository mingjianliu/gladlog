import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Import from the dependency-free leaf modules, not from appShell — the latter
// would drag fixtureBridge's JSON imports into Playwright's Node process and
// fail outright with an import-attribute error.
import { FIXED_NOW } from "../../dev/fixtures/fixedNow";
import { SCENE_NAMES, type SceneName } from "../../dev/scenes";
import { isExempt } from "../axe-allowlist";
import { isolateExternalRequests } from "../support/stubExternal";

/** Per-scene "render complete" anchor: wait for it before screenshotting so we
 * never capture a half-rendered frame. */
// report-heavy is an oversized payload used solely for first-paint timing; it
// has no pixel baseline (see firstPaint.spec.ts)
const SNAPSHOT_SCENES = SCENE_NAMES.filter((s) => s !== "report-heavy");

const ANCHOR: Partial<Record<SceneName, string>> = {
  "report-battle": "[data-testid=rpt-timeline]",
  "report-replay": "[data-testid=rpt-replay-field]",
  // Use the deep-dive block rather than .rpt-match: the latter is the report
  // root shared by all three views and is satisfied the moment it mounts,
  // while the finding cards come from the asynchronous analysis.getState —
  // anchoring on the root would mean not waiting at all.
  "report-ai": "[data-testid=finding-deepdive]",
  "report-synth": "[data-testid=rpt-timeline]",
  // Anchor the selected state on the window chip: the chip appearing means the
  // window state has been applied and the aggregate panels recomputed for it
  "report-window": "[data-testid=time-range-chip]",
  "report-events": "[data-testid=events-panel]",
  // Shuffle header scene: the active round's report renders beneath the pills
  "report-shuffle": "[data-testid=rpt-timeline]",
  // Recording scene: the timeline card is the deterministic anchor rendered
  // from log data (the video surface itself is always black)
  video: "[data-testid=video-battle-timeline]",
  dashboard: "[data-testid=stats-dashboard]",
  settings: "[data-testid=settings-panel]",
  matchlist: "[data-testid=match-list]",
  // Dev workbench: anchor on the left column of the inspector's three panes —
  // it only mounts once matches.list() comes back; using dev-rail as the anchor
  // would mean not waiting at all (the rail is satisfied the moment it mounts)
  dev: "[data-testid=dev-match-list]",
};

/**
 * First-paint readiness timeout.
 *
 * Measured at ~2-3s per scene (after the 2026-07-19 switch of the big JSON to
 * JSON.parse; before that it was ~24s — see the comment in
 * electron.vite.config.ts for why). 15s leaves plenty of headroom for slow CI
 * runners without making a genuinely broken scene hang for a full minute
 * before failing.
 */
const BOOT_TIMEOUT_MS = 15_000;

for (const scene of SNAPSHOT_SCENES) {
  test(`场景 ${scene} 与基线一致`, async ({ page }) => {
    // External-network isolation must come before goto: baselines must not
    // depend on public-internet reachability (see stubExternal.ts)
    const leaked = await isolateExternalRequests(page);
    // Pin only Date.now()/new Date(); do not take over the timers — the app's
    // background backfill uses setTimeout, and fake timers would freeze it.
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    await page.goto(`/?scene=${scene}`);
    await expect(page.locator(`[data-scene-ready=${scene}]`)).toBeAttached({
      timeout: BOOT_TIMEOUT_MS,
    });
    await expect(page.locator(ANCHOR[scene]!)).toBeVisible({
      timeout: BOOT_TIMEOUT_MS,
    });
    // soft: on a screenshot mismatch, **keep going** and still run axe —
    // otherwise a visual regression masks an accessibility regression, one run
    // reports only half the problems, and a human has to run it twice to see
    // everything.
    // Multi-tier baselines (4K redesign): the default `visual` project carries
    // no suffix (old baseline names stay put), while visual-1440/visual-1920
    // append -1440/-1920 — all three tiers coexist in the same directory.
    const proj = test.info().project.name;
    const suffix = proj === "visual" ? "" : proj.replace("visual", "");
    await expect.soft(page).toHaveScreenshot(`${scene}${suffix}.png`, {
      fullPage: true,
    });

    // Accessibility: the standard is WCAG 2.1 A+AA, and the set of violations
    // must be ⊆ the explicit exemption list. All four tags are required: axe
    // attaches the rules new in 2.1 (autocomplete-valid, avoid-inline-spacing,
    // css-orientation-lock, label-content-name-mismatch) only to the wcag21*
    // tags, so dropping them means "claiming 2.1 while actually running 2.0".
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

    // Leak ledger: a baseline that drifts with public-internet reachability is
    // a hidden flaky red, and must be blocked the moment it is introduced.
    // Either make the resource local, or give it a fixed stub in
    // stubExternal.ts.
    expect(
      leaked,
      `场景 ${scene} 请求了未打桩的外部资源 —— 基线会随网络抖动;见 qa/support/stubExternal.ts`,
    ).toEqual([]);
  });
}

/**
 * 录像页高度预算的门规(2026-08-03)。
 *
 * 这一页整页高度只有一个来源:`.rpt-video-tab-row` 的
 * `height: calc(100vh - 220px)`。它有两种静默失效方式,**两种都真发生过**,
 * 而且都不是"看起来丑"而是"东西看不见了":
 *
 *  1. 右侧「全部时刻」清单的内容高参与行的固有高度计算 → 行长出视口。
 *     1280x800 实测 row 580→827、战斗时间轴卡底边 836 > 视口 800,录像页从
 *     「一屏装下、清单内部滚」退化成「整页滚」。
 *  2. >=1440px 走 grid 分支时行轨是 auto,容器的 height 管不住它 → 侧卡长出
 *     行轨。1440x900 实测侧卡 827 > 行预算 680,**只有这一档暴露**(1280 走
 *     flex 分支,1920/2560 内容本来装得下)。
 *
 * 为什么不靠截图基线拦:基线每次 UI 改版都要重生成,"整页多了一条滚动条"
 * 这种变化在人审一张全页图时极容易被当成"内容变多了"放过 —— 2 号那一处正是
 * 我自己改完在三档里漏测出来的。这里改用语义断言,三档视口都跑
 * (标题含 "video " 命中 playwright.config 的 grep)。
 */
test(`场景 video 布局不溢出视口(高度预算门规)`, async ({ page }) => {
  await page.goto(`/?scene=video`);
  await expect(page.locator(`[data-scene-ready=video]`)).toBeAttached({
    timeout: BOOT_TIMEOUT_MS,
  });
  await expect(page.locator(ANCHOR.video!)).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  await expect(page.locator("[data-testid=video-moment-list]")).toBeVisible();

  const m = await page.evaluate(() => {
    const box = (s: string) => {
      const el = document.querySelector(s);
      return el ? el.getBoundingClientRect() : null;
    };
    const row = box(".rpt-video-tab-row")!;
    const side = box(".rpt-video-side")!;
    const list = box(".rpt-video-moments")!;
    const bt = box(".rpt-video-bt")!;
    return {
      vh: window.innerHeight,
      pageScrollH: document.documentElement.scrollHeight,
      rowH: Math.round(row.height),
      sideH: Math.round(side.height),
      // 侧卡底部到清单底部的空白:清单没吃满高度时这个数会变大
      wasteBelowList: Math.round(side.bottom - list.bottom),
      btBottom: Math.round(bt.bottom),
    };
  });

  // ① 整页不滚动 —— 录像页的设计前提就是"一屏装下,超出的部分各自内部滚"
  expect(
    m.pageScrollH,
    `录像页整页出现滚动(scrollHeight ${m.pageScrollH} > 视口 ${m.vh})—— 多半是某个子项的内容高参与了行高计算`,
  ).toBeLessThanOrEqual(m.vh + 1);

  // ② 侧卡不得长出行轨(grid 隐式行是 auto 的那个坑)
  expect(
    m.sideH,
    `右侧卡(${m.sideH}px)长出了行预算(${m.rowH}px)—— >=1440px 的 grid 分支需要 grid-template-rows: minmax(0, 1fr)`,
  ).toBeLessThanOrEqual(m.rowH + 1);

  // ③ 战斗时间轴卡必须仍在视口内(它是主 seek 面,被顶出去等于功能没了)
  expect(
    m.btBottom,
    `战斗时间轴卡底边 ${m.btBottom} 超出视口 ${m.vh}`,
  ).toBeLessThanOrEqual(m.vh);

  // ④ 「全部时刻」清单要吃满侧卡剩余高度(只剩卡自身内边距的余量)。
  //    这条挡的是 max-height 硬帽回潮:2560x1440 曾经空 653px。
  expect(
    m.wasteBelowList,
    `清单下方空了 ${m.wasteBelowList}px —— 清单没吃满侧卡高度(检查 .rpt-video-moments 的 flex/max-height)`,
  ).toBeLessThanOrEqual(24);
});
