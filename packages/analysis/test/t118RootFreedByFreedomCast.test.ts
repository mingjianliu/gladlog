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

function summary(castAtS: number | null, castOn = "m", ccId = FROST_NOVA) {
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
      aura(LogEvent.SPELL_AURA_REMOVED, ccId, 13.971, "m"),
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

  it("only a root qualifies", () => {
    const friends = [
      {
        spellCastEvents: [makeSpellCastEvent(TIGERS_LUST, START + 5000, "m")],
      },
    ] as never;
    expect(
      wasFreedByTargetBoundCast(friends, FROST_NOVA, "m", START + 5000),
    ).toBe(true);
    expect(wasFreedByTargetBoundCast(friends, "118", "m", START + 5000)).toBe(
      false,
    );
  });
});
