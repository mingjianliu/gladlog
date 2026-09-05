import { describe, expect, it } from "vitest";

import {
  CD_INSTANT_SLACK_S,
  cdAvailableAt,
  chargesAvailableAt,
} from "../src/utils/cooldowns";

/**
 * `chargesAvailableAt` — sequential charge recharge.
 *
 * Added 2026-08-18 after cross-AI review (agy) rejected the first
 * implementation: it counted "casts inside the last recharge window", which
 * models charges recharging in PARALLEL. WoW runs one recharge timer at a
 * time and only restarts it once the previous charge has landed, so the
 * window count over-reports availability. The reviewer's own counterexample
 * is the first test below.
 */
describe("chargesAvailableAt — 充能串行恢复", () => {
  it("agy 反例:2 层 / 20s,施放于 0、5、20 → t=35 手里是 0 层(滑动窗口会误判为可用)", () => {
    // t=0 用掉一层,计时器跑到 20;t=5 用掉第二层(计时器不变,仍是 20);
    // t=20 回来一层并被立刻用掉,下一层要等到 40。
    expect(chargesAvailableAt([0, 5, 20], 20, 2, 35)).toBe(0);
    // 而窗口 (15, 35] 只看得到 t=20 那一次 —— 旧写法会算出 1 层可用。
    expect([0, 5, 20].filter((t) => t <= 35 && t > 35 - 20).length).toBe(1);
  });

  it("同一序列在 t=40 恰好回一层", () => {
    expect(chargesAvailableAt([0, 5, 20], 20, 2, 39.9)).toBe(0);
    expect(chargesAvailableAt([0, 5, 20], 20, 2, 40)).toBe(1);
  });

  it("两层都在手:未施放过 → 满层", () => {
    expect(chargesAvailableAt([], 20, 2, 100)).toBe(2);
  });

  it("连续用掉两层后,恢复是串行的:第一层 +20s,第二层 +40s", () => {
    expect(chargesAvailableAt([0, 1], 20, 2, 19.9)).toBe(0);
    expect(chargesAvailableAt([0, 1], 20, 2, 20)).toBe(1);
    expect(chargesAvailableAt([0, 1], 20, 2, 39.9)).toBe(1);
    expect(chargesAvailableAt([0, 1], 20, 2, 40)).toBe(2);
  });

  it("满层时不会超额累积:长时间不用仍然是上限", () => {
    expect(chargesAvailableAt([0], 20, 2, 10_000)).toBe(2);
  });

  it("日志即真相:模型认为没层了却仍有施放 → 消耗并以该次施放重锚计时器", () => {
    // 0、5 用光两层;模型认为 t=10 不该能放,但日志说放了 —— 接受它,
    // 并从 10 起重新计时,而不是继续用一个已经错位的时间线。
    expect(chargesAvailableAt([0, 5, 10], 20, 2, 29)).toBe(0);
    expect(chargesAvailableAt([0, 5, 10], 20, 2, 30)).toBe(1);
  });

  it("单充能与 cdAvailableAt 逐点等价(含端点;cdAvailableAt 多带 CD_INSTANT_SLACK_S 渲染秒容差,GH #61)", () => {
    const casts = [10, 40];
    for (const t of [9.9, 10, 10.1, 39.9, 40, 49.9, 50, 50.1, 69.9, 70, 70.1]) {
      // The kernel is strict; the consumer-facing predicate answers for the
      // rendered instant (t + slack) so it agrees with the [RES] ledger.
      const viaCharges =
        chargesAvailableAt(casts, 30, 1, t + CD_INSTANT_SLACK_S) > 0;
      const viaLegacy = cdAvailableAt(
        {
          casts: casts.map((timeSeconds) => ({ timeSeconds })),
          cooldownSeconds: 30,
          neverUsed: false,
        },
        t,
      );
      expect({ t, viaCharges }).toEqual({ t, viaCharges: viaLegacy });
    }
  });

  it("退化输入:恢复时间非正 → 直接返回上限(不猜,不除零)", () => {
    expect(chargesAvailableAt([0, 1, 2], 0, 2, 5)).toBe(2);
    expect(chargesAvailableAt([0, 1, 2], -1, 3, 5)).toBe(3);
  });

  it("maxCharges 小于 1 按 1 处理", () => {
    expect(chargesAvailableAt([0], 30, 0, 10)).toBe(0);
    expect(chargesAvailableAt([0], 30, 0, 30)).toBe(1);
  });
});

/**
 * GH #22: `cdAvailableAt` used to look only at "last cast + cooldown", so a
 * 2-charge ability with one charge spent was reported as unavailable to every
 * ledger consumer (death-unused-defensive walls, defensive-early, momentSnapshot,
 * kill-window enemy defensives). The ledger now carries the talent-resolved
 * `charges`, and `cdAvailableAt` routes multi-charge entries through
 * `chargesAvailableAt`.
 */
describe("cdAvailableAt — 充能感知(GH #22)", () => {
  const ledger = (charges: number | undefined) => ({
    casts: [{ timeSeconds: 10 }],
    cooldownSeconds: 60,
    neverUsed: false,
    ...(charges === undefined ? {} : { charges }),
  });

  it("2 层技能用掉一层后,冷却未到也仍然可用", () => {
    expect(cdAvailableAt(ledger(2), 30)).toBe(true);
  });

  it("2 层技能两层都用掉,第一层要到 lastCast+cd 才回来(渲染秒容差 0.5s 内算回来,GH #61)", () => {
    const cd = {
      ...ledger(2),
      casts: [{ timeSeconds: 10 }, { timeSeconds: 12 }],
    };
    expect(cdAvailableAt(cd, 69.4)).toBe(false);
    expect(cdAvailableAt(cd, 69.5)).toBe(true); // 69.5 + CD_INSTANT_SLACK_S reaches 70
    expect(cdAvailableAt(cd, 70)).toBe(true);
  });

  it("不带 charges(旧 fixture)与 charges=1 都退化为旧口径", () => {
    for (const cd of [ledger(undefined), ledger(1)]) {
      expect(cdAvailableAt(cd, 30)).toBe(false);
      expect(cdAvailableAt(cd, 70)).toBe(true);
    }
  });
});

/**
 * GH #22 guard for the one ledger adapter that does NOT carry `charges`:
 * `killWindowTargetSelection.ts` → `wallsInHandAt` hand-builds
 * `{ casts, cooldownSeconds, neverUsed }` from raw casts and asks
 * `cdAvailableAt`, so it is charge-aware only if the official base data gives
 * one of WALL_IN_HAND_MIT_IDS more than one charge. None does today (24 ids at
 * the 2026-09-04 re-ruling; 14 ids when written,
 * verified 2026-08-20); if a data refresh changes that, this turns red and the
 * adapter must start passing `charges` — do not relax the assertion. Known
 * remaining gap, deliberately outside this guard: talent `extra_charge`
 * modifiers (Pain Suppression +1 via PvP talent 373035) are not applied on
 * that path either, because it has no talent ids in hand.
 * (Lives here rather than in killWindowTargetSelection.test.ts because that
 * file mocks spellEffectData with a 2-charge Pain Suppression.)
 */
describe("WALL_IN_HAND_MIT_IDS — 官方基础数据无多充能条目(wallsInHandAt 单充能台账前提)", () => {
  it("每个 id 的官方 charges 都 ≤ 1", async () => {
    const { WALL_IN_HAND_MIT_IDS } =
      await import("../src/utils/killWindowTargetSelection");
    const { spellEffectData } = await import("../src/data/spellEffectData");
    const multi = [...WALL_IN_HAND_MIT_IDS].filter(
      (id) => (spellEffectData[id]?.charges?.charges ?? 1) > 1,
    );
    expect(multi).toEqual([]);
  });
});
