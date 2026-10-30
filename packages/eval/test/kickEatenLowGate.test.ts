/**
 * checkKickEatenLowInsideLockout (work order 2026-10-14b Part 2, user
 * 2026-10-14): a kick-eaten row's ourLowT / theirLowT sit in the seconds its
 * lockout is printed on — floor(t) to floor(t + lockout). On the 605-file
 * capture before the producer fix: 166 rows outside; after: 0.
 */
import { describe, expect, it } from "vitest";

import { checkKickEatenLowInsideLockout } from "../src/quality/promptQualityCheck";

const row = (facts: string) =>
  `  - id=kick-eaten:P1:15 type=kick-eaten t=15.4s units=Me/Sham facts={${facts}}`;

describe("checkKickEatenLowInsideLockout", () => {
  it("a low at the lockout's last printed second passes", () => {
    expect(
      checkKickEatenLowInsideLockout([
        row("t=15.4, lockout=3.0, ourLowUnit=Me, ourLowPct=30, ourLowT=18"),
      ]),
    ).toEqual([]);
  });
  it("a low one second past it fails, on either side", () => {
    const out = checkKickEatenLowInsideLockout([
      row("t=15.4, lockout=3.0, theirLowUnit=X, theirLowPct=37, theirLowT=19"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("theirLowT=19");
  });
  it("a row with no low facts says nothing", () => {
    expect(
      checkKickEatenLowInsideLockout([row("t=15.4, lockout=3.0")]),
    ).toEqual([]);
  });
});
