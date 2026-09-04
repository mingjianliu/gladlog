/** Table health + lookup semantics for the `[CD PRIOR]` reference. Shape
 * checks run on whatever the generated json holds (placeholder included);
 * the health assertions tighten themselves once the first emit-table lands. */
import { describe, expect, it } from "vitest";

import { BEHAVIOR_PRIOR_N_FLOOR } from "./behaviorPrior";
import {
  CD_TRIGGER_PRIOR_META,
  CD_TRIGGER_PRIOR_N_FLOOR,
  cdTriggerPriorKey,
  lookupCdTriggerPrior,
} from "./cdTriggerPrior";
import raw from "./cdTriggerPriorGenerated.json";

const CELLS = (raw as any).cells as Record<string, { n: number; medianHpPct: number }>;

describe("cdTriggerPrior table", () => {
  it("the n floor is the shared one, not a second number", () => {
    expect(CD_TRIGGER_PRIOR_N_FLOOR).toBe(BEHAVIOR_PRIOR_N_FLOOR);
  });

  it("every cell is well formed: 3-part key, integer median in (0,100], n ≥ 1; meta records the cohort", () => {
    for (const [k, c] of Object.entries(CELLS)) {
      expect(k.split("|"), k).toHaveLength(3);
      expect(Number.isInteger(c.medianHpPct), k).toBe(true);
      expect(c.medianHpPct, k).toBeGreaterThan(0);
      expect(c.medianHpPct, k).toBeLessThanOrEqual(100);
      expect(c.n, k).toBeGreaterThanOrEqual(1);
    }
    expect(["all", "hi"]).toContain(CD_TRIGGER_PRIOR_META.cohort);
  });

  it("lookup: a tree cell under the floor falls back to the spec-wide cell and says so; an unresolved tree goes straight to spec-wide", () => {
    const keys = Object.keys(CELLS);
    if (keys.length === 0) return; // placeholder table — nothing to look up yet
    const treeKeys = keys.filter((k) => k.split("|")[1] !== "*");
    for (const k of treeKeys) {
      const [s, t, id] = k.split("|") as [string, string, string];
      const r = lookupCdTriggerPrior(s, t, id);
      const c = CELLS[k]!;
      if (c.n >= CD_TRIGGER_PRIOR_N_FLOOR) {
        expect(r?.cellKey, k).toBe(k);
        expect(r?.fellBack, k).toBe(false);
        expect(r?.medianHpPct, k).toBe(c.medianHpPct);
      } else if (r) {
        expect(r.cellKey, k).toBe(cdTriggerPriorKey(s, "*", id));
        expect(r.fellBack, k).toBe(true);
      }
      const star = lookupCdTriggerPrior(s, "*", id);
      if (star) expect(star.fellBack, k).toBe(false);
    }
  });

  it("table health (once emitted): the study's headline cells clear the floor — regenerate when red", () => {
    if (Object.keys(CELLS).length === 0) return; // placeholder
    // Pain Suppression spec-wide and Blessing of Sacrifice spec-wide — the two
    // largest save-CD populations in the 2026-08-23 study.
    expect(lookupCdTriggerPrior("Discipline Priest", "*", "33206")).not.toBeNull();
    expect(lookupCdTriggerPrior("Holy Paladin", "*", "6940")).not.toBeNull();
  });
});
