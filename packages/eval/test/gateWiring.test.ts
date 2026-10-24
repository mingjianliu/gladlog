/**
 * Every exported `check*` gate of promptQualityCheck.ts is called by
 * `checkMatch` — the list the corpus quality check and the real-log suite
 * run. A gate that is written, unit-tested and never wired checks nothing:
 * f0e2294 found one that had been failing 580 prompts unseen, and the
 * weekly review of 2026-10-24 counted 44 of 299 three-week fixes as "two
 * readers of one fact disagreeing" — the class only a wired gate sees.
 * Read off the source, so a new gate that is not wired turns this red.
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import * as gates from "../src/quality/promptQualityCheck";

const SRC = readFileSync(
  new URL("../src/quality/promptQualityCheck.ts", import.meta.url).pathname,
  "utf-8",
);

/** The body of `checkMatch` (to the first top-level closing brace). */
function checkMatchBody(): string {
  const i = SRC.indexOf("export function checkMatch(");
  expect(i).toBeGreaterThan(-1);
  return SRC.slice(i, SRC.indexOf("\n}\n", i));
}

/** Exported gates that are deliberately not part of `checkMatch`, each with
 * its reason. Empty today. */
const NOT_IN_CHECK_MATCH: ReadonlyMap<string, string> = new Map();

describe("every gate is wired into checkMatch", () => {
  const exported = Object.entries(gates)
    .filter(([k, v]) => k.startsWith("check") && typeof v === "function")
    .map(([k]) => k)
    .filter((k) => k !== "checkMatch");

  it("the module exports the gates (the test reads something)", () => {
    expect(exported.length).toBeGreaterThan(90);
  });

  it("each exported check* is called in checkMatch", () => {
    const body = checkMatchBody();
    const unwired = exported.filter(
      (k) => !NOT_IN_CHECK_MATCH.has(k) && !new RegExp(`\\b${k}\\(`).test(body),
    );
    expect(unwired).toEqual([]);
  });

  it("the allowlist names only real exports", () => {
    for (const k of NOT_IN_CHECK_MATCH.keys()) expect(exported).toContain(k);
  });
});
