/**
 * Curated-List Completeness (CLAUDE.md), forward direction: every healing
 * major the healer save-cooldown roster lists for a spec is printed by SOME
 * enemy line for that spec — [ENEMY HEAL CD] (`isEnemyHealCdFor`), an
 * [ENEMY DEF] save (`isExternalSaveId`, the mitigation tables), or a
 * documented elsewhere-entry. fact5 codex audit 2026-10-25: Evangelism, Tip
 * the Scales and Nature's Swiftness had no line in 6 of 15 rounds.
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ENEMY_HEAL_CD_ROSTER_ELSEWHERE,
  isEnemyHealCdFor,
} from "../src/data/enemyHealCds";
import { ensureAnalysisData } from "../src/data/ensure";
import raw from "../src/data/healerSaveCdGenerated.json";
import { MITIGATION_TABLE } from "../src/data/mitigationData";
import { isExternalSaveId } from "../src/utils/enemyDefensives";

beforeAll(async () => {
  await ensureAnalysisData();
});

const SPEC: Record<string, string> = {
  "Discipline Priest": CombatUnitSpec.Priest_Discipline,
  "Holy Priest": CombatUnitSpec.Priest_Holy,
  "Holy Paladin": CombatUnitSpec.Paladin_Holy,
  "Mistweaver Monk": CombatUnitSpec.Monk_Mistweaver,
  "Preservation Evoker": CombatUnitSpec.Evoker_Preservation,
  "Restoration Druid": CombatUnitSpec.Druid_Restoration,
  "Restoration Shaman": CombatUnitSpec.Shaman_Restoration,
};

describe("enemy heal-CD roster forward check", () => {
  it("every roster id has an enemy line for its spec", () => {
    const missing: string[] = [];
    for (const [spec, v] of Object.entries(
      (raw as { specs: Record<string, { spells: { spellId: string; name: string }[] }> }).specs,
    )) {
      expect(SPEC[spec], spec).toBeDefined();
      for (const s of v.spells)
        if (
          !isEnemyHealCdFor(s.spellId, SPEC[spec]) &&
          !isExternalSaveId(s.spellId) &&
          !MITIGATION_TABLE[s.spellId] &&
          !(s.spellId in ENEMY_HEAL_CD_ROSTER_ELSEWHERE)
        )
          missing.push(`${spec}: ${s.spellId} ${s.name}`);
    }
    expect(missing).toEqual([]);
  });
  it("a gated id is no healer's line for another spec (a Balance druid's Nature's Swiftness)", () => {
    expect(isEnemyHealCdFor("132158", CombatUnitSpec.Druid_Restoration)).toBe(true);
    expect(isEnemyHealCdFor("132158", CombatUnitSpec.Druid_Balance)).toBe(false);
  });
});
