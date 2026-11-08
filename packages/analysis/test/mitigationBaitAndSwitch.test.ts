import { describe, expect, it, vi } from "vitest";

import {
  componentForDamage,
  componentForSchool,
  resolveMitigation,
} from "../src/data/mitigationComponents";
import { computeMitigationAudit } from "../src/utils/counterfactual";
import { talentMitigationModifiersFor } from "../src/data/talentMitigationModifiers";

// GH #126 row 234 (2026-11-08): Bait and Switch 457034 fills Evasion's magic
// aura 87 slot (effect #2), not Elusiveness's (effect #1), so the game
// multiplies them: Elusiveness holders with it read 0.680 on magic (605,
// 33 units), not the 0.65 two added rows would give.
vi.mock("../src/utils/talentOwnership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/talentOwnership")>()),
  talentModifierOwnershipOf: (
    unit: { info: { holds: string[] } },
    talentSpellId: string,
  ) => (unit.info.holds.includes(talentSpellId) ? "yes" : "no"),
}));

const EVASION = "5277";
const ELUSIVENESS = "79008";
const BAIT = "457034";
const PHYSICAL = 0x1;
const MAGIC = 0x7e;
const caster = (holds: string[]) =>
  ({ spec: "261", info: { holds }, spellCastEvents: [] }) as never;
/** [schoolMask, pctMin, pctMax] of every percentage component, by mask */
const comps = (holds: string[] | undefined) =>
  resolveMitigation(EVASION, {
    carrierIsCaster: true,
    ...(holds ? { caster: caster(holds) } : {}),
  })!
    .components.filter((c) => c.kind === "pct")
    .map((c) => [c.schoolMask, c.pctMin, c.pctMax])
    .sort((a, b) => a[0]! - b[0]!);

describe("Bait and Switch on Evasion is its own magic slot", () => {
  it("the row is the DB2 leg: magic 15, its own effect slot", () => {
    expect(talentMitigationModifiersFor(EVASION)).toEqual([
      expect.objectContaining({
        talentSpellId: BAIT,
        schoolMask: MAGIC,
        modPct: 15,
        ownEffectSlot: true,
      }),
    ]);
  });

  it("with Elusiveness: physical 20, magic 32 (1 − 0.80 × 0.85)", () => {
    expect(comps([ELUSIVENESS, BAIT])).toEqual([
      [PHYSICAL, 20, 20],
      [MAGIC, 32, 32],
    ]);
  });

  it("without Elusiveness: physical 0, magic 15", () => {
    expect(comps([BAIT])).toEqual([
      [PHYSICAL, 0, 0],
      [MAGIC, 15, 15],
    ]);
  });

  it("without Bait and Switch: one 20 % component on every school", () => {
    expect(comps([ELUSIVENESS])).toEqual([[0x7f, 20, 20]]);
  });

  it("caster unknown: 0 as the claim, 20 / 32 as the ceiling", () => {
    expect(comps(undefined)).toEqual([
      [PHYSICAL, 0, 20],
      [MAGIC, 0, 32],
    ]);
  });
});

// codex review of batch B7 (T27 attempt 2): the split components both touch a
// hybrid hit (Tremor, physical + fire, 0x5); each hit is priced once, by the
// component the game applies to it — magic 32, which already holds
// Elusiveness's 20.
describe("a split Evasion prices each hit once", () => {
  const res = () =>
    resolveMitigation(EVASION, {
      carrierIsCaster: true,
      caster: caster([ELUSIVENESS, BAIT]),
    })!;

  it("componentForSchool: physical 20, fire 32, physical + fire 32", () => {
    expect(componentForSchool(res(), 0x1)?.pctMin).toBe(20);
    expect(componentForSchool(res(), 0x4)?.pctMin).toBe(32);
    expect(componentForSchool(res(), 0x5)?.pctMin).toBe(32);
  });

  it("componentForDamage: the component that priced most of it", () => {
    expect(componentForDamage(res(), { "1": 100_000 })?.pctMin).toBe(20);
    expect(
      componentForDamage(res(), { "1": 10_000, "127": 90_000 })?.pctMin,
    ).toBe(32);
    expect(componentForDamage(res(), {})).toBeUndefined();
  });

  it("the death audit: a 68,000 hybrid hit is 32,000 blocked, not 17,000 + 32,000", () => {
    const rogue = {
      id: "R1",
      name: "R1",
      spec: "261",
      info: { holds: [ELUSIVENESS, BAIT] },
      spellCastEvents: [],
      damageIn: [
        {
          logLine: { timestamp: 55_000 },
          effectiveAmount: 68_000,
          spellSchoolId: "0x5",
        },
      ],
      auraEvents: (["SPELL_AURA_APPLIED", "SPELL_AURA_REMOVED"] as const).map(
        (event, i) => ({
          spellId: EVASION,
          spellName: "Evasion",
          destUnitId: "R1",
          srcUnitId: "R1",
          srcUnitName: "R1",
          timestamp: (i ? 58 : 52) * 1000,
          logLine: { event, timestamp: (i ? 58 : 52) * 1000 },
        }),
      ),
      advancedActions: [],
    } as never;
    const { rows } = computeMitigationAudit(
      rogue,
      { startTime: 0, endTime: 120_000, units: { R1: rogue } },
      60,
    );
    const blocked = rows
      .filter((r) => r.spellId === EVASION && r.kind === "arith")
      .map((r) => r.blockedAmount);
    expect(blocked.reduce((a, b) => a! + b!, 0)).toBe(32_000);
    expect(blocked).not.toContain(17_000);
  });
});
