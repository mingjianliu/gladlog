/**
 * B-tier D4, roster rows (user rulings 2026-10-06). A roster row is what the
 * owner's ledger is built from — press lines, the loadout, [RES], "ready"
 * defensives — so each id here must be the id the game logs as the cast
 * (Curated-List rule: a dead id never fires and looks authoritative).
 */
import { CombatUnitClass } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { classMetadata } from "../src/data/classSpells";
import observed from "../src/data/observedSpellIdsGenerated.json";
import { SpellTag } from "../src/data/spellTypes";

const OBSERVED = new Set(
  (observed as unknown as Array<string | number>).map(String),
);
const row = (unitClass: CombatUnitClass, spellId: string) =>
  classMetadata
    .find((c) => c.unitClass === unitClass)!
    .abilities.find((a) => a.spellId === spellId);

describe("Death Knight: Death Pact and Lichborne are on the roster (B15a)", () => {
  it.each([
    // Death Pact is a save; Lichborne is on the ledger but not a defensive
    // (user ruling 2026-10-07): no reader of "ready defensives" may see it
    ["48743", "Death Pact", SpellTag.Defensive],
    ["49039", "Lichborne", SpellTag.Utility],
  ])("%s %s — a %s row, and an id the corpus casts", (id, name, tag) => {
    const r = row(CombatUnitClass.DeathKnight, id);
    expect(r).toBeDefined();
    expect(r!.name).toBe(name);
    expect(r!.tags).toEqual([tag]);
    expect(OBSERVED.has(id)).toBe(true);
  });
});

describe("Rogue: Smoke Bomb is on the roster (B16c)", () => {
  it("212182 — the PvP talent's cast id, on the ledger but not a defensive (ruling 2026-10-07), cast in the corpus; the dead 359053 is not listed", () => {
    const r = row(CombatUnitClass.Rogue, "212182");
    expect(r).toBeDefined();
    expect(r!.name).toBe("Smoke Bomb");
    expect(r!.tags).toEqual([SpellTag.Utility]);
    expect(OBSERVED.has("212182")).toBe(true);
    expect(row(CombatUnitClass.Rogue, "359053")).toBeUndefined();
  });
});
