/**
 * Reliability rounds 2/3 W1e (2026-09-26): charges the ledger used to lose.
 *  - A shared DB2 charge pool (SHARED_CHARGE_CATEGORY): Blessing of
 *    Spellwarding spends Blessing of Protection's charge (06bb, a5a8). Both
 *    availability predicates — the ledger's `cdAvailableAt` and the death
 *    path's `isAvailableAt` — must see it (same fact, one predicate).
 *  - A genuine second press of a multi-charge spell inside the ledger's 2 s
 *    dedupe window (f4da: Ice Barrier at +0.73 s was dropped).
 */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { SHARED_CHARGE_CATEGORY } from "../src/data/sharedChargeGenerated";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  cdAvailableAt,
  extractMajorCooldowns,
  spendsSharedChargeOf,
} from "../src/utils/cooldowns";
import { isAvailableAt } from "../src/utils/deathOutcomeAnalysis";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;

function combatOf(unit: ReturnType<typeof makeUnit>): AtomicArenaCombat {
  return {
    startTime: T0,
    endTime: T0 + 600_000,
    units: { [unit.id]: unit },
  } as unknown as AtomicArenaCombat;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("shared DB2 charge pool", () => {
  it("Blessing of Protection and Blessing of Spellwarding share ChargeCategory 1392", () => {
    expect(SHARED_CHARGE_CATEGORY["1022"]).toBe("1392");
    expect(SHARED_CHARGE_CATEGORY["204018"]).toBe("1392");
  });

  it("a Spellwarding press puts Blessing of Protection on cooldown — ledger and death path agree", () => {
    const unit = makeUnit("p1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Protection,
      spellCastEvents: [makeSpellCastEvent("204018", T0 + 10_000, "p1")],
    });
    const combat = combatOf(unit);
    const bop = extractMajorCooldowns(unit, combat).find(
      (c) => c.spellId === "1022",
    );
    expect(bop).toBeDefined();
    expect(bop!.casts).toHaveLength(0); // never pressed itself…
    expect(bop!.sharedCasts?.map((c) => c.timeSeconds)).toEqual([10]);
    for (const [t, want] of [
      [5, true],
      [20, false],
      [309, false],
      [311, true],
    ] as const) {
      expect(cdAvailableAt(bop!, t)).toBe(want);
      expect(isAvailableAt(unit, "1022", bop!, t, T0)).toBe(want);
    }
  });

  it("a press of the spell itself is not a shared-pool press", () => {
    const e = makeSpellCastEvent("1022", T0, "p1") as unknown as Parameters<
      typeof spendsSharedChargeOf
    >[0];
    expect(spendsSharedChargeOf(e, "1022")).toBe(false);
    expect(spendsSharedChargeOf(e, "204018")).toBe(true);
  });
});

describe("a second charge pressed inside the 2 s dedupe window", () => {
  it("keeps both presses of a 2-charge spell (Zenith, official 2 charges / 90 s)", () => {
    const unit = makeUnit("p1", {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Windwalker,
      spellCastEvents: [
        makeSpellCastEvent("1249625", T0 + 98_890, "p1"),
        makeSpellCastEvent("1249625", T0 + 99_620, "p1"),
      ],
    });
    const hb = extractMajorCooldowns(unit, combatOf(unit)).find(
      (c) => c.spellId === "1249625",
    );
    expect(hb?.charges).toBe(2);
    expect(hb!.casts.map((c) => c.timeSeconds)).toEqual([98.89, 99.62]);
    // both charges spent: nothing in hand until the first recharge lands
    expect(cdAvailableAt(hb!, 110)).toBe(false);
    expect(cdAvailableAt(hb!, 189)).toBe(true); // first recharge: 98.89 + 90
  });

  it("collapses the same press logged twice at one instant, even with 2 charges (codex review)", () => {
    const unit = makeUnit("p1", {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Windwalker,
      spellCastEvents: [
        makeSpellCastEvent("1249625", T0 + 10_000, "p1"),
        makeSpellCastEvent("1249625", T0 + 10_000, "p1"),
      ],
    });
    const z = extractMajorCooldowns(unit, combatOf(unit)).find(
      (c) => c.spellId === "1249625",
    );
    expect(z?.casts).toHaveLength(1);
    expect(cdAvailableAt(z!, 20)).toBe(true); // one charge still in hand
  });

  it("still collapses a duplicate press of a single-charge spell", () => {
    const unit = makeUnit("p1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: [
        makeSpellCastEvent("642", T0 + 10_000, "p1"),
        makeSpellCastEvent("642", T0 + 10_500, "p1"),
      ],
    });
    const ds = extractMajorCooldowns(unit, combatOf(unit)).find(
      (c) => c.spellId === "642",
    );
    expect(ds?.casts).toHaveLength(1);
  });
});
