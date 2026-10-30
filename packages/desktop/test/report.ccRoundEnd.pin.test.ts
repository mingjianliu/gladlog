import { CombatUnitReaction } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import {
  ROUND_END_DEATH_S,
  roundEndFixture,
  SOLO_SHUFFLE,
} from "./fixtures/roundEndFixture";

/**
 * Shared-Predicate pin: the report's control readers — the stats table
 * (`statsTable.ts`), the death recap (`deathRecap.ts`), the replay's control
 * spans (`replayHighlights.ts`) and the key moments (`keyMoments.ts`) — ask
 * `analyzePlayerCCAndTrinket` with the round the prompt's builder asks with.
 *
 * The function reads the round's end off the combat it is handed
 * (`roundEndMs`: a Solo Shuffle round's ending death, else the log's end) and
 * the zone off `startInfo.zoneId`. What each caller actually passes is
 * captured, with what it got back. The wrapper sits on the module the
 * function lives in: `buildMatchContext` imports it from there by path, the
 * readers through the package index that re-exports it.
 *
 * The fixture's Fear on Player1 runs 64 s → 72 s and the injected death is
 * at 70 s: in a Solo Shuffle round the control is 6 s long, in 3v3 it is 8 s.
 */
const seen = vi.hoisted(() => ({
  calls: [] as Array<{ args: unknown[]; result: unknown }>,
}));

vi.mock(
  "@gladlog/analysis/src/utils/ccTrinketAnalysis",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@gladlog/analysis/src/utils/ccTrinketAnalysis")
      >();
    return {
      ...actual,
      analyzePlayerCCAndTrinket: (
        ...args: Parameters<typeof actual.analyzePlayerCCAndTrinket>
      ) => {
        const result = actual.analyzePlayerCCAndTrinket(...args);
        seen.calls.push({ args, result });
        return result;
      },
    };
  },
);

type Analysis = typeof import("@gladlog/analysis");
let buildMatchContext: Analysis["buildMatchContext"];
let roundEndMs: typeof import("@gladlog/analysis/src/utils/roundEnd").roundEndMs;
let deriveStatsTable: typeof import("../src/renderer/src/report/derive/statsTable").deriveStatsTable;
let deriveDeathRecaps: typeof import("../src/renderer/src/report/derive/deathRecap").deriveDeathRecaps;
let deriveCcSpans: typeof import("../src/renderer/src/report/derive/replayHighlights").deriveCcSpans;
let deriveKeyMoments: typeof import("../src/renderer/src/report/derive/keyMoments").deriveKeyMoments;
let toLegacySafe: typeof import("../src/renderer/src/report/derive/legacySource").toLegacySafe;

beforeAll(async () => {
  // vitest.setup.ts has already loaded @gladlog/analysis, so its modules hold
  // the unwrapped function: load the graph again, under the mock.
  vi.resetModules();
  const analysis = await import("@gladlog/analysis");
  await analysis.ensureAnalysisData();
  buildMatchContext = analysis.buildMatchContext;
  ({ roundEndMs } = await import("@gladlog/analysis/src/utils/roundEnd"));
  ({ deriveStatsTable } =
    await import("../src/renderer/src/report/derive/statsTable"));
  ({ deriveDeathRecaps } =
    await import("../src/renderer/src/report/derive/deathRecap"));
  ({ deriveCcSpans } =
    await import("../src/renderer/src/report/derive/replayHighlights"));
  ({ deriveKeyMoments } =
    await import("../src/renderer/src/report/derive/keyMoments"));
  ({ toLegacySafe } =
    await import("../src/renderer/src/report/derive/legacySource"));
});

type Asked = {
  roundEnd: number;
  zone: string | undefined;
  bracket: string | undefined;
  /** the round's own units object, not a copy of some of the round */
  units: boolean;
  pets: string[];
};

/** What each caller asked with and got, per player, the callers run one at
 * a time. */
function askedWith(m: StoredMatch) {
  const legacy = toLegacySafe(m);
  const players = Object.values(legacy.units).filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction === CombatUnitReaction.Hostile,
  );
  const run = (fn: () => unknown) => {
    seen.calls.length = 0;
    fn();
    const byPlayer = new Map<string, { asked: Asked; got: unknown }>();
    for (const c of seen.calls) {
      const player = c.args[0] as { id: string };
      const combat = c.args[2] as {
        startInfo?: { zoneId?: string; bracket?: string };
        units?: unknown;
      };
      byPlayer.set(player.id, {
        asked: {
          roundEnd: roundEndMs(c.args[2] as Parameters<typeof roundEndMs>[0]),
          zone: combat.startInfo?.zoneId,
          bracket: combat.startInfo?.bracket,
          units: combat.units === legacy.units,
          pets: ((c.args[3] ?? []) as Array<{ id: string }>).map((u) => u.id),
        },
        got: JSON.parse(JSON.stringify(c.result)),
      });
    }
    return byPlayer;
  };
  return {
    legacy,
    friends,
    prompt: run(() => buildMatchContext(legacy, friends, enemies)),
    readers: {
      statsTable: run(() => deriveStatsTable(m)),
      deathRecap: run(() => deriveDeathRecaps(m)),
      replayHighlights: run(() => deriveCcSpans(m)),
      keyMoments: run(() => deriveKeyMoments(m)),
    },
  };
}

describe("战报的控制读者与 prompt 的构建器:交给 analyzePlayerCCAndTrinket 的是同一个回合", () => {
  it.each([SOLO_SHUFFLE, "3v3"])(
    "%s:四个读者交的回合结束、地图、赛制、单位与宠物就是 prompt 交的,拿回的汇总逐字段相同",
    (bracket) => {
      const { legacy, friends, prompt, readers } = askedWith(
        roundEndFixture(bracket),
      );
      const death = legacy.startTime + ROUND_END_DEATH_S * 1000;
      const end = bracket === SOLO_SHUFFLE ? death : legacy.endTime;
      expect(roundEndMs(legacy)).toBe(end);
      expect(death).toBeLessThan(legacy.endTime);

      // the prompt asks for every friendly, with the round itself
      for (const f of friends) {
        expect(prompt.get(f.id)!.asked).toMatchObject({
          roundEnd: end,
          zone: "1911",
          bracket,
          units: true,
        });
      }
      expect(prompt.get(friends[0]!.id)!.asked.pets.length).toBeGreaterThan(0);

      for (const [name, calls] of Object.entries(readers)) {
        // every reader asks for our players at least
        for (const f of friends) expect(calls.has(f.id), name).toBe(true);
        for (const [id, call] of calls) {
          // the round's end and the zone, for every player it asks about
          expect(call.asked, `${name} ${id}`).toMatchObject({
            roundEnd: end,
            zone: "1911",
            bracket,
            units: true,
          });
          // and where the prompt asked about the same player: the same
          // question, the same answer
          const want = prompt.get(id);
          if (!want) continue;
          expect(call.asked, `${name} ${id}`).toEqual(want.asked);
          expect(call.got, `${name} ${id}`).toEqual(want.got);
        }
      }
    },
  );
});

describe("战报的控制读者:回合终结死亡时还在身上的控制止于那一刻(与 prompt 的 [CC ON TEAM] 行同一个 roundEndMs)", () => {
  const fearOf = (m: StoredMatch) => {
    const row = deriveStatsTable(m).find((r) => r.name === "Player1-Test")!;
    const legacy = toLegacySafe(m);
    const span = deriveCcSpans(m)[row.unitId]!.find(
      (s) => s.spellName === "Fear",
    )!;
    return {
      row,
      label: row.detail.ccTaken.find((i) => i.label.startsWith("Fear"))!.label,
      spanS: [
        (span.fromMs - legacy.startTime) / 1000,
        (span.toMs - legacy.startTime) / 1000,
      ],
    };
  };

  it("统计表的被控秒数与明细、回放的控制区间:单排里 Fear 64 s → 70 s(6.0s),不是日志里 72 s 的移除", () => {
    const shuffle = fearOf(roundEndFixture(SOLO_SHUFFLE));
    expect(shuffle.label).toBe("Fear 6.0s(Player4-Test)");
    expect(shuffle.spanS).toEqual([64, ROUND_END_DEATH_S]);

    // 3v3: the same death ends nothing — the control runs to its removal
    const threes = fearOf(roundEndFixture("3v3"));
    expect(threes.label).toBe("Fear 8.0s(Player4-Test)");
    expect(threes.spanS).toEqual([64, 72]);

    // every instance of the Solo Shuffle row is inside the round: the ones
    // 3v3 lists that began before the death, each ending by it — a control
    // applied after the death (the fixture has one) is not in the round
    const lengthOf = (label: string) => Number(/ (\d+\.\d)s\(/.exec(label)![1]);
    const inRound = threes.row.detail.ccTaken.filter(
      (i) => i.tS < ROUND_END_DEATH_S,
    );
    expect(threes.row.detail.ccTaken.length).toBeGreaterThan(inRound.length);
    expect(shuffle.row.detail.ccTaken.map((i) => i.tS)).toEqual(
      inRound.map((i) => i.tS),
    );
    for (const i of shuffle.row.detail.ccTaken)
      expect(i.tS + lengthOf(i.label)).toBeLessThanOrEqual(
        ROUND_END_DEATH_S + 0.05,
      );
    // and the row's 被控 seconds are the instances it lists
    for (const r of [shuffle.row, threes.row])
      expect(r.ccTakenS).toBeCloseTo(
        r.detail.ccTaken.reduce((s, i) => s + lengthOf(i.label), 0),
        0,
      );
    expect(threes.row.ccTakenS).toBeGreaterThan(shuffle.row.ccTakenS + 2 - 0.1);
  });
});
