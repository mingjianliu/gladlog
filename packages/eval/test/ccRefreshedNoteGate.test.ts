import { formatCcRefreshed } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { describe, expect, it } from "vitest";

import {
  checkAuraEndWithinRound,
  checkCcRefreshedNote,
} from "../src/quality/promptQualityCheck";

// F06c: `refreshed at m:ss — the length printed runs across it` sits on a
// control line, in the producer's form, with every refresh second inside the
// span that line prints. Lines as the five re-rendered logs print them.
const note = (seconds: number[], drShown = true) =>
  formatCcRefreshed({ refreshedAtSeconds: seconds }, fmtTime, drShown);

describe("checkCcRefreshedNote", () => {
  it("passes the note on both control families, refresh inside the printed span", () => {
    const lines = [
      `1:13  [CC ON ENEMY]   4(HPriest) ← Terror of the Skies (by 1(DEvoker)) (4s) [DR: Stun Full]${note([75.9])}`,
      `1:50  [CC ON TEAM]   1(RDruid) ← Terror of the Skies (by 3(DEvoker)) | 4s [DR: Stun Full] | 7.9yd from caster${note([113.2])}`,
      `3:39  [CC ON TEAM]   1(EShaman) ← Terror of the Skies (by 3(DEvoker)) | 3s [DR: Stun Full] | 6.2yd from caster${note([221.9])} | trinket: ON CD (19s left; last used 1:57 on Psychic Scream)`,
      // the grid's one second: start floored, length rounded
      `1:13  [CC ON ENEMY]   4(HPriest) ← Terror of the Skies (by 1(DEvoker)) (3s) [DR: Stun Full]${note([77])}`,
      // a line with no DR printed carries the first half only
      `1:13  [CC ON ENEMY]   4(HPriest) ← Bull Rush (by 1(BMHunter)) (2s)${note([73.4], false)}`,
      `1:13  [CC ON ENEMY]   4(HPriest) ← Terror of the Skies (by 1(DEvoker)) (4s) [DR: Stun Full]${note([75.9])} | ended at their death`,
    ];
    expect(checkCcRefreshedNote(lines)).toEqual([]);
    // … and the round-end gate still reads those lines' lengths
    expect(
      checkAuraEndWithinRound([...lines, "4:00  [MATCH END]   damp: 40%"]),
    ).toEqual([]);
  });

  it("fails a refresh second outside the span the line prints", () => {
    const fails = checkCcRefreshedNote([
      `1:13  [CC ON ENEMY]   4(HPriest) ← Terror of the Skies (by 1(DEvoker)) (4s) [DR: Stun Full]${note([79])}`,
      `1:13  [CC ON ENEMY]   4(HPriest) ← Terror of the Skies (by 1(DEvoker)) (4s) [DR: Stun Full]${note([70])}`,
      `1:50  [CC ON TEAM]   1(RDruid) ← Terror of the Skies (by 3(DEvoker)) | 2s [DR: Stun Full]${note([111, 114])}`,
    ]);
    expect(fails).toHaveLength(3);
    expect(fails[0]).toContain("刷新时刻 1:19 晚于该行印出的区间(起点 + 4s)");
    expect(fails[1]).toContain("刷新时刻 1:10 早于该行的起点");
    expect(fails[2]).toContain("刷新时刻 1:54 晚于该行印出的区间(起点 + 2s)");
  });

  it("fails the note in any other form, or on any other line family", () => {
    const fails = checkCcRefreshedNote([
      "1:13  [CC ON ENEMY]   4(HPriest) ← Terror of the Skies (by 1(DEvoker)) (4s) [DR: Stun Full] | refreshed at 1:15 [DR: Stun 50%]",
      `1:13  [SILENCE]   4(HPriest) ← Silence (by 1(SPriest)) | 4s${note([75], false)}`,
    ]);
    expect(fails).toHaveLength(2);
    expect(fails[0]).toContain("格式不符");
    expect(fails[1]).toContain("不在 [CC ON TEAM] / [CC ON ENEMY] 行上");
  });

  it("a trinket-broken control states its time in the break note: the refresh is held to that", () => {
    const line = (at: number) =>
      `1:50  [CC ON TEAM]   1(RDruid) ← Terror of the Skies (by 3(DEvoker)) [DR: Stun Full]${note([at])} | trinket broke this CC after 3s (cut short — it had not expired)`;
    expect(checkCcRefreshedNote([line(112)])).toEqual([]);
    expect(checkCcRefreshedNote([line(116)])).toHaveLength(1);
  });
});
