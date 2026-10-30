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

import { ensureAnalysisData } from "../src/data/ensure";
import { SHARED_CHARGE_CATEGORY } from "../src/data/sharedChargeGenerated";
import {
  effectiveCooldownSeconds,
  spellEffectData,
} from "../src/data/spellEffectData";
import { SPELL_EFFECTS_GENERATED } from "../src/data/spellEffectGenerated";
import { SPELL_EFFECT_OVERRIDES } from "../src/data/spellEffectOverrides";
import {
  cdAvailableAt,
  cdSecondsUntilReady,
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
    // A paladin with both buttons: Blessing of Protection from the class tree
    // (node 81616), Spellwarding as the PvP talent. (For Protection the
    // Spellwarding talent REPLACES Blessing of Protection.)
    const unit = makeUnit("p1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      info: {
        talents: [{ id1: 81616, id2: 102604, count: 1 }],
        pvpTalents: ["204018"],
      },
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

/**
 * 2026-10-13: Blessing of Spellwarding carried a hand cooldown of 180 s while
 * the pool it shares with Blessing of Protection recovers in 300 s — after one
 * press `[RES]` printed `Protection(300s), Spellwarding(180s)` (552 rows on the
 * 605-file capture, all 120 s apart) and Spellwarding was called ready 120 s
 * early. Evidence and corpus split: the note in `spellEffectOverrides.ts`.
 */
describe("one charge pool, one recovery", () => {
  // Holy Paladin with both buttons: Blessing of Protection from the class
  // tree (node 81616), Spellwarding as the PvP talent.
  const BOP_TALENT = { id1: 81616, id2: 102604, count: 1 };
  // Improved Blessing of Protection (node 81617): −60 s on charge category 1392
  const IMPROVED_BOP_TALENT = { id1: 81617, id2: 102606, count: 1 };
  const holy = (pressed: string, talents = [BOP_TALENT]) =>
    makeUnit("p1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      info: { talents, pvpTalents: ["204018"] },
      spellCastEvents: [makeSpellCastEvent(pressed, T0 + 10_000, "p1")],
    });

  it.each([
    ["Spellwarding", "204018"],
    ["Blessing of Protection", "1022"],
  ])(
    "after a %s press both buttons come back at the same second",
    (_name, pressed) => {
      const unit = holy(pressed);
      const cds = extractMajorCooldowns(unit, combatOf(unit));
      const bop = cds.find((c) => c.spellId === "1022");
      const sw = cds.find((c) => c.spellId === "204018");
      expect(bop).toBeDefined();
      expect(sw).toBeDefined();
      expect(sw!.cooldownSeconds).toBe(300);
      expect(bop!.cooldownSeconds).toBe(300);
      for (const t of [5, 20, 189, 191, 309, 311, 400]) {
        expect(cdAvailableAt(sw!, t), `t=${t}`).toBe(cdAvailableAt(bop!, t));
        expect(cdSecondsUntilReady(sw!, t), `t=${t}`).toBe(
          cdSecondsUntilReady(bop!, t),
        );
      }
      // the hand 180 s called Spellwarding ready from 190 s
      expect(cdAvailableAt(sw!, 191)).toBe(false);
      expect(cdAvailableAt(sw!, 311)).toBe(true);
    },
  );

  it("the pool's talents move both buttons together (Improved Blessing of Protection: 240 s)", () => {
    const unit = holy("204018", [BOP_TALENT, IMPROVED_BOP_TALENT]);
    const cds = extractMajorCooldowns(unit, combatOf(unit));
    expect(cds.find((c) => c.spellId === "204018")!.cooldownSeconds).toBe(240);
    expect(cds.find((c) => c.spellId === "1022")!.cooldownSeconds).toBe(240);
  });

  it("Spellwarding has no hand row: its recovery is the DB2 pool's (a back-fill is refused)", () => {
    expect(SPELL_EFFECT_OVERRIDES["204018"]).toBeUndefined();
    expect(spellEffectData["204018"]?.charges).toEqual({
      charges: 1,
      chargeCooldownSeconds: 300,
    });
    expect(spellEffectData["204018"]?.cooldownSeconds).toBeUndefined();
    expect(spellEffectData["204018"]?.durationSeconds).toBe(6);
    expect(effectiveCooldownSeconds("204018")).toBe(
      effectiveCooldownSeconds("1022"),
    );
  });

  // A hand row on a pool member replaces the whole DB2 row (the merge is a
  // spread), so it can silently give one button of a pool its own recovery.
  // An exception needs its evidence written here, next to the id.
  const SIGNED_POOL_DEVIATIONS: Record<string, string> = {};

  it("every member of a pool reads the pool's recovery — a hand override may not disagree with it unsigned", () => {
    const gen = SPELL_EFFECTS_GENERATED as Record<
      string,
      { charges?: { chargeCooldownSeconds?: number } }
    >;
    const pools = new Map<string, string[]>();
    for (const [id, pool] of Object.entries(SHARED_CHARGE_CATEGORY))
      pools.set(pool, [...(pools.get(pool) ?? []), id]);
    expect(pools.size).toBeGreaterThan(30);
    const problems: string[] = [];
    let handRows = 0;
    for (const [pool, ids] of pools) {
      const unsigned = ids.filter((id) => !(id in SIGNED_POOL_DEVIATIONS));
      const merged = new Set(
        unsigned.map((id) => effectiveCooldownSeconds(id)),
      );
      if (merged.size > 1)
        problems.push(
          `pool ${pool}: ${unsigned.map((id) => `${id}=${effectiveCooldownSeconds(id)}`).join(", ")}`,
        );
      for (const id of unsigned) {
        if (!(id in SPELL_EFFECT_OVERRIDES)) continue;
        handRows++;
        const official = gen[id]?.charges?.chargeCooldownSeconds;
        if (effectiveCooldownSeconds(id) !== official)
          problems.push(
            `pool ${pool}: hand row ${id} ${spellEffectData[id]?.name} = ${effectiveCooldownSeconds(id)}, DB2 pool recovery ${official}`,
          );
      }
    }
    expect(problems).toEqual([]);
    // the check is not vacuous: hand rows do sit on pool members today
    expect(handRows).toBeGreaterThan(3);
    for (const id of Object.keys(SIGNED_POOL_DEVIATIONS))
      expect(SHARED_CHARGE_CATEGORY[id], `${id} is in no pool`).toBeDefined();
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
