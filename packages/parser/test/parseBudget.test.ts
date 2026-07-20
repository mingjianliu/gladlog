// 预算常量跨包相对引入:budgets.ts 刻意零 import,是三个预算的单源。
// 走包名会让 parser 依赖 desktop(反向依赖),故用相对路径。
import { BUDGET_MS, reportBudget } from "../../desktop/qa/budgets";
import { GladLogParser } from "../src/api";
import { synthArenaLog } from "../src/testing/synthLog";

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
    // 在 test 体内生成:放模块顶层的话,即便这条测试被 --grep 过滤掉,
    // 每个跑 npm test 的人都要白付这几十 MB 的生成开销。
    const bigLog = synthArenaLog({ eventsPerRound: 200_000 });
    const runs = [1, 2, 3].map(() => parseOnce(bigLog)).sort((a, b) => a - b);
    const median = runs[1]!;
    reportBudget("parse", median, runs.length);
    if (BUDGET_MS.parse !== null) {
      expect(median).toBeLessThan(BUDGET_MS.parse);
    }
  }, 120_000);
});
