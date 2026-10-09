/**
 * FT-T08 step 3: a [BUFF FADED] line states the end cause the log itself
 * gives — a dispel / steal with who and what, the holder's death, an absorb
 * running out — and keeps "ended early" for what is left.
 */
import { describe, expect, it } from "vitest";

import type { ICDExpiryEvent } from "../src/context/timelineHelpers";
import { emitBuffFadedEntries } from "../src/context/timelineSections/buffFaded";

const base: ICDExpiryEvent = {
  spellId: "11426",
  spellName: "Ice Barrier",
  castAtSeconds: 10,
  expiresAtSeconds: 13.2,
  isEstimated: false,
  cause: "expired",
};

function render(events: ICDExpiryEvent[]): string[] {
  const out: string[] = [];
  emitBuffFadedEntries({
    cdExpiryEvents: events,
    addEntry: (_t: number, ...lines: unknown[]) => {
      out.push(...(lines as string[]));
      return true;
    },
    actorLabel: (name: string, side: "friendly" | "enemy") =>
      `${side === "enemy" ? "4" : "1"}(${name})`,
  } as never);
  return out;
}

describe("[BUFF FADED] end causes (FT-T08)", () => {
  it("dispelled / stolen name who and what, with what the absorb took", () => {
    expect(
      render([
        {
          ...base,
          cause: "dispelled",
          endedBy: {
            unitId: "e1",
            unitName: "RShaman",
            spellName: "Greater Purge",
          },
          absorb: { absorbed: 16_233, left: 155_165 },
        },
        {
          ...base,
          cause: "stolen",
          endedBy: { unitId: "e2", unitName: "FMage", spellName: "Spellsteal" },
        },
      ]),
    ).toEqual([
      "0:13  [BUFF FADED]   Ice Barrier (dispelled by 4(RShaman)'s Greater Purge; 16k absorbed, 155k left)",
      "0:13  [BUFF FADED]   Ice Barrier (stolen by 4(FMage)'s Spellsteal)",
    ]);
  });

  it("its target died / used up / expired with a part absorbed / ended early", () => {
    expect(
      render([
        { ...base, cause: "target_death" },
        {
          ...base,
          cause: "absorbed",
          absorb: { absorbed: 247_413, left: 0 },
        },
        { ...base, absorb: { absorbed: 73_610, left: 136_990 } },
        { ...base, cause: "ended_early" },
        {
          ...base,
          cause: "ended_early",
          absorb: { absorbed: 60_000 },
        },
        base,
        { ...base, isEstimated: true },
        // a dispel line the log cannot tie to this copy: neither "expired" nor "no dispel logged"
        { ...base, dispelUnclear: true },
        { ...base, cause: "ended_early", dispelUnclear: true },
      ]).map((l) => l.replace("0:13  [BUFF FADED]   Ice Barrier", "").trim()),
    ).toEqual([
      "(its target died)",
      "(used up — absorbed 247k)",
      "(expired; 74k absorbed, 137k left)",
      "(ended early — no dispel logged)",
      "(ended early — 60k absorbed; no dispel logged)",
      "(expired)",
      "(expired, estimated)",
      "(a dispel of this spell is logged at that moment — not which copy it took)",
      "(a dispel of this spell is logged at that moment — not which copy it took)",
    ]);
  });
});
