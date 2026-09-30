/**
 * Mass Invisibility 414664 (triage 2026-09-29 F-H16, user ruling 2026-09-30
 * A9-2): a Defensive the ledger admits; it reaches an ally in combat only
 * with PvP talent 415945 (A9-EVIDENCE §2), so a player whose COMBATANT_INFO
 * shows no 415945 cannot be told to have saved a teammate with it.
 */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";

import {
  cdCanHelpAnotherUnit,
  extractMajorCooldowns,
} from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_700_000_000_000;
const mage = (pvpTalents: string[] | null) =>
  makeUnit("p1", {
    class: CombatUnitClass.Mage,
    spec: CombatUnitSpec.Mage_Frost,
    ...(pvpTalents ? { info: { pvpTalents } } : {}),
    spellCastEvents: [makeSpellCastEvent("414664", START + 30_000, "p1")],
  });
const combat = (u: ReturnType<typeof makeUnit>) =>
  ({
    startTime: START,
    endTime: START + 300_000,
    units: { p1: u },
  }) as unknown as AtomicArenaCombat;
const mi = (u: ReturnType<typeof makeUnit>) =>
  extractMajorCooldowns(u, combat(u)).find((c) => c.spellId === "414664");

describe("Mass Invisibility — ledger row and talent-gated ally reach", () => {
  it("is a Defensive in the Mage ledger", () => {
    const e = mi(mage(["415945"]));
    expect(e?.tag).toBe("Defensive");
  });
  it("with Improved Mass Invisibility it can help a teammate", () => {
    expect(cdCanHelpAnotherUnit(mi(mage(["415945"]))!)).toBe(true);
  });
  it("COMBATANT_INFO without 415945 → cannot help a teammate", () => {
    const e = mi(mage([]))!;
    expect(e.allyReach).toBe(false);
    expect(cdCanHelpAnotherUnit(e)).toBe(false);
  });
  it("talents unknown (no COMBATANT_INFO) → no gate", () => {
    const e = mi(mage(null));
    expect(e).toBeDefined();
    expect(cdCanHelpAnotherUnit(e!)).toBe(true);
  });
  it("COMBATANT_INFO without a PvP talent list → no gate (unknown, not absent)", () => {
    const u = makeUnit("p1", {
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Frost,
      info: {},
      spellCastEvents: [makeSpellCastEvent("414664", START + 30_000, "p1")],
    });
    const e = mi(u);
    expect(e).toBeDefined();
    expect(cdCanHelpAnotherUnit(e!)).toBe(true);
  });
});
