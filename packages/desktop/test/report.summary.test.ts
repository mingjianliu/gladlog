import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadMatchFixture } from "./fixtures/loadFixture";

function hp(effective: number): {
  timestamp: number;
  eventName: string;
  spellId: number;
  spellName: string;
  srcId: string;
  srcName: string;
  destId: string;
  destName: string;
  params: string[];
  amount: number;
  effectiveAmount: number;
} {
  return {
    timestamp: 1000,
    eventName: "SPELL_DAMAGE",
    spellId: 1,
    spellName: "X",
    srcId: "s",
    srcName: "S",
    destId: "d",
    destName: "D",
    params: [],
    amount: effective,
    effectiveAmount: effective,
  };
}
const emptyUnit = {
  ownerId: undefined,
  reaction: "Hostile" as const,
  damageOut: [],
  damageIn: [],
  healOut: [],
  healIn: [],
  absorbsOut: [],
  absorbsIn: [],
  casts: [],
  petCasts: [],
  auraEvents: [],
  actionsOut: [],
  actionsIn: [],
  deaths: [],
  unconsciousEvents: [],
  advancedSamples: [],
};
function synthetic(): ReportSource {
  return {
    kind: "match",
    id: "syn",
    bracket: "2v2",
    zoneId: "1",
    isRated: true,
    startTime: 0,
    endTime: 10_000,
    playerId: "P1",
    playerTeamId: 0,
    winningTeamId: 0,
    result: "Win",
    linesTotal: 0,
    linesDropped: 0,
    hasAdvancedLogging: true,
    timezone: "UTC",
    units: {
      P1: {
        ...emptyUnit,
        id: "P1",
        name: "A-T",
        kind: "Player",
        classId: 1,
        specId: 71,
        info: {
          teamId: 0,
          specId: 71,
          personalRating: 1800,
          talents: [],
          pvpTalents: [],
          equipment: [],
          interestingAuras: [],
        },
        damageOut: [hp(100), hp(250)],
        healOut: [hp(30)],
        damageIn: [hp(500)],
        deaths: [
          { ...hp(0), unconscious: false },
          { ...hp(0), unconscious: true },
        ],
      },
      PET1: {
        ...emptyUnit,
        id: "PET1",
        name: "Pet",
        kind: "Pet",
        classId: 0,
        specId: 0,
        ownerId: "P1",
        damageOut: [hp(50)],
        healOut: [hp(20)],
        absorbsOut: [{ ...hp(0), absorbedAmount: 60, attackerId: "P2" }],
      },
      P2: {
        ...emptyUnit,
        id: "P2",
        name: "B-T",
        kind: "Player",
        classId: 2,
        specId: 65,
        info: {
          teamId: 1,
          specId: 65,
          personalRating: 1900,
          talents: [],
          pvpTalents: [],
          equipment: [],
          interestingAuras: [],
        },
        absorbsOut: [{ ...hp(0), absorbedAmount: 400, attackerId: "P1" }],
      },
    },
  } as unknown as ReportSource;
}

describe("deriveSummary", () => {
  it("合成对局:宠物并入、口径精确、排序按 damageDone 降序", () => {
    const rows = deriveSummary(synthetic());
    expect(rows).toHaveLength(2); // 宠物不单列
    expect(rows[0]!.unitId).toBe("P1");
    expect(rows[0]!.damageDone).toBe(400); // 100+250+宠物50
    expect(rows[0]!.healingDone).toBe(50); // 30+宠物20
    expect(rows[0]!.absorbsDone).toBe(60);
    expect(rows[0]!.damageTaken).toBe(500);
    expect(rows[0]!.deaths).toBe(1); // unconscious 不计
    expect(rows[0]!.dps).toBeCloseTo(40); // 400/10s
    expect(rows[1]!.absorbsDone).toBe(400);
  });
  it("fixture 守恒:每行数值非负,行数=Player 数", () => {
    const m = loadMatchFixture();
    const rows = deriveSummary(m);
    const players = Object.values(m.units).filter(
      (u) => u.kind === "Player" && u.info,
    );
    expect(rows).toHaveLength(players.length);
    for (const r of rows) {
      expect(r.damageDone).toBeGreaterThanOrEqual(0);
      expect(r.healingDone).toBeGreaterThanOrEqual(0);
      expect(r.damageTaken).toBeGreaterThanOrEqual(0);
    }
    expect(rows.some((r) => r.damageDone > 0)).toBe(true);
  });
});
