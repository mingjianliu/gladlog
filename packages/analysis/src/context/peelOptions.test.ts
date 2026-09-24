/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../index";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../test/ported/testHelpers";
import { formatPeelOptions, peelOptionsForDeaths } from "./peelOptions";

const T0 = 1_000_000;
const DEATH_S = 80;
const at = (s: number) => T0 + s * 1000;
const standAt = (x: number) =>
  Array.from({ length: 121 }, (_, s) => makeAdvancedAction(at(s), x, 0));

function scenario(opts: {
  ownerSpec: CombatUnitSpec;
  ownerClass: CombatUnitClass;
  ccSpellId: string;
  ccCastAtS?: number[];
  ownerAuras?: any[];
  attackerSpec?: CombatUnitSpec;
  attackerCasts?: any[];
}) {
  const owner = makeUnit("p1", {
    name: "Owner",
    spec: opts.ownerSpec,
    class: opts.ownerClass,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: (opts.ccCastAtS ?? [5]).map((s) =>
      makeSpellCastEvent(
        opts.ccSpellId,
        at(s),
        "e1",
        "Attacker",
        "p1",
        "Owner",
      ),
    ),
    auraEvents: opts.ownerAuras ?? [],
    advancedActions: standAt(0),
  });
  const victim = makeUnit("v1", {
    name: "Victim",
    // No spec: without COMBATANT_INFO the ledger would hand a real spec its
    // whole kit (a Frost DK's untaken Asphyxiate) — production filters it.
    spec: CombatUnitSpec.None,
    reaction: CombatUnitReaction.Friendly,
    damageIn: Array.from({ length: 10 }, (_, i) => ({
      ...makeDamageEvent(at(DEATH_S - 9 + i), -60_000, "v1"),
      srcUnitId: "e1",
      srcUnitName: "Attacker",
    })),
    deathRecords: [{ timestamp: at(DEATH_S) }],
    advancedActions: standAt(1),
  });
  const attacker = makeUnit("e1", {
    name: "Attacker",
    spec: opts.attackerSpec ?? CombatUnitSpec.Rogue_Assassination,
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: opts.attackerCasts ?? [],
    advancedActions: standAt(3),
  });
  const combat: any = {
    startTime: T0,
    endTime: at(120),
    startInfo: { zoneId: "" },
    units: { p1: owner, v1: victim, e1: attacker },
  };
  return peelOptionsForDeaths({
    combat,
    friends: [owner, victim],
    enemies: [attacker],
    friendlyDeaths: [{ name: "Victim", atSeconds: DEATH_S }],
    enemyCC: [],
  });
}

const paladin = {
  ownerSpec: CombatUnitSpec.Paladin_Retribution,
  ownerClass: CombatUnitClass.Paladin,
  ccSpellId: "853", // Hammer of Justice — instant stun
};

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("peelOptionsForDeaths (GH #77)", () => {
  it("offers a ready instant CC on the main attacker before a death", () => {
    const out = scenario(paladin);
    expect(out).toHaveLength(1);
    expect(out[0]!.spellId).toBe("853");
    expect(out[0]!.attackerName).toBe("Attacker");
    expect(out[0]!.usableSeconds.length).toBeGreaterThanOrEqual(3);
    const lines = formatPeelOptions(out, {
      friendly: (n) => n,
      enemy: (n) => n,
    });
    expect(lines[1]).toMatch(
      /\[PEEL OPTION\] {2}Owner Hammer of Justice → Attacker: usable \d+ s, not used/,
    );
  });

  it("says nothing when the CC was used inside the window", () => {
    expect(scenario({ ...paladin, ccCastAtS: [5, 75] })).toHaveLength(0);
  });

  it("never counts a second the owner spends in a casting lockout (Ice Block, aura 60)", () => {
    const lock = [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "45438",
        at(69),
        "p1",
        "p1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "45438",
        at(80),
        "p1",
        "p1",
        "BUFF",
      ),
    ];
    expect(scenario({ ...paladin, ownerAuras: lock })).toHaveLength(0);
  });

  it("drops a fear the attacker can break himself (Berserker Rage ready), keeps it when it is on cooldown", () => {
    const priest = {
      ownerSpec: CombatUnitSpec.Priest_Discipline,
      ownerClass: CombatUnitClass.Priest,
      ccSpellId: "8122", // Psychic Scream — instant fear
      attackerSpec: CombatUnitSpec.Warrior_Arms,
    };
    const rage = (s: number) =>
      makeSpellCastEvent("18499", at(s), "e1", "Attacker", "e1", "Attacker");
    expect(scenario({ ...priest, attackerCasts: [rage(2)] })).toHaveLength(0);
    // Cast at 65 s: on cooldown for the whole window
    expect(scenario({ ...priest, attackerCasts: [rage(65)] })).toHaveLength(1);
  });

  it("never offers a cast-time CC (Polymorph, 1.7 s)", () => {
    const out = scenario({
      ownerSpec: CombatUnitSpec.Mage_Frost,
      ownerClass: CombatUnitClass.Mage,
      ccSpellId: "118",
    });
    expect(out.some((o) => o.spellId === "118")).toBe(false);
  });
});
