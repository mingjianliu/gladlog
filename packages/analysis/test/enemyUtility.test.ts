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
    enemies: enemies as never,
  });
  return { lines, out };
};

describe("[ENEMY UTILITY]", () => {
  it("Champion's Spear ×2, Smoke Bomb, Tremor Totem: a line each", () => {
    const { lines, out } = run([
      {
        name: "Eldroath",
        class: CombatUnitClass.Warrior,
        spec: CombatUnitSpec.Warrior_Arms,
        spellCastEvents: [cast("376079", 36.07), cast("376079", 129.4)],
      },
      {
        name: "Hemo",
        class: CombatUnitClass.Rogue,
        spec: CombatUnitSpec.Rogue_Subtlety,
        spellCastEvents: [cast("212182", 23.3)],
      },
      {
        name: "Sham",
        class: CombatUnitClass.Shaman,
        spec: CombatUnitSpec.Shaman_Restoration,
        spellCastEvents: [cast("8143", 50)],
      },
    ]);
    expect(lines).toEqual([
      "0:36  [ENEMY UTILITY]   5(Eldroath) (Arms Warrior): Champion's Spear (cast 1 of 2)",
      "2:09  [ENEMY UTILITY]   5(Eldroath) (Arms Warrior): Champion's Spear (cast 2 of 2)",
      "0:23  [ENEMY UTILITY]   5(Hemo) (Subtlety Rogue): Smoke Bomb",
      "0:50  [ENEMY UTILITY]   5(Sham) (Restoration Shaman): Tremor Totem",
    ]);
    expect(out.utilityRendered).toBe(true);
  });
  it("Vanish and Lichborne keep their [ENEMY DEF] line and get no utility line", () => {
    expect(enemyDefSpeaksForPress("1856")).toBe(true);
    expect(enemyDefSpeaksForPress("49039")).toBe(true);
    expect(enemyDefSpeaksForPress("376079")).toBe(false);
    const { lines, out } = run([
      {
        name: "Rog",
        class: CombatUnitClass.Rogue,
        spec: CombatUnitSpec.Rogue_Subtlety,
        spellCastEvents: [cast("1856", 10)],
      },
      {
        name: "Dk",
        class: CombatUnitClass.DeathKnight,
        spec: CombatUnitSpec.DeathKnight_Unholy,
        spellCastEvents: [cast("49039", 12)],
      },
    ]);
    expect(lines).toEqual([]);
    expect(out.utilityRendered).toBe(false);
  });
});
