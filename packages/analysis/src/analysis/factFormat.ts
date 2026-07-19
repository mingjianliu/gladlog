/**
 * facts 数值渲染(单源)。
 *
 * 候选事件与深挖证据包的 `facts` 都是**占位符的取值**:模型写 `{{p1.t}}`,
 * claimChecker 拿这里的输出去比对、interpolate 拿它去替换。所以两侧必须逐字符
 * 相同 —— 曾在 candidateFindings.ts 与 deepDive.ts 各写一份一模一样的实现,
 * 改一处必漏一处(CLAUDE.md:谓词放一处 export,两边 import)。
 *
 * 注意这**不是** `fmtTime`。两者渲染的是同一个物理量(比赛内秒数)却不同形态:
 *  - `fmtFactNum(83.5)` → `"83.5"`,进 facts / finding 与深挖正文;
 *  - `fmtTime(83.5)`    → `"1:23"`,进 timeline / burst ledger 等上下文块。
 * 同一份报告里因此存在两套刻度,是已知的表层不一致(周度复核 P2#7)。要不要
 * 统一属产品决策 —— 会改 prompt 文本、需要跑一轮 eval,别顺手改。
 */
export const fmtFactNum = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);
