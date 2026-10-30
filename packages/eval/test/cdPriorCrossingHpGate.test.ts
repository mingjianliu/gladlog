/**
 * `checkCdPriorCrossingHp` (7583b54, codex 60-POSTHOC-06c #1 / 07a #2): the
 * `[CD PRIOR]` crossing "<unit> fell below that at m:ss (N%)" is that unit's
 * `[STATE]` reading at that second. The gate returns silently on a line its
 * pattern does not match, so the producer's own rendering (pid labels, the
 * `(you)` suffix) is driven through it here — a label change that stops the
 * match turns this red instead of switching the gate off (weekly review
 * 2026-10-24: the gate had no test of its own).
 */
import { formatCdPriorLines } from "@gladlog/analysis/src/context/cdPrior";
import { describe, expect, it } from "vitest";

import { checkCdPriorCrossingHp } from "../src/quality/promptQualityCheck";

const PID: Record<string, string> = { Alice: "2(DPriest)", Bob: "3(MMage)" };

function cdPriorLine(over: { unit: string; owner?: boolean; hp: number }) {
  const [entry] = formatCdPriorLines(
    [
      {
        tSec: 83,
        crossSec: 83,
        hpAtCrossPct: over.hp,
        troughHpPct: 41,
        troughSec: 87,
        minHpPct: 41,
        minUnitName: over.unit,
        minUnitIsOwner: over.owner ?? false,
        spellName: "Pain Suppression",
        readyFromSec: 0,
        ownerLockedSecs: 0,
        ref: {
          fellBack: false,
          medianHpPct: 55,
          n: 120,
          cellKey: "Discipline Priest|Oracle|33206",
        },
      } as never,
    ],
    { spec: "Discipline Priest", heroTree: "Oracle" },
    undefined,
    { friendly: (n: string) => PID[n] ?? n } as never,
  );
  return `1:23  ${entry!.line}`;
}

const state = (alice: number, bob: number) =>
  `1:23  [STATE]   friends 2(DPriest):${alice} 3(MMage):${bob} / enemies 4(MHunter):90`;

describe("checkCdPriorCrossingHp", () => {
  it("the producer's line is read: the named unit's own tick agrees → passes", () => {
    expect(
      checkCdPriorCrossingHp([
        state(52, 80),
        cdPriorLine({ unit: "Alice", hp: 52 }),
      ]),
    ).toEqual([]);
  });
  it("the crossing HP is another unit's reading → fails", () => {
    // codex 07a #2's shape: Alice named, Bob's 80 % printed
    const f = checkCdPriorCrossingHp([
      state(52, 80),
      cdPriorLine({ unit: "Alice", hp: 80 }),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("2(DPriest)");
  });
  it("the owner's `(you)` suffix is read too", () => {
    expect(
      checkCdPriorCrossingHp([
        state(30, 80),
        cdPriorLine({ unit: "Alice", owner: true, hp: 52 }),
      ]),
    ).toHaveLength(1);
  });
  it("within the HP agreement tolerance passes", () => {
    expect(
      checkCdPriorCrossingHp([
        state(52, 80),
        cdPriorLine({ unit: "Alice", hp: 54 }),
      ]),
    ).toEqual([]);
  });
  it("no [STATE] line at that second → nothing to read", () => {
    expect(
      checkCdPriorCrossingHp([cdPriorLine({ unit: "Alice", hp: 99 })]),
    ).toEqual([]);
  });
});
