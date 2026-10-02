import { parseLine } from "../src/l1/parseLine";
import { buildRoster } from "../src/l3/roster";
import { collectEvents } from "../src/l3/collect";
import type { ParsedLine } from "../src/l1/types";

const TZ = { timezone: "UTC" } as const;
const L = (s: string, i = 0) =>
  parseLine(`6/30/2026 12:00:${String(i).padStart(2, "0")}.000  ${s}`, TZ)!;

// A (owner, friendly) hits B (hostile); B buffs itself; A's pet P claws B; B
// goes unconscious and then really dies; A heals itself
const records: ParsedLine[] = [
  L(
    'SPELL_DAMAGE,Player-1-A,"Alice-X",0x511,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,50622,"Bladestorm",0x1,Player-2-B,0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,100,120,-1,1,0,0,0,nil,nil,nil',
    1,
  ),
  L(
    'SPELL_AURA_APPLIED,Player-2-B,"Bob-Y",0x548,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,386208,"Defensive Stance",0x1,BUFF',
    2,
  ),
  L(
    'SPELL_CAST_SUCCESS,Pet-0-1-1-1-165189-01P,"Kitty",0x1112,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,16827,"Claw",0x1,Pet-0-1-1-1-165189-01P,Player-1-A,500,500,0,0,0,0,0,0,3,10,10,0,1.0,-1.0,0,1.0,70',
    3,
  ),
  L(
    'SPELL_HEAL,Player-1-A,"Alice-X",0x511,0x80000000,Player-1-A,"Alice-X",0x511,0x80000000,2061,"Flash Heal",0x2,Player-1-A,0000000000000000,1000,1000,0,0,0,0,0,0,0,50,50,0,1.0,-1.0,0,1.0,70,200,200,50,0,nil',
    4,
  ),
  L(
    'SPELL_CAST_START,Player-2-B,"Bob-Y",0x548,0x80000000,0000000000000000,nil,0x80000000,0x80000000,30451,"Arcane Blast",64',
    4,
  ),
  L(
    'SPELL_INTERRUPT,Player-1-A,"Alice-X",0x511,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,6552,"Pummel",0x1,30451,"Arcane Blast",64',
    5,
  ),
  L(
    'UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,1',
    6,
  ),
  L(
    'UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,0',
    7,
  ),
];

describe("collectEvents", () => {
  const roster = buildRoster(records);
  const units = collectEvents(records, roster);
  const A = units.get("Player-1-A")!;
  const B = units.get("Player-2-B")!;
  const P = units.get("Pet-0-1-1-1-165189-01P")!;

  it("damage: out for A, in for B, effectiveAmount passed through", () => {
    expect(A.damageOut).toHaveLength(1);
    expect(B.damageIn).toHaveLength(1);
    expect(A.damageOut[0]!.effectiveAmount).toBe(100);
    expect(A.damageOut[0]!.spellId).toBe(50622);
    expect(B.damageOut).toHaveLength(0);
  });

  it("heal: self-heal lands in healOut and healIn of A, overheal deducted", () => {
    expect(A.healOut).toHaveLength(1);
    expect(A.healIn).toHaveLength(1);
    expect(A.healOut[0]!.effectiveAmount).toBe(150); // 200 - 50 overheal
  });

  it("aura event recorded on the target unit", () => {
    expect(B.auraEvents).toHaveLength(1);
    expect(B.auraEvents[0]!.auraType).toBe("BUFF");
    expect(B.auraEvents[0]!.spellId).toBe(386208);
  });

  it("castStarts: SPELL_CAST_START 挂到 src 单位(读条开始)", () => {
    expect(B.castStarts).toHaveLength(1);
    expect(B.castStarts[0]!.spellId).toBe(30451);
    expect(B.castStarts[0]!.spellName).toBe("Arcane Blast");
    expect(A.castStarts).toHaveLength(0);
  });

  it("casts: pet cast goes to pet.casts AND owner's petCasts", () => {
    expect(P.casts).toHaveLength(1);
    expect(A.petCasts).toHaveLength(1);
    expect(A.petCasts[0]!.spellId).toBe(16827);
    expect(A.casts).toHaveLength(0); // A itself has no SPELL_CAST_SUCCESS
  });

  it("interrupt: actionsOut for A with extra spell info retained in eventName scan", () => {
    expect(
      A.actionsOut.filter((x) => x.eventName === "SPELL_INTERRUPT"),
    ).toHaveLength(1);
  });

  it("deaths vs unconscious separated", () => {
    expect(B.unconsciousEvents).toHaveLength(1);
    expect(B.deaths).toHaveLength(1);
    expect(B.deaths[0]!.unconscious).toBe(false);
    expect(B.deaths[0]!.timestamp).toBe(Date.UTC(2026, 5, 30, 12, 0, 7));
  });

  it("advanced samples: actor hp/xy captured per advanced payload", () => {
    // The advanced actor on the damage line is B (900/1000 when hit); on the
    // heal line the actor is A
    expect(
      B.advancedSamples.some((s) => s.hp === 900 && s.maxHp === 1000),
    ).toBe(true);
    expect(A.advancedSamples.some((s) => s.hp === 1000)).toBe(true);
  });

  it("actionsIn mirrors actionsOut for spell events targeting the unit", () => {
    expect(
      B.actionsIn.filter((x) => x.eventName === "SPELL_DAMAGE"),
    ).toHaveLength(1);
  });

  it("SWING dedup: SWING_DAMAGE is collected in damage arrays, SWING_DAMAGE_LANDED is not, but both are in actions", () => {
    const swingRecords = [
      L(
        'SWING_DAMAGE,Player-1-A,"Alice-X",0x511,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,Player-2-B,0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,77,90,-1,1,0,0,0,nil,nil,nil',
        8,
      ),
      L(
        'SWING_DAMAGE_LANDED,Player-1-A,"Alice-X",0x511,0x80000000,Player-2-B,"Bob-Y",0x548,0x80000000,Player-2-B,0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70,77,90,-1,1,0,0,0,nil,nil,nil',
        9,
      ),
    ];
    const swingRoster = buildRoster(swingRecords);
    const swingUnits = collectEvents(swingRecords, swingRoster);
    const swingA = swingUnits.get("Player-1-A")!;
    const swingB = swingUnits.get("Player-2-B")!;

    expect(swingA.damageOut).toHaveLength(1);
    expect(swingA.damageOut[0]!.eventName).toBe("SWING_DAMAGE");

    expect(swingB.damageIn).toHaveLength(1);
    expect(swingB.damageIn[0]!.eventName).toBe("SWING_DAMAGE");

    expect(
      swingA.actionsOut.filter((x) => x.eventName === "SWING_DAMAGE"),
    ).toHaveLength(1);
    expect(
      swingA.actionsOut.filter((x) => x.eventName === "SWING_DAMAGE_LANDED"),
    ).toHaveLength(1);
    expect(
      swingB.actionsIn.filter((x) => x.eventName === "SWING_DAMAGE"),
    ).toHaveLength(1);
    expect(
      swingB.actionsIn.filter((x) => x.eventName === "SWING_DAMAGE_LANDED"),
    ).toHaveLength(1);
  });
});

describe("collectEvents: empowered casts (start / release / interrupt)", () => {
  const EMP = (ev: string, i: number, tail = "") =>
    L(
      `${ev},Player-1-A,"Alice-X",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,355936,"Dream Breath",0x8${tail}`,
      i,
    );
  const empRecords: ParsedLine[] = [
    // A real line for the roster (an empower names no dest unit).
    records[0]!,
    EMP("SPELL_EMPOWER_START", 10),
    EMP("SPELL_EMPOWER_INTERRUPT", 11, ",1"),
    EMP("SPELL_EMPOWER_START", 20),
    EMP("SPELL_EMPOWER_END", 23, ",3"),
  ];
  const a = collectEvents(empRecords, buildRoster(empRecords)).get(
    "Player-1-A",
  )!;

  it("keeps every START on the caster", () => {
    expect(a.empowerStarts!.map((e) => e.eventName)).toEqual([
      "SPELL_EMPOWER_START",
      "SPELL_EMPOWER_START",
    ]);
    expect(a.empowerStarts![0]!.spellId).toBe(355936);
  });

  it("an INTERRUPT goes to empowerInterrupts with the level reached, never to empowerEnds", () => {
    expect(a.empowerInterrupts).toHaveLength(1);
    expect(a.empowerInterrupts![0]!.level).toBe(1);
    expect(a.empowerInterrupts![0]!.eventName).toBe("SPELL_EMPOWER_INTERRUPT");
    expect(a.empowerEnds).toHaveLength(1);
    expect(a.empowerEnds[0]!.level).toBe(3);
  });
});
