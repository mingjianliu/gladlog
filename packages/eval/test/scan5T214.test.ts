/**
 * scan5/t214 `feintPressLines` — which Feint presses the check asks a line
 * of. Batch check T214-2 on the 605: the scan stopped at the playable end
 * and read 3,618 of the 3,630 Feint lines the head prints.
 */
import { describe, expect, it } from "vitest";

import { feintPressLines } from "../scripts/scan5/t214";

const START = 1_000_000;
const line = (mss: string, s: string) =>
  `${mss}  [ENEMY DEF]   5(ARogue) (Assassination Rogue): Feint (20%, ${s})`;

describe("scan5/t214 feintPressLines", () => {
  it("a press after a 3v3's deciding death is still asked its line, as far as the timeline prints (605 s1/113 r1: death 243.758 s, press 247.977 s, `4:07`)", () => {
    const lines = [line("3:56", "6.0s"), line("4:07", "6.0s")];
    const got = feintPressLines(
      [START + 236_911, START + 247_977, START + 300_000],
      START,
      // the timeline's last line is `4:16 [MATCH END]`
      256,
      lines,
    );
    expect([...got.keys()]).toEqual([START + 236_911, START + 247_977]);
    expect(got.get(START + 247_977)!.line).toBe(lines[1]);
  });

  it("two presses of one second take that second's two lines, in order (605 line 135 r6: 135.531 s and 135.849 s)", () => {
    const lines = [line("2:15", "0.3s"), line("2:15", "6.0s")];
    const got = feintPressLines(
      [START + 135_849, START + 135_531],
      START,
      300,
      lines,
    );
    expect(got.get(START + 135_531)!.line).toBe(lines[0]);
    expect(got.get(START + 135_849)!.line).toBe(lines[1]);
  });

  it("a press with no line of its second is asked and has none; a press before the round is not asked", () => {
    const got = feintPressLines([START - 500, START + 10_200], START, 60, []);
    expect([...got.keys()]).toEqual([START + 10_200]);
    expect(got.get(START + 10_200)!.line).toBeUndefined();
  });
});
