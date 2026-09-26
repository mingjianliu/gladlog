/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GH #115 — Radiant Glory's proc Avenging Wrath (454351) is the EFFECT of
 * Avenging Wrath 31884 for every burst consumer, and still never a PRESS of
 * it. Two halves of one registered relationship
 * (`OFFENSIVE_EFFECT_ACTIVATION_IDS`), pinned together so neither side can
 * drift into the other.
 */
import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";

import { effectiveCooldownSeconds } from "../src/data/spellEffectData";
import {
  canonicalSpellId,
  isPressOfCooldown,
  talentReplacementsOf,
} from "../src/utils/cooldowns";
import {
  isEnemyCdWindowSpell,
  reconstructEnemyCDTimeline,
  SOLO_WINDOW_MIN_WEIGHT,
} from "../src/utils/enemyCDs";
import {
  cdTierWeight,
  isOffensiveSpell,
  offensiveEffectCdId,
  spellDangerWeight,
} from "../src/utils/spellDanger";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const START = 1_000_000;

describe("Radiant Glory's Avenging Wrath (454351) — effect identity", () => {
  it("is Avenging Wrath's effect, and an enemy-CD window spell on 31884's cooldown", () => {
    expect(offensiveEffectCdId("454351")).toBe("31884");
    expect(isOffensiveSpell("454351")).toBe(true);
    expect(isEnemyCdWindowSpell("454351")).toBe(true);
    // the reason the recurrence floor could not be used as its cooldown
    expect(cdTierWeight(30)).toBe(0);
  });

  it("is NOT a press of Avenging Wrath — button readiness is untouched", () => {
    expect(canonicalSpellId("454351")).not.toBe(canonicalSpellId("31884"));
    const proc = makeSpellCastEvent("454351", START + 40_000, "p1") as any;
    const plain = makeUnit("p2", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      info: { talents: [], pvpTalents: [] },
    });
    expect(
      isPressOfCooldown(
        proc,
        "31884",
        "Avenging Wrath",
        talentReplacementsOf(plain),
      ),
    ).toBe(false);
  });

  it("a lone proc forms a solo burst window weighted like Avenging Wrath, 8 s long, with no 'available again'", () => {
    const enemy = makeUnit("e1", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: [
        makeSpellCastEvent("454351", START + 20_000, "e1", "Self", "e1"),
      ],
    });
    const tl = reconstructEnemyCDTimeline([enemy], {
      startTime: START,
      endTime: START + 120_000,
    } as any);
    const [cd] = tl.players[0]!.offensiveCDs;
    expect(cd!.spellId).toBe("454351");
    expect(cd!.cooldownSeconds).toBe(0);
    expect(cd!.availableAgainAtSeconds).toBeNull();
    expect(cd!.buffEndSeconds).toBe(28);
    const awWeight = spellDangerWeight(
      "31884",
      effectiveCooldownSeconds("31884") ?? 0,
    );
    expect(cd!.dangerWeight).toBe(awWeight);
    expect(awWeight).toBeGreaterThanOrEqual(SOLO_WINDOW_MIN_WEIGHT);
    expect(tl.alignedBurstWindows).toHaveLength(1);
    expect(tl.alignedBurstWindows[0]!.fromSeconds).toBe(20);
    expect(tl.alignedBurstWindows[0]!.toSeconds).toBe(28);
  });
});
