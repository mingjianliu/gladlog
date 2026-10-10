import {
  CD_WASTE_PRESSURE_HP_PCT,
  cdWasteEvents,
} from "../src/analysis/candidateFindings";
import { buildFindingsPrompt } from "../src/analysis/buildFindingsPrompt";
import { lowPressureUnusedDefensiveNote } from "../src/context/matchTimelineSections";
import { matchMinHpPct } from "../src/utils/killWindowTargetSelection";
import { makeUnit } from "./ported/testHelpers";

const DP = {
  spellId: "19236",
  spellName: "Desperate Prayer",
  neverUsed: true,
  isThroughput: false,
};
const me = { id: "p1", name: "Me" };

/** Pressure gate (measured across 12 Holy Priest rounds, 2026-07-26):
 * low-pressure rounds with minHP 70-94% were all false-positived as "never
 * used all round", while rounds where the wall was genuinely needed had minHP
 * 9-52% — 60% falls inside the separating gap. */
describe("cd-waste 承压门", () => {
  it("低承压(minHP 82%)→ 不发 cd-waste:没被打就不该念经", () => {
    expect(cdWasteEvents([DP], me, 82)).toEqual([]);
  });

  it("承压(minHP 40%)→ 照发", () => {
    const out = cdWasteEvents([DP], me, 40);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe("cd-waste");
    expect(out[0].spellId).toBe("19236");
  });

  it("恰在阈值(=60%)→ 不发;略低(59.9%)→ 发", () => {
    expect(cdWasteEvents([DP], me, CD_WASTE_PRESSURE_HP_PCT)).toEqual([]);
    expect(cdWasteEvents([DP], me, 59.9).length).toBe(1);
  });

  it("承压未知(null,旧档无 advanced)→ 保守照发,行为与门前一致", () => {
    expect(cdWasteEvents([DP], me, null).length).toBe(1);
  });
});

/** Low-pressure guard note (2026-08-01): supplementary wording for the
 * [UNUSED] tag on the prompt side. It shares its predicate with the cd-waste
 * candidate gate, and at the threshold the two must be exactly
 * complementary. */
// W2 (triage 2026-09-29): Spellwarding pressed, Blessing of Protection not —
// the shared DB2 charge pool spent BoP too (e5b3534b / 69546267 / 06bb9860)
describe("cd-waste / NOTE — shared charge pool (W2)", () => {
  const bop = {
    spellId: "1022",
    spellName: "Blessing of Protection",
    neverUsed: true,
    isThroughput: false,
    sharedCasts: [{ timeSeconds: 75.6 }] as never[],
  };
  it("a pool press is a press: no cd-waste, not named by the NOTE", () => {
    expect(cdWasteEvents([bop], me, 40)).toEqual([]);
    expect(cdWasteEvents([{ ...bop, sharedCasts: [] }], me, 40)).toHaveLength(
      1,
    );
    expect(lowPressureUnusedDefensiveNote([bop, DP], 82)).not.toContain(
      "Blessing of Protection",
    );
  });
});

// F-W1 (triage 2026-09-29, ruling 2026-09-30 R7 = A): e5b3534b's Lay on Hands
// was rejected 11 times in Cyclone before the round-ending death — still a
// cd-waste line, now with facts.attempted; rejects after the round end and
// GCD-locked ones do not count
describe("cd-waste — facts.attempted (F-W1)", () => {
  const LOH = {
    spellId: "471195",
    spellName: "Lay on Hands",
    neverUsed: true,
    isThroughput: false,
  };
  const fail = (tSeconds: number, reason = "无法在放逐时那样做") => ({
    tSeconds,
    unitGuid: "p1",
    spellId: 471195,
    spellName: "Lay on Hands",
    reason,
  });
  const rawStreams = {
    available: true,
    manaSamples: [],
    castFailed: [fail(118.4), fail(119.2), fail(120.4), fail(120.6)],
  };
  it("counts the rejects up to the round end; the line still fires", () => {
    const [e] = cdWasteEvents([LOH], me, 40, { rawStreams, untilS: 120.408 });
    expect(e!.facts!.attempted).toBe("曾尝试施放被拒(无法在放逐时那样做×3)");
  });
  it("the caller's window ends at the owner's own death — \"You are dead\" is no attempt", () => {
    const [e] = cdWasteEvents([LOH], me, 40, { rawStreams, untilS: 119.0 });
    expect(e!.facts!.attempted).toBe("曾尝试施放被拒(无法在放逐时那样做×1)");
  });
  it("a not-ready reject within 1.5 s after an own success is a GCD miss-press, not an attempt (fe1a9355 shape)", () => {
    const [e] = cdWasteEvents([LOH], me, 40, {
      rawStreams: {
        ...rawStreams,
        castFailed: [fail(168.57, "尚未恢复")],
      },
      untilS: 200,
      ownCastSuccessSeconds: [167.783],
    });
    expect(e!.facts!.attempted).toBeUndefined();
  });
  it("the legend says never successfully cast, with the intent-guard note", () => {
    const [e] = cdWasteEvents([LOH], me, 40, { rawStreams, untilS: 120.408 });
    const p = buildFindingsPrompt([e!], "", "Holy Paladin");
    const legend = p.split("\n").find((l) => l.startsWith('- "cd-waste":'))!;
    // FT-T15 ⑧: the predicate is per round (a Solo Shuffle prompt is one round)
    expect(legend).toMatch(/never successfully cast in this round/);
    expect(legend).not.toMatch(/entire match/);
    expect(legend).toMatch(/DID try to press this ability/);
  });
  it("no rejects → no fact", () => {
    const [e] = cdWasteEvents([LOH], me, 40, {
      rawStreams: { ...rawStreams, castFailed: [] },
      untilS: 200,
    });
    expect(e!.facts!.attempted).toBeUndefined();
  });
});

describe("lowPressureUnusedDefensiveNote", () => {
  it("低承压 + 有未用减伤墙 → 出注(含 floor 后的 minHP)", () => {
    const note = lowPressureUnusedDefensiveNote([DP], 82.7);
    expect(note).toContain("82%");
    expect(note).toContain("(Desperate Prayer) were correctly HELD");
    // W4 (triage 2026-09-29): no blanket "do NOT coach pressing defensives"
    expect(note).not.toContain("do NOT coach");
  });

  // W4: the owner's HP gate speaks only for what protects the owner
  // (ba8c0510: Stasis named, Rewind — ally-reaching — not)
  it("names only never-spent cooldowns that cannot help another unit", () => {
    const rewind = {
      spellId: "363534",
      spellName: "Rewind",
      neverUsed: true,
      isThroughput: false,
      tag: "Defensive" as const,
    };
    const note = lowPressureUnusedDefensiveNote([DP, rewind], 96);
    expect(note).toContain("(Desperate Prayer)");
    expect(note).not.toContain("Rewind");
    expect(lowPressureUnusedDefensiveNote([rewind], 96)).toBeNull();
  });

  it("a proc-only entry (Renewing Blaze, [PASSIVE]) is never 'held'", () => {
    const blaze = {
      spellId: "374348",
      spellName: "Renewing Blaze",
      neverUsed: true,
      isThroughput: false,
      tag: "Defensive" as const,
    };
    expect(lowPressureUnusedDefensiveNote([blaze], 96)).toBeNull();
    expect(lowPressureUnusedDefensiveNote([blaze, DP], 96)).not.toContain(
      "Renewing Blaze",
    );
  });

  it("真承压 / 承压未知 / 无未用墙 / 只有吞吐 CD → 不出注", () => {
    expect(lowPressureUnusedDefensiveNote([DP], 40)).toBeNull();
    expect(lowPressureUnusedDefensiveNote([DP], null)).toBeNull();
    expect(lowPressureUnusedDefensiveNote([], 82)).toBeNull();
    expect(
      lowPressureUnusedDefensiveNote([{ ...DP, neverUsed: false }], 82),
    ).toBeNull();
    expect(
      lowPressureUnusedDefensiveNote([{ ...DP, isThroughput: true }], 82),
    ).toBeNull();
  });

  it("与 cd-waste 门在阈值处精确互补:同一 minHP 下恰好一边出面", () => {
    for (const minHp of [CD_WASTE_PRESSURE_HP_PCT, 59.9, 82, 40, 100]) {
      const cdWasteFires = cdWasteEvents([DP], me, minHp).length > 0;
      const noteFires = lowPressureUnusedDefensiveNote([DP], minHp) !== null;
      expect(cdWasteFires).toBe(!noteFires);
    }
  });
});

describe("matchMinHpPct", () => {
  it("取 advanced 样本逐点最低;无有效样本 → null", () => {
    const u = makeUnit("p1", {
      advancedActions: [
        {
          logLine: { timestamp: 1000 },
          advancedActorCurrentHp: 900,
          advancedActorMaxHp: 1000,
        },
        {
          logLine: { timestamp: 2000 },
          advancedActorCurrentHp: 350,
          advancedActorMaxHp: 1000,
        },
        {
          logLine: { timestamp: 3000 },
          advancedActorCurrentHp: 700,
          advancedActorMaxHp: 1000,
        },
      ] as never[],
    });
    expect(matchMinHpPct(u)).toBe(35);
    expect(matchMinHpPct(makeUnit("p2"))).toBeNull();
  });

  it("bounded to the round when the combat is passed (triage hp-state F-M1)", () => {
    const sample = (timestamp: number, hp: number) => ({
      logLine: { timestamp },
      advancedActorCurrentHp: hp,
      advancedActorMaxHp: 1000,
    });
    const u = makeUnit("p1", {
      advancedActions: [
        sample(900, 300), // before the round
        sample(2000, 920),
        sample(4000, 950),
        sample(6000, 810), // after the round ended
      ] as never[],
    });
    const round = { startTime: 1000, endTime: 5000 };
    expect(matchMinHpPct(u, round)).toBe(92);
    // without the bounds every sample counts, as before
    expect(matchMinHpPct(u)).toBe(30);
    // the boundary instants are inside the round
    expect(matchMinHpPct(u, { startTime: 900, endTime: 6000 })).toBe(30);
  });
});

// User ruling 2026-09-30: Mass Invisibility is accusable in cd-hoarded only
// (A9 simulated cd-hoarded, not "never pressed it all match")
describe("cd-waste never names Mass Invisibility", () => {
  const mi = {
    spellId: "414664",
    spellName: "Mass Invisibility",
    neverUsed: true,
    isThroughput: false,
    tag: "Defensive",
  };
  it("a never-pressed Mass Invisibility under pressure → no cd-waste", () => {
    expect(cdWasteEvents([mi], me, 40)).toEqual([]);
    expect(cdWasteEvents([mi, DP], me, 40).map((e) => e.spellId)).toEqual([
      "19236",
    ]);
  });
});
