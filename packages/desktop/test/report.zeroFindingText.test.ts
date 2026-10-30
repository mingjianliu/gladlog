import { describe, expect, it } from "vitest";

import { zeroFindingText } from "../src/renderer/src/report/derive/zeroFindingText";
import type { AnalysisFallbackReason } from "../src/shared/analysisFallback";

const STALE = "未生成解说(旧版本缓存),点「重新分析」重新生成。";

describe("zeroFindingText:0 条 findings 时面板说的那句话,每种原因各一句", () => {
  it("empty-reply(模型跑过、回了空数组)有自己的话:说分析跑过、没有值得写的、时间线与统计还在 —— 不是旧缓存那句", () => {
    const text = zeroFindingText({ dropped: 0, fallbackReason: "empty-reply" });
    expect(text).toBe(
      "分析已完成:模型看过本场的候选事件,没有哪一件值得写成教练意见 —— 时间线与各项统计照常可看。",
    );
    expect(text).not.toBe(STALE);
    expect(text).not.toMatch(/旧版本|缓存|重新分析/);
  });

  it("没有原因、审计也没丢东西的结果仍是旧版本缓存那句(什么算旧缓存没有变)", () => {
    expect(zeroFindingText({ dropped: 0 })).toBe(STALE);
  });

  it("其余三种原因与审计全丢各自的话不变,五句互不相同", () => {
    const reasons: AnalysisFallbackReason[] = [
      "no-candidates",
      "no-client",
      "bad-json",
      "empty-reply",
    ];
    const texts = reasons.map((fallbackReason) =>
      zeroFindingText({ dropped: 0, fallbackReason }),
    );
    expect(texts[0]).toBe(
      "本场无可指摘事件(无人阵亡、资源使用无明显问题)—— 这是好事,不硬编教练意见。",
    );
    expect(texts[1]).toBe(
      "未配置 AI(设置里填 API key 或本地 CLI 后端),仅展示确定性事件。",
    );
    expect(texts[2]).toBe(
      "模型返回格式异常,已回退为确定性展示 —— 可点「重新分析」再试。",
    );
    const dropped = zeroFindingText({ dropped: 3 });
    expect(dropped).toBe(
      "模型输出了 3 条,但全部未通过审计(裸数字/编造事件/因果断言)被丢弃 —— 可点「重新分析」再试。",
    );
    expect(new Set([...texts, dropped, STALE]).size).toBe(6);
    // an audit drop is said first, whatever the reason beside it
    expect(zeroFindingText({ dropped: 2, fallbackReason: "empty-reply" })).toBe(
      zeroFindingText({ dropped: 2 }),
    );
  });
});
