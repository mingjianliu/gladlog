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
      'Holy Paladin ("奶骑")',
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

  it("专精级昵称:用户实例 —— 阵容里只有惩戒骑(己方)、对方是神牧,标题写「奶骑」→ 违规", () => {
    // 2026-09-22 真实 lobby:戒律牧(owner)/惩戒骑/敏锐贼 vs 暗牧/神牧/痛苦术
    const lobby = ["256", "70", "259", "258", "257", "265"];
    expect(
      rosterClassViolations("对饰品在手的奶骑开锤,而术士没有任何保命手段", lobby),
    ).toEqual(['Holy Paladin ("奶骑")']);
    expect(rosterClassViolations("the Holy Paladin got hammered", lobby)).toEqual([
      'Holy Paladin ("Holy Paladin")',
    ]);
    // 同一 lobby 里写对的称呼全部放行:惩戒骑 / 神牧 / 暗牧 / 戒律牧 / 圣骑(职业泛称)
    expect(
      rosterClassViolations(
        "惩戒骑的制裁之锤晕住了神牧;暗牧的吸血鬼之触;你作为戒律牧;圣骑的锤子",
        lobby,
      ),
    ).toEqual([]);
  });

  it("专精级昵称先抹掉再查职业:神圣骑士不会再被当成骑士二次报告", () => {
    expect(rosterClassViolations("对方神圣骑士开了圣盾", ["257", "103"])).toEqual([
      'Holy Paladin ("神圣骑士")',
    ]);
  });

  it("阵容未知(空 / 全 0)→ 不检查", () => {
    expect(rosterClassViolations("对方圣骑士", [])).toEqual([]);
    expect(rosterClassViolations("对方圣骑士", ["0"])).toEqual([]);
  });
});
