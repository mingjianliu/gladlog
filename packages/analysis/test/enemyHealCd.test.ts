/**
 * Triage G7-P3: res-readiness F-C2 (the cast ordinal is `(cast k of N)`, not
 * the charges notation) + enemy-def F-E8 / F-E10 (`[ENEMY HEAL CD]` lines for
 * an enemy healer's throughput majors and Avenging Crusader, rulings A26 = A
 * / A27 = B — never an [ENEMY CD] / burst-window spell).
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  castOrdinal,
  emitEnemyCdEntries,
} from "../src/context/timelineSections/enemyCd";
import { ENEMY_HEAL_CD_IDS } from "../src/data/enemyHealCds";
import { ensureAnalysisData } from "../src/data/ensure";
import { OFFENSIVE_CD_SPELL_IDS } from "../src/utils/spellDanger";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const cast = (spellId: string, s: number) => ({
  spellId,
  spellName: spellId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + s * 1000 },
});

describe("G7-P3", () => {
  it("F-C2: the ordinal reads (cast k of N); a single cast has none", () => {
    expect(castOrdinal(2, 3)).toBe(" (cast 2 of 3)");
    expect(castOrdinal(1, 1)).toBe("");
  });
  it("F-E8 / F-E10: an enemy Holy Priest's Apotheosis and Serenity ×2, a Holy Paladin's Avenging Crusader → [ENEMY HEAL CD]", () => {
    const lines: string[] = [];
    const out = emitEnemyCdEntries({
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as never,
      cdPurgeAnnotations: new Map(),
      addEntry: (_t: number, ...l: unknown[]) => {
        lines.push(...(l as string[]));
        return true; // the real addEntry: true = the entry was kept
      },
      enemyPid: (n: string) => `5(${n})`,
      matchStartMs: T0,
      enemies: [
        {
          name: "Misanthropy",
          spec: CombatUnitSpec.Priest_Holy,
          spellCastEvents: [
            cast("2050", 12.3),
            cast("200183", 60.7),
            cast("2050", 30.1),
          ],
        },
        {
          name: "Pally",
          spec: CombatUnitSpec.Paladin_Holy,
          spellCastEvents: [cast("216331", 61)],
        },
      ] as never,
    });
    expect(lines).toEqual([
      "0:12  [ENEMY HEAL CD]   5(Misanthropy) (Holy Priest): Holy Word: Serenity (cast 1 of 2)",
      "0:30  [ENEMY HEAL CD]   5(Misanthropy) (Holy Priest): Holy Word: Serenity (cast 2 of 2)",
      "1:00  [ENEMY HEAL CD]   5(Misanthropy) (Holy Priest): Apotheosis",
      "1:01  [ENEMY HEAL CD]   5(Pally) (Holy Paladin): Avenging Crusader",
    ]);
    expect(out).toEqual({ ordinalRendered: true, healCdRendered: true });
  });
  it("the heal-CD set never overlaps the burst-window set", () => {
    for (const id of ENEMY_HEAL_CD_IDS)
      expect(OFFENSIVE_CD_SPELL_IDS.has(id), id).toBe(false);
  });
});
