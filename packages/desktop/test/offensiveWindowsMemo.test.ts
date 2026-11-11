import {
  computeOffensiveWindows,
  ensureAnalysisData,
} from "@gladlog/analysis";
import { computeOffensiveWindowsUncached } from "@gladlog/analysis/src/utils/offensiveWindows";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { heavyMatch } from "../dev/fixtures/appShell";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

/** The real sample ×12 (the first-paint scene's own fixture): the 90 s sample
 * alone has no kill window, this has 22 from one side and 11 from the other. */
const freshRound = () =>
  toLegacySafe(
    heavyMatch(
      loadRealMatchFixture() as unknown as Record<string, unknown>,
    ) as unknown as StoredMatch,
  );

// T81: computeOffensiveWindows is kept once per round object and pair of
// sides (analysis utils/combatMemo.ts) — six callers per report render asked
// for it. Performance only: on the real fixture the kept result is the fresh
// one, from either team's point of view, before and after the lazy tables
// load, and after the round is changed in place.
describe("computeOffensiveWindows —— 每回合只算一次,与现算逐值相等(真实 fixture ×12)", () => {
  const sides = (legacy: ReturnType<typeof toLegacySafe>) => {
    const players = Object.values(legacy.units).filter((u) => u.info);
    return {
      friends: players.filter(
        (u) => u.reaction === CombatUnitReaction.Friendly,
      ),
      enemies: players.filter((u) => u.reaction === CombatUnitReaction.Hostile),
    };
  };

  it("数据表载入前算的结果,载入后不再被拿来用", async () => {
    // a fresh round object, read once before the tables are awaited
    const legacy = freshRound();
    const { friends, enemies } = sides(legacy);
    computeOffensiveWindows(enemies, friends, legacy);
    await ensureAnalysisData();
    expect(computeOffensiveWindows(enemies, friends, legacy)).toEqual(
      computeOffensiveWindowsUncached(enemies, friends, legacy),
    );
  });

  describe("数据表已载入", () => {
    beforeAll(async () => {
      await ensureAnalysisData();
    });

    it("两个视角各自与现算相等,且互不相同;重复调用返回相等的新数组", () => {
      const legacy = freshRound();
      const { friends, enemies } = sides(legacy);
      const ours = computeOffensiveWindows(enemies, friends, legacy);
      const theirs = computeOffensiveWindows(friends, enemies, legacy);
      expect(ours.length).toBeGreaterThan(5);
      expect(theirs.length).toBeGreaterThan(5);
      expect(ours).toEqual(
        computeOffensiveWindowsUncached(enemies, friends, legacy),
      );
      expect(theirs).toEqual(
        computeOffensiveWindowsUncached(friends, enemies, legacy),
      );
      expect(theirs).not.toEqual(ours);
      const again = computeOffensiveWindows(enemies, friends, legacy);
      expect(again).toEqual(ours);
      expect(again).not.toBe(ours);
      // the rows are shared: that is what "kept" means
      expect(again[0]).toBe(ours[0]);
      // filter() builds fresh arrays with the same units: still one entry
      const s2 = sides(legacy);
      expect(
        computeOffensiveWindows(s2.enemies, s2.friends, legacy)[0],
      ).toBe(ours[0]);
    });

    it("回合被原地改动(删掉一名敌人的全部伤害事件)后重算,仍与现算相等", () => {
      const legacy = freshRound();
      const { friends, enemies } = sides(legacy);
      const before = computeOffensiveWindows(enemies, friends, legacy);
      expect(before.length).toBeGreaterThan(5);
      // the enemy the first window is on takes no damage any more
      const target = enemies.find((u) => u.id === before[0]!.targetUnitId)!;
      expect(target.damageIn.length).toBeGreaterThan(0);
      target.damageIn.length = 0;
      const after = computeOffensiveWindows(enemies, friends, legacy);
      expect(after).toEqual(
        computeOffensiveWindowsUncached(enemies, friends, legacy),
      );
      expect(after).not.toEqual(before);
    });
  });
});
