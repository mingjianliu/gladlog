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
    // Without the talent on record the same cast still spends Ice Block: the
    // two share DB2 charge pool 1560 (spendsSharedChargeOf, W1e 2026-09-26) —
    // a logged Ice Cold press proves the talent whatever COMBATANT_INFO says.
    const plain = makeUnit("p2", {
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Fire,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [makeSpellCastEvent("414658", at(10), "p2")],
    });
    expect(isAvailableAt(plain, "45438", 240, 30, START)).toBe(false);
    // …and nothing else spends it: 240 s later Ice Block is back
    expect(isAvailableAt(plain, "45438", 240, 251, START)).toBe(true);
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

describe("a later stage of one press (COPY_CAST_IDS)", () => {
  it("Champion's Spear: the re-press 1271980 is not a second press of the 90 s cooldown, however long after the throw", () => {
    // 82a2d681 round 5 (Robou): thrown 0:47.841 (376079), re-pressed 0:50.421
    // (1271980) — 2.58 s, past the ledger's 2 s merge. 1271980 carries a 6 s
    // cooldown of its own in DB2, so by name it read as a variant press.
    const warrior = makeUnit("p1", {
      class: CombatUnitClass.Warrior,
      spec: CombatUnitSpec.Warrior_Arms,
      spellCastEvents: [
        makeSpellCastEvent("376079", at(47.841), "p1"),
        makeSpellCastEvent("1271980", at(50.421), "p1"),
      ],
    });
    const repl = talentReplacementsOf(warrior);
    const [thrown, again] = warrior.spellCastEvents as unknown as Array<{
      spellId: string;
      logLine: { event: string };
    }>;
    expect(isPressOfCooldown(thrown!, "376079", "Champion's Spear", repl)).toBe(
      true,
    );
    expect(isPressOfCooldown(again!, "376079", "Champion's Spear", repl)).toBe(
      false,
    );
    const combat = {
      startTime: START,
      endTime: at(200),
      units: { p1: warrior },
    } as unknown as AtomicArenaCombat;
    const spear = extractMajorCooldowns(warrior, combat).find(
      (cd) => cd.spellId === "376079",
    );
    expect(spear).toBeDefined();
    expect(spear!.casts.map((c) => c.timeSeconds)).toEqual([47.841]);
    // the death analysis reads the same press: 90 s from the throw, not from
    // the re-press
    expect(isAvailableAt(warrior, "376079", 90, 138.5, START)).toBe(true);
    expect(isAvailableAt(warrior, "376079", 90, 137, START)).toBe(false);
  });

  it("a real same-named variant press still counts (a glyphed Hex, by name)", () => {
    const shaman = makeUnit("p1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
    });
    // Hex's glyphed variant 211004 (30 s of its own) against the roster's 51514
    const press = makeSpellCastEvent("211004", at(10), "p1") as unknown as {
      spellId: string;
      logLine: { event: string };
    };
    expect(
      isPressOfCooldown(press, "51514", "Hex", talentReplacementsOf(shaman)),
    ).toBe(true);
  });
});

describe("the round's own window", () => {
  it("a press after a shuffle round's endTime (the next round's preparation phase) is not a press of this round", () => {
    // Crumbstain, every-12th archive file: Stasis at 100.0, the deciding death
    // ~116, Arena Preparation re-applied at 118.4, Stasis stocked again before
    // the next gate at 126.3 — a 26 s "recast" of a 90 s cooldown
    const evoker = makeUnit("p1", {
      class: CombatUnitClass.Evoker,
      spec: CombatUnitSpec.Evoker_Preservation,
      spellCastEvents: [
        makeSpellCastEvent("370537", at(100), "p1"),
        makeSpellCastEvent("370537", at(126.3), "p1"),
      ],
    });
    const combat = {
      startTime: START,
      endTime: at(118),
      units: { p1: evoker },
    } as unknown as AtomicArenaCombat;
    const stasis = extractMajorCooldowns(evoker, combat).find(
      (cd) => cd.spellId === "370537",
    );
    expect(stasis).toBeDefined();
    expect(stasis!.casts.map((c) => c.timeSeconds)).toEqual([100]);
  });
});
