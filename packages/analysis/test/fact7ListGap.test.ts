/**
 * fact7 class 3 (F21, 2026-10-30): a real cooldown press with no line in the
 * prompt. The forward check is `packages/eval/scripts/scan5/listGap.ts`
 * (`listGapPress`); these pin the three lists its gaps fell through.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import { emitEnemyCdEntries } from "../src/context/timelineSections/enemyCd";
import { emitFriendlyFormEntries } from "../src/context/timelineSections/friendlyCheatDeath";
import { classMetadata } from "../src/data/classSpells";
import { isEnemyHealCdFor } from "../src/data/enemyHealCds";
import { ensureAnalysisData } from "../src/data/ensure";
import { effectiveCooldownSeconds } from "../src/data/spellEffectData";
import { SpellTag } from "../src/data/spellTypes";
import { extractMajorCooldowns } from "../src/utils/cooldowns";
import { reconstructEnemyCDTimeline } from "../src/utils/enemyCDs";
import { auraOffensiveOccurrences } from "../src/utils/offensiveAuraOccurrences";
import {
  OFFENSIVE_CD_SPELL_IDS,
  OFFENSIVE_PRESS_FACT_IDS,
} from "../src/utils/spellDanger";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const END = T0 + 300_000;
const combat = { startTime: T0, endTime: END, units: {} } as never;
const cast = (spellId: string, s: number) => ({
  spellId,
  spellName: spellId,
  srcUnitId: "u",
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + s * 1000 },
});
const aura = (spellId: string, s: number, event: LogEvent) => ({
  spellId,
  spellName: spellId,
  srcUnitId: "u",
  destUnitId: "u",
  timestamp: T0 + s * 1000,
  logLine: { event, timestamp: T0 + s * 1000 },
});
const unit = (
  unitClass: CombatUnitClass,
  spec: CombatUnitSpec,
  spellCastEvents: unknown[],
  auraEvents: unknown[] = [],
) =>
  ({
    id: "u",
    name: "Enemy",
    class: unitClass,
    spec,
    spellCastEvents,
    auraEvents,
    damageIn: [],
    damageOut: [],
    healOut: [],
    healIn: [],
  }) as never;
const enemyLines = (enemies: unknown[]) => {
  const lines: string[] = [];
  emitEnemyCdEntries({
    enemyCDTimeline: reconstructEnemyCDTimeline(enemies as never, combat),
    cdPurgeAnnotations: new Map(),
    addEntry: (_t: number, ...l: unknown[]) => {
      lines.push(...(l as string[]));
      return true;
    },
    enemyPid: (n: string) => `5(${n})`,
    matchStartMs: T0,
    matchEndSeconds: 300,
    enemies: enemies as never,
  });
  return lines;
};

describe("OFFENSIVE_PRESS_FACT_IDS", () => {
  it("every member is a ≥ 45 s roster Utility row and no window member", () => {
    const roster = new Map(
      classMetadata.flatMap((c) =>
        c.abilities.map((a) => [a.spellId, a.tags] as const),
      ),
    );
    for (const id of OFFENSIVE_PRESS_FACT_IDS) {
      expect(OFFENSIVE_CD_SPELL_IDS.has(id), id).toBe(false);
      expect(roster.get(id), id).toEqual([SpellTag.Utility]);
      expect(effectiveCooldownSeconds(id) ?? 0, id).toBeGreaterThanOrEqual(45);
    }
  });
  // pipeline T72 (user ruling R19, 2026-11-10): Odyn's Fury is a major
  // offensive cooldown now — the same [ENEMY CD] lines, on a burst row
  // (was a press fact that opened nothing)
  it("D8: Odyn's Fury is an [ENEMY CD] line — an offensive cooldown row since R19", () => {
    const enemy = unit(CombatUnitClass.Warrior, CombatUnitSpec.Warrior_Fury, [
      cast("385059", 34.25),
      cast("385059", 87.05),
    ]);
    expect(enemyLines([enemy])).toEqual([
      "0:34  [ENEMY CD]   5(Enemy) (Fury Warrior): Odyn's Fury (cast 1 of 2)",
      "1:27  [ENEMY CD]   5(Enemy) (Fury Warrior): Odyn's Fury (cast 2 of 2)",
    ]);
    const t = reconstructEnemyCDTimeline([enemy], combat);
    expect(t.players[0]!.offensiveCDs.map((c) => c.spellId)).toEqual([
      "385059",
      "385059",
    ]);
    expect(t.players[0]!.offensiveFacts ?? []).toEqual([]);
  });
  it("a press fact's effect runs through a rebroadcast of its aura (codex 02-1; Deep Breath since R19 took Odyn's Fury)", () => {
    const enemy = unit(
      CombatUnitClass.Evoker,
      CombatUnitSpec.Evoker_Devastation,
      [cast("433874", 40.77)],
      [
        aura("433874", 40.9, LogEvent.SPELL_AURA_APPLIED),
        aura("433874", 43.0, LogEvent.SPELL_AURA_REMOVED),
        aura("433874", 43.001, LogEvent.SPELL_AURA_APPLIED),
        aura("433874", 44.9, LogEvent.SPELL_AURA_REMOVED),
      ],
    );
    const round = { startTime: T0, endTime: END, units: { u: enemy } } as never;
    const t = reconstructEnemyCDTimeline([enemy], round);
    expect(t.players[0]!.offensiveFacts?.[0]?.buffEndSeconds).toBeCloseTo(
      44.9,
      3,
    );
  });
  it("D75: Divine Toll by spec — Retribution's [ENEMY CD], Holy's [ENEMY HEAL CD]", () => {
    const ret = unit(
      CombatUnitClass.Paladin,
      CombatUnitSpec.Paladin_Retribution,
      [cast("375576", 11.4)],
    );
    const holy = unit(CombatUnitClass.Paladin, CombatUnitSpec.Paladin_Holy, [
      cast("375576", 11.4),
    ]);
    expect(enemyLines([ret])).toEqual([
      "0:11  [ENEMY CD]   5(Enemy) (Retribution Paladin): Divine Toll",
    ]);
    expect(enemyLines([holy])).toEqual([
      "0:11  [ENEMY HEAL CD]   5(Enemy) (Holy Paladin): Divine Toll",
    ]);
  });
  // GH #184 (user ruling 2026-11-05): Ravager is a major offensive
  // cooldown now — its row is Offensive (was Utility as a press fact)
  it("D16: a friendly press has a ledger row (press line, kit, [RES]) — Offensive since GH #184", () => {
    const row = extractMajorCooldowns(
      unit(CombatUnitClass.Warrior, CombatUnitSpec.Warrior_Arms, [
        cast("228920", 25.5),
      ]),
      combat,
    ).find((c) => c.spellId === "228920");
    expect(row?.casts.length).toBe(1);
    expect(row?.tag).toBe(SpellTag.Offensive);
  });
  it("D78: both Deep Breath ids, one row for the unit, the id it pressed", () => {
    const rows = extractMajorCooldowns(
      unit(CombatUnitClass.Evoker, CombatUnitSpec.Evoker_Devastation, [
        cast("433874", 18),
        cast("433874", 150),
      ]),
      combat,
    ).filter((c) => c.spellName === "Deep Breath");
    expect(rows.map((c) => c.spellId)).toEqual(["433874"]);
    expect(rows[0]!.casts.length).toBe(2);
  });
});

/** the `[RES] enemy:` field of a row anchored at second `t` */
const enemyField = (timeline: unknown, t: number) =>
  buildResourceSnapshot({
    timeSeconds: t,
    ownerCDs: [],
    ownerName: "Owner",
    ownerSpec: "Restoration Druid",
    teammateCDs: [],
    ccTrinketSummaries: [],
    enemyCDTimeline: timeline as never,
    matchStartMs: T0,
  }).match(/enemy:(.+)$/)?.[1];

describe("[RES] enemy: lists a press fact while its effect runs", () => {
  /** Deep Breath lands on its victim: the rows sit on the unit wearing it
   * (Odyn's Fury and Goremaw's Bite carried these until R19 made them
   * offensive cooldowns, pipeline T72) */
  const victimAura = (s: number, event: LogEvent) => ({
    ...aura("1236943", s, event),
    spellName: "Deep Breath",
    destUnitId: "v",
  });
  const fury = unit(CombatUnitClass.Evoker, CombatUnitSpec.Evoker_Devastation, [
    cast("433874", 40.77),
  ]);
  const victim = {
    id: "v",
    auraEvents: [
      victimAura(40.9, LogEvent.SPELL_AURA_APPLIED),
      victimAura(44.9, LogEvent.SPELL_AURA_REMOVED),
    ],
  };
  const withVictim = {
    startTime: T0,
    endTime: END,
    units: { u: fury, v: victim },
  } as never;

  it("the effect's end comes off the victim's aura rows", () => {
    const t = reconstructEnemyCDTimeline([fury], withVictim);
    const row = t.players[0]!.offensiveFacts![0]!;
    expect(row.buffEndSeconds).toBeCloseTo(44.9, 3);
    expect(enemyField(t, 40)).toBe("Deep Breath/Devastation Evoker(5s left)");
    expect(enemyField(t, 44)).toBe("Deep Breath/Devastation Evoker(1s left)");
    expect(enemyField(t, 45)).toBeUndefined();
  });

  it("an aura the log never closes runs its own official length (seen on Goremaw's Bite, 75-1-523)", () => {
    const breath = {
      ...aura("1236943", 150.129, LogEvent.SPELL_AURA_APPLIED),
      spellName: "Deep Breath",
      destUnitId: "v",
    };
    const rogue = unit(
      CombatUnitClass.Evoker,
      CombatUnitSpec.Evoker_Devastation,
      [cast("433874", 150.128)],
    );
    const round = {
      startTime: T0,
      endTime: END,
      units: { u: rogue, v: { id: "v", auraEvents: [breath] } },
    } as never;
    const row = reconstructEnemyCDTimeline([rogue], round).players[0]!
      .offensiveFacts![0]!;
    expect(row.buffEndSeconds).toBeCloseTo(154.129, 3);
    // 72-1-407: its wearer dead, the effect is over
    const dead = {
      startTime: T0,
      endTime: END,
      units: {
        u: rogue,
        v: {
          id: "v",
          auraEvents: [breath],
          deathRecords: [{ timestamp: T0 + 151_000 }],
        },
      },
    } as never;
    const cut = reconstructEnemyCDTimeline([rogue], dead).players[0]!
      .offensiveFacts![0]!;
    expect(cut.buffEndSeconds).toBeCloseTo(151, 3);
    // a row before the death states the official time left (codex 20-F21-12)
    expect(cut.deathCutOfficialEndSeconds).toBeCloseTo(154.129, 3);
    // a death past the round's end is no end of it
    const later = {
      startTime: T0,
      endTime: T0 + 153_000,
      units: {
        u: rogue,
        v: {
          id: "v",
          auraEvents: [breath],
          deathRecords: [{ timestamp: T0 + 155_000 }],
        },
      },
    } as never;
    expect(
      reconstructEnemyCDTimeline([rogue], later).players[0]!.offensiveFacts![0]!
        .buffEndSeconds,
    ).toBeCloseTo(154.129, 3);
  });

  it("a button with no effect span states no window: no 8 s fallback", () => {
    // Touch of Death: a press fact with no duration of its own
    const monk = unit(CombatUnitClass.Monk, CombatUnitSpec.Monk_Windwalker, [
      cast("322109", 40.77),
    ]);
    const t = reconstructEnemyCDTimeline([monk], combat);
    expect(t.players[0]!.offensiveFacts![0]!.buffEndSeconds).toBeCloseTo(
      40.77,
      3,
    );
    expect(enemyField(t, 41)).toBeUndefined();
  });
});

describe("Vampiric Embrace (D51 / D55)", () => {
  it("a Shadow Priest's press is [ENEMY HEAL CD], not [ENEMY UTILITY]", () => {
    expect(isEnemyHealCdFor("15286", CombatUnitSpec.Priest_Shadow)).toBe(true);
    expect(
      enemyLines([
        unit(CombatUnitClass.Priest, CombatUnitSpec.Priest_Shadow, [
          cast("15286", 14.3),
          cast("15286", 135.6),
        ]),
      ]),
    ).toEqual([
      "0:14  [ENEMY HEAL CD]   5(Enemy) (Shadow Priest): Vampiric Embrace (cast 1 of 2)",
      "2:15  [ENEMY HEAL CD]   5(Enemy) (Shadow Priest): Vampiric Embrace (cast 2 of 2)",
    ]);
  });
});

describe("Void Metamorphosis (D69): a form with no button", () => {
  const form = [
    aura("1217607", 40.7, LogEvent.SPELL_AURA_APPLIED),
    aura("1217607", 69.3, LogEvent.SPELL_AURA_REMOVED),
  ];
  const dh = unit(
    CombatUnitClass.DemonHunter,
    CombatUnitSpec.DemonHunter_Devourer,
    [],
    form,
  );
  it("enemy: a `(no press)` [ENEMY CD] line, never a burst", () => {
    expect(enemyLines([dh])).toEqual([
      "0:40  [ENEMY CD]   5(Enemy) (Devourer Demon Hunter): Void Metamorphosis (no press)",
    ]);
    const [o] = auraOffensiveOccurrences(dh, combat as never).occurrences;
    expect(o).toMatchObject({ burstRole: "fact", dangerWeight: 0 });
    expect(
      reconstructEnemyCDTimeline([dh], combat).players[0]!.offensiveCDs,
    ).toEqual([]);
  });
  it("friendly: [YOU] / [TEAM] [PROC], no HP", () => {
    const lines: string[] = [];
    const emitted = emitFriendlyFormEntries({
      owner: { id: "me", auraEvents: [] } as never,
      friends: [dh] as never,
      matchStartMs: T0,
      matchEndSeconds: 300,
      pid: () => "2(DDH)",
      addEntry: (_t, l) => {
        lines.push(l);
      },
    });
    expect(emitted).toBe(true);
    expect(lines).toEqual([
      "0:40  [TEAM] [PROC]   2(DDH) (Devourer Demon Hunter): Void Metamorphosis",
    ]);
  });
  it("friendly: a REMOVED/APPLIED rebroadcast is one form, one line (codex 02-2)", () => {
    const lines: string[] = [];
    emitFriendlyFormEntries({
      owner: { id: "me", auraEvents: [] } as never,
      friends: [
        unit(
          CombatUnitClass.DemonHunter,
          CombatUnitSpec.DemonHunter_Devourer,
          [],
          [
            aura("1217607", 40.7, LogEvent.SPELL_AURA_APPLIED),
            aura("1217607", 50.0, LogEvent.SPELL_AURA_REMOVED),
            aura("1217607", 50.001, LogEvent.SPELL_AURA_APPLIED),
            aura("1217607", 69.3, LogEvent.SPELL_AURA_REMOVED),
          ],
        ),
      ] as never,
      matchStartMs: T0,
      matchEndSeconds: 300,
      pid: () => "2(DDH)",
      addEntry: (_t, l) => {
        lines.push(l);
      },
    });
    expect(lines).toHaveLength(1);
  });
});
