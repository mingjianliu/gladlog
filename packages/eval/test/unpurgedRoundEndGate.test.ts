import {
  UNPURGED_FOR_RE_SRC,
  unpurgedForText,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { SOLO_SHUFFLE_BRACKET } from "@gladlog/analysis/src/utils/roundEnd";
import { describe, expect, it } from "vitest";

import { checkUnpurgedWithinRound } from "../src/quality/promptQualityCheck";

// User instruction 2026-10-11: a missed-purge window ends at the round's end
// (`roundEndMs`), so no `unpurged for Ns` runs past it. The gate reads the
// round's end off the prompt (`[MATCH END]`, and a Solo Shuffle round's first
// `[DEATH]` line) and the length through the producer's own pattern.
const header = (bracket: string) =>
  `  Spec: Beast Mastery Hunter  |  Bracket: ${bracket}  |  Result: Loss  |  Duration: 2:31  |  Map: Maldraxxus Coliseum`;
const prompt = (
  bracket: string,
  deathS: number,
  endS: number,
  ...lines: string[]
) => [
  header(bracket),
  ...lines,
  `${fmtTime(deathS)}  [DEATH]  2(RPaladin) (Retribution Paladin — friendly) | dampening: 46%`,
  `${fmtTime(endS)}  [MATCH END]   damp: 48%`,
];
/** the round of 287ee68f round 2: ending death 2:29, log end 2:31 */
const shuffle = (...lines: string[]) =>
  checkUnpurgedWithinRound(prompt(SOLO_SHUFFLE_BRACKET, 149, 151, ...lines));

describe("checkUnpurgedWithinRound", () => {
  it("passes a window that ends inside the round — up to the grid's one second past the round-end second", () => {
    expect(
      shuffle(
        "0:16  [ENEMY BUFF]   5(AWarrior): Power Infusion (purgeable; unpurged for 15s; 2 purgeable buffs on it then)",
        // the cut window of 287ee68f round 2: applied 2:22.2, the round over at 2:29.9 → 7.7 s
        "2:22  [ENEMY BUFF]   5(AWarrior): Power Infusion (purgeable; unpurged for 8s; 3 purgeable buffs on it then)",
        "2:22  [ENEMY CD]   4(DPriest) (Discipline Priest): Power Infusion (cast 2 of 2) (purgeable; unpurged for 8s; 4 purgeable buffs on it then)",
        "2:26  [MISSED PURGE OPPORTUNITY]   Blessing of Freedom active on 4(DPriest) (unpurged for 3s) | 4 purgeable buffs on it then",
      ),
    ).toEqual([]);
  });

  it("fails a length that runs past the Solo Shuffle round's ending death, on each of the three lines — s0/105-2-579 `2:22 … unpurged for 14s` under a death at 2:29", () => {
    const fails = shuffle(
      "2:22  [ENEMY BUFF]   5(AWarrior): Power Infusion (purgeable; unpurged for 14s; 3 purgeable buffs on it then)",
      "2:22  [ENEMY CD]   4(DPriest) (Discipline Priest): Power Infusion (cast 2 of 2) (purgeable; unpurged for 14s; 4 purgeable buffs on it then)",
      "2:13  [MISSED PURGE OPPORTUNITY]   Spiritwalker's Grace active on 5(EShaman) (unpurged for 19s) | 5 purgeable buffs on it then",
      // one grid second too many is enough
      "2:22  [ENEMY BUFF]   6(FMage): Alter Time (purgeable; unpurged for 9s)",
    );
    expect(fails).toHaveLength(4);
    expect(fails[0]).toContain(
      "line 2: 「unpurged for 14s」越过回合结束(起点 + 时长 = 2:36;Rated Solo Shuffle 的第一条 [DEATH] 行在 2:29)",
    );
    expect(fails[1]).toContain("line 3: 「unpurged for 14s」");
    expect(fails[2]).toContain("line 4: 「unpurged for 19s」");
    expect(fails[3]).toContain("起点 + 时长 = 2:31");
  });

  it("fails a line that starts after the round's end — the window is not in the round", () => {
    expect(
      shuffle(
        "2:30  [MISSED PURGE OPPORTUNITY]   Blessing of Freedom active on 4(DPriest) (unpurged for 3s)",
      ),
    ).toHaveLength(1);
  });

  it("another bracket ends at [MATCH END]: a first death cuts nothing, the log's end does", () => {
    const threes = (...lines: string[]) =>
      checkUnpurgedWithinRound(prompt("Rated Arena 3v3", 149, 190, ...lines));
    expect(
      threes(
        "2:22  [ENEMY BUFF]   5(AWarrior): Power Infusion (purgeable; unpurged for 14s; 3 purgeable buffs on it then)",
        "2:22  [MISSED PURGE OPPORTUNITY]   Spiritwalker's Grace active on 5(EShaman) (unpurged for 19s)",
      ),
    ).toEqual([]);
    expect(
      checkUnpurgedWithinRound(
        prompt(
          "Rated Arena 2v2",
          149,
          190,
          "2:55  [ENEMY CD]   4(DPriest) (Discipline Priest): Power Infusion (cast 2 of 2) (purgeable; unpurged for 15s)",
        ),
      ),
    ).toEqual([]);
    const fails = threes(
      "3:00  [ENEMY BUFF]   5(AWarrior): Power Infusion (purgeable; unpurged for 14s)",
    );
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("[MATCH END]在 3:10");
  });

  it("judges nothing on a prompt that states no round end, or a line with no second", () => {
    expect(
      checkUnpurgedWithinRound([
        header(SOLO_SHUFFLE_BRACKET),
        "2:22  [ENEMY BUFF]   5(AWarrior): Power Infusion (purgeable; unpurged for 99s)",
      ]),
    ).toEqual([]);
    expect(shuffle("  the note `unpurged for 99s` in a legend")).toEqual([]);
  });

  it("reads the producer's own text: unpurgedForText ↔ UNPURGED_FOR_RE_SRC", () => {
    const re = new RegExp(UNPURGED_FOR_RE_SRC);
    for (const [seconds, printed] of [
      [3, "3"],
      [7.675, "8"],
      [13.709, "14"],
      [26.386, "26"],
      [3.5, "4"],
    ] as const) {
      const text = unpurgedForText({ durationSeconds: seconds });
      expect(text.match(re)?.[0]).toBe(text);
      expect(text.match(re)?.[1]).toBe(printed);
    }
  });

  it("a window cut at the round's end never fails on the grid; one that runs 2.5 s past it always does", () => {
    // every tenth of a second of application × round end, through the two
    // producers' formatters (`fmtTime`, `unpurgedForText`)
    const line = (applyS: number, endS: number) =>
      `${fmtTime(applyS)}  [MISSED PURGE OPPORTUNITY]   Blessing of Freedom active on 4(DPriest) (${unpurgedForText({ durationSeconds: endS - applyS })})`;
    let cut = 0;
    let over = 0;
    for (let a = 1200; a < 1320; a += 1)
      for (let r = 1490; r < 1500; r += 1) {
        const applyS = a / 10;
        const roundEndS = r / 10;
        const at = (endS: number) =>
          checkUnpurgedWithinRound(
            prompt(
              SOLO_SHUFFLE_BRACKET,
              roundEndS,
              roundEndS + 2,
              line(applyS, endS),
            ),
          ).length;
        cut += at(roundEndS);
        over += at(roundEndS + 2.5);
      }
    expect(cut).toBe(0);
    expect(over).toBe(120 * 10);
  });
});
