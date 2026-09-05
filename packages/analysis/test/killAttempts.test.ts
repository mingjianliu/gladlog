/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { extractCandidateFindings } from "../src/analysis/candidateFindings";
import { CANDIDATE_TYPE_FLAGS } from "../src/data/candidateTypeFlags";
import {
  attemptIntoTrinketEvents,
  extractKillAttempts,
  formatKillAttemptsForContext,
} from "../src/utils/killAttempts";

/**
 * 钉的是四条会静默出错的边界,不是 happy path:
 *  1. DR 链分组:间隔恰在重置窗内/外的两个晕,归并与拆分要与 getDRLevel 的
 *     链走法一致(共享 drResetMsAt —— 12.1 后 20s)。
 *  2. 伤害地板:控住了但没打(< KW_BURST_MIN_DAMAGE=30k)不算尝试。
 *  3. 击杀记账:死亡落在 span+KILL_CREDIT_SLACK_S(5s)内才算转化。
 *  4. 归因优先级:徽章 > 免疫 > 减伤 > 外置 > 被奶,全 false 时落 pressure。
 */

// 12.1 之后的时代(PATCH_121_GOLIVE 之后)→ DR 重置窗 20s
const MATCH_START = Date.UTC(2026, 7, 15);
const ms = (s: number): number => MATCH_START + s * 1000;

function unit(id: string, over: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    type: 1, // CombatUnitType.Player —— analyzeOutgoingCCChains 的目标过滤要求
    spec: "265", // Affliction Warlock(具体值不重要,specToString 能吃)
    reaction: 2,
    info: {},
    spellCastEvents: [],
    auraEvents: [],
    damageOut: [],
    damageIn: [],
    healIn: [],
    deathRecords: [],
    advancedActions: [],
    ...over,
  };
}

/** 敌方 e1 身上被 f1 晕住的光环事件对(analyzeOutgoingCCChains 的输入形状)。 */
function stunAuras(
  targetId: string,
  spellId: string,
  fromS: number,
  durS: number,
): any[] {
  return [
    {
      spellId,
      spellName: `Stun${spellId}`,
      srcUnitId: "f1",
      srcUnitName: "f1",
      destUnitId: targetId,
      destUnitName: targetId,
      timestamp: ms(fromS),
      logLine: {
        event: LogEvent.SPELL_AURA_APPLIED,
        timestamp: ms(fromS),
        parameters: [],
      },
      auraType: "DEBUFF",
    },
    {
      spellId,
      spellName: `Stun${spellId}`,
      srcUnitId: "f1",
      srcUnitName: "f1",
      destUnitId: targetId,
      destUnitName: targetId,
      timestamp: ms(fromS + durS),
      logLine: {
        event: LogEvent.SPELL_AURA_REMOVED,
        timestamp: ms(fromS + durS),
        parameters: [],
      },
      auraType: "DEBUFF",
    },
  ];
}

function dmg(
  srcNotUsed: string,
  destId: string,
  atS: number,
  amount: number,
): any {
  return {
    destUnitId: destId,
    effectiveAmount: amount,
    logLine: {
      event: LogEvent.SPELL_DAMAGE,
      timestamp: ms(atS),
      parameters: [],
    },
  };
}

// Kidney Shot 408 是 DR 表里的 Stun 类
const KIDNEY = "408";

function makeCombat(f1: any, e1: any, extraEnemies: any[] = []): any {
  return {
    startTime: MATCH_START,
    endTime: MATCH_START + 300_000,
    units: {
      f1,
      e1,
      ...Object.fromEntries(extraEnemies.map((e) => [e.id, e])),
    },
  };
}

describe("extractKillAttempts", () => {
  it("同一 DR 链的两个晕并成一次尝试;超出重置窗(20s)的拆成两次", () => {
    const e1 = unit("e1", {
      auraEvents: [
        ...stunAuras("e1", KIDNEY, 10, 5), // 10–15s
        ...stunAuras("e1", KIDNEY, 20, 3), // 间隔 5s < 20s → 同链
        ...stunAuras("e1", KIDNEY, 60, 5), // 距上一段结束 37s > 20s → 新链
      ],
    });
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 40_000), dmg("f1", "e1", 62, 40_000)],
    });
    const attempts = extractKillAttempts([f1], [e1], makeCombat(f1, e1));
    expect(attempts).toHaveLength(2);
    expect(attempts[0].stuns).toHaveLength(2);
    expect(attempts[0].fromSeconds).toBe(10);
    expect(attempts[0].toSeconds).toBe(23);
    expect(attempts[1].stuns).toHaveLength(1);
  });

  it("伤害地板:控住了但团队伤害 < 30k → 不算尝试(那是 peel/铺垫)", () => {
    const e1 = unit("e1", { auraEvents: stunAuras("e1", KIDNEY, 10, 5) });
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 10_000)],
    });
    expect(extractKillAttempts([f1], [e1], makeCombat(f1, e1))).toHaveLength(0);
  });

  it("击杀记账用 KILL_CREDIT_SLACK_S:span 结束后 5s 内死算转化,之后不算", () => {
    const mk = (deathAtS: number) => {
      const e1 = unit("e1", {
        auraEvents: stunAuras("e1", KIDNEY, 10, 5),
        deathRecords: [{ timestamp: ms(deathAtS) }],
      });
      const f1 = unit("f1", {
        reaction: 1,
        damageOut: [dmg("f1", "e1", 12, 50_000)],
      });
      return extractKillAttempts([f1], [e1], makeCombat(f1, e1))[0];
    };
    expect(mk(19).killed).toBe(true); // 15 + 5 = 20 边界内
    expect(mk(26).killed).toBe(false); // 边界外 → 有归因
    expect(mk(26).attribution?.primary).toBe("pressure");
  });

  it("teamOnTargetPct 按全队、含 slack 窗口:打了 e1 60k / e2 40k → 60%", () => {
    const e1 = unit("e1", { auraEvents: stunAuras("e1", KIDNEY, 10, 5) });
    const e2 = unit("e2");
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 60_000), dmg("f1", "e2", 13, 40_000)],
    });
    const a = extractKillAttempts([f1], [e1, e2], makeCombat(f1, e1, [e2]))[0];
    expect(a.teamOnTargetPct).toBe(60);
  });

  it("归因优先级:span 内交徽章 → trinketed 压过其余全部", () => {
    const e1 = unit("e1", {
      auraEvents: stunAuras("e1", KIDNEY, 10, 5),
      spellCastEvents: [
        {
          spellId: "336126",
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: ms(12),
            parameters: [],
          },
        },
      ],
      healIn: [
        {
          effectiveAmount: 999_999,
          logLine: {
            event: LogEvent.SPELL_HEAL,
            timestamp: ms(13),
            parameters: [],
          },
        },
      ],
    });
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 50_000)],
    });
    const a = extractKillAttempts([f1], [e1], makeCombat(f1, e1))[0];
    expect(a.killed).toBe(false);
    expect(a.attribution?.trinketed).toBe(true);
    expect(a.attribution?.outhealed).toBe(true);
    expect(a.attribution?.primary).toBe("trinketed");
  });

  it("被奶回来:span 内治疗 > 伤害且无其他救场 → outhealed", () => {
    const e1 = unit("e1", {
      auraEvents: stunAuras("e1", KIDNEY, 10, 5),
      damageIn: [
        {
          effectiveAmount: 50_000,
          logLine: {
            event: LogEvent.SPELL_DAMAGE,
            timestamp: ms(12),
            parameters: [],
          },
        },
      ],
      healIn: [
        {
          effectiveAmount: 80_000,
          logLine: {
            event: LogEvent.SPELL_HEAL,
            timestamp: ms(13),
            parameters: [],
          },
        },
      ],
    });
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 50_000)],
    });
    const a = extractKillAttempts([f1], [e1], makeCombat(f1, e1))[0];
    expect(a.attribution?.primary).toBe("outhealed");
  });

  it("同一减伤在 span 内反复 APPLIED(变形闪烁)只记一次:知识古树 S2 语料 3 次施放 / 23 次 APPLIED 的形状", () => {
    // 473909 知识古树:MITIGATION_TABLE 30%(GH #44 登记),光环每次形态刷新都
    // 同毫秒 REMOVED+APPLIED 一对;1.5min CD 的墙在一次尝试里不可能交三次。
    const flicker = (atS: number, event: LogEvent): any => ({
      spellId: "473909",
      spellName: "Ancient of Lore",
      srcUnitId: "e1",
      srcUnitName: "e1",
      destUnitId: "e1",
      destUnitName: "e1",
      timestamp: ms(atS),
      logLine: { event, timestamp: ms(atS), parameters: [] },
      auraType: "BUFF",
    });
    const e1 = unit("e1", {
      auraEvents: [
        ...stunAuras("e1", KIDNEY, 10, 5),
        flicker(11, LogEvent.SPELL_AURA_APPLIED),
        flicker(12, LogEvent.SPELL_AURA_REMOVED),
        flicker(12, LogEvent.SPELL_AURA_APPLIED),
        flicker(12.02, LogEvent.SPELL_AURA_REMOVED),
        flicker(12.02, LogEvent.SPELL_AURA_APPLIED),
      ],
    });
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 50_000)],
    });
    const a = extractKillAttempts([f1], [e1], makeCombat(f1, e1))[0];
    expect(a.attribution?.defensivePopped).toEqual(["Ancient of Lore"]);
    expect(formatKillAttemptsForContext([a]).join("\n")).toContain(
      "popped Ancient of Lore",
    );
  });
});

describe("attemptIntoTrinketEvents(候选 mapper)", () => {
  // e1 徽章还在(locked)上的失败尝试;e2 交过徽章(prime)在场 → 出候选
  function lockedScenario() {
    const e1 = unit("e1", { auraEvents: stunAuras("e1", KIDNEY, 10, 5) });
    const e2 = unit("e2", {
      spellCastEvents: [
        {
          spellId: "336126",
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: ms(1),
            parameters: [],
          },
        },
      ],
    });
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 50_000)],
    });
    return { f1, e1, e2, combat: makeCombat(f1, e1, [e2]) };
  }

  it("locked 上的失败尝试 + 场上有 prime → 出候选,facts 可验证", () => {
    const { f1, e1, e2, combat } = lockedScenario();
    const attempts = extractKillAttempts([f1], [e1, e2], combat);
    const events = attemptIntoTrinketEvents(attempts, [e1, e2], MATCH_START);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("attempt-into-trinket");
    expect(events[0].facts.target).toBe("e1");
    expect(events[0].facts.primeAlt).toBe("e2");
    expect(events[0].facts.failedBy).toBe("pressure");
  });

  it("没有 prime 备选(全员 locked)→ 不指控", () => {
    const e1 = unit("e1", { auraEvents: stunAuras("e1", KIDNEY, 10, 5) });
    const e2 = unit("e2"); // 徽章还在 → locked
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 50_000)],
    });
    const attempts = extractKillAttempts([f1], [e1, e2], makeCombat(f1, e1, [e2]));
    expect(attemptIntoTrinketEvents(attempts, [e1, e2], MATCH_START)).toHaveLength(0);
  });

  it("尝试成功(击杀)→ 不指控", () => {
    const { f1, e1, e2 } = lockedScenario();
    e1.deathRecords = [{ timestamp: ms(16) }];
    const combat = makeCombat(f1, e1, [e2]);
    const attempts = extractKillAttempts([f1], [e1, e2], combat);
    expect(attemptIntoTrinketEvents(attempts, [e1, e2], MATCH_START)).toHaveLength(0);
  });

  it("开关负控:flag=false 时 extractCandidateFindings 零产出该类型", () => {
    const { combat } = lockedScenario();
    const has = () =>
      extractCandidateFindings(combat, "f1").some(
        (c) => c.type === "attempt-into-trinket",
      );
    expect(has()).toBe(true);
    CANDIDATE_TYPE_FLAGS.attemptIntoTrinket = false;
    try {
      expect(has()).toBe(false);
    } finally {
      CANDIDATE_TYPE_FLAGS.attemptIntoTrinket = true;
    }
  });
});

describe("formatKillAttemptsForContext", () => {
  it("渲染网格时间、无时长标注、gated 措辞避开门规 regex;空输入零行", () => {
    expect(formatKillAttemptsForContext([])).toHaveLength(0);
    const { f1, e1, e2, combat } = (() => {
      const e1 = unit("e1", { auraEvents: stunAuras("e1", KIDNEY, 70, 5) });
      const e2 = unit("e2");
      const f1 = unit("f1", {
        reaction: 1,
        damageOut: [dmg("f1", "e1", 71, 50_000)],
      });
      return { f1, e1, e2, combat: makeCombat(f1, e1, [e2]) };
    })();
    const lines = formatKillAttemptsForContext(
      extractKillAttempts([f1], [e1, e2], combat),
    );
    const text = lines.join("\n");
    expect(text).toContain("[1:10–1:15]");
    expect(text).toContain("Summary: 1 attempts");
    // 门规避撞:不出现 "(Ns)" 时长标注,也不出现 "available" 措辞
    expect(text).not.toMatch(/\(\d+s\)/);
    expect(text).not.toContain("available");
  });
});

// ── v2:大招锚定(2026-08-20)────────────────────────────────────────────────

/** 友方 f1 施放 Recklessness(1719,buffs_offensive)的施法事件。 */
function offensiveCast(atS: number): any {
  return {
    spellId: "1719",
    spellName: "Recklessness",
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: ms(atS),
      parameters: [],
    },
  };
}

describe("extractKillAttempts — 大招锚定(v2)", () => {
  it("无晕但大招 span 内对主目标伤害 ≥30k → burst 锚尝试(anchor/开手名/无 DR 档)", () => {
    const e1 = unit("e1");
    const f1 = unit("f1", {
      reaction: 1,
      spellCastEvents: [offensiveCast(40)],
      damageOut: [dmg("f1", "e1", 42, 60_000)],
    });
    const attempts = extractKillAttempts([f1], [e1], makeCombat(f1, e1));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.anchor).toBe("burst");
    expect(attempts[0]!.anchorSpellName).toBe("Recklessness");
    expect(attempts[0]!.stuns).toHaveLength(0);
    expect(attempts[0]!.openingDrLevel).toBeUndefined();
  });

  it("同目标已有重叠晕锚尝试 → 不再另立 burst 尝试(晕锚优先,去重)", () => {
    const e1 = unit("e1", { auraEvents: stunAuras("e1", KIDNEY, 40, 5) });
    const f1 = unit("f1", {
      reaction: 1,
      spellCastEvents: [offensiveCast(40)],
      damageOut: [dmg("f1", "e1", 42, 60_000)],
    });
    const attempts = extractKillAttempts([f1], [e1], makeCombat(f1, e1));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.anchor).toBe("stun");
  });

  it("大招 span 内伤害 <30k → 不算尝试(同一伤害地板)", () => {
    const e1 = unit("e1");
    const f1 = unit("f1", {
      reaction: 1,
      spellCastEvents: [offensiveCast(40)],
      damageOut: [dmg("f1", "e1", 42, 10_000)],
    });
    expect(extractKillAttempts([f1], [e1], makeCombat(f1, e1))).toHaveLength(0);
  });

  it("attemptIntoTrinketEvents 只吃晕锚:burst 锚的 locked 失败尝试不产失误候选(三档模型验证锚在晕落地)", () => {
    const e1 = unit("e1");
    const e2 = unit("e2");
    const burstAttempt: any = {
      targetUnitId: "e1",
      targetName: "e1",
      anchor: "burst",
      anchorSpellName: "Recklessness",
      fromSeconds: 40,
      toSeconds: 50,
      stuns: [],
      opportunity: { tier: "locked", wallsInHand: [] },
      teamDamageToTarget: 100_000,
      teamDamageTotal: 100_000,
      teamOnTargetPct: 100,
      killed: false,
      attribution: { primary: "trinketed" },
    };
    expect(attemptIntoTrinketEvents([burstAttempt], [e1, e2], MATCH_START)).toHaveLength(0);
  });

  it("formatter:burst 行带「burst (no stun)」,Summary 报锚定拆分", () => {
    const e1 = unit("e1");
    const f1 = unit("f1", {
      reaction: 1,
      spellCastEvents: [offensiveCast(40)],
      damageOut: [dmg("f1", "e1", 42, 60_000)],
    });
    const text = formatKillAttemptsForContext(
      extractKillAttempts([f1], [e1], makeCombat(f1, e1)),
    ).join("\n");
    expect(text).toContain("Recklessness burst (no stun)");
    expect(text).toContain("0 stun-anchored, 1 burst-anchored");
    expect(text).not.toMatch(/\(\d+s\)/);
  });
});
