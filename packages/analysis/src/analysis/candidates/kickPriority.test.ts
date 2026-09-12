import { describe, expect, it } from "vitest";

import {
  type IKickPriorityPoint,
  isOwnerMissedKick,
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
    expect(ev[0]!.facts).toMatchObject({ ownerWhy: "on cooldown (6s)", teammates: "Mage2 (Counterspell, 31 yd)", refDeathInterrupted: "31" });
    // owner feasible → the owner form owns it, no team card
    expect(kickPriorityTeamEvents([point({ friends: [friend(), mate] })], owner, probes)).toHaveLength(0);
    // teammate out of range → nothing (range is part of the predicate)
    expect(kickPriorityTeamEvents([point({ friends: [friend({ cdRemainingS: 6, feasible: false }), { ...mate, inRange: false, feasible: false }] })], owner, probes)).toHaveLength(0);
    // owner has no interrupt at all
    expect(kickPriorityTeamEvents([point({ friends: [mate] })], owner, probes)[0]!.facts.ownerWhy).toBe("no interrupt");
  });
});
