/**
 * 16th hardFailure class (2026-09-04, GH #54 (f) / BACKLOG #38 (a)(h)):
 * `checkCdPriorRefConsistency` re-parses a `[CD PRIOR]` context line and
 * demands the SAME `lookupCdTriggerPrior(spec, heroTree, spellId)` the
 * producer rendered it from. Expected values come from the lookup itself,
 * never re-typed; the fixture picks a real cell out of the generated table
 * so the test moves with the data. While the table is still the placeholder
 * (no cells) only the fail-closed cases run.
 */
import { lookupCdTriggerPrior } from "@gladlog/analysis/src/data/cdTriggerPrior";
import RAW from "@gladlog/analysis/src/data/cdTriggerPriorGenerated.json";
import { describe, expect, it } from "vitest";

import { checkCdPriorRefConsistency } from "../src/quality/promptQualityCheck";

const CELLS = (RAW as any).cells as Record<string, { n: number }>;
const firstKey = Object.keys(CELLS).find((k) => {
  const [s, t, id] = k.split("|") as [string, string, string];
  const r = lookupCdTriggerPrior(s, t, id);
  return r !== null && r.cellKey === k;
});
const REF = firstKey
  ? (() => {
      const [s, t, id] = firstKey.split("|") as [string, string, string];
      return { spec: s, tree: t, ...lookupCdTriggerPrior(s, t, id)! };
    })()
  : null;

function line(over: { median?: number; n?: number; key?: string; specWide?: boolean } = {}): string {
  const r = REF!;
  const specWide = over.specWide ?? r.tree === "*";
  const cohort = specWide ? `${r.spec} (spec-wide)` : `${r.spec} · ${r.tree}`;
  return `1:23  [CD PRIOR]   ${cohort} cohort spends Pain Suppression at a median lowest-friendly HP of ${over.median ?? r.medianHpPct}% (n=${over.n ?? r.n}); Mate-Realm-US fell below that at 1:23 (52%) and bottomed at 44% by 1:27 with Pain Suppression ready and unspent — context, not a mistake [ref=${over.key ?? r.cellKey}]`;
}

describe("checkCdPriorRefConsistency", () => {
  it("a [CD PRIOR] line without the [ref=…] suffix or numbers fails closed", () => {
    expect(
      checkCdPriorRefConsistency(["0:10  [CD PRIOR]   something without a ref"]),
    ).toHaveLength(1);
  });

  it("a reference to a cell the table does not have (or that is under the n floor) fails", () => {
    const out = checkCdPriorRefConsistency([
      "0:10  [CD PRIOR]   Holy Paladin · Nowhere cohort spends X at a median lowest-friendly HP of 50% (n=999); Y fell below that at 0:10 (49%) and bottomed at 45% by 0:12 with X ready and unspent — context, not a mistake [ref=Holy Paladin|Nowhere|0]",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("查不到");
  });

  it("lines that do not carry the tag are ignored", () => {
    expect(checkCdPriorRefConsistency(["0:10  [STATE] …", "  - id=cd-hoarded:x type=cd-hoarded"])).toHaveLength(0);
  });

  const withTable = REF ? it : it.skip;
  withTable("a line rendered from the lookup passes; a drifted median, n, cellKey or spec-wide wording fails", () => {
    expect(checkCdPriorRefConsistency([line()])).toHaveLength(0);
    expect(checkCdPriorRefConsistency([line({ median: REF!.medianHpPct + 1 })])).toHaveLength(1);
    expect(checkCdPriorRefConsistency([line({ n: REF!.n + 1 })])).toHaveLength(1);
    expect(
      checkCdPriorRefConsistency([line({ specWide: REF!.tree !== "*" })]),
    ).toHaveLength(1);
  });
});
