/**
 * T240 — the Mistweaver kick (Rising Sun Kick 107428 / Rushing Wind Kick
 * 467307, 12 s) and the three logged mechanisms on its cooldown: a Thunder
 * Focus Tea press resets it (Morning Breeze), the kick the tea empowers has
 * 9 s less (Thunder Focus Tea's own row), a Renewing Mist takes 1 s off
 * (Pool of Mists).
 */
import {
  type AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { spellSchoolMask } from "../src/data/spellSchools";
import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReducedCooldownSeconds,
  eventReductionsFor,
  eventTriggersFor,
} from "../src/data/talentScriptedCooldowns";
import { healerLockIntervals } from "../src/utils/cannotCastIntervals";
import {
  pressReadyAgainAtSeconds,
  unitCooldownEntry,
} from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const row = (event: string, spellId: string, atS: number) => ({
  spellId,
  srcUnitId: "m",
  destUnitId: "m",
  logLine: { event, timestamp: T0 + Math.round(atS * 1000) },
});
const KICK = "467307";
const TEA = "116680";
const HOLDER = new Set(["173841", "1277302"]);
const rows = (spec = "270", held: ReadonlySet<string> = HOLDER) =>
  eventReductionsFor(KICK, (t) => held.has(t), spec);

// cc0a95d4 r411 (a holder of Focused Thunder: the tea holds two stacks):
// kick 42.26 s, tea 48.31 s, kick 48.52 s (a dose spent), kick 51.94 s
const monk = {
  id: "m",
  spec: "270",
  spellCastEvents: [
    row("SPELL_CAST_SUCCESS", KICK, 42.262),
    row("SPELL_CAST_SUCCESS", "115151", 45.0),
    row("SPELL_CAST_SUCCESS", TEA, 48.308),
    row("SPELL_CAST_SUCCESS", KICK, 48.519),
    row("SPELL_CAST_SUCCESS", KICK, 51.938),
    row("SPELL_CAST_SUCCESS", "124682", 53.0),
  ],
  damageOut: [],
  auraEvents: [
    row("SPELL_AURA_APPLIED", TEA, 48.308),
    row("SPELL_AURA_REMOVED_DOSE", TEA, 48.536),
    // the second stack goes to an Enveloping Mist: no kick beside it
    row("SPELL_AURA_REMOVED", TEA, 53.012),
  ],
} as unknown as Parameters<typeof eventTriggersFor>[0];

const triggers = () =>
  eventTriggersFor(monk, rows()).map((g) => ({
    atSeconds: (g.atMs - T0) / 1000,
    seconds: g.seconds,
  }));

describe("T240 Mistweaver kick cooldown", () => {
  it("a Mistweaver holding both talents gets the three rows, on either kick id", () => {
    expect(new Set(rows())).toEqual(
      new Set([
        EVENT_COOLDOWN_REDUCTIONS["116680:kick"],
        EVENT_COOLDOWN_REDUCTIONS["173841"],
        EVENT_COOLDOWN_REDUCTIONS["1277302"],
      ]),
    );
    expect(
      eventReductionsFor("107428", (t) => HOLDER.has(t), "270"),
    ).toHaveLength(3);
  });
  it("a Windwalker gets none of them; a Mistweaver without the talents only the tea's own row", () => {
    expect(rows("269", new Set())).toEqual([]);
    expect(rows("270", new Set()).map((r) => r.note)).toEqual([
      EVENT_COOLDOWN_REDUCTIONS["116680:kick"]!.note,
    ]);
  });
  it("the tea press resets the kick; Renewing Mist takes 1 s", () => {
    // 42.262 + 12 = 54.262; Renewing Mist 45.0 → 53.262; tea 48.308 → back then
    expect(eventReducedCooldownSeconds(42.262, 12, triggers())).toBeCloseTo(
      48.308 - 42.262,
      3,
    );
  });
  it("the kick that spends a tea stack is back 3 s later; the stack an Enveloping Mist spends gives nothing", () => {
    expect(triggers().filter((g) => g.seconds === 9)).toEqual([
      { atSeconds: 48.536, seconds: 9 },
    ]);
    expect(eventReducedCooldownSeconds(48.519, 12, triggers())).toBeCloseTo(
      3,
      3,
    );
    // the kick after it spent nothing: the full 12 s
    expect(eventReducedCooldownSeconds(51.938, 12, triggers())).toBe(12);
  });
});

describe("T240 the healer lock reads the shared model for a spent heal", () => {
  const NATURE = 8;
  const mw = (kickS: number, teaS?: number) =>
    makeUnit("m", {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Mistweaver,
      info: {
        talents: [{ id1: 101125, id2: 124909, count: 1 }],
        pvpTalents: [],
      },
      spellCastEvents: [
        makeSpellCastEvent(KICK, T0 + kickS * 1000, ""),
        ...(teaS === undefined
          ? []
          : [makeSpellCastEvent(TEA, T0 + teaS * 1000, "")]),
      ],
      healOut: [{ spellId: KICK, destUnitId: "mate" }],
      absorbsOut: [],
    } as unknown as Parameters<typeof makeUnit>[1]);
  const combatOf = (u: ReturnType<typeof makeUnit>) =>
    ({
      startTime: T0,
      endTime: T0 + 300_000,
      units: { m: u },
    }) as unknown as AtomicArenaCombat;
  // a Holy lock leaves the Nature kick: the lock stays only if the kick was
  // spent across it
  const lock = {
    from: T0 + 9_000,
    to: T0 + 12_000,
    spellId: "1766",
    lockout: true,
    lockedSchoolMask: 2,
  };
  it("kick 1 s, no tea: spent across a 9–12 s lock (12 s cooldown)", () => {
    const u = mw(1);
    expect(spellSchoolMask(KICK)! & NATURE).toBe(NATURE);
    expect(healerLockIntervals(u, [lock], combatOf(u))).toHaveLength(1);
    expect(healerLockIntervals(u, [lock])).toHaveLength(1);
  });
  it("an older press the model folds does not outlast the last press before the lock (codex 85-tk-L3-T240-1 #2)", () => {
    // kicks 1.0 s and 2.0 s: the model folds the second into the first
    // (duplicate rows of one press), so it has no press at 2.0 s and the
    // static 12 s answers for it — the LAST press, back at 14 s
    const u = makeUnit("m", {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Mistweaver,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [1, 2].map((sec) =>
        makeSpellCastEvent(KICK, T0 + sec * 1000, ""),
      ),
      healOut: [{ spellId: KICK, destUnitId: "mate" }],
      absorbsOut: [],
    } as unknown as Parameters<typeof makeUnit>[1]);
    const at = (fromS: number, toS: number) => ({
      ...lock,
      from: T0 + fromS * 1000,
      to: T0 + toS * 1000,
    });
    expect(healerLockIntervals(u, [at(9, 13.5)], combatOf(u))).toHaveLength(1);
    expect(healerLockIntervals(u, [at(9, 14.5)], combatOf(u))).toHaveLength(0);
  });
  it("kick 1 s, tea 5 s: the kick was back before the lock — a heal was left, the lock is dropped", () => {
    const u = mw(1, 5);
    expect(healerLockIntervals(u, [lock], combatOf(u))).toHaveLength(0);
    // without the round the static 12 s still answers
    expect(healerLockIntervals(u, [lock])).toHaveLength(1);
  });
});

describe("T240 two kicks inside 2 s, each spending a tea stack, are two presses (codex 85-tk-L3-T240-1 #1)", () => {
  // e0d4b250: kicks 101.481 s and 103.278 s, a stack removed beside each
  const aura = (event: LogEvent, atS: number) => ({
    spellId: TEA,
    srcUnitId: "m",
    destUnitId: "m",
    timestamp: T0 + Math.round(atS * 1000),
    logLine: { event, timestamp: T0 + Math.round(atS * 1000) },
  });
  const unit = (withStacks: boolean) =>
    makeUnit("m", {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Mistweaver,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [101.481, 103.278].map((sec) =>
        makeSpellCastEvent(KICK, T0 + Math.round(sec * 1000), ""),
      ),
      auraEvents: withStacks
        ? [
            aura(LogEvent.SPELL_AURA_REMOVED_DOSE, 101.49),
            aura(LogEvent.SPELL_AURA_REMOVED, 103.29),
          ]
        : [],
    } as unknown as Parameters<typeof makeUnit>[1]);
  const entryOf = (u: ReturnType<typeof makeUnit>) =>
    unitCooldownEntry(
      u,
      {
        startTime: T0,
        endTime: T0 + 300_000,
        units: { m: u },
      } as unknown as AtomicArenaCombat,
      KICK,
    )!;
  it("with the two removals: two presses, the second back 3 s after it", () => {
    const e = entryOf(unit(true));
    expect(e.casts.map((c) => c.timeSeconds)).toEqual([101.481, 103.278]);
    expect(pressReadyAgainAtSeconds(e, 103.278)).toBeCloseTo(106.278, 2);
  });
  it("without them the second row stays folded into the first press", () => {
    expect(entryOf(unit(false)).casts.map((c) => c.timeSeconds)).toEqual([
      101.481,
    ]);
  });
});
