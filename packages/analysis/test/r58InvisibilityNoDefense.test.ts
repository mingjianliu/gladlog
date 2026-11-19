/**
 * User rulings R58 + R61 (2026-11-18): Greater Invisibility reduces no
 * damage and is no immunity. Its 60 % wall row (2026-09-26) stood on buff
 * 113862, which nothing triggers in DB2 12.1.7, which has 0 rows in 605
 * files / 713 casts, and under which damage taken was 0.98x baseline
 * (eee45a66 r3: a `burst-into-mitigation` row on a mage who took full damage
 * and died in that burst). Every reader of "a protection was up or in hand"
 * leaves it out; its `[ENEMY DEF]` line is the fact `(invisible, …)`.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
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
import { computeOffensiveWindows } from "../src/utils/offensiveWindows";
import {
  INVISIBLE_ENDED_AT_ONCE,
  INVISIBLE_LEGEND,
  invisibleLengthWords,
  selfDefensiveLabelLegends,
  selfDefensiveLabelWords,
  statesSelfDefensiveLabel,
} from "../src/utils/selfDefensiveMechanism";
import {
  KW_SPAN_UNSEEN_AURA_IDS,
  KW_UNTARGETABLE_AURA_IDS,
} from "../src/utils/stealthActionEnd";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

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

// Batch review 80-PIPE-160-B146 (1405c83e round 2: invisibility applied
// 165.612 s, removed 166.205 s, inside `defenseless 158.6–166.9 s`): with the
// roster row gone nothing kept the invisible seconds out of a kill window.
describe("a kill window holds no second the unit is invisible (R58: aura up, nothing in hand)", () => {
  const T0 = 1_000_000;
  const at = (s: number) => T0 + s * 1000;
  const combat = { startTime: T0, endTime: at(107), units: {} } as never;
  // a unit whose only roster defensive is spent at 50 s: one span after it
  const target = () =>
    makeUnit("e1", {
      name: "EnemyDruid",
      spec: CombatUnitSpec.Druid_Feral,
      reaction: CombatUnitReaction.Hostile,
      info: {},
      spellCastEvents: [
        makeSpellCastEvent(
          "22812",
          at(50),
          "e1",
          "EnemyDruid",
          "e1",
          "EnemyDruid",
        ),
      ],
    });
  const aura = (event: LogEvent, s: number) =>
    makeAuraEvent(event, AURA, at(s), "e1", "e1", "BUFF") as never;

  it("the set is the untargetable auras and the invisibility, and only the kill-window span reads it", () => {
    expect([...KW_SPAN_UNSEEN_AURA_IDS].sort()).toEqual(
      [...KW_UNTARGETABLE_AURA_IDS, AURA].sort(),
    );
    // not an untargetable-immunity member: KILL ATTEMPTS still does not count it
    expect(KW_UNTARGETABLE_AURA_IDS.has(AURA)).toBe(false);
  });

  it("a logged aura cuts the span for exactly the time it is up", () => {
    const base = computeOffensiveWindows([target()] as never, [], combat);
    expect(base).toHaveLength(1);
    const from = base[0]!.fromSeconds;
    const u = target();
    u.auraEvents.push(
      aura(LogEvent.SPELL_AURA_APPLIED, from + 7),
      aura(LogEvent.SPELL_AURA_REMOVED, from + 7.593),
    );
    const w = computeOffensiveWindows([u] as never, [], combat);
    // no span holds an invisible instant…
    for (const x of w)
      expect(
        x.toSeconds <= from + 7.001 || x.fromSeconds >= from + 7.592,
        `${x.fromSeconds}–${x.toSeconds}`,
      ).toBe(true);
    // …and the span is back when the aura is off
    expect(
      w.some(
        (x) => x.fromSeconds >= from + 7.59 && x.fromSeconds <= from + 7.6,
      ),
    ).toBe(true);
  });

  it("an end the log never showed is the holder's first own press — not the official length", () => {
    const base = computeOffensiveWindows([target()] as never, [], combat);
    const from = base[0]!.fromSeconds;
    const u = target();
    u.auraEvents.push(aura(LogEvent.SPELL_AURA_APPLIED, from + 2));
    u.spellCastEvents.push(
      makeSpellCastEvent(
        "8921",
        at(from + 9),
        "x",
        "X",
        "e1",
        "EnemyDruid",
      ) as never,
    );
    const w = computeOffensiveWindows([u] as never, [], combat);
    for (const x of w)
      expect(
        x.toSeconds <= from + 2.001 || x.fromSeconds >= from + 8.999,
        `${x.fromSeconds}–${x.toSeconds}`,
      ).toBe(true);
    expect(
      w.some((x) => x.fromSeconds >= from + 8.9 && x.fromSeconds <= from + 9.1),
    ).toBe(true);
  });
});
