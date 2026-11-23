import { ensureAnalysisData } from "@gladlog/analysis";
import { beforeAll, describe, expect, it } from "vitest";

import { spellLabel } from "./spellLabel";

describe("spellLabel(§8 第 1 条:英文模式下的技能名)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("en:查得到的 id 换成英文名(17 = Power Word: Shield)", () => {
    expect(spellLabel("17", "真言术:盾", "en")).toBe("Power Word: Shield");
  });

  it("zh:原样返回日志名", () => {
    expect(spellLabel("17", "真言术:盾", "zh")).toBe("真言术:盾");
    expect(spellLabel("17", "", "zh")).toBe("");
  });

  it("en:id 查不到时返回日志名(不是 id)", () => {
    expect(spellLabel("999999999", "某个技能", "en")).toBe("某个技能");
    expect(spellLabel("", "某个技能", "en")).toBe("某个技能");
  });

  it("en:日志名为空时回落到英文表(和 displaySpellName 同一条)", () => {
    expect(spellLabel("17", "", "en")).toBe("Power Word: Shield");
  });

  it("接受数字 id", () => {
    expect(spellLabel(17, "真言术:盾", "en")).toBe("Power Word: Shield");
  });
});
