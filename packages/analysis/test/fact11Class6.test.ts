/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact11 (F26) class 6 — one fact, two readers that disagreed.
 * D6: a silence the log wrote no aura for (`unloggedSilencesOnOwner`, the
 * `[SILENCE] … no aura logged` reading) is stop evidence of a cast bar.
 * D5: the kit's landed controls carry the silences the `[SILENCE]` lines
 * print. D9: a Spell Reflection return with no REFLECT row is read as one.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import {
  reflectedSpellDealsDamage,
  reflectedSpells,
  unrowedSpellReflections,
} from "../src/context/spellOutcomeLines";
import { ownerCastBarOutcomes } from "../src/utils/castCancels";
import { landedControlsForKit } from "../src/utils/healerExposureAnalysis";
import type { RawStreams } from "../src/utils/rawStreams";
import { unloggedSilencesOnOwner } from "../src/utils/unloggedSilence";
import {
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("fact11 D6 — an aura-less silence stops the cast bar", () => {
  // 0d7c70b7 r0: Solar Beam 1:29.811 on the owner's teammate, the owner's
  // Fear "Interrupted" 13 ms later, "silenced" refusal at 1:35.6
  const FEAR = "5782";
  const druid = makeUnit("e1", {
    name: "Druid",
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: [
      makeSpellCastEvent("78675", at(89.811), "t1", "Mate", "e1", "Druid"),
    ] as never,
  });
  const owner = makeUnit("p1", {
    name: "Me",
    reaction: CombatUnitReaction.Friendly,
    info: {},
    castStartEvents: [
      {
        ...makeSpellCastEvent(FEAR, at(89.1), "e2", "X", "p1", "Me"),
        logLine: {
          event: LogEvent.SPELL_CAST_START,
          timestamp: at(89.1),
          parameters: [],
        },
      },
    ] as never,
  });
  const fail = (spellId: string, s: number, reason: string) => ({
    tSeconds: s,
    unitGuid: "p1",
    spellId: Number(spellId),
    spellName: spellId,
    reason,
  });
  const raw = (refusal: boolean): RawStreams => ({
    available: true,
    manaSamples: [],
    castFailed: [
      fail(FEAR, 89.824, "Interrupted"),
      ...(refusal ? [fail("2061", 95.6, "Can't do that while silenced")] : []),
    ],
  });
  const read = (refusal: boolean, withUnits = true) =>
    ownerCastBarOutcomes({
      owner,
      startMs: T0,
      rawStreams: raw(refusal),
      enemies: [druid],
      ...(withUnits ? { allUnits: [owner, druid], roundEndAtMs: at(200) } : {}),
    })!.map((o) => o.end);

  it("the [SILENCE] reading finds the Beam on the owner", () => {
    const s = unloggedSilencesOnOwner({
      owner,
      allUnits: [owner, druid],
      enemies: [druid],
      matchStartMs: T0,
      roundEndAtMs: at(200),
      rawStreams: raw(true),
    });
    expect(s.map((x) => [x.castMs - T0, x.spellId, x.refusalMs - T0])).toEqual([
      [89_811, "78675", 95_600],
    ]);
  });
  it("…and the stop 13 ms after it is the silence's, not the player's", () => {
    expect(read(true)).toEqual([{ kind: "stopped", atS: 89.824, near: "cc" }]);
  });
  it("no refusal proves the owner was in it: no silence, a cancel", () => {
    expect(read(false)).toEqual([{ kind: "stopped", atS: 89.824, near: null }]);
  });
  it("a caller that hands no units keeps the old reading", () => {
    expect(read(true, false)).toEqual([
      { kind: "stopped", atS: 89.824, near: null },
    ]);
  });
});

describe("fact11 D5 — the kit counts the silences that landed", () => {
  const dk = makeUnit("e-dk", {
    name: "Nightorgan-Tichondrius-US",
    reaction: CombatUnitReaction.Hostile,
  });
  // 0af2e488: Blinding Sleet [CC ON TEAM], three Strangulate [SILENCE]
  const summary = {
    ccInstances: [
      {
        atSeconds: 40,
        durationSeconds: 4,
        spellId: "207167",
        spellName: "Blinding Sleet",
        sourceName: dk.name,
        sourceId: dk.id,
      },
    ],
  } as never;
  const strangulate = (s: number) => ({
    atMs: at(s),
    spellId: "47476",
    spellName: "Strangulate",
    sourceId: dk.id,
  });
  it("Strangulate landed 3×, in order of first landing", () => {
    const out = landedControlsForKit(summary, [dk], [dk], {
      startMs: T0,
      landed: [strangulate(15.65), strangulate(77.891), strangulate(131.582)],
    });
    expect(out.map((l) => [l.spellName, l.count])).toEqual([
      ["Strangulate", 3],
      ["Blinding Sleet", 1],
    ]);
  });
  it("no silences handed: the [CC ON TEAM] instances alone, as before", () => {
    expect(
      landedControlsForKit(summary, [dk], [dk]).map((l) => l.spellName),
    ).toEqual(["Blinding Sleet"]);
  });
});

describe("fact11 D9 — a Spell Reflection return with no REFLECT row", () => {
  // 10244184 4:40: Scorch at the warrior 280.225, 106,805 back under 23920
  // 1 ms later, no REFLECT row
  const SCORCH = "2948";
  const ret = (s: number, amount: number) => ({
    ...makeDamageEvent(at(s), amount, "mage"),
    srcUnitId: "war",
    srcUnitName: "Warrior",
    spellId: "23920",
    spellName: "Spell Reflection",
  });
  const mage = (over: Record<string, unknown> = {}) =>
    makeUnit("mage", {
      name: "Mage",
      reaction: CombatUnitReaction.Hostile,
      info: {},
      spellCastEvents: [
        makeSpellCastEvent(
          SCORCH,
          at(280.225),
          "war",
          "Warrior",
          "mage",
          "Mage",
        ),
      ] as never,
      damageIn: [ret(280.226, 106_805)] as never,
      advancedActions: [
        {
          timestamp: at(279),
          logLine: { timestamp: at(279) },
          advancedActorId: "mage",
          advancedActorCurrentHp: 325_605,
          advancedActorMaxHp: 1_102_750,
        },
      ] as never,
      ...over,
    });
  const warrior = makeUnit("war", {
    name: "Warrior",
    reaction: CombatUnitReaction.Friendly,
    info: {},
  });

  it("the Scorch is read back as reflected at the return's ms", () => {
    const rows = unrowedSpellReflections(mage(), [warrior]);
    expect(
      rows.map((r) => [r.spellId, r.destUnitId, r.logLine.timestamp - T0]),
    ).toEqual([[SCORCH, "war", 280_226]]);
    const lines = reflectedSpells([mage(), warrior], T0);
    expect(lines.map((l) => [l.spellId, l.damageBack])).toEqual([
      [SCORCH, 106_805],
    ]);
  });
  it("a REFLECT row of the caster on that reflector near it: nothing added", () => {
    // makeUnit writes no misses; set them on the unit
    const m = mage();
    (m as any).missesOut = [
      {
        logLine: { event: LogEvent.SPELL_MISSED, timestamp: at(280.4) },
        timestamp: at(280.4),
        missType: "REFLECT",
        spellId: "108853",
        spellName: "Fire Blast",
        srcUnitId: "mage",
        destUnitId: "war",
      },
    ];
    expect(unrowedSpellReflections(m, [warrior])).toEqual([]);
  });
  it("a reflected control's REFLECT row near it accounts for no damage return (codex 20-F26-03 #3)", () => {
    const m = mage();
    (m as any).missesOut = [
      {
        logLine: { event: LogEvent.SPELL_MISSED, timestamp: at(280.4) },
        timestamp: at(280.4),
        missType: "REFLECT",
        spellId: "118",
        spellName: "Polymorph",
        srcUnitId: "mage",
        destUnitId: "war",
      },
    ];
    expect(
      unrowedSpellReflections(m, [warrior]).map((r) => r.spellId),
    ).toEqual([SCORCH]);
  });
  it("a cast id whose hits carry another id deals damage by the caster's own hits (codex 20-F26-03 #4)", () => {
    // Death Coil: cast 47541, damage 47632
    const dk = { id: "dk" };
    expect(reflectedSpellDealsDamage("47541", dk, [])).toBe(false);
    const hit = {
      damageIn: [{ srcUnitId: "dk", spellId: "47632" }],
    } as never;
    expect(reflectedSpellDealsDamage("47541", dk, [hit])).toBe(true);
  });
  it("only a control cast at the reflector before it: the return names nothing", () => {
    const m = mage({
      spellCastEvents: [
        makeSpellCastEvent("118", at(280.1), "war", "Warrior", "mage", "Mage"),
      ] as never,
    });
    expect(unrowedSpellReflections(m, [warrior])).toEqual([]);
  });
  it("a cast at someone else, or more than 3 s before: nothing", () => {
    expect(
      unrowedSpellReflections(
        mage({
          spellCastEvents: [
            makeSpellCastEvent(SCORCH, at(280.2), "x", "X", "mage", "Mage"),
            makeSpellCastEvent(SCORCH, at(277.1), "war", "W", "mage", "Mage"),
          ] as never,
        }),
        [warrior],
      ),
    ).toEqual([]);
  });
});
