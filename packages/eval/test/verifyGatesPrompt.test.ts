/**
 * verify/gates `promptOf` — the prompt the capture's two files stand for is
 * the one the product builds (T221: the files were joined context first, and
 * the gate that holds line 1 failed on every owner with a menu).
 */
import { buildFindingsPrompt } from "@gladlog/analysis/src/analysis/buildFindingsPrompt";
import { findingsPromptHead } from "@gladlog/analysis/src/analysis/findingsCount";
import type { CandidateEvent } from "@gladlog/analysis/src/analysis/types";
import { describe, expect, it } from "vitest";

import { promptOf } from "../scripts/verify/gates";
import { checkFindingsCountFollowsMenu } from "../src/quality/promptQualityCheck";

const row = (i: number): CandidateEvent => ({
  id: `kick-eaten:P1:${i}`,
  type: "kick-eaten",
  t: i,
  unitNames: ["Me"],
  facts: { t: String(i) },
});
const CONTEXT =
  "ARENA MATCH — ANALYSIS REQUEST\n\nMATCH TIMELINE\n0:10 [KICK] x";
const SPEC = "Restoration Druid";
// what `acceptanceCapture` writes: archive, owner, then the text — the
// findings prompt built with an empty context
const captured = (body: string) => `/archive/a.txt.gz\nMe-Realm\n${body}`;
const filesOf = (n: number) => {
  const menu = Array.from({ length: n }, (_, i) => row(i));
  return {
    menu,
    text: captured(CONTEXT),
    findings: captured(buildFindingsPrompt(menu, "", SPEC)),
  };
};

describe("verify/gates promptOf (T221)", () => {
  it.each([1, 2, 5])(
    "is the product's own findings prompt for a menu of %i, and the count gate passes on it",
    (n) => {
      const f = filesOf(n);
      const prompt = promptOf(f.text, f.findings);
      expect(prompt).toBe(buildFindingsPrompt(f.menu, CONTEXT, SPEC));
      expect(checkFindingsCountFollowsMenu(prompt.split("\n"))).toEqual([]);
    },
  );

  it("mutation: a findings header asking for another count turns the gate red", () => {
    const f = filesOf(3);
    const lines = f.findings.split("\n");
    lines[2] = findingsPromptHead(SPEC, 2);
    const failures = checkFindingsCountFollowsMenu(
      promptOf(f.text, lines.join("\n")).split("\n"),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("while its menu holds 3 events");
  });

  it("the old join (context file, then findings file) fails the gate on a correct prompt — the constant it was", () => {
    const f = filesOf(3);
    expect(
      checkFindingsCountFollowsMenu(`${f.text}\n${f.findings}`.split("\n")),
    ).toHaveLength(1);
  });

  it("an owner with no findings file reads its bare context", () => {
    expect(promptOf(captured(CONTEXT), "")).toBe(CONTEXT);
  });

  it("a findings file of another shape is refused, not read", () => {
    expect(() => promptOf(captured(CONTEXT), captured("no slot here"))).toThrow(
      /Match context/,
    );
  });
});
