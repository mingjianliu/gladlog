/**
 * `checkFindingsCountFollowsMenu` — the number of findings a findings prompt
 * asks for agrees with its own menu (L07, user ruling 2026-10-11: "Produce
 * 4-8 coaching findings" opened prompts whose menu held one event).
 */
import { buildFindingsPrompt } from "@gladlog/analysis/src/analysis/buildFindingsPrompt";
import {
  findingsCountInstruction,
  findingsPromptHead,
} from "@gladlog/analysis/src/analysis/findingsCount";
import type { CandidateEvent } from "@gladlog/analysis/src/analysis/types";
import { describe, expect, it } from "vitest";

import { checkFindingsCountFollowsMenu } from "../src/quality/promptQualityCheck";

const row = (i: number, type = "kick-eaten"): CandidateEvent => ({
  id: `${type}:P1:${i}`,
  type,
  t: i,
  unitNames: ["Me"],
  facts: { t: String(i) },
});
const menuOf = (n: number) => Array.from({ length: n }, (_, i) => row(i));
const promptOf = (candidates: CandidateEvent[], spec = "Restoration Druid") =>
  buildFindingsPrompt(candidates, "MATCH TIMELINE\n0:10 [KICK] x", spec).split(
    "\n",
  );

describe("checkFindingsCountFollowsMenu", () => {
  it.each([0, 1, 2, 3, 4, 5, 9])(
    "the product's own prompt passes for a menu of %i",
    (n) => {
      expect(checkFindingsCountFollowsMenu(promptOf(menuOf(n)))).toEqual([]);
    },
  );

  it("mutation: the old fixed sentence over a menu of one, two or three fails, and the failure states both counts", () => {
    for (const n of [1, 2, 3]) {
      const lines = promptOf(menuOf(n));
      // what every prompt opened with before L07
      lines[0] = findingsPromptHead("Restoration Druid", 4);
      const f = checkFindingsCountFollowsMenu(lines);
      expect(f, String(n)).toHaveLength(1);
      expect(f[0]).toContain('asks for "4-8 coaching findings"');
      expect(f[0]).toContain(`its menu holds ${n} event${n === 1 ? "" : "s"}`);
    }
  });

  it("mutation: a count for another menu size fails in both directions", () => {
    const three = promptOf(menuOf(3));
    three[0] = findingsPromptHead("Restoration Druid", 2);
    expect(checkFindingsCountFollowsMenu(three)[0]).toContain(
      'asks for "up to 2 coaching findings" while its menu holds 3 events',
    );
    const five = promptOf(menuOf(5));
    five[0] = findingsPromptHead("Restoration Druid", 3);
    expect(checkFindingsCountFollowsMenu(five)[0]).toContain(
      'asks for "up to 3 coaching findings" while its menu holds 5 events',
    );
  });

  it("mutation: a row removed from (or added to) the menu after the head was written fails", () => {
    const four = promptOf(menuOf(4));
    const at = four.findIndex((l) => l.startsWith("  - id=kick-eaten:P1:3 "));
    const dropped = four.filter((_, i) => i !== at);
    expect(checkFindingsCountFollowsMenu(dropped)).toHaveLength(1);
    const three = promptOf(menuOf(3));
    const last = three.findIndex((l) =>
      l.startsWith("  - id=kick-eaten:P1:2 "),
    );
    three.splice(last + 1, 0, four[at]!);
    expect(checkFindingsCountFollowsMenu(three)).toHaveLength(1);
  });

  it("mutation: the right count in words the builder does not write fails", () => {
    const two = promptOf(menuOf(2));
    two[0] = two[0]!.replace("at most one per menu event", "one or two each");
    expect(checkFindingsCountFollowsMenu(two)).toHaveLength(1);
  });

  it("counts distinct ids, as the audit does: four rows of three ids ask for up to three", () => {
    const rows = [...menuOf(3), { ...row(2), facts: { t: "2.4" } }];
    const lines = promptOf(rows);
    expect(lines[0]).toContain(findingsCountInstruction(3));
    expect(checkFindingsCountFollowsMenu(lines)).toEqual([]);
    lines[0] = findingsPromptHead("Restoration Druid", 4);
    expect(checkFindingsCountFollowsMenu(lines)[0]).toContain(
      "its menu holds 3 events (4 rows)",
    );
  });

  it("a spec name with an apostrophe or spaces is read back whole", () => {
    expect(
      checkFindingsCountFollowsMenu(
        promptOf(menuOf(2), "Beast Mastery Hunter"),
      ),
    ).toEqual([]);
    expect(checkFindingsCountFollowsMenu(promptOf(menuOf(1), "71"))).toEqual(
      [],
    );
  });

  it("a findings prompt that lost its coach sentence fails; the bare match context (no menu) is not held", () => {
    const lines = promptOf(menuOf(2));
    lines[0] = "Summarise the match.";
    expect(checkFindingsCountFollowsMenu(lines)[0]).toContain(
      "does not open with the coach sentence",
    );
    expect(
      checkFindingsCountFollowsMenu(["MATCH TIMELINE", "0:10 [KICK] x"]),
    ).toEqual([]);
  });
});
