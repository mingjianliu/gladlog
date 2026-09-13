/**
 * Step-2 acceptance tests for the temporal-evidence experiment (GH #94, spec
 * amendment 1): information cutoffs and the counterexample fixtures codex
 * required (2026-09-13 ruling S4). Synthetic rounds only; the 20 real anchors
 * get the same invariance check inside crisisEvidenceProbe.ts.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildCrisisAnswerEvidence,
  cutoffViolations,
  truncateRound,
  WINDOW_MS,
} from "../src/explore/crisisAnswerEvidence";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const T_SEC = 60;
const T = START + T_SEC * 1000;
const OWNER = "Player-owner";
const MATE = "Player-mate";
const FOE = "Player-foe";

function ev(
  event: string,
  ts: number,
  f: {
    spellId?: string;
    spellName?: string;
    src: string;
    dest: string;
    [k: string]: any;
  },
): any {
  const { src, dest, spellId = "0", spellName = "", ...rest } = f;
  return {
    spellId,
    spellName,
    timestamp: ts,
    srcUnitId: src,
    srcUnitName: src,
    destUnitId: dest,
    destUnitName: dest,
    srcUnitFlags: 0,
    destUnitFlags: 0,
    logLine: { event, timestamp: ts, parameters: [] },
    ...rest,
  };
}

function sample(ts: number, x: number, y: number, hp = 400_000): any {
  return {
    advancedActorPowers: [],
    advancedActorCurrentHp: hp,
    advancedActorMaxHp: 1_000_000,
    advancedActorPositionX: x,
    advancedActorPositionY: y,
    advanced: true,
    timestamp: ts,
    advancedActorId: "",
    logLine: { event: "ADVANCED_SAMPLE", timestamp: ts },
  };
}

function unit(id: string, extra: Record<string, any> = {}): any {
  return {
    id,
    name: id,
    ownerId: "0",
    damageIn: [],
    damageOut: [],
    healIn: [],
    healOut: [],
    absorbsIn: [],
    absorbsOut: [],
    auraEvents: [],
    spellCastEvents: [],
    castStartEvents: [],
    petSpellCastEvents: [],
    actionIn: [],
    actionOut: [],
    deathRecords: [],
    advancedActions: [],
    ...extra,
  };
}

/** A baseline round: owner stationary at (0,0), foe hitting them before t. */
function baseRound(): any {
  const owner = unit(OWNER, {
    advancedActions: [
      sample(T - 1000, 0, 0),
      sample(T, 0, 0),
      sample(T + 1000, 0, 0),
      sample(T + 2000, 0, 0),
      sample(T + WINDOW_MS, 0, 0),
    ],
    damageIn: [
      ev("SPELL_DAMAGE", T - 1500, {
        src: FOE,
        dest: OWNER,
        effectiveAmount: -150_000,
        amount: -150_000,
      }),
    ],
  });
  const foe = unit(FOE, {
    advancedActions: [
      sample(T - 1000, 5, 0),
      sample(T, 5, 0),
      sample(T + 1000, 8, 0),
      sample(T + 2000, 11, 0),
      sample(T + WINDOW_MS, 13, 0),
    ],
  });
  const mate = unit(MATE, {
    advancedActions: [sample(T, 20, 0), sample(T + WINDOW_MS, 20, 0)],
  });
  return {
    startTime: START,
    endTime: START + 300_000,
    units: { [OWNER]: owner, [FOE]: foe, [MATE]: mate },
    rawLines: [],
  };
}

const TEAMS = { friendIds: [OWNER, MATE], enemyIds: [FOE] };
const evidence = (r: any) => buildCrisisAnswerEvidence(r, OWNER, T_SEC, TEAMS);
const atT = (r: any) => evidence(r).items.filter((i) => i.phase === "at-t");
const clone = (r: any) => structuredClone(r);

describe("crisisAnswerEvidence: information cutoffs", () => {
  it("truncateRound filters every timestamped unit array and clamps endTime", () => {
    const r = baseRound();
    const { round, untimed } = truncateRound(r, T);
    expect(round.endTime).toBe(T);
    expect(untimed).toEqual([]);
    for (const u of Object.values(round.units) as any[])
      for (const v of Object.values(u))
        if (Array.isArray(v))
          for (const el of v as any[])
            expect(el.logLine?.timestamp ?? el.timestamp).toBeLessThanOrEqual(
              T,
            );
  });

  it("adversarially changing everything after t leaves every at-t item identical", () => {
    const r = baseRound();
    const r2 = clone(r);
    const o = r2.units[OWNER];
    o.healIn.push(
      ev("SPELL_HEAL", T + 500, {
        src: MATE,
        dest: OWNER,
        spellId: "2061",
        effectiveAmount: 300_000,
        amount: 300_000,
      }),
    );
    o.spellCastEvents.push(
      ev("SPELL_CAST_SUCCESS", T + 400, {
        src: OWNER,
        dest: OWNER,
        spellId: "102342",
      }),
    );
    o.auraEvents.push(
      ev("SPELL_AURA_APPLIED", T + 400, {
        src: OWNER,
        dest: OWNER,
        spellId: "102342",
        auraType: "BUFF",
      }),
    );
    o.advancedActions.push(sample(T + 300, 40, 40, 900_000));
    o.advancedActions.sort((a: any, b: any) => a.timestamp - b.timestamp);
    o.deathRecords.push({
      event: "UNIT_DIED",
      timestamp: T + 2500,
      parameters: [],
    });
    expect(atT(r2)).toEqual(atT(r));
  });

  it("adversarially changing everything after t + 3 s leaves the WHOLE evidence identical", () => {
    const r = baseRound();
    const r2 = clone(r);
    const o = r2.units[OWNER];
    const late = T + WINDOW_MS + 200;
    o.healIn.push(
      ev("SPELL_HEAL", late, {
        src: MATE,
        dest: OWNER,
        spellId: "2061",
        effectiveAmount: 999_000,
        amount: 999_000,
      }),
    );
    o.spellCastEvents.push(
      ev("SPELL_CAST_SUCCESS", late, {
        src: OWNER,
        dest: OWNER,
        spellId: "102342",
      }),
    );
    o.advancedActions.push(sample(late, 99, 99));
    expect(evidence(r2)).toEqual(evidence(r));
  });

  it("every supporting timestamp is within its phase cutoff", () => {
    const r = baseRound();
    r.units[OWNER].healIn.push(
      ev("SPELL_HEAL", T + 1000, {
        src: MATE,
        dest: OWNER,
        spellId: "2061",
        effectiveAmount: 100_000,
        amount: 100_000,
      }),
    );
    expect(cutoffViolations(evidence(r))).toEqual([]);
  });
});

describe("crisisAnswerEvidence: counterexample fixtures", () => {
  it("a wall applied 3 s before t is protection at t, with zero casts in the window — and no verdict", () => {
    const r = baseRound();
    r.units[OWNER].auraEvents.push(
      ev("SPELL_AURA_APPLIED", T - 3000, {
        src: OWNER,
        dest: OWNER,
        spellId: "102342",
        spellName: "Ironbark",
        auraType: "BUFF",
      }),
    );
    const e = evidence(r);
    const mit = e.items.find((i) => i.kind === "mitigation");
    expect(mit).toBeDefined();
    expect(mit!.phase).toBe("at-t");
    expect(mit!.amount).toBe(20);
    expect(mit!.atMs).toEqual([T - 3000]);
    expect(e.items.some((i) => i.kind === "cast")).toBe(false);
    expect(Object.keys(e)).not.toContain("verdict");
  });

  it("attackers retreating is not the owner moving", () => {
    const e = evidence(baseRound());
    const mv = e.items.find((i) => i.kind === "movement")!;
    expect(mv.amount).toBe(0);
    expect(mv.text).toContain("owner moved 0 yd");
    expect(mv.text).toContain("distance 5 → 13 yd, attacker moved 8 yd");
    expect(mv.text.toLowerCase()).not.toContain("kite");
  });

  it("moving a future aura removal from t + 1 s to t + 5 s does not change the at-t view", () => {
    const withRemoval = (removeMs: number) => {
      const r = baseRound();
      r.units[OWNER].auraEvents.push(
        ev("SPELL_AURA_APPLIED", T - 2000, {
          src: MATE,
          dest: OWNER,
          spellId: "102342",
          auraType: "BUFF",
        }),
        ev("SPELL_AURA_REMOVED", removeMs, {
          src: MATE,
          dest: OWNER,
          spellId: "102342",
          auraType: "BUFF",
        }),
      );
      return r;
    };
    expect(atT(withRemoval(T + 5000))).toEqual(atT(withRemoval(T + 1000)));
  });

  it("an HP / position sample after t cannot establish the at-t HP", () => {
    const r = baseRound();
    const o = r.units[OWNER];
    o.advancedActions.push(sample(T + 200, 50, 50, 950_000));
    o.advancedActions.sort((a: any, b: any) => a.timestamp - b.timestamp);
    const hp = atT(r).find(
      (i) => i.kind === "pressure" && i.text.startsWith("HP"),
    )!;
    expect(hp.text).toContain("HP 40%");
    expect(hp.atMs.every((ms) => ms <= T)).toBe(true);
  });

  it("a non-periodic heal without a linked cast is healing received, not a new cast; an established HoT needs no cast", () => {
    const r = baseRound();
    const o = r.units[OWNER];
    o.healIn.push(
      ev("SPELL_HEAL", T + 1000, {
        src: MATE,
        dest: OWNER,
        spellId: "2061",
        spellName: "Flash Heal",
        effectiveAmount: 120_000,
        amount: 120_000,
      }),
      ev("SPELL_PERIODIC_HEAL", T - 2000, {
        src: OWNER,
        dest: OWNER,
        spellId: "774",
        spellName: "Rejuvenation",
        effectiveAmount: 20_000,
        amount: 20_000,
      }),
    );
    o.auraEvents.push(
      ev("SPELL_AURA_APPLIED", T - 5000, {
        src: OWNER,
        dest: OWNER,
        spellId: "774",
        spellName: "Rejuvenation",
        auraType: "BUFF",
      }),
    );
    const e = evidence(r);
    expect(e.items.some((i) => i.kind === "cast")).toBe(false);
    const heal = e.items.find(
      (i) => i.kind === "healing" && i.spellId === "2061",
    )!;
    expect(heal.text).toContain("non-periodic healing");
    const hot = e.items.find((i) => i.kind === "hot")!;
    expect(hot.spellId).toBe("774");
    expect(hot.atMs.every((ms) => ms <= T)).toBe(true);
  });

  it("an aura whose first tick comes after t is NOT classified as a HoT at t", () => {
    const r = baseRound();
    const o = r.units[OWNER];
    o.auraEvents.push(
      ev("SPELL_AURA_APPLIED", T - 500, {
        src: OWNER,
        dest: OWNER,
        spellId: "774",
        auraType: "BUFF",
      }),
    );
    o.healIn.push(
      ev("SPELL_PERIODIC_HEAL", T + 800, {
        src: OWNER,
        dest: OWNER,
        spellId: "774",
        effectiveAmount: 20_000,
        amount: 20_000,
      }),
    );
    const e = evidence(r);
    expect(e.items.some((i) => i.kind === "hot")).toBe(false);
    expect(e.unclassifiedAuraIds).toContain("774");
  });
});
