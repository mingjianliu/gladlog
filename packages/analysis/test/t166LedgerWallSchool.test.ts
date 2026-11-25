// Pipeline T166, user ruling R102 (2026-11-20, "挡不到就不印"): the burst
// ledger does not hold a school-limited wall whose school touches none of
// the holder's damage in the stretch of the burst it covered.
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { resolveMitigation } from "../src/data/mitigationComponents";
import {
  analyzeBurstLedger,
  wallRefusedAttackOf,
  wallTouchesNoneOf,
} from "../src/utils/burstLedger";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T = 1_000_000;
const at = (s: number) => T + s * 1000;
const BOP = "1022";
const CLOAK = "31224";
const AMS = "48707";
const IRONBARK = "102342";
// talents known and empty: an application resolves with no talent component
const info = {
  teamId: "0",
  specId: "x",
  talents: [],
  pvpTalents: [],
} as unknown as NonNullable<Parameters<typeof makeUnit>[1]>["info"];
type Combat = Parameters<typeof analyzeBurstLedger>[3];

beforeAll(async () => {
  await ensureAnalysisData();
});

// the wall as an untalented caster's own application resolves
// (a caster whose tree has none of the walls' talents: ownership "no", so
// the application resolves to the table row alone)
const plain = makeUnit("c0", {
  name: "Caster",
  spec: CombatUnitSpec.Mage_Frost,
  info,
});
const res = (id: string) =>
  resolveMitigation(id, { carrierIsCaster: true, caster: plain });

describe("wallTouchesNoneOf (R102)", () => {
  it("a school-limited wall that met damage in none of its schools", () => {
    // Blessing of Protection (physical) over frost 0x10 and arcane 0x40
    expect(wallTouchesNoneOf(res(BOP), { "16": 300_000, "64": 148_000 })).toBe(
      true,
    );
    // Cloak of Shadows (magic) over physical
    expect(wallTouchesNoneOf(res(CLOAK), { "1": 709_000 })).toBe(true);
  });
  it("any part in a covered school keeps the wall", () => {
    expect(wallTouchesNoneOf(res(BOP), { "1": 1, "16": 300_000 })).toBe(false);
    expect(wallTouchesNoneOf(res(CLOAK), { "1": 9, "4": 10_000 })).toBe(false);
  });
  it("an immunity reaches a hit only when it covers every school of it (codex 85-tk-L2-T166-1b #5)", () => {
    // physical+fire lands through Cloak's magic immunity
    expect(wallTouchesNoneOf(res(CLOAK), { "5": 10_000 })).toBe(true);
  });
  it("a component the application resolved keeps the wall (codex 85-tk-L2-T166-1b #3)", () => {
    const talented = {
      ...res(CLOAK)!,
      components: [
        ...res(CLOAK)!.components,
        { kind: "pct" as const, schoolMask: 0x1, pctMin: 20, pctMax: 20 },
      ],
    };
    expect(wallTouchesNoneOf(talented, { "1": 12_429 })).toBe(false);
    // talents that could not be settled: no claim
    expect(
      wallTouchesNoneOf(
        { ...res(CLOAK)!, unresolved: ["caster unknown"] },
        { "1": 12_429 },
      ),
    ).toBe(false);
  });
  it("no claim: an all-school wall, a wall with no table row (an absorb), no damage, an unknown school", () => {
    expect(wallTouchesNoneOf(res(IRONBARK), { "1": 100_000 })).toBe(false);
    expect(wallTouchesNoneOf(res(AMS), { "1": 100_000 })).toBe(false);
    expect(wallTouchesNoneOf(res(BOP), {})).toBe(false);
    expect(wallTouchesNoneOf(res(BOP), { "0": 100_000 })).toBe(false);
  });
});

describe("wallRefusedAttackOf (R102)", () => {
  const miss = (
    event: LogEvent,
    missType: string,
    spellId: string,
    school?: string,
  ) => ({
    logLine: { event, timestamp: at(14), parameters: [] },
    timestamp: at(14),
    destUnitId: "e1",
    spellId,
    missType,
    ...(school ? { spellSchoolId: school } : {}),
  });
  const refused = (id: string, m: ReturnType<typeof miss>, damaging = true) =>
    wallRefusedAttackOf(
      res(id),
      [{ missesOut: [m] } as never],
      "e1",
      at(11),
      at(19),
      () => damaging,
    );
  it("a swing or a damaging spell the immunity covers, IMMUNE", () => {
    expect(refused(BOP, miss(LogEvent.SWING_MISSED, "IMMUNE", "0"))).toBe(true);
    expect(
      refused(CLOAK, miss(LogEvent.SPELL_MISSED, "IMMUNE", "133", "0x4")),
    ).toBe(true);
  });
  it("a spell's MISS under Cloak counts, a swing's MISS never (codex 85-tk-L2-T166-1b #2)", () => {
    expect(
      refused(CLOAK, miss(LogEvent.SPELL_MISSED, "MISS", "133", "0x4")),
    ).toBe(true);
    expect(refused(BOP, miss(LogEvent.SWING_MISSED, "MISS", "0"))).toBe(false);
  });
  it("an IMMUNE the wall's schools do not cover, a control, a percentage wall (codex 85-tk-L2-T166-1b #1)", () => {
    // a physical stun IMMUNE under Cloak of Shadows
    expect(
      refused(CLOAK, miss(LogEvent.SPELL_MISSED, "IMMUNE", "46968", "0x1")),
    ).toBe(false);
    // a spell with no damage row in the round
    expect(
      refused(
        CLOAK,
        miss(LogEvent.SPELL_MISSED, "IMMUNE", "853", "0x2"),
        false,
      ),
    ).toBe(false);
    // Anti-Magic Zone is a percentage: it refuses nothing
    expect(
      refused("145629", miss(LogEvent.SPELL_MISSED, "IMMUNE", "133", "0x4")),
    ).toBe(false);
  });
});

describe("analyzeBurstLedger — a wall that touches none of the burst's damage is not held (R102)", () => {
  const dmg = (s: number, school: string) => ({
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: at(s), parameters: [] },
    timestamp: at(s),
    effectiveAmount: -50_000,
    amount: -50_000,
    srcUnitId: "p1",
    srcUnitName: "Mage",
    destUnitId: "e1",
    destUnitName: "Pala",
    spellId: "1",
    spellName: "TestSpell",
    spellSchoolId: school,
  });
  const held = (
    schools: string[],
    immuneAtS?: number,
    petImmuneAtS?: number,
  ) => {
    const mage = makeUnit("p1", {
      name: "Mage",
      spec: CombatUnitSpec.Paladin_Retribution,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          at(10),
          "p1",
          "S",
          "p1",
          "Mage",
          0,
          "Avenging Wrath",
        ),
      ],
      damageOut: schools.map((s, i) => dmg(12 + i * 3, s)),
    });
    // `makeUnit` takes no misses: set on the built unit
    (mage as unknown as { missesOut: unknown[] }).missesOut =
      immuneAtS === undefined
        ? []
        : [
            {
              logLine: {
                event: LogEvent.SWING_MISSED,
                timestamp: at(immuneAtS),
                parameters: [],
              },
              timestamp: at(immuneAtS),
              srcUnitId: "p1",
              destUnitId: "e1",
              missType: "IMMUNE",
            },
          ];
    const bop = (event: LogEvent, s: number) => ({
      ...makeAuraEvent(event, BOP, at(s), "e3", "e1", "BUFF"),
      srcUnitName: "Holy",
      spellName: "Blessing of Protection",
    });
    const tgt = makeUnit("e1", {
      name: "Pala",
      spec: CombatUnitSpec.Paladin_Retribution,
      reaction: CombatUnitReaction.Hostile,
      info,
      auraEvents: [
        bop(LogEvent.SPELL_AURA_APPLIED, 11),
        bop(LogEvent.SPELL_AURA_REMOVED, 19),
      ],
    });
    const pal = makeUnit("e3", {
      name: "Holy",
      // not a paladin: Echoing Blessings' magic 15 % is out of its tree, so
      // the blessing resolves to its physical immunity alone
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
      info,
    });
    // a pet's refused attack is on the pet, never on its owner
    const pet = makeUnit("pet1", { name: "Pet", ownerId: "p1" });
    (pet as unknown as { missesOut: unknown[] }).missesOut =
      petImmuneAtS === undefined
        ? []
        : [
            {
              logLine: {
                event: LogEvent.SWING_MISSED,
                timestamp: at(petImmuneAtS),
                parameters: [],
              },
              timestamp: at(petImmuneAtS),
              srcUnitId: "pet1",
              destUnitId: "e1",
              missType: "IMMUNE",
            },
          ];
    const combat = {
      startTime: T,
      endTime: at(120),
      units: Object.fromEntries([mage, tgt, pal, pet].map((u) => [u.id, u])),
    } as unknown as Combat;
    return (
      analyzeBurstLedger(mage, [], [tgt, pal], combat)[0]!.dominantTarget
        ?.defensivesHit ?? []
    ).map((d) => d.spellId);
  };
  it("frost and arcane into Blessing of Protection: not held", () => {
    expect(held(["0x10", "0x40"])).toEqual([]);
  });
  it("a swing it refused (IMMUNE) under it: held, though only magic landed", () => {
    expect(held(["0x10", "0x40"], 14)).toEqual([BOP]);
    // refused after the wall fell: not this wall's
    expect(held(["0x10", "0x40"], 25)).toEqual([]);
  });
  it("its pet's swing refused under it: held (codex 85-tk-L2-T166-1 #1)", () => {
    expect(held(["0x10", "0x40"], undefined, 14)).toEqual([BOP]);
    expect(held(["0x10", "0x40"], undefined, 25)).toEqual([]);
  });
  it("one physical hit under it: held", () => {
    expect(held(["0x10", "0x1"])).toEqual([BOP]);
  });
  it("magic only after the wall fell, physical under it: held; magic under it, physical after: not", () => {
    // hits at 12 s, 15 s (under the wall, 11–19 s) and 21 s
    expect(held(["0x1", "0x1", "0x10"])).toEqual([BOP]);
    expect(held(["0x10", "0x10", "0x10", "0x1"])).toEqual([]);
  });
});
