/**
 * Triage G7-P3: res-readiness F-C2 (the cast ordinal is `(cast k of N)`, not
 * the charges notation) + enemy-def F-E8 / F-E10 (`[ENEMY HEAL CD]` lines for
 * an enemy healer's throughput majors and Avenging Crusader, rulings A26 = A
 * / A27 = B — never an [ENEMY CD] / burst-window spell).
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { CRISIS_PROTECTIVE_ANSWER_IDS } from "../src/analysis/crisisDecisionPoints";
import {
  castOrdinal,
  emitEnemyCdEntries,
} from "../src/context/timelineSections/enemyCd";
import { abilityProfile } from "../src/data/abilityProfile";
import { ENEMY_HEAL_CD_IDS } from "../src/data/enemyHealCds";
import { ensureAnalysisData } from "../src/data/ensure";
import { HEALER_SAVE_CD_IDS } from "../src/data/healerSaveCd";
import { TEAM_HEAL_CD_IDS } from "../src/utils/cooldowns";
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
      matchEndSeconds: 3600,
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
    expect(out).toEqual({
      ordinalRendered: true,
      healCdRendered: true,
      procRendered: false,
      utilityRendered: false,
    });
  });
  it("the heal-CD set never overlaps the burst-window set", () => {
    for (const id of ENEMY_HEAL_CD_IDS)
      expect(OFFENSIVE_CD_SPELL_IDS.has(id), id).toBe(false);
  });
  // FT F01: Time Spiral 374968 sat in the set and is a movement-ability
  // reset (5 `[ENEMY HEAL CD]` lines on the 60 re-eval prompts, 96 on the
  // 605-file capture — 55 of them a Devastation Evoker's).
  it("every heal CD heals, absorbs, empowers healing, is on the generated save roster — or is a healer major the user ruled one", () => {
    for (const id of ENEMY_HEAL_CD_IDS) {
      const p = abilityProfile(id);
      expect(
        TEAM_HEAL_CD_IDS.has(id) ||
          p.healsOthers ||
          p.healsSelf ||
          p.absorbs ||
          p.throughputRole ||
          HEALER_SAVE_CD_IDS.has(id) ||
          // Incarnation: Tree of Life 33891 — a form, so the official
          // profile carries no heal / absorb / throughput flag; it is here
          // on the signed list ("树肯定算,是大技能", ruling 2026-09-14)
          CRISIS_PROTECTIVE_ANSWER_IDS.has(id),
        id,
      ).toBe(true);
    }
    expect(CRISIS_PROTECTIVE_ANSWER_IDS.has("33891")).toBe(true);
  });
  it("Time Spiral is not a heal CD: an enemy's press renders no [ENEMY HEAL CD] line", () => {
    const p = abilityProfile("374968");
    expect([p.healsOthers, p.healsSelf, p.absorbs, p.throughputRole]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(TEAM_HEAL_CD_IDS.has("374968")).toBe(false);
    expect(HEALER_SAVE_CD_IDS.has("374968")).toBe(false);
    expect(ENEMY_HEAL_CD_IDS.has("374968")).toBe(false);
    const lines: string[] = [];
    const out = emitEnemyCdEntries({
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as never,
      cdPurgeAnnotations: new Map(),
      addEntry: (_t: number, ...l: unknown[]) => {
        lines.push(...(l as string[]));
        return true;
      },
      enemyPid: (n: string) => `4(${n})`,
      matchStartMs: T0,
      matchEndSeconds: 3600,
      enemies: [
        {
          name: "Dev",
          spec: CombatUnitSpec.Evoker_Devastation,
          spellCastEvents: [cast("374968", 21.3)],
        },
      ] as never,
    });
    expect(lines).toEqual([]);
    expect(out.healCdRendered).toBe(false);
  });
});
