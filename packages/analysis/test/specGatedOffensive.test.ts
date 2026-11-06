import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { isOffensivePressFactFor } from "../src/data/enemyHealCds";
import { isEnemyCdWindowSpell } from "../src/utils/cooldowns";
import {
  isOffensiveCdFor,
  isOffensiveLedgerCd,
  isSpecGatedOffensiveFor,
  OFFENSIVE_CD_SPELL_IDS,
  offensiveEffectCdId,
  SPEC_GATED_OFFENSIVE_CD_IDS,
} from "../src/utils/spellDanger";

// GH #184 part B (user ruling 2026-11-05): Divine Toll is Retribution's
// offensive cooldown only, Convoke Balance's and Feral's.
const DIVINE_TOLL = "375576";
const CONVOKE = "391528";
const S = CombatUnitSpec;

describe("spec-gated offensive cooldowns", () => {
  it("the table: two ids, outside the id-keyed set", () => {
    expect(Object.keys(SPEC_GATED_OFFENSIVE_CD_IDS).sort()).toEqual([
      DIVINE_TOLL,
      CONVOKE,
    ]);
    for (const id of [DIVINE_TOLL, CONVOKE])
      expect(OFFENSIVE_CD_SPELL_IDS.has(id)).toBe(false);
  });

  it("Divine Toll: Retribution's only", () => {
    expect(isOffensiveCdFor(DIVINE_TOLL, S.Paladin_Retribution)).toBe(true);
    expect(isOffensiveCdFor(DIVINE_TOLL, S.Paladin_Holy)).toBe(false);
    expect(isOffensiveCdFor(DIVINE_TOLL, S.Paladin_Protection)).toBe(false);
    expect(isOffensiveCdFor(DIVINE_TOLL, undefined)).toBe(false);
    expect(offensiveEffectCdId(DIVINE_TOLL, S.Paladin_Retribution)).toBe(
      DIVINE_TOLL,
    );
    expect(offensiveEffectCdId(DIVINE_TOLL)).toBeUndefined();
  });

  it("Convoke: Balance's and Feral's, never Restoration's or Guardian's", () => {
    expect(isSpecGatedOffensiveFor(CONVOKE, S.Druid_Balance)).toBe(true);
    expect(isSpecGatedOffensiveFor(CONVOKE, S.Druid_Feral)).toBe(true);
    expect(isSpecGatedOffensiveFor(CONVOKE, S.Druid_Restoration)).toBe(false);
    expect(isSpecGatedOffensiveFor(CONVOKE, S.Druid_Guardian)).toBe(false);
  });

  it("the enemy-CD window test admits them only in their spec's hands", () => {
    expect(isEnemyCdWindowSpell(DIVINE_TOLL, S.Paladin_Retribution)).toBe(
      true,
    );
    expect(isEnemyCdWindowSpell(DIVINE_TOLL, S.Paladin_Holy)).toBe(false);
    expect(isEnemyCdWindowSpell(CONVOKE, S.Druid_Feral)).toBe(true);
    expect(isEnemyCdWindowSpell(CONVOKE)).toBe(false);
  });

  it("a gated spec's press is no press fact; another non-healer spec's still is", () => {
    expect(isOffensivePressFactFor(DIVINE_TOLL, S.Paladin_Retribution)).toBe(
      false,
    );
    expect(isOffensivePressFactFor(DIVINE_TOLL, S.Paladin_Protection)).toBe(
      true,
    );
    expect(isOffensivePressFactFor(CONVOKE, S.Druid_Feral)).toBe(false);
    expect(isOffensivePressFactFor(CONVOKE, S.Druid_Guardian)).toBe(true);
    // a healer's is its [ENEMY HEAL CD], as before
    expect(isOffensivePressFactFor(DIVINE_TOLL, S.Paladin_Holy)).toBe(false);
  });

  it("a ledger row is offensive by its spec-carrying tag", () => {
    expect(isOffensiveLedgerCd({ spellId: DIVINE_TOLL, tag: "Offensive" })).toBe(
      true,
    );
    expect(isOffensiveLedgerCd({ spellId: DIVINE_TOLL, tag: "Utility" })).toBe(
      false,
    );
  });
});
