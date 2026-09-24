/**
 * GH #106 step 2 — which casts count as pressing a cooldown, and the readers
 * that must agree on it (the ledger, deathOutcomeAnalysis' `isAvailableAt`).
 *
 * Talent ownership in these fixtures goes through `pvpTalents`: the ownership
 * check reads talent and PvP-talent ids alike, and a synthetic unit has no
 * talent-tree blob to resolve node ids from.
 */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  auraOnlyActivationSeconds,
  extractMajorCooldowns,
  isPressOfCooldown,
  talentReplacementsOf,
} from "../src/utils/cooldowns";
import { isAvailableAt } from "../src/utils/deathOutcomeAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const START = 1_700_000_000_000;
const at = (s: number) => START + s * 1000;

describe("talent replacements (DB2 replace_spell)", () => {
  it("Radiant Glory makes Avenging Wrath proc-only for that player and keeps its procs as activations", () => {
    const ret = makeUnit("p1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      info: { talents: [], pvpTalents: ["458359"] },
    });
    const repl = talentReplacementsOf(ret);
    expect(repl.procOnly.has("31884")).toBe(true);
    const proc = makeSpellCastEvent("454351", at(40), "p1") as unknown as {
      spellId: string;
      logLine: { event: string };
    };
    // the proc (no cooldown of its own) is an activation only for this player
    expect(isPressOfCooldown(proc, "31884", "Avenging Wrath", repl)).toBe(true);
    const other = makeUnit("p2", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      info: { talents: [], pvpTalents: [] },
    });
    expect(
      isPressOfCooldown(
        proc,
        "31884",
        "Avenging Wrath",
        talentReplacementsOf(other),
      ),
    ).toBe(false);
  });

  it("no button → deathOutcomeAnalysis never calls it available either", () => {
    const ret = makeUnit("p1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      info: { talents: [], pvpTalents: ["458359"] },
    });
    expect(isAvailableAt(ret, "31884", 60, 200, START)).toBe(false);
  });

  it("Ice Cold's press is an Ice Block press in the death analysis too", () => {
    const mage = makeUnit("p1", {
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Fire,
      info: { talents: [], pvpTalents: ["414659"] },
      spellCastEvents: [makeSpellCastEvent("414658", at(10), "p1")],
    });
    // 20 s after Ice Cold: Ice Block is on cooldown, not "available at death"
    expect(isAvailableAt(mage, "45438", 240, 30, START)).toBe(false);
    // without the talent the same cast id is not an Ice Block press
    const plain = makeUnit("p2", {
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Fire,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [makeSpellCastEvent("414658", at(10), "p2")],
    });
    expect(isAvailableAt(plain, "45438", 240, 30, START)).toBe(true);
  });
});

describe("aura evidence", () => {
  it("Doom Winds: every storm's buff is a press, even in a round that also logged a real press", () => {
    const shaman = makeUnit("p1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Enhancement,
      spellCastEvents: [makeSpellCastEvent("384352", at(10), "p1")],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "466772",
          at(10),
          "p1",
          "p1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "466772",
          at(80),
          "p1",
          "p1",
          "BUFF",
        ),
      ],
    });
    expect(auraOnlyActivationSeconds(shaman, "384352", START)).toEqual([
      10, 80,
    ]);
  });

  it("a proc-only entry has no availability windows (Renewing Blaze)", () => {
    const evoker = makeUnit("p1", {
      class: CombatUnitClass.Evoker,
      spec: CombatUnitSpec.Evoker_Devastation,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "374349",
          at(10),
          "p1",
          "p1",
          "BUFF",
        ),
      ],
    });
    const combat = {
      startTime: START,
      endTime: START + 300_000,
      units: { p1: evoker },
    } as unknown as AtomicArenaCombat;
    const rb = extractMajorCooldowns(evoker, combat).find(
      (cd) => cd.spellId === "374348",
    );
    expect(rb).toBeDefined();
    expect(rb!.isProcOnly).toBe(true);
    expect(rb!.casts.map((c) => c.timeSeconds)).toEqual([10]);
    expect(rb!.availableWindows).toEqual([]);
  });
});
