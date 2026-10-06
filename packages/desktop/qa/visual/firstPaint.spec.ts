import { expect, test } from "@playwright/test";

import { FIXED_NOW } from "../../dev/fixtures/fixedNow";
import { BUDGET_MS, reportBudget, reportBudgetRatio } from "../budgets";
import { isolateExternalRequests } from "../support/stubExternal";

/** First paint on the oversized payload is naturally slower than an ordinary
 * scene, so the test's overall timeout must accommodate every sample (now
 * SAMPLES heavy + SAMPLES control reloads). */
test.setTimeout(180_000);

/** How many reloads to time, per scene. Five rather than three so the
 * statistic below has something to pick a floor from. */
const SAMPLES = 5;

/** The scene under budget: the real fixture scaled ×12 (dev/fixtures/appShell
 * heavyMatch). */
const HEAVY = "report-heavy";
/** Same-run control (2026-10-06, see budgets.ts firstPaintRatio): the same
 * real fixture at 1×, through the same report view, waited on the same
 * anchor — everything identical except the amount of data. */
const CONTROL = "report-battle";
/** The "first meaningful element" both scenes are timed to. */
const ANCHOR_TESTID = "rpt-timeline";

test("大号对局的报表首渲在预算内(未锁定时只测量)", async ({ page }) => {
  // Isolate the network here too: the first-paint budget measures our code and
  // must not include public-internet RTT
  await isolateExternalRequests(page);
  await page.clock.setFixedTime(new Date(FIXED_NOW));

  const timeFirstPaint = async (scene: string, i: number): Promise<number> => {
    const t0 = Date.now();
    // i exists only to bypass any caching, so each iteration really reloads
    await page.goto(`/?scene=${scene}&i=${i}`);
    await expect(page.getByTestId(ANCHOR_TESTID)).toBeVisible({
      timeout: 30_000,
    });
    return Date.now() - t0;
  };

  // Interleaved, with the order alternating per pair (H C, C H, H C, …): both
  // floors must come from the same stretch of runner state — timing all five
  // heavy reloads and then all five controls would let a runner that speeds
  // up or slows down mid-test move one scene and not the other, which is the
  // very noise the ratio exists to divide out. Alternating also stops either
  // scene from always being the one that runs right after the other's GC.
  const samples: number[] = [];
  const controlSamples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const order = i % 2 === 0 ? [HEAVY, CONTROL] : [CONTROL, HEAVY];
    for (const scene of order) {
      const ms = await timeFirstPaint(scene, i);
      (scene === HEAVY ? samples : controlSamples).push(ms);
    }
  }
  samples.sort((a, b) => a - b);
  controlSamples.sort((a, b) => a - b);

  // ── Why the MINIMUM and not the median (2026-08-18) ──────────────────────
  //
  // The median was measuring the runner, not the code. Nine CI samples across
  // three commits, threshold 5200:
  //   02a4720d  4722 ✓ · 5154 ✓ · 5051 ✓      (the last one a same-evening
  //                                            control run of the SAME code)
  //   94eed173  5283 ✗ · 4708 ✓
  //   d5a66dce  5226 ✗ · 5349 ✗
  //   07222bcb  5291 ✗
  // Spread 4708–5349 = 641ms of noise around a line with under 500ms of
  // headroom, and the two populations overlap almost completely — the same
  // commit produced both the highest and the lowest reading of its group. A
  // gate like that cannot tell a real regression from a busy runner; it just
  // reds out roughly half the time.
  //
  // The change deliberately does NOT touch the 5200 threshold. Runner noise is
  // one-sided — contention can only ever make a sample slower, never faster —
  // so the floor of several reloads is the closest thing to "what this code
  // actually costs", while the median drags in whatever else the machine was
  // doing. Raising the number instead would have bought quiet by weakening the
  // very thing the budget exists to catch (see budgets.ts: these catch
  // order-of-magnitude regressions, and the historical 22s first paint must
  // still trip it four times over).
  //
  // Every sample is logged, not just the statistic: the next re-lock should be
  // done on a real minimum population, which no CI log until now recorded.
  const floor = samples[0]!;
  reportBudget("firstPaint", floor, samples.length);
  // eslint-disable-next-line no-console
  console.log(`[budget] firstPaint samples=${samples.join(",")}`);

  // ── Why a RATIO is the regular gate (2026-10-06) ─────────────────────────
  //
  // The floor fixed the within-run noise; it cannot fix the between-run noise.
  // Same-code floors on ubuntu-latest span 3.0–7.3 s, and the light scenes of
  // the same runs move with them, so any millisecond line is either red on a
  // slow runner or blind on a fast one. Dividing by a control floor taken in
  // the same test, under the same clock and isolation, interleaved with the
  // heavy reloads, cancels the runner's speed and leaves "what 12× the data
  // costs". The same min-of-reloads statistic is used on both sides for the
  // same reason as above: noise is one-sided. Numbers and the provisional
  // lock: budgets.ts, firstPaintRatio.
  const controlFloor = controlSamples[0]!;
  reportBudget("firstPaintControl", controlFloor, controlSamples.length);
  // eslint-disable-next-line no-console
  console.log(`[budget] firstPaintControl samples=${controlSamples.join(",")}`);
  const ratio = floor / controlFloor;
  reportBudgetRatio("firstPaintRatio", ratio, samples.length);

  if (BUDGET_MS.firstPaintRatio !== null) {
    expect(ratio).toBeLessThan(BUDGET_MS.firstPaintRatio);
  }
  // Absolute backstop only (see budgets.ts): a fixed per-load cost raises
  // both scenes alike and is invisible to the ratio by construction.
  if (BUDGET_MS.firstPaint !== null) {
    expect(floor).toBeLessThan(BUDGET_MS.firstPaint);
  }
});
