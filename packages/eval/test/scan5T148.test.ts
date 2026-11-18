/**
 * scan5/t148 `kickEatenCancelsShort` (T148, Mac job T148-1): the check that
 * reads the PRINTED `yourCancels` of a kick-eaten row, so a capture taken
 * before the fix and one taken after it read differently.
 */
import { describe, expect, it } from "vitest";

import { kickEatenCancelsShort } from "../scripts/scan5/t148";

const row = (n: number, more = "") =>
  `  - id=kick-eaten:Player-1-0000000A:66 type=kick-eaten t=65.6s units=A/B facts={t=65.6, interrupted=Searing Glare, kick=Wind Shear, yourCancels=${n}, baitedKicks=0${more}}`;

describe("scan5/t148 kickEatenCancelsShort", () => {
  it("a row printing fewer cancels than the round holds is short by the difference", () => {
    // the capture before the fix: one rowless bar under an on-GCD press,
    // no other cancel, the row prints 0
    expect(kickEatenCancelsShort(row(0), 1)).toEqual([
      { row: row(0), printed: 0, shortBy: 1 },
    ]);
    expect(kickEatenCancelsShort(row(9), 11)[0]!.shortBy).toBe(2);
  });
  it("a row printing the round's count is not short; more is not short either", () => {
    expect(kickEatenCancelsShort(row(1), 1)[0]!.shortBy).toBe(0);
    expect(kickEatenCancelsShort(row(3), 1)[0]!.shortBy).toBe(0);
  });
  it("reads the field wherever it stands in the facts; other row types and rows without it are skipped", () => {
    const first = `  - id=kick-eaten:x:1 type=kick-eaten t=1.0s units=A/B facts={yourCancels=4}`;
    expect(kickEatenCancelsShort(first, 5)[0]!.printed).toBe(4);
    const menu = [
      `  - id=cd-hoarded:x:1 type=cd-hoarded t=1.0s units=A facts={yourCancels=0}`,
      `  - id=kick-eaten:x:2 type=kick-eaten t=2.0s units=A/B facts={t=2.0, kick=Rebuke}`,
      row(2),
    ].join("\n");
    expect(kickEatenCancelsShort(menu, 3)).toHaveLength(1);
  });
});
