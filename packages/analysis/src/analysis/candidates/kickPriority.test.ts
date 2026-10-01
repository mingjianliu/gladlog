import { describe, expect, it } from "vitest";

import {
  type IKickPriorityPoint,
  isOwnerMissedKick,
  KICK_MELEE_BASE_YD,
  KICK_MELEE_REACH_YD,
  meleeKickReachYd,
  type KickPriorityFriend,
  kickPriorityMissedEvents,
  kickPriorityTeamEvents,
} from "./kickPriority";

const owner = { id: "P1", name: "Rogue" };
const friend = (over: Partial<KickPriorityFriend> = {}): KickPriorityFriend => ({
  id: owner.id,
  name: owner.name,
  kickSpellId: "1766",
  kickSpellName: "Kick",
  cdRemainingS: 0,
  neverObserved: false,
  locked: false,
  distanceYd: 4,
  inRange: true,
  feasible: true,
  reachableBeforeLanding: true,
  rootedThroughCast: false,
  rangeYd: 5,
  reachYd: 12,
  kickReadyForS: 20.4,
  ...over,
});
const point = (over: Partial<IKickPriorityPoint> = {}): IKickPriorityPoint => ({
  healerId: "E3",
  healerName: "Priest",
  spellId: "2061",
  spellName: "Flash Heal",
  castStartS: 100,
  castEndS: 101.6,
  durationS: 1.6,
  outcome: "completed",
  interruptedById: null,
  interruptedByName: null,
  targetId: "E1",
  targetName: "Mage",
  targetHpPct: 32,
  healAmount: 900_000,
  healOtherName: null,
  healOtherAmount: 0,
  windowFromS: 95,
  windowToS: 110,
  friends: [friend()],
  ...over,
});
const ref = { nCompleted: 1000, nInterrupted: 400, deathCompletedPct: 12, deathInterruptedPct: 31 };
const probes = { lookup: () => ref };

describe("isOwnerMissedKick", () => {
  it("completed heal, owner feasible (ready, free, in official range)", () => {
    expect(isOwnerMissedKick(point(), owner.id)).toBe(true);
  });
  it("interrupted casts, an owner without a kick, on cooldown, locked, out of range or unknown range are never accused", () => {
    expect(isOwnerMissedKick(point({ outcome: "interrupted" }), owner.id)).toBe(false);
    expect(isOwnerMissedKick(point({ friends: [] }), owner.id)).toBe(false);
    expect(isOwnerMissedKick(point({ friends: [friend({ cdRemainingS: 4, feasible: false })] }), owner.id)).toBe(false);
    expect(isOwnerMissedKick(point({ friends: [friend({ locked: true, feasible: false })] }), owner.id)).toBe(false);
    expect(isOwnerMissedKick(point({ friends: [friend({ inRange: false, feasible: false })] }), owner.id)).toBe(false);
    expect(isOwnerMissedKick(point({ friends: [friend({ inRange: null, feasible: false })] }), owner.id)).toBe(false);
  });
});

describe("healedWhom (the log has no cast target; where the heal landed is a rendered fact)", () => {
  it("target / another unit with amount / none", () => {
    const f = (over: Partial<IKickPriorityPoint>) =>
      kickPriorityMissedEvents([point(over)], owner, probes)[0]!.facts;
    expect(f({}).healedWhom).toBe("target");
    expect(f({ healAmount: 0, healOtherName: "Warrior", healOtherAmount: 640_000 }).healedWhom).toBe("Warrior (640k)");
    expect(f({ healAmount: 0, healOtherName: "Warrior", healOtherAmount: 640_000 }).healK).toBe("0");
    expect(f({ healAmount: 0 }).healedWhom).toBe("none");
    // a completed heal that went elsewhere is still an owner accusation (symmetric arms)
    expect(isOwnerMissedKick(point({ healAmount: 0, healOtherName: "Warrior", healOtherAmount: 1 }), owner.id)).toBe(true);
  });
});

describe("kickPriorityMissedEvents", () => {
  it("emits the round's facts plus the corpus contrast; no reference → nothing", () => {
    const ev = kickPriorityMissedEvents([point({ friends: [friend(), friend({ id: "P2", name: "Mage2", kickSpellName: "Counterspell", distanceYd: 30 })] })], owner, probes);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.type).toBe("kick-priority-missed");
    expect(ev[0]!.facts).toMatchObject({
      healer: "Priest",
      heal: "Flash Heal",
      castS: "1.6",
      target: "Mage",
      targetHpPct: "32",
      healK: "900",
      kick: "Kick",
      kickNeverUsed: "no",
      distanceYd: "4",
      othersFeasible: "Mage2",
      refNCompleted: "1000",
      refDeathCompleted: "12",
      refDeathInterrupted: "31",
    });
    expect(kickPriorityMissedEvents([point()], owner, { lookup: () => null })).toHaveLength(0);
  });
  it("cap keeps the biggest heals, output in time order", () => {
    const pts = [1, 2, 3].map((i) => point({ castStartS: 100 + i * 10, healAmount: i * 100_000 }));
    const ev = kickPriorityMissedEvents(pts, owner, probes);
    expect(ev.map((e) => e.facts.healK)).toEqual(["200", "300"]);
  });
});

describe("kickPriorityTeamEvents (user ruling 3: teammate form, distance included)", () => {
  it("fires only when the owner could NOT kick and a teammate was feasible; names the teammate with kick and distance", () => {
    const mate = friend({ id: "P2", name: "Mage2", kickSpellId: "2139", kickSpellName: "Counterspell", distanceYd: 31 });
    const pts = [point({ friends: [friend({ cdRemainingS: 6, feasible: false }), mate] })];
    const ev = kickPriorityTeamEvents(pts, owner, probes);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.type).toBe("kick-priority-team");
    expect(ev[0]!.facts).toMatchObject({ ownerWhy: "on cooldown (6s)", teammates: "Mage2 31 yd", refDeathInterrupted: "31" });
    // owner feasible → the owner form owns it, no team card
    expect(kickPriorityTeamEvents([point({ friends: [friend(), mate] })], owner, probes)).toHaveLength(0);
    // teammate out of range → nothing (range is part of the predicate)
    expect(kickPriorityTeamEvents([point({ friends: [friend({ cdRemainingS: 6, feasible: false }), { ...mate, inRange: false, feasible: false }] })], owner, probes)).toHaveLength(0);
    // owner has no interrupt at all
    expect(kickPriorityTeamEvents([point({ friends: [mate] })], owner, probes)[0]!.facts.ownerWhy).toBe("no interrupt");
  });
});

describe("meleeKickReachYd (reliability round 3 W1a, 6954)", () => {
  it("a kicker who could not run at all reaches only the kick's own range + hitbox slack, not the 8 yd run envelope", () => {
    expect(meleeKickReachYd(0, 5, 5)).toBe(7);
    expect(meleeKickReachYd(0, 5, 5)).toBeLessThan(KICK_MELEE_BASE_YD);
  });

  it("a kicker who could run keeps the envelope, capped, plus range talents", () => {
    expect(meleeKickReachYd(1, 5, 5)).toBe(KICK_MELEE_BASE_YD + 7);
    expect(meleeKickReachYd(10, 5, 5)).toBe(KICK_MELEE_REACH_YD);
    expect(meleeKickReachYd(10, 10, 5)).toBe(KICK_MELEE_REACH_YD + 5);
  });
});

describe("the chance must come before the heal landed", () => {
  it("feasible on the nominal cast but not reachable before the actual landing → no accusation, no team call-out", () => {
    const late = friend({ reachableBeforeLanding: false });
    expect(isOwnerMissedKick(point({ friends: [late] }), owner.id)).toBe(false);
  });
});

describe("owner card: othersFeasible needs the landing predicate too (codex review)", () => {
  it("a teammate feasible on the nominal cast but not before the landing is not named", () => {
    const late = friend({ id: "P2", name: "Mate", reachableBeforeLanding: false });
    const ev = kickPriorityMissedEvents([point({ friends: [friend(), late] })], owner, probes);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.facts.othersFeasible).toBe("none");
  });
});

describe("the detector's span, the kick's range and reach, how long it had been back (triage kick-priority F-P1 / F-P3 / F-P5)", () => {
  it("owner form: windowFrom / windowTo on the render grid, kickRangeYd, reachYd for a melee kick, kickReadyForS", () => {
    const f = kickPriorityMissedEvents([point({ windowFromS: 187.95, windowToS: 360.4 })], owner, probes)[0]!.facts;
    expect(f).toMatchObject({ windowFrom: "3:07", windowTo: "6:00", kickRangeYd: "5", reachYd: "12", kickReadyForS: "20.4" });
  });
  it("a ranged kick has no reachYd; a never-used kick has no kickReadyForS", () => {
    const f = kickPriorityMissedEvents(
      [point({ friends: [friend({ kickSpellName: "Counter Shot", rangeYd: 40, reachYd: null, kickReadyForS: null, neverObserved: true })] })],
      owner,
      probes,
    )[0]!.facts;
    expect(f.kickRangeYd).toBe("40");
    expect(f.kickNeverUsed).toBe("yes");
    expect("reachYd" in f).toBe(false);
    expect("kickReadyForS" in f).toBe(false);
  });
  it("no fact value carries the facts separator", () => {
    const f = kickPriorityMissedEvents([point()], owner, probes)[0]!.facts;
    for (const v of Object.values(f)) expect(v).not.toContain(", ");
  });
  it("team form carries the same span", () => {
    const mate = friend({ id: "P2", name: "Mage2", distanceYd: 31 });
    const f = kickPriorityTeamEvents([point({ windowFromS: 107.46, windowToS: 171.25, friends: [friend({ cdRemainingS: 6, feasible: false }), mate] })], owner, probes)[0]!.facts;
    expect(f).toMatchObject({ windowFrom: "1:47", windowTo: "2:51" });
  });
});

describe("team form: a rooted melee kicker (triage kick-priority F-P2)", () => {
  const mate = friend({ id: "P2", name: "Mage2", distanceYd: 31 });
  const why = (over: Partial<KickPriorityFriend>) =>
    kickPriorityTeamEvents([point({ friends: [friend({ feasible: false, ...over }), mate] })], owner, probes)[0]!.facts.ownerWhy;
  it("ready, castable, rooted for the whole cast → named as rooted, with the distance", () => {
    expect(why({ inRange: false, rootedThroughCast: true, distanceYd: 8.41 })).toBe("rooted through the cast (8 yd)");
  });
  it("out of range without the root stays out of range; cooldown and lock outrank the root", () => {
    expect(why({ inRange: false, distanceYd: 20 })).toBe("out of range (20 yd)");
    expect(why({ inRange: false, rootedThroughCast: true, cdRemainingS: 6 })).toBe("on cooldown (6s)");
    expect(why({ inRange: false, rootedThroughCast: true, locked: true })).toBe("locked");
  });
  it("a rooted owner whose range is unknown is not relabelled", () => {
    expect(why({ inRange: null, rootedThroughCast: true })).toBe("unknown");
  });
});

