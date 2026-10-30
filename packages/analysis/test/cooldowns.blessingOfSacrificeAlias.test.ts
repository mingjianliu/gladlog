/**
 * Triage 2026-09-29, crisis-external F-A9 (user ruling P-A9 = A, 2026-10-01):
 * Blessing of Sacrifice cast as 199448 (the Ultimate Sacrifice PvP talent's
 * id) is the same button as 6940 — one ledger entry, one roster row.
 *
 * And the kit builder must not leak one unit's observed id into the next
 * unit's kit. With the alias in place, `existing.spellId = observedId` wrote
 * 199448 into the SHARED class-roster object, so after the first Holy Paladin
 * who pressed 199448 every later non-Holy paladin in the same process lost
 * Blessing of Sacrifice to `SPEC_EXCLUSIVE_SPELLS["199448"]` (Holy only):
 * on the 605-file capture the loadout line named it 2,468 → 1,269 times and
 * 754 `[YOU]` / `[TEAM] [CD]` lines vanished (398 Retribution). A single-file
 * run cannot see it.
 */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { classMetadata } from "../src/data/classSpells";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  canonicalSpellId,
  extractMajorCooldowns,
  spellAliasIds,
} from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

function combatOf(owner: ICombatUnit): AtomicArenaCombat {
  return {
    startTime: 0,
    endTime: 120_000,
    units: { [owner.id]: owner },
  } as unknown as AtomicArenaCombat;
}

const sacrificeEntries = (u: ICombatUnit) =>
  extractMajorCooldowns(u, combatOf(u)).filter(
    (c) => c.spellName === "Blessing of Sacrifice",
  );

describe("Blessing of Sacrifice 199448 is an alias of 6940 (F-A9, ruling P-A9)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the alias", () => {
    expect(canonicalSpellId("199448")).toBe("6940");
    expect(spellAliasIds("6940").sort()).toEqual(["199448", "6940"]);
  });

  it("a Holy Paladin who presses 199448 has ONE Blessing of Sacrifice entry, with the press on it", () => {
    const holy = makeUnit("holy-1", {
      name: "HolyPal",
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      spellCastEvents: [makeSpellCastEvent("199448", 30_000, "holy-1", "ally")],
    });
    const entries = sacrificeEntries(holy);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.casts).toHaveLength(1);
    expect(entries[0]!.neverUsed).toBe(false);
  });

  it("order independence: a Retribution Paladin processed AFTER that Holy Paladin still has his 6940", () => {
    const rosterIds = () =>
      classMetadata
        .flatMap((c) => c.abilities)
        .filter((a) => a.name === "Blessing of Sacrifice")
        .map((a) => a.spellId);
    const holy = makeUnit("holy-1", {
      name: "HolyPal",
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      spellCastEvents: [makeSpellCastEvent("199448", 30_000, "holy-1", "ally")],
    });
    sacrificeEntries(holy);
    // the shared class roster is not written to
    expect(rosterIds()).toEqual(["6940"]);
    const ret = makeUnit("ret-1", {
      name: "RetPal",
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: [makeSpellCastEvent("6940", 24_000, "ret-1", "ally")],
    });
    const entries = sacrificeEntries(ret);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.spellId).toBe("6940");
    expect(entries[0]!.casts).toHaveLength(1);
  });
});
