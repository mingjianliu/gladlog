import { describe, expect, it } from "vitest";

import {
  type IInterruptInstance,
  postKickSeverityRank,
} from "./ccTrinketAnalysis";

/** Only the two fields the rank reads; the rest of IInterruptInstance is
 * irrelevant to it and stubbing it whole would hide that. */
const inst = (
  postKick: IInterruptInstance["postKick"],
  switchWasHardCast: boolean | null = null,
): Pick<IInterruptInstance, "postKick" | "switchWasHardCast"> => ({
  postKick,
  switchWasHardCast,
});

describe("postKickSeverityRank(2026-09-06,替换扁平 idle/acted/switched 表)", () => {
  it("idle 最可教,排最前", () => {
    expect(postKickSeverityRank(inst("idle"))).toBe(0);
  });

  it("只有「真读了条的 switched」进最不可教档 —— 那是唯一有证据的一档", () => {
    expect(postKickSeverityRank(inst("switched", true))).toBe(2);
  });

  it("瞬发切换与 acted 同档,不互相排序", () => {
    // 语料 292 条 switched 里 276 条是瞬发。旧表把它们全判成「最不可教」,
    // 对这 95% 没有任何证据。按瞬发可能是好的脱离(猫形态+野性冲锋),
    // 也可能接近被打死(5 秒一个瞬发治疗)—— 本模块分不开,就不假装分得开。
    expect(postKickSeverityRank(inst("switched", false))).toBe(
      postKickSeverityRank(inst("acted")),
    );
  });

  it("switchWasHardCast=null 留在中间档 —— 没有证据不等于证明没事", () => {
    // 旧归档没有 castStartEvents。这一条防的是「未知被当成硬读条」而把
    // 一行悄悄降级成最不可教。
    expect(postKickSeverityRank(inst("switched", null))).toBe(1);
    expect(postKickSeverityRank(inst("switched", null))).not.toBe(
      postKickSeverityRank(inst("switched", true)),
    );
  });

  it("排序结果:idle < (acted = 瞬发 switched) < 硬读条 switched", () => {
    const ranks = [
      postKickSeverityRank(inst("idle")),
      postKickSeverityRank(inst("acted")),
      postKickSeverityRank(inst("switched", false)),
      postKickSeverityRank(inst("switched", true)),
    ];
    expect(ranks).toEqual([0, 1, 1, 2]);
  });
});
