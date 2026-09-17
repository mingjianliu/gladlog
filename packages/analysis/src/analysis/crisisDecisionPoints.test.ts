import {
  CombatUnitClass,
  CombatUnitReaction,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

// the [STATE] renderer's own HP sampler — imported, not re-derived
import { gridHpPct } from "../utils/cooldowns";
import {
  CRISIS_HP_PCT,
  CRISIS_MIN_DMG2S,
  crisisDecisionPoints,
  DEATH_LOOKAHEAD_MS,
  RESPONSE_WINDOW_MS,
  TEAM_DEATH_LOOKAHEAD_MS,
} from "./crisisDecisionPoints";

const T0 = 1_000_000;
// `logLine.timestamp` + `advancedActorId` are what `gridHpPct`
// (utils/cooldowns.ts) reads — the [STATE] tick's sampler that the render-grid
// re-anchor now shares; `timestamp` is what this module's own `samplesOf`
// reads. A fixture must carry both or the two halves disagree about when the
// sample happened, which is the very defect the anchor exists to remove.
const hp = (
  t: number,
  cur: number,
  max = 100,
  x = 0,
  y = 0,
  actorId = "H",
) => ({
  timestamp: T0 + t,
  logLine: { timestamp: T0 + t },
  advancedActorId: actorId,
  advancedActorCurrentHp: cur,
  advancedActorMaxHp: max,
  advancedActorPositionX: x,
  advancedActorPositionY: y,
});
function unit(over: Record<string, unknown> = {}) {
  return {
    id: "H",
    name: "Heals-R",
    reaction: CombatUnitReaction.Friendly,
    info: { teamId: "0" },
    advancedActions: [hp(0, 100), hp(1000, 70), hp(2000, 38), hp(3000, 35)],
    damageIn: [
      {
        timestamp: T0 + 1500,
        srcUnitId: "E1",
        amount: -30,
        effectiveAmount: -30,
      },
    ],
    healIn: [],
    healOut: [],
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    deathRecords: [],
    ...over,
  };
}
function combat(owner: any, others: any[] = []) {
  const units: Record<string, any> = { [owner.id]: owner };
  for (const u of others) units[u.id] = u;
  return {
    startTime: T0,
    endTime: T0 + 60_000,
    units,
    startInfo: { bracket: "3v3" },
  };
}
const enemy = (id = "E1", extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  reaction: CombatUnitReaction.Hostile,
  info: { teamId: "1" },
  spellCastEvents: [],
  advancedActions: [],
  ...extra,
});

describe("crisisDecisionPoints", () => {
  it("emits one point at the downward crossing of CRISIS_HP_PCT with dmg2s and attackers", () => {
    const o = unit();
    const pts = crisisDecisionPoints(o, combat(o, [enemy()]));
    expect(pts).toHaveLength(1);
    expect(pts[0]!.hpPct).toBe(38);
    expect(pts[0]!.tSec).toBe(2);
    expect(pts[0]!.dmg2s).toBe(0.3);
    expect(pts[0]!.attackers2s).toBe(1);
    expect(CRISIS_HP_PCT).toBe(0.4);
  });

  it("merges a second crossing inside CRISIS_WINDOW_GAP_MS, keeps one after it", () => {
    const o = unit({
      advancedActions: [
        hp(0, 100),
        hp(1000, 38),
        hp(2000, 45),
        hp(3000, 39),
        hp(9000, 60),
        hp(10000, 30),
      ],
    });
    expect(crisisDecisionPoints(o, combat(o))).toHaveLength(2);
  });

  it("selfHeal response: owner heals self ≥15% maxHP inside the window with a spell cast in the window", () => {
    const o = unit({
      spellCastEvents: [{ timestamp: T0 + 2400, spellId: "2061" }],
      healIn: [
        {
          timestamp: T0 + 2500,
          srcUnitId: "H",
          spellId: "2061",
          amount: 20,
          effectiveAmount: 20,
        },
      ],
    });
    const p = crisisDecisionPoints(o, combat(o))[0]!;
    expect(p.responses.selfHeal).toBe(true);
    expect(p.responses.carriedHeal).toBe(false);
    expect(p.selfHealPct).toBe(20);
    expect(p.responded).toBe(true);
  });

  // BACKLOG #43 (user ruling 2026-09-14/17): a low-HP talent proc answers the
  // crisis on its own; the cast it made is the proc's, not the owner's press
  it("proc: Well-Honed Instincts marker + its Frenzied Regeneration cast in the window → proc, not selfHeal, responded", () => {
    const o = unit({
      auraEvents: [
        {
          timestamp: T0 + 2100,
          spellId: "382912",
          srcUnitId: "H",
          destUnitId: "H",
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 2100 },
        },
      ],
      spellCastEvents: [{ timestamp: T0 + 2100, spellId: "22842" }],
      healIn: [
        {
          timestamp: T0 + 2500,
          srcUnitId: "H",
          spellId: "22842",
          amount: 20,
          effectiveAmount: 20,
        },
      ],
    });
    const p = crisisDecisionPoints(o, combat(o))[0]!;
    expect(p.responses.proc).toBe(true);
    expect(p.responses.selfHeal).toBe(false);
    expect(p.responses.carriedHeal).toBe(false);
    expect(p.procNames).toEqual(["Well-Honed Instincts"]);
    expect(p.responded).toBe(true);
    // the same cast WITHOUT the marker is the owner's own press
    const pressed = unit({
      spellCastEvents: [{ timestamp: T0 + 2100, spellId: "22842" }],
      healIn: o.healIn,
    });
    const q = crisisDecisionPoints(pressed, combat(pressed))[0]!;
    expect(q.responses.proc).toBe(false);
    expect(q.responses.selfHeal).toBe(true);
    expect(q.procNames).toEqual([]);
  });

  // GH #93 (user ruling 2026-09-15): a HoT pressed before the window still
  // answers the crisis but is not a press
  it("carried heal: ≥15% from a HoT cast before the window is carriedHeal, not selfHeal, still responded", () => {
    const o = unit({
      spellCastEvents: [{ timestamp: T0 - 5000, spellId: "774" }],
      healIn: [
        {
          timestamp: T0 + 2500,
          srcUnitId: "H",
          spellId: "774",
          amount: 20,
          effectiveAmount: 20,
        },
      ],
    });
    const p = crisisDecisionPoints(o, combat(o))[0]!;
    expect(p.responses.selfHeal).toBe(false);
    expect(p.responses.carriedHeal).toBe(true);
    expect(p.responded).toBe(true);
  });

  it("wall response counts only bigDefensiveSpellIds (Desperate Prayer yes, Divine Hymn no)", () => {
    const yes = unit({
      spellCastEvents: [{ timestamp: T0 + 2500, spellId: "19236" }],
    });
    const no = unit({
      spellCastEvents: [{ timestamp: T0 + 2500, spellId: "64843" }],
    });
    expect(crisisDecisionPoints(yes, combat(yes))[0]!.responses.wall).toBe(
      true,
    );
    expect(crisisDecisionPoints(no, combat(no))[0]!.responses.wall).toBe(false);
  });

  it("protective response (user ruling 2026-09-14): Divine Hymn / Power Word: Shield count as answered, not as a wall", () => {
    for (const id of ["64843", "17", "586", "215769", "366155"]) {
      const o = unit({
        spellCastEvents: [{ timestamp: T0 + 2500, spellId: id }],
      });
      const p = crisisDecisionPoints(o, combat(o))[0]!;
      expect(p.responses.protective).toBe(true);
      expect(p.responses.wall).toBe(false);
      expect(p.responded).toBe(true);
    }
  });

  it("control response: owner casts a CC / root / interrupt on an enemy", () => {
    const o = unit({
      spellCastEvents: [
        { timestamp: T0 + 2800, spellId: "8122", destUnitId: "E1" },
      ],
    }); // Psychic Scream
    expect(
      crisisDecisionPoints(o, combat(o, [enemy()]))[0]!.responses.control,
    ).toBe(true);
  });

  it("peel: a teammate casts CC on the owner's attacker (does not count as responded)", () => {
    const mate = {
      ...enemy("M1"),
      reaction: CombatUnitReaction.Friendly,
      info: { teamId: "0" },
      spellCastEvents: [
        { timestamp: T0 + 2600, spellId: "8122", destUnitId: "E1" },
      ],
    };
    const o = unit();
    const p = crisisDecisionPoints(o, combat(o, [enemy(), mate]))[0]!;
    expect(p.responses.peel).toBe(true);
    expect(p.responded).toBe(false);
  });

  it("kite: distance to nearest attacker grows ≥ 8 yd over the window", () => {
    const o = unit({
      advancedActions: [
        hp(0, 100, 100, 0, 0),
        hp(1000, 70, 100, 0, 0),
        hp(2000, 38, 100, 0, 0),
        hp(5000, 35, 100, 12, 0),
      ],
    });
    const e = enemy("E1", {
      advancedActions: [hp(2000, 100, 100, 1, 0), hp(5000, 100, 100, 1, 0)],
    });
    expect(crisisDecisionPoints(o, combat(o, [e]))[0]!.responses.kite).toBe(
      true,
    );
  });

  // GH #93: the same distance gain opened by the ATTACKER walking away is
  // attackerMoved, not kite — still answered, never described as a kite
  it("attacker moving away: kitedAway holds but the owner stood still → attackerMoved, not kite", () => {
    const o = unit({
      advancedActions: [
        hp(0, 100, 100, 0, 0),
        hp(1000, 70, 100, 0, 0),
        hp(2000, 38, 100, 0, 0),
        hp(5000, 35, 100, 0, 0),
      ],
    });
    const e = enemy("E1", {
      advancedActions: [hp(2000, 100, 100, 1, 0), hp(5000, 100, 100, 13, 0)],
    });
    const p = crisisDecisionPoints(o, combat(o, [e]))[0]!;
    expect(p.responses.kite).toBe(false);
    expect(p.responses.attackerMoved).toBe(true);
    expect(p.responded).toBe(true);
  });

  // user ruling 2026-09-14: a trinket alone is no answer; a trinket that opens
  // a credited action within RESPONSE_WINDOW_MS of the press is, even when the
  // action lands after the crisis window (t + 3 s) closes
  it("trinket alone is not a response; trinket + wall within 3 s of the press is, even past the window", () => {
    const alone = unit({
      spellCastEvents: [
        {
          timestamp: T0 + 4500,
          spellId: "336126",
          logLine: { event: "SPELL_CAST_SUCCESS" },
        },
      ],
    });
    expect(crisisDecisionPoints(alone, combat(alone))[0]!.responded).toBe(
      false,
    );
    const followed = unit({
      spellCastEvents: [
        { timestamp: T0 + 4500, spellId: "336126" },
        // crossing at t = 2 s → window ends at 5 s; the wall lands at 6.5 s
        { timestamp: T0 + 6500, spellId: "19236" },
      ],
    });
    const p = crisisDecisionPoints(followed, combat(followed))[0]!;
    expect(p.responses.wall).toBe(true);
    expect(p.responded).toBe(true);
  });

  it("mobility press late in the window counts when distance opens within 3 s of the press", () => {
    const o = unit({
      advancedActions: [
        hp(0, 100, 100, 0, 0),
        hp(1000, 70, 100, 0, 0),
        hp(2000, 38, 100, 0, 0),
        hp(4500, 36, 100, 0, 0),
        hp(5000, 35, 100, 0, 0),
        hp(7500, 35, 100, 12, 0),
      ],
      spellCastEvents: [{ timestamp: T0 + 4500, spellId: "190784" }],
    });
    const e = enemy("E1", {
      advancedActions: [
        hp(2000, 100, 100, 1, 0),
        hp(4500, 100, 100, 1, 0),
        hp(5000, 100, 100, 1, 0),
        hp(7500, 100, 100, 1, 0),
      ],
    });
    const p = crisisDecisionPoints(o, combat(o, [e]))[0]!;
    expect(p.responses.kite).toBe(true);
  });

  it("gate 1: crossing inside enemy hard CC → inCC=true, feasible=false", () => {
    const o = unit({
      auraEvents: [
        {
          timestamp: T0 + 1200,
          spellId: "408",
          srcUnitId: "E1",
          destUnitId: "H",
          auraType: "DEBUFF",
          logLine: { event: "SPELL_AURA_APPLIED" },
        },
        {
          timestamp: T0 + 6000,
          spellId: "408",
          srcUnitId: "E1",
          destUnitId: "H",
          auraType: "DEBUFF",
          logLine: { event: "SPELL_AURA_REMOVED" },
        },
      ],
    });
    const p = crisisDecisionPoints(o, combat(o))[0]!;
    expect(p.inCC).toBe(true);
    expect(p.feasible).toBe(false);
  });

  it("C1: official DR silence category locks the school — Strangulate 47476 and Garrote-Silence 1330 (only 3/61 of the official category was covered by the hand `interrupts` set before this fix)", () => {
    for (const sid of ["47476", "1330"]) {
      const o = unit({
        auraEvents: [
          {
            timestamp: T0 + 1200,
            spellId: sid,
            srcUnitId: "E1",
            destUnitId: "H",
            auraType: "DEBUFF",
            logLine: { event: "SPELL_AURA_APPLIED" },
          },
          {
            timestamp: T0 + 6000,
            spellId: sid,
            srcUnitId: "E1",
            destUnitId: "H",
            auraType: "DEBUFF",
            logLine: { event: "SPELL_AURA_REMOVED" },
          },
        ],
      });
      const p = crisisDecisionPoints(o, combat(o))[0]!;
      expect(p.lockedOut).toBe(true);
    }
  });

  it("I2: an orphan REMOVED (aura already up before the round started, no APPLIED seen) still counts as inCC at a crossing before the REMOVED — pairing goes through auraIntervals.ts's official-duration backdating, not a private copy", () => {
    const o = unit({
      advancedActions: [hp(0, 100), hp(500, 70), hp(1000, 38), hp(1500, 35)],
      auraEvents: [
        {
          // orphan REMOVED at t+2s (t = combat start) for Kidney Shot (408,
          // no official duration data) — no matching APPLIED was ever logged
          timestamp: T0 + 2000,
          spellId: "408",
          srcUnitId: "E1",
          destUnitId: "H",
          auraType: "DEBUFF",
          logLine: { event: "SPELL_AURA_REMOVED" },
        },
      ],
    });
    const p = crisisDecisionPoints(o, combat(o))[0]!;
    expect(p.tSec).toBe(1); // crossing at t+1s
    expect(p.inCC).toBe(true);
  });

  it("I2: a fear (5782) closed by SPELL_AURA_BROKEN does NOT count as inCC after the break — the old hand-rolled pairing only listened for SPELL_AURA_REMOVED and left this aura open until end-of-match+8s, a false positive", () => {
    const o = unit({
      advancedActions: [hp(0, 100), hp(500, 70), hp(1000, 38), hp(1500, 35)],
      auraEvents: [
        {
          timestamp: T0 + 200,
          spellId: "5782",
          srcUnitId: "E1",
          destUnitId: "H",
          auraType: "DEBUFF",
          logLine: { event: "SPELL_AURA_APPLIED" },
        },
        {
          timestamp: T0 + 700,
          spellId: "5782",
          srcUnitId: "E1",
          destUnitId: "H",
          auraType: "DEBUFF",
          logLine: { event: "SPELL_AURA_BROKEN" },
        },
      ],
    });
    const p = crisisDecisionPoints(o, combat(o))[0]!;
    expect(p.tSec).toBe(1); // crossing at t+1s, after the break at t+0.7s
    expect(p.inCC).toBe(false);
  });

  it("gate 2: SPELL_INTERRUPT on the owner ≤1.5s before the crossing → lockedOut", () => {
    const o = unit({
      actionIn: [
        { timestamp: T0 + 1000, logLine: { event: LogEvent.SPELL_INTERRUPT } },
      ],
    });
    const p = crisisDecisionPoints(o, combat(o))[0]!;
    expect(p.lockedOut).toBe(true);
    expect(p.feasible).toBe(false);
  });

  it("gate 4: owner dies before t+3s → diedInWindow, feasible=false", () => {
    const o = unit({
      deathRecords: [{ timestamp: T0 + 2000 + RESPONSE_WINDOW_MS - 1 }],
    });
    const p = crisisDecisionPoints(o, combat(o))[0]!;
    expect(p.diedInWindow).toBe(true);
    expect(p.feasible).toBe(false);
  });

  it("enemyBurst: an enemy offensive major CD cast within 8s before the crossing", () => {
    const e = enemy("E1", {
      spellCastEvents: [{ timestamp: T0 + 500, spellId: "31884" }],
    }); // Avenging Wrath
    const o = unit();
    expect(crisisDecisionPoints(o, combat(o, [e]))[0]!.enemyBurst).toBe(true);
  });

  it("no advanced HP samples → no points", () => {
    const o = unit({ advancedActions: [] });
    expect(crisisDecisionPoints(o, combat(o))).toEqual([]);
  });

  it("gate 5 (spec §1b): dangerous is false below CRISIS_MIN_DMG2S, true at the boundary (inclusive)", () => {
    const low = unit({
      damageIn: [
        {
          timestamp: T0 + 1500,
          srcUnitId: "E1",
          amount: -5,
          effectiveAmount: -5,
        },
      ],
    }); // dmg2s = 0.05
    const boundary = unit({
      damageIn: [
        {
          timestamp: T0 + 1500,
          srcUnitId: "E1",
          amount: -10,
          effectiveAmount: -10,
        },
      ],
    }); // dmg2s = 0.10, exactly CRISIS_MIN_DMG2S
    expect(CRISIS_MIN_DMG2S).toBe(0.1);
    expect(
      crisisDecisionPoints(low, combat(low, [enemy()]))[0]!.dangerous,
    ).toBe(false);
    expect(
      crisisDecisionPoints(boundary, combat(boundary, [enemy()]))[0]!.dangerous,
    ).toBe(true);
  });

  it("diedWithin10s (table-only outcome, spec §1b): true when a deathRecords entry lies in (t, t+10000], false otherwise", () => {
    expect(DEATH_LOOKAHEAD_MS).toBe(10_000);
    const t = T0 + 2000; // the crossing timestamp for the default unit()
    const atEdge = unit({ deathRecords: [{ timestamp: t + 10_000 }] });
    const justPast = unit({ deathRecords: [{ timestamp: t + 10_001 }] });
    const atCrossing = unit({ deathRecords: [{ timestamp: t }] });
    const none = unit({ deathRecords: [] });
    expect(
      crisisDecisionPoints(atEdge, combat(atEdge, [enemy()]))[0]!.diedWithin10s,
    ).toBe(true);
    expect(
      crisisDecisionPoints(justPast, combat(justPast, [enemy()]))[0]!
        .diedWithin10s,
    ).toBe(false);
    // A death AT the crossing second is no longer a `diedWithin10s=false`
    // point — it is no point at all. `[STATE]` renders `unit:dead` from
    // Math.floor(deathSeconds) on (isDeadAtRenderSecond), so the render-grid
    // anchor refuses to place a numeric HP claim on that second: the
    // `(t, t+10000]` window's exclusion of `t` itself is now enforced one
    // layer earlier, by dropping the crossing.
    expect(
      crisisDecisionPoints(atCrossing, combat(atCrossing, [enemy()])),
    ).toEqual([]);
    expect(
      crisisDecisionPoints(none, combat(none, [enemy()]))[0]!.diedWithin10s,
    ).toBe(false);
  });

  it("friendDiedWithin15s (table-only outcome, spec §1c): true when any friendly player's deathRecords entry — owner's own death included — lies in (t, t+15000]; an enemy-only death does not count", () => {
    expect(TEAM_DEATH_LOOKAHEAD_MS).toBe(15_000);
    const t = T0 + 2000; // the crossing timestamp for the default unit()

    const mate = {
      ...enemy("M1"),
      reaction: CombatUnitReaction.Friendly,
      info: { teamId: "0" },
      deathRecords: [{ timestamp: t + 12_000 }],
    };
    const teammateDies = unit();
    expect(
      crisisDecisionPoints(
        teammateDies,
        combat(teammateDies, [enemy(), mate]),
      )[0]!.friendDiedWithin15s,
    ).toBe(true);

    const enemyDies = {
      ...enemy("E1"),
      deathRecords: [{ timestamp: t + 5000 }],
    };
    const noFriendDeath = unit();
    expect(
      crisisDecisionPoints(
        noFriendDeath,
        combat(noFriendDeath, [enemyDies]),
      )[0]!.friendDiedWithin15s,
    ).toBe(false);

    const ownerDies = unit({ deathRecords: [{ timestamp: t + 8000 }] });
    expect(
      crisisDecisionPoints(ownerDies, combat(ownerDies, [enemy()]))[0]!
        .friendDiedWithin15s,
    ).toBe(true);
  });

  it("feasible is unaffected by dangerous — gates 1/2/4 alone decide it", () => {
    const lowDmgFree = unit({
      damageIn: [
        {
          timestamp: T0 + 1500,
          srcUnitId: "E1",
          amount: -5,
          effectiveAmount: -5,
        },
      ],
    });
    const p1 = crisisDecisionPoints(
      lowDmgFree,
      combat(lowDmgFree, [enemy()]),
    )[0]!;
    expect(p1.dangerous).toBe(false);
    expect(p1.feasible).toBe(true);

    const highDmgCCd = unit({
      auraEvents: [
        {
          timestamp: T0 + 1200,
          spellId: "408",
          srcUnitId: "E1",
          destUnitId: "H",
          auraType: "DEBUFF",
          logLine: { event: "SPELL_AURA_APPLIED" },
        },
        {
          timestamp: T0 + 6000,
          spellId: "408",
          srcUnitId: "E1",
          destUnitId: "H",
          auraType: "DEBUFF",
          logLine: { event: "SPELL_AURA_REMOVED" },
        },
      ],
    }); // default damageIn → dmg2s 0.3 → dangerous
    const p2 = crisisDecisionPoints(
      highDmgCCd,
      combat(highDmgCCd, [enemy()]),
    )[0]!;
    expect(p2.dangerous).toBe(true);
    expect(p2.feasible).toBe(false);
  });

  it("attackers2s resolves pets/guardians to their owning player, ignores sources with no unit (measured 2026-08-29: a 3-enemy round rendered attackers=15, 13 of which were one warlock's imps/hounds)", () => {
    const o = unit({
      damageIn: [
        {
          timestamp: T0 + 1200,
          srcUnitId: "E1",
          amount: -10,
          effectiveAmount: -10,
        },
        {
          timestamp: T0 + 1400,
          srcUnitId: "P1",
          amount: -10,
          effectiveAmount: -10,
        },
        {
          timestamp: T0 + 1600,
          srcUnitId: "P2",
          amount: -10,
          effectiveAmount: -10,
        },
        {
          timestamp: T0 + 1700,
          srcUnitId: "GHOST", // no unit for this id at all
          amount: -10,
          effectiveAmount: -10,
        },
      ],
    });
    const e = enemy("E1");
    const p1 = {
      id: "P1",
      ownerId: "E1",
      info: undefined,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [],
      advancedActions: [],
    };
    const p2 = {
      id: "P2",
      ownerId: "E1",
      info: undefined,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [],
      advancedActions: [],
    };
    const p = crisisDecisionPoints(o, combat(o, [e, p1, p2]))[0]!;
    expect(p.attackers2s).toBe(1);
  });
});

describe("crisisDecisionPoints — role='dps' gate 3 (spec §1d, GH #59)", () => {
  // A DPS owner (Rogue, any spec — class-wide ability list). Root spell 339
  // (Entangling Roots) is a real official "roots"-typed spell; Cloak of
  // Shadows 31224 is a real Rogue Defensive ability in bigDefensiveSpellIds;
  // Kidney Shot 408 is a real Rogue Control ability. `unit()`'s default owner
  // fixture is reused verbatim (same HP/damage crossing shape), only
  // `class`/`spec`/response evidence differ per test.
  const dpsUnit = (over: Record<string, unknown> = {}) =>
    unit({
      class: CombatUnitClass.Rogue,
      spec: "259", // Assassination — non-healer, irrelevant to classMetadata (keyed by class only)
      ...over,
    });
  const rootedFromE1 = (extraApplied: number = T0 + 1200) => [
    {
      timestamp: extraApplied,
      spellId: "339", // Entangling Roots
      srcUnitId: "E1",
      destUnitId: "H",
      auraType: "DEBUFF",
      logLine: { event: "SPELL_AURA_APPLIED" },
    },
    {
      timestamp: T0 + 6000,
      spellId: "339",
      srcUnitId: "E1",
      destUnitId: "H",
      auraType: "DEBUFF",
      logLine: { event: "SPELL_AURA_REMOVED" },
    },
  ];
  // A cast far enough before combat start that any real cooldown has long
  // since elapsed by the crossing (t=T0+2000) — puts the ability in the
  // ledger via cast evidence, and cdAvailableAt reads it as long available,
  // without needing to know the ability's exact cooldown length.
  const castLongAgo = (spellId: string) => [
    {
      timestamp: T0 - 200_000,
      spellId,
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS },
    },
  ];

  it("rooted, no wall/control ready → hasTool=false, feasible=false", () => {
    const o = dpsUnit({ auraEvents: rootedFromE1() });
    const p = crisisDecisionPoints(o, combat(o, [enemy()]), "dps")[0]!;
    expect(p.hasTool).toBe(false);
    expect(p.feasible).toBe(false);
  });

  it("rooted but a personal wall (Cloak of Shadows, bigDefensiveSpellIds) is ready → hasTool=true, feasible=true", () => {
    const o = dpsUnit({
      auraEvents: rootedFromE1(),
      spellCastEvents: castLongAgo("31224"),
    });
    const p = crisisDecisionPoints(o, combat(o, [enemy()]), "dps")[0]!;
    expect(p.hasTool).toBe(true);
    expect(p.feasible).toBe(true);
  });

  it("rooted but a Control-tagged major CD (Kidney Shot) is ready → hasTool=true, feasible=true", () => {
    const o = dpsUnit({
      auraEvents: rootedFromE1(),
      spellCastEvents: castLongAgo("408"),
    });
    const p = crisisDecisionPoints(o, combat(o, [enemy()]), "dps")[0]!;
    expect(p.hasTool).toBe(true);
    expect(p.feasible).toBe(true);
  });

  it("not rooted, nothing ready → hasTool=true trivially (still free to move) → feasible=true", () => {
    const o = dpsUnit();
    const p = crisisDecisionPoints(o, combat(o, [enemy()]), "dps")[0]!;
    expect(p.hasTool).toBe(true);
    expect(p.feasible).toBe(true);
  });

  it("healer role: rooted still doesn't affect gate 3 — hasTool=true, feasible unaffected by root (gate 3 trivially true for a healer)", () => {
    const o = unit({ auraEvents: rootedFromE1() }); // role defaults to "healer"
    const p = crisisDecisionPoints(o, combat(o, [enemy()]))[0]!;
    expect(p.hasTool).toBe(true);
    expect(p.feasible).toBe(true);
  });

  it("kit not resolvable (no class on the unit) → wallReady/controlReady stay false, gate 3 reduces to !rooted", () => {
    // dpsUnit() without a `class` override still carries no `class` unless
    // set — construct directly so extractMajorCooldowns' classMetadata.find
    // returns undefined and the ledger comes back empty, exercising the same
    // "kit not resolvable" path the try/catch around extractMajorCooldowns
    // guards.
    const o = unit({ spellCastEvents: castLongAgo("31224") }); // no `class` at all
    const rooted = crisisDecisionPoints(
      unit({
        auraEvents: rootedFromE1(),
        spellCastEvents: castLongAgo("31224"),
      }),
      combat(o, [enemy()]),
      "dps",
    )[0]!;
    // no class → extractMajorCooldowns' classMetadata.find(...) finds
    // nothing → wallCds/controlCds stay empty regardless of cast evidence →
    // hasTool reduces to !rooted, which is false here.
    expect(rooted.hasTool).toBe(false);
    expect(rooted.feasible).toBe(false);
  });
});

/**
 * Render-grid anchoring (2026-08-30, CLAUDE.md Shared-Predicate Rule).
 *
 * A decision point's `hpPct` is rendered next to a floored second, and
 * `matchTimeline.ts`'s `[STATE]` tick renders `gridHpPct(unit, matchStartMs +
 * s*1000)` next to the same displayed second. Sampling the raw advancedAction
 * instead put the two in contradiction on 155/167 covered cd-hoarded lines and
 * 7/8 crisis-no-response lines across the 309-prompt A/B corpus; these cases
 * pin the anchor that removed it. The equality assertion imports `gridHpPct`
 * from utils/cooldowns — literally the symbol the STATE renderer calls, so a
 * change to either side can only move both together.
 */
describe("crisisDecisionPoints — render-grid anchoring", () => {
  it("a crossing sampled between two whole seconds reports the grid second, not the raw instant", () => {
    const o = unit({
      advancedActions: [hp(0, 100), hp(1000, 70), hp(2400, 38), hp(3000, 35)],
    });
    const p = crisisDecisionPoints(o, combat(o, [enemy()]))[0]!;
    // raw crossing is at 2.4s; the rendered second is 2
    expect(p.tSec).toBe(2);
    expect(Number.isInteger(p.tSec)).toBe(true);
    expect(p.tMs).toBe(T0 + 2000);
  });

  it("hpPct IS the [STATE] tick's own reading at tSec (same sampler, same instant)", () => {
    for (const actions of [
      [hp(0, 100), hp(1000, 70), hp(2400, 38), hp(3000, 35)],
      [hp(0, 100), hp(900, 90), hp(1800, 27), hp(4000, 22)],
    ]) {
      const o = unit({ advancedActions: actions });
      for (const p of crisisDecisionPoints(o, combat(o, [enemy()]))) {
        expect(p.hpPct).toBe(gridHpPct(o as never, T0 + p.tSec * 1000));
        expect(p.hpPct).toBeLessThanOrEqual(Math.round(CRISIS_HP_PCT * 100));
      }
    }
  });

  it("a dip that no whole second can see is dropped — the rendered prompt cannot support it", () => {
    // HP is only below 40% between 1.4s and 1.45s; every grid second in reach
    // samples a 100% reading nearer than the dip, so no [STATE] tick would
    // ever show a crisis and no candidate may cite one.
    const o = unit({
      advancedActions: [
        hp(0, 100),
        hp(1000, 100),
        hp(1400, 38),
        hp(1450, 100),
        hp(2000, 100),
        hp(3000, 100),
        hp(4000, 100),
        hp(5000, 100),
        hp(6000, 100),
        hp(7000, 100),
      ],
    });
    expect(crisisDecisionPoints(o, combat(o, [enemy()]))).toEqual([]);
  });
});
