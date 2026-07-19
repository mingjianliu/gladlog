import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

import {
  INTERP_MAX_GAP_MS,
  LOS_SWEEP_GAP_MS,
  LOS_SWEEP_SLACK_S,
} from "./positionSampling";

/**
 * 门规谓词即规范(CLAUDE.md)的执行测试。
 *
 * 单源 export 之后,「断言两边相等」已是同义反复(同一个 binding),没有价值。
 * 真正要防的回归是**有人把字面量写回去** —— 历史上正是这样漂起来的:四个文件
 * 各自 `const POSITION_MAX_GAP_MS = 1_500 / 3_000`,靠一句注释耦合,同名不同义。
 * 所以这里扫源码,禁止消费方重新声明字面量。
 */
describe("位置采样谓词单源(周度复核 P2#6)", () => {
  // 值本身也钉住:改动必须是有意识的(会红,而不是悄悄漂)
  it("常量值锁定", () => {
    expect(LOS_SWEEP_SLACK_S).toBe(2);
    expect(LOS_SWEEP_GAP_MS).toBe(3_000);
    expect(INTERP_MAX_GAP_MS).toBe(1_500);
  });

  it("两个 gap 语义不同,不得相等 —— 相等即说明有人把 LoS 扫描窗当成插值守卫", () => {
    expect(INTERP_MAX_GAP_MS).not.toBe(LOS_SWEEP_GAP_MS);
  });

  const consumers = [
    "src/utils/healerExposureAnalysis.ts",
    "src/utils/positionAnalysis.ts",
    "src/utils/ccTrinketAnalysis.ts",
  ];

  it.each(consumers)("%s 不得把采样常量重新声明成字面量", (rel) => {
    const src = readFileSync(join(__dirname, "..", "..", rel), "utf-8");
    // 形如 `const XXX_GAP_MS = 1_500;` / `= 3000;` 的私有再声明
    const relit = [
      ...src.matchAll(
        /const\s+\w*(?:GAP_MS|SLACK_S|SLACK_SECONDS)\s*=\s*[\d_]+\s*;/g,
      ),
    ].map((m) => m[0]);
    expect(relit).toEqual([]);
  });
});
