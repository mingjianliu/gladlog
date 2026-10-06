/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { extractCandidateFindings } from "../src/analysis/candidateFindings";
import { CANDIDATE_TYPE_FLAGS } from "../src/data/candidateTypeFlags";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  attemptIntoTrinketEvents,
  extractKillAttempts,
  formatKillAttemptsForContext,
  softerTargetAt,
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
    // read by analyzePlayerCCAndTrinket (the trinket binder's CC instances)
    actionIn: [],
    actionOut: [],
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
    // the trinket binder reads the target's CC instances (zone → LoS lookup)
    startInfo: { zoneId: "1505" },
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

  it("别人给目标上的黑曜鳞片(塑焰者共享,15%)不算目标「交了减伤」;目标自己开的(30%)才算", () => {
    const os = (src: string, atS: number, event: LogEvent): any => ({
      spellId: "363916",
      spellName: "Obsidian Scales",
      srcUnitId: src,
      srcUnitName: src,
      destUnitId: "e1",
      destUnitName: "e1",
      timestamp: ms(atS),
      logLine: { event, timestamp: ms(atS), parameters: [] },
      auraType: "BUFF",
    });
    const f1 = () =>
      unit("f1", { reaction: 1, damageOut: [dmg("f1", "e1", 12, 50_000)] });

    const byAlly = unit("e1", {
      auraEvents: [
        ...stunAuras("e1", KIDNEY, 10, 5),
        os("e2", 11, LogEvent.SPELL_AURA_APPLIED),
        os("e2", 23, LogEvent.SPELL_AURA_REMOVED),
      ],
    });
    const a1 = extractKillAttempts(
      [f1()],
      [byAlly],
      makeCombat(f1(), byAlly),
    )[0];
    expect(a1.attribution?.defensivePopped).toEqual([]);

    const bySelf = unit("e1", {
      auraEvents: [
        ...stunAuras("e1", KIDNEY, 10, 5),
        os("e1", 11, LogEvent.SPELL_AURA_APPLIED),
        os("e1", 23, LogEvent.SPELL_AURA_REMOVED),
      ],
    });
    const a2 = extractKillAttempts(
      [f1()],
      [bySelf],
      makeCombat(f1(), bySelf),
    )[0];
    expect(a2.attribution?.defensivePopped).toEqual(["Obsidian Scales"]);
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

  it("G2 F-K6: a softer candidate sitting in our own breakable CC is skipped", () => {
    const { e1, e2 } = lockedScenario();
    expect(softerTargetAt(e1, [e1, e2], 10, MATCH_START)?.name).toBe("e2");
    expect(
      softerTargetAt(e1, [e1, e2], 10, MATCH_START, (e) => e.id === "e2"),
    ).toBeNull();
  });

  it("G2 F-K6 through extractKillAttempts: our Polymorph on the softer enemy skips it; our Kidney Shot does not", () => {
    const softerWith = (spellId: string) => {
      const { f1, e1, e2 } = lockedScenario();
      // our CC on e2 from 9 to 15 — the attempt on e1 opens at 10
      e2.auraEvents = stunAuras("e2", spellId, 9, 6);
      return extractKillAttempts([f1], [e1, e2], makeCombat(f1, e1, [e2]))[0]!
        .softerTarget;
    };
    // Polymorph (DR Incapacitate): damage would break it — no softer target
    expect(softerWith("118")).toBeUndefined();
    // Kidney Shot (DR Stun): a stunned enemy is still the softer target
    expect(softerWith(KIDNEY)?.name).toBe("e2");
  });

  it("locked 上的失败尝试 + 场上有 prime → 出候选,facts 可验证", () => {
    const { f1, e1, e2, combat } = lockedScenario();
    const attempts = extractKillAttempts([f1], [e1, e2], combat);
    const events = attemptIntoTrinketEvents(attempts);
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
    const attempts = extractKillAttempts(
      [f1],
      [e1, e2],
      makeCombat(f1, e1, [e2]),
    );
    expect(attemptIntoTrinketEvents(attempts)).toHaveLength(0);
  });

  it("尝试成功(击杀)→ 不指控", () => {
    const { f1, e1, e2 } = lockedScenario();
    e1.deathRecords = [{ timestamp: ms(16) }];
    const combat = makeCombat(f1, e1, [e2]);
    const attempts = extractKillAttempts([f1], [e1, e2], combat);
    expect(attemptIntoTrinketEvents(attempts)).toHaveLength(0);
  });

  it("开关:默认退役(flag=false,用户裁决 2026-09-22)零产出;flag=true 时发射器仍接线", () => {
    const { combat } = lockedScenario();
    const has = () =>
      extractCandidateFindings(combat, "f1").some(
        (c) => c.type === "attempt-into-trinket",
      );
    expect(CANDIDATE_TYPE_FLAGS.attemptIntoTrinket).toBe(false);
    expect(has()).toBe(false);
    const savedFlags = { ...CANDIDATE_TYPE_FLAGS };
    CANDIDATE_TYPE_FLAGS.attemptIntoTrinket = true;
    try {
      expect(has()).toBe(true);
    } finally {
      Object.assign(CANDIDATE_TYPE_FLAGS, savedFlags);
    }
  });

  it("softerTarget 与候选共用一个谓词:prime 备选已阵亡 → 既不进事实块也不出候选", () => {
    const { f1, e1, e2 } = lockedScenario();
    e2.deathRecords = [{ timestamp: ms(5) }]; // 交过徽章,但 0:05 已倒
    const combat = makeCombat(f1, e1, [e2]);
    const attempts = extractKillAttempts([f1], [e1, e2], combat);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].softerTarget).toBeUndefined();
    expect(attemptIntoTrinketEvents(attempts)).toHaveLength(0);
  });
});

describe("formatKillAttemptsForContext — 徽章在手不是失误(用户裁决 2026-09-22)", () => {
  it("全员徽章在手(开场形状)→ 行写 no softer target、不出现 locked、汇总计 0", () => {
    const e1 = unit("e1", { auraEvents: stunAuras("e1", KIDNEY, 5, 5) });
    const e2 = unit("e2"); // 徽章还在
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 7, 50_000)],
    });
    const attempts = extractKillAttempts(
      [f1],
      [e1, e2],
      makeCombat(f1, e1, [e2]),
    );
    const text = formatKillAttemptsForContext(attempts).join("\n");
    expect(text).toContain("opportunity: trinket up (no softer target)");
    expect(text).not.toContain("locked");
    expect(text).toContain("0 opened while a softer target existed.");
    expect(text).toContain("not a targeting error");
  });

  it("存在 prime 备选 → 行点名 softer target、汇总计 1", () => {
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
    const attempts = extractKillAttempts(
      [f1],
      [e1, e2],
      makeCombat(f1, e1, [e2]),
    );
    expect(attempts[0].softerTarget).toEqual({
      name: "e2",
      tier: "prime",
      wallsInHand: [],
    });
    const text = formatKillAttemptsForContext(attempts).join("\n");
    expect(text).toContain(
      "opportunity: trinket up (softer target then: e2 — PRIME)",
    );
    expect(text).toContain("1 opened while a softer target existed.");
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

  it("G2 F-K2: a covered burst cluster that alone reaches the kill is kept; the stun attempt did not get it", () => {
    // Kidney 40–45 (credit to 50); Recklessness from 40 (span to ~52);
    // the target dies at 55 — only the burst's credit window holds it
    const e1 = unit("e1", {
      auraEvents: stunAuras("e1", KIDNEY, 40, 5),
      deathRecords: [{ timestamp: ms(55) }],
    });
    const f1 = unit("f1", {
      reaction: 1,
      spellCastEvents: [offensiveCast(40)],
      damageOut: [dmg("f1", "e1", 42, 60_000)],
    });
    const attempts = extractKillAttempts([f1], [e1], makeCombat(f1, e1));
    expect(attempts.map((a) => [a.anchor, a.killed])).toEqual([
      ["stun", false],
      ["burst", true],
    ]);
  });

  it("G2 F-K2: a covered cluster whose death goes to another row stays skipped (no extra FAILED row)", () => {
    // Kidney 40–45 (credit to 50) covers Recklessness 40–52 (credit to 57);
    // a second go at 53 runs past the death at 56, so it gets the kill
    const e1 = unit("e1", {
      auraEvents: stunAuras("e1", KIDNEY, 40, 5),
      deathRecords: [{ timestamp: ms(56) }],
    });
    const f1 = unit("f1", {
      reaction: 1,
      spellCastEvents: [offensiveCast(40), offensiveCast(53)],
      damageOut: [dmg("f1", "e1", 42, 60_000), dmg("f1", "e1", 54, 60_000)],
    });
    const attempts = extractKillAttempts([f1], [e1], makeCombat(f1, e1));
    expect(attempts.map((a) => [a.anchor, a.fromSeconds, a.killed])).toEqual([
      ["stun", 40, false],
      ["burst", 53, true],
    ]);
  });

  it("G2: one death, one KILL — the attempt the death fell inside gets it; the other is a failed attempt", () => {
    // Kidney 40–45 credits a death up to 50; a burst opened at 46 (not
    // overlapping the stun) runs past the death at 48
    const e1 = unit("e1", {
      auraEvents: stunAuras("e1", KIDNEY, 40, 5),
      deathRecords: [{ timestamp: ms(48) }],
    });
    const f1 = unit("f1", {
      reaction: 1,
      spellCastEvents: [offensiveCast(46)],
      damageOut: [dmg("f1", "e1", 42, 60_000), dmg("f1", "e1", 47, 60_000)],
    });
    const attempts = extractKillAttempts([f1], [e1], makeCombat(f1, e1));
    expect(attempts.filter((a) => a.killed)).toHaveLength(1);
    const kill = attempts.find((a) => a.killed)!;
    expect(kill.anchor).toBe("burst");
    expect(kill.killedAtSeconds).toBeCloseTo(48, 6);
    const other = attempts.find((a) => !a.killed)!;
    expect(other.anchor).toBe("stun");
    expect(other.attribution).toBeDefined();
  });

  it("G2 F-K1: a death credited to a KILL in its slack is not 'outside every attempt window'", () => {
    const e1 = unit("e1", {
      auraEvents: stunAuras("e1", KIDNEY, 10, 5),
      deathRecords: [{ timestamp: ms(18) }],
    });
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 50_000)],
    });
    const attempts = extractKillAttempts([f1], [e1], makeCombat(f1, e1));
    expect(attempts[0]!.killed).toBe(true);
    const text = formatKillAttemptsForContext(attempts, [18, 70]).join("\n");
    // 18 s is the KILL's death (in the slack after 15 s); 70 s is outside
    expect(text).toContain(
      "Enemy deaths this round: 2 (1 outside every attempt window)",
    );
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
    expect(attemptIntoTrinketEvents([burstAttempt])).toHaveLength(0);
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

  // 2026-09-15 Opus baseline: 230/309 prompts carried a client-locale name,
  // 328 runs from `popped …` and 93 from `saved by external (…)` — both
  // printed the logged aura/cast name raw instead of resolving it.
  it("popped / external names render in English even when the log is zh-client", async () => {
    await ensureAnalysisData();
    const ASTRAL_SHIFT = "108271";
    const e1 = unit("e1", {
      auraEvents: [
        ...stunAuras("e1", KIDNEY, 10, 5),
        {
          spellId: ASTRAL_SHIFT,
          spellName: "星界转移",
          srcUnitId: "e1",
          srcUnitName: "e1",
          destUnitId: "e1",
          destUnitName: "e1",
          timestamp: ms(12),
          logLine: {
            event: LogEvent.SPELL_AURA_APPLIED,
            timestamp: ms(12),
            parameters: [],
          },
          auraType: "BUFF",
        },
      ],
    });
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 50_000)],
    });
    const a = extractKillAttempts([f1], [e1], makeCombat(f1, e1))[0];
    expect(a.attribution?.primary).toBe("defensive");
    const text = formatKillAttemptsForContext([a]).join("\n");
    expect(text).toContain("popped Astral Shift");
    expect(text).not.toContain("星界转移");
  });
});

describe("formatKillAttemptsForContext — enemy deaths outside attempt windows are a time test (codex review of batch 8)", () => {
  it("a death inside an attempt's window on ANOTHER target is not 'outside every attempt window'", () => {
    const e1 = unit("e1", { auraEvents: stunAuras("e1", KIDNEY, 5, 5) });
    const e2 = unit("e2");
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 7, 50_000)],
    });
    const [a] = extractKillAttempts([f1], [e1, e2], makeCombat(f1, e1, [e2]));
    const inside = formatKillAttemptsForContext(
      [a!],
      [a!.fromSeconds + 1],
    ).join("\n");
    expect(inside).toContain("Enemy deaths this round: 1.");
    expect(inside).not.toContain("outside every attempt window");
    const after = formatKillAttemptsForContext([a!], [a!.toSeconds + 20]).join(
      "\n",
    );
    expect(after).toContain("(1 outside every attempt window)");
  });
});

/**
 * Triage 2026-09-29, enemy-def F-E7 / F-E4 / F-E9 (rulings A11, A20, U3): the
 * enemy-only save sets are failure causes, through the same predicate the
 * [ENEMY DEF] line renders from.
 */
describe("extractKillAttempts — enemy-only saves are failure causes", () => {
  const press = (spellId: string, dest: string, atS: number): any => ({
    spellId,
    spellName: `S${spellId}`,
    destUnitId: dest,
    destUnitName: dest,
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: ms(atS),
      parameters: [],
    },
  });
  const attacker = () =>
    unit("f1", { reaction: 1, damageOut: [dmg("f1", "e1", 12, 50_000)] });

  it("the target's own Dark Pact inside the span → self-saved (Dark Pact)", async () => {
    await ensureAnalysisData();
    const e1 = unit("e1", {
      auraEvents: stunAuras("e1", KIDNEY, 10, 5),
      spellCastEvents: [press("108416", "0000000000000000", 11)],
    });
    const f1 = attacker();
    const [a] = extractKillAttempts([f1], [e1], makeCombat(f1, e1));
    expect(a.attribution?.primary).toBe("self-saved");
    expect(formatKillAttemptsForContext([a]).join("\n")).toContain(
      "FAILED: self-saved (Dark Pact)",
    );
  });

  it("a teammate's Lay on Hands or Leap of Faith on the target → saved by external, one name per spell", async () => {
    await ensureAnalysisData();
    const e1 = unit("e1", { auraEvents: stunAuras("e1", KIDNEY, 10, 5) });
    const e2 = unit("e2", {
      spellCastEvents: [
        press("73325", "e1", 11),
        press("73325", "e1", 13),
        press("471195", "e1", 14),
      ],
    });
    const f1 = attacker();
    const [a] = extractKillAttempts([f1], [e1, e2], makeCombat(f1, e1, [e2]));
    expect(a.attribution?.primary).toBe("external");
    expect(a.attribution?.externalReceived).toEqual([
      "Leap of Faith",
      "Lay on Hands",
    ]);
  });

  it("Roar of Sacrifice the target cast on ITSELF is its self-save; cast on a teammate it is not this target's save", async () => {
    await ensureAnalysisData();
    const onSelf = unit("e1", {
      auraEvents: stunAuras("e1", KIDNEY, 10, 5),
      spellCastEvents: [press("53480", "e1", 11)],
    });
    const f1 = attacker();
    expect(
      extractKillAttempts([f1], [onSelf], makeCombat(f1, onSelf))[0].attribution
        ?.primary,
    ).toBe("self-saved");
    const onMate = unit("e1", {
      auraEvents: stunAuras("e1", KIDNEY, 10, 5),
      spellCastEvents: [press("53480", "e2", 11)],
    });
    const e2 = unit("e2");
    const f2 = attacker();
    expect(
      extractKillAttempts([f2], [onMate, e2], makeCombat(f2, onMate, [e2]))[0]
        .attribution?.primary,
    ).toBe("pressure");
  });
});

/** enemy-def F-E5 / F-E6 (ruling A25): an immunity-kind save inside the span
 * reads "forced a full immunity", whoever applied the aura. */
describe("extractKillAttempts — immunity-kind saves are immunity-baited", () => {
  const auraOn = (spellId: string, src: string, atS: number): any => ({
    spellId,
    spellName: `S${spellId}`,
    srcUnitId: src,
    srcUnitName: src,
    destUnitId: "e1",
    destUnitName: "e1",
    timestamp: ms(atS),
    logLine: {
      event: LogEvent.SPELL_AURA_APPLIED,
      timestamp: ms(atS),
      parameters: [],
    },
    auraType: "BUFF",
  });
  const attempt = (e1: any) => {
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 50_000)],
    });
    return extractKillAttempts([f1], [e1], makeCombat(f1, e1))[0];
  };

  it.each([
    ["378441", "e1", "Time Stop on itself"],
    ["202748", "e1", "Feign Death (Survival Tactics)"],
    ["11327", "e1", "Vanish"],
    [
      "228050",
      "guardian",
      "Guardian of the Forgotten Queen, applied by the summon",
    ],
  ])("aura %s from %s (%s) → immunity-baited", async (id, src) => {
    await ensureAnalysisData();
    const a = attempt(
      unit("e1", {
        auraEvents: [...stunAuras("e1", KIDNEY, 10, 5), auraOn(id, src, 12)],
      }),
    );
    expect(a.attribution?.primary).toBe("immunity-baited");
  });

  it("a Nature's Guardian heal on itself inside the span → immunity-baited; outside it → not", async () => {
    await ensureAnalysisData();
    const heal = (atS: number): any => ({
      spellId: "31616",
      srcUnitId: "e1",
      destUnitId: "e1",
      effectiveAmount: 10,
      logLine: {
        event: LogEvent.SPELL_HEAL,
        timestamp: ms(atS),
        parameters: [],
      },
    });
    expect(
      attempt(
        unit("e1", {
          auraEvents: stunAuras("e1", KIDNEY, 10, 5),
          healIn: [heal(13)],
        }),
      ).attribution?.primary,
    ).toBe("immunity-baited");
    expect(
      attempt(
        unit("e1", {
          auraEvents: stunAuras("e1", KIDNEY, 10, 5),
          healIn: [heal(60)],
        }),
      ).attribution?.immunityBaited,
    ).toBe(false);
  });
});

/** enemy-def F-E1a: Blur's wall is logged as aura 212800 while its table row
 * is the cast 198589 — the attribution resolves the aura to that row. */
describe("extractKillAttempts — a cast-keyed wall found under its aura id", () => {
  it("Blur (aura 212800) inside the span → popped Blur", async () => {
    await ensureAnalysisData();
    const e1 = unit("e1", {
      spec: "577",
      auraEvents: [
        ...stunAuras("e1", KIDNEY, 10, 5),
        {
          spellId: "212800",
          spellName: "疾影",
          srcUnitId: "e1",
          srcUnitName: "e1",
          destUnitId: "e1",
          destUnitName: "e1",
          timestamp: ms(12),
          logLine: {
            event: LogEvent.SPELL_AURA_APPLIED,
            timestamp: ms(12),
            parameters: [],
          },
          auraType: "BUFF",
        },
      ],
    });
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 12, 50_000)],
    });
    const [a] = extractKillAttempts([f1], [e1], makeCombat(f1, e1));
    expect(a.attribution?.primary).toBe("defensive");
    expect(formatKillAttemptsForContext([a]).join("\n")).toContain(
      "FAILED: popped Blur",
    );
  });
});

/**
 * Triage 2026-09-29, enemy-def F-E22 + crisis-external F-E22b + F-E24 + the
 * Anti-Magic Shell gate (rulings A29, A30, A′4, A7-补): what window each
 * failure cause is read over, and when a school-limited save counts.
 */
describe("attributeFailure — windows, bound trinket, school gates", () => {
  const POLYMORPH = "118";
  const BARKSKIN = "22812";
  const DIVINE_SHIELD = "642";
  const BOP = "1022";
  const AMS = "48707";
  const GUARDIAN_SPIRIT = "47788";
  const BOSAC = "6940";
  const TRINKET = "336126";
  const MASS_INVISIBILITY = "414664";
  const BURROW = "409293";
  const TIME_STOP = "378441";

  const auraEv = (
    spellId: string,
    src: string,
    dest: string,
    atS: number,
    event: LogEvent,
  ): any => ({
    spellId,
    spellName: `S${spellId}`,
    srcUnitId: src,
    srcUnitName: src,
    destUnitId: dest,
    destUnitName: dest,
    timestamp: ms(atS),
    logLine: { event, timestamp: ms(atS), parameters: [] },
    auraType: "BUFF",
  });
  const up = (
    id: string,
    src: string,
    dest: string,
    fromS: number,
    toS: number,
  ) => [
    auraEv(id, src, dest, fromS, LogEvent.SPELL_AURA_APPLIED),
    auraEv(id, src, dest, toS, LogEvent.SPELL_AURA_REMOVED),
  ];
  const press = (spellId: string, dest: string, atS: number): any => ({
    spellId,
    spellName: `S${spellId}`,
    destUnitId: dest,
    destUnitName: dest,
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: ms(atS),
      parameters: [],
    },
  });
  /** team damage on e1 at 12 s in one school (0x1 physical, 0x20 shadow) */
  const hit = (school: string, amount = 50_000): any => ({
    ...dmg("f1", "e1", 12, amount),
    spellSchoolId: school,
  });
  const attacker = (hits: any[] = [hit("0x1")]) =>
    unit("f1", { reaction: 1, damageOut: hits });
  // the stun runs 10–15 s; the kill-credit slack ends at 20 s
  const stunned = (over: Record<string, unknown> = {}) =>
    unit("e1", { auraEvents: stunAuras("e1", KIDNEY, 10, 5), ...over });
  // One hit is one record on both sides of a parsed log: the attacker's
  // `damageOut` and the victim's `damageIn` (the school share reads the
  // victim's, so a pet's hits and absorbed hits are in it).
  const run = (e1: any, f1 = attacker(), mates: any[] = []) => {
    const target = {
      ...e1,
      damageIn: [
        ...(e1.damageIn ?? []),
        ...f1.damageOut.filter((d: any) => d.destUnitId === e1.id),
      ],
    };
    return extractKillAttempts(
      [f1],
      [target, ...mates],
      makeCombat(f1, target, mates),
    )[0];
  };
  /** a hit on e1 at 12 s that a shield ate whole (SPELL_ABSORBED, spell form) */
  const eaten = (school: string, amount: number): any => ({
    spellId: "48707",
    spellName: "Anti-Magic Shell",
    srcUnitId: "e1",
    destUnitId: "e1",
    attackerId: "f1",
    attackSpellId: "999999999",
    absorbedAmount: amount,
    timestamp: ms(12),
    logLine: {
      event: "SPELL_ABSORBED",
      timestamp: ms(12),
      parameters: [0, 0, 0, 0, 0, 0, 0, 0, 999999999, "x", school],
    },
  });

  it("rule 3′: a wall popped in the slack after the span is not the cause; one popped inside it is", async () => {
    await ensureAnalysisData();
    const after = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(BARKSKIN, "e1", "e1", 17, 29),
        ],
      }),
    );
    expect(after.attribution?.defensivePopped).toEqual([]);
    expect(after.attribution?.primary).toBe("pressure");
    const inside = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(BARKSKIN, "e1", "e1", 13, 25),
        ],
      }),
    );
    expect(inside.attribution?.primary).toBe("defensive");
  });

  it("rule 2: a wall already up when the attempt began is the cause, rendered with the second it went up", async () => {
    await ensureAnalysisData();
    const a = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(BARKSKIN, "e1", "e1", 4.3, 16.3),
        ],
      }),
    );
    expect(a.attribution?.primary).toBe("defensive");
    expect(formatKillAttemptsForContext([a]).join("\n")).toContain(
      "FAILED: popped Barkskin [up since 0:04]",
    );
    // one that had already ended before the attempt is nothing
    const ended = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(BARKSKIN, "e1", "e1", 1, 9),
        ],
      }),
    );
    expect(ended.attribution?.primary).toBe("pressure");
  });

  it("the save window is the attempt as it renders: a wall in the span's last rendered second counts, one in the next does not", async () => {
    await ensureAnalysisData();
    // Kidney 10–15.5 s renders [0:10–0:15]
    const at = (fromS: number) =>
      run(
        unit("e1", {
          auraEvents: [
            ...stunAuras("e1", KIDNEY, 10, 5.5),
            ...up(BARKSKIN, "e1", "e1", fromS, fromS + 8),
          ],
        }),
      );
    expect(at(15.4).attribution?.primary).toBe("defensive");
    expect(at(15.6).attribution?.primary).toBe("defensive"); // also 0:15
    expect(at(16.1).attribution?.primary).toBe("pressure"); // 0:16
  });

  it("an immunity keeps the slack: popped after the span, inside the credit window, it still ends the go", async () => {
    await ensureAnalysisData();
    const a = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(DIVINE_SHIELD, "e1", "e1", 17, 25),
        ],
      }),
    );
    expect(a.attribution?.primary).toBe("immunity-baited");
  });

  it("rule 2 for an immunity: one already up when the attempt began says since when; a 'moment' immunity whose aura lingers is not a cause", async () => {
    await ensureAnalysisData();
    // Blessing of Protection up 4.3–14.3 s, a physical go at 10–15 s
    const bop = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(BOP, "e2", "e1", 4.3, 14.3),
        ],
      }),
    );
    expect(bop.attribution?.primary).toBe("immunity-baited");
    expect(bop.attribution?.immunityUpSinceS).toBeCloseTo(4.3, 6);
    expect(formatKillAttemptsForContext([bop]).join("\n")).toContain(
      "FAILED: forced a full immunity [up since 0:04] (a win — re-open after it drops)",
    );
    // Mass Invisibility (aura 414664) counts exactly like Vanish (user ruling
    // U-KA3b, 2026-10-06): up on the target as the attempt began, it is why
    // the attempt failed. Until then it was a 'moment' immunity and this
    // attempt read "pressure".
    const massInvis = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(MASS_INVISIBILITY, "e2", "e1", 9.5, 10.4),
        ],
      }),
    );
    expect(massInvis.attribution?.primary).toBe("immunity-baited");
    expect(massInvis.attribution?.immunityUpSinceS).toBeCloseTo(9.5, 6);
    // …and gone before the attempt began, it is nothing
    const massInvisOver = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(MASS_INVISIBILITY, "e2", "e1", 4, 4.6),
        ],
      }),
    );
    expect(massInvisOver.attribution?.immunityBaited).toBe(false);
    // User ruling P-FU-b8 (option C): only an aura the log SAW end. A Mass
    // Invisibility whose REMOVED was never logged is closed at its official
    // 12 s by the interval builder (`inferredEnd`) — "up" at the attempt's
    // start by that cap alone, with a stun landing on the target.
    const massInvisUnseen = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          auraEv(MASS_INVISIBILITY, "e2", "e1", 4, LogEvent.SPELL_AURA_APPLIED),
        ],
      }),
    );
    expect(massInvisUnseen.attribution?.immunityBaited).toBe(false);
    // the same for Vanish and Burrow: one rule for the ruled-in auras
    for (const id of ["11327", BURROW]) {
      const unseen = run(
        stunned({
          auraEvents: [
            ...stunAuras("e1", KIDNEY, 10, 5),
            auraEv(id, "e1", "e1", 9, LogEvent.SPELL_AURA_APPLIED),
          ],
        }),
      );
      expect(unseen.attribution?.immunityBaited, id).toBe(false);
    }
    // a pct-100 table row keeps the cap: a Divine Shield with no logged
    // REMOVED is still why the attempt failed
    const shieldUnseen = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          auraEv(DIVINE_SHIELD, "e1", "e1", 8, LogEvent.SPELL_AURA_APPLIED),
        ],
      }),
    );
    expect(shieldUnseen.attribution?.primary).toBe("immunity-baited");
    // Burrow (user ruling U-KA3, 2026-10-06): the unit cannot be attacked
    // while it is burrowed — up at the start, it is why the attempt failed.
    // What lands through it is a DoT already ticking and area damage (605
    // files: 78 of 89 auras take a periodic tick, 16 any other damage row).
    const burrow = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(BURROW, "e1", "e1", 9, 14),
        ],
      }),
    );
    expect(burrow.attribution?.primary).toBe("immunity-baited");
    expect(burrow.attribution?.immunityUpSinceS).toBeCloseTo(9, 6);
    // Vanish, the same ruling: the aura 11327 up as the attempt began
    const vanish = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up("11327", "e1", "e1", 9.4, 10.9),
        ],
      }),
    );
    expect(vanish.attribution?.primary).toBe("immunity-baited");
    expect(vanish.attribution?.immunityUpSinceS).toBeCloseTo(9.4, 6);
    // Cauterize's aura lingers 6 s after the hit it refused — still a moment
    const cauterize = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up("87023", "e1", "e1", 8, 14),
        ],
      }),
    );
    expect(cauterize.attribution?.immunityBaited).toBe(false);
    // Time Stop's aura IS the immunity (DB2 aura 39, every school): thrown
    // on the target before the attempt, it is why the attempt failed
    const timeStop = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(TIME_STOP, "e2", "e1", 9.2, 14.2),
        ],
      }),
    );
    expect(timeStop.attribution?.primary).toBe("immunity-baited");
    expect(timeStop.attribution?.immunityUpSinceS).toBeCloseTo(9.2, 6);
    // …but going up INSIDE the attempt it is the immunity ruling A25 signed,
    // and carries no [up since]
    const inside = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(MASS_INVISIBILITY, "e2", "e1", 13, 25),
        ],
      }),
    );
    expect(inside.attribution?.primary).toBe("immunity-baited");
    expect(inside.attribution?.immunityUpSinceS).toBeUndefined();
    expect(formatKillAttemptsForContext([inside]).join("\n")).toContain(
      "FAILED: forced a full immunity (a win — re-open after it drops)",
    );
  });

  it("rule 1: a trinket in the slack that broke ANOTHER control is not this attempt's trinket", async () => {
    await ensureAnalysisData();
    // Kidney 10–15; a Polymorph lands at 17 and the trinket at 18 breaks it
    const other = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...stunAuras("e1", POLYMORPH, 17, 1),
        ],
        spellCastEvents: [press(TRINKET, "0000000000000000", 18)],
      }),
    );
    expect(other.attribution?.trinketed).toBe(false);
    expect(other.attribution?.primary).toBe("pressure");
    // the trinket that ends the Kidney itself counts
    const own = run(
      stunned({
        auraEvents: stunAuras("e1", KIDNEY, 10, 2),
        spellCastEvents: [press(TRINKET, "0000000000000000", 12)],
      }),
    );
    expect(own.attribution?.primary).toBe("trinketed");
  });

  it("A29: a bound trinket and an immunity are both named", async () => {
    await ensureAnalysisData();
    const a = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 2),
          ...up(DIVINE_SHIELD, "e1", "e1", 13, 21),
        ],
        spellCastEvents: [press(TRINKET, "0000000000000000", 12)],
      }),
    );
    expect(a.attribution?.primary).toBe("trinketed");
    expect(formatKillAttemptsForContext([a]).join("\n")).toContain(
      "FAILED: target trinketed out; forced a full immunity (a win — re-open after it drops)",
    );
  });

  it("A30: Blessing of Protection is a full immunity against a physical go, an external against a magic one", async () => {
    await ensureAnalysisData();
    const withBop = () =>
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(BOP, "e2", "e1", 12, 22),
        ],
      });
    const pal = () => unit("e2", { spellCastEvents: [press(BOP, "e1", 12)] });
    const physical = run(withBop(), attacker([hit("0x1")]), [pal()]);
    expect(physical.attribution?.primary).toBe("immunity-baited");
    const magic = run(
      withBop(),
      attacker([hit("0x20", 76_000), hit("0x1", 24_000)]),
      [pal()],
    );
    expect(magic.attribution?.immunityBaited).toBe(false);
    expect(magic.attribution?.primary).toBe("external");
    expect(magic.attribution?.externalReceived).toEqual([
      "Blessing of Protection",
    ]);
  });

  it("A7-补: Anti-Magic Shell is the save only when at least half of the team's damage was magic", async () => {
    await ensureAnalysisData();
    const dk = () =>
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(AMS, "e1", "e1", 11, 16),
        ],
        spellCastEvents: [press(AMS, "0000000000000000", 11)],
      });
    const magic = run(
      dk(),
      attacker([hit("0x20", 60_000), hit("0x1", 40_000)]),
    );
    expect(magic.attribution?.primary).toBe("self-saved");
    expect(magic.attribution?.selfSaved).toEqual(["Anti-Magic Shell"]);
    const physical = run(
      dk(),
      attacker([hit("0x20", 44_000), hit("0x1", 56_000)]),
    );
    expect(physical.attribution?.selfSaved).toEqual([]);
    expect(physical.attribution?.primary).toBe("pressure");
  });

  it("the school share reads the target's record: a pet's hits and the hits the shield ate count", async () => {
    await ensureAnalysisData();
    // A hunter's pet: its physical hits are in the target's damageIn and in
    // no friendly PLAYER's damageOut. 30k shadow from the player, 70k
    // physical from the pet → Blessing of Protection is the immunity.
    const bopped = stunned({
      auraEvents: [
        ...stunAuras("e1", KIDNEY, 10, 5),
        ...up(BOP, "e2", "e1", 12, 22),
      ],
      damageIn: [{ ...hit("0x1", 70_000), srcUnitId: "pet-of-f1" }],
    });
    const pal = unit("e2", { spellCastEvents: [press(BOP, "e1", 12)] });
    const pet = run(bopped, attacker([hit("0x20", 30_000)]), [pal]);
    expect(pet.attribution?.primary).toBe("immunity-baited");
    // Anti-Magic Shell: 44k shadow landed against 56k physical — but the
    // shell ate another 20k of shadow. 64 of 120 is its school.
    const dk = (absorbsIn: any[]) =>
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(AMS, "e1", "e1", 11, 16),
        ],
        spellCastEvents: [press(AMS, "0000000000000000", 11)],
        absorbsIn,
      });
    const hits = () => attacker([hit("0x20", 44_000), hit("0x1", 56_000)]);
    expect(run(dk([]), hits()).attribution?.primary).toBe("pressure");
    const ate = run(dk([eaten("0x20", 20_000)]), hits());
    expect(ate.attribution?.primary).toBe("self-saved");
    expect(ate.attribution?.selfSaved).toEqual(["Anti-Magic Shell"]);
  });

  it("a target whose own record holds no damage: an immunity still counts, an absorb does not", async () => {
    await ensureAnalysisData();
    // An attempt needs 30k on the target in the attackers' `damageOut`, so
    // this needs a target record with nothing in it — built here without
    // the mirroring `run` does. (Every hit into Blessing of Protection is an
    // IMMUNE miss with no amount; a shell nothing hit saved nobody.)
    const bare = (e1: any, mates: any[] = []) => {
      const f1 = attacker();
      return extractKillAttempts(
        [f1],
        [e1, ...mates],
        makeCombat(f1, e1, mates),
      )[0];
    };
    const bop = bare(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(BOP, "e2", "e1", 12, 22),
        ],
      }),
    );
    expect(bop.attribution?.primary).toBe("immunity-baited");
    const ams = bare(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(AMS, "e1", "e1", 11, 16),
        ],
        spellCastEvents: [press(AMS, "0000000000000000", 11)],
      }),
    );
    expect(ams.attribution?.selfSaved).toEqual([]);
    expect(ams.attribution?.primary).toBe("pressure");
  });

  it("rule 2 for an external: thrown before the attempt and still on the target when it began", async () => {
    await ensureAnalysisData();
    const AMS_ALLY = "410358";
    const LEAP_OF_FAITH = "73325";
    const SPELLWARDING = "204018";
    const withAura = (id: string, fromS: number, toS: number) =>
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(id, "e2", "e1", fromS, toS),
        ],
      });
    const mate = (id: string, atS: number) =>
      unit("e2", { spellCastEvents: [press(id, "e1", atS)] });
    // the ally's Anti-Magic Shell 0.5 s before the first stun, a magic go
    const shell = run(
      withAura(AMS_ALLY, 9.5, 15.5),
      attacker([hit("0x20", 70_000), hit("0x1", 30_000)]),
      [mate(AMS_ALLY, 9.5)],
    );
    expect(shell.attribution?.primary).toBe("external");
    expect(formatKillAttemptsForContext([shell]).join("\n")).toContain(
      "FAILED: saved by external (Anti-Magic Shell [up since 0:09])",
    );
    // cast 0.1 s before the attempt, its aura going up 0.1 s into it
    const justBefore = run(
      withAura(AMS_ALLY, 10.1, 16.1),
      attacker([hit("0x20", 70_000), hit("0x1", 30_000)]),
      [mate(AMS_ALLY, 9.9)],
    );
    expect(justBefore.attribution?.externalReceived).toEqual([
      "Anti-Magic Shell",
    ]);
    // …one that had dropped before the attempt began is nothing
    const dropped = run(
      withAura(AMS_ALLY, 3, 9),
      attacker([hit("0x20", 70_000), hit("0x1", 30_000)]),
      [mate(AMS_ALLY, 3)],
    );
    expect(dropped.attribution?.externalReceived).toEqual([]);
    // a grip is a moment: before the attempt it is not its cause
    const grip = run(withAura(LEAP_OF_FAITH, 9.5, 10.5), attacker(), [
      mate(LEAP_OF_FAITH, 9.5),
    ]);
    expect(grip.attribution?.externalReceived).toEqual([]);
    expect(grip.attribution?.primary).toBe("pressure");
    // the cast missing from the log: the aura alone renders an [ENEMY DEF]
    // external line, and KILL ATTEMPTS reads that same event
    const auraOnly = run(
      withAura(AMS_ALLY, 9.5, 15.5),
      attacker([hit("0x20", 70_000), hit("0x1", 30_000)]),
      [unit("e2")],
    );
    expect(auraOnly.attribution?.primary).toBe("external");
    expect(auraOnly.attribution?.externalReceived).toEqual([
      "Anti-Magic Shell",
    ]);
    // c2058ed4 R:623 to the millisecond: Spellwarding at 10.04 s, the first
    // stun at 10.14 s — the same rendered second — and a physical go
    const sameSecond = run(
      unit("e1", {
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10.14, 2.73),
          ...up(SPELLWARDING, "e2", "e1", 10.04, 20.04),
        ],
      }),
      attacker(),
      [mate(SPELLWARDING, 10.04)],
    );
    expect(sameSecond.attribution?.externalReceived).toEqual([]);
    expect(sameSecond.attribution?.immunityBaited).toBe(false);
    // c2058ed4 R:623: Blessing of Spellwarding still up, the go is physical
    const warded = run(withAura(SPELLWARDING, 9.86, 19.86), attacker(), [
      mate(SPELLWARDING, 9.86),
    ]);
    expect(warded.attribution?.immunityBaited).toBe(false);
    expect(warded.attribution?.externalReceived).toEqual([]);
    expect(warded.attribution?.primary).toBe("pressure");
  });

  it("rule 2 for a self-save: Guardian Spirit pressed on oneself just before the first stun counts; Blessing of Sacrifice thrown at an ally does not", async () => {
    await ensureAnalysisData();
    // 537209d8: self Guardian Spirit 0.14 s before the first stun
    const priest = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(GUARDIAN_SPIRIT, "e1", "e1", 9.86, 21.86),
        ],
        spellCastEvents: [press(GUARDIAN_SPIRIT, "e1", 9.86)],
      }),
    );
    expect(priest.attribution?.primary).toBe("self-saved");
    expect(formatKillAttemptsForContext([priest]).join("\n")).toContain(
      "FAILED: self-saved (Guardian Spirit [up since 0:09])",
    );
    // pressed before the attempt, aura only up after it: no save of it
    const late = run(
      unit("e1", {
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 0.2),
          ...up(GUARDIAN_SPIRIT, "e1", "e1", 11.1, 21.1),
        ],
        spellCastEvents: [press(GUARDIAN_SPIRIT, "e1", 9.8)],
      }),
    );
    expect(late.attribution?.selfSaved).toEqual([]);
    // the paladin's own 6940 aura after casting it on a teammate
    const pal = run(
      stunned({
        auraEvents: [
          ...stunAuras("e1", KIDNEY, 10, 5),
          ...up(BOSAC, "e1", "e1", 7, 19),
        ],
        spellCastEvents: [press(BOSAC, "e2", 7)],
      }),
      attacker(),
      [unit("e2")],
    );
    expect(pal.attribution?.selfSaved).toEqual([]);
  });

  it("A′4: an external cast in the slack after the span is not the save", async () => {
    await ensureAnalysisData();
    const mate = unit("e2", {
      spellCastEvents: [press(GUARDIAN_SPIRIT, "e1", 18.3)],
    });
    const a = run(stunned(), attacker(), [mate]);
    expect(a.attribution?.externalReceived).toEqual([]);
    expect(a.attribution?.primary).toBe("pressure");
  });
});

/** enemy-def F-E21 (ruling A′15): a racial or class ability that removed a
 * stun of the attempt is its cause, like the trinket; and a trinket-equivalent
 * racial locks the trinket for the kill-opportunity tier. */
describe("extractKillAttempts — broke out with a racial / class ability", () => {
  const press = (spellId: string, atS: number): any => ({
    spellId,
    spellName: `S${spellId}`,
    destUnitId: "0000000000000000",
    destUnitName: "nil",
    timestamp: ms(atS),
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: ms(atS),
      parameters: [],
    },
  });
  const attacker = () =>
    unit("f1", { reaction: 1, damageOut: [dmg("f1", "e1", 11, 50_000)] });

  it("Will to Survive ending the stun → broke out (Will to Survive); the racial's trinket lock does NOT change the next attempt's tier (ruling P-b7)", async () => {
    await ensureAnalysisData();
    const e1 = unit("e1", {
      // first stun broken at 12 s by Will to Survive; a second one at 40 s
      auraEvents: [
        ...stunAuras("e1", KIDNEY, 10, 2),
        ...stunAuras("e1", KIDNEY, 40, 5),
      ],
      spellCastEvents: [press("59752", 12)],
    });
    const f1 = unit("f1", {
      reaction: 1,
      damageOut: [dmg("f1", "e1", 11, 50_000), dmg("f1", "e1", 42, 50_000)],
    });
    const [first, second] = extractKillAttempts([f1], [e1], makeCombat(f1, e1));
    expect(first.attribution?.primary).toBe("broke-out");
    expect(formatKillAttemptsForContext([first]).join("\n")).toContain(
      "FAILED: broke out (Will to Survive)",
    );
    expect(first.opportunity.tier).toBe("locked"); // trinket up at 10 s
    // 40 s is inside the racial's shared lock (12 + 60). User ruling P-b7
    // (2026-10-01): that lock must not make the target "trinket-less".
    expect(second.opportunity.trinketAvailable).toBe(true);
    expect(second.opportunity.tier).toBe("locked");
  });

  it("Blink out of the stun → broke out (Blink); Icebound Fortitude stays a popped wall", async () => {
    await ensureAnalysisData();
    const mage = unit("e1", {
      auraEvents: stunAuras("e1", KIDNEY, 10, 2),
      spellCastEvents: [press("1953", 12)],
    });
    const f1 = attacker();
    expect(
      extractKillAttempts([f1], [mage], makeCombat(f1, mage))[0].attribution
        ?.primary,
    ).toBe("broke-out");
    const dk = unit("e1", {
      spec: "252",
      auraEvents: [
        ...stunAuras("e1", KIDNEY, 10, 2),
        {
          spellId: "48792",
          spellName: "Icebound Fortitude",
          srcUnitId: "e1",
          srcUnitName: "e1",
          destUnitId: "e1",
          destUnitName: "e1",
          timestamp: ms(12),
          logLine: {
            event: LogEvent.SPELL_AURA_APPLIED,
            timestamp: ms(12),
            parameters: [],
          },
          auraType: "BUFF",
        },
      ],
      spellCastEvents: [press("48792", 12)],
    });
    const f2 = attacker();
    const a = extractKillAttempts([f2], [dk], makeCombat(f2, dk))[0];
    expect(a.attribution?.brokeOut).toEqual([]);
    expect(a.attribution?.primary).toBe("defensive");
  });
});
