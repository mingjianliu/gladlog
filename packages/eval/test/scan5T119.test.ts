/**
 * scan5 `minorPartStampedEarly` (T119, codex 85-tk-L-T119-1): a part's
 * removals are the fold's events carrying the part's own tag — a passive and
 * a side-effect part of one spell are two parts.
 */
import type { IDispelEvent } from "@gladlog/analysis/src/utils/dispelAnalysis";
import { describe, expect, it } from "vitest";

import { checkMinorParts } from "../scripts/scan5/t119";

const e = (t: number, over: Partial<IDispelEvent>): IDispelEvent =>
  ({
    timeSeconds: t,
    sourceName: "Druid",
    dispelSpellName: "Incarnation: Tree of Life",
    removedSpellId: "9990001",
    removedSpellName: "Chilled",
    priority: "Low",
    dispelKind: "rider",
    ...over,
  }) as IDispelEvent;

// the side effect at 0:22 and 2:06, the passive removal at 1:00
const EVENTS = [
  e(22, { riderOfOwnCast: true }),
  e(126, { riderOfOwnCast: true }),
  e(60, {}),
];

function kinds(lines: string[]): string[] {
  const out: string[] = [];
  checkMinorParts(
    {
      lines,
      start: 0,
      unitOfPid: (pid?: string) =>
        pid === "2" ? ({ id: "D", name: "Druid" } as never) : undefined,
      bump: () => {},
      violate: (_c: string, kind: string) => out.push(kind),
    } as never,
    EVENTS,
  );
  return out.sort();
}

describe("scan5 minorPartStampedEarly", () => {
  // codex 85-tk-L-T119-1c P3: without the fold's own High / Critical skip,
  // the High 0:10 removal would read as the part's first and hide that the
  // Low 1:00 one is stamped 0:22
  it("a High proc the fold leaves out is not the part's removal", () => {
    const out: string[] = [];
    checkMinorParts(
      {
        lines: [
          "0:22  [MINOR DISPELS]   2(Druid): Cleanse the Weak (passive) (low-priority, folded)",
        ],
        start: 0,
        unitOfPid: () => ({ id: "D", name: "Druid" }) as never,
        bump: () => {},
        violate: (_c: string, kind: string) => out.push(kind),
      } as never,
      [
        e(10, {
          dispelSpellName: "Cleanse the Weak",
          dispelKind: "proc",
          priority: "High",
        }),
        e(60, { dispelSpellName: "Cleanse the Weak", dispelKind: "proc" }),
      ],
    );
    expect(out).toEqual(["firstLater"]);
  });

  it("a passive part folded at its side-effect twin's 0:22 is stamped early", () => {
    expect(
      kinds([
        "0:22  [MINOR DISPELS]   2(Druid): Incarnation: Tree of Life (side effect of the cast) x2, Incarnation: Tree of Life (passive) (low-priority, folded)",
      ]),
    ).toEqual(["firstLater", "foldedLater"]);
  });

  it("each part on its own line at its own first removal is clean (the fold's xN stays out of the total)", () => {
    expect(
      kinds([
        "0:22  [MINOR DISPELS]   2(Druid): Incarnation: Tree of Life (side effect of the cast) x2 (low-priority, folded)",
        "1:00  [MINOR DISPELS]   2(Druid): Incarnation: Tree of Life (passive) (low-priority, folded)",
      ]),
    ).toEqual(["foldedLater"]);
  });
});
