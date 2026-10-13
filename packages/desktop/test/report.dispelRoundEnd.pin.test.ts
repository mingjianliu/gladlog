import { CombatUnitReaction } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import {
  ROUND_END_DEATH_S,
  roundEndFixture,
  SOLO_SHUFFLE,
} from "./fixtures/roundEndFixture";

/**
 * Shared-Predicate pin: the prompt's builder and the report's two dispel
 * readers ask `reconstructDispelSummary` the same question.
 *
 * The readers ask through `dispelSummaryOf`, the prompt in
 * `buildMatchContext`; what each one actually passes is captured — the round
 * (whose end, zone and units the function reads) and both sides' pets — with
 * what it got back, and compared. The wrapper sits on the module the function
 * lives in: `buildMatchContext` imports it from there by path, the readers
 * through the package index that re-exports it.
 */
type Call = { combat: unknown; ourPets: string[]; theirPets: string[] };
const seen = vi.hoisted(() => ({
  calls: [] as Array<{
    args: unknown[];
    result: unknown;
  }>,
}));

vi.mock(
  "@gladlog/analysis/src/utils/dispelAnalysis",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@gladlog/analysis/src/utils/dispelAnalysis")
      >();
    return {
      ...actual,
      reconstructDispelSummary: (
        ...args: Parameters<typeof actual.reconstructDispelSummary>
      ) => {
        const result = actual.reconstructDispelSummary(...args);
        seen.calls.push({ args, result });
        return result;
      },
    };
  },
);

type Analysis = typeof import("@gladlog/analysis");
let buildMatchContext: Analysis["buildMatchContext"];
let roundEndMs: typeof import("@gladlog/analysis/src/utils/roundEnd").roundEndMs;
let deriveDispelDash: typeof import("../src/renderer/src/report/derive/dispelDash").deriveDispelDash;
let deriveMistakes: typeof import("../src/renderer/src/report/derive/mistakes").deriveMistakes;
let toLegacySafe: typeof import("../src/renderer/src/report/derive/legacySource").toLegacySafe;

beforeAll(async () => {
  // vitest.setup.ts has already loaded @gladlog/analysis, so its modules hold
  // the unwrapped function: load the graph again, under the mock.
  vi.resetModules();
  const analysis = await import("@gladlog/analysis");
  await analysis.ensureAnalysisData();
  buildMatchContext = analysis.buildMatchContext;
  ({ roundEndMs } = await import("@gladlog/analysis/src/utils/roundEnd"));
  ({ deriveDispelDash } =
    await import("../src/renderer/src/report/derive/dispelDash"));
  ({ deriveMistakes } =
    await import("../src/renderer/src/report/derive/mistakes"));
  ({ toLegacySafe } =
    await import("../src/renderer/src/report/derive/legacySource"));
});

const ids = (units: unknown): string[] =>
  (units as Array<{ id: string }>).map((u) => u.id);

/** What each caller asked with and got, the callers run one at a time. Only
 * the calls from our side's perspective (`friends` first) are kept: the
 * prompt and the panel also ask the mirror question. */
function askedWith(m: StoredMatch) {
  const legacy = toLegacySafe(m);
  const players = Object.values(legacy.units).filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction === CombatUnitReaction.Hostile,
  );
  const friendIds = friends.map((u) => u.id).sort();
  const run = (fn: () => unknown) => {
    seen.calls.length = 0;
    fn();
    const all = [...seen.calls];
    const ours = all.filter(
      (c) =>
        JSON.stringify(ids(c.args[0]).sort()) === JSON.stringify(friendIds),
    );
    return {
      n: all.length,
      ends: all.map((c) =>
        roundEndMs(c.args[2] as Parameters<typeof roundEndMs>[0]),
      ),
      asked: ours.map((c): Call => {
        const combat = c.args[2] as {
          zoneId?: string;
          startInfo?: { zoneId?: string; bracket?: string };
          units?: unknown;
        };
        return {
          combat: {
            zone: combat.zoneId ?? combat.startInfo?.zoneId,
            bracket: combat.startInfo?.bracket,
            // the very object, not a copy of some of it
            units: combat.units === legacy.units,
          },
          ourPets: ids(c.args[3] ?? []),
          theirPets: ids(c.args[4] ?? []),
        };
      }),
      got: ours.map((c) => c.result),
    };
  };
  return {
    legacy,
    prompt: run(() => buildMatchContext(legacy, friends, enemies)),
    dash: run(() => deriveDispelDash(m)),
    mistakes: run(() => deriveMistakes(m)),
  };
}

describe("战报的驱散读者与 prompt 的构建器:交给 reconstructDispelSummary 的是同一个回合结束", () => {
  it("单排:三方问到的都是回合终结死亡那一刻,不是日志结束", () => {
    const { legacy, prompt, dash, mistakes } = askedWith(
      roundEndFixture(SOLO_SHUFFLE),
    );
    const death = legacy.startTime + ROUND_END_DEATH_S * 1000;
    expect(roundEndMs(legacy)).toBe(death);
    expect(death).toBeLessThan(legacy.endTime);
    // the prompt's own calls: our side and the mirror perspective
    expect(prompt.n).toBeGreaterThanOrEqual(2);
    // the panel's: our side and theirs
    expect(dash.n).toBe(2);
    // candidateFindings' own, then the card's
    expect(mistakes.n).toBeGreaterThanOrEqual(1);
    expect(prompt.ends.every((t) => t === death)).toBe(true);
    expect(dash.ends.every((t) => t === death)).toBe(true);
    expect(mistakes.ends.every((t) => t === death)).toBe(true);
  });

  it("其他赛制:三方问到的都是日志结束", () => {
    const { legacy, prompt, dash, mistakes } = askedWith(
      roundEndFixture("3v3"),
    );
    expect(prompt.n).toBeGreaterThanOrEqual(2);
    expect(dash.n).toBe(2);
    expect(mistakes.n).toBeGreaterThanOrEqual(1);
    expect(prompt.ends.every((t) => t === legacy.endTime)).toBe(true);
    expect(dash.ends.every((t) => t === legacy.endTime)).toBe(true);
    expect(mistakes.ends.every((t) => t === legacy.endTime)).toBe(true);
  });
});

describe("战报的驱散读者与 prompt 的构建器:交的是同一个回合、同样的两边宠物,拿回的是同一份汇总", () => {
  it.each([SOLO_SHUFFLE, "3v3"])(
    "%s:面板与卡片交的地图、赛制、单位与宠物就是 prompt 交的;汇总逐字段相同",
    (bracket) => {
      const { legacy, prompt, dash, mistakes } = askedWith(
        roundEndFixture(bracket),
      );
      // the prompt's call from our side: the round itself and the pets of
      // both sides — the fixture has a zone and pets on each side
      expect(prompt.asked).toHaveLength(1);
      const want = prompt.asked[0]!;
      expect(want.combat).toEqual({
        zone: legacy.startInfo.zoneId,
        bracket,
        units: true,
      });
      expect(want.combat).toMatchObject({ zone: "1911" });
      expect(want.ourPets.length).toBeGreaterThan(0);
      expect(want.theirPets.length).toBeGreaterThan(0);

      // the panel asks once from our side, the card last of `deriveMistakes`'
      // calls (candidateFindings asks first, as part of the prompt's code)
      expect(dash.asked).toEqual([want]);
      expect(mistakes.asked.at(-1)).toEqual(want);

      // … and so they hold the summary the prompt holds, every field of it
      // (the three callers annotate kill windows with one predicate)
      const json = (v: unknown) => JSON.parse(JSON.stringify(v));
      expect(json(dash.got[0])).toEqual(json(prompt.got[0]));
      expect(json(mistakes.got.at(-1))).toEqual(json(prompt.got[0]));
    },
  );
});
