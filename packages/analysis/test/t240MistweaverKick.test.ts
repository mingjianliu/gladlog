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
  CONSUMED_BUFF_PRESS_COOLDOWNS,
  consumedBuffPressCooldownFor,
  consumedBuffPressMs,
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
  it("a Mistweaver holding both talents gets the two rows, on either kick id", () => {
    expect(new Set(rows())).toEqual(
      new Set([
        EVENT_COOLDOWN_REDUCTIONS["173841"],
        EVENT_COOLDOWN_REDUCTIONS["1277302"],
      ]),
    );
    expect(
      eventReductionsFor("107428", (t) => HOLDER.has(t), "270"),
    ).toHaveLength(2);
  });
  it("a Windwalker gets none of them, and no tea row", () => {
    expect(rows("269", new Set())).toEqual([]);
    expect(consumedBuffPressCooldownFor(KICK, "269")).toBeUndefined();
    expect(consumedBuffPressCooldownFor(KICK, "270")?.seconds).toBe(9);
    expect(consumedBuffPressCooldownFor("107428", "270")).toBe(
      CONSUMED_BUFF_PRESS_COOLDOWNS[KICK],
    );
  });
  it("the tea press resets the kick; Renewing Mist takes 1 s", () => {
    // 42.262 + 12 = 54.262; Renewing Mist 45.0 → 53.262; tea 48.308 → back then
    expect(eventReducedCooldownSeconds(42.262, 12, triggers())).toBeCloseTo(
      48.308 - 42.262,
      3,
    );
  });
  it("the stack belongs to the kick whose row is the last before its removal; an Enveloping Mist's stack is not a kick's", () => {
    const row250 = CONSUMED_BUFF_PRESS_COOLDOWNS[KICK]!;
    expect(consumedBuffPressMs(monk, KICK, row250)).toEqual([T0 + 48_519]);
  });
  it("Life Cocoon's dose 230 ms before a kick is not the kick's; the kick's own removal 1 ms after it is (6e8d3ba4)", () => {
    const u = {
      id: "m",
      spellCastEvents: [
        row("SPELL_CAST_SUCCESS", "116849", 26.3),
        row("SPELL_CAST_SUCCESS", KICK, 26.53),
      ],
      auraEvents: [
        row("SPELL_AURA_REMOVED_DOSE", TEA, 26.3),
        row("SPELL_AURA_REMOVED", TEA, 26.531),
      ],
    } as unknown as Parameters<typeof consumedBuffPressMs>[0];
    expect(
      consumedBuffPressMs(u, KICK, CONSUMED_BUFF_PRESS_COOLDOWNS[KICK]!),
    ).toEqual([T0 + 26_530]);
    // only the Life Cocoon dose: nothing for the kick
    const v = {
      ...u,
      auraEvents: [row("SPELL_AURA_REMOVED_DOSE", TEA, 26.3)],
    } as unknown as Parameters<typeof consumedBuffPressMs>[0];
    expect(
      consumedBuffPressMs(v, KICK, CONSUMED_BUFF_PRESS_COOLDOWNS[KICK]!),
    ).toEqual([]);
  });
  it("a removal 156 ms after the kick's row is its own (85a6cad9); one 300 ms after is not", () => {
    const u = (afterS: number) =>
      ({
        id: "m",
        spellCastEvents: [row("SPELL_CAST_SUCCESS", KICK, 30.855)],
        auraEvents: [row("SPELL_AURA_REMOVED", TEA, 30.855 + afterS)],
      }) as unknown as Parameters<typeof consumedBuffPressMs>[0];
    const r = CONSUMED_BUFF_PRESS_COOLDOWNS[KICK]!;
    expect(consumedBuffPressMs(u(0.156), KICK, r)).toEqual([T0 + 30_855]);
    expect(consumedBuffPressMs(u(0.3), KICK, r)).toEqual([]);
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
  it("a later kick does not lend its ready instant to the one before it (codex 85-tk-L3-T240-1c #2, 2452abe0)", () => {
    // kick 38.038 s, tea 38.601 s (reset), kick 38.880 s
    const u = makeUnit("m", {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Mistweaver,
      info: {
        talents: [{ id1: 101125, id2: 124909, count: 1 }],
        pvpTalents: [],
      },
      spellCastEvents: [
        makeSpellCastEvent(KICK, T0 + 38_038, ""),
        makeSpellCastEvent(TEA, T0 + 38_601, ""),
        makeSpellCastEvent(KICK, T0 + 38_880, ""),
      ],
      healOut: [{ spellId: KICK, destUnitId: "mate" }],
      absorbsOut: [],
    } as unknown as Parameters<typeof makeUnit>[1]);
    const between = { ...lock, from: T0 + 38_630, to: T0 + 38_820 };
    expect(healerLockIntervals(u, [between], combatOf(u))).toHaveLength(0);
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
  it("each kick keeps its own 9 s: the first is back 3 s after it, not at the second's removal (1b #1)", () => {
    const e = entryOf(unit(true));
    expect(pressReadyAgainAtSeconds(e, 101.481)).toBeCloseTo(104.481, 2);
  });
  it("without them the second row stays folded into the first press", () => {
    expect(entryOf(unit(false)).casts.map((c) => c.timeSeconds)).toEqual([
      101.481,
    ]);
  });
});

describe("T240 review round 2 on real orderings", () => {
  const aura = (event: LogEvent, atMs: number) => ({
    spellId: TEA,
    srcUnitId: "m",
    destUnitId: "m",
    timestamp: T0 + atMs,
    logLine: { event, timestamp: T0 + atMs },
  });
  const mwOf = (
    casts: ReadonlyArray<[string, number]>,
    auraEvents: unknown[],
  ) =>
    makeUnit("m", {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Mistweaver,
      info: {
        talents: [{ id1: 101125, id2: 124909, count: 1 }],
        pvpTalents: [],
      },
      // makeSpellCastEvent numbers the rows in creation order: the log order
      spellCastEvents: casts.map(([id, ms]) =>
        makeSpellCastEvent(id, T0 + ms, ""),
      ),
      auraEvents,
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
  it("the kick after one that spent the last stack is a press of its own (1b #2, e0d4b250)", () => {
    const e = entryOf(
      mwOf(
        [
          [KICK, 129_052],
          [KICK, 130_924],
        ],
        [aura(LogEvent.SPELL_AURA_REMOVED, 129_053)],
      ),
    );
    expect(e.casts.map((c) => c.timeSeconds)).toEqual([129.052, 130.924]);
    // the second spent nothing: its full 12 s
    expect(pressReadyAgainAtSeconds(e, 130.924)).toBeCloseTo(142.924, 2);
  });
  it("tea then kick in one millisecond: the reset was the old cooldown's, the kick is back 3 s later (1b #4, d0c5a35d)", () => {
    const e = entryOf(
      mwOf(
        [
          [KICK, 50_000],
          [TEA, 54_923],
          [KICK, 54_923],
        ],
        [aura(LogEvent.SPELL_AURA_REMOVED_DOSE, 54_924)],
      ),
    );
    expect(pressReadyAgainAtSeconds(e, 50)).toBeCloseTo(54.923, 3);
    expect(pressReadyAgainAtSeconds(e, 54.923)).toBeCloseTo(57.923, 3);
  });
  it("kick then tea in one millisecond: the tea resets that kick", () => {
    const e = entryOf(
      mwOf(
        [
          [KICK, 54_923],
          [TEA, 54_923],
        ],
        [],
      ),
    );
    expect(pressReadyAgainAtSeconds(e, 54.923)).toBeCloseTo(54.923, 3);
  });
});

describe("T240 review round 4 on real logs", () => {
  const aura = (spellId: string, event: LogEvent, atS: number) => ({
    spellId,
    srcUnitId: "m",
    destUnitId: "m",
    timestamp: T0 + Math.round(atS * 1000),
    logLine: { event, timestamp: T0 + Math.round(atS * 1000) },
  });
  const entryOf = (kicks: number[], auraEvents: unknown[]) => {
    const u = makeUnit("m", {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Mistweaver,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: kicks.map((sec) =>
        makeSpellCastEvent(KICK, T0 + Math.round(sec * 1000), ""),
      ),
      auraEvents,
    } as unknown as Parameters<typeof makeUnit>[1]);
    return unitCooldownEntry(
      u,
      {
        startTime: T0,
        endTime: T0 + 300_000,
        units: { m: u },
      } as unknown as AtomicArenaCombat,
      KICK,
    )!;
  };
  it("the kick that spends the set bonus's extra charge is a press, standing on the earlier kick's cooldown (1d #1, fa2c363c)", () => {
    // kick 83.308 s, the proc's aura 83.417 s, kick 84.244 s, the aura gone 84.255 s
    const e = entryOf(
      [83.308, 84.244],
      [
        aura("1296687", LogEvent.SPELL_AURA_APPLIED, 83.417),
        aura("1296687", LogEvent.SPELL_AURA_REMOVED, 84.255),
      ],
    );
    expect(e.casts.map((c) => [c.timeSeconds, c.freeRecast ?? false])).toEqual([
      [83.308, false],
      [84.244, true],
    ]);
    expect(pressReadyAgainAtSeconds(e, 84.244)).toBeCloseTo(95.308, 2);
    // without the proc the second row is the first press's duplicate, as before
    expect(entryOf([83.308, 84.244], []).casts).toHaveLength(1);
  });
  it("a tea whose cast row the log left out still resets the kick (1d #2, e7444643)", () => {
    const u = {
      id: "m",
      spec: "270",
      spellCastEvents: [row("SPELL_CAST_SUCCESS", KICK, 32.603)],
      damageOut: [],
      actionOut: [row("SPELL_AURA_APPLIED", TEA, 33.459)],
    } as unknown as Parameters<typeof eventTriggersFor>[0];
    expect(
      eventTriggersFor(u, [EVENT_COOLDOWN_REDUCTIONS["1277302"]!]).map(
        (g) => (g.atMs - T0) / 1000,
      ),
    ).toEqual([33.459]);
    // with its cast row the application adds no second trigger
    const v = {
      ...u,
      spellCastEvents: [
        row("SPELL_CAST_SUCCESS", KICK, 32.603),
        row("SPELL_CAST_SUCCESS", TEA, 33.45),
      ],
    } as unknown as Parameters<typeof eventTriggersFor>[0];
    expect(
      eventTriggersFor(v, [EVENT_COOLDOWN_REDUCTIONS["1277302"]!]).map(
        (g) => (g.atMs - T0) / 1000,
      ),
    ).toEqual([33.45]);
  });
});
