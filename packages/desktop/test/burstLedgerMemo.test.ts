import {
  analyzeBurstLedger,
  ensureAnalysisData,
  extractMajorCooldowns,
} from "@gladlog/analysis";
import { analyzeBurstLedgerUncached } from "@gladlog/analysis/src/utils/burstLedger";
import { extractMajorCooldownsUncached } from "@gladlog/analysis/src/utils/cooldowns";
import {
  enemyDefensiveEvents,
  enemyDefensiveEventsUncached,
  saveAuraIntervals,
  saveAuraIntervalsUncached,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { heavyMatch } from "../dev/fixtures/appShell";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const freshRound = () =>
  toLegacySafe(
    heavyMatch(
      loadRealMatchFixture() as unknown as Record<string, unknown>,
    ) as unknown as StoredMatch,
  );
const sides = (legacy: ReturnType<typeof toLegacySafe>) => {
  const players = Object.values(legacy.units).filter((u) => u.info);
  return {
    friends: players.filter((u) => u.reaction === CombatUnitReaction.Friendly),
    enemies: players.filter((u) => u.reaction === CombatUnitReaction.Hostile),
  };
};

// T201: analyzeBurstLedger, enemyDefensiveEvents, saveAuraIntervals and
// extractMajorCooldowns are kept once per round
// object and argument identity (analysis utils/combatMemo.ts). Performance
// only: the kept result is the fresh one.
describe("爆发台账 / 敌方防御事件 / 冷却台账 —— 每回合只算一次,与现算逐值相等(真实 fixture ×12)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("analyzeBurstLedger:每个玩家、两个视角都与现算相等;重复调用是相等的新数组", () => {
    const legacy = freshRound();
    const { friends, enemies } = sides(legacy);
    let entries = 0;
    for (const [mine, theirs] of [
      [friends, enemies],
      [enemies, friends],
    ] as const)
      for (const p of mine) {
        const allies = mine.filter((u) => u.id !== p.id);
        const kept = analyzeBurstLedger(p, allies, theirs, legacy);
        expect(kept).toEqual(
          analyzeBurstLedgerUncached(p, allies, theirs, legacy),
        );
        const again = analyzeBurstLedger(p, allies, theirs, legacy);
        expect(again).toEqual(kept);
        expect(again).not.toBe(kept);
        entries += kept.length;
      }
    expect(entries).toBeGreaterThan(5);
  });

  it("enemyDefensiveEvents:每个单位、带与不带回合结束时刻都与现算相等,互不串", () => {
    const legacy = freshRound();
    const { friends, enemies } = sides(legacy);
    const roundEnd = legacy.startTime + 60_000;
    let events = 0;
    for (const team of [friends, enemies])
      for (const u of team) {
        const whole = enemyDefensiveEvents(u, team, legacy);
        const cut = enemyDefensiveEvents(u, team, legacy, roundEnd);
        expect(whole).toEqual(enemyDefensiveEventsUncached(u, team, legacy));
        expect(cut).toEqual(
          enemyDefensiveEventsUncached(u, team, legacy, roundEnd),
        );
        // and the first asker's answer was not replaced by the second's
        expect(enemyDefensiveEvents(u, team, legacy)).toEqual(whole);
        events += whole.length;
      }
    expect(events).toBeGreaterThan(5);
  });

  it("saveAuraIntervals:每个单位与现算相等", () => {
    const legacy = freshRound();
    const { friends, enemies } = sides(legacy);
    let n = 0;
    for (const team of [friends, enemies])
      for (const u of team) {
        const kept = saveAuraIntervals(u, team, legacy);
        expect(kept).toEqual(saveAuraIntervalsUncached(u, team, legacy));
        n += kept.length;
      }
    expect(n).toBeGreaterThan(5);
  });

  it("extractMajorCooldowns:与现算相等;每个调用方拿到自己的行,改写不串到下一个调用方", () => {
    const legacy = freshRound();
    const { friends, enemies } = sides(legacy);
    let rows = 0;
    for (const u of [...friends, ...enemies]) {
      const fresh = extractMajorCooldownsUncached(u, legacy);
      const withBaseline = extractMajorCooldowns(u, legacy, {
        withBaselineOnly: true,
      });
      expect(withBaseline).toEqual(fresh);
      const owned = extractMajorCooldowns(u, legacy);
      expect(owned).toEqual(fresh.filter((cd) => !cd.baselineOnly));
      // an annotator writes onto its rows
      for (const cd of owned) {
        cd.spellName = "written";
        cd.casts.length = 0;
      }
      expect(extractMajorCooldowns(u, legacy)).toEqual(
        fresh.filter((cd) => !cd.baselineOnly),
      );
      rows += fresh.length;
    }
    expect(rows).toBeGreaterThan(10);
  });

  it("回合被原地改动(删掉一名敌人的全部伤害事件)后重算,仍与现算相等", () => {
    const legacy = freshRound();
    const { friends, enemies } = sides(legacy);
    const p = friends[0]!;
    const allies = friends.slice(1);
    analyzeBurstLedger(p, allies, enemies, legacy);
    (enemies[0] as unknown as { damageIn: unknown[] }).damageIn = [];
    expect(analyzeBurstLedger(p, allies, enemies, legacy)).toEqual(
      analyzeBurstLedgerUncached(p, allies, enemies, legacy),
    );
  });
});
