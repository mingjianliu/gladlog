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
  parse: null,
  firstPaint: null,
  coldStart: null,
};

/** 统一的测量输出格式 —— CI 日志就是锁定预算时的数据源。 */
export function reportBudget(name: string, ms: number, samples: number): void {
  // eslint-disable-next-line no-console
  console.log(`[budget] ${name}=${ms.toFixed(0)}ms n=${samples}`);
}
