/**
 * Pipeline T194 (GH #207 item 9) — one press that runs as two auras on the
 * unit is one defensive of a stack: Touch of Karma's marker 122470 and its
 * absorb 125174 printed the same `[STACKED DEFENSIVES]` line twice.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  stackedDefensiveKeyOf,
  stackedDefensivePairs,
} from "../src/analysis/stackedDefensives";
import { formatStackedDefensiveLines } from "../src/context/stackedDefensives";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const KARMA = "122470";
const KARMA_ABSORB = "125174";
const PAIN_SUPPRESSION = "33206";

const pairsWith = (karmaAuras: string[]) => {
  const aura = (t: number, event: string, spellId: string, src: string) => ({
    spellId,
    spellName: spellId,
    srcUnitId: src,
    srcUnitName: `${src}-R`,
    destUnitId: "M",
    timestamp: T0 + t,
    logLine: { event, timestamp: T0 + t },
  });
  const unit = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    name: `${id}-R`,
    spec: CombatUnitSpec.Monk_Windwalker,
    reaction: CombatUnitReaction.Friendly,
    info: { teamId: "0" },
    advancedActions: [
      { timestamp: T0, advancedActorCurrentHp: 100, advancedActorMaxHp: 100 },
    ],
    damageIn: [],
    absorbsIn: [],
    auraEvents: [],
    spellCastEvents: [],
    ...over,
  });
  const owner = unit("P", { spec: CombatUnitSpec.Priest_Discipline });
  // the marker runs its 10 s, the absorb is eaten after 5
  const ends: Record<string, number> = {
    [KARMA]: 20_000,
    [KARMA_ABSORB]: 15_000,
  };
  const monk = unit("M", {
    auraEvents: [
      ...karmaAuras.map((id) =>
        aura(10_000, LogEvent.SPELL_AURA_APPLIED, id, "M"),
      ),
      aura(12_000, LogEvent.SPELL_AURA_APPLIED, PAIN_SUPPRESSION, "P"),
      ...karmaAuras.map((id) =>
        aura(ends[id]!, LogEvent.SPELL_AURA_REMOVED, id, "M"),
      ),
      aura(20_000, LogEvent.SPELL_AURA_REMOVED, PAIN_SUPPRESSION, "P"),
    ].sort((a, b) => a.logLine.timestamp - b.logLine.timestamp),
  });
  return stackedDefensivePairs(
    owner as never,
    {
      startTime: T0,
      endTime: T0 + 60_000,
      units: { P: owner, M: monk },
      startInfo: { bracket: "3v3" },
    } as never,
  );
};

describe("[STACKED DEFENSIVES] — two auras of one press are one defensive (T194)", () => {
  it("both auras stand for the one key", () => {
    expect(stackedDefensiveKeyOf(KARMA)).toBe(KARMA);
    expect(stackedDefensiveKeyOf(KARMA_ABSORB)).toBe(KARMA);
  });

  it("one pair, one line, over the aura that ended first", () => {
    const pairs = pairsWith([KARMA, KARMA_ABSORB]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ overlapFromSec: 12, overlapToSec: 15 });
    expect(formatStackedDefensiveLines(pairs)).toHaveLength(1);
  });

  it("a press the log shows as one aura reads as before", () => {
    const pairs = pairsWith([KARMA]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ overlapFromSec: 12, overlapToSec: 20 });
  });
});
