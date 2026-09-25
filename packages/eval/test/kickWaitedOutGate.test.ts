/**
 * `checkKickWaitedOutConsistency` — a kick-eaten line may only say "waited out
 * the lockout (first cast Xs later)" when X ≥ its own `lockout` fact
 * (reliability audit A1, 2026-09-24; e9ea8a0c @363 printed 1.3 s against a
 * 2.0 s lockout).
 */
import { describe, expect, it } from "vitest";

import { checkKickWaitedOutConsistency } from "../src/quality/promptQualityCheck";

const menuLine = (lockout: string, postKick: string) =>
  `  - id=kick-eaten:P1:363 type=kick-eaten t=362.8s units=Me/Sham facts={t=362.8, interrupted=Tranquility, kick=Wind Shear, source=Sham, lockout=${lockout}, postKick=${postKick}}`;

describe("checkKickWaitedOutConsistency", () => {
  it("flags 'waited out' with a first cast before the lockout ended (the e9ea8a0c @363 line)", () => {
    const f = checkKickWaitedOutConsistency([
      menuLine("2.0", "waited out the lockout (first cast 1.3s later)"),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("1.3");
  });

  it("passes a first cast at or after the lockout end", () => {
    expect(
      checkKickWaitedOutConsistency([
        menuLine("2.0", "waited out the lockout (first cast 2.0s later)"),
        menuLine("4.0", "waited out the lockout (first cast 4.1s later)"),
      ]),
    ).toEqual([]);
  });

  it("ignores the other postKick shapes and other candidate types", () => {
    expect(
      checkKickWaitedOutConsistency([
        menuLine("2.0", "first cast 1.3s later"),
        menuLine(
          "2.0",
          "pressed 1x but rejected (Hammer of Justice) inside the lockout; first successful cast 3.2s later",
        ),
        menuLine("5.0", "no cast for 5s after the kick"),
        "  - id=cd-hoarded:x type=cd-hoarded t=1s facts={t=1, postKick=waited out the lockout (first cast 0.1s later), lockout=9}",
      ]),
    ).toEqual([]);
  });
});
