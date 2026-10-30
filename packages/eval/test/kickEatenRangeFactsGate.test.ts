/**
 * `checkKickEatenRangeFacts` — the range and distance facts of a kick-eaten
 * row (re-eval 2026-10-08, F07): no table placeholder printed as a range, a
 * distance either measured or marked approximate, a landing distance only
 * beyond the table range, and `outRangeable=yes` only on measured numbers
 * that support it.
 */
import { buildFindingsPrompt } from "@gladlog/analysis/src/analysis/buildFindingsPrompt";
import { distanceFact } from "@gladlog/analysis/src/analysis/candidateFindings";
import { INTERP_MAX_GAP_MS } from "@gladlog/analysis/src/utils/positionSampling";
import { describe, expect, it } from "vitest";

import { checkKickEatenRangeFacts } from "../src/quality/promptQualityCheck";

const row = (facts: string) =>
  `  - id=kick-eaten:P1:167 type=kick-eaten t=166.5s units=Me/Pal facts={t=166.5, interrupted=Polymorph, kick=Rebuke, source=Pal, lockout=3.0, ${facts}, postKick=no cast for 5s after the kick}`;
const YES =
  "outRangeable=yes (kicker outside kick range; no gap-closer of theirs just used or ready)";

describe("checkKickEatenRangeFacts", () => {
  it("flags the dfcccbf2 line: a 50,000 yd table placeholder printed as the kick's range", () => {
    const f = checkKickEatenRangeFacts([
      row(
        "yourReachYd=30, kickRangeYd=50000, outRangeable=no (the spell does not reach farther than the kick), sourceDistYd=11.0",
      ),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("kickRangeYd=50000");
    // the 100 yd row is a placeholder too, on any of the three range facts
    expect(
      checkKickEatenRangeFacts([row("yourReachYd=100, kickRangeYd=5")]),
    ).toHaveLength(1);
    expect(
      checkKickEatenRangeFacts([row("kickRangeYd=5, maxKickRangeYd=100")]),
    ).toHaveLength(1);
  });

  it("passes the producer's shapes", () => {
    expect(
      checkKickEatenRangeFacts([
        row(`yourReachYd=30, kickRangeYd=5, ${YES}, sourceDistYd=22.8`),
        row(
          "yourReachYd=40, kickRangeYd=5, kickLandedFromYd=10.6, outRangeable=no (kicker already within the 10.6 yd this kick landed from at cast start), sourceDistYd=9.4, nearestKickerDistYd=9.4",
        ),
        row(
          `yourReachYd=40, kickRangeYd=5, outRangeable=no (kicker distance approximate — position samples 2.3s apart), sourceDistYd=${distanceFact(17.2, 2.3)}, nearestKickerDistYd=${distanceFact(3.1, null)}`,
        ),
        // no reach facts at all (an unknown kick range)
        row("sourceDistYd=11.0, nearestKickerDistYd=15.1, kickersInRange=0"),
      ]),
    ).toEqual([]);
  });

  it("flags a distance that is neither measured nor marked approximate, and an approximate mark over tight samples", () => {
    expect(
      checkKickEatenRangeFacts([row("kickRangeYd=5, sourceDistYd=about 17")]),
    ).toHaveLength(1);
    expect(
      checkKickEatenRangeFacts([
        row(
          `kickRangeYd=5, nearestKickerDistYd=~17 (position samples ${((INTERP_MAX_GAP_MS - 300) / 1000).toFixed(1)}s apart)`,
        ),
      ]),
    ).toHaveLength(1);
  });

  it("flags a landing distance that is not beyond the printed range, or has no range beside it", () => {
    expect(
      checkKickEatenRangeFacts([row("kickRangeYd=5, kickLandedFromYd=4.2")]),
    ).toHaveLength(1);
    expect(
      checkKickEatenRangeFacts([row("kickLandedFromYd=10.6")]),
    ).toHaveLength(1);
  });

  it("flags outRangeable=yes that its own numbers do not support", () => {
    // an approximate distance
    expect(
      checkKickEatenRangeFacts([
        row(
          `yourReachYd=30, kickRangeYd=5, ${YES}, sourceDistYd=${distanceFact(22.8, 2.3)}`,
        ),
      ]),
    ).toHaveLength(1);
    // no distance, no range
    expect(
      checkKickEatenRangeFacts([row(`kickRangeYd=5, ${YES}`)]),
    ).toHaveLength(1);
    expect(
      checkKickEatenRangeFacts([row(`${YES}, sourceDistYd=22.8`)]),
    ).toHaveLength(1);
    // inside the range plus hitbox slack
    expect(
      checkKickEatenRangeFacts([
        row(`yourReachYd=30, kickRangeYd=5, ${YES}, sourceDistYd=5.6`),
      ]),
    ).toHaveLength(1);
    // inside the distance the kick landed from
    expect(
      checkKickEatenRangeFacts([
        row(
          `yourReachYd=30, kickRangeYd=5, kickLandedFromYd=10.6, ${YES}, sourceDistYd=9.4`,
        ),
      ]),
    ).toHaveLength(1);
  });

  it("the legend explains the approximate form, the official range and the landing distance", () => {
    const legend = buildFindingsPrompt(
      [
        {
          id: "kick-eaten:P1:10",
          type: "kick-eaten",
          t: 10,
          unitNames: ["Me", "Pal"],
          facts: { t: "10" },
        },
      ],
      "",
      "Fire Mage",
    )
      .split("\n")
      .find((l) => l.startsWith('- "kick-eaten": '))!;
    expect(legend).toContain('"~N (position samples Ns apart)"');
    expect(legend).toContain("facts.kickLandedFromYd");
    expect(legend).toContain("official cast range");
  });
});
