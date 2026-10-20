import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  INTERP_MAX_GAP_MS,
  LOS_SWEEP_GAP_MS,
  LOS_SWEEP_SLACK_S,
} from "./positionSampling";

/**
 * Enforcement test for "gate predicates are the spec" (CLAUDE.md).
 *
 * With a single-source export, "assert both sides are equal" is a tautology (it
 * is the same binding) and worth nothing. The regression actually worth guarding
 * is **someone writing the literal back in** — that is exactly how these drifted
 * historically: four files each declaring `const POSITION_MAX_GAP_MS = 1_500 /
 * 3_000`, coupled by a comment, same name and different meaning. So this scans
 * the source and forbids consumers from re-declaring the literals.
 */
describe("位置采样谓词单源(周度复核 P2#6)", () => {
  // Pin the values themselves too: a change must be deliberate (it goes red
  // rather than drifting silently)
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
    // Private re-declarations shaped like `const XXX_GAP_MS = 1_500;` / `= 3000;`
    const relit = [
      ...src.matchAll(
        /const\s+\w*(?:GAP_MS|SLACK_S|SLACK_SECONDS)\s*=\s*[\d_]+\s*;/g,
      ),
    ].map((m) => m[0]);
    expect(relit).toEqual([]);
  });
});
