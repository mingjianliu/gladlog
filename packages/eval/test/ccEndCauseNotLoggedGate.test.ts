import {
  CC_END_CAUSE_NOT_LOGGED,
  CC_STILL_ON_AT_ROUND_END,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { describe, expect, it } from "vitest";

import { checkCcEndCauseNotLogged } from "../src/quality/promptQualityCheck";

// F06b / F08: `ended early — cause not logged` sits only on a control line
// that prints `<1s` and states no other end.
const NOTE = ` | ${CC_END_CAUSE_NOT_LOGGED}`;

describe("checkCcEndCauseNotLogged", () => {
  it("passes the note on a bare <1s control line of either side, and lines without it", () => {
    expect(
      checkCcEndCauseNotLogged([
        `1:20  [CC ON ENEMY]   5(AWarlock) ← Fear (by 2(AWarlock)) (<1s) [DR: Disorient Full]${NOTE}`,
        `0:18  [CC ON TEAM]   3(RShaman) ← Fear (by 5(AWarlock)) | <1s [DR: Disorient Full] | 8.4yd from caster | trinket: ON CD (94s left; last used 1:57 on Fear)${NOTE}`,
        "0:27  [CC ON ENEMY]   5(AWarlock) ← Fear (by 2(AWarlock)) (<1s) [DR: Disorient Full] | ended by their PvP trinket",
        "1:34  [CC ON ENEMY]   6(HPaladin) ← Hammer of Justice (by 2(HPaladin)) (4s) [DR: Stun Full]",
      ]),
    ).toEqual([]);
  });

  it("fails the note beside a whole-second length — a control shorter than its table length is not thereby 'ended early'", () => {
    const fails = checkCcEndCauseNotLogged([
      `1:07  [CC ON ENEMY]   5(AWarlock) ← Hex (by 2(RShaman)) (1s) [DR: Incapacitate Full]${NOTE}`,
      `0:18  [CC ON TEAM]   3(RShaman) ← Fear (by 5(AWarlock)) | 2s [DR: Disorient Full]${NOTE}`,
    ]);
    expect(fails).toHaveLength(2);
    expect(fails[0]).toContain("line 1");
    expect(fails[0]).toContain("所在的行没有印 <1s");
  });

  it("fails the note beside another end statement", () => {
    const fails = checkCcEndCauseNotLogged([
      `1:20  [CC ON ENEMY]   5(AWarlock) ← Fear (by 2(AWarlock)) (<1s) [DR: Disorient Full] | broken by 3(AMage)'s Frostbolt${NOTE}`,
      `1:20  [CC ON ENEMY]   5(AWarlock) ← Fear (by 2(AWarlock)) (${CC_STILL_ON_AT_ROUND_END}, <1s in) [DR: Disorient Full]${NOTE}`,
      `0:18  [CC ON TEAM]   3(RShaman) ← Fear (by 5(AWarlock)) | <1s [DR: Disorient Full]${NOTE} [CLEANSED]`,
      `0:18  [CC ON TEAM]   3(RShaman) ← Fear (by 5(AWarlock)) | <1s [DR: Disorient Full] | ended at their death${NOTE}`,
    ]);
    expect(fails).toHaveLength(5);
    expect(
      fails.filter((f) => f.includes("与该行另一处结束说明并存")),
    ).toHaveLength(4);
    // the round-end form prints no bare <1s either
    expect(fails.filter((f) => f.includes("没有印 <1s"))).toHaveLength(1);
  });

  it("2026-10-11: a control immunity that went up as the control came off is an end statement — in either form, alone it passes, beside the note it fails", () => {
    // 5e8b11c1 0:15 as PV373 printed it, and as the log reads
    const head =
      "0:15  [CC ON ENEMY]   6(AWarrior) ← Mighty Bash (by 2(BDruid)) (<1s) [DR: Stun Full]";
    const own = `${head} | ended by their Bladestorm`;
    const other =
      "0:40  [CC ON TEAM]   1(UDKnight) ← Kidney Shot (by 4(ARogue)) | <1s [DR: Stun Full] | ended by 3(HPaladin)'s Blessing of Protection";
    expect(checkCcEndCauseNotLogged([`${head}${NOTE}`, own, other])).toEqual(
      [],
    );
    const fails = checkCcEndCauseNotLogged([
      `${own}${NOTE}`,
      `${other}${NOTE}`,
    ]);
    expect(fails).toHaveLength(2);
    for (const f of fails) expect(f).toContain("与该行另一处结束说明并存");
  });

  it("fails the note on any other line family", () => {
    const fails = checkCcEndCauseNotLogged([
      `1:20  [SILENCE]   3(RShaman) ← Silence (by 4(SPriest)) | <1s${NOTE}`,
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("不在 [CC ON TEAM] / [CC ON ENEMY] 行上");
  });
});
