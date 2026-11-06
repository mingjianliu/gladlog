/**
 * fact9 (F24) class 2 — what a defensive / healing cooldown is filed as:
 *  - D3: a deflection (Aspect of the Turtle) is no immunity, in the death
 *    mitigation audit and on a [STACKED DEFENSIVES] line;
 *  - D17: the five heals the user ruled out of the major defensives are no
 *    cd-waste, no cd-hoarded ready cooldown, no NOTE "held" defensive.
 * User rulings 2026-11-03 (D3 wording, D17 scope).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { cdWasteEvents } from "../src/analysis/candidateFindings";
import {
  isDefensiveCdResponse,
  isSpendableDefensiveCd,
} from "../src/analysis/candidates/cooldownTiming";
import { stackedDefensivePairs } from "../src/analysis/stackedDefensives";
import { formatMitigationAuditLine } from "../src/context/matchTimelineSections";
import { formatStackedDefensiveLines } from "../src/context/stackedDefensives";
import {
  HEAL_NOT_MAJOR_DEFENSIVE_IDS,
  KW_NOT_UP_AS_DEFENSE_IDS,
} from "../src/data/abilityProfile";
import { ensureAnalysisData } from "../src/data/ensure";
import { DEFLECTION_IDS } from "../src/data/mitigationData";

beforeAll(async () => {
  await ensureAnalysisData();
});

const TURTLE = "186265";

const stackOnPainSuppression = (secondId: string) => {
  const T0 = 1_000_000;
  const aura = (t: number, event: string, spellId: string, src: string) => ({
    timestamp: T0 + t,
    spellId,
    srcUnitId: src,
    srcUnitName: `${src}-R`,
    destUnitId: "M",
    logLine: { event, timestamp: T0 + t },
  });
  const unit = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    name: `${id}-R`,
    spec: CombatUnitSpec.Hunter_Marksmanship,
    reaction: CombatUnitReaction.Friendly,
    info: { teamId: "0" },
    advancedActions: [
      { timestamp: T0, advancedActorCurrentHp: 100, advancedActorMaxHp: 100 },
    ],
    damageIn: [],
    absorbsIn: [],
    auraEvents: [],
    spellCastEvents: [],
    ...over,
  });
  const owner = unit("P", { spec: CombatUnitSpec.Priest_Discipline });
  const mate = unit("M", {
    auraEvents: [
      aura(10_000, LogEvent.SPELL_AURA_APPLIED, "33206", "P"),
      aura(12_000, LogEvent.SPELL_AURA_APPLIED, secondId, "M"),
      aura(18_000, LogEvent.SPELL_AURA_REMOVED, "33206", "P"),
      aura(20_000, LogEvent.SPELL_AURA_REMOVED, secondId, "M"),
    ],
  });
  const units: Record<string, unknown> = { P: owner, M: mate };
  return stackedDefensivePairs(
    owner as never,
    {
      startTime: T0,
      endTime: T0 + 60_000,
      units,
      startInfo: { bracket: "3v3" },
    } as never,
  );
};

describe("fact9 D3 — a deflection is no immunity", () => {
  it("the mitigation audit says what Turtle does, in the legend's words", () => {
    expect(DEFLECTION_IDS.has(TURTLE)).toBe(true);
    const line = formatMitigationAuditLine({
      spellId: TURTLE,
      spellName: "Aspect of the Turtle",
      kind: "deflection",
      activeOverlapS: 3,
      damageTakenDuringImmunity: 17_000,
      damageOutsideImmunitySchool: 0,
    });
    expect(line).toBe(
      "Mitigation audit: Aspect of the Turtle (deflects direct attacks; periodic damage still lands) covered 3.0s in the final 10s (still took ~17k during it)",
    );
    expect(line).not.toContain("immunity");
  });

  it("a Turtle stacked on a Pain Suppression is not priced 'immunity'", () => {
    const pairs = stackOnPainSuppression(TURTLE);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.second.spellId).toBe(TURTLE);
    expect(pairs[0]!.unpricedReason).toBe("deflection");
    const [e] = formatStackedDefensiveLines(pairs);
    expect(e!.line).toContain(
      "the later one, Aspect of the Turtle, is not priced here (deflects direct attacks)",
    );
  });
});

describe("fact9 D17 — a heal is no major defensive", () => {
  it("a Desperate Prayer under a Pain Suppression is no stack of two major defensives (codex 20-F24-07 #2)", () => {
    expect(stackOnPainSuppression("19236")).toEqual([]);
  });
  const me = { id: "p1", name: "Me" };
  const never = (spellId: string, spellName: string) => ({
    spellId,
    spellName,
    neverUsed: true,
    isThroughput: false,
    tag: "Defensive",
  });
  it("the five heals: no cd-waste, no spendable defensive; a wall still is", () => {
    for (const [id, name] of [
      ["740", "Tranquility"],
      ["64843", "Divine Hymn"],
      ["19236", "Desperate Prayer"],
      ["48743", "Death Pact"],
      ["109304", "Exhilaration"],
    ] as const) {
      expect(HEAL_NOT_MAJOR_DEFENSIVE_IDS.has(id), id).toBe(true);
      expect(cdWasteEvents([never(id, name)], me, 40), id).toEqual([]);
      expect(
        isSpendableDefensiveCd({
          spellId: id,
          tag: "Defensive",
          isThroughput: false,
        }),
        id,
      ).toBe(false);
      // …but a press of one still answers a crisis (the response set does
      // not shrink with the accusation set — 605 preview 2026-11-03)
      expect(
        isDefensiveCdResponse({
          spellId: id,
          tag: "Defensive",
          isThroughput: false,
        }),
        id,
      ).toBe(true);
    }
    expect(cdWasteEvents([never("47585", "Dispersion")], me, 40)).toHaveLength(
      1,
    );
    expect(
      isSpendableDefensiveCd({
        spellId: "47585",
        tag: "Defensive",
        isThroughput: false,
      }),
    ).toBe(true);
  });
  it("the burst ledger's not-up roster is these five plus Lichborne", () => {
    expect([...KW_NOT_UP_AS_DEFENSE_IDS].sort()).toEqual(
      // Apotheosis (fact11 D4) is a heal in no kill-window roster
      [
        ...[...HEAL_NOT_MAJOR_DEFENSIVE_IDS].filter((id) => id !== "200183"),
        "49039",
      ].sort(),
    );
  });
});
