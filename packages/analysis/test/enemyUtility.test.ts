/**
 * fact1215 C7 (user ruling 2026-10-18: a new tag, a fact line only): an
 * enemy's press of a roster Utility row that no other enemy family prints
 * gets an `[ENEMY UTILITY]` line — 1120cb61 0:36 Champion's Spear, 3867e9ef
 * 0:23 Smoke Bomb. Vanish (`[ENEMY DEF]`, immune) and Lichborne (a self-save)
 * keep their own lines and get none.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitEnemyCdEntries } from "../src/context/timelineSections/enemyCd";
import { ensureAnalysisData } from "../src/data/ensure";
import { enemyDefSpeaksForPress } from "../src/utils/enemyDefensives";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const cast = (spellId: string, s: number) => ({
  spellId,
  spellName: spellId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + s * 1000 },
});
const run = (enemies: unknown[]) => {
  const lines: string[] = [];
  const out = emitEnemyCdEntries({
    enemyCDTimeline: { players: [], alignedBurstWindows: [] } as never,
    cdPurgeAnnotations: new Map(),
    addEntry: (_t: number, ...l: unknown[]) => {
      lines.push(...(l as string[]));
      return true;
    },
    enemyPid: (n: string) => `5(${n})`,
    matchStartMs: T0,
    matchEndSeconds: 3600,
    enemies: enemies as never,
  });
  return { lines, out };
};

describe("[ENEMY UTILITY]", () => {
  // Champion's Spear held the first two lines until the user ruling A8 of
  // 2026-11-17 made it an offensive cooldown (pipeline T154): its press is an
  // [ENEMY CD] line now, pinned below
  it("Smoke Bomb ×2, Tremor Totem: a line each", () => {
    const { lines, out } = run([
      {
        name: "Hemo",
        class: CombatUnitClass.Rogue,
        spec: CombatUnitSpec.Rogue_Subtlety,
        spellCastEvents: [cast("212182", 23.3), cast("212182", 204.4)],
      },
      {
        name: "Sham",
        class: CombatUnitClass.Shaman,
        spec: CombatUnitSpec.Shaman_Restoration,
        spellCastEvents: [cast("8143", 50)],
      },
    ]);
    expect(lines).toEqual([
      "0:23  [ENEMY UTILITY]   5(Hemo) (Subtlety Rogue): Smoke Bomb (cast 1 of 2)",
      "3:24  [ENEMY UTILITY]   5(Hemo) (Subtlety Rogue): Smoke Bomb (cast 2 of 2)",
      "0:50  [ENEMY UTILITY]   5(Sham) (Restoration Shaman): Tremor Totem",
    ]);
    expect(out.utilityRendered).toBe(true);
  });
  it("Champion's Spear is an offensive cooldown (user ruling A8): no utility line", () => {
    const { lines, out } = run([
      {
        name: "Eldroath",
        class: CombatUnitClass.Warrior,
        spec: CombatUnitSpec.Warrior_Arms,
        spellCastEvents: [cast("376079", 36.07), cast("376079", 129.4)],
      },
    ]);
    expect(lines.filter((l) => l.includes("[ENEMY UTILITY]"))).toEqual([]);
    expect(out.utilityRendered).toBe(false);
  });
  const auraAt = (spellId: string, s: number) => ({
    spellId,
    timestamp: T0 + s * 1000,
    logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + s * 1000 },
  });
  it("Vanish and Lichborne whose aura went up keep their [ENEMY DEF] line and get no utility line", () => {
    expect(enemyDefSpeaksForPress("1856")).toBe(true);
    expect(enemyDefSpeaksForPress("49039")).toBe(true);
    expect(enemyDefSpeaksForPress("376079")).toBe(false);
    const { lines, out } = run([
      {
        name: "Rog",
        class: CombatUnitClass.Rogue,
        spec: CombatUnitSpec.Rogue_Subtlety,
        spellCastEvents: [cast("1856", 10)],
        auraEvents: [auraAt("11327", 10.004)],
      },
      {
        name: "Dk",
        class: CombatUnitClass.DeathKnight,
        spec: CombatUnitSpec.DeathKnight_Unholy,
        spellCastEvents: [cast("49039", 12)],
        auraEvents: [auraAt("49039", 12)],
      },
    ]);
    expect(lines).toEqual([]);
    expect(out.utilityRendered).toBe(false);
  });
  it("a Vanish the log wrote no aura for has no [ENEMY DEF] line, so it gets this one (codex 20-F15-30)", () => {
    const { lines } = run([
      {
        name: "Rog",
        class: CombatUnitClass.Rogue,
        spec: CombatUnitSpec.Rogue_Subtlety,
        spellCastEvents: [cast("1856", 10)],
        auraEvents: [],
      },
    ]);
    expect(lines).toEqual(["0:10  [ENEMY UTILITY]   5(Rog) (Subtlety Rogue): Vanish"]);
  });
  it("a press before the gates or after the timeline's end neither prints nor counts (codex 20-F15-30)", () => {
    const { lines, out } = run([
      {
        name: "Rog",
        class: CombatUnitClass.Rogue,
        spec: CombatUnitSpec.Rogue_Subtlety,
        spellCastEvents: [cast("212182", -2), cast("212182", 40), cast("212182", 4000)],
      },
    ]);
    expect(lines).toEqual([
      "0:40  [ENEMY UTILITY]   5(Rog) (Subtlety Rogue): Smoke Bomb",
    ]);
    expect(out.utilityRendered).toBe(true);
  });
});
