import { describe, expect, it } from "vitest";

import { cliWaitHint, fmtElapsed } from "./aiRunStatus";
import { backendModelLabel } from "./slotLabel";

describe("aiRunStatus(「分析中」状态行,2026-08-05 生产反馈)", () => {
  it("fmtElapsed:秒数 → m:ss,向下取整、负数钳到 0", () => {
    expect(fmtElapsed(0)).toBe("0:00");
    expect(fmtElapsed(9.9)).toBe("0:09");
    expect(fmtElapsed(65)).toBe("1:05");
    expect(fmtElapsed(300)).toBe("5:00");
    expect(fmtElapsed(-3)).toBe("0:00"); // 时钟回拨等异常输入不显示负数
  });

  it("cliWaitHint:CLI 后端(单源谓词 isCliAiBackend)有说明,API 后端与未知输入没有", () => {
    for (const b of ["claudeCli", "agy", "codex"]) {
      expect(cliWaitHint(b, "zh")).toContain("CLI");
      expect(cliWaitHint(b, "en")).toContain("CLI");
    }
    expect(cliWaitHint("anthropic", "zh")).toBeNull();
    expect(cliWaitHint("deepseek", "zh")).toBeNull();
    expect(cliWaitHint(null, "zh")).toBeNull();
    expect(cliWaitHint(undefined, "zh")).toBeNull();
  });

  it("backendModelLabel:与 slotLabel 同一查表(agy 别名 id 显示全名;未知值原样透传)", () => {
    expect(backendModelLabel("agy", "pro")).toBe("agy · Gemini 3.1 Pro (High)");
    expect(backendModelLabel("anthropic", "claude-sonnet-5")).toBe(
      "Claude API · Claude Sonnet 5",
    );
    expect(backendModelLabel("mystery", "m1")).toBe("mystery · m1");
  });
});
