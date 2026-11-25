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
  burstDamageBySchoolOn,
  roundDamageEvidenceOf,
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
  it("a percentage priced 0 for this application reaches nothing; Evasion still reaches a physical hit (codex 85-tk-L2-T166-1c #3)", () => {
    // Evasion and Feint of a caster without Elusiveness: 0 %
    expect(res("5277")!.components.map((c) => c.pctMax)).toEqual([0]);
    expect(wallTouchesNoneOf(res("5277"), { "36": 67_699 })).toBe(true);
    expect(wallTouchesNoneOf(res("5277"), { "1": 1, "36": 67_699 })).toBe(
      false,
    );
    expect(wallTouchesNoneOf(res("1966"), { "1": 50_000 })).toBe(true);
    // with the talent's 20 %: any school
    const talented = {
      ...res("5277")!,
      components: [
        { kind: "pct" as const, schoolMask: 0x7f, pctMin: 20, pctMax: 20 },
      ],
    };
    expect(wallTouchesNoneOf(talented, { "36": 67_699 })).toBe(false);
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
  const refused = (
    id: string,
    m: ReturnType<typeof miss>,
    // what the round shows of the spell; "none" = nothing (undefined)
    shows: boolean | "none" = true,
  ) =>
    wallRefusedAttackOf(
      res(id),
      [{ missesOut: [m] } as never],
      "e1",
      at(11),
      at(19),
      () => (shows === "none" ? undefined : shows),
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
    // a control: no damage row in the round, none in its DB2 profile
    expect(
      refused(
        CLOAK,
        miss(LogEvent.SPELL_MISSED, "IMMUNE", "118", "0x40"),
        false,
      ),
    ).toBe(false);
    // a spell the round shows nothing of: its DB2 profile says it deals
    // damage (Shattering Throw, codex 85-tk-L2-T166-1c #1)
    expect(
      refused(
        BOP,
        miss(LogEvent.SPELL_MISSED, "IMMUNE", "394352", "0x1"),
        "none",
      ),
    ).toBe(true);
    // one the round shows landing and dealing nothing is a control,
    // whatever its profile (Entangling Roots, codex 85-tk-L2-T166-1e #2)
    expect(
      refused(
        CLOAK,
        miss(LogEvent.SPELL_MISSED, "IMMUNE", "339", "0x8"),
        false,
      ),
    ).toBe(false);
    // Anti-Magic Zone is a percentage: it refuses nothing
    expect(
      refused("145629", miss(LogEvent.SPELL_MISSED, "IMMUNE", "133", "0x4")),
    ).toBe(false);
  });
});

describe("what the round shows of a spell, and Evasion's dodge (codex 85-tk-L2-T166-1e)", () => {
  it("a damage row (a shield-eaten one by its attack), a control with none, neither", () => {
    const row = (event: LogEvent, spellId: string, attackSpellId?: string) => ({
      logLine: { event, timestamp: at(5), parameters: [] },
      spellId,
      ...(attackSpellId ? { attackSpellId } : {}),
    });
    const src = makeUnit("p1", {
      name: "Druid",
      damageOut: [
        row(LogEvent.SPELL_DAMAGE, "8921"),
        // Power Word: Shield ate a hit of 1287663
        row(LogEvent.SPELL_ABSORBED, "17", "1287663"),
      ] as never,
    });
    const shows = roundDamageEvidenceOf([src]);
    expect(shows("8921")).toBe(true);
    expect(shows("1287663")).toBe(true);
    expect(shows("17")).toBeUndefined();
    // Entangling Roots, Hammer of Justice: controls with no damage row
    expect(shows("339")).toBe(false);
    expect(shows("853")).toBe(false);
    // Shattering Throw, Execution Sentence: the profile's to say
    expect(shows("394352")).toBeUndefined();
    expect(shows("343527")).toBeUndefined();
  });
  it("a swing Evasion made the target dodge is its refusal; another wall's is not", () => {
    const dodge = {
      logLine: {
        event: LogEvent.SWING_MISSED,
        timestamp: at(14),
        parameters: [],
      },
      destUnitId: "e1",
      missType: "DODGE",
    };
    const refusedBy = (id: string) =>
      wallRefusedAttackOf(
        res(id),
        [{ missesOut: [dodge] } as never],
        "e1",
        at(11),
        at(19),
        () => true,
      );
    expect(refusedBy("5277")).toBe(true);
    expect(refusedBy(BOP)).toBe(false);
    expect(refusedBy("1966")).toBe(false);
    // a dodged control is no attack refused (codex 85-tk-L2-T166-1f #3)
    const bash = {
      logLine: {
        event: LogEvent.SPELL_MISSED,
        timestamp: at(14),
        parameters: [],
      },
      destUnitId: "e1",
      spellId: "5211",
      missType: "DODGE",
    };
    expect(
      wallRefusedAttackOf(
        res("5277"),
        [{ missesOut: [bash] } as never],
        "e1",
        at(11),
        at(19),
        roundDamageEvidenceOf([]),
      ),
    ).toBe(false);
  });
});

describe("a row of the wall's closing millisecond logged after its close met no wall (codex 85-tk-L2-T166-1c #2)", () => {
  const row = (lineIndex: number, school: string) => ({
    logLine: {
      event: LogEvent.SPELL_DAMAGE,
      timestamp: at(19),
      lineIndex,
      parameters: [],
    },
    timestamp: at(19),
    effectiveAmount: -7_714,
    amount: -7_714,
    destUnitId: "e1",
    spellId: "1",
    spellSchoolId: school,
  });
  const holder = makeUnit("p1", {
    name: "Hunter",
    damageOut: [row(22, "0x1"), row(24, "0x4")] as never,
  });
  const close = { ms: at(19), lineIndex: 23 };
  it("the damage reader leaves the later row out", () => {
    expect(burstDamageBySchoolOn(holder, "e1", at(11), at(19), true)).toEqual({
      "1": 7_714,
      "4": 7_714,
    });
    expect(
      burstDamageBySchoolOn(holder, "e1", at(11), at(19), true, close),
    ).toEqual({ "1": 7_714 });
  });
  it("and so does the refusal reader", () => {
    const m = (lineIndex: number) => ({
      logLine: {
        event: LogEvent.SWING_MISSED,
        timestamp: at(19),
        lineIndex,
        parameters: [],
      },
      destUnitId: "e1",
      missType: "IMMUNE",
    });
    const refusedAt = (lineIndex: number) =>
      wallRefusedAttackOf(
        res(BOP),
        [{ missesOut: [m(lineIndex)] } as never],
        "e1",
        at(11),
        at(19),
        () => true,
        close,
      );
    expect(refusedAt(22)).toBe(true);
    expect(refusedAt(24)).toBe(false);
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
    wall: { id: string; name: string } = {
      id: BOP,
      name: "Blessing of Protection",
    },
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
      ...makeAuraEvent(event, wall.id, at(s), "e3", "e1", "BUFF"),
      srcUnitName: "Holy",
      spellName: wall.name,
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
  it("Peaceweaver (no table row, a magic immunity) joins the test — ruling R116", () => {
    const pw = { id: "353319", name: "Peaceweaver" };
    // physical only under it: not the burst's
    expect(held(["0x1", "0x1"], undefined, undefined, pw)).toEqual([]);
    // magic under it: held
    expect(held(["0x1", "0x10"], undefined, undefined, pw)).toEqual([pw.id]);
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
