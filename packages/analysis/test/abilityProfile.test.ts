/**
 * GH #29 阶段 2 地基:功能画像的组合结果。
 *
 * 这个文件同时是**冒烟表**——首版把 `MITIGATION_TABLE` 的值当成裸数字读
 * (它其实是 `{ pct, schoolMask }`),盾墙 40% 大墙的 mitigationPct 恒为
 * undefined、isSurvivalWall 恒为 false。是一张「已知答案逐行对」的表当场看出来的,
 * 不是靠读代码。所以这里钉的是**答案已知的那些技能**,不是随便挑的。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { abilityProfile, isSurvivalWall } from "../src/data/abilityProfile";
import { ensureAnalysisData } from "../src/data/ensure";

// 官方数据动态载入:先 await 聚合入口(与 prompt 路径同一契约)
beforeAll(async () => {
  await ensureAnalysisData();
});

describe("abilityProfile", () => {
  it("真正的保命墙:减伤/吸收/免疫任一", () => {
    expect(abilityProfile("871").mitigationPct).toBe(40); // 盾墙
    expect(abilityProfile("22812").mitigationPct).toBe(20); // 树皮
    expect(abilityProfile("17").absorbs).toBe(true); // 真言术:盾
    expect(abilityProfile("642").immuneSchools).toBe(127); // 圣盾术
    for (const id of ["871", "22812", "17", "642"])
      expect(isSurvivalWall(id), id).toBe(true);
  });

  it("挂着 Defensive 牌子但不是墙的四类,逐类分得开", () => {
    // ① 纯自愈(GH #28 那条)
    const dp = abilityProfile("19236");
    expect(dp.healsSelf).toBe(true);
    expect(dp.healsOthers).toBe(false);
    expect(isSurvivalWall("19236")).toBe(false);
    // ② 受治疗量增益
    expect(abilityProfile("47788").healingReceivedPct).toBe(60); // 守护之魂
    expect(isSurvivalWall("47788")).toBe(false);
    // ③ 团队治疗
    expect(abilityProfile("64843").healsOthers).toBe(true); // 神圣赞美诗
    // ④ 产出强化(用户签字,官方给不出)
    expect(abilityProfile("200183").throughputRole).toBe(true); // 神圣显灵
    expect(abilityProfile("216331").throughputRole).toBe(true); // 复仇十字军
    expect(isSurvivalWall("200183")).toBe(false);
  });

  it("控制技能不是墙 —— 这正是 cd-waste 的 `!isThroughput` 判据放进来的那一整类", () => {
    for (const id of ["3355", "115078", "853", "118"])
      expect(isSurvivalWall(id), id).toBe(false);
  });

  it("学派与够不够得着队友两维照常来自各自单源", () => {
    expect(abilityProfile("1022").immuneSchools).toBe(1); // 保护祝福:纯物理免疫
    expect(abilityProfile("1022").reachesAlly).toBe(true);
    expect(abilityProfile("19236").reachesAlly).toBe(false);
    expect(abilityProfile("118").school).toBe(64); // 变形术:奥术
  });

  it("未知 id 返回全空画像而不是抛错", () => {
    const p = abilityProfile("999999999");
    expect(p.reachesAlly).toBe(false);
    expect(p.absorbs).toBe(false);
    expect(p.mitigationPct).toBeUndefined();
    expect(isSurvivalWall("999999999")).toBe(false);
  });

  // GH #29 第 6 项(进攻面 41% 空白):官方 ImplicitTarget 能回答「打不打敌人 /
  // 是不是范围 / 造不造成伤害」,这三维此前完全没有。
  it("进攻面三维:打敌人 / 范围 / 造成伤害", () => {
    const deathmark = abilityProfile("360194"); // 死亡标记:指定单体
    expect(deathmark.hitsEnemy).toBe(true);
    expect(deathmark.enemyAoE).toBe(false);
    const ringOfFrost = abilityProfile("82691"); // 冰霜之环:区域
    expect(ringOfFrost.hitsEnemy).toBe(true);
    expect(ringOfFrost.enemyAoE).toBe(true);
    const shockwave = abilityProfile("46968"); // 震荡波:锥形
    expect(shockwave.enemyAoE).toBe(true);
    expect(abilityProfile("179057").dealsDamage).toBe(true); // 混沌新星
    expect(abilityProfile("118").dealsDamage).toBe(false); // 变形术:纯控制
  });

  it("自身增益与给队友的东西不算「打敌人」", () => {
    for (const id of ["871", "190319", "31884", "33206", "10060", "740"])
      expect(abilityProfile(id).hitsEnemy, id).toBe(false);
  });
});
