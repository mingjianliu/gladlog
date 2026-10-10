/** 第八类 hardFailure:DMG SPIKE CC 掩护标注 ↔ [CC ON TEAM] 交叉校验。 */
import { describe, expect, it } from "vitest";

import { checkDmgSpikeCcCoverConsistency } from "../src/quality/promptQualityCheck";

const CC_LINE =
  "0:18  [CC ON TEAM]   2(AWarrior) ← Kidney Shot (by 4(ORogue)) (5.0s)";
const SPIKE =
  "0:10–0:20  [DMG SPIKE]   2(AWarrior) (Arms Warrior): 0.50M in 10s | enemy CC in window: Kidney Shot→the target@0:18 (5.0s)";

describe("checkDmgSpikeCcCoverConsistency", () => {
  it("标注能在 [CC ON TEAM] 找到对应 → 通过", () => {
    expect(checkDmgSpikeCcCoverConsistency([CC_LINE, SPIKE])).toEqual([]);
  });
  it("标注引用了不存在的 CC → 红", () => {
    const fails = checkDmgSpikeCcCoverConsistency([SPIKE]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("Kidney Shot@0:18");
  });
  it("FT-T16: 同一秒的 [CC ON TEAM] 行只在 `pressed during it:` 子句里提到这个技能 → 不算对应,照红", () => {
    // the clause names the owner's own refused cooldowns, not the control on the line
    const fails = checkDmgSpikeCcCoverConsistency([
      "0:18  [CC ON TEAM]   1(ORogue) ← Rake (by 4(FDruid)) | 6s [DR: Stun Full] | pressed during it: Kidney Shot ×3",
      SPIKE,
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("Kidney Shot@0:18");
  });
  it("no enemy CC in window 行不触发(单向门,注释已声明)", () => {
    expect(
      checkDmgSpikeCcCoverConsistency([
        "0:10–0:20  [DMG SPIKE]   x | no enemy CC in window",
      ]),
    ).toEqual([]);
  });
});
