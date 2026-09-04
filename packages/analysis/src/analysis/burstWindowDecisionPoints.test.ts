/**
 * GH #60 phase 1 — the enemy-burst-window engine's regressions.
 *
 * Test discipline copied from `cdHoardedSelfOnly.test.ts` /
 * `crisisDecisionPoints.test.ts`: hand-built legacy units carrying exactly the
 * fields the predicate reads, and every case named after the behaviour it
 * pins, not the function it calls.
 *
 * `beforeAll(ensureAnalysisData)` is load bearing — `extractMajorCooldowns`
 * (the feasibility gate) and `getEnglishSpellName` both read generated
 * official data.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../data/ensure";
import {
  BURST_HEAL_CD_IDS,
  BURST_LEAD_CD_EXCLUDED_IDS,
  BURST_OUTCOME_FIELDS,
  BURST_RESPONSE_WINDOW_MS,
  BURST_TRIAGE_MIN_HP_DROP_PP,
  burstWindowDecisionPoints,
} from "./burstWindowDecisionPoints";
import { CRISIS_HP_PCT_RENDERED } from "./crisisDecisionPoints";

const T0 = 1_000_000;

/** Adrenaline Rush (13750): a 20 s offensive buff with a 180 s cooldown — the
 * corpus' single most common solo burst window opener, and heavy enough to
 * qualify a window on its own (`SOLO_WINDOW_MIN_WEIGHT`). */
const AR = "13750";
/** Recklessness (1719) — the second CD used to build two-CD windows here. */
const RECK = "1719";
/** Ironbark (22812), a `bigDefensiveSpellIds` personal wall. */
const BARKSKIN = "22812";
/** Healing Tide Totem (108280), a `TEAM_HEAL_CD_IDS` healing cooldown. */
const HEALING_TIDE = "108280";
/** Storm Bolt (107570) — hard CC, used as the control-on-caster answer. */
const STORM_BOLT = "107570";
/** Power Infusion (10060) — the one `BURST_LEAD_CD_EXCLUDED_IDS` entry. */
const PI = "10060";
/** Tranquility (740) — a `TEAM_HEAL_CD_IDS` entry the hand-built Restoration
 * Druid actually owns, so `extractMajorCooldowns` puts it in their ledger. */
const TRANQUILITY = "740";

const cast = (spellId: string, tSec: number, destUnitId?: string) => ({
  spellId,
  spellName: spellId,
  timestamp: T0 + tSec * 1000,
  destUnitId,
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: T0 + tSec * 1000,
  },
});

const hp = (tSec: number, cur: number, actorId: string, max = 100) => ({
  timestamp: T0 + tSec * 1000,
  logLine: { timestamp: T0 + tSec * 1000 },
  advancedActorId: actorId,
  advancedActorCurrentHp: cur,
  advancedActorMaxHp: max,
  advancedActorPositionX: 0,
  advancedActorPositionY: 0,
});

const dmg = (tSec: number, amount: number, srcUnitId = "E1") => ({
  timestamp: T0 + tSec * 1000,
  srcUnitId,
  amount: -amount,
  effectiveAmount: -amount,
  logLine: { timestamp: T0 + tSec * 1000 },
});

function friendly(over: Record<string, unknown> = {}) {
  return {
    id: "F1",
    name: "Friend-R",
    reaction: CombatUnitReaction.Friendly,
    // a real class/spec: `extractMajorCooldowns` (the feasibility gate) builds
    // its ledger from classMetadata and returns [] for an unknown class.
    // Balance, not Restoration, since 2026-09-04 (GH #63): for HEALER specs
    // the generated save roster is the authority and Barkskin measured no
    // save effect there, so a Resto Druid's Barkskin is no longer a wall —
    // these tests are about the window mechanics, not about that ruling.
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Balance,
    info: { teamId: "0", specId: "102" },
    advancedActions: [],
    damageIn: [],
    healIn: [],
    healOut: [],
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    deathRecords: [],
    ...over,
  };
}
function hostile(over: Record<string, unknown> = {}) {
  return friendly({
    id: "E1",
    name: "Enemy-R",
    reaction: CombatUnitReaction.Hostile,
    info: { teamId: "1", specId: "260" },
    ...over,
  });
}
function combat(units: any[], endSec = 240) {
  const map: Record<string, any> = {};
  for (const u of units) map[u.id] = u;
  return {
    startTime: T0,
    endTime: T0 + endSec * 1000,
    units: map,
    startInfo: { bracket: "3v3" },
  };
}

/** damage every second in [from, to) big enough to clear the lapse floor
 * (3% of a 100-HP bar per second → 5 per second is comfortably over) */
function steadyDamage(from: number, to: number) {
  const out = [];
  for (let s = from; s < to; s++) out.push(dmg(s, 5));
  return out;
}
/** HP samples every second so `gridHpPct` has something to read */
function hpTrack(actorId: string, from: number, to: number, value: number) {
  const out = [];
  for (let s = from; s <= to; s++) out.push(hp(s, value, actorId));
  return out;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("burstWindowDecisionPoints — window bounding", () => {
  it("a single 20 s offensive CD whose damage stops after 8 s is bounded to that exchange, not to the buff", () => {
    const f = friendly({
      damageIn: steadyDamage(10, 18),
      advancedActions: hpTrack("F1", 0, 40, 60),
    });
    const e = hostile({ spellCastEvents: [cast(AR, 10)] });
    const pts = burstWindowDecisionPoints(combat([f, e]));
    expect(pts).toHaveLength(1);
    expect(pts[0]!.tSec).toBe(10);
    // buff runs to second 30; the pressure stopped at 17
    expect(pts[0]!.endSec).toBe(17);
    expect(pts[0]!.durationSec).toBe(7);
  });

  it("two casts separated by a long quiet gap become TWO windows, not one merged 40 s window", () => {
    const f = friendly({
      damageIn: [...steadyDamage(10, 16), ...steadyDamage(34, 40)],
      advancedActions: hpTrack("F1", 0, 60, 60),
    });
    // the builder merges these into ONE group (the second cast is inside the
    // first's 20 s buff reach); the bounding must split them again. Both
    // openers are Adrenaline Rush so each piece qualifies on its own weight.
    const e = hostile({ spellCastEvents: [cast(AR, 10)] });
    const e2 = hostile({
      id: "E2",
      name: "Enemy2-R",
      spellCastEvents: [cast(AR, 34)],
    });
    const pts = burstWindowDecisionPoints(combat([f, e, e2]));
    expect(pts.map((p) => p.tSec)).toEqual([10, 34]);
  });

  it("keeps a piece that has 2+ CDs and drops one that is a lone light CD", () => {
    const f = friendly({
      damageIn: [...steadyDamage(10, 16), ...steadyDamage(34, 40)],
      advancedActions: hpTrack("F1", 0, 60, 60),
    });
    // Storm Bolt is not an offensive CD at all, so the second piece has no
    // qualifying cast and disappears; the first still has Adrenaline Rush.
    const e = hostile({
      spellCastEvents: [cast(AR, 10), cast(STORM_BOLT, 34, "F1")],
    });
    const pts = burstWindowDecisionPoints(combat([f, e]));
    expect(pts.map((p) => p.tSec)).toEqual([10]);
  });

  it("names the CD that OPENED the window as the lead, not the heaviest one cast later", () => {
    const f = friendly({
      damageIn: steadyDamage(10, 30),
      advancedActions: hpTrack("F1", 0, 40, 60),
    });
    const e = hostile({ spellCastEvents: [cast(RECK, 10), cast(AR, 22)] });
    const pts = burstWindowDecisionPoints(combat([f, e]));
    expect(pts).toHaveLength(1);
    expect(pts[0]!.leadCd.spellId).toBe(RECK);
    expect(pts[0]!.leadCd.castSec).toBe(10);
    expect(pts[0]!.extraCds.map((c) => c.spellId)).toEqual([AR]);
  });
});

describe("burstWindowDecisionPoints — response classification", () => {
  const enemyWithBurst = () => hostile({ spellCastEvents: [cast(AR, 10)] });
  const pressuredFriend = (over: Record<string, unknown> = {}) =>
    friendly({
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 60),
      ...over,
    });

  it("no answer inside 8 s → responded=false, firstResponseSec=null", () => {
    const pts = burstWindowDecisionPoints(
      combat([pressuredFriend(), enemyWithBurst()]),
    );
    expect(pts).toHaveLength(1);
    expect(pts[0]!.responded).toBe(false);
    expect(pts[0]!.firstResponseSec).toBeNull();
    expect(pts[0]!.responseCasts).toEqual([]);
  });

  it("a personal wall inside 8 s counts, and its latency is recorded", () => {
    const pts = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ spellCastEvents: [cast(BARKSKIN, 13)] }),
        enemyWithBurst(),
      ]),
    );
    expect(pts[0]!.responses.wall).toBe(true);
    expect(pts[0]!.responded).toBe(true);
    expect(pts[0]!.firstResponseSec).toBe(3);
  });

  it("the same wall 9 s in is NOT a response (outside the 8 s window)", () => {
    const pts = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ spellCastEvents: [cast(BARKSKIN, 19)] }),
        enemyWithBurst(),
      ]),
    );
    expect(BURST_RESPONSE_WINDOW_MS).toBe(8000);
    expect(pts[0]!.responses.wall).toBe(false);
    expect(pts[0]!.responded).toBe(false);
  });

  it("a TEAMMATE's answer counts — the window belongs to the team, not to the target", () => {
    const target = pressuredFriend();
    const mate = friendly({
      id: "F2",
      name: "Mate-R",
      advancedActions: hpTrack("F2", 0, 40, 100),
      spellCastEvents: [cast(HEALING_TIDE, 12)],
    });
    const pts = burstWindowDecisionPoints(
      combat([target, mate, enemyWithBurst()]),
    );
    expect(BURST_HEAL_CD_IDS.has(HEALING_TIDE)).toBe(true);
    expect(pts[0]!.responses.healCd).toBe(true);
    expect(pts[0]!.responseCasts[0]!.casterName).toBe("Mate-R");
  });

  it("control counts only when it is aimed AT one of the burst's own casters", () => {
    const onCaster = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ spellCastEvents: [cast(STORM_BOLT, 12, "E1")] }),
        enemyWithBurst(),
      ]),
    );
    expect(onCaster[0]!.responses.control).toBe(true);

    const onSomeoneElse = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ spellCastEvents: [cast(STORM_BOLT, 12, "E2")] }),
        enemyWithBurst(),
        hostile({ id: "E2", name: "Enemy2-R" }),
      ]),
    );
    expect(onSomeoneElse[0]!.responses.control).toBe(false);
    expect(onSomeoneElse[0]!.responded).toBe(false);
  });

  it("a wall pressed just BEFORE the opener still counts (pre-wall allowance)", () => {
    const pts = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ spellCastEvents: [cast(BARKSKIN, 9)] }),
        enemyWithBurst(),
      ]),
    );
    expect(pts[0]!.responses.wall).toBe(true);
    expect(pts[0]!.firstResponseSec).toBe(-1);
  });
});

describe("burstWindowDecisionPoints — feasibility gate", () => {
  it("a friendly with a wall off cooldown and free to act makes the window feasible", () => {
    const f = friendly({
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 60),
      spellCastEvents: [cast(BARKSKIN, 120)],
    });
    const pts = burstWindowDecisionPoints(
      combat([f, hostile({ spellCastEvents: [cast(AR, 10)] })]),
    );
    expect(pts[0]!.feasible).toBe(true);
    expect(pts[0]!.feasibleUnits).toContain("Friend-R");
  });

  it("a team with no relevant cooldown at all is NOT feasible — nobody is accused of not being psychic", () => {
    const f = friendly({
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 60),
    });
    const pts = burstWindowDecisionPoints(
      combat([f, hostile({ spellCastEvents: [cast(AR, 10)] })]),
    );
    expect(pts[0]!.feasible).toBe(false);
    expect(pts[0]!.feasibleUnits).toEqual([]);
  });

  it("a friendly hard-CC'd across the WHOLE response window does not make it feasible", () => {
    // Polymorph (118) covering [10s, 19s] — the whole 8 s window and then some
    const f = friendly({
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 60),
      spellCastEvents: [cast(BARKSKIN, 120)],
      auraEvents: [
        {
          spellId: "118",
          spellName: "Polymorph",
          srcUnitId: "E1",
          srcUnitName: "Enemy-R",
          destUnitId: "F1",
          timestamp: T0 + 9_000,
          logLine: {
            event: LogEvent.SPELL_AURA_APPLIED,
            timestamp: T0 + 9_000,
          },
        },
        {
          spellId: "118",
          spellName: "Polymorph",
          srcUnitId: "E1",
          srcUnitName: "Enemy-R",
          destUnitId: "F1",
          timestamp: T0 + 25_000,
          logLine: {
            event: LogEvent.SPELL_AURA_REMOVED,
            timestamp: T0 + 25_000,
          },
        },
      ],
    });
    const pts = burstWindowDecisionPoints(
      combat([f, hostile({ spellCastEvents: [cast(AR, 10)] })]),
    );
    expect(pts[0]!.feasible).toBe(false);
  });
});

describe("burstWindowDecisionPoints — outcomes are table-only", () => {
  it("min friendly HP comes from the [STATE] grid sampler and names the dip second", () => {
    const f = friendly({
      damageIn: steadyDamage(10, 20),
      advancedActions: [
        ...hpTrack("F1", 0, 13, 90),
        hp(14, 22, "F1"),
        ...hpTrack("F1", 15, 40, 70),
      ],
    });
    const pts = burstWindowDecisionPoints(
      combat([f, hostile({ spellCastEvents: [cast(AR, 10)] })]),
    );
    expect(pts[0]!.minFriendlyHpPct).toBe(22);
    expect(pts[0]!.friendlyOutcomes[0]!.minHpSec).toBe(14);
  });

  it("a death inside the window is recorded but changes neither `responded` nor `feasible`", () => {
    const base = {
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 60),
      spellCastEvents: [cast(BARKSKIN, 120)],
    };
    const alive = burstWindowDecisionPoints(
      combat([friendly(base), hostile({ spellCastEvents: [cast(AR, 10)] })]),
    )[0]!;
    const dead = burstWindowDecisionPoints(
      combat([
        friendly({ ...base, deathRecords: [{ timestamp: T0 + 15_000 }] }),
        hostile({ spellCastEvents: [cast(AR, 10)] }),
      ]),
    )[0]!;
    expect(alive.anyFriendlyDeath).toBe(false);
    expect(dead.anyFriendlyDeath).toBe(true);
    expect(dead.deathsInWindow).toBe(1);
    // the two gates the producer IS allowed to read must be identical
    expect(dead.responded).toBe(alive.responded);
    expect(dead.feasible).toBe(alive.feasible);
    expect(dead.feasibleUnits).toEqual(alive.feasibleUnits);
  });

  it("the outcome-field list is exactly the three fields the producer must not read", () => {
    // `anyFriendlyDeath` left this list on 2026-09-01 (approved correction 2):
    // it is the triage door AND `facts.diedInWindow`, and it is deliberately
    // the same predicate the reference table's own outcome uses.
    expect([...BURST_OUTCOME_FIELDS]).toEqual([
      "deathsInWindow",
      "minFriendlyHpPct",
      "friendlyOutcomes",
    ]);
  });
});

describe("burstWindowDecisionPoints — the pressured friendly (correction 1)", () => {
  /** two friendlies: F1 takes the damage, F2 is the healer standing next to
   * it. `over1`/`over2` add whatever the case under test needs. */
  const twoFriendlies = (over1: any = {}, over2: any = {}) => [
    friendly({
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 25),
      ...over1,
    }),
    friendly({
      id: "F2",
      name: "Mate-R",
      // the healer — a real healer spec so the generated save roster (GH #63)
      // tags Tranquility / Ironbark Defensive for it
      spec: CombatUnitSpec.Druid_Restoration,
      info: { teamId: "0", specId: "105" },
      advancedActions: hpTrack("F2", 0, 40, 95),
      ...over2,
    }),
    hostile({ spellCastEvents: [cast(AR, 10)] }),
  ];

  it("names the LOWEST-HP friendly as pressured, not merely the most-damaged one", () => {
    const pts = burstWindowDecisionPoints(combat(twoFriendlies()));
    expect(pts[0]!.pressured?.name).toBe("Friend-R");
    expect(pts[0]!.pressured?.minHpPct).toBe(25);
  });

  it("a teammate's ready wall does NOT make the window feasible — it cannot reach the pressured friendly", () => {
    // Ironbark on the healer is a personal wall: ready, but useless to F1.
    const pts = burstWindowDecisionPoints(
      combat(twoFriendlies({}, { spellCastEvents: [cast(BARKSKIN, 120)] })),
    );
    expect(pts[0]!.pressured?.name).toBe("Friend-R");
    expect(pts[0]!.feasible).toBe(false);
  });

  it("a teammate's ready major healing CD DOES make it feasible (it reaches the pressured friendly)", () => {
    const pts = burstWindowDecisionPoints(
      combat(twoFriendlies({}, { spellCastEvents: [cast(TRANQUILITY, 120)] })),
    );
    expect(pts[0]!.feasible).toBe(true);
    expect(pts[0]!.feasibleUnits).toEqual(["Mate-R"]);
  });

  it("the pressured friendly's OWN wall makes it feasible even with a useless team", () => {
    const pts = burstWindowDecisionPoints(
      combat(twoFriendlies({ spellCastEvents: [cast(BARKSKIN, 120)] })),
    );
    expect(pts[0]!.feasible).toBe(true);
    expect(pts[0]!.feasibleUnits).toEqual(["Friend-R"]);
  });
});

describe("burstWindowDecisionPoints — severity triage (correction 2 + the 2026-09-01 HP-drop door)", () => {
  /** HP that sits at `startVal` through the window's opening second and has
   * fallen to `endVal` by second 12 — so `startHpPct` reads `startVal` and
   * `minHpPct` reads `endVal`, and the drop the door measures is the
   * difference between the two. */
  const at = (startVal: number, endVal: number, deaths: any[] = []) =>
    burstWindowDecisionPoints(
      combat([
        friendly({
          damageIn: steadyDamage(10, 20),
          advancedActions: [
            ...hpTrack("F1", 0, 11, startVal),
            ...hpTrack("F1", 12, 40, endVal),
          ],
          deathRecords: deaths,
        }),
        hostile({ spellCastEvents: [cast(AR, 10)] }),
      ]),
    )[0]!;

  it("samples HP at the window START as well as its minimum", () => {
    const p = at(100, 25);
    expect(p.pressured!.startHpPct).toBe(100);
    expect(p.pressured!.startHpSec).toBe(p.tSec);
    expect(p.pressured!.minHpPct).toBe(25);
  });

  it("a window where nobody dropped to the crisis line is NOT triaged", () => {
    expect(CRISIS_HP_PCT_RENDERED).toBe(40);
    expect(at(100, 75).triaged).toBe(false);
  });

  it("the pressured friendly reaching the crisis line triages the window", () => {
    expect(at(100, CRISIS_HP_PCT_RENDERED).triaged).toBe(true);
  });

  it("a death inside the window triages it even above the crisis line", () => {
    expect(at(100, 80, [{ timestamp: T0 + 15_000 }]).triaged).toBe(true);
  });

  // ── the HP-drop door: "the window itself put them there" ────────────────

  it("a friendly who was ALREADY low when the window opened is NOT triaged", () => {
    // 30% → 25%: deep under the crisis line, but this burst moved it 5 points.
    // That sentence belongs to the PREVIOUS exchange, not to this window.
    expect(at(30, 25).triaged).toBe(false);
  });

  it("the same depth IS triaged once the window itself took the health", () => {
    expect(at(55, 25).triaged).toBe(true);
  });

  it("the door is exactly BURST_TRIAGE_MIN_HP_DROP_PP points, inclusive", () => {
    expect(BURST_TRIAGE_MIN_HP_DROP_PP).toBe(15);
    const boundary = CRISIS_HP_PCT_RENDERED - 5; // 35, under the crisis line
    expect(at(boundary + BURST_TRIAGE_MIN_HP_DROP_PP, boundary).triaged).toBe(
      true,
    );
    expect(
      at(boundary + BURST_TRIAGE_MIN_HP_DROP_PP - 1, boundary).triaged,
    ).toBe(false);
  });

  it("a death the window did not cause does not triage it either — both clauses are AND", () => {
    expect(at(35, 30, [{ timestamp: T0 + 15_000 }]).triaged).toBe(false);
  });

  it("the reference table's population is untouched by the door — it reads `feasible`, never `triaged`", () => {
    // The regression this pins: if triage ever leaked into the table, the
    // quoted contrast would be conditioned on the outcome that defines it.
    const p = at(30, 25);
    expect(p.triaged).toBe(false);
    // the window is still HERE, with its outcome facts intact — the door
    // removed it from the accusation menu, not from the corpus population
    expect(p.minFriendlyHpPct).toBe(25);
    expect(p.anyFriendlyDeath).toBe(false);
  });
});

describe("burstWindowDecisionPoints — excluded lead CDs (correction 3)", () => {
  it("Power Infusion is registered as an excluded opener", () => {
    expect([...BURST_LEAD_CD_EXCLUDED_IDS]).toEqual(["10060"]);
  });

  it("a window Power Infusion opens is led — and time-anchored — by the next real CD", () => {
    const pts = burstWindowDecisionPoints(
      combat([
        friendly({
          damageIn: steadyDamage(10, 30),
          advancedActions: hpTrack("F1", 0, 40, 60),
        }),
        hostile({
          spellCastEvents: [cast(PI, 10), cast(AR, 13), cast(RECK, 14)],
        }),
      ]),
    );
    expect(pts[0]!.leadCd.spellId).toBe(AR);
    expect(pts[0]!.tSec).toBe(13);
    // PI is not erased — it is still one of the window's casts
    expect(pts[0]!.extraCds.map((c) => c.spellId)).toContain(PI);
  });

  it("a window whose only CD is Power Infusion is dropped entirely", () => {
    const pts = burstWindowDecisionPoints(
      combat([
        friendly({
          damageIn: steadyDamage(10, 30),
          advancedActions: hpTrack("F1", 0, 40, 60),
        }),
        hostile({ spellCastEvents: [cast(PI, 10)] }),
      ]),
    );
    expect(pts).toEqual([]);
  });
});

describe("burstWindowDecisionPoints — teammate reachability gate (GH #60 tail, 2026-09-02)", () => {
  /** HP sample carrying a real position (the shared `hp` fixture pins
   * everyone at (0,0), which the reachability gate reads as "everyone
   * stacked" — these cases need actual distance). */
  const hpAt = (
    tSec: number,
    cur: number,
    actorId: string,
    x: number,
    y: number,
  ) => ({
    ...hp(tSec, cur, actorId),
    advancedActorPositionX: x,
    advancedActorPositionY: y,
  });
  const trackAt = (
    actorId: string,
    from: number,
    to: number,
    value: number,
    x: number,
    y: number,
  ) => {
    const out = [];
    for (let s = from; s <= to; s++) out.push(hpAt(s, value, actorId, x, y));
    return out;
  };
  /** F1 pressured at the origin; F2 is the Tranquility-holding teammate whose
   * position each case varies. */
  const withMateAt = (mateOver: Record<string, unknown>) => [
    friendly({
      damageIn: steadyDamage(10, 20),
      advancedActions: trackAt("F1", 0, 40, 25, 0, 0),
    }),
    friendly({
      id: "F2",
      name: "Mate-R",
      spec: CombatUnitSpec.Druid_Restoration,
      info: { teamId: "0", specId: "105" },
      spellCastEvents: [cast(TRANQUILITY, 120)],
      ...mateOver,
    }),
    hostile({ spellCastEvents: [cast(AR, 10)] }),
  ];

  it("a teammate 500 yd away with a ready ally tool does NOT make the window feasible — they could not deliver it", () => {
    const pts = burstWindowDecisionPoints(
      combat(withMateAt({ advancedActions: trackAt("F2", 0, 40, 95, 0, 500) })),
    );
    expect(pts[0]!.pressured?.name).toBe("Friend-R");
    expect(pts[0]!.feasible).toBe(false);
    expect(pts[0]!.feasibleUnits).toEqual([]);
  });

  it("the same teammate 10 yd away DOES make it feasible", () => {
    const pts = burstWindowDecisionPoints(
      combat(withMateAt({ advancedActions: trackAt("F2", 0, 40, 95, 0, 10) })),
    );
    expect(pts[0]!.feasible).toBe(true);
    expect(pts[0]!.feasibleUnits).toEqual(["Mate-R"]);
  });

  it("a teammate with NO position samples counts as reachable — missing data must not manufacture infeasibility", () => {
    // no advancedActions at all → getUnitPositionAtTime returns null for the
    // helper → the gate fails OPEN (documented choice, 2026-09-02).
    const pts = burstWindowDecisionPoints(
      combat(withMateAt({ advancedActions: [] })),
    );
    expect(pts[0]!.feasible).toBe(true);
    expect(pts[0]!.feasibleUnits).toEqual(["Mate-R"]);
  });

  it("the pressured friendly's OWN ready tool is untouched by the gate — branch (a) needs no delivery", () => {
    const pts = burstWindowDecisionPoints(
      combat([
        friendly({
          damageIn: steadyDamage(10, 20),
          advancedActions: trackAt("F1", 0, 40, 25, 0, 0),
          spellCastEvents: [cast(BARKSKIN, 120)],
        }),
        friendly({
          id: "F2",
          name: "Mate-R",
          spec: CombatUnitSpec.Druid_Restoration,
          info: { teamId: "0", specId: "105" },
          spellCastEvents: [cast(TRANQUILITY, 120)],
          advancedActions: trackAt("F2", 0, 40, 95, 0, 500),
        }),
        hostile({ spellCastEvents: [cast(AR, 10)] }),
      ]),
    );
    expect(pts[0]!.feasible).toBe(true);
    // the unreachable teammate is still not credited
    expect(pts[0]!.feasibleUnits).toEqual(["Friend-R"]);
  });
});
