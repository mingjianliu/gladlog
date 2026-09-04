/** `[CD PRIOR]` renderer (2026-09-04): line content, cap by depth, emission
 * by time, the spec-wide label, and the legend's dependence on the cap. */
import { describe, expect, it } from "vitest";

import type { CdPriorHoldEpisode } from "../analysis/cdTriggerPrior";
import {
  CD_PRIOR_CAP,
  CD_PRIOR_LEGEND,
  CD_PRIOR_TAG,
  formatCdPriorLines,
} from "./cdPrior";

const ep = (over: Partial<CdPriorHoldEpisode> = {}): CdPriorHoldEpisode => ({
  spellId: "33206",
  spellName: "Pain Suppression",
  tSec: 47,
  hpAtCrossPct: 52,
  minHpPct: 44,
  minSec: 55,
  minUnitName: "Mate-Realm-US",
  minUnitIsOwner: false,
  endSec: 55,
  ownerLockedSecs: 0,
  ref: {
    cellKey: "Discipline Priest|Oracle|33206",
    fellBack: false,
    n: 1913,
    medianHpPct: 54,
  },
  ...over,
});
const cohort = { spec: "Discipline Priest", heroTree: "Oracle" };

describe("formatCdPriorLines", () => {
  it("renders the cohort, both numbers, both times, and the machine-readable ref", () => {
    const [e] = formatCdPriorLines([ep()], cohort);
    expect(e!.atSeconds).toBe(47);
    expect(e!.line).toBe(
      `${CD_PRIOR_TAG}   Discipline Priest · Oracle cohort spends Pain Suppression at a median lowest-friendly HP of 54% (n=1913); Mate-Realm-US fell below that at 0:47 (52%) and bottomed at 44% by 0:55 with Pain Suppression ready and unspent — context, not a mistake [ref=Discipline Priest|Oracle|33206]`,
    );
  });

  it("a fallen-back reference is labelled spec-wide; the owner's own dip says (you)", () => {
    const [e] = formatCdPriorLines(
      [
        ep({
          minUnitIsOwner: true,
          minUnitName: "Me-Realm-US",
          ref: { cellKey: "Discipline Priest|*|33206", fellBack: true, n: 2200, medianHpPct: 50 },
        }),
      ],
      cohort,
    );
    expect(e!.line).toContain("Discipline Priest (spec-wide) cohort");
    expect(e!.line).toContain("Me-Realm-US (you) fell below");
    expect(e!.line).toContain("[ref=Discipline Priest|*|33206]");
  });

  it("locked seconds inside the dip are said out loud", () => {
    const [e] = formatCdPriorLines([ep({ ownerLockedSecs: 3 })], cohort);
    expect(e!.line).toContain("ready and unspent (you could not cast for 3s of that dip) — context");
  });

  it("caps by depth of the dip, then emits in time order", () => {
    const out = formatCdPriorLines(
      [ep({ tSec: 10, minHpPct: 50 }), ep({ tSec: 30, minHpPct: 42 }), ep({ tSec: 20, minHpPct: 46 })],
      cohort,
    );
    expect(CD_PRIOR_CAP).toBe(2);
    expect(out.map((e) => e.atSeconds)).toEqual([20, 30]);
  });

  it("the legend names the cap and the crisis partition", () => {
    expect(CD_PRIOR_LEGEND.join("\n")).toContain(`At most ${CD_PRIOR_CAP} per round`);
    expect(CD_PRIOR_LEGEND.join("\n")).toContain("40%");
  });
});
