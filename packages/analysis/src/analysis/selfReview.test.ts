import { describe, expect, it } from "vitest";

import {
  applySelfReview,
  buildSelfReviewPrompt,
  numbersIn,
} from "./selfReview";
import type { CandidateEvent, Finding } from "./types";

// AI 自查(用户 2026-10-15)。自查看的是已填数字的文本,所以不走 auditFindings 的
// 占位符门,而是同一事实的渲染后版本:每个数字都得是所引事件的 fact 值或原句里就有。

const candidates: CandidateEvent[] = [
  {
    id: "death:a:30",
    type: "death",
    t: 30,
    unitNames: ["Me-R"],
    facts: { t: "30", unit: "Me-R", hpPct: "12" },
  },
  {
    id: "cd-waste:a:1",
    type: "cd-waste",
    t: 12,
    unitNames: ["Me-R"],
    facts: { spell: "Pain Suppression", unit: "Me-R" },
  },
];
const original: Finding[] = [
  {
    eventIds: ["death:a:30"],
    severity: "high",
    category: "survival",
    title: "Death at 30s",
    explanation: "You died at 30s in a 3v3.",
  },
  {
    eventIds: ["cd-waste:a:1"],
    severity: "med",
    category: "cooldown",
    title: "Unused Pain Suppression",
    explanation: "Pain Suppression was never pressed.",
    deepDive: { text: "kept", chips: [] },
  },
];
const reply = (findings: unknown[], changes: unknown[] = []) => ({
  findings,
  changes,
});
const same = () => original.map(({ deepDive: _d, ...f }) => ({ ...f }));

describe("buildSelfReviewPrompt", () => {
  it("带上首轮整份 prompt 与结论(只给首轮 JSON 的五个字段),说明里写死不许新增", () => {
    const p = buildSelfReviewPrompt("FIRST ROUND PROMPT", original);
    expect(p).toContain(
      "=== PROMPT ===\nFIRST ROUND PROMPT\n=== END PROMPT ===",
    );
    expect(p).toContain("You died at 30s in a 3v3.");
    expect(p).not.toContain("deepDive");
    expect(p).toContain("**Never add a new fact, event or finding.**");
    expect(p).toContain('{"findings": [...], "changes": [...]}');
  });
});

describe("numbersIn", () => {
  it("时间 / 小数整体取,1v1–3v3 赛制词豁免(与 auditFindings 同一个 BRACKET_TERM)", () => {
    expect([...numbersIn("在 1:23 时 4.5 秒,3v3 里 12%")]).toEqual([
      "1:23",
      "4.5",
      "12",
    ]);
  });
  it("符号与数量级后缀是数字的一部分;区间的连字符不是负号(codex 50-SR-01 #1)", () => {
    expect([...numbersIn("吃了 30k,掉到 −12%,+0.6s,82K,0:34-0:54")]).toEqual([
      "30k",
      "-12",
      "0.6",
      "82k",
      "0:34",
      "0:54",
    ]);
  });
});

describe("applySelfReview", () => {
  it("原样返回 → 一条不改;eventIds / category / deepDive 等其余字段沿用原版", () => {
    const out = applySelfReview(original, reply(same()), candidates);
    expect(out).toEqual({
      ok: true,
      findings: original,
      changes: [],
      reverted: [],
    });
  });

  it("改写可用所引事件的 fact 数字(12 不在原句里,但是 hpPct 的值)", () => {
    const f = same();
    f[0]!.explanation = "You died at 30s at 12% HP.";
    const out = applySelfReview(original, reply(f), candidates);
    expect(out.ok && out.findings[0]!.explanation).toBe(
      "You died at 30s at 12% HP.",
    );
  });

  it("fact 带符号(-131k)时正文写不带符号的 131k 可以;反过来不行", () => {
    const signed: CandidateEvent[] = [
      { ...candidates[0]!, facts: { ...candidates[0]!.facts, delta: "-131k" } },
      candidates[1]!,
    ];
    const f = same();
    f[0]!.explanation = "You died at 30s; healing was 131k lower.";
    let out = applySelfReview(original, reply(f), signed);
    expect(out.ok && out.reverted).toEqual([]);
    f[0]!.explanation = "You died at -30s.";
    out = applySelfReview(original, reply(f), signed);
    expect(out.ok && out.reverted.map((r) => r.reason)).toEqual([
      "numeric: -30 not in the cited facts",
    ]);
  });

  it("删掉一条结论可以;一条不剩不行", () => {
    const one = applySelfReview(original, reply([same()[1]]), candidates);
    expect(one.ok && one.findings).toEqual([original[1]]);
    expect(applySelfReview(original, reply([]), candidates)).toEqual({
      ok: false,
      reason: "empty: every finding dropped",
    });
  });

  it("整份违约 → ok:false:没有 findings 数组 / 新增 / 改了 eventIds 或 category / 乱序 / 重复", () => {
    const fail = (r: unknown) =>
      applySelfReview(original, r as Record<string, unknown>, candidates);
    expect(fail(null).ok).toBe(false);
    expect(fail({ findings: "x" }).ok).toBe(false);
    const f = same();
    expect(
      fail(reply([...f, { ...f[0], category: "positioning" }])),
    ).toMatchObject({
      ok: false,
      reason: "contract: a finding not in the original",
    });
    expect(
      fail(reply([{ ...f[0], eventIds: ["death:a:30", "cd-waste:a:1"] }])),
    ).toMatchObject({ ok: false });
    expect(fail(reply([f[1], f[0]]))).toMatchObject({
      ok: false,
      reason: "contract: findings reordered or repeated",
    });
    expect(fail(reply([f[0], f[0]]))).toMatchObject({ ok: false });
  });

  it("category 先归一再比(别名不算改了 category)", () => {
    const f = same();
    f[0]!.category = "SURVIVAL";
    expect(applySelfReview(original, reply(f), candidates).ok).toBe(true);
  });

  it("单条不过 → 只退回那一条:新数字 / 空文本 / 因果用语 / 名册外职业", () => {
    const cases: Array<[Partial<Finding>, RegExp]> = [
      [{ explanation: "You died at 45s." }, /^numeric: 45/],
      [{ explanation: "You took 30k damage at 30s." }, /^numeric: 30k/],
      [{ explanation: "Your HP reached −12% at 30s." }, /^numeric: -12/],
      [{ title: "" }, /^schema/],
      [{ explanation: "You died because you were not healed." }, /^causal/],
      [{ explanation: "The Paladin bubbled." }, /^roster/],
    ];
    for (const [over, reason] of cases) {
      const f = same();
      Object.assign(f[0]!, over);
      const out = applySelfReview(original, reply(f), candidates, {
        rosterSpecs: ["257", "103"],
      });
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      expect(out.findings[0]).toBe(original[0]);
      expect(out.reverted).toHaveLength(1);
      expect(out.reverted[0]!.index).toBe(0);
      expect(out.reverted[0]!.reason).toMatch(reason);
    }
  });

  it("severity 只降不升;非法值沿用原版", () => {
    const f = same();
    f[0]!.severity = "low";
    f[1]!.severity = "high";
    let out = applySelfReview(original, reply(f), candidates);
    expect(out.ok && out.findings.map((x) => x.severity)).toEqual([
      "low",
      "med",
    ]);
    (f[0] as { severity: string }).severity = "critical";
    out = applySelfReview(original, reply(f), candidates);
    expect(out.ok && out.findings[0]!.severity).toBe("high");
  });

  it("改动日志只留格式对的条目(不核对内容,只为调试与展示)", () => {
    const out = applySelfReview(
      original,
      reply(same(), [
        { finding: 1, action: "weakened", old: "a", new: "b" },
        { finding: 2, action: "deleted", old: "c", new: null },
        { finding: "1", action: "weakened", old: "a" },
        { finding: 1, action: "invented", old: "a" },
        null,
      ]),
      candidates,
    );
    expect(out.ok && out.changes).toEqual([
      { finding: 1, action: "weakened", old: "a", new: "b" },
      { finding: 2, action: "deleted", old: "c", new: null },
    ]);
  });
});
