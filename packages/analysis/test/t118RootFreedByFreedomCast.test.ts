/**
 * T118 (fact12 retest M3, 60bfdea9 2:16): a root freed by a teammate's
 * Tiger's Lust / Blessing of Freedom that logged no SPELL_DISPEL row was
 * filed as a missed cleanse (no latencyS — "no friendly dispel at all").
 * The removal shares the cast's instant: it is a cleanse, like the same
 * cast with its SPELL_DISPEL row.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  reconstructDispelSummary,
  rootRanOutAtDrTier,
  wasFreedByTargetBoundCast,
} from "../src/utils/dispelAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const FROST_NOVA = "122";
const TIGERS_LUST = "116841";
const aura = (event: LogEvent, spellId: string, s: number, dest: string) => ({
  ...makeAuraEvent(event, spellId, START + s * 1000, "e1", dest),
  spellName: spellId,
});
const combat = { startTime: START, endTime: START + 60_000 };

function summary(
  castAtS: number | null,
  castOn = "m",
  ccId = FROST_NOVA,
  removedAtS = 13.971,
) {
  const healer = makeUnit("h", {
    name: "Healer",
    spec: CombatUnitSpec.Monk_Mistweaver,
    spellCastEvents:
      castAtS === null
        ? []
        : [
            makeSpellCastEvent(
              TIGERS_LUST,
              START + castAtS * 1000,
              castOn,
              "Melee",
              "h",
              "Healer",
            ),
          ],
  });
  const melee = makeUnit("m", {
    name: "Melee",
    spec: CombatUnitSpec.Warrior_Fury,
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, ccId, 10, "m"),
      aura(LogEvent.SPELL_AURA_REMOVED, ccId, removedAtS, "m"),
    ],
  });
  const enemy = makeUnit("e1", { reaction: CombatUnitReaction.Hostile });
  return reconstructDispelSummary(
    [healer, melee] as never,
    [enemy] as never,
    combat as never,
  );
}

describe("T118 — a root freed by a target-bound freedom cast is cleansed", () => {
  it("control: with no freedom cast the Frost Nova is a missed-cleanse window", () => {
    const s = summary(null);
    expect(s.missedCleanseWindows.map((w) => w.spellId)).toEqual([FROST_NOVA]);
  });

  it("Tiger's Lust on the rooted unit in the removal's instant: no missed window, a cleanse", () => {
    const s = summary(13.971);
    expect(s.missedCleanseWindows).toEqual([]);
    expect(s.lateCleanseWindows.map((w) => w.spellId)).toEqual([FROST_NOVA]);
  });

  it("a cast on another unit, or outside the pairing tolerance, frees nothing", () => {
    expect(summary(13.971, "x").missedCleanseWindows).toHaveLength(1);
    expect(summary(13.8).missedCleanseWindows).toHaveLength(1);
  });

  it("codex 85-tk-L-T118-1 #1: a root that ran its full 6 s as the cast went out was not freed", () => {
    expect(
      summary(16.04, "m", FROST_NOVA, 16.0).missedCleanseWindows,
    ).toHaveLength(1);
  });

  it("codex 85-tk-L-T118-1b #1: a Frost Nova that ran its DR'd 3 s after an Entangling Roots was not freed", () => {
    // the summary fixture's victim, with an Entangling Roots first
    const healer = makeUnit("h", {
      name: "Healer",
      spec: CombatUnitSpec.Monk_Mistweaver,
      spellCastEvents: [
        makeSpellCastEvent(
          TIGERS_LUST,
          START + 13_040,
          "m",
          "Melee",
          "h",
          "Healer",
        ),
      ],
    });
    const melee = makeUnit("m", {
      name: "Melee",
      spec: CombatUnitSpec.Warrior_Fury,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "339", 1, "m"),
        aura(LogEvent.SPELL_AURA_REMOVED, "339", 3, "m"),
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, 10, "m"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, 13, "m"),
      ],
    });
    const s = reconstructDispelSummary(
      [healer, melee] as never,
      [makeUnit("e1", { reaction: CombatUnitReaction.Hostile })] as never,
      combat as never,
    );
    expect(s.lateCleanseWindows.map((w) => w.spellId)).not.toContain(
      FROST_NOVA,
    );
  });

  it("only a root qualifies, and only one that did not run out", () => {
    const friends = [
      {
        spellCastEvents: [makeSpellCastEvent(TIGERS_LUST, START + 5000, "m")],
      },
    ] as never;
    const freed = (id: string, ranMs: number, lengthS: number | undefined) =>
      wasFreedByTargetBoundCast(
        friends,
        id,
        "m",
        START + 5000 - ranMs,
        START + 5000,
        lengthS,
      );
    expect(freed(FROST_NOVA, 4000, 6)).toBe(true);
    // its full length, its DR tier, an unknown length: no credit
    expect(freed(FROST_NOVA, 6000, 6)).toBe(false);
    expect(freed(FROST_NOVA, 3000, 6)).toBe(false);
    expect(freed(FROST_NOVA, 4000, undefined)).toBe(false);
    expect(freed("118", 4000, 6)).toBe(false);
    expect(rootRanOutAtDrTier(5900, 6)).toBe(true);
    expect(rootRanOutAtDrTier(3100, 6)).toBe(true);
    expect(rootRanOutAtDrTier(3200, 6)).toBe(false);
  });
});
