/**
 * T289 — a Windwalker's Rising Sun Kick 107428 and Fists of Fury 113656:
 * Blackout Kick takes 1 s off both (Sharp Reflexes; 2 s under the Zenith
 * buff) and a Zenith press resets the kick. The Blackout Kick! effect
 * going up is NOT a reset (Combo Breaker: no row). Each row on its own
 * talent.
 */
import {
  type AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReducedCooldownSeconds,
  eventReductionsFor,
  eventTriggersFor,
} from "../src/data/talentScriptedCooldowns";
import {
  cdAvailableAt,
  spendsSharedChargeOf,
  unitCooldownEntry,
} from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const row = (event: string, spellId: string, atS: number) => ({
  spellId,
  srcUnitId: "w",
  destUnitId: "w",
  logLine: { event, timestamp: T0 + Math.round(atS * 1000) },
});
const RSK = "107428";
const FOF = "113656";
const BOK = "100784";
const ZENITH = "1249625";
const BOK_PROC = "116768";
const TIGER_PALM = "100780";
const SHARP = "261917";
const COMBO = "137384";
const ALL = new Set([SHARP, COMBO, ZENITH]);
const rowsFor = (spell: string, held: ReadonlySet<string>, spec = "269") =>
  eventReductionsFor(spell, (t) => held.has(t), spec);
const unit = (casts: object[], auras: object[] = []) =>
  ({
    id: "w",
    spec: "269",
    spellCastEvents: casts,
    damageOut: [],
    missesOut: [],
    auraEvents: auras,
    // the rows the unit sourced: where "entering X" is read
    actionOut: auras,
  }) as unknown as Parameters<typeof eventTriggersFor>[0];
const triggers = (
  u: ReturnType<typeof unit>,
  spell: string,
  held: ReadonlySet<string> = ALL,
) =>
  eventTriggersFor(u, rowsFor(spell, held), (t) => held.has(t)).map((g) => ({
    atSeconds: (g.atMs - T0) / 1000,
    seconds: g.seconds,
  }));

describe("T289 Windwalker kick cooldowns", () => {
  it("每一行按自己的天赋生效;连击破坏者没有行;没有任何天赋就没有行", () => {
    expect(new Set(rowsFor(RSK, ALL))).toEqual(
      new Set([
        EVENT_COOLDOWN_REDUCTIONS[SHARP],
        EVENT_COOLDOWN_REDUCTIONS[ZENITH],
      ]),
    );
    expect(rowsFor(RSK, new Set([SHARP]))).toEqual([
      EVENT_COOLDOWN_REDUCTIONS[SHARP],
    ]);
    // Combo Breaker's reset is on a spell the tree does not carry and the
    // log does not show it: no row (FLAG in the table)
    expect(EVENT_COOLDOWN_REDUCTIONS[COMBO]).toBeUndefined();
    expect(rowsFor(RSK, new Set())).toEqual([]);
    // Fists of Fury takes Blackout Kick's second only — no reset reaches it
    expect(rowsFor(FOF, ALL)).toEqual([EVENT_COOLDOWN_REDUCTIONS[SHARP]]);
  });

  it("每次幻灭踢 −1 s;禅意(Zenith)增益下 −2 s", () => {
    const u = unit(
      [
        row("SPELL_CAST_SUCCESS", RSK, 10),
        row("SPELL_CAST_SUCCESS", BOK, 12),
        row("SPELL_CAST_SUCCESS", BOK, 14),
      ],
      [],
    );
    // 10 + 9 = 19; two Blackout Kicks → 17
    expect(
      eventReducedCooldownSeconds(10, 9, triggers(u, RSK, new Set([SHARP]))),
    ).toBeCloseTo(7, 3);
    const z = unit(
      [
        row("SPELL_CAST_SUCCESS", FOF, 10),
        row("SPELL_CAST_SUCCESS", BOK, 12),
        row("SPELL_CAST_SUCCESS", BOK, 14),
      ],
      [
        row("SPELL_AURA_APPLIED", ZENITH, 11),
        row("SPELL_AURA_REMOVED", ZENITH, 13),
      ],
    );
    // the first inside Zenith (2 s), the second after it (1 s): 24 − 3
    expect(eventReducedCooldownSeconds(10, 24, triggers(z, FOF))).toBeCloseTo(
      21,
      3,
    );
  });

  it("按下禅意重置旭日东升踢;幻灭踢!效果出现不重置;怒雷破不吃重置", () => {
    const pressed = unit([
      row("SPELL_CAST_SUCCESS", RSK, 10),
      row("SPELL_CAST_SUCCESS", ZENITH, 13),
    ]);
    expect(
      eventReducedCooldownSeconds(10, 9, triggers(pressed, RSK)),
    ).toBeCloseTo(3, 3);
    // the Blackout Kick! effect going up, with a Tiger Palm or without,
    // resets nothing (codex 85-tk-L8-T289-1 #1; T289-8)
    const proc = unit(
      [
        row("SPELL_CAST_SUCCESS", RSK, 10),
        row("SPELL_CAST_SUCCESS", TIGER_PALM, 12.4),
      ],
      [row("SPELL_AURA_APPLIED", BOK_PROC, 12.5)],
    );
    expect(eventReducedCooldownSeconds(10, 9, triggers(proc, RSK))).toBe(9);
    // Fists of Fury: neither reset
    const fof = unit(
      [
        row("SPELL_CAST_SUCCESS", FOF, 10),
        row("SPELL_CAST_SUCCESS", ZENITH, 13),
      ],
      [row("SPELL_AURA_APPLIED", BOK_PROC, 12.5)],
    );
    expect(eventReducedCooldownSeconds(10, 24, triggers(fof, FOF))).toBe(24);
  });
});

describe("T289 a Windwalker's Rushing Wind Kick does not spend the kick's charge", () => {
  const RWK = "467307";
  const monk = (spec: CombatUnitSpec, casts: Array<[string, number]>) =>
    makeUnit("w", {
      class: CombatUnitClass.Monk,
      spec,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: casts.map(([id, sec]) =>
        makeSpellCastEvent(id, T0 + sec * 1000, ""),
      ),
    } as unknown as Parameters<typeof makeUnit>[1]);
  const combatOf = (u: ReturnType<typeof makeUnit>) =>
    ({
      startTime: T0,
      endTime: T0 + 300_000,
      units: { w: u },
    }) as unknown as AtomicArenaCombat;
  const cast = (id: string) => ({
    spellId: id,
    logLine: { event: "SPELL_CAST_SUCCESS" },
  });

  it("谓词:踏风不共用,织雾和没给专精的照旧共用", () => {
    expect(spendsSharedChargeOf(cast(RWK), RSK)).toBe(true);
    expect(spendsSharedChargeOf(cast(RWK), RSK, "270")).toBe(true);
    expect(spendsSharedChargeOf(cast(RWK), RSK, "269")).toBe(false);
    expect(spendsSharedChargeOf(cast(RSK), RWK, "269")).toBe(false);
  });
  it("踏风:疾风踢不进旭日东升踢的共用按键,踢的冷却只从它自己的按键起算", () => {
    const u = monk(CombatUnitSpec.Monk_Windwalker, [
      [RSK, 1],
      [RWK, 8],
    ]);
    const e = unitCooldownEntry(u, combatOf(u), RSK)!;
    expect(e.sharedCasts ?? []).toEqual([]);
    // 1 + 9 s: back at 10, whatever the Rushing Wind Kick at 8 s
    expect(cdAvailableAt(e, 10.5)).toBe(true);
  });
  it("织雾:疾风踢照旧花掉这一充能", () => {
    const u = monk(CombatUnitSpec.Monk_Mistweaver, [
      [RSK, 1],
      [RWK, 8],
    ]);
    const e = unitCooldownEntry(u, combatOf(u), RSK)!;
    expect(e.sharedCasts?.map((c) => c.timeSeconds)).toEqual([8]);
    expect(cdAvailableAt(e, 13.5)).toBe(false);
  });
});

describe("T289 a Zenith press logged before a kick of its millisecond", () => {
  const ZENITH_NODE = { id1: 101053, id2: 124826, count: 1 };
  const monk = (casts: Array<[string, number]>) =>
    makeUnit("w", {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Windwalker,
      info: { talents: [ZENITH_NODE], pvpTalents: [] },
      // rows in the given order: makeSpellCastEvent numbers the lines
      spellCastEvents: casts.map(([id, sec]) =>
        makeSpellCastEvent(id, T0 + sec * 1000, ""),
      ),
    } as unknown as Parameters<typeof makeUnit>[1]);
  const entryOf = (u: ReturnType<typeof makeUnit>) =>
    unitCooldownEntry(
      u,
      {
        startTime: T0,
        endTime: T0 + 300_000,
        units: { w: u },
      } as unknown as AtomicArenaCombat,
      RSK,
    )!;

  it("先禅意后踢(同一毫秒):重置的是之前的冷却,这次踢照常走 9 s(codex 85-tk-L8-T289-1b #1)", () => {
    const e = entryOf(
      monk([
        [RSK, 20],
        [ZENITH, 56.163],
        [RSK, 56.163],
      ]),
    );
    expect(cdAvailableAt(e, 57.4)).toBe(false);
    expect(cdAvailableAt(e, 65.7)).toBe(true);
  });
  it("先踢后禅意(同一毫秒):这次踢被重置", () => {
    const e = entryOf(
      monk([
        [RSK, 20],
        [RSK, 56.163],
        [ZENITH, 56.163],
      ]),
    );
    expect(cdAvailableAt(e, 57.4)).toBe(true);
  });
  it("踢、禅意、同毫秒的重复踢行或疾风踢:留下的那次踢在禅意之前,照常被重置(codex -1c #1)", () => {
    for (const third of [RSK, "467307"])
      expect(
        cdAvailableAt(
          entryOf(
            monk([
              [RSK, 20],
              [RSK, 56.163],
              [ZENITH, 56.163],
              [third, 56.163],
            ]),
          ),
          57.4,
        ),
      ).toBe(true);
  });
  it("禅意在踢之后几秒:照常重置", () => {
    const e = entryOf(
      monk([
        [RSK, 20],
        [ZENITH, 23],
      ]),
    );
    expect(cdAvailableAt(e, 24)).toBe(true);
  });
});
