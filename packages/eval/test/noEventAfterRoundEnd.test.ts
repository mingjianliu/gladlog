/**
 * A1 (user 2026-10-24): no timeline line after the round's end as the
 * prompt states it — `[MATCH END]` and a later death's own block aside.
 */
import { describe, expect, it } from "vitest";

import { checkNoEventAfterRoundEnd } from "../src/quality/promptQualityCheck";

const SS = "Spec: Restoration Shaman (Healer)  |  Bracket: Rated Solo Shuffle  |  Result: Loss";
const THREES = "Spec: Restoration Shaman (Healer)  |  Bracket: Rated Arena 3v3  |  Result: Loss";

describe("checkNoEventAfterRoundEnd", () => {
  it("a Solo Shuffle press after the first [DEATH] fails", () => {
    const lines = [
      SS,
      "1:45  [DEATH]  2(ArWarrior) (Arms Warrior — friendly)",
      "1:46  [YOU] [CD]   Astral Shift",
      "1:47  [MATCH END]   damp: 10%",
    ];
    expect(checkNoEventAfterRoundEnd(lines)).toHaveLength(1);
  });
  it("the same press in the round's last second, a later death's block and [MATCH END] pass", () => {
    const lines = [
      SS,
      "1:45  [DEATH]  2(ArWarrior) (Arms Warrior — friendly)",
      "1:45  [YOU] [CD]   Astral Shift",
      "1:46  [DEATH]  5(FMage) (Frost Mage — enemy)",
      "1:46  [ROSTER]  enemy 5(FMage) removed (dead)",
      "1:47  [MATCH END]   damp: 10%",
    ];
    expect(checkNoEventAfterRoundEnd(lines)).toEqual([]);
  });
  it("outside Solo Shuffle the round ends at [MATCH END]", () => {
    const lines = [
      THREES,
      "1:45  [DEATH]  2(ArWarrior) (Arms Warrior — friendly)",
      "1:46  [YOU] [CD]   Astral Shift",
      "1:47  [MATCH END]   damp: 10%",
    ];
    expect(checkNoEventAfterRoundEnd(lines)).toEqual([]);
  });
});
