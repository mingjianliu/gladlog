/**
 * fact10 roster rulings (user, 2026-11-04). A roster row is what the ledger
 * is built from, so each id must be one the corpus casts (Curated-List rule).
 *  - D13: Burrow 409293 (Shaman PvP talent) is a Defensive row — a talented,
 *    never-pressed Burrow is ready on the ledger (Time Stop's precedent).
 *  - D12: Spirit Walk 58875 leaves the ready / accusation set only; a press
 *    still answers a crisis (the response set does not shrink).
 *  - D2–D4 / D31: Breath of Eons 403631 and Frostwyrm's Fury 279302 are
 *    Offensive rows.
 */
import { CombatUnitClass } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { isDefensiveCdResponse } from "../src/analysis/candidates/cooldownTiming";
import { isNotMajorDefensive } from "../src/data/abilityProfile";
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

describe("fact10 roster rows", () => {
  it.each([
    [CombatUnitClass.Shaman, "409293", "Burrow", SpellTag.Defensive],
    [CombatUnitClass.Evoker, "403631", "Breath of Eons", SpellTag.Offensive],
    [
      CombatUnitClass.DeathKnight,
      "279302",
      "Frostwyrm's Fury",
      SpellTag.Offensive,
    ],
  ])("%s %s %s — a %s row, cast in the corpus", (cls, id, name, tag) => {
    const r = row(cls, id);
    expect(r).toBeDefined();
    expect(r!.name).toBe(name);
    expect(r!.tags).toEqual([tag]);
    expect(OBSERVED.has(id)).toBe(true);
  });

  it("Spirit Walk: out of the major-defensive set, still a response when pressed", () => {
    expect(isNotMajorDefensive("58875")).toBe(true);
    expect(isNotMajorDefensive("409293")).toBe(false);
    expect(
      isDefensiveCdResponse({
        spellId: "58875",
        tag: "Defensive",
        isThroughput: false,
      } as never),
    ).toBe(true);
  });
});
