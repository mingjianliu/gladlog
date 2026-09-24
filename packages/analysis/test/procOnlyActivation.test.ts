/**
 * 「没有按键的能力不许被指控」的回归锚。
 *
 * 复苏烈焰 374348 是被动触发的保命 HoT(用户 2026-08-23 裁定:「那个是被动技能,
 * 等于是一个保命的、类似冰箱的技能」)。在这条门装上之前,归档 120 个文件里它被
 * cd-waste 指控 4 次、cd-spent-idle 1 次、death-setup 2 次、death-unused-defensive
 * 1 次(DPS 视角另有 cd-spent-idle 2 / death-setup 2),而它的 SPELL_CAST_SUCCESS
 * 在归档 400 个文件里是 0 次 —— 每一个带这个天赋的玩家都会被指控,而且永远洗不掉。
 *
 * 这是价值门规则第 3 条(「当时做得到吗」)的极端情形:不是难做到,是没有那个按钮。
 */
import { describe, expect, it } from "vitest";

import {
  AURA_ONLY_ACTIVATION_IDS,
  cdAvailableAt,
  cdIsProcOnly,
  PROC_ONLY_ACTIVATION_IDS,
  isProcOnlyActivation,
} from "../src/utils/cooldowns";

describe("PROC_ONLY_ACTIVATION_IDS", () => {
  it("复苏烈焰在册,谓词认得它", () => {
    expect(PROC_ONLY_ACTIVATION_IDS.has("374348")).toBe(true);
    expect(isProcOnlyActivation("374348")).toBe(true);
  });

  it("平时是按键、只是另有 proc 路径的能力**不**在册", () => {
    // AURA_ONLY_ACTIVATION_IDS 里混着两种形状:结构性无施法行(复苏烈焰)与
    // 条件性无施法行(复仇之怒 31884 / 升腾 114052 —— 平时就是按键,某个天赋
    // 另给一条免费 proc)。后者「你整局没按」是成立的指控,不能一起挡掉。
    for (const id of ["31884", "114052"]) {
      expect(
        AURA_ONLY_ACTIVATION_IDS[id],
        `${id} 应仍在光环激活表里`,
      ).toBeDefined();
      expect(isProcOnlyActivation(id), `${id} 不该被当成无按键能力`).toBe(
        false,
      );
    }
  });

  it("每一条都必须同时登记在 AURA_ONLY_ACTIVATION_IDS 里", () => {
    // 没有按键 ⇒ 它的「用过了」只能由光环证明。两张表脱钩的话,这个能力会变成
    // 「永远 neverUsed 且永远不被指控」,那是另一种静默错误。
    for (const id of PROC_ONLY_ACTIVATION_IDS) {
      expect(
        AURA_ONLY_ACTIVATION_IDS[id],
        `${id} 没有按键却没登记光环激活路径,它的使用将永远无法被观测到`,
      ).toBeDefined();
    }
  });
});

// GH #106 step 2: a talent can take the button away for ONE player (Radiant
// Glory replaces Avenging Wrath with an 8 s proc off Wake of Ashes). The
// ledger marks that player's entry `isProcOnly`; the per-unit predicate and
// the readiness predicate must both honour it, while the same spell stays a
// real button for everyone else.
describe("按人判断的无按键(isProcOnly)", () => {
  const procAw = {
    spellId: "31884",
    isProcOnly: true,
    casts: [{ timeSeconds: 10 }],
    cooldownSeconds: 60,
    neverUsed: false,
    charges: 1,
  };
  it("点了光辉荣耀的人:复仇之怒无按键,任何时刻都不算「可以按」", () => {
    expect(cdIsProcOnly(procAw)).toBe(true);
    expect(cdAvailableAt(procAw, 5)).toBe(false);
    expect(cdAvailableAt(procAw, 500)).toBe(false);
  });
  it("没点的人:同一个技能照常是按键,照常按冷却判断", () => {
    const pressed = { ...procAw, isProcOnly: false };
    expect(cdIsProcOnly(pressed)).toBe(false);
    expect(cdAvailableAt(pressed, 30)).toBe(false);
    expect(cdAvailableAt(pressed, 70)).toBe(true);
  });
  it("按技能判断的表照样生效(复苏烈焰,字段缺省时)", () => {
    expect(cdIsProcOnly({ spellId: "374348" })).toBe(true);
  });
});
