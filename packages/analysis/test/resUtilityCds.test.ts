/**
 * Reliability leftovers batch 14 (user ruling 2026-09-26): the owner's kick
 * and Death Grip on [RES].
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ownerResUtilityCds } from "../src/context/resUtilityCds";
import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const success = (spellId: string, tS: number) => ({
  spellId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + tS * 1000 },
});
const unit = (
  classId: number,
  spec: CombatUnitSpec,
  over: Record<string, unknown> = {},
): any => ({
  id: "Player-O",
  name: "Me-R-US",
  class: classId,
  spec,
  info: undefined,
  spellCastEvents: [],
  petSpellCastEvents: [],
  ...over,
});

describe("ownerResUtilityCds", () => {
  it("a Frost Mage's Counterspell (class baseline) is listed, cast or not", () => {
    const cds = ownerResUtilityCds(unit(8, CombatUnitSpec.Mage_Frost), T0);
    expect(cds.map((c) => c.spellName)).toEqual(["Counterspell"]);
    expect(cds[0]!.cooldownSeconds).toBe(24);
  });
  it("a warlock's Felhunter Spell Lock only once the pet was seen casting it", () => {
    expect(
      ownerResUtilityCds(unit(9, CombatUnitSpec.Warlock_Affliction), T0),
    ).toHaveLength(0);
    const cds = ownerResUtilityCds(
      unit(9, CombatUnitSpec.Warlock_Affliction, {
        petSpellCastEvents: [success("19647", 107.558)],
      }),
      T0,
    );
    expect(cds.map((c) => c.spellName)).toEqual(["Spell Lock"]);
    expect(cds[0]!.casts).toEqual([{ timeSeconds: 107.558 }]);
  });
  it("a Preservation Evoker has no interrupt (Quell is a Devastation / Augmentation talent)", () => {
    expect(
      ownerResUtilityCds(unit(13, CombatUnitSpec.Evoker_Preservation), T0),
    ).toHaveLength(0);
  });
  it("a Death Knight gets Death Grip beside its kick", () => {
    const names = ownerResUtilityCds(
      unit(6, CombatUnitSpec.DeathKnight_Unholy, { info: { talents: [] } }),
      T0,
    ).map((c) => c.spellName);
    expect(names).toContain("Death Grip");
  });
  it("[RES] shows the kick ready, then on cooldown after a press", () => {
    const owner = unit(8, CombatUnitSpec.Mage_Frost, {
      spellCastEvents: [success("2139", 20)],
    });
    const cds = ownerResUtilityCds(owner, T0);
    const base = {
      ownerName: owner.name,
      ownerSpec: "Frost Mage",
      teammateCDs: [],
      ccTrinketSummaries: [],
      enemyCDTimeline: { alignedBurstWindows: [], enemyCDs: [], players: [] } as any,
    };
    expect(
      buildResourceSnapshot({ ...base, timeSeconds: 15, ownerCDs: cds }),
    ).toContain("rdy:Counterspell");
    expect(
      buildResourceSnapshot({ ...base, timeSeconds: 30, ownerCDs: cds }),
    ).toContain("Counterspell(");
  });
});
