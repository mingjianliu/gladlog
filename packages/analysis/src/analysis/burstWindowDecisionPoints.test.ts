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

import { ENEMY_HEAL_CD_IDS } from "../data/enemyHealCds";
import { ensureAnalysisData } from "../data/ensure";
import { analyzePlayerCCAndTrinket } from "../utils/ccTrinketAnalysis";
import { extractMajorCooldowns } from "../utils/cooldowns";
import {
  aimedControlUpAt,
  BURST_HEAL_CD_IDS,
  BURST_LEAD_CD_EXCLUDED_IDS,
  BURST_OUTCOME_FIELDS,
  BURST_RESPONSE_WINDOW_MS,
  BURST_TRIAGE_MIN_HP_DROP_PP,
  burstExtrasLabel,
  type BurstResponseCast,
  burstTroughReadEnd,
  burstWindowDecisionPoints,
  canBeWallResponse,
  controlLandedResponses,
  landedPreOpenerStillUp,
  pressDidNotReachPressured,
  pressWentElsewhere,
  TEAM_HEAL_WALL_ANSWER_IDS,
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
/** A friendly that owns NO cooldown: an Arms Warrior with no talents and no
 * casts. The default Balance Druid owns Barkskin as a spec baseline (triage
 * cd-hoarded F-W6, 2026-10-01); the default ledger this engine reads leaves
 * that row out, but "nobody had a tool" cases should not lean on it. */
const NO_KIT = {
  class: CombatUnitClass.Warrior,
  spec: CombatUnitSpec.Warrior_Arms,
  info: { teamId: "0", specId: "71" },
};
const DRUID = {
  class: CombatUnitClass.Druid,
  spec: CombatUnitSpec.Druid_Balance,
  info: { teamId: "0", specId: "102" },
};

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

  // F16 retest idx 51 (e49b7c3b 3:24): Bear Form, a pressed Frenzied
  // Regeneration and a hunter's Roar of Sacrifice on the dying druid — the
  // crisis side's answers, absent from the burst window's
  it("the crisis readers' answers count: Bear Form / Frenzied Regeneration (own), Roar of Sacrifice (a mate's, on the pressured friend)", () => {
    for (const id of ["5487", "22842"]) {
      const pts = burstWindowDecisionPoints(
        combat([
          pressuredFriend({ spellCastEvents: [cast(id, 13)] }),
          enemyWithBurst(),
        ]),
      );
      // Bear Form a wall; Frenzied Regeneration a heal (DB2 can reach
      // others' reading), held to its caster by `answersPressured`
      expect(
        pts[0]!.responseCasts.map((r) => r.category),
        id,
      ).toEqual([id === "5487" ? "wall" : "healCd"]);
      expect(pts[0]!.responded, id).toBe(true);
    }
    const hunter = friendly({
      id: "F2",
      name: "Hunter-R",
      advancedActions: hpTrack("F2", 0, 40, 100),
      spellCastEvents: [cast("53480", 14, "F1")],
    });
    const pts = burstWindowDecisionPoints(
      combat([pressuredFriend(), hunter, enemyWithBurst()]),
    );
    expect(pts[0]!.responses.external).toBe(true);
    expect(pts[0]!.responded).toBe(true);
    // control: a Roar the hunter kept for itself is the hunter's own wall,
    // which `answersPressured` holds to its caster — still a press, so
    // `responded` (any friendly) is true, as for a teammate's Barkskin
    const selfRoar = burstWindowDecisionPoints(
      combat([
        pressuredFriend(),
        friendly({ ...hunter, spellCastEvents: [cast("53480", 14, "F2")] }),
        enemyWithBurst(),
      ]),
    );
    expect(selfRoar[0]!.responses.external).toBe(false);
    expect(selfRoar[0]!.responses.wall).toBe(true);
  });

  // T180 (rulings R65 / R68): a press that went elsewhere is no answer for
  // the pressured unit
  it("an external aimed at another teammate, or another unit's self-only heal, does not make the window responded; nor does another unit's own self-protection wall (R81)", () => {
    const third = friendly({
      id: "F3",
      name: "Third-R",
      advancedActions: hpTrack("F3", 0, 40, 100),
    });
    const mate = (casts: any[]) =>
      friendly({
        id: "F2",
        name: "Hunter-R",
        advancedActions: hpTrack("F2", 0, 40, 100),
        spellCastEvents: casts,
      });
    const run = (casts: any[]) =>
      burstWindowDecisionPoints(
        combat([pressuredFriend(), mate(casts), third, enemyWithBurst()]),
      )[0]!;
    // Roar of Sacrifice on the third player: an external, pressed, elsewhere
    const roar = run([cast("53480", 14, "F3")]);
    expect(roar.pressured!.unitId).toBe("F1");
    expect(roar.responses.external).toBe(true);
    expect(pressWentElsewhere(roar.pressured!, roar.responseCasts[0]!)).toBe(
      true,
    );
    expect(roar.responded).toBe(false);
    // the same Roar on the pressured player answers
    expect(run([cast("53480", 14, "F1")]).responded).toBe(true);
    // Exhilaration: a healing CD that officially heals its caster alone.
    // Ruling R75: it cannot be given to the mate, so it is NOT a press that
    // went elsewhere — it is ignored: no answer, the window is unanswered
    const exh = run([cast("109304", 14)]);
    expect(exh.responseCasts.map((r) => r.category)).toEqual(["healCd"]);
    expect(pressWentElsewhere(exh.pressured!, exh.responseCasts[0]!)).toBe(
      false,
    );
    expect(
      pressDidNotReachPressured(exh.pressured!, exh.responseCasts[0]!),
    ).toBe(true);
    expect(exh.responded).toBe(false);
    // user ruling R81 (2026-11-19) changed R68 here: another unit's own
    // self-protection wall (Bear Form is a wall here) is ignored too — not
    // elsewhere, no answer. Before R81 this window was responded.
    const wall = run([cast("5487", 14)]);
    expect(wall.responseCasts.map((r) => r.category)).toEqual(["wall"]);
    expect(pressWentElsewhere(wall.pressured!, wall.responseCasts[0]!)).toBe(
      false,
    );
    expect(
      pressDidNotReachPressured(wall.pressured!, wall.responseCasts[0]!),
    ).toBe(true);
    expect(wall.responded).toBe(false);
  });

  // T224: R81 ignores another teammate's self-protection wall; R93 keeps
  // the four walls that are a healing cooldown for the team as answers
  it("another unit's self-protection wall is ignored, its team-heal wall answers, the pressured unit's own wall answers (R81 / R93)", () => {
    const mate = (id: string) =>
      friendly({
        id: "F2",
        name: "Mate-R",
        advancedActions: hpTrack("F2", 0, 40, 100),
        spellCastEvents: [cast(id, 13)],
      });
    const run = (id: string) =>
      burstWindowDecisionPoints(
        combat([pressuredFriend(), mate(id), enemyWithBurst()]),
      )[0]!;
    // Fade, Divine Shield, Ice Block, Barkskin: the presser's own protection
    for (const id of ["586", "642", "45438", BARKSKIN]) {
      const p = run(id);
      expect(
        p.responseCasts.map((r) => r.category),
        id,
      ).toEqual(["wall"]);
      expect(p.responded, id).toBe(false);
    }
    // Tree of Life, Ancient of Lore, Ultimate Penitence, pressed Spirit of
    // Redemption: walls by category, answers by R93
    for (const id of TEAM_HEAL_WALL_ANSWER_IDS) {
      const p = run(id);
      expect(
        p.responseCasts.map((r) => r.category),
        id,
      ).toEqual(["wall"]);
      expect(
        pressDidNotReachPressured(p.pressured!, p.responseCasts[0]!),
        id,
      ).toBe(false);
      expect(p.responded, id).toBe(true);
    }
    // the pressured unit's own Barkskin still answers
    const own = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ spellCastEvents: [cast(BARKSKIN, 13)] }),
        enemyWithBurst(),
      ]),
    )[0]!;
    expect(own.responded).toBe(true);
  });

  // R93's table is the whole kept side, and a healing major the enemy's
  // lines know (`ENEMY_HEAL_CD_IDS`) that can be a wall here must be in it:
  // adding one there without deciding it here turns this red
  it("the team-heal walls are exactly the four R93 signed, and hold every wall-capable id of ENEMY_HEAL_CD_IDS", () => {
    expect([...TEAM_HEAL_WALL_ANSWER_IDS].sort()).toEqual(
      ["215769", "33891", "421453", "473909"].sort(),
    );
    for (const id of TEAM_HEAL_WALL_ANSWER_IDS)
      expect(canBeWallResponse(id), id).toBe(true);
    // a copy row is never a press, so never a wall (Divine Hymn's tick)
    expect(canBeWallResponse("64844")).toBe(false);
    const drift = [...ENEMY_HEAL_CD_IDS].filter(
      (id) => canBeWallResponse(id) && !TEAM_HEAL_WALL_ANSWER_IDS.has(id),
    );
    expect(drift).toEqual([]);
  });

  // T181 (round-14 D28 / D29): dd3c5ad1 — a mage's Alter Time at +0.8 s
  // and its Mass Invisibility at +6.7 s under two openers read "no friendly
  // answered"
  it("a self-save that is no percentage wall is the pressured unit's own answer: Alter Time (press, return), Mass Invisibility", () => {
    for (const id of ["342245", "342247", "414664"]) {
      const pts = burstWindowDecisionPoints(
        combat([
          pressuredFriend({ spellCastEvents: [cast(id, 13)] }),
          enemyWithBurst(),
        ]),
      );
      expect(
        pts[0]!.responseCasts.map((r) => r.category),
        id,
      ).toEqual(["wall"]);
      expect(pts[0]!.responseCasts[0]!.casterId, id).toBe("F1");
      expect(pts[0]!.responded, id).toBe(true);
    }
  });

  // batch check B163: T181 had made a rogue's window answered through a
  // teammate mage's Mass Invisibility (7a4d43c8 2:21) and another unit's
  // through a mage's Alter Time return. R80 speaks of the unit's OWN: for
  // any other unit these three ids are ignored — and do not come back in
  // as "another unit's own wall" (R68), which Barkskin still does
  it("another unit's Alter Time (press, return) or Mass Invisibility does not answer the pressured unit's window; nor does its Barkskin (R81)", () => {
    const mate = (id: string) =>
      friendly({
        id: "F2",
        name: "Mage-R",
        advancedActions: hpTrack("F2", 0, 40, 100),
        spellCastEvents: [cast(id, 13)],
      });
    for (const id of ["342245", "342247", "414664"]) {
      const p = burstWindowDecisionPoints(
        combat([pressuredFriend(), mate(id), enemyWithBurst()]),
      )[0]!;
      expect(p.pressured!.unitId, id).toBe("F1");
      expect(
        p.responseCasts.map((r) => r.casterId),
        id,
      ).toEqual(["F2"]);
      expect(
        pressDidNotReachPressured(p.pressured!, p.responseCasts[0]!),
        id,
      ).toBe(true);
      expect(pressWentElsewhere(p.pressured!, p.responseCasts[0]!), id).toBe(
        false,
      );
      expect(p.responded, id).toBe(false);
    }
    // R81 (T224) changed R68: the teammate's Barkskin is ignored as well
    const wall = burstWindowDecisionPoints(
      combat([pressuredFriend(), mate(BARKSKIN), enemyWithBurst()]),
    )[0]!;
    expect(wall.responded).toBe(false);
    // …and the pressed unit's own, beside a teammate's, still answers
    const both = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ spellCastEvents: [cast("342245", 12)] }),
        mate("414664"),
        enemyWithBurst(),
      ]),
    )[0]!;
    expect(both.responded).toBe(true);
  });

  // user ruling R97 (T224): a teammate's Mass Invisibility answers the
  // pressured unit's window when that press's aura landed on the pressured
  // unit, however short. The "landed" side has corpus examples (605: 21 of
  // 24 presses; 7a4d43c8 2:21, 0.7 s of aura). The "did NOT land" side is
  // CONSTRUCTED: no 605 window is answered only by a Mass Invisibility
  // that missed the pressured unit (the 3 no-aura presses sit beside
  // another answer), so this case has no real-match fixture.
  it("R97: a teammate's Mass Invisibility answers when its aura landed on the pressured unit, and not when it did not (constructed)", () => {
    const t = T0 + 13_000;
    const invis = (dest: string, endMs?: number) => [
      {
        spellId: "414664",
        spellName: "Mass Invisibility",
        srcUnitId: "F2",
        srcUnitName: "Mage-R",
        destUnitId: dest,
        timestamp: t,
        logLine: { event: "SPELL_AURA_APPLIED", timestamp: t },
      },
      ...(endMs === undefined
        ? []
        : [
            {
              spellId: "414664",
              spellName: "Mass Invisibility",
              srcUnitId: "F2",
              srcUnitName: "Mage-R",
              destUnitId: dest,
              timestamp: endMs,
              logLine: { event: "SPELL_AURA_REMOVED", timestamp: endMs },
            },
          ]),
    ];
    const mage = () =>
      friendly({
        id: "F2",
        name: "Mage-R",
        advancedActions: hpTrack("F2", 0, 40, 100),
        spellCastEvents: [cast("414664", 13)],
        auraEvents: invis("F2"),
      });
    // landed on the pressured unit, broken 0.2 s later: an answer
    const landed = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ auraEvents: invis("F1", t + 200) }),
        mage(),
        enemyWithBurst(),
      ]),
    )[0]!;
    expect(landed.pressured!.unitId).toBe("F1");
    expect(landed.responseCasts[0]!.effectOnUnitIds).toContain("F1");
    expect(
      pressDidNotReachPressured(landed.pressured!, landed.responseCasts[0]!),
    ).toBe(false);
    expect(landed.responded).toBe(true);
    // CONSTRUCTED: the aura is on the mage and a third friendly, not on
    // the pressured unit — ignored
    const missed = burstWindowDecisionPoints(
      combat([
        pressuredFriend(),
        mage(),
        friendly({
          id: "F3",
          name: "Third-R",
          advancedActions: hpTrack("F3", 0, 40, 100),
          auraEvents: invis("F3"),
        }),
        enemyWithBurst(),
      ]),
    )[0]!;
    expect(missed.pressured!.unitId).toBe("F1");
    expect(
      pressDidNotReachPressured(missed.pressured!, missed.responseCasts[0]!),
    ).toBe(true);
    expect(missed.responded).toBe(false);
    // …and Alter Time has no such reading: an Alter Time aura on the
    // pressured unit from another mage does not make it an answer
    const alter = burstWindowDecisionPoints(
      combat([
        pressuredFriend({
          auraEvents: invis("F1").map((a) => ({ ...a, spellId: "342245" })),
        }),
        friendly({
          id: "F2",
          name: "Mage-R",
          advancedActions: hpTrack("F2", 0, 40, 100),
          spellCastEvents: [cast("342245", 13)],
        }),
        enemyWithBurst(),
      ]),
    )[0]!;
    expect(alter.responded).toBe(false);
  });

  // T222 (found by T182's capture, 7f107afb 2:24): Feign Death logs no cast
  // row — the press is its Survival Tactics aura — and never answered a
  // window
  it("a press that logs no cast row is read from its aura: Feign Death answers, flagged castless", () => {
    const t = T0 + 13_000;
    const pts = burstWindowDecisionPoints(
      combat([
        pressuredFriend({
          auraEvents: [
            {
              spellId: "202748",
              spellName: "Survival Tactics",
              srcUnitId: "F1",
              srcUnitName: "F1",
              destUnitId: "F1",
              timestamp: t,
              logLine: { event: "SPELL_AURA_APPLIED", timestamp: t },
            },
          ],
        }),
        enemyWithBurst(),
      ]),
    );
    expect(pts[0]!.responded).toBe(true);
    expect(pts[0]!.responseCasts).toMatchObject([
      { spellId: "5384", casterId: "F1", category: "wall", castless: true },
    ]);
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

const poly = (fromSec: number, toSec: number) => [
  {
    spellId: "118",
    spellName: "Polymorph",
    srcUnitId: "E1",
    srcUnitName: "Enemy-R",
    destUnitId: "F1",
    timestamp: T0 + fromSec * 1000,
    logLine: {
      event: LogEvent.SPELL_AURA_APPLIED,
      timestamp: T0 + fromSec * 1000,
    },
  },
  {
    spellId: "118",
    spellName: "Polymorph",
    srcUnitId: "E1",
    srcUnitName: "Enemy-R",
    destUnitId: "F1",
    timestamp: T0 + toSec * 1000,
    logLine: {
      event: LogEvent.SPELL_AURA_REMOVED,
      timestamp: T0 + toSec * 1000,
    },
  },
];

describe("burstWindowDecisionPoints — simultaneous opportunity (GH #103 follow-up)", () => {
  it("free only for the last half second of the window is not an opportunity", () => {
    // window [10, 18): CC until 17.5 — every whole second 10..17 is inside
    // it. The old gate ("not CC'd for the WHOLE window") called this feasible.
    const f = friendly({
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 60),
      spellCastEvents: [cast(BARKSKIN, 120)],
      auraEvents: poly(9, 17.5),
    });
    const pts = burstWindowDecisionPoints(
      combat([f, hostile({ spellCastEvents: [cast(AR, 10)] })]),
    );
    expect(pts[0]!.feasible).toBe(false);
  });

  it("a cooldown back mid-window is an opportunity from its first reaction-ready second", () => {
    const probe = friendly({ spellCastEvents: [cast(BARKSKIN, 0)] });
    const barkCd = extractMajorCooldowns(
      probe as never,
      combat([probe]) as never,
    ).find((c) => c.spellId === BARKSKIN)!.cooldownSeconds;
    // Barkskin back at 12.5 s: on cooldown at the window start (10 s),
    // reaction-ready from 14 s — inside the window
    const f = friendly({
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 60),
      spellCastEvents: [cast(BARKSKIN, 12.5 - barkCd)],
    });
    const pts = burstWindowDecisionPoints(
      combat([f, hostile({ spellCastEvents: [cast(AR, 10)] })]),
    );
    expect(pts[0]!.feasible).toBe(true);
    expect(pts[0]!.feasibleUnits).toContain("Friend-R");
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
      ...NO_KIT,
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 60),
    });
    const pts = burstWindowDecisionPoints(
      combat([f, hostile({ spellCastEvents: [cast(AR, 10)] })]),
    );
    expect(pts[0]!.feasible).toBe(false);
    expect(pts[0]!.feasibleUnits).toEqual([]);
  });

  it("a wall owned on the spec baseline alone (never pressed this round) is not an answer either", () => {
    // the default Balance Druid owns Barkskin without a talent; with no cast
    // this round the row is `baselineOnly` — cd-hoarded's alone (ruling
    // P-W6), so the default ledger this engine reads does not carry it
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

  it("F-B6: a death in the window's last rendered second counts; one after it does not", () => {
    const base = {
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 60),
    };
    const at = (deathSec: number) =>
      burstWindowDecisionPoints(
        combat([
          friendly({
            ...base,
            deathRecords: [{ timestamp: T0 + deathSec * 1000 }],
          }),
          hostile({ spellCastEvents: [cast(AR, 10)] }),
        ]),
      )[0]!;
    const end = at(40).endSec; // the death is outside; read the window's end second
    expect(at(end + 0.5).anyFriendlyDeath).toBe(true);
    expect(at(end + 1.2).anyFriendlyDeath).toBe(false);
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

describe("burstWindowDecisionPoints — a response pressed after the pressured friendly's death (T12 ⑧ i)", () => {
  // 483f7433's shape: the pressured friendly dies 5.385 s into the window and
  // a teammate's healing cooldown goes out around that instant.
  const DEATH_MS = T0 + 15_385;
  const at = (castSec: number, over: Record<string, unknown> = {}) =>
    burstWindowDecisionPoints(
      combat([
        friendly({
          damageIn: steadyDamage(10, 16),
          advancedActions: [...hpTrack("F1", 0, 13, 60), hp(14, 20, "F1")],
          deathRecords: [{ timestamp: DEATH_MS }],
          ...over,
        }),
        friendly({
          id: "F2",
          name: "Mate-R",
          advancedActions: hpTrack("F2", 0, 40, 100),
          spellCastEvents: [cast(HEALING_TIDE, castSec)],
        }),
        hostile({ spellCastEvents: [cast(AR, 10)] }),
      ]),
    )[0]!;

  it("marks a press 0.251 s after the death, and one on the UNIT_DIED's own millisecond", () => {
    const late = at(15.636);
    expect(late.pressured!.unitId).toBe("F1");
    expect(late.pressured!.died).toBe(true);
    expect(late.responseCasts).toHaveLength(1);
    expect(late.responseCasts[0]!.afterPressuredDeath).toBe(true);
    expect(at(15.385).responseCasts[0]!.afterPressuredDeath).toBe(true);
  });

  it("a press one millisecond before the death carries no mark", () => {
    const r = at(15.384).responseCasts[0]!;
    expect(r.afterPressuredDeath).toBeUndefined();
    expect("afterPressuredDeath" in r).toBe(false);
  });

  it("a press after ANOTHER friendly's death carries no mark — the predicate is about the pressured unit", () => {
    // F1 stays the pressured unit (lowest HP) and lives; F2's own death at
    // 12.0 does not mark F2's … nor anybody's … response.
    const pts = burstWindowDecisionPoints(
      combat([
        friendly({
          damageIn: steadyDamage(10, 16),
          advancedActions: [...hpTrack("F1", 0, 13, 60), hp(14, 20, "F1")],
          spellCastEvents: [cast(BARKSKIN, 13)],
        }),
        friendly({
          id: "F2",
          name: "Mate-R",
          advancedActions: hpTrack("F2", 0, 11, 100),
          deathRecords: [{ timestamp: T0 + 12_000 }],
        }),
        hostile({ spellCastEvents: [cast(AR, 10)] }),
      ]),
    )[0]!;
    expect(pts.pressured!.unitId).toBe("F1");
    expect(pts.responseCasts[0]!.afterPressuredDeath).toBeUndefined();
  });

  it("`responded` and the response classes do not read the mark — the candidate's half is unchanged", () => {
    const late = at(15.636);
    const early = at(15.384);
    expect(late.responded).toBe(true);
    expect(late.responses).toEqual(early.responses);
    expect(late.feasible).toBe(early.feasible);
    expect(late.triaged).toBe(early.triaged);
    expect(late.firstResponseSec).toBe(5.6);
  });
});

describe("burstWindowDecisionPoints — the pressured friendly (correction 1)", () => {
  /** two friendlies: F1 takes the damage, F2 is the healer standing next to
   * it. `over1`/`over2` add whatever the case under test needs. */
  const twoFriendlies = (over1: any = {}, over2: any = {}) => [
    friendly({
      ...NO_KIT,
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

  it("WO6 Part 2 n37 (b711d4ac): a friendly the burst hit who DIED in the window is pressured, over a lower-HP survivor", () => {
    // F2 is hit, sits at 60 % on the grid until it dies at 15.4 s (its death
    // second reads nothing); F1 survives at 25 %
    const pts = burstWindowDecisionPoints(
      combat(
        twoFriendlies(
          {},
          {
            damageIn: steadyDamage(10, 15),
            advancedActions: hpTrack("F2", 0, 14, 60),
            deathRecords: [{ timestamp: T0 + 15_400 }],
          },
        ),
      ),
    );
    expect(pts[0]!.pressured?.name).toBe("Mate-R");
    expect(pts[0]!.pressured?.died).toBe(true);
  });

  it("codex post-hoc 60-POSTHOC-03 U3: hit and dead inside the window's LAST rendered second — still the hit friendly who died", () => {
    // the outcome window's last second, read off the same burst with F2 idle
    const end = burstWindowDecisionPoints(combat(twoFriendlies()))[0]!
      .outcomeEndSec;
    const pts = burstWindowDecisionPoints(
      combat(
        twoFriendlies(
          {},
          {
            // one hit at end + 0.5 s, dead at end + 0.6 s: inside the
            // printed window, past the whole-second `outcomeEndMs`
            damageIn: [dmg(end + 0.5, 5)],
            advancedActions: hpTrack("F2", 0, end, 60),
            deathRecords: [{ timestamp: T0 + (end + 0.6) * 1000 }],
          },
        ),
      ),
    );
    expect(pts[0]!.outcomeEndSec).toBe(end);
    expect(pts[0]!.pressured?.name).toBe("Mate-R");
    expect(pts[0]!.pressured?.died).toBe(true);
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
      combat(
        twoFriendlies({ ...DRUID, spellCastEvents: [cast(BARKSKIN, 120)] }),
      ),
    );
    expect(pts[0]!.feasible).toBe(true);
    expect(pts[0]!.feasibleUnits).toEqual(["Friend-R"]);
  });

  it("agy 40-FT-101: the pressured friendly's own wall back only after its death is no chance (U8 for the self-save)", () => {
    // Barkskin pressed 47 s before the opener comes back ~13 s in; the druid
    // dies at 11.6 s
    const pts = burstWindowDecisionPoints(
      combat(
        twoFriendlies({
          ...DRUID,
          spellCastEvents: [cast(BARKSKIN, -47)],
          deathRecords: [{ timestamp: T0 + 11_600 }],
        }),
      ),
    );
    expect(pts[0]!.pressured?.name).toBe("Friend-R");
    expect(pts[0]!.feasibleUnits).not.toContain("Friend-R");
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
      ...NO_KIT,
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

  describe("U8 (user ruling 2026-09-30): seconds after the pressured friendly died are not chances to answer for them", () => {
    // F1 dies 2.4 s into the window; F2 is 500 yd away while F1 lives. After
    // the death F1 has no reach (`canReachTargetAt` → null), which used to
    // fail open and credit F2 on post-death seconds only (4446729d 1:27).
    const f1Dying = (over: Record<string, unknown> = {}) =>
      friendly({
        ...NO_KIT,
        damageIn: steadyDamage(10, 20),
        advancedActions: trackAt("F1", 0, 12, 25, 0, 0),
        deathRecords: [{ timestamp: T0 + 12_400 }],
        ...over,
      });
    const mate = (y: number) =>
      friendly({
        id: "F2",
        name: "Mate-R",
        spec: CombatUnitSpec.Druid_Restoration,
        info: { teamId: "0", specId: "105" },
        spellCastEvents: [cast(TRANQUILITY, 120)],
        advancedActions: trackAt("F2", 0, 40, 95, 0, y),
      });
    const enemy = () => hostile({ spellCastEvents: [cast(AR, 10)] });

    it("out of reach while the target lived → not feasible, however long the window runs after the death", () => {
      const pts = burstWindowDecisionPoints(
        combat([f1Dying(), mate(500), enemy()]),
      );
      expect(pts[0]!.pressured?.name).toBe("Friend-R");
      expect(pts[0]!.anyFriendlyDeath).toBe(true);
      expect(pts[0]!.feasible).toBe(false);
      expect(pts[0]!.feasibleUnits).toEqual([]);
    });

    it("in reach while the target lived → still feasible (the death itself removes nothing)", () => {
      const pts = burstWindowDecisionPoints(
        combat([f1Dying(), mate(10), enemy()]),
      );
      expect(pts[0]!.feasible).toBe(true);
      expect(pts[0]!.feasibleUnits).toEqual(["Mate-R"]);
    });
  });
});

describe("burstWindowDecisionPoints — reliability round 2 W1a", () => {
  const enemyWithBurst = (over: Record<string, unknown> = {}) =>
    hostile({ spellCastEvents: [cast(AR, 10)], ...over });
  const pressuredFriend = (over: Record<string, unknown> = {}) =>
    friendly({
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 60),
      ...over,
    });
  const aura = (
    event: string,
    spellId: string,
    tSec: number,
    srcUnitId: string,
    destUnitId: string,
  ) => ({
    spellId,
    spellName: spellId,
    srcUnitId,
    srcUnitName: srcUnitId,
    destUnitId,
    timestamp: T0 + tSec * 1000,
    logLine: { event, timestamp: T0 + tSec * 1000 },
  });
  /** Capacitor Totem: the cast has no target; its totem (owned by F1) stuns
   * the caster 2 s later with Static Charge 118905 (61740741 @311). */
  const CAPACITOR = "192058";
  const STATIC_CHARGE = "118905";
  const totem = {
    id: "T1",
    name: "Capacitor Totem",
    ownerId: "F1",
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: [],
    auraEvents: [],
  };

  it("a ground-cast stun that LANDS on the caster is a control answer, timed at the cast", () => {
    const pts = burstWindowDecisionPoints(
      combat([
        pressuredFriend({
          spellCastEvents: [cast(CAPACITOR, 17.8, "0000000000000000")],
        }),
        totem,
        enemyWithBurst({
          auraEvents: [
            aura(LogEvent.SPELL_AURA_APPLIED, STATIC_CHARGE, 19.8, "T1", "E1"),
          ],
        }),
      ]),
    );
    expect(pts[0]!.responses.control).toBe(true);
    expect(pts[0]!.responded).toBe(true);
    expect(pts[0]!.responseCasts).toHaveLength(1);
    expect(pts[0]!.responseCasts[0]!.spellId).toBe(STATIC_CHARGE);
    expect(pts[0]!.responseCasts[0]!.latencySec).toBe(7.8);
  });

  it("the same stun from a totem planted after the window is not an answer", () => {
    const pts = burstWindowDecisionPoints(
      combat([
        pressuredFriend({
          spellCastEvents: [cast(CAPACITOR, 18.5, "0000000000000000")],
        }),
        totem,
        enemyWithBurst({
          auraEvents: [
            aura(LogEvent.SPELL_AURA_APPLIED, STATIC_CHARGE, 20.5, "T1", "E1"),
          ],
        }),
      ]),
    );
    expect(pts[0]!.responses.control).toBe(false);
  });

  it("an aimed control cast is counted once, not again when its aura lands", () => {
    const pts = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ spellCastEvents: [cast(STORM_BOLT, 12, "E1")] }),
        enemyWithBurst({
          auraEvents: [
            aura(LogEvent.SPELL_AURA_APPLIED, "132169", 12.3, "F1", "E1"),
          ],
        }),
      ]),
    );
    expect(pts[0]!.responseCasts.map((r) => r.category)).toEqual(["control"]);
  });

  it("CC on the caster from an enemy source is nobody's answer", () => {
    const pts = burstWindowDecisionPoints(
      combat([
        pressuredFriend(),
        enemyWithBurst({
          auraEvents: [
            aura(LogEvent.SPELL_AURA_APPLIED, STATIC_CHARGE, 12, "E2", "E1"),
          ],
        }),
        hostile({ id: "E2", name: "Enemy2-R" }),
      ]),
    );
    expect(pts[0]!.responses.control).toBe(false);
  });

  it("a silence across the whole response window does not stop a wall DB2 says a silence does not prevent (Barkskin)", () => {
    // Garrote - Silence (1330) is a silence, not hard CC. Barkskin's
    // SpellCategories row has no silence bit (PreventionType 4) and went out
    // inside a silence aura 15 times on 605 files — FT-R1011c follow-up
    // (2026-10-14); until then a silence was read as stopping every spell.
    const f = pressuredFriend({
      spellCastEvents: [cast(BARKSKIN, 120)],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "1330", 9, "E1", "F1"),
        aura(LogEvent.SPELL_AURA_REMOVED, "1330", 25, "E1", "F1"),
      ],
    });
    const pts = burstWindowDecisionPoints(combat([f, enemyWithBurst()]));
    expect(pts[0]!.feasible).toBe(true);
  });
});

describe("burstWindowDecisionPoints — where a control answer landed (T12 ⑧ i)", () => {
  const aura = (
    event: string,
    spellId: string,
    tSec: number,
    srcUnitId: string,
    destUnitId: string,
  ) => ({
    spellId,
    spellName: spellId,
    srcUnitId,
    srcUnitName: srcUnitId,
    destUnitId,
    timestamp: T0 + tSec * 1000,
    logLine: { event, timestamp: T0 + tSec * 1000 },
  });
  const pressuredFriend = (over: Record<string, unknown> = {}) =>
    friendly({
      damageIn: steadyDamage(10, 20),
      advancedActions: hpTrack("F1", 0, 40, 60),
      ...over,
    });
  /** Storm Bolt's stun aura (107570 → 132169, `castEffectAuras.ts`). */
  const STORM_BOLT_STUN = "132169";

  it("an aimed control carries its target and the aura application it landed as", () => {
    const e = hostile({
      spellCastEvents: [cast(AR, 10)],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, STORM_BOLT_STUN, 12.3, "F1", "E1"),
        aura(LogEvent.SPELL_AURA_REMOVED, STORM_BOLT_STUN, 15.4, "F1", "E1"),
      ],
    });
    const f = pressuredFriend({
      spellCastEvents: [cast(STORM_BOLT, 12, "E1")],
    });
    const c = combat([f, e]);
    const r = burstWindowDecisionPoints(c)[0]!.responseCasts[0]!;
    expect(r.landed).toBe(true);
    expect(r.controlOn).toEqual({
      unitId: "E1",
      unitName: "Enemy-R",
      auras: [{ spellId: STORM_BOLT_STUN, atMs: T0 + 12_300 }],
    });
    // the join the credit line makes: the application IS the instance the
    // `[CC ON ENEMY]` line renders (`analyzePlayerCCAndTrinket` on the enemy)
    const summary = analyzePlayerCCAndTrinket(e as never, [f] as never, {
      ...c,
      startInfo: { zoneId: "0", bracket: "3v3" },
    });
    expect(summary.ccInstances).toHaveLength(1);
    const cc = summary.ccInstances[0]!;
    expect(cc.spellId).toBe(r.controlOn!.auras[0]!.spellId);
    expect(T0 + cc.atSeconds * 1000).toBeCloseTo(
      r.controlOn!.auras[0]!.atMs,
      6,
    );
    expect(cc.durationSeconds).toBeCloseTo(3.1, 6);
  });

  // T180 (ruling R68): 03d63165 r1 — a Storm Bolt that MISSED was the
  // window's whole answer
  it("a control that did not land does not make the window responded; the same control landing does", () => {
    const enemy = (auras: unknown[]) =>
      hostile({ spellCastEvents: [cast(AR, 10)], auraEvents: auras });
    const f = () =>
      pressuredFriend({ spellCastEvents: [cast(STORM_BOLT, 12, "E1")] });
    const missed = burstWindowDecisionPoints(combat([f(), enemy([])]))[0]!;
    expect(missed.responseCasts[0]!.landed).toBe(false);
    expect(missed.responses.control).toBe(true);
    expect(missed.responded).toBe(false);
    const landed = burstWindowDecisionPoints(
      combat([
        f(),
        enemy([
          aura(LogEvent.SPELL_AURA_APPLIED, STORM_BOLT_STUN, 12.3, "F1", "E1"),
          aura(LogEvent.SPELL_AURA_REMOVED, STORM_BOLT_STUN, 15.4, "F1", "E1"),
        ]),
      ]),
    )[0]!;
    expect(landed.responseCasts[0]!.landed).toBe(true);
    expect(landed.responded).toBe(true);
  });

  // assembly review 80-PIPE-169-B155 (84d80c66 r1 1:45): the ignored
  // healing CD is the official self-only verdict's (Dark Pact, Exhilaration)
  // — not a press whose own rows merely show it on its caster
  // (`selfOnlyEffect`): a teammate's Emerald Communion still answers
  it("another unit's healing CD is ignored on the official self-only verdict alone: Emerald Communion with self-only rows still answers", () => {
    const pressured = { unitId: "F1" };
    const heal = (spellId: string, selfOnlyEffect?: true) =>
      ({
        category: "healCd",
        spellId,
        spellName: spellId,
        casterName: "Mate-R",
        casterId: "F2",
        tSec: 15,
        latencySec: 5,
        ...(selfOnlyEffect ? { selfOnlyEffect } : {}),
      }) as BurstResponseCast;
    expect(pressDidNotReachPressured(pressured, heal("108416"))).toBe(true);
    expect(pressDidNotReachPressured(pressured, heal("109304"))).toBe(true);
    const communion = heal("370960", true);
    expect(pressWentElsewhere(pressured, communion)).toBe(false);
    expect(pressDidNotReachPressured(pressured, communion)).toBe(false);
  });

  // T226 (user ruling R92): the signed register holds only the
  // Defensive-tagged healing cooldowns, so an extra answer it does not list
  // is read from the official profile itself — another druid's Frenzied
  // Regeneration (22842, heals its caster alone) is ignored like Dark Pact;
  // the druid's own still answers his window; Emerald Communion, official
  // self-only too, stays an answer through the signed team-heal registry
  it("another unit's Frenzied Regeneration is ignored on the official profile; the caster's own answers; Emerald Communion stays (T226)", () => {
    const heal = (casterId: string, spellId: string) =>
      ({
        category: "healCd",
        spellId,
        spellName: spellId,
        casterName: casterId,
        casterId,
        tSec: 15,
        latencySec: 5,
      }) as BurstResponseCast;
    expect(
      pressDidNotReachPressured({ unitId: "F1" }, heal("F2", "22842")),
    ).toBe(true);
    expect(pressWentElsewhere({ unitId: "F1" }, heal("F2", "22842"))).toBe(
      false,
    );
    expect(
      pressDidNotReachPressured({ unitId: "F2" }, heal("F2", "22842")),
    ).toBe(false);
    expect(
      pressDidNotReachPressured({ unitId: "F1" }, heal("F2", "370960")),
    ).toBe(false);
  });

  // ruling R75: "a control that did not land" is control only
  it("an interrupt that interrupted nothing is ignored: not elsewhere, no answer", () => {
    const PUMMEL = "6552";
    const p = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ spellCastEvents: [cast(PUMMEL, 12, "E1")] }),
        hostile({ spellCastEvents: [cast(AR, 10)], auraEvents: [] }),
      ]),
    )[0]!;
    const r = p.responseCasts[0]!;
    expect([r.category, r.landed]).toEqual(["control", false]);
    expect(pressWentElsewhere(p.pressured!, r)).toBe(false);
    expect(pressDidNotReachPressured(p.pressured!, r)).toBe(true);
    expect(p.responded).toBe(false);
  });

  it("an aimed control that did not land carries its target and no application", () => {
    const r = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ spellCastEvents: [cast(STORM_BOLT, 12, "E1")] }),
        hostile({ spellCastEvents: [cast(AR, 10)] }),
      ]),
    )[0]!.responseCasts[0]!;
    expect(r.landed).toBe(false);
    expect(r.controlOn).toEqual({
      unitId: "E1",
      unitName: "Enemy-R",
      auras: [],
    });
  });

  it("a ground-cast control carries the holder it landed on and that application", () => {
    const STATIC_CHARGE = "118905";
    const pts = burstWindowDecisionPoints(
      combat([
        pressuredFriend({
          spellCastEvents: [cast("192058", 17.8, "0000000000000000")],
        }),
        {
          id: "T1",
          name: "Capacitor Totem",
          ownerId: "F1",
          reaction: CombatUnitReaction.Friendly,
          spellCastEvents: [],
          auraEvents: [],
        },
        hostile({
          spellCastEvents: [cast(AR, 10)],
          auraEvents: [
            aura(LogEvent.SPELL_AURA_APPLIED, STATIC_CHARGE, 19.8, "T1", "E1"),
          ],
        }),
      ]),
    );
    expect(pts[0]!.responseCasts[0]!.controlOn).toEqual({
      unitId: "E1",
      unitName: "Enemy-R",
      auras: [{ spellId: STATIC_CHARGE, atMs: T0 + 19_800 }],
    });
  });

  it("a wall / heal / external answer carries none", () => {
    const r = burstWindowDecisionPoints(
      combat([
        pressuredFriend({ spellCastEvents: [cast(BARKSKIN, 13)] }),
        hostile({ spellCastEvents: [cast(AR, 10)] }),
      ]),
    )[0]!.responseCasts[0]!;
    expect(r.category).toBe("wall");
    expect("controlOn" in r).toBe(false);
  });
});

describe("burstExtrasLabel", () => {
  const hunter = { casterName: "Hunter", casterSpec: "MHunter" };
  const druid = { casterName: "Druid", casterSpec: "BDruid" };
  const rogue = { casterName: "Gematria", casterSpec: "ARogue" };
  it("marks each extra pressed after the opener and drops those past the horizon", () => {
    expect(
      burstExtrasLabel({
        tSec: 63,
        leadCd: { casterName: "Hunter" },
        extraCds: [
          { spellName: "Trueshot", castSec: 63, ...hunter },
          { spellName: "Incarnation: Chosen of Elune", castSec: 69, ...druid },
          { spellName: "Avatar", castSec: 84, ...hunter },
        ],
      }),
    ).toBe("Trueshot; Incarnation: Chosen of Elune by Druid (BDruid) 6s later");
  });

  it("WO6 #2 (n48): an extra another enemy pressed names that enemy, through the caller's label", () => {
    expect(
      burstExtrasLabel(
        {
          tSec: 156,
          leadCd: { casterName: "Akuro" },
          extraCds: [
            { spellName: "Kingsbane", castSec: 156, ...rogue },
            { spellName: "Deathmark", castSec: 164, ...rogue },
          ],
        },
        (c) => `3(${c.casterSpec})`,
      ),
    ).toBe("Kingsbane by 3(ARogue); Deathmark by 3(ARogue) 8s later");
  });
});

describe("controlLandedResponses — a pet's control (fact6 D11)", () => {
  // e7608d97 1:10: the Abomination's Monstrous Blow stun landed 0.9 s after
  // the opener; the owner's untargeted Gladiator's Medallion 1.9 s before the
  // aura timed it ("1.0s before it opened").
  const MONSTROUS_BLOW = "91797";
  const MEDALLION = "336126";
  const auraFrom = (src: string, spellId: string, tMs: number) => ({
    id: "E1",
    auraEvents: [
      {
        timestamp: tMs,
        spellId,
        srcUnitId: src,
        logLine: { event: "SPELL_AURA_APPLIED" },
      },
    ],
  });
  const ownerOf = (id: string) =>
    id === "F1" || id.includes("-F1") ? "F1" : undefined;
  const PET = "Pet-0-F1";
  const press = [
    { unitId: "F1", spellId: MEDALLION, dest: undefined, tMs: 10_000 },
  ];
  const run = (
    src: string,
    petCasts: Array<{ spellId: string; tMs: number }>,
  ) =>
    controlLandedResponses(
      [auraFrom(src, MONSTROUS_BLOW, 11_900)],
      new Set(["E1"]),
      ownerOf,
      press,
      0,
      40_000,
      () => petCasts,
    );

  it("a pet's aura is timed by the pet's own cast, never by another press of the owner", () => {
    expect(run(PET, [{ spellId: MONSTROUS_BLOW, tMs: 11_850 }])).toMatchObject([
      { unitId: "F1", spellId: MONSTROUS_BLOW, tMs: 11_850 },
    ]);
  });

  it("with no cast of its own in the log, the aura's own instant", () => {
    expect(run(PET, [])).toMatchObject([{ tMs: 11_900 }]);
  });

  it("an owner press that made the control (a command of the same spell) times it first", () => {
    const out = controlLandedResponses(
      [auraFrom(PET, MONSTROUS_BLOW, 11_900)],
      new Set(["E1"]),
      ownerOf,
      [
        ...press,
        { unitId: "F1", spellId: MONSTROUS_BLOW, dest: undefined, tMs: 11_400 },
      ],
      0,
      40_000,
      () => [{ spellId: MONSTROUS_BLOW, tMs: 11_850 }],
    );
    expect(out).toMatchObject([{ tMs: 11_400 }]);
    // (a press aimed at the holder is the cast-side response, counted there)
  });

  it("a totem or guardian keeps the owner's untargeted press", () => {
    expect(
      run("Creature-0-F1", [{ spellId: MONSTROUS_BLOW, tMs: 11_850 }]),
    ).toMatchObject([{ tMs: 10_000 }]);
  });
});

describe("controlLandedResponses — a totem's own pulse (fact11 D28)", () => {
  // be1686eb: Earthgrab Totem 51485 dropped 0:05.505, its root 64695 on the
  // priest at 0:17.501 (a 2 s pulse), the burst opened at 0:13.1; the shaman
  // stunned then silenced, no press of his in the fuse
  const EARTHGRAB_ROOT = "64695";
  const TOTEM = "Creature-0-F1-Earthgrab";
  const aura = {
    id: "E1",
    auraEvents: [
      {
        timestamp: 17_501,
        spellId: EARTHGRAB_ROOT,
        srcUnitId: TOTEM,
        logLine: { event: "SPELL_AURA_APPLIED" },
      },
    ],
  };
  const ownerOf = (id: string) =>
    id === "F1" || id.includes("-F1") ? "F1" : undefined;
  const run = (summonedAt: number | null) =>
    controlLandedResponses(
      [aura],
      new Set(["E1"]),
      ownerOf,
      [],
      13_100,
      28_100,
      () => [],
      (id) => (id === TOTEM ? summonedAt : null),
    );
  it("a totem dropped before the burst: its pulse answers nothing", () => {
    expect(run(5_505)).toEqual([]);
  });
  it("a totem dropped inside the burst: the drop is the answer, at its own instant", () => {
    expect(run(14_000)).toMatchObject([{ unitId: "F1", tMs: 14_000 }]);
  });
  it("no summon row in the log: the aura's own instant, as before", () => {
    expect(run(null)).toMatchObject([{ tMs: 17_501 }]);
  });
});

describe("controlLandedResponses — which cast times a landed control (F-B8)", () => {
  const LASSO_CAST = "305483";
  const LASSO_AURA = "305485";
  const auraOn = (spellId: string, tMs: number) => ({
    id: "E1",
    auraEvents: [
      {
        timestamp: tMs,
        spellId,
        srcUnitId: "F1",
        logLine: { event: "SPELL_AURA_APPLIED" },
      },
    ],
  });
  it("fact2 e49b7c3b: an untargeted press that makes its own control (Freezing Trap) never times another (Binding Shot armed 5 s before its stun)", () => {
    const casts = [
      { unitId: "F1", spellId: "109248", dest: undefined, tMs: 7_080 },
      { unitId: "F1", spellId: "187650", dest: undefined, tMs: 9_905 },
    ];
    const out = controlLandedResponses(
      [auraOn("117526", 12_150)],
      new Set(["E1"]),
      (id) => id,
      casts,
      0,
      40_000,
    );
    // past the fuse: the aura's own time, not the trap's press
    expect(out).toMatchObject([
      { unitId: "F1", spellId: "117526", tMs: 12_150 },
    ]);
  });

  it("7d1f14af: the cast that produced the aura beats an earlier untargeted press", () => {
    const casts = [
      { unitId: "F1", spellId: "1223412", dest: undefined, tMs: 28_014 },
      { unitId: "F1", spellId: LASSO_CAST, dest: "E1", tMs: 29_896 },
    ];
    const out = controlLandedResponses(
      [auraOn(LASSO_AURA, 29_936)],
      new Set(["E1"]),
      (id) => id,
      casts,
      20_000,
      40_000,
    );
    expect(out).toMatchObject([
      { unitId: "F1", spellId: LASSO_AURA, tMs: 29_896 },
    ]);
    // with no producing cast the untargeted one still times it (Capacitor Totem)
    expect(
      controlLandedResponses(
        [auraOn(LASSO_AURA, 29_936)],
        new Set(["E1"]),
        (id) => id,
        [casts[0]!],
        20_000,
        40_000,
      ),
    ).toMatchObject([{ unitId: "F1", spellId: LASSO_AURA, tMs: 28_014 }]);
  });
  it("codex review: a non-control cast aimed at the target between Ring of Frost and its aura does not time it", () => {
    // opener 10 s, response deadline 18 s: Ring of Frost (untargeted) 17.5 s,
    // Frostbolt at E1 18.5 s, the Ring's aura 82691 on E1 at 19 s
    const casts = [
      { unitId: "F1", spellId: "113724", dest: undefined, tMs: 17_500 },
      { unitId: "F1", spellId: "116", dest: "E1", tMs: 18_500 },
    ];
    expect(
      controlLandedResponses(
        [auraOn("82691", 19_000)],
        new Set(["E1"]),
        (id) => id,
        casts,
        10_000,
        18_000,
      ),
    ).toMatchObject([{ unitId: "F1", spellId: "82691", tMs: 17_500 }]);
  });
  it("codex 35-CD-08: a failed aimed control does not swallow a landed AoE one", () => {
    // burst 10 s; the monk's Spear Hand Strike at E1 11 s (no interrupt),
    // then an untargeted Leg Sweep at 12 s whose stun 119381 lands on E1
    const casts = [
      { unitId: "F1", spellId: "116705", dest: "E1", tMs: 11_000 },
      { unitId: "F1", spellId: "119381", dest: undefined, tMs: 12_000 },
    ];
    expect(
      controlLandedResponses(
        [auraOn("119381", 12_000)],
        new Set(["E1"]),
        (id) => id,
        casts,
        10_000,
        18_000,
      ),
    ).toMatchObject([{ unitId: "F1", spellId: "119381", tMs: 12_000 }]);
  });
  it("codex 35-CD-13f: a landed response carries its holder, source and time for the pre-opener check", () => {
    // Mass Entanglement at E1 9.0 s; its root on E2 9.001–9.5 s; burst at 10 s
    const holder = {
      id: "E2",
      auraEvents: [
        {
          timestamp: 9_001,
          spellId: "102359",
          srcUnitId: "F1",
          logLine: { event: "SPELL_AURA_APPLIED" },
        },
        {
          timestamp: 9_500,
          spellId: "102359",
          srcUnitId: "F1",
          logLine: { event: "SPELL_AURA_REMOVED" },
        },
      ],
    };
    const [r] = controlLandedResponses(
      [holder],
      new Set(["E1", "E2"]),
      (id) => id,
      [{ unitId: "F1", spellId: "102359", dest: "E1", tMs: 9_000 }],
      8_000,
      18_000,
    );
    expect(r).toMatchObject({
      holderId: "E2",
      auraSrcId: "F1",
      auraAtMs: 9_001,
      tMs: 9_000,
    });
    // the decision point's check: expired before the opener → not up
    expect(
      aimedControlUpAt(holder, r!.auraSrcId!, r!.spellId, r!.auraAtMs!, 10_000),
    ).toBe(false);
    // control: still up at the opener
    expect(aimedControlUpAt(holder, "F1", "102359", 9_001, 9_400)).toBe(true);
  });
  it("codex 35-CD-13g: the pre-opener check is for auras applied before the opener only", () => {
    const r = {
      unitId: "F1",
      spellId: "118905",
      tMs: 9_000,
      holderId: "E1",
      auraSrcId: "totem",
      auraAtMs: 11_000,
    };
    // Capacitor Totem cast 9 s, burst 10 s, stun lands 11 s → no check
    expect(landedPreOpenerStillUp(r, { auraEvents: [] }, 10_000)).toBe(
      undefined,
    );
    // an aura applied at 9.001 s and removed at 9.5 s → expired
    expect(
      landedPreOpenerStillUp(
        { ...r, auraAtMs: 9_001 },
        {
          auraEvents: [
            {
              timestamp: 9_001,
              spellId: "118905",
              srcUnitId: "totem",
              logLine: { event: "SPELL_AURA_APPLIED" },
            },
            {
              timestamp: 9_500,
              spellId: "118905",
              srcUnitId: "totem",
              logLine: { event: "SPELL_AURA_REMOVED" },
            },
          ],
        },
        10_000,
      ),
    ).toBe(false);
  });
  it("codex 35-CD-13d: an aimed control at another caster does not swallow the aura that landed on this one", () => {
    // Mass Entanglement 102359 aimed at E1 (immune, no aura), its root on E2
    const casts = [
      { unitId: "F1", spellId: "102359", dest: "E1", tMs: 12_000 },
    ];
    const onE2 = { ...auraOn("102359", 12_001), id: "E2" };
    expect(
      controlLandedResponses(
        [onE2],
        new Set(["E1", "E2"]),
        (id) => id,
        casts,
        10_000,
        18_000,
      ),
    ).toMatchObject([{ unitId: "F1", spellId: "102359", tMs: 12_000 }]);
    // control: aimed at E2 itself → the cast side credits it, no duplicate
    expect(
      controlLandedResponses(
        [onE2],
        new Set(["E1", "E2"]),
        (id) => id,
        [{ ...casts[0]!, dest: "E2" }],
        10_000,
        18_000,
      ),
    ).toEqual([]);
  });
});

describe("burstTroughReadEnd (T183, ruling R73)", () => {
  const w = {
    outcomeEndSec: 20,
    buffRunEndSec: 24,
    nextWindowTSec: null,
    deathSec: null,
    roundEndSec: null,
  };
  it("reads to the buff's end, at most 10 s past the horizon", () => {
    expect(burstTroughReadEnd(w)).toEqual({ toSec: 24, stop: "buff end" });
    expect(burstTroughReadEnd({ ...w, buffRunEndSec: 30 })).toEqual({
      toSec: 30,
      stop: "buff end",
    });
    expect(burstTroughReadEnd({ ...w, buffRunEndSec: 53 })).toEqual({
      toSec: 30,
      stop: "cap",
    });
  });
  it("stops before the next window, at the unit's death and at the round's end", () => {
    expect(burstTroughReadEnd({ ...w, nextWindowTSec: 23 })).toEqual({
      toSec: 22,
      stop: "next window",
    });
    expect(burstTroughReadEnd({ ...w, deathSec: 22 })).toEqual({
      toSec: 22,
      stop: "death",
    });
    expect(burstTroughReadEnd({ ...w, roundEndSec: 21 })).toEqual({
      toSec: 21,
      stop: "round end",
    });
  });
  it("nothing past the horizon: no reading", () => {
    expect(burstTroughReadEnd({ ...w, buffRunEndSec: 20 })).toBeNull();
    expect(burstTroughReadEnd({ ...w, nextWindowTSec: 21 })).toBeNull();
    expect(burstTroughReadEnd({ ...w, deathSec: 19 })).toBeNull();
  });
});
