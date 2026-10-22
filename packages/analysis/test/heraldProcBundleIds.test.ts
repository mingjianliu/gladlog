/**
 * HERALD_PROC_BUNDLE_IDS (hiddenPress.ts; corpusFactScan imports it, so a
 * wrong entry would hide from the scan — round1+2, 2026-10-22): pinned to
 * the official data. DB2 has no trigger row for either (the proc is a
 * server script); their descriptions link them to Herald of the Sun —
 * 445206 `$@spelldesc445200` (Blessing of An'she, the hero talent),
 * 1241410 `$@spelldesc1241288`. Here: each id's official name, and that the
 * corpus still logs it (a renumbered id would read 0 — Curated-List rule's
 * reverse check).
 */
import { describe, expect, it } from "vitest";

import observed from "../src/data/observedSpellIdsGenerated.json";
import { spellEffectData } from "../src/data/spellEffectData";
import { HERALD_PROC_BUNDLE_IDS } from "../src/utils/hiddenPress";

describe("HERALD_PROC_BUNDLE_IDS", () => {
  it("is exactly Blessing of An'she 445206 and Hammer of Wrath 1241410, by their official names", () => {
    expect([...HERALD_PROC_BUNDLE_IDS].sort()).toEqual(["1241410", "445206"]);
    expect(spellEffectData["445206"]?.name).toBe("Blessing of An'she");
    expect(spellEffectData["1241410"]?.name).toBe("Hammer of Wrath");
  });
  it("both ids are still logged by the corpus", () => {
    const seen = new Set((observed as Array<string | number>).map(String));
    for (const id of HERALD_PROC_BUNDLE_IDS) expect(seen.has(id), id).toBe(true);
  });
});
