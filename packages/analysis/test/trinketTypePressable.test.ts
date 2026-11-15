/**
 * Pipeline T126 (fact13 D34): Adaptation is a passive PvP trinket — nothing
 * to press — so a KILL ATTEMPTS line on its holder prints `no pressable PvP
 * trinket`, not `trinket up`.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import trinketItemIds from "../src/data/trinketItemIds.json";
import { MEDALLION_SPELL_ID } from "../src/utils/pvpTrinketUses";
import {
  detectTrinketType,
  hasPressablePvpTrinket,
} from "../src/utils/trinketType";

const unitWith = (
  trinkets: string[] | null,
  casts: string[] = [],
): ICombatUnit => {
  const equipment = trinkets
    ? Array.from({ length: 14 }, (_, i) => ({
        id: i === 12 ? trinkets[0]! : i === 13 ? trinkets[1]! : "1",
      }))
    : undefined;
  return {
    info: equipment ? { equipment } : undefined,
    spellCastEvents: casts.map((spellId) => ({ spellId })),
  } as unknown as ICombatUnit;
};

const BADGE = trinketItemIds.badgeItemIds[0]!;
const ADAPTATION = trinketItemIds.adaptationItemIds[0]!;
const RELENTLESS = trinketItemIds.relentlessItemIds[0]!;
const MEDALLION = trinketItemIds.gladiatorItemIds[0]!;

describe("hasPressablePvpTrinket", () => {
  it("Adaptation (badge + Adaptation, the audited slots) has nothing to press", () => {
    const u = unitWith(["270602", "270604"]);
    expect(detectTrinketType(u)).toBe("Adaptation");
    expect(hasPressablePvpTrinket(u)).toBe(false);
    expect(hasPressablePvpTrinket(unitWith([BADGE, ADAPTATION]))).toBe(false);
  });
  it("Relentless and two other trinkets have nothing to press (fact7 r5)", () => {
    expect(hasPressablePvpTrinket(unitWith([BADGE, RELENTLESS]))).toBe(false);
    expect(hasPressablePvpTrinket(unitWith([BADGE, "1"]))).toBe(false);
  });
  it("a Medallion, or unknown equipment, can be pressed", () => {
    expect(hasPressablePvpTrinket(unitWith([BADGE, MEDALLION]))).toBe(true);
    expect(hasPressablePvpTrinket(unitWith(null))).toBe(true);
  });
  it("a logged Medallion press overrides a stale item list", () => {
    expect(
      hasPressablePvpTrinket(
        unitWith([BADGE, ADAPTATION], [MEDALLION_SPELL_ID]),
      ),
    ).toBe(true);
  });
});
