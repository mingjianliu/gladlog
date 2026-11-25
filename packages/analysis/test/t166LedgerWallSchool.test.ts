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
import {
  analyzeBurstLedger,
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
const info = { teamId: "0", specId: "x" } as unknown as NonNullable<
  Parameters<typeof makeUnit>[1]
>["info"];
type Combat = Parameters<typeof analyzeBurstLedger>[3];

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("wallTouchesNoneOf (R102)", () => {
  it("a school-limited wall that met damage in none of its schools", () => {
    // Blessing of Protection (physical) over frost 0x10 and arcane 0x40
    expect(wallTouchesNoneOf(BOP, { "16": 300_000, "64": 148_000 })).toBe(true);
    // Cloak of Shadows (magic) over physical
    expect(wallTouchesNoneOf(CLOAK, { "1": 709_000 })).toBe(true);
  });
  it("any part in a covered school keeps the wall", () => {
    expect(wallTouchesNoneOf(BOP, { "1": 1, "16": 300_000 })).toBe(false);
    // a multi-school hit that includes a covered school touches it
    expect(wallTouchesNoneOf(CLOAK, { "5": 10_000 })).toBe(false);
  });
  it("no claim: an all-school wall, a wall with no table row (an absorb), no damage, an unknown school", () => {
    expect(wallTouchesNoneOf(IRONBARK, { "1": 100_000 })).toBe(false);
    expect(wallTouchesNoneOf(AMS, { "1": 100_000 })).toBe(false);
    expect(wallTouchesNoneOf(BOP, {})).toBe(false);
    expect(wallTouchesNoneOf(BOP, { "0": 100_000 })).toBe(false);
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
      spec: CombatUnitSpec.Paladin_Holy,
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
