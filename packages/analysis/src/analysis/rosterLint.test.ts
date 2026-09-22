import { describe, expect, it } from "vitest";

import { classOfSpec, rosterClassViolations } from "./rosterLint";

// 257 Holy Priest · 103 Feral Druid · 65 Holy Paladin · 250 Blood DK · 577 Havoc DH · 253 BM Hunter
const PRIEST_DRUID = ["257", "103"];

describe("rosterLint(2026-09-22 用户报告:对面明明是神牧,你确认定是圣骑)", () => {
  it("classOfSpec 从 specToString 的尾词取职业,复合职业名也对", () => {
    expect(classOfSpec("257")).toBe("Priest");
    expect(classOfSpec("250")).toBe("Death Knight");
    expect(classOfSpec("577")).toBe("Demon Hunter");
    expect(classOfSpec("0")).toBeNull();
  });

  it("中文 / 英文 / 昵称:阵容外的职业词都算违规", () => {
    expect(rosterClassViolations("对方圣骑士这一手几乎每次冷却好就砸", PRIEST_DRUID)).toEqual([
      'Paladin ("圣骑")',
    ]);
    expect(rosterClassViolations("their Paladin bubbled", PRIEST_DRUID)).toEqual([
      'Paladin ("Paladin")',
    ]);
    expect(rosterClassViolations("奶骑交了圣盾", PRIEST_DRUID)).toEqual([
      'Paladin ("奶骑")',
    ]);
  });

  it("阵容内的职业词不算:神牧 / Holy Priest / 德鲁伊", () => {
    expect(
      rosterClassViolations("对面神牧的守护之魂,野性德鲁伊贴脸", PRIEST_DRUID),
    ).toEqual([]);
    expect(rosterClassViolations("the Holy Priest's Guardian Spirit", PRIEST_DRUID)).toEqual([]);
  });

  it("复合职业先匹配再抹掉:Demon Hunter 不算 Hunter,死亡骑士不算骑士", () => {
    expect(rosterClassViolations("Havoc Demon Hunter 全程贴脸", ["577", "71"])).toEqual([]);
    expect(rosterClassViolations("死亡骑士的凋零缠绕", ["250", "71"])).toEqual([]);
    // 而真的猎人 / 骑士缺席时仍抓得到
    expect(rosterClassViolations("Demon Hunter and a Hunter", ["577"])).toEqual([
      'Hunter ("Hunter")',
    ]);
  });

  it("阵容未知(空 / 全 0)→ 不检查", () => {
    expect(rosterClassViolations("对方圣骑士", [])).toEqual([]);
    expect(rosterClassViolations("对方圣骑士", ["0"])).toEqual([]);
  });
});
