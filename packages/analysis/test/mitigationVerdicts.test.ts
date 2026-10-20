/**
 * 减伤裁定册的防腐测试 —— 照 `curatedFacts.test.ts` 的纪律。
 *
 * 审计(docs/coaching-grounding-audit.md)查出:支撑教练判断的九张手工表里,
 * 只有一张有漏项检测,而且是没人定期跑的手动 CLI。本测试是对这条的直接补救 ——
 * 键集断言让「给 MITIGATION_TABLE 加了条目却没裁定」在 CI 里立刻变红。
 */
import { MITIGATION_TABLE } from "../src/data/mitigationData";
import {
  KILL_LIVE_HP_PCT,
  MITIGATION_VERDICTS,
  MITIGATION_VERDICTS_SIGNED_ON,
  type MitigationVerdict,
  mitigationVerdictOf,
} from "../src/data/mitigationVerdicts";

const SIGNED = /^\d{4}-\d{2}-\d{2} user$/;

describe("减伤裁定册:签字纪律", () => {
  it("每条都有合规签名和非空出处", () => {
    for (const [id, e] of Object.entries(MITIGATION_VERDICTS)) {
      expect(e.approved, `${id} (${e.zh}) 缺少或格式错误的 approved`).toMatch(
        SIGNED,
      );
      expect(
        e.source.trim().length,
        `${id} (${e.zh}) 的 source 为空`,
      ).toBeGreaterThan(0);
      expect(e.zh.trim().length, `${id} 缺中文名`).toBeGreaterThan(0);
    }
  });

  it("裁定值只能取四个已定义的类别", () => {
    const allowed: MitigationVerdict[] = [
      "unconditional",
      "kill-live-gated",
      "never",
      "unresolved",
    ];
    for (const [id, e] of Object.entries(MITIGATION_VERDICTS)) {
      expect(allowed, `${id} (${e.zh}) 的 verdict 不在枚举内`).toContain(
        e.verdict,
      );
    }
  });
});

describe("减伤裁定册:与官方减伤表键集一致(漏项检测)", () => {
  it("每个 MITIGATION_TABLE 条目都必须有裁定", () => {
    const missing = Object.keys(MITIGATION_TABLE).filter(
      (id) => !(id in MITIGATION_VERDICTS),
    );
    expect(
      missing,
      `这些减伤条目还没有人裁定过 —— 加了新减伤就必须补裁定,` +
        `不能默认它会不会产出「浪费」判断:${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("裁定册里不能有官方表已经删掉的条目", () => {
    const stale = Object.keys(MITIGATION_VERDICTS).filter(
      (id) => !(id in MITIGATION_TABLE),
    );
    expect(stale, `这些裁定对应的减伤条目已不存在:${stale.join(", ")}`).toEqual(
      [],
    );
  });

  it("记录的 officialPct 与官方表当前值一致(官方数值变了要重新裁定)", () => {
    const drift: string[] = [];
    for (const [id, e] of Object.entries(MITIGATION_VERDICTS)) {
      const now = MITIGATION_TABLE[id]?.pct;
      if (now !== undefined && now !== e.officialPct) {
        drift.push(`${id} ${e.zh}: 签字时 ${e.officialPct}% → 现在 ${now}%`);
      }
    }
    expect(
      drift,
      `官方数值已变动,裁定需要复核后重新签字:\n${drift.join("\n")}`,
    ).toEqual([]);
  });
});

describe("减伤裁定册:阈值与查询", () => {
  it("KILL_LIVE_HP_PCT 是 2026-08-17 依据击杀转化率实测签定的 20", () => {
    // 改这个值必须重跑 mitigationVerdicts.ts 头部记载的那个测量,
    // 不能只改常量 —— 判据即规范(CLAUDE.md)。
    expect(KILL_LIVE_HP_PCT).toBe(20);
    expect(MITIGATION_VERDICTS_SIGNED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("未登记的法术返回 null,不会被误判成任何一类", () => {
    expect(mitigationVerdictOf("99999999")).toBeNull();
  });

  // 原断言要求四类**都**出现,包括 unresolved。2026-08-23 最后一条空缺
  // (疾影术 198589)被裁掉之后它就红了 —— 而那是好事:unresolved 是「有据可查的
  // 空缺」标记,清零说明每条都被裁过,不是退化。所以三类实质裁定仍然必须都在
  // (防退化成单一类别),unresolved 改为「可以没有,但有的话必须是真空缺」。
  it("三类实质裁定都真实存在(裁定册没有退化成单一类别)", () => {
    const seen = new Set(
      Object.values(MITIGATION_VERDICTS).map((e) => e.verdict),
    );
    for (const v of ["kill-live-gated", "never", "unconditional"])
      expect(seen.has(v as never), `缺少 ${v} 一类`).toBe(true);
  });

  it("unresolved 允许为空(全部裁完);若存在,必须带出处说明为什么还没裁", () => {
    for (const [id, e] of Object.entries(MITIGATION_VERDICTS)) {
      if (e.verdict !== "unresolved") continue;
      expect(e.source.length, `${id} 的空缺没有出处`).toBeGreaterThan(20);
    }
  });
});
