// 预算常量跨包相对引入:budgets.ts 刻意零 import,是三个预算的单源。
// 走包名会让 parser 依赖 desktop(反向依赖),故用相对路径。
import { BUDGET_MS, reportBudget } from "../../desktop/qa/budgets";
import { GladLogParser } from "../src/api";
import { synthArenaLog } from "../src/testing/synthLog";

/** 大号载荷:约 20 万行,贴近一晚上的真实战斗日志量级。 */
const BIG_LOG = synthArenaLog({ eventsPerRound: 200_000 });

function parseOnce(text: string): number {
  const t0 = performance.now();
  const p = new GladLogParser({ timezone: "UTC" });
  let matches = 0;
  p.on("match", () => matches++);
  for (const line of text.split("\n")) if (line.trim()) p.push(line);
  p.end();
  if (matches !== 1) throw new Error(`期望 1 场,实得 ${matches}`);
  return performance.now() - t0;
}

describe("解析速度预算", () => {
  it("大日志解析耗时在预算内(未锁定时只测量)", () => {
    const runs = [1, 2, 3].map(() => parseOnce(BIG_LOG)).sort((a, b) => a - b);
    const median = runs[1]!;
    reportBudget("parse", median, runs.length);
    if (BUDGET_MS.parse !== null) {
      expect(median).toBeLessThan(BUDGET_MS.parse);
    }
  }, 120_000);
});
