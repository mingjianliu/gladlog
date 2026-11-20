/**
 * Pipeline T223, review 85-tk-WIN-T223-1: four more readers summed health a
 * unit's own side moved onto it as damage it took — the defensive timing
 * labels, the panic detector, the missed-purge pressure test and the
 * `[ROT PRESSURE]` share. Each has its enemy-row control here (the purge
 * test is exercised by the corpus scans, not by a unit test).
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { rotPressureDamageInWindow } from "../src/context/matchTimelineSections";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  annotateDefensiveTimings,
  detectPanicDefensives,
  extractMajorCooldowns,
} from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const VOID_LEECH = "451963";
const PAIN_SUPPRESSION = "33206";
const row = (s: number, amount: number, more: object) =>
  ({
    logLine: { event: "SPELL_DAMAGE", timestamp: at(s), parameters: [] },
    timestamp: at(s),
    amount: -amount,
    effectiveAmount: -amount,
    spellId: VOID_LEECH,
    spellName: "Void Leech",
    ...more,
  }) as never;
const fromMate = (s: number, amount: number, more: object = {}) =>
  row(s, amount, { srcUnitId: "mate", srcUnitFlags: 0x511, ...more });
const fromEnemy = (s: number, amount: number, more: object = {}) =>
  row(s, amount, { srcUnitId: "enemy-1", srcUnitFlags: 0x548, ...more });

describe("T223 — [ROT PRESSURE] 的周期伤害占比不把己方转移的血量算进总量", () => {
  const player = (extra: never[]) =>
    makeUnit("victim", {
      reaction: CombatUnitReaction.Friendly,
      damageIn: [
        fromEnemy(10, 60_000, {
          logLine: {
            event: "SPELL_PERIODIC_DAMAGE",
            timestamp: at(10),
            parameters: [],
          },
          spellId: "980",
        }),
        fromEnemy(11, 40_000, { spellId: "686" }),
        ...extra,
      ],
    });
  it("60k 周期 + 40k 直接 + 100k 队友转移 → 占比 60%,不是 30%", () => {
    const r = rotPressureDamageInWindow(
      player([fromMate(11, 100_000)]),
      at(8),
      at(12),
    );
    expect(r).toEqual({ periodicDmg: 60_000, totalDmg: 100_000 });
  });
  it("对照:敌方来的同一个 id 是伤害,计入总量", () => {
    const r = rotPressureDamageInWindow(
      player([fromEnemy(11, 100_000)]),
      at(8),
      at(12),
    );
    expect(r.totalDmg).toBe(200_000);
  });
});

describe("T223 — 无威胁按键检测与时机标签不把转移行当压力", () => {
  const BIG = 10_000_000;
  const priest = (damageIn: never[]) =>
    makeUnit("priest", {
      name: "Priest-R",
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Friendly,
      damageIn,
      spellCastEvents: [
        makeSpellCastEvent(
          PAIN_SUPPRESSION,
          at(20),
          "priest",
          "Priest-R",
          "priest",
          "Priest-R",
        ),
      ],
    } as never);
  const enemy = makeUnit("enemy-1", {
    reaction: CombatUnitReaction.Hostile,
  });
  const panics = (damageIn: never[]) =>
    detectPanicDefensives([priest(damageIn)], [enemy], {
      startTime: T0,
    });

  it("按键前只有队友转移行:仍是无威胁按键;对照:敌方同量则不是", () => {
    expect(panics([fromMate(19, BIG)])).toHaveLength(1);
    expect(panics([fromEnemy(19, BIG)])).toEqual([]);
    // the post-cast window too
    expect(panics([fromMate(21, BIG)])).toHaveLength(1);
    expect(panics([fromEnemy(21, BIG)])).toEqual([]);
  });

  const labelOf = (damageIn: never[]) => {
    const p = priest(damageIn);
    const combat = {
      startTime: T0,
      endTime: at(120),
      units: { priest: p, "enemy-1": enemy },
    } as never;
    return annotateDefensiveTimings(
      extractMajorCooldowns(p as never, combat),
      p as never,
      combat,
      { players: [], alignedBurstWindows: [] } as never,
    ).find((c) => c.spellId === PAIN_SUPPRESSION)!.casts[0]!.timingLabel;
  };
  it("按键前的「尖峰」全是队友转移行:不是 Reactive;对照:敌方同量是 Reactive", () => {
    const spike = (f: typeof fromMate) => [f(19, BIG), f(21, 10_000)];
    expect(labelOf(spike(fromEnemy))).toBe("Reactive");
    expect(labelOf(spike(fromMate))).not.toBe("Reactive");
  });
});
