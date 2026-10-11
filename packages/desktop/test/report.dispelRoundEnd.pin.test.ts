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
 * readers ask `reconstructDispelSummary` with the same round end.
 *
 * They cannot share an expression — the prompt hands the function the round
 * itself, the readers hand it `dispelRoundOf(legacy)` — so the argument each
 * one actually passes is captured and `roundEndMs` of it compared. The
 * wrapper sits on the module the function lives in: `buildMatchContext`
 * imports it from there by path, the readers through the package index that
 * re-exports it.
 */
const seen = vi.hoisted(() => ({ combats: [] as unknown[] }));

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
        seen.combats.push(args[2]);
        return actual.reconstructDispelSummary(...args);
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

/** The round ends each caller asked with, the callers run one at a time. */
function askedWith(m: StoredMatch) {
  const legacy = toLegacySafe(m);
  const players = Object.values(legacy.units).filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction === CombatUnitReaction.Hostile,
  );
  const run = (fn: () => unknown): number[] => {
    seen.combats.length = 0;
    fn();
    return seen.combats.map((c) =>
      roundEndMs(c as Parameters<typeof roundEndMs>[0]),
    );
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
    expect(prompt.length).toBeGreaterThanOrEqual(2);
    // the panel's: our side and theirs
    expect(dash).toHaveLength(2);
    // candidateFindings' own, then the card's
    expect(mistakes.length).toBeGreaterThanOrEqual(1);
    expect(prompt.every((t) => t === death)).toBe(true);
    expect(dash.every((t) => t === death)).toBe(true);
    expect(mistakes.every((t) => t === death)).toBe(true);
  });

  it("其他赛制:三方问到的都是日志结束", () => {
    const { legacy, prompt, dash, mistakes } = askedWith(
      roundEndFixture("3v3"),
    );
    expect(prompt.length).toBeGreaterThanOrEqual(2);
    expect(dash).toHaveLength(2);
    expect(mistakes.length).toBeGreaterThanOrEqual(1);
    expect(prompt.every((t) => t === legacy.endTime)).toBe(true);
    expect(dash.every((t) => t === legacy.endTime)).toBe(true);
    expect(mistakes.every((t) => t === legacy.endTime)).toBe(true);
  });
});
