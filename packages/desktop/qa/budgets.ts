/** 性能预算(measure-then-lock)。
 *
 *  策略:先只测量、不断言 —— 每次运行都打印 `[budget] name=…ms`;
 *  攒到真实 CI 数字后取 p95 × 1.5 写进本文件,此后越线即红。
 *  null = 尚未锁定。放宽任何一个值都要把理由写进 commit message。
 *
 *  三处消费:parse      → packages/parser/test/parseBudget.test.ts
 *           firstPaint → packages/desktop/qa/visual/firstPaint.spec.ts
 *           coldStart  → packages/desktop/qa/e2e/import.spec.ts
 *
 *  为什么三个预算放一处:它们是同一套策略下的同一族常量,谓词单源 ——
 *  分散到各自包里,改策略时必然漏掉一个。本文件刻意零 import,
 *  好让 parser 的测试进程也能直接吃(见该测试的相对路径导入)。
 */
export const BUDGET_MS: {
  parse: number | null;
  firstPaint: number | null;
  coldStart: number | null;
} = {
  // 锁定依据:2026-07-19 在 ubuntu-latest 上跑的 4 次 CI 采样,取最大值 × 1.5
  // 后向上取整。(计划写的是 5 次取 p95;n=4 时最大值即 p95 的保守近似,
  // ×1.5 的余量本来就是为 runner 波动留的。)
  //   parse:      3287 / 2993 / 3352 / 3159  → max 3352  × 1.5 → 5100
  //   firstPaint: 24961 / 22180 / 26977 / 21906 → max 26977 × 1.5 → 41000
  //   coldStart:  22467 / 19049 / 23976 / 18743 → max 23976 × 1.5 → 36000
  //
  // 这三条抓的是**数量级回退**(例如意外的 O(n²)),不是 5% 抖动。
  // 放宽任何一个值都要把理由写进 commit message。
  //
  // firstPaint/coldStart 现在锁在 20 秒量级,是因为应用首屏确实要那么久 ——
  // spellEffectData.ts 顶层 `await import("./spellNames.json")`(12MB)阻塞
  // 整个模块图求值。这两个数字是**现状的诚实刻度**,不是可接受的目标;
  // 那笔成本一旦惰性化,这里要跟着往下压。
  parse: 5100,
  firstPaint: 41000,
  coldStart: 36000,
};

/** 统一的测量输出格式 —— CI 日志就是锁定预算时的数据源。 */
export function reportBudget(name: string, ms: number, samples: number): void {
  // eslint-disable-next-line no-console
  console.log(`[budget] ${name}=${ms.toFixed(0)}ms n=${samples}`);
}
