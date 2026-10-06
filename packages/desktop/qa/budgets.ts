/** Performance budgets (measure-then-lock).
 *
 *  Strategy: at first only measure, never assert — every run prints
 *  `[budget] name=…ms`; once enough real CI numbers exist, take p95 × 1.5 and
 *  write it into this file, after which crossing the line turns CI red.
 *  null = not locked yet. Loosening any value requires the reason to go into
 *  the commit message.
 *
 *  Consumers: parse           → packages/parser/test/parseBudget.test.ts
 *             firstPaint      → packages/desktop/qa/visual/firstPaint.spec.ts
 *             firstPaintRatio → packages/desktop/qa/visual/firstPaint.spec.ts
 *             coldStart       → packages/desktop/qa/e2e/import.spec.ts
 *
 *  Every entry is milliseconds except firstPaintRatio, which is a
 *  dimensionless ratio of two same-run millisecond floors (see its comment).
 *
 *  Why all the budgets live in one place: they are one family of constants
 *  under one strategy, so the predicate is single-source — spread across their
 *  own packages, a strategy change would inevitably miss one. This file
 *  deliberately has zero imports so the parser's test process can consume it
 *  directly (see that test's relative-path import).
 */
export const BUDGET_MS: {
  parse: number | null;
  firstPaint: number | null;
  /** Dimensionless — NOT milliseconds. */
  firstPaintRatio: number | null;
  coldStart: number | null;
} = {
  // Basis for the lock: 3 CI samples taken on ubuntu-latest on 2026-07-19,
  // max × 1.5, rounded up. The ×1.5 headroom covers runner jitter.
  //   parse:      2742 / 3266 / 3174 → max 3266 × 1.5 → 4900
  //   firstPaint: 2190 / 2138 / 2119 → max 2190 × 1.5 → 3300
  //   coldStart:  1616 / 1717 / 1590 → max 1717 × 1.5 → 2600
  //
  // These three catch **order-of-magnitude regressions** (an accidental O(n²),
  // or someone dropping another big blob at module top level that V8 has to
  // parse as source), not 5% jitter. Loosening any value requires the reason to
  // go into the commit message.
  //
  // History: earlier on 2026-07-19 these three were locked at
  // 5100 / 41000 / 36000 — back then spellNames.json compiled into a JS object
  // literal with 410k keys and first paint alone took 22 seconds. After turning
  // on Vite's json.stringify, first render and cold start each got an order of
  // magnitude faster, and the budgets tightened accordingly. **That is what a
  // budget should look like: it follows real performance, not the other way
  // round.**
  // firstPaint re-locked 2026-08-04: 3300 → 5200.
  //
  // NOT a regression being papered over — the measured population moved, and
  // the old line stopped separating signal from jitter. Six consecutive CI
  // samples on ubuntu-latest:
  //   ce32577 3270 · ea558d8 2440 · ea558d8 3036 · 3026bc5 3007
  //   e86783b 2960 · 93ae553 3420  ← this one went red at 3300
  // 93ae553 differs from e86783b by six .png baseline files and nothing else,
  // yet swung 2960 → 3420: that spread is the runner, not the code. And the
  // pre-change baseline (3026bc5, 3007) is indistinguishable from the same code
  // after the curve-dropdown work (e86783b, 2960), so first paint did not
  // regress — the 2119–2190 population the 3300 was locked from simply no
  // longer exists.
  //
  // Re-locked by this file's own rule (max × 1.5): max 3420 × 1.5 → 5200. That
  // keeps the stated purpose intact — the historical 22s first paint would
  // still be caught four times over — while no longer going red on a 3.6%
  // overshoot.
  // firstPaint 2026-08-18: the NUMBER is unchanged, the statistic behind it is
  // not — the spec now asserts on the minimum of five reloads instead of the
  // median of three. Nine samples spanning 4708–5349ms across three commits
  // (including a same-evening control run of unchanged parent code) showed the
  // median tracking runner load rather than the code, with the same commit
  // producing both the highest and lowest reading of its group. Runner noise
  // only ever adds time, so the floor is the honest estimate of what the code
  // costs. Deliberately not loosened: see firstPaint.spec.ts for the data.
  // firstPaint 2026-08-23 重锁:5200 → 6400。**这正是 2026-08-18 那条注释点名要做
  // 的事** —— 它写着「下一次重锁应当用真实的最小值样本,而在此之前没有任何 CI
  // 日志记录过它」。现在记录到了:39 次 CI(2026-08-21 → 08-23,横跨 22 个提交,
  // 从 `[budget] firstPaint samples=` 逐条抓的最小值口径):
  //
  //   floor 分布   最小 3,002 · p25 4,316 · 中位 4,490 · p75 5,110 · 最大 5,329
  //   floor ≥ 5200 的比例   观测到 5–15%(真实值偏高:失败的那次尝试被重跑覆盖了
  //                         日志,当天我直接看到过 5,215 / 5,257 / 5,269 / 5,329)
  //
  // 这些 floor **与代码无关**:同一个 SHA 的两次尝试跑出过 4,180 和 5,329;当天
  // 主 chunk 回到改动前体积(3,135 vs 3,130 kB)时照样红。也就是说 5,200 坐在
  // 自己噪声带的 p95 上,它区分不出真回归和忙 runner —— 与 2026-08-04、
  // 2026-08-18 两次记录的失效模式完全同型,只是这次样本够了。
  //
  // 为什么是 ×1.2 而不是本文件开头写的 ×1.5(loosening 要给理由,这就是理由):
  // ×1.5 那条规则是为**单次采样/中位数**定的,headroom 要吃掉一次 reload 内部的
  // 抖动;而 floor 已经取了五次 reload 的最小值,把 run 内抖动滤掉了,剩下的是
  // **runner 之间**的快慢,那已经体现在「最大 floor」里。5,329 × 1.2 ≈ 6,400。
  //
  // 它还抓得住什么:历史上那次 22 秒首渲会 3.4 倍地触线;相对今天 4,490 的中位,
  // 任何 ≥42% 的回归仍然会红。抓不住 5–40% 的慢性回归 —— 那本来就不是这条门的
  // 职责(见本文件开头:这三条抓的是数量级回归)。
  //
  // 如果 6,400 之后又开始假红,下一步**不是**继续抬门,而是把指标改成同一次运行
  // 内的**相对量**(轻场景 vs 重场景之比),那才能真正把 runner 速度约掉。
  //
  // 2026-10-06: that next step, taken. firstPaint 6400 → 12800 (now only an
  // absolute backstop) + new firstPaintRatio (the regular gate once locked;
  // MEASURE-ONLY for now — user ruling 2026-10-06, see below).
  //
  // Why 6400 stopped working: the same-code floor population on ubuntu-latest
  // widened again — 40 consecutive frontend-qa runs (2026-10-01 → 10-06) span
  // 3,011–6,994 ms (2.32×), and 2026-10-06 alone went red twice at 6,763 /
  // 7,317 next to a 3,878 on a neighbouring commit. Over the same 40 runs the
  // light `settings` scene's whole-test duration moved 2.3 → 4.0 s and
  // correlates with the floor at r = 0.79: the runner, not the code. A fixed
  // millisecond line cannot separate a 2× runner from a 2× regression, so
  // re-locking it a fourth time would only buy the same failure later.
  //
  // firstPaintRatio = min(heavy) / min(control), both measured in the SAME
  // test, interleaved reload by reload, so both floors see the same runner
  // state and the runner's speed divides out. Control = `report-battle`: the
  // same real fixture at 1× through the same report view, waited on the same
  // `rpt-timeline` anchor; heavy = that fixture ×12 (`report-heavy`). What the
  // ratio measures is "how much more the report costs at 12× the data" —
  // exactly the class an accidental O(n²) in a derive lands in.
  //
  // PROVISIONAL lock, local samples only (one Mac, system Chrome, vite
  // preview, 5 interleaved pairs per run; 2026-10-06):
  //   this spec, 7 runs:   4.145 4.185 4.058 4.145 4.040 4.172 4.199
  //   standalone mirror, 6: 4.259 4.363 4.354 4.398 4.364 4.414
  // (the mirror skips the test runner, so its control floor is ~1.06 s
  // against the spec's ~1.20 s). This file's single-sample rule over the
  // max of both, rounded up to 0.1: 4.414 × 1.5 = 6.62 → 6.7 would be the
  // local candidate, but it is NOT applied: user ruling 2026-10-06 = measure
  // only (null) until CI data exists, per this file's measure-then-lock rule.
  // **Lock from CI** once the
  // `[budget] firstPaintRatio=` lines of ≥ 10 ubuntu-latest runs exist — the
  // CI ratio level is unknown (no CI log has ever recorded a control floor),
  // and a CPU-throttled local run (DevTools Emulation, renderer main thread
  // only) reads 6.54 at 1.6× / 7.56 at 2×, because ~70% of the control's
  // ~1.05 s is not main-thread script and does not slow down with it. Real
  // runners slow down every thread, which is what the settings-scene
  // correlation above says, but only CI samples can show the band.
  //
  // What each line now catches, and what it does not:
  //   - ratio: anything that scales with the data. A temporarily injected
  //     O(n²) over advancedSamples in deriveTimeline (control floor unmoved,
  //     heavy +5 s) read 8.08 in this spec and failed it; at half that
  //     strength (heavy +2.5 s, +53%) the mirror read 6.69 — just under the
  //     line, which is where a ×1.5 headroom puts the edge.
  //   - firstPaint 12800 (= 2 × the old lock): a fixed per-load cost — a big
  //     blob at module top level, the 13.8 MB SpellMisc icon table of
  //     2026-07-25, the historical 22 s object literal — raises heavy AND
  //     control alike, so the ratio is blind to it BY CONSTRUCTION; only the
  //     absolute floor sees it. 12800 is 1.75× the slowest same-code floor
  //     ever logged (7,317) and still trips the 22 s regression 1.7×. It
  //     does NOT catch a +50% fixed-cost regression like the icon table any
  //     more — nothing measured in absolute ms can on a runner population
  //     that itself spans 2.3×; catching that class needs its own same-run
  //     normaliser (a CPU-calibration workload), which is not built.
  parse: 4900,
  firstPaint: 12800,
  firstPaintRatio: null, // measure-only until ≥ 10 CI samples (ruling 2026-10-06)
  coldStart: 2600,
};

/** One shared measurement output format — the CI log IS the data source used
 *  when locking the budgets. */
export function reportBudget(name: string, ms: number, samples: number): void {
  // eslint-disable-next-line no-console
  console.log(`[budget] ${name}=${ms.toFixed(0)}ms n=${samples}`);
}

/** Same format family for a dimensionless budget (firstPaintRatio). */
export function reportBudgetRatio(
  name: string,
  ratio: number,
  samples: number,
): void {
  // eslint-disable-next-line no-console
  console.log(`[budget] ${name}=${ratio.toFixed(3)} n=${samples}`);
}
