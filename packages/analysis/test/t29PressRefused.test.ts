/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T29: an enemy press-only window kept its official length with no landing
 * check. b74d7bf6 r1 2:45: Deathmark met two IMMUNE and put no 360194 on
 * anyone, and `[RES]` listed it to 3:00 (`pressEffectRefusedAtCast`).
 * 52-1-311 r1 1:58: Colossus Smash pressed 0.39 s before its warrior died —
 * the debuff, 0.5 s behind the hit, never applied — and `[RES]` listed it
 * past the warrior's `[DEATH]` (T03's death cut, for a press-only window).
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  syncPriorRefusedPresses,
  syncReadyTimingFacts,
} from "../src/analysis/candidates/cooldownTiming";
import { NOT_READY_REASON_ZH } from "../src/analysis/candidates/shared";
import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import { buildKillSequenceBlock } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import { analyzeBurstLedger } from "../src/utils/burstLedger";
import {
  observedEffectEndSeconds,
  pressEffectRefusedAtCast,
  pressRefusalMissType,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";
import { extractKillAttempts } from "../src/utils/killAttempts";
import {
  REFUSED_PRESS_MARKER_RE,
  refusedPressCooldownState,
  refusedPressMarker,
} from "../src/utils/refusedPress";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const START = 1_000_000;
const DEATHMARK = "360194";
const COLOSSUS_SMASH = "167105";
const CS_DEBUFF = "208086";
const FROZEN_ORB = "84714";
const ORB_HIT = "84721";
const RAY_OF_FROST = "205021";

const miss = (spellId: string, ms: number, missType = "IMMUNE") => ({
  srcUnitId: "e1",
  destUnitId: "f1",
  spellId,
  timestamp: ms,
  missType,
  amount: 0,
  logLine: { event: LogEvent.SPELL_MISSED, timestamp: ms },
});
const hit = (spellId: string, ms: number) => ({
  srcUnitId: "e1",
  destUnitId: "f1",
  spellId,
  timestamp: ms,
  amount: 1000,
  logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: ms },
});
const debuff = (event: LogEvent, spellId: string, ms: number) => ({
  ...makeAuraEvent(event, spellId, ms, "e1", "f1", "DEBUFF"),
  srcUnitName: "Enemy",
});

function scene(opts: {
  spec: CombatUnitSpec;
  presses: Array<[string, number]>;
  misses?: any[];
  hits?: any[];
  targetAuras?: any[];
  deathS?: number;
  info?: any;
}) {
  const enemy = makeUnit("e1", {
    name: "Enemy",
    spec: opts.spec,
    spellCastEvents: opts.presses.map(([id, ms]) =>
      makeSpellCastEvent(id, ms, "f1", "Friend", "e1", "Enemy"),
    ),
    damageOut: opts.hits ?? [],
    ...(opts.info ? { info: opts.info } : {}),
  } as any);
  (enemy as any).missesOut = opts.misses ?? [];
  if (opts.deathS !== undefined)
    (enemy as any).deathRecords = [{ timestamp: START + opts.deathS * 1000 }];
  const friend = makeUnit("f1", {
    name: "Friend",
    spec: CombatUnitSpec.Druid_Restoration,
    auraEvents: opts.targetAuras ?? [],
  } as any);
  const combat = {
    startTime: START,
    endTime: START + 200_000,
    units: { e1: enemy, f1: friend },
  } as any;
  return { enemy, combat, tl: reconstructEnemyCDTimeline([enemy], combat) };
}

const enemyField = (timeline: any, t: number) =>
  buildResourceSnapshot({
    timeSeconds: t,
    ownerCDs: [],
    ownerName: "Owner",
    ownerSpec: "Restoration Druid",
    teammateCDs: [],
    ccTrinketSummaries: [],
    enemyCDTimeline: timeline,
    matchStartMs: START,
  }).match(/enemy:(.+)$/)?.[1];

const cdOf = (tl: any, name: string) =>
  tl.players[0]?.offensiveCDs.find((c: any) => c.spellName === name);

describe("T29 — a press the game refused ran for no time", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  const at = START + 10_000;

  it("predicate: an IMMUNE miss and nothing landed → refused", () => {
    const { enemy, combat } = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
      misses: [miss(DEATHMARK, at + 1)],
    });
    expect(
      pressEffectRefusedAtCast(enemy, DEATHMARK, at, Infinity, combat),
    ).toBe(true);
    expect(
      observedEffectEndSeconds(enemy, DEATHMARK, 10, Infinity, combat),
    ).toBe(10);
  });

  it("predicate: no miss, a landed aura, or a hit that landed → not refused", () => {
    const none = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
    });
    expect(
      pressEffectRefusedAtCast(
        none.enemy,
        DEATHMARK,
        at,
        Infinity,
        none.combat,
      ),
    ).toBe(false);
    const landed = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
      misses: [miss(DEATHMARK, at + 1)],
      targetAuras: [debuff(LogEvent.SPELL_AURA_APPLIED, DEATHMARK, at + 5)],
    });
    expect(
      pressEffectRefusedAtCast(
        landed.enemy,
        DEATHMARK,
        at,
        Infinity,
        landed.combat,
      ),
    ).toBe(false);
    const struck = scene({
      spec: CombatUnitSpec.Warrior_Arms,
      presses: [[COLOSSUS_SMASH, at]],
      misses: [miss(COLOSSUS_SMASH, at + 1)],
      hits: [hit(COLOSSUS_SMASH, at + 1)],
    });
    expect(
      pressEffectRefusedAtCast(
        struck.enemy,
        COLOSSUS_SMASH,
        at,
        Infinity,
        struck.combat,
      ),
    ).toBe(false);
  });

  it("predicate: an ABSORB is a hit that landed; a same-name hit of another id later in the window ran", () => {
    const absorbed = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
      misses: [miss(DEATHMARK, at + 1, "ABSORB")],
    });
    expect(
      pressEffectRefusedAtCast(
        absorbed.enemy,
        DEATHMARK,
        at,
        Infinity,
        absorbed.combat,
      ),
    ).toBe(false);
    // Frozen Orb: IMMUNE on the press's 84714, the orb's 84721 hits 3 s on
    const orb = scene({
      spec: CombatUnitSpec.Mage_Frost,
      presses: [[FROZEN_ORB, at]],
      misses: [miss(FROZEN_ORB, at + 1)],
      hits: [{ ...hit(ORB_HIT, at + 3_000), spellName: "Frozen Orb" }],
    });
    expect(
      pressEffectRefusedAtCast(orb.enemy, FROZEN_ORB, at, Infinity, orb.combat),
    ).toBe(false);
    // …its hit a shield ate in full (an ABSORB miss) landed too
    const orbAbsorbed = scene({
      spec: CombatUnitSpec.Mage_Frost,
      presses: [[FROZEN_ORB, at]],
      misses: [
        miss(FROZEN_ORB, at + 1),
        { ...miss(ORB_HIT, at + 3_000, "ABSORB"), spellName: "Frozen Orb" },
      ],
    });
    expect(
      pressEffectRefusedAtCast(
        orbAbsorbed.enemy,
        FROZEN_ORB,
        at,
        Infinity,
        orbAbsorbed.combat,
      ),
    ).toBe(false);
    const orbNoHit = scene({
      spec: CombatUnitSpec.Mage_Frost,
      presses: [[FROZEN_ORB, at]],
      misses: [miss(FROZEN_ORB, at + 1)],
    });
    expect(
      pressEffectRefusedAtCast(
        orbNoHit.enemy,
        FROZEN_ORB,
        at,
        Infinity,
        orbNoHit.combat,
      ),
    ).toBe(true);
  });

  it("predicate: a miss past the start window, or one of the next press, is not this press's", () => {
    const late = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
      misses: [miss(DEATHMARK, at + 2_500)],
    });
    expect(
      pressEffectRefusedAtCast(
        late.enemy,
        DEATHMARK,
        at,
        Infinity,
        late.combat,
      ),
    ).toBe(false);
    const next = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
      misses: [miss(DEATHMARK, at + 500)],
    });
    expect(
      pressEffectRefusedAtCast(
        next.enemy,
        DEATHMARK,
        at,
        at + 100,
        next.combat,
      ),
    ).toBe(false);
  });

  it("timeline: the refused Deathmark's window ends at its press — `[RES]` drops it the next second", () => {
    const { tl } = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
      misses: [miss(DEATHMARK, at + 1)],
    });
    const cd = cdOf(tl, "Deathmark");
    expect(cd).toBeDefined();
    expect(cd.buffEndSeconds).toBe(10);
    expect(enemyField(tl, 11) ?? "").not.toContain("Deathmark");
  });

  it("timeline: the same press with no refusal keeps its official length", () => {
    const { tl } = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
    });
    const cd = cdOf(tl, "Deathmark");
    expect(cd.buffEndSeconds).toBeGreaterThan(20);
    expect(enemyField(tl, 11)).toContain("Deathmark");
  });

  it("timeline: a press its caster died before it landed — cut at the death, the official end kept beside it", () => {
    const { tl } = scene({
      spec: CombatUnitSpec.Warrior_Arms,
      presses: [
        [COLOSSUS_SMASH, START + 1_000],
        [COLOSSUS_SMASH, at],
      ],
      hits: [hit(COLOSSUS_SMASH, START + 1_000), hit(COLOSSUS_SMASH, at)],
      // the first press's debuff landed and ran out; the second's never did
      targetAuras: [
        debuff(LogEvent.SPELL_AURA_APPLIED, CS_DEBUFF, START + 1_500),
        debuff(LogEvent.SPELL_AURA_REMOVED, CS_DEBUFF, START + 9_500),
      ],
      deathS: 10.39,
    });
    const cd = tl.players[0]!.offensiveCDs.filter(
      (c: any) => c.spellName === "Colossus Smash",
    )[1];
    expect(cd.deathCutAtSeconds).toBeCloseTo(10.39, 3);
    expect(cd.deathCutOfficialEndSeconds).toBeGreaterThan(15);
    expect(enemyField(tl, 11) ?? "").not.toContain("Colossus Smash");
  });

  it("timeline: a debuff that landed and outlives its caster's death keeps the window", () => {
    const { tl } = scene({
      spec: CombatUnitSpec.Warrior_Arms,
      presses: [[COLOSSUS_SMASH, at]],
      hits: [hit(COLOSSUS_SMASH, at)],
      targetAuras: [debuff(LogEvent.SPELL_AURA_APPLIED, CS_DEBUFF, at + 500)],
      deathS: 12,
    });
    const cd = cdOf(tl, "Colossus Smash");
    expect(cd.deathCutAtSeconds).toBeUndefined();
    expect(enemyField(tl, 13)).toContain("Colossus Smash");
  });

  // codex T29-1 #1: pressed 10.000, its caster dead at 10.390, the debuff
  // applied 10.500 and never removed — the press landed after the death and
  // ran on (T28's `casterAuraOutlives` landing lag)
  it("timeline: a debuff applied just after its caster's death and running on keeps the window", () => {
    const { tl } = scene({
      spec: CombatUnitSpec.Warrior_Arms,
      presses: [[COLOSSUS_SMASH, at]],
      hits: [hit(COLOSSUS_SMASH, at)],
      targetAuras: [debuff(LogEvent.SPELL_AURA_APPLIED, CS_DEBUFF, at + 500)],
      deathS: 10.39,
    });
    const cd = cdOf(tl, "Colossus Smash");
    expect(cd.deathCutAtSeconds).toBeUndefined();
    expect(enemyField(tl, 11)).toContain("Colossus Smash");
  });

  // codex T29-1b #2: the kill sequence's single-cooldown fallback printed a
  // refused press as `[ENEMY CD] Deathmark active`
  it("kill sequence: a refused press is not `active` at a death", () => {
    const killSeq = (s: ReturnType<typeof scene>) => {
      const friend = s.combat.units.f1;
      return buildKillSequenceBlock({
        matchStartMs: START,
        matchEndSeconds: 20,
        owner: friend,
        friends: [friend],
        enemies: [s.enemy],
        ownerCDs: [],
        teammateCDs: [],
        enemyCDTimeline: s.tl,
        ccTrinketSummaries: [],
        friendlyDeaths: [{ spec: "x", name: friend.name, atSeconds: 15 }],
        enemyDeaths: [],
        isHealer: true,
        pid: (n: string) => n,
        actorLabel: (n: string) => n,
      } as never).join("\n");
    };
    const refused = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
      misses: [miss(DEATHMARK, at + 1)],
    });
    expect(killSeq(refused)).not.toContain("Deathmark active");
    const landed = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
    });
    expect(killSeq(landed)).toContain("Deathmark active");
  });

  // codex T29-1b #1: a row at the next press's own millisecond is that
  // press's — it does not rescue the refused one before it
  it("predicate + ledger: the next press's own hit does not rescue a refused channel", () => {
    const next = at + 2_168;
    const s = scene({
      spec: CombatUnitSpec.Mage_Frost,
      presses: [
        [RAY_OF_FROST, at],
        [RAY_OF_FROST, next],
      ],
      misses: [miss(RAY_OF_FROST, at + 1)],
      hits: [hit(RAY_OF_FROST, next)],
    });
    expect(
      pressEffectRefusedAtCast(s.enemy, RAY_OF_FROST, at, next, s.combat),
    ).toBe(true);
    const rays = s.tl.players[0]!.offensiveCDs.filter(
      (c: any) => c.spellName === "Ray of Frost",
    );
    expect(rays[0]?.refusedAtPress).toBe(true);
    const bursts = analyzeBurstLedger(
      s.enemy,
      [],
      [s.combat.units.f1],
      s.combat,
    ).filter((b) => b.spells.some((c) => c.spellName === "Ray of Frost"));
    expect(bursts.map((b) => b.fromSeconds)).toEqual([12.168]);
  });

  // codex T29-1c #1: a channel whose only tick a shield ate in full (an
  // ABSORB miss) landed — the channel reading's refusal does not flag it
  it("a channel absorbed in full is no refused press: the ledger keeps it", () => {
    const s = scene({
      spec: CombatUnitSpec.Mage_Frost,
      presses: [[RAY_OF_FROST, at]],
      misses: [miss(RAY_OF_FROST, at + 1, "ABSORB")],
    });
    const ray = cdOf(s.tl, "Ray of Frost");
    expect(ray.refusedAtPress).toBeUndefined();
    expect(
      analyzeBurstLedger(s.enemy, [], [s.combat.units.f1], s.combat).some((b) =>
        b.spells.some((c) => c.spellName === "Ray of Frost"),
      ),
    ).toBe(true);
  });

  // 39-3-227 r3 2:11: Grimoire: Imp Lord IMMUNE on the target in the same
  // millisecond its Imp Lord was summoned — the summon is the effect
  it("predicate: a press that put down a summon landed, whatever its own row read", () => {
    const GRIMOIRE = "1276452";
    const s = scene({
      spec: CombatUnitSpec.Warlock_Demonology,
      presses: [[GRIMOIRE, at]],
      misses: [miss(GRIMOIRE, at)],
    });
    expect(
      pressEffectRefusedAtCast(s.enemy, GRIMOIRE, at, Infinity, s.combat),
    ).toBe(true);
    s.combat.units.imp = makeUnit("imp", {
      name: "Imp Lord",
      actionIn: [
        {
          srcUnitId: "e1",
          destUnitId: "imp",
          spellId: GRIMOIRE,
          spellName: "Grimoire: Imp Lord",
          timestamp: at,
          logLine: { event: LogEvent.SPELL_SUMMON, timestamp: at },
        },
      ],
    } as any);
    expect(
      pressEffectRefusedAtCast(s.enemy, GRIMOIRE, at, Infinity, s.combat),
    ).toBe(false);
  });

  // codex T29-1e (310e5c6d r6 3:13): Soul Fire MISS, its talent's Overfiend
  // (434587, another id and name) summoned 7 ms after the press — inside the
  // start window any summon of the caster's counts; past it, only its own
  it("predicate: a talent's differently named summon inside the start window landed", () => {
    const SOUL_FIRE = "6353";
    const withSummon = (ms: number) => {
      const s = scene({
        spec: CombatUnitSpec.Warlock_Destruction,
        presses: [[SOUL_FIRE, at]],
        misses: [miss(SOUL_FIRE, at + 1_877, "MISS")],
      });
      s.combat.units.fiend = makeUnit("fiend", {
        name: "Overfiend",
        actionIn: [
          {
            srcUnitId: "e1",
            destUnitId: "fiend",
            spellId: "434587",
            spellName: "Overfiend",
            timestamp: ms,
            logLine: { event: LogEvent.SPELL_SUMMON, timestamp: ms },
          },
        ],
      } as any);
      return pressEffectRefusedAtCast(
        s.enemy,
        SOUL_FIRE,
        at,
        Infinity,
        s.combat,
      );
    };
    expect(withSummon(at + 7)).toBe(false);
    expect(withSummon(at + 2_500)).toBe(true);
  });

  // T29 a9 audit (0284fcd9 r1 2:17): Divine Toll cast on one enemy, IMMUNE
  // on a second while its Judgment struck the cast's target — a refusal
  // on another unit refuses nothing; the same IMMUNE on the cast's target
  // with nothing landed still does
  it("predicate: a refusal counts on the press's own target only", () => {
    const DIVINE_TOLL = "375576";
    const onOther = scene({
      spec: CombatUnitSpec.Paladin_Retribution,
      presses: [[DIVINE_TOLL, at]],
      misses: [{ ...miss(DIVINE_TOLL, at), destUnitId: "f2" }],
    });
    expect(
      pressEffectRefusedAtCast(
        onOther.enemy,
        DIVINE_TOLL,
        at,
        Infinity,
        onOther.combat,
      ),
    ).toBe(false);
    const onTarget = scene({
      spec: CombatUnitSpec.Paladin_Retribution,
      presses: [[DIVINE_TOLL, at]],
      misses: [miss(DIVINE_TOLL, at)],
    });
    expect(
      pressEffectRefusedAtCast(
        onTarget.enemy,
        DIVINE_TOLL,
        at,
        Infinity,
        onTarget.combat,
      ),
    ).toBe(true);
  });

  // T29 a9 audit (7da6cb8d r1 0:20): Meteor's cast row met an immune Chi-Ji at
  // the press; its impact (351140, same name) struck two players 2.2 s
  // later — past the start window, before the caster's next Meteor
  it("predicate: a delayed same-name impact before the next press landed", () => {
    const METEOR = "153561";
    const s = scene({
      spec: CombatUnitSpec.Mage_Fire,
      presses: [[METEOR, at]],
      misses: [{ ...miss(METEOR, at), destUnitId: "chi" }],
      hits: [{ ...hit("351140", at + 2_180), spellName: "Meteor" }],
    });
    // the ground-targeted cast row names no unit
    (s.enemy as any).spellCastEvents[0].destUnitId = "0000000000000000";
    expect(
      pressEffectRefusedAtCast(s.enemy, METEOR, at, Infinity, s.combat),
    ).toBe(false);
  });

  // the caster's own next cast row bounds the window even when the caller
  // passes no next press (the offensive-fact reader passes Infinity): the
  // second Deathmark's debuff does not rescue the refused first
  it("predicate: the caster's own next cast row bounds the landing window", () => {
    const s = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [
        [DEATHMARK, at],
        [DEATHMARK, at + 30_000],
      ],
      misses: [miss(DEATHMARK, at + 1)],
      targetAuras: [
        debuff(LogEvent.SPELL_AURA_APPLIED, DEATHMARK, at + 30_000),
      ],
    });
    expect(
      pressEffectRefusedAtCast(s.enemy, DEATHMARK, at, Infinity, s.combat),
    ).toBe(true);
  });

  // codex T29-1g #1: a later cast under another id of the same effect
  // (Frostwyrm's Fury 279302 striking 279303) bounds the refused 1265384's
  // window — its hit is no landing of the earlier press
  it("predicate: a later press under another id of the effect bounds the window", () => {
    const FWF = "1265384";
    const s = scene({
      spec: CombatUnitSpec.DeathKnight_Frost,
      presses: [
        [FWF, at],
        ["279302", at + 90_000],
      ],
      misses: [{ ...miss("279303", at + 1_300), destUnitId: "f1" }],
      hits: [{ ...hit("279303", at + 90_025), spellName: "Frostwyrm's Fury" }],
    });
    (s.enemy as any).spellCastEvents[0].destUnitId = "0000000000000000";
    expect(pressEffectRefusedAtCast(s.enemy, FWF, at, Infinity, s.combat)).toBe(
      true,
    );
  });

  // codex T29-1g #2: the next press's aura logged ahead of its own cast row
  // is that press's
  it("predicate: the next press's aura lead is no landing of the refused one", () => {
    const ES = "343527";
    const s = scene({
      spec: CombatUnitSpec.Paladin_Retribution,
      presses: [
        [ES, at],
        [ES, at + 60_000],
      ],
      misses: [miss(ES, at, "MISS")],
      targetAuras: [
        debuff(LogEvent.SPELL_AURA_APPLIED, "1234189", at + 59_999),
      ],
    });
    expect(pressEffectRefusedAtCast(s.enemy, ES, at, Infinity, s.combat)).toBe(
      true,
    );
  });

  // Odyn's Fury logs its swings (385060 / 385061 / 385062) as cast rows of
  // the same name inside the start window: they are the press, not its next
  it("predicate: the press's own swing casts do not end its window", () => {
    const OF = "385059";
    const s = scene({
      spec: CombatUnitSpec.Warrior_Fury,
      presses: [
        [OF, at],
        ["385060", at + 97],
        ["385061", at + 201],
      ],
      misses: [
        { ...miss("385060", at + 97, "PARRY") },
        { ...miss("385061", at + 201, "IMMUNE") },
      ],
    });
    (s.enemy as any).spellCastEvents[0].destUnitId = "0000000000000000";
    expect(pressEffectRefusedAtCast(s.enemy, OF, at, Infinity, s.combat)).toBe(
      true,
    );
  });

  // codex T29-1 #2: a refused press ran no burst — no `10–10` ledger entry
  it("burst ledger: a refused press is no burst; the same press landing is one", () => {
    const refused = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
      misses: [miss(DEATHMARK, at + 1)],
    });
    const names = (s: ReturnType<typeof scene>) =>
      analyzeBurstLedger(s.enemy, [], [s.combat.units.f1], s.combat).flatMap(
        (b) => b.spells.map((c) => c.spellName),
      );
    expect(names(refused)).not.toContain("Deathmark");
    const landed = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
    });
    expect(names(landed)).toContain("Deathmark");
  });
});

// T29 user rulings R14 + R15 (2026-11-09): the intent layer — a refused
// press stays a press, says it was refused, and, where the log decides it,
// whether its cooldown was spent
describe("T29 R15 — a refused press's intent facts", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  const at = START + 10_000;
  const failed = (spellId: string, tSeconds: number, reason = NOT_READY_REASON_ZH) => ({
    tSeconds,
    unitGuid: "e1",
    spellId: Number(spellId),
    spellName: "x",
    reason,
  });

  it("marker: the three wordings, and the gate's regex reads each back", () => {
    expect(refusedPressMarker("IMMUNE", "spent")).toBe(
      "(refused: IMMUNE; cooldown spent)",
    );
    expect(refusedPressMarker("DODGE", "not spent")).toBe(
      "(refused: DODGE; cooldown not spent)",
    );
    expect(refusedPressMarker("MISS")).toBe("(refused: MISS)");
    for (const [miss, cd] of [
      ["IMMUNE", "spent"],
      ["DODGE", "not spent"],
      ["MISS", undefined],
    ] as const) {
      const m = REFUSED_PRESS_MARKER_RE.exec(
        `Touch of the Magi +0.6s ${refusedPressMarker(miss, cd)}`,
      );
      expect(m?.[1]).toBe(miss);
      expect(m?.[2]).toBe(cd);
    }
  });

  it("predicate: the miss type is the refusing miss row's", () => {
    const s = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
      misses: [miss(DEATHMARK, at + 1, "DODGE")],
    });
    expect(
      pressRefusalMissType(s.enemy, DEATHMARK, at, Infinity, s.combat),
    ).toBe("DODGE");
    expect(cdOf(s.tl, "Deathmark").refusedMissType).toBe("DODGE");
  });

  it("cooldown not spent: a later press the ledger allows only without the refused one", () => {
    // 129-1 r1 0:47 shape: Ray of Frost refused, recast 12.4 s later
    const s = scene({
      spec: CombatUnitSpec.Mage_Frost,
      presses: [
        [RAY_OF_FROST, at],
        [RAY_OF_FROST, at + 12_400],
      ],
      misses: [miss(RAY_OF_FROST, at + 1)],
    });
    expect(refusedPressCooldownState(s.enemy, s.combat, RAY_OF_FROST, 10)).toBe(
      "not spent",
    );
    // the same recast a full cooldown later decides nothing
    const late = scene({
      spec: CombatUnitSpec.Mage_Frost,
      presses: [
        [RAY_OF_FROST, at],
        [RAY_OF_FROST, at + 200_000],
      ],
      misses: [miss(RAY_OF_FROST, at + 1)],
    });
    expect(
      refusedPressCooldownState(late.enemy, late.combat, RAY_OF_FROST, 10),
    ).toBeUndefined();
  });

  it("cooldown spent: the recorder's own 'not ready' refusal only the press explains", () => {
    // 62-6 r6 shape: Touch of the Magi refused, its recasts "尚未恢复"
    const s = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [[DEATHMARK, at]],
      misses: [miss(DEATHMARK, at + 1)],
    });
    const state = (rows: ReturnType<typeof failed>[]) =>
      refusedPressCooldownState(s.enemy, s.combat, DEATHMARK, 10, rows);
    expect(state([failed(DEATHMARK, 12.8)])).toBe("spent");
    // inside the GCD after the press: the refusal may be the GCD's
    expect(state([failed(DEATHMARK, 11)])).toBeUndefined();
    // another reason, another spell, another unit, or none: undecided
    expect(state([failed(DEATHMARK, 12.8, "Out of range")])).toBeUndefined();
    expect(state([failed(RAY_OF_FROST, 12.8)])).toBeUndefined();
    expect(
      state([{ ...failed(DEATHMARK, 12.8), unitGuid: "f1" }]),
    ).toBeUndefined();
    expect(state([])).toBeUndefined();
  });

  it("kill attempts (R15 (1)): a refused press is still an attempt, on the window it had before the refusal", () => {
    const run = (misses: any[]) => {
      const s = scene({
        spec: CombatUnitSpec.Rogue_Assassination,
        presses: [[DEATHMARK, at]],
        misses,
        hits: [{ ...hit("1329", at + 2_000), amount: 60_000 }],
      });
      return {
        cd: cdOf(s.tl, "Deathmark"),
        attempts: extractKillAttempts([s.enemy], [s.combat.units.f1], {
          ...s.combat,
          startInfo: { zoneId: "1505" },
        }),
      };
    };
    const refused = run([miss(DEATHMARK, at + 1)]);
    const landed = run([]);
    expect(refused.cd.refusedAtPress).toBe(true);
    expect(refused.cd.buffEndSeconds).toBe(10);
    expect(refused.cd.refusedOfficialEndSeconds).toBe(landed.cd.buffEndSeconds);
    expect(landed.attempts).toHaveLength(1);
    expect(
      refused.attempts.map((a) => [a.anchorSpellName, a.fromSeconds, a.toSeconds]),
    ).toEqual(
      landed.attempts.map((a) => [a.anchorSpellName, a.fromSeconds, a.toSeconds]),
    );
  });

  // a13 (605): 167-5 r5 0:37 Ray of Frost into a Grounding Totem, 39-3 r3
  // 2:09 Ray of Frost IMMUNE — main's attempt ran 0:37–0:37 / 2:09–2:09 (the
  // channel's own refusal ended it at the press); the kept end is that one,
  // not the official 4 s
  it("kill attempts: a refused channel keeps the end main gave it, not the official length", () => {
    const s = scene({
      spec: CombatUnitSpec.Mage_Frost,
      presses: [[RAY_OF_FROST, at]],
      misses: [miss(RAY_OF_FROST, at + 1)],
    });
    const ray = cdOf(s.tl, "Ray of Frost");
    expect(ray.refusedAtPress).toBe(true);
    expect(ray.refusedOfficialEndSeconds).toBe(10);
  });

  // codex T29-1i #1: a "not ready" refusal right after another cast row may
  // be that cast's global cooldown
  it("cooldown spent: a 'not ready' refusal inside a later cast's GCD proves nothing", () => {
    const s = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [
        [DEATHMARK, at],
        ["1329", at + 2_500],
      ],
      misses: [miss(DEATHMARK, at + 1)],
    });
    const state = (t: number) =>
      refusedPressCooldownState(s.enemy, s.combat, DEATHMARK, 10, [
        failed(DEATHMARK, t),
      ]);
    expect(state(12.8)).toBeUndefined();
    expect(state(14.5)).toBe("spent");
    // codex T29-1j #1: a cast row in the failure's own millisecond too
    const same = scene({
      spec: CombatUnitSpec.Rogue_Assassination,
      presses: [
        [DEATHMARK, at],
        ["1329", at + 2_800],
      ],
      misses: [miss(DEATHMARK, at + 1)],
    });
    expect(
      refusedPressCooldownState(same.enemy, same.combat, DEATHMARK, 10, [
        failed(DEATHMARK, 12.8),
      ]),
    ).toBeUndefined();
  });

  // codex T29-1i #3: two refused presses of a two-charge spell, either of
  // which could have kept its charge, decide nothing
  it("cooldown not spent: two refused presses that could each explain the refund decide nothing", () => {
    const run = (refusedBoth: boolean) => {
      const s = scene({
        spec: CombatUnitSpec.Mage_Frost,
        presses: [
          [RAY_OF_FROST, at],
          [RAY_OF_FROST, at + 10_000],
          [RAY_OF_FROST, at + 20_000],
        ],
        misses: [
          miss(RAY_OF_FROST, at + 1),
          ...(refusedBoth ? [miss(RAY_OF_FROST, at + 10_001)] : []),
        ],
        // Hand of Frost: a second charge (60 s each)
        info: {
          talents: [{ id1: 110422, id2: 137032, count: 1 }],
          pvpTalents: [],
        },
      });
      return [10, 20].map((t) =>
        refusedPressCooldownState(s.enemy, s.combat, RAY_OF_FROST, t),
      );
    };
    expect(run(true)).toEqual([undefined, undefined]);
    // only the first refused: it alone explains the third press
    expect(run(false)[0]).toBe("not spent");
  });

  it("missed-sync pressedAfter: a refused press keeps its entry and carries the marker", () => {
    const cd = {
      spellId: "321507",
      spellName: "Touch of the Magi",
      casts: [{ timeSeconds: 64.984 }],
      cooldownSeconds: 45,
      neverUsed: false,
      charges: 1,
      refusedAt: new Map([
        [64_984, { marker: "(refused: IMMUNE; cooldown spent)", officialEndS: 76.984 }],
      ]),
    } as never;
    expect(
      syncReadyTimingFacts({ fromSeconds: 60.1, toSeconds: 64.4 }, [cd])
        .pressedAfter,
    ).toBe("Touch of the Magi +0.6s (refused: IMMUNE; cooldown spent)");
  });

  it("missed-sync priorPress: a refused press before the lock whose window would have reached it", () => {
    const cd = (ms: number, officialEndS: number) =>
      ({
        spellName: "Touch of the Magi",
        refusedAt: new Map([
          [ms, { marker: "(refused: IMMUNE; cooldown spent)", officialEndS }],
        ]),
      }) as never;
    const w = { fromSeconds: 69.2 };
    expect(syncPriorRefusedPresses(w, [cd(64_984, 76.984)])).toEqual([
      "Touch of the Magi at 64 (refused: IMMUNE; cooldown spent)",
    ]);
    // a window that would have ended before the lock: nothing
    expect(syncPriorRefusedPresses(w, [cd(64_984, 69)])).toEqual([]);
    // inside the 2 s lead the press is pressedIn's, not repeated here
    expect(syncPriorRefusedPresses(w, [cd(67_500, 79.5)])).toEqual([]);
  });
});
