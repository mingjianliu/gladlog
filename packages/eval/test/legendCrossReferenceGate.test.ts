/**
 * `checkLegendCrossReferences` — a candidate legend that names another
 * candidate type needs that type's legend in the same prompt (re-eval
 * 2026-10-08, I06: b711d4ac's `kick-priority-team` legend said "as in
 * kick-priority-missed" three times, with no `kick-priority-missed` row and
 * therefore no such legend).
 */
import { buildFindingsPrompt } from "@gladlog/analysis/src/analysis/buildFindingsPrompt";
import type { CandidateEvent } from "@gladlog/analysis/src/analysis/candidateFindings";
import { CANDIDATE_TYPE_REGISTRY } from "@gladlog/analysis/src/data/candidateTypeRegistry";
import { describe, expect, it } from "vitest";

import { checkLegendCrossReferences } from "../src/quality/promptQualityCheck";

const row = (type: string): CandidateEvent => ({
  id: `${type}:P1:10`,
  type,
  t: 10,
  unitNames: ["Me"],
  facts: { t: "10" },
});
const promptOf = (types: string[]) =>
  buildFindingsPrompt(types.map(row), "", "Restoration Druid").split("\n");

describe("checkLegendCrossReferences", () => {
  it("flags a legend that names a type whose legend is absent (the b711d4ac line)", () => {
    const f = checkLegendCrossReferences([
      "Event legend:",
      '- "kick-priority-team": at facts.t the enemy healer hardcast facts.heal inside the defenseless span (as in kick-priority-missed).',
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('"kick-priority-missed"');
  });

  it("passes the same legend when the named type's legend is printed too", () => {
    expect(
      checkLegendCrossReferences([
        "Event legend:",
        '- "kick-priority-missed": at facts.t the enemy healer hardcast facts.heal.',
        '- "kick-priority-team": the same cast (as in kick-priority-missed).',
      ]),
    ).toEqual([]);
  });

  it("does not read a longer type name as the shorter one, nor the word death", () => {
    expect(
      checkLegendCrossReferences([
        '- "backlash-dispel-window": the debuff sat there and no dispel came before the death.',
      ]),
    ).toEqual([]);
  });

  it("every product legend stands alone: printed with no other type in the menu, none fails", () => {
    const types = Object.keys(CANDIDATE_TYPE_REGISTRY);
    let printed = 0;
    for (const type of types) {
      const lines = promptOf([type]);
      if (lines.some((l) => l.startsWith(`- "${type}": `))) printed++;
      expect(checkLegendCrossReferences(lines), type).toEqual([]);
    }
    // the loop must have looked at real legends, not at prompts without one
    expect(printed).toBeGreaterThan(15);
  });

  it("the kick-priority-team legend carries what it used to cite", () => {
    const legend = promptOf(["kick-priority-team"]).find((l) =>
      l.startsWith('- "kick-priority-team": '),
    )!;
    expect(legend).not.toContain("kick-priority-missed");
    expect(legend).toContain("no major defensive up or available");
    expect(legend).toContain("both figures are DEATH rates");
  });
});
