/**
 * User rulings R58 + R61 (2026-11-18): Greater Invisibility reduces no
 * damage and is no immunity. Its 60 % wall row (2026-09-26) stood on buff
 * 113862, which nothing triggers in DB2 12.1.7, which has 0 rows in 605
 * files / 713 casts, and under which damage taken was 0.98x baseline
 * (eee45a66 r3: a `burst-into-mitigation` row on a mage who took full damage
 * and died in that burst). Every reader of "a protection was up or in hand"
 * leaves it out; its `[ENEMY DEF]` line is the fact `(invisible, …)`.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  STACKED_DEFENSIVE_MAJOR_IDS,
  stackedDefensiveKeyOf,
} from "../src/analysis/stackedDefensives";
import {
  isKillWindowMajorDefensive,
  KW_MAJOR_DEFENSIVE_IDS,
} from "../src/data/abilityProfile";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  MITIGATION_TABLE,
  NO_MITIGATION_IDS,
  SELF_WALL_AURA_TO_CAST_ID,
} from "../src/data/mitigationData";
import { MITIGATION_VERDICTS } from "../src/data/mitigationVerdicts";
import spellIdLists, {
  ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS,
  ENEMY_INVISIBILITY_AURAS,
  INVISIBLE_FACT_LINE_IDS,
  isInvisibilityPress,
} from "../src/data/spellIdLists";
import { isMitigationAuditKey } from "../src/utils/counterfactual";
import {
  SAVE_AURA_END_UNSEEN_IDS,
  SAVE_AURA_END_UNSEEN_NAMES,
  SELF_SAVE_IDS,
} from "../src/utils/enemyDefensives";
import {
  INVISIBLE_ENDED_AT_ONCE,
  INVISIBLE_LEGEND,
  invisibleLengthWords,
  selfDefensiveLabelLegends,
  selfDefensiveLabelWords,
  statesSelfDefensiveLabel,
} from "../src/utils/selfDefensiveMechanism";

const CAST = "110959";
const AURA = "110960";

describe("Greater Invisibility is no defense that is up or in hand (R58)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the press and its logged aura are the invisibility pair", () => {
    expect(INVISIBLE_FACT_LINE_IDS).toEqual({ [CAST]: AURA });
    expect(Object.keys(ENEMY_INVISIBILITY_AURAS)).toEqual([AURA]);
    expect(isInvisibilityPress(CAST)).toBe(true);
    expect(isInvisibilityPress("198589")).toBe(false); // Blur stays a wall
  });

  it("no mitigation: no table row, no verdict, no wall aura link — a no-mitigation press", () => {
    expect(MITIGATION_TABLE[CAST]).toBeUndefined();
    expect(MITIGATION_VERDICTS[CAST]).toBeUndefined();
    expect(SELF_WALL_AURA_TO_CAST_ID[AURA]).toBeUndefined();
    expect(NO_MITIGATION_IDS.has(CAST)).toBe(true);
  });

  it("no reader of `up or in hand` holds it: kill windows, stacked defensives, the death audit, KILL ATTEMPTS", () => {
    expect(KW_MAJOR_DEFENSIVE_IDS.has(CAST)).toBe(false);
    expect(isKillWindowMajorDefensive(CAST)).toBe(false);
    expect(STACKED_DEFENSIVE_MAJOR_IDS.has(CAST)).toBe(false);
    expect(stackedDefensiveKeyOf(AURA)).toBeUndefined();
    expect(isMitigationAuditKey(CAST)).toBe(false);
    expect(SELF_SAVE_IDS.has(CAST)).toBe(false);
    expect(SAVE_AURA_END_UNSEEN_NAMES.has("Greater Invisibility")).toBe(false);
    // the neighbours stay: Blur in the kill windows, Ice Block everywhere
    expect(isKillWindowMajorDefensive("198589")).toBe(true);
    expect(STACKED_DEFENSIVE_MAJOR_IDS.has("45438")).toBe(true);
  });

  it("no immunity either (R61), and the unseen-carrier reading stays", () => {
    expect(ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS.has(AURA)).toBe(false);
    expect(SAVE_AURA_END_UNSEEN_IDS.has(AURA)).toBe(true);
  });

  it("the press stays a defensive button of the mage's own (the cooldown ledger's list)", () => {
    expect(spellIdLists.bigDefensiveSpellIds.map(String)).toContain(CAST);
  });

  it("the label and its legend: `(invisible, <length>)`, the sentence only with the label", () => {
    const m = { kind: "invisible" } as const;
    expect(selfDefensiveLabelWords(m)).toBe("invisible");
    expect(statesSelfDefensiveLabel("(invisible, end not logged)", m)).toBe(
      true,
    );
    expect(statesSelfDefensiveLabel("(invisible, 0.7s) (at 17% HP)", m)).toBe(
      true,
    );
    expect(statesSelfDefensiveLabel("(60%, end not logged)", m)).toBe(false);
    const line =
      "2:41  [ENEMY DEF]   6(FMage) (Fire Mage): Greater Invisibility (invisible, end not logged) (at 17% HP)";
    expect(selfDefensiveLabelLegends([line])).toEqual([INVISIBLE_LEGEND]);
    expect(
      selfDefensiveLabelLegends([
        "2:41  [ENEMY DEF]   6(FMage) (Fire Mage): Ice Block (immune, 10.0s)",
      ]),
    ).toEqual([]);
    expect(INVISIBLE_LEGEND).toBe(
      "`(invisible, …)` = the unit went unseen; NOT one of the walls and no immunity; kill windows and KILL ATTEMPTS do not count it; `ended at once` = the log took the invisibility off the same instant it went up;",
    );
    // R64: a length that would print `0.0s` reads `ended at once`
    expect(invisibleLengthWords("0.0s")).toBe("ended at once");
    expect(INVISIBLE_ENDED_AT_ONCE).toBe("ended at once");
    expect(invisibleLengthWords("0.1s")).toBe("0.1s");
    expect(invisibleLengthWords("end not logged")).toBe("end not logged");
  });
});
