import { describe, expect, it, vi } from "vitest";

import { formatMitigationAuditLine } from "../src/context/matchTimelineSections";
import {
  componentForDamage,
  componentForSchool,
  resolveMitigation,
} from "../src/data/mitigationComponents";
import { talentMitigationModifiersFor } from "../src/data/talentMitigationModifiers";
import { computeMitigationAudit } from "../src/utils/counterfactual";

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

// pipeline T33 (ruling R07 (5)): a split entry's component rows printed as
// two same-named "Mitigation audit: Evasion blocked …" rows over the same
// seconds (605: 82-1 r1, ~8k and ~41k); each now names its school
describe("a split defensive's audit rows name their school (T33)", () => {
  const rogueWith = (holds: string[]) =>
    ({
      id: "R1",
      name: "R1",
      spec: "261",
      info: { holds },
      spellCastEvents: [],
      damageIn: [
        {
          logLine: { timestamp: 54_000 },
          effectiveAmount: 40_000,
          spellSchoolId: "0x1",
        },
        {
          logLine: { timestamp: 55_000 },
          effectiveAmount: 68_000,
          spellSchoolId: "0x4",
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
    }) as never;
  const auditLines = (holds: string[]) => {
    const rogue = rogueWith(holds);
    return computeMitigationAudit(
      rogue,
      { startTime: 0, endTime: 120_000, units: { R1: rogue } },
      60,
    )
      .rows.filter((r) => r.spellId === EVASION)
      .map((r) => formatMitigationAuditLine(r));
  };
  it("with Elusiveness and Bait and Switch: a physical row and a magic row", () => {
    expect(auditLines([ELUSIVENESS, BAIT])).toEqual([
      "Mitigation audit: Evasion (physical damage) blocked ~10k over 6.0s active in the final 10s",
      "Mitigation audit: Evasion (magic damage) blocked ~32k over 6.0s active in the final 10s",
    ]);
  });
  it("one component (no Bait and Switch): one row, no label", () => {
    expect(auditLines([ELUSIVENESS])).toEqual([
      "Mitigation audit: Evasion blocked ~27k over 6.0s active in the final 10s",
    ]);
  });
});

// codex review 85-tk-C-T27-2 #3: an immunity component ranks first only when
// it covers every school of the hit (`immunityMaskStopsSchool`, the reading
// `immunityStopsSpellSchool` takes). Cloak of Shadows with Bait and Switch
// is magic immunity + physical 20: a physical + fire hit lands through the
// immunity and meets the 20.
describe("a hybrid hit into Cloak of Shadows", () => {
  const CLOAK = "31224";
  const cloak = (holds: string[]) =>
    resolveMitigation(CLOAK, { carrierIsCaster: true, caster: caster(holds) })!;

  it("with Bait and Switch: physical + fire meets physical 20, fire the immunity", () => {
    const hybrid = componentForSchool(cloak([BAIT]), 0x5);
    expect(hybrid).toMatchObject({ kind: "pct", schoolMask: 0x1, pctMin: 20 });
    expect(componentForSchool(cloak([BAIT]), 0x4)?.kind).toBe("immunity");
  });

  it("without it: the one component still prices the hit it touches, as before", () => {
    expect(componentForSchool(cloak([]), 0x5)?.kind).toBe("immunity");
  });
});

// codex review 85-tk-C-T27-2 #1: burst-into-mitigation picks a split wall's
// component from the ledger's own population — the owner's `damageOut`, pets
// merged upstream, shield-eaten rows in, deferral rows out.
describe("burstDamageBySchoolOn: the ledger's damage, by school", () => {
  it("counts every damageOut row on the target in the window, absorbs included", async () => {
    const { burstDamageBySchoolOn } = await import("../src/utils/burstLedger");
    const row = (
      t: number,
      amount: number,
      school: string,
      dest = "E1",
      event = "SPELL_DAMAGE",
    ) => ({
      destUnitId: dest,
      effectiveAmount: amount,
      spellSchoolId: school,
      logLine: { timestamp: t, event },
    });
    const hunter = {
      damageOut: [
        row(1_000, 90_000, "0x1"), // the pet's swings, merged upstream
        row(2_000, 10_000, "0x8"),
        {
          // a swing a shield ate: the spell field holds the shield caster's
          // flags, no attack spell — physical (codex 85-tk-C-T27-2b #1)
          ...row(3_000, 5_000, "0x548", "E1", "SPELL_ABSORBED"),
          logLine: {
            timestamp: 3_000,
            event: "SPELL_ABSORBED",
            parameters: [],
          },
        },
        row(4_000, 70_000, "0x8", "E2"), // another target
        row(9_000, 80_000, "0x8"), // after the window
      ],
    } as never;
    expect(burstDamageBySchoolOn(hunter, "E1", 0, 5_000, true)).toEqual({
      "1": 95_000,
      "8": 10_000,
    });
  });

  it("a mostly-physical burst into a split Evasion meets its 20, not 32", () => {
    const res = resolveMitigation(EVASION, {
      carrierIsCaster: true,
      caster: caster([ELUSIVENESS, BAIT]),
    })!;
    expect(componentForDamage(res, { "1": 95_000, "8": 10_000 })?.pctMin).toBe(
      20,
    );
  });
});

// codex review 85-tk-C-T27-2b #1: an absorbed swing's school is the absorbed
// hit's (`absorbedHitSchoolMask`), not the row's spell field; an absorb of
// unknown school is left out.
describe("burstDamageBySchoolOn: absorbed hits", () => {
  it("an absorbed swing is physical; with no record of attack spells, unknown and left out", async () => {
    const { burstDamageBySchoolOn } = await import("../src/utils/burstLedger");
    const p = {
      damageOut: [
        {
          destUnitId: "E1",
          effectiveAmount: 90_000,
          spellSchoolId: "0x548",
          logLine: {
            timestamp: 1_000,
            event: "SPELL_ABSORBED",
            parameters: [],
          },
        },
        {
          destUnitId: "E1",
          effectiveAmount: 10_000,
          spellSchoolId: "0x4",
          logLine: { timestamp: 2_000, event: "SPELL_DAMAGE" },
        },
      ],
    } as never;
    expect(burstDamageBySchoolOn(p, "E1", 0, 5_000, true)).toEqual({
      "1": 90_000,
      "4": 10_000,
    });
    expect(burstDamageBySchoolOn(p, "E1", 0, 5_000, false)).toEqual({
      "4": 10_000,
    });
  });
});
