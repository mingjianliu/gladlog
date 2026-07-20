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
  // 锁定依据:2026-07-19 在 ubuntu-latest 上跑的 3 次 CI 采样,取最大值 × 1.5
  // 后向上取整。×1.5 的余量是为 runner 波动留的。
  //   parse:      2742 / 3266 / 3174 → max 3266 × 1.5 → 4900
  //   firstPaint: 2190 / 2138 / 2119 → max 2190 × 1.5 → 3300
  //   coldStart:  1616 / 1717 / 1590 → max 1717 × 1.5 → 2600
  //
  // 这三条抓的是**数量级回退**(例如意外的 O(n²),或者又有人往模块顶层
  // 塞一份需要 V8 当源码解析的大数据),不是 5% 抖动。放宽任何一个值都要
  // 把理由写进 commit message。
  //
  // 历史:2026-07-19 早些时候这三个数分别锁在 5100 / 41000 / 36000 ——
  // 那时 spellNames.json 被编译成 41 万个键的 JS 对象字面量,光首屏就要
  // 22 秒。打开 Vite 的 json.stringify 之后首渲与冷启动各快了一个数量级,
  // 预算随之收紧。**这就是预算该有的样子:跟着真实性能走,而不是反过来。**
  parse: 4900,
  firstPaint: 3300,
  coldStart: 2600,
};

/** 统一的测量输出格式 —— CI 日志就是锁定预算时的数据源。 */
export function reportBudget(name: string, ms: number, samples: number): void {
  // eslint-disable-next-line no-console
  console.log(`[budget] ${name}=${ms.toFixed(0)}ms n=${samples}`);
}
