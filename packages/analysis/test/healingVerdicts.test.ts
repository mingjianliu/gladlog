/**
 * 治疗裁定册的防腐测试 —— 照 `mitigationVerdicts.test.ts` 的纪律。
 *
 * 这一册要消灭的失败形状是「不知道就当没有」:意气风发 / 恶魔变形 / 吸血鬼之血
 * 三个技能官方数据明确说它们治疗,却三套归类一个都没落上,于是系统对它们只知道
 * 「有个 Defensive 牌子」。所以最重要的一条断言是**键集完备**:任何一个
 * 「Defensive 牌子 + 官方说它治疗」的技能,必须出现在正册或暂存区之一 ——
 * 新出一个这样的技能而没人裁定,CI 立刻变红。
 */
import { describe, expect, it } from "vitest";

import {
  HEALING_VERDICTS,
  type HealingVerdict,
  healingVerdictDomain,
  healingVerdictOf,
  PROPOSED_HEALING_VERDICTS,
} from "../src/data/healingVerdicts";

const SIGNED = /^\d{4}-\d{2}-\d{2} user$/;

describe("治疗裁定册", () => {
  it("键集完备:每个「Defensive + 官方说它治疗」的技能都被裁定或在暂存区", () => {
    const covered = new Set([
      ...Object.keys(HEALING_VERDICTS),
      ...Object.keys(PROPOSED_HEALING_VERDICTS),
    ]);
    const missing = healingVerdictDomain().filter((id) => !covered.has(id));
    expect(
      missing,
      `这些技能官方数据说它们治疗,却既没裁定也没进暂存区:${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("正册与暂存区不重叠 —— 晋升即移除,不留副本", () => {
    const both = Object.keys(HEALING_VERDICTS).filter(
      (id) => id in PROPOSED_HEALING_VERDICTS,
    );
    expect(
      both,
      `这些条目同时躺在正册和暂存区,两处各存一份必然悄悄分叉:${both.join(", ")}`,
    ).toEqual([]);
  });

  it("正册每条都有合规签名和非空出处", () => {
    for (const [id, e] of Object.entries(HEALING_VERDICTS)) {
      expect(e.approved, `${id} (${e.zh}) 缺少或格式错误的 approved`).toMatch(
        SIGNED,
      );
      expect(e.source.trim().length, `${id} 的 source 为空`).toBeGreaterThan(0);
      expect(e.zh.trim().length, `${id} 缺中文名`).toBeGreaterThan(0);
    }
  });

  it("裁定值只能取四个已定义的类别", () => {
    const allowed: HealingVerdict[] = [
      "burst-answer",
      "sustain-only",
      "needs-healer",
      "unresolved",
    ];
    for (const [id, e] of Object.entries(HEALING_VERDICTS)) {
      expect(allowed, `${id} (${e.zh}) 的 verdict 不在枚举内`).toContain(
        e.verdict,
      );
    }
    for (const [id, e] of Object.entries(PROPOSED_HEALING_VERDICTS)) {
      expect(allowed, `${id} (${e.zh}) 的 proposed 不在枚举内`).toContain(
        e.proposed,
      );
    }
  });

  it("暂存区每条都写清了「什么情况下这个提议会被推翻」", () => {
    for (const [id, e] of Object.entries(PROPOSED_HEALING_VERDICTS)) {
      expect(
        e.wouldFlipIf.trim().length,
        `${id} (${e.zh}) 没写 wouldFlipIf —— 提议必须带可推翻条件,否则裁定人无从下手`,
      ).toBeGreaterThan(0);
    }
  });

  it("未签字的一律查不到 —— 消费方不许读暂存区", () => {
    // 建册当天正册为空,这条断言同时钉住「暂存区不得被当成裁定使用」。
    for (const id of Object.keys(PROPOSED_HEALING_VERDICTS)) {
      if (id in HEALING_VERDICTS) continue;
      expect(healingVerdictOf(id), `${id} 未签字却能查到裁定`).toBeUndefined();
    }
  });

  it("完备域非空 —— 域算错了会让上面的键集断言假绿", () => {
    expect(healingVerdictDomain().length).toBeGreaterThan(0);
  });
});
