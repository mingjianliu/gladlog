/**
 * GH #28: 「绝望祷言只能给自己加血,产品却在队友垂危时要求我用它」。
 *
 * 这个文件钉的是官方数据地基本身:DB2 `SpellEffect.ImplicitTarget` 生成的
 * 「够不够得着队友」表,以及它对手工外放表的双向一致性。生成脚本
 * (scripts/datagen/genSpellTargeting.ts)在写盘前就断言过同样两个方向 ——
 * 这里再钉一遍,是因为生成物会被提交进仓库,而下一次刷新数据的人不一定跑得动
 * 那个脚本(需要 57MB DB2 CSV)。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { classMetadata } from "../src/data/classSpells";
import { ensureAnalysisData } from "../src/data/ensure";
import spellIdLists from "../src/data/spellIdLists";
import { hasOfficialTargeting, reachesAlly } from "../src/data/spellTargeting";
import { SPELL_REACHES_OTHERS_GENERATED } from "../src/data/spellTargetingGenerated";
import { SpellTag } from "../src/data/spellTypes";

// 数据改为动态载入(见 spellTargetingGenerated.ts 头部):测试必须先 await
// 聚合入口,否则读到的是空表 —— 这正是生产 prompt 路径的同一条契约。
beforeAll(async () => {
  await ensureAnalysisData();
});

describe("reachesAlly(官方 ImplicitTarget)", () => {
  it("用户报的那一条:绝望祷言只作用于施法者", () => {
    expect(reachesAlly("19236")).toBe(false);
  });

  it("个人保命墙一律够不着队友", () => {
    for (const id of [
      "642", // 圣盾术
      "45438", // 寒冰屏障(法师 Ice Block)
      "871", // 盾墙
      "22812", // 树皮
      "118038", // 破釜沉舟(用户点名)
      "185311", // 猩红药水(用户点名)
      "11426", // 寒冰护体(用户点名)
      "363916", // 黑曜石鳞甲 —— dummy 效果陷阱:它有一条 Effect=3/目标21 的空槽
      "108271", // 星界转移
    ]) {
      expect(reachesAlly(id), `${id} 应判为够不着队友`).toBe(false);
    }
  });

  it("手工外放表的每一条都必须被官方数据认可(手工表只能证伪不能证全,这是反向对账)", () => {
    for (const id of spellIdLists.externalDefensiveSpellIds as string[]) {
      expect(reachesAlly(id), `${id} 在外放表里却被判为够不着队友`).toBe(true);
    }
  });

  it("官方数据补上了手工表漏掉的三条团队技(修法若只用手工表会误杀这些正确指控)", () => {
    // 都不在 externalDefensiveSpellIds 里,但确实作用于队友
    expect(reachesAlly("740")).toBe(true); // 宁静(经一跳 EffectTriggerSpell 157982)
    expect(reachesAlly("64843")).toBe(true); // 神圣赞美诗(64844)
    expect(reachesAlly("31821")).toBe(true); // 光环大师(目标 56 = 团队光环)
    expect(reachesAlly("97462")).toBe(true); // 集结呐喊 —— 全是 dummy 效果行的反向陷阱
    // 圣洁鸣钟 —— 唯一的真实行是给自己回圣能(Effect 30,目标 1),真正的效果在
    // 指向区域友方/敌方(31/16)的 dummy 行里;fact3 D7(0c796c56-r3 P:74)
    expect(reachesAlly("375576")).toBe(true);
    // 宁静与神圣赞美诗至今不在手工外放表里 —— 官方 targeting 是它们被认出来的
    // 唯一途径。光环大师原本也在这一列,2026-08-22 用户裁定它 20% 全团减伤后
    // 补登记进了手工表(见 spellIdLists.ts 该条注释),所以它不再是这条断言的
    // 证据 —— 但 reachesAlly 对它的判定当时就是对的,上面那行仍然钉着。
    for (const id of ["740", "64843"]) {
      expect(
        (spellIdLists.externalDefensiveSpellIds as string[]).includes(id),
      ).toBe(false);
    }
  });

  // 2026-08-22 同日返工:`18`/`87` 一度被解码成友方目标,实际是「目的地」标记
  // (战争践踏 t0=18,t1=16;冰霜之环 t0=87,t1=16 —— 16 是敌方区域),把 965 条
  // 里的 405 条判成了「够得着队友」,全是敌方 AoE。上线时的真值只有「外放必须
  // true」「个人减伤必须 false」两向,**没有任何敌方法术在对照组里**,所以它
  // 抓不到这一类。这条用例就是补上的第三向。
  it("敌方 AoE / 敌方控制一律不算够得着队友(18/87 解码回归)", () => {
    for (const [id, name] of [
      ["1680", "旋风斩"],
      ["5740", "火焰之雨"],
      ["43265", "枯萎凋零"],
      ["26573", "奉献"],
      ["82691", "冰霜之环"],
      ["179057", "混沌新星"],
      ["20549", "战争践踏"],
      ["6544", "英勇飞跃"],
    ] as const) {
      expect(reachesAlly(id), `${name}(${id}) 不该被判为够得着队友`).toBe(
        false,
      );
    }
  });

  it("召唤类友方效果靠手工兜底层(官方一跳跳不到图腾自己的光环)", () => {
    // 灵魂链接图腾:cast id 只有 Effect=28 召唤,减伤在图腾的 325174 上
    expect(SPELL_REACHES_OTHERS_GENERATED["98008"]).toBe(false);
    expect(reachesAlly("98008")).toBe(true); // 手工外放表兜住
  });

  it("完备性:classMetadata 里每一个防御 CD 都有官方 targeting 行(缺行=消费者只能退回手工表)", () => {
    const missing = classMetadata
      .flatMap((c) => c.abilities)
      .filter((a) => a.tags.includes(SpellTag.Defensive))
      .filter((a) => !hasOfficialTargeting(a.spellId))
      .map((a) => `${a.spellId}/${a.name}`);
    expect(missing).toEqual([]);
  });
});
