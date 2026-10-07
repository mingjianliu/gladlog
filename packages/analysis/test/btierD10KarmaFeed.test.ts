/**
 * B-tier D10 B20a (user ruling 2026-10-06/07): the `[ENEMY DEF] … Touch of
 * Karma` line says what our side fed it — by PRESS time, only spells pressed
 * 1 s or more after it went up; ticks of effects already running apart — and
 * where it sent the damage. A fact, never an accusation.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import observed from "../src/data/observedSpellIdsGenerated.json";
import { getEnglishSpellName } from "../src/data/spellEffectData";
import inventory from "../src/data/talentEffectInventoryGenerated.json";
import {
  AUTO_ATTACK_REPLACEMENT_IDS,
  CAST_START_LOOKBACK_S,
  pressBehindDamage,
  pressBehindDamageOf,
  spellTicksFor,
} from "../src/utils/damagePress";
import {
  karmaFeedClause,
  karmaFeedOf,
  TOUCH_OF_KARMA_ID,
  TOUCH_OF_KARMA_REDIRECT_ID,
} from "../src/utils/karmaFeed";

const START = 1_000_000;
const at = (s: number) => START + s * 1000;
const cast = (s: number, spellId: string, spellName: string): any => ({
  spellId,
  spellName,
  timestamp: at(s),
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: at(s) },
});
const tick = (spellId: string): any => ({
  spellId,
  timestamp: at(1),
  logLine: { event: LogEvent.SPELL_PERIODIC_DAMAGE, timestamp: at(1) },
});
const absorbed = (
  s: number,
  attackerId: string,
  amount: number,
  attackSpellId?: string,
  attackSpellName?: string,
  shield = TOUCH_OF_KARMA_ID,
): any => ({
  spellId: shield,
  timestamp: at(s),
  attackerId,
  absorbedAmount: amount,
  attackSpellId,
  attackSpellName,
});
const back = (s: number, dest: string, amount: number): any => ({
  spellId: TOUCH_OF_KARMA_REDIRECT_ID,
  timestamp: at(s),
  destUnitId: dest,
  destUnitName: `${dest}-Realm`,
  effectiveAmount: -amount,
  logLine: { event: LogEvent.SPELL_PERIODIC_DAMAGE, timestamp: at(s) },
});

const STARSURGE = "78674";
const MOONFIRE = "8921";
const MUTILATE_CAST = "1329";
const MUTILATE_HIT = "5374";

describe("the ids are ones the corpus logs", () => {
  it("cast / shield id and redirect id", () => {
    const seen = new Set(
      (observed as unknown as Array<string | number>).map(String),
    );
    expect(seen.has(TOUCH_OF_KARMA_ID)).toBe(true);
    expect(seen.has(TOUCH_OF_KARMA_REDIRECT_ID)).toBe(true);
  });
});

describe("AUTO_ATTACK_REPLACEMENT_IDS (user ruling 2026-10-07: not a press)", () => {
  const rows = (inventory as unknown as { rows: Array<Record<string, any>> })
    .rows;
  // aura 361 = override the auto-attack with a melee spell
  const overrides = rows.filter(
    (r) => r.effect === 6 && r.aura === 361 && r.activation === "passive",
  );
  const names = (ids: Iterable<string>) =>
    new Set([...ids].map((id) => getEnglishSpellName(id, "")));

  it("every id is one the corpus logs", () => {
    const seen = new Set(
      (observed as unknown as Array<string | number>).map(String),
    );
    for (const id of AUTO_ATTACK_REPLACEMENT_IDS)
      expect(seen.has(id)).toBe(true);
  });

  it("official data, both ways: each listed spell is named after a passive aura-361 talent, and every such talent has its spell listed", () => {
    const talentNames = names(overrides.map((r) => String(r.spellId)));
    const listedNames = names(AUTO_ATTACK_REPLACEMENT_IDS);
    expect(talentNames.size).toBeGreaterThan(0);
    expect([...listedNames].sort()).toEqual([...talentNames].sort());
    expect(listedNames.has("")).toBe(false);
  });

  it("a hit of such a spell has no press, whatever cast rows the log wrote for it", () => {
    const paladin = {
      spellCastEvents: [
        cast(57, "408385", "Crusading Strikes"),
        cast(59, "408385", "Crusading Strikes"),
      ],
    };
    expect(
      pressBehindDamageOf(paladin, "408385", "Crusading Strikes", at(59)),
    ).toBeNull();
  });
});

describe("pressBehindDamage", () => {
  const druid = {
    spellCastEvents: [
      cast(50, MOONFIRE, "Moonfire"),
      cast(59.287, STARSURGE, "Starsurge"),
      cast(70, STARSURGE, "Starsurge"),
      {
        ...cast(59.9, "999", "Starsurge"),
        logLine: { event: LogEvent.SPELL_CAST_START, timestamp: at(59.9) },
      },
    ],
  };
  it("the latest SUCCESS of the same id at or before the row", () => {
    expect(pressBehindDamage(druid, STARSURGE, "Starsurge", at(59.356))).toBe(
      at(59.287),
    );
    expect(pressBehindDamage(druid, STARSURGE, "Starsurge", at(71))).toBe(
      at(70),
    );
    expect(pressBehindDamage(druid, MOONFIRE, "Moonfire", at(60.9))).toBe(
      at(50),
    );
  });
  it("a damage id no cast carries: the cast of the same spell name", () => {
    const rogue = {
      spellCastEvents: [cast(56.9, MUTILATE_CAST, "Mutilate")],
    };
    expect(pressBehindDamage(rogue, MUTILATE_HIT, "Mutilate", at(57))).toBe(
      at(56.9),
    );
  });
  it("no press: a swing, a proc with no cast of its name, a row before every cast", () => {
    expect(pressBehindDamage(druid, undefined, undefined, at(60))).toBeNull();
    expect(
      pressBehindDamage(druid, "452538", "Fatebound Coin (Tails)", at(60)),
    ).toBeNull();
    expect(pressBehindDamage(druid, STARSURGE, "Starsurge", at(40))).toBeNull();
  });
});

describe("pressBehindDamageOf: the moment the player committed", () => {
  const start = (s: number, spellId: string, spellName: string): any => ({
    spellId,
    spellName,
    timestamp: at(s),
    logLine: { event: LogEvent.SPELL_CAST_START, timestamp: at(s) },
  });
  const emp = (s: number, spellId: string, level = 1): any => ({
    spellId,
    spellName: "Fire Breath",
    timestamp: at(s),
    level,
    logLine: { timestamp: at(s), lineIndex: Math.round(s * 1000) },
  });
  const POLY = "118";
  const FIRE_BREATH_CAST = "357208";
  const FIRE_BREATH_HIT = "357209";

  it("a hard cast: the press is the cast START, when one sits within the lookback before the success", () => {
    const mage = {
      spellCastEvents: [cast(21.6, POLY, "Polymorph")],
      castStartEvents: [start(20, POLY, "Polymorph")],
    };
    expect(pressBehindDamageOf(mage, POLY, "Polymorph", at(21.7))).toEqual({
      pressMs: at(20),
      kind: "cast-start",
    });
    // a start too far back (an earlier, cancelled bar) is not this cast's
    const stale = {
      spellCastEvents: [cast(21.6, POLY, "Polymorph")],
      castStartEvents: [
        start(21.6 - CAST_START_LOOKBACK_S - 0.1, POLY, "Polymorph"),
      ],
    };
    expect(pressBehindDamageOf(stale, POLY, "Polymorph", at(21.7))).toEqual({
      pressMs: at(21.6),
      kind: "cast",
    });
  });

  it("an empowered spell: the press is the RELEASE, not the success the log writes when the hold begins", () => {
    const evoker = {
      spellCastEvents: [cast(30, FIRE_BREATH_CAST, "Fire Breath")],
      empowerStarts: [emp(30.001, FIRE_BREATH_CAST)],
      empowerEnds: [emp(31.8, FIRE_BREATH_CAST, 3)],
      empowerInterrupts: [],
    };
    // the damage id differs from the cast id: same name
    expect(
      pressBehindDamageOf(evoker, FIRE_BREATH_HIT, "Fire Breath", at(31.9)),
    ).toEqual({ pressMs: at(31.8), kind: "empower-release" });
    // before the release nothing was pressed yet
    expect(
      pressBehindDamageOf(evoker, FIRE_BREATH_HIT, "Fire Breath", at(31)),
    ).toBeNull();
  });

  it("a hold that was not released fired nothing", () => {
    const evoker = {
      spellCastEvents: [cast(30, FIRE_BREATH_CAST, "Fire Breath")],
      empowerStarts: [emp(30.001, FIRE_BREATH_CAST)],
      empowerEnds: [],
      empowerInterrupts: [emp(30.9, FIRE_BREATH_CAST, 0)],
    };
    expect(
      pressBehindDamageOf(evoker, FIRE_BREATH_HIT, "Fire Breath", at(32)),
    ).toBeNull();
  });
});

describe("spellTicksFor", () => {
  it("true only when the unit has a periodic row of that spell", () => {
    const u = { damageOut: [tick(MOONFIRE)] };
    expect(spellTicksFor(u, MOONFIRE)).toBe(true);
    expect(spellTicksFor(u, STARSURGE)).toBe(false);
  });
});

describe("karmaFeedOf / karmaFeedClause", () => {
  // Touch of Karma pressed at 55.4 (b711d4ac's 0:55, simplified)
  const druid: any = {
    id: "d",
    name: "Druid-Realm",
    spellCastEvents: [
      cast(50, MOONFIRE, "Moonfire"),
      cast(59.287, STARSURGE, "Starsurge"),
    ],
    damageOut: [tick(MOONFIRE)],
  };
  const rogue: any = {
    id: "r",
    name: "Rogue-Realm",
    spellCastEvents: [
      // pressed 0.6 s after Karma went up: inside the reaction window
      cast(56.0, MUTILATE_CAST, "Mutilate"),
      cast(58.0, MUTILATE_CAST, "Mutilate"),
    ],
    damageOut: [],
  };
  const pet: any = { id: "pet", ownerId: "r" };
  const label = (name: string) => name.split("-")[0]!;
  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const monk = (absorbs: any[], damageOut: any[] = []): any => ({
    absorbsIn: absorbs,
    damageOut,
  });
  const feed = (m: any, next?: number) =>
    karmaFeedOf(m, 55.4, next, [druid, rogue], [druid, rogue, pet], START);

  it("splits by press time: after the cut / ticks already running / the rest in the total only", () => {
    const f = feed(
      monk(
        [
          absorbed(56.05, "r", 30_000, MUTILATE_HIT, "Mutilate"), // press 56.0 < cut 56.4
          absorbed(57.7, "d", 3_600, MOONFIRE, "Moonfire"), // tick, press 50
          absorbed(58.05, "r", 40_000, MUTILATE_HIT, "Mutilate"), // press 58.0
          absorbed(59.356, "d", 51_440, STARSURGE, "Starsurge"), // press 59.287
          absorbed(59.5, "r", 9_000), // a swing
          absorbed(60, "pet", 5_000, "17253", "Bite"), // a pet
          absorbed(60.5, "x", 77_000, STARSURGE, "Starsurge"), // not ours
          absorbed(60.6, "d", 88_000, STARSURGE, "Starsurge", "17"), // another shield
        ],
        [back(56.7, "d", 100_000), back(68.7, "d", 222_000)],
      ),
    );
    expect(f.fed).toEqual([
      { playerId: "d", playerName: "Druid-Realm", amount: 51_440 },
      { playerId: "r", playerName: "Rogue-Realm", amount: 40_000 },
    ]);
    expect(f.dotsAlreadyTicking).toBe(3_600);
    // the Mutilate pressed 0.4 s before the cut; the swing and the pet's
    // bite have no press and stay in the total only
    expect(f.pressedBefore).toBe(30_000);
    expect(f.absorbedTotal).toBe(
      30_000 + 3_600 + 40_000 + 51_440 + 9_000 + 5_000,
    );
    expect(f.lastAbsorbS).toBe(60);
    expect(f.sentBack).toEqual([
      { unitId: "d", unitName: "d-Realm", amount: 322_000 },
    ]);
    expect(karmaFeedClause(f, label, fmt)).toBe(
      " | fed by (pressed 1 s or more after it went up): Druid 51k · Rogue 40k · DoTs already ticking: 4k · pressed before that: 30k · procs / auto-attacks / pets: 14k · absorbed 139k in all by 1:00 · sent back: 322k onto d",
    );
  });

  it("a press exactly at the cut counts; a re-applied DoT pressed after the cut is fed, not `already ticking`", () => {
    const lateMoonfire: any = {
      ...druid,
      spellCastEvents: [cast(56.4, MOONFIRE, "Moonfire")],
    };
    const f = karmaFeedOf(
      monk([absorbed(57, "d", 8_000, MOONFIRE, "Moonfire")]),
      55.4,
      undefined,
      [lateMoonfire],
      [lateMoonfire],
      START,
    );
    expect(f.fed.map((x) => x.amount)).toEqual([8_000]);
    expect(f.dotsAlreadyTicking).toBe(0);
  });

  it("nobody pressed into it (b711d4ac 2:39): says so, with what it absorbed and `sent back: 0`", () => {
    const f = feed(
      monk([absorbed(55.6, "r", 173_000, MUTILATE_HIT, "Mutilate")]),
    );
    // no Mutilate press at or before the row at all → pressless
    expect(f.fed).toEqual([]);
    expect(f.pressedBefore).toBe(0);
    expect(karmaFeedClause(f, label, fmt)).toBe(
      " | fed by: nobody pressed into it 1 s or more after it went up · procs / auto-attacks / pets: 173k · absorbed 173k in all by 0:55 · sent back: 0",
    );
  });

  it("whole k only: a shield that absorbed under 0.5k has no clause; with damage sent back it prints no `absorbed 0k` (review 37-BD-39)", () => {
    const tiny = feed(
      monk([absorbed(59.356, "d", 300, STARSURGE, "Starsurge")]),
    );
    expect(tiny.absorbedTotal).toBe(300);
    expect(karmaFeedClause(tiny, label, fmt)).toBe("");
    const tinyWithBack = feed(
      monk(
        [absorbed(59.356, "d", 300, STARSURGE, "Starsurge")],
        [back(56.7, "d", 12_000)],
      ),
    );
    const clause = karmaFeedClause(tinyWithBack, label, fmt);
    expect(clause).not.toContain("absorbed 0k");
    expect(clause).toContain("sent back: 12k onto d");
  });

  it("rows outside the buff's 10 s, and after the monk's NEXT Touch of Karma, belong to another press", () => {
    const m = monk(
      [
        absorbed(59.356, "d", 51_440, STARSURGE, "Starsurge"),
        absorbed(66, "d", 10_000, STARSURGE, "Starsurge"),
      ],
      [back(60, "d", 50_000), back(80, "d", 70_000)],
    );
    expect(feed(m).absorbedTotal).toBe(51_440);
    expect(feed(m).sentBack[0]!.amount).toBe(50_000);
    const cutShort = feed(m, 59);
    expect(cutShort.absorbedTotal).toBe(0);
    expect(cutShort.sentBack).toEqual([]);
  });

  it("nothing absorbed and nothing sent back: no clause", () => {
    expect(karmaFeedClause(feed(monk([])), label, fmt)).toBe("");
  });
});
