import { readFileSync } from "fs";
import { join } from "path";

import {
  FACT_AUDIT_MAX,
  FACT_AUDIT_MIN,
} from "../src/provenance/checkScoreProvenance";

/**
 * 门规谓词即规范。PASS 1 审计集的边界写在两处:
 *   - `docs/commands/eval-baseline.md` —— 判官读的 spec
 *   - `checkScoreProvenance.ts` —— 校验判官有没有照做的门
 * 两处对不上,合规的分数会被拒、越界的分数会被放行。这里无法 import 一个
 * markdown 常量,所以按 CLAUDE.md 的备选办法:写断言相等的单测,别靠注释。
 *
 * 2026-07-20 的代价:改了 PASS 1 的审计集大小,没同步长度约定,重评 30 件写出
 * 的条数 3~12 都有。
 */
const RUBRIC = readFileSync(
  join(__dirname, "../../../docs/commands/eval-baseline.md"),
  "utf8",
);

describe("factAudit bounds stay in sync with the rubric doc", () => {
  it("the documented legal length equals the validator's bounds", () => {
    const m = RUBRIC.match(/合法长度\s*(\d+)[–-](\d+)/);
    expect(m, "rubric no longer states 合法长度 N–M").not.toBeNull();
    expect(Number(m![1])).toBe(FACT_AUDIT_MIN);
    expect(Number(m![2])).toBe(FACT_AUDIT_MAX);
  });

  it("the documented audit-set cap equals FACT_AUDIT_MAX", () => {
    const m = RUBRIC.match(/\*\*上限\s*(\d+)\s*条\*\*/);
    expect(m, "rubric no longer states **上限 N 条**").not.toBeNull();
    expect(Number(m![1])).toBe(FACT_AUDIT_MAX);
  });

  it("the over-cap split takes both ends and sums to the cap", () => {
    // 超限规则必须是两端各取一半 —— 前缀截断会让回复末尾成为盲区,那正是
    // 2026-07-21 漏掉两个植入捏造的原因。
    const m = RUBRIC.match(/前\s*(\d+)\s*条\s*\+\s*末\s*(\d+)\s*条/);
    expect(m, "rubric no longer states 前 N 条 + 末 M 条").not.toBeNull();
    const head = Number(m![1]);
    const tail = Number(m![2]);
    expect(head + tail).toBe(FACT_AUDIT_MAX);
    expect(head).toBe(tail);
  });
});
