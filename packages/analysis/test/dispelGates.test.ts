/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Feasibility gates for blaming a missed cleanse (decided by the user
 * 2026-08-02) — a "you didn't dispel" accusation must first pass:
 *  gate a LoS/range: every dispeller holding that answer was out of reach
 *    (only judged when position data exists; no data → no change of verdict)
 *  gate b+c unable to cast: hard CC / silence auras ∪ kick lockout, leaving
 *    less free time inside the window than the reaction threshold (3s)
 *  gate d DR context: the target's DR category is fully fresh AND they are
 *    re-CC'd by the same category within 10s of the window ending — this does
 *    NOT block, but annotates the finding as "advise with caution" (dispelling
 *    may simply buy a full-duration re-CC).
 * Corpus baseline (150 matches / 766 rounds): Binding Shot is the #1 coaching
 * candidate (x106), and the four gates together are expected to block ~24% of
 * blame candidates.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  missedCleanseEvents,
  missedPurgeEvents,
} from "../src/analysis/candidateFindings";
import { kickLockoutSeconds } from "../src/data/spellEffectData";
import {
  formatMissedCleanseExemption,
  formatMissedPurgeExemption,
  purgePriorityForTest,
  reconstructDispelSummary,
} from "../src/utils/dispelAnalysis";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeInterruptEvent,
  makeUnit,
} from "./ported/testHelpers";

const S = (sec: number) => MATCH_START + sec * 1000;
const MATCH_START = 1_000_000;
const COMBAT = { startTime: MATCH_START, endTime: MATCH_START + 120_000 };

/** Binding Shot (the false positive the user called out): cc/Magic, 3s tier. */
const BINDING_SHOT = "117526";
/** Hard CC sitting on the dispeller (Polymorph, cc category,
 * isCastBlockingAuraType=true). */
const POLY = "118";

/** Put a Binding Shot on target t1 from fromS→toS (applied by enemy e1,
 * expiring naturally). */
function targetWithBinding(fromS: number, toS: number, extra: any[] = []) {
  return makeUnit("t1", {
    spec: CombatUnitSpec.Warrior_Arms,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        BINDING_SHOT,
        S(fromS),
        "e1",
        "t1",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        BINDING_SHOT,
        S(toS),
        "e1",
        "t1",
      ),
      ...extra,
    ],
  });
}

/** A dispeller holding the Magic answer (Discipline Priest). */
function discPriest(id: string, overrides: any = {}) {
  return makeUnit(id, { spec: CombatUnitSpec.Priest_Discipline, ...overrides });
}

const enemy = () =>
  makeUnit("e1", { spec: CombatUnitSpec.Hunter_Marksmanship });

function summarize(friends: any[], combat: any = COMBAT) {
  return reconstructDispelSummary(friends as any, [enemy()] as any, combat);
}

/** All missed-cleanse windows in this file are Binding Shot (dispelType
 * Magic); a Discipline Priest is a MAGIC_REMOVERS spec, so this owner
 * identity is a capability-gate no-op — these tests exercise the feasibility
 * gates (a/b+c/d), not the 2026-08-05 owner-capability gate (that gate has
 * its own coverage in candidateFindings.test.ts). */
const DISPEL_OWNER = { spec: CombatUnitSpec.Priest_Discipline };

describe("门 b+c 无法施法(硬控∪踢锁,自由时间 < 3s 反应阈值)", () => {
  it("基线:无任何门数据 → 窗口成立且不豁免,候选照常产出", () => {
    const ds = summarize([targetWithBinding(10, 16), discPriest("h1")]);
    expect(ds.missedCleanseWindows).toHaveLength(1);
    const w = ds.missedCleanseWindows[0];
    expect(w.dispellersLockedOut).toBe(false);
    expect(w.losReachable).toBeNull(); // no position data: tri-state null, verdict unchanged
    expect(
      missedCleanseEvents(ds.missedCleanseWindows, DISPEL_OWNER, [], false),
    ).toHaveLength(1);
  });

  it("驱散者被硬控吃掉反应窗(6s 窗只自由 2s)→ 豁免,候选不出", () => {
    const h1 = discPriest("h1", {
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, POLY, S(9.5), "e1", "h1"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, POLY, S(14), "e1", "h1"),
      ],
    });
    const ds = summarize([targetWithBinding(10, 16), h1]);
    expect(ds.missedCleanseWindows).toHaveLength(1);
    expect(ds.missedCleanseWindows[0].dispellersLockedOut).toBe(true);
    expect(
      missedCleanseEvents(ds.missedCleanseWindows, DISPEL_OWNER, [], false),
    ).toHaveLength(0);
  });

  it("长窗口只锁一小段(16s 窗自由 13s)→ 不豁免", () => {
    const h1 = discPriest("h1", {
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, POLY, S(10), "e1", "h1"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, POLY, S(13), "e1", "h1"),
      ],
    });
    const ds = summarize([targetWithBinding(10, 26), h1]);
    expect(ds.missedCleanseWindows[0].dispellersLockedOut).toBe(false);
    expect(
      missedCleanseEvents(ds.missedCleanseWindows, DISPEL_OWNER, [], false),
    ).toHaveLength(1);
  });

  it("踢锁计入无法施法(4s 窗被 3s 锁吃剩 1s)→ 豁免", () => {
    // An unknown interrupt id falls back to a conservative 3s lockout (the same
    // fallback predicate as ccTrinketAnalysis)
    expect(kickLockoutSeconds("999999")).toBe(3);
    // GH #62 (2026-09-02) → 2026-09-04: known kicks read the official DB2 PvP
    // duration (corpus scan = verification gate) —
    // before it every kick answered the fallback. Counterspell 5, Wind Shear 2,
    // Spell Lock (felhunter) 5, Quell 4, melee kicks 3 (12.1 archive, 605 files).
    expect(kickLockoutSeconds("2139")).toBe(5);
    expect(kickLockoutSeconds("57994")).toBe(2);
    expect(kickLockoutSeconds("19647")).toBe(5);
    expect(kickLockoutSeconds("351338")).toBe(4);
    expect(kickLockoutSeconds("1766")).toBe(3);
    const h1 = discPriest("h1", {
      actionIn: [
        makeInterruptEvent("999999", "Kick", "585", "Smite", S(10), "e1"),
      ],
    });
    const ds = summarize([targetWithBinding(10, 14), h1]);
    expect(ds.missedCleanseWindows).toHaveLength(1);
    expect(ds.missedCleanseWindows[0].dispellersLockedOut).toBe(true);
    expect(
      missedCleanseEvents(ds.missedCleanseWindows, DISPEL_OWNER, [], false),
    ).toHaveLength(0);
  });

  it("多驱散者:任一自由即不豁免(交集语义)", () => {
    const h1 = discPriest("h1", {
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, POLY, S(9), "e1", "h1"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, POLY, S(16), "e1", "h1"),
      ],
    });
    const h2 = discPriest("h2"); // free the whole time
    const ds = summarize([targetWithBinding(10, 16), h1, h2]);
    expect(ds.missedCleanseWindows[0].dispellersLockedOut).toBe(false);
  });
});

describe("门 a LoS/射程(三态:有数据且全员够不着才豁免)", () => {
  const far = (id: string) =>
    discPriest(id, {
      advancedActions: [
        makeAdvancedAction(S(9), 0, 0),
        makeAdvancedAction(S(14), 0, 0),
      ],
    });
  it("全员超 40 码射程 → losReachable=false,候选不出", () => {
    const t1 = targetWithBinding(10, 16);
    (t1 as any).advancedActions = [
      makeAdvancedAction(S(9), 50, 0),
      makeAdvancedAction(S(14), 50, 0),
    ].map((a) => ({ ...a, advancedActorId: "t1" }));
    const ds = summarize([t1, far("h1")], { ...COMBAT, zoneId: "0" });
    expect(ds.missedCleanseWindows[0].losReachable).toBe(false);
    expect(
      missedCleanseEvents(ds.missedCleanseWindows, DISPEL_OWNER, [], false),
    ).toHaveLength(0);
  });

  it("射程内(30 码)→ losReachable=true,候选照常", () => {
    const t1 = targetWithBinding(10, 16);
    (t1 as any).advancedActions = [
      makeAdvancedAction(S(9), 30, 0),
      makeAdvancedAction(S(14), 30, 0),
    ].map((a) => ({ ...a, advancedActorId: "t1" }));
    const ds = summarize([t1, far("h1")], { ...COMBAT, zoneId: "0" });
    expect(ds.missedCleanseWindows[0].losReachable).toBe(true);
    expect(
      missedCleanseEvents(ds.missedCleanseWindows, DISPEL_OWNER, [], false),
    ).toHaveLength(1);
  });

  it("无位置数据 → null,不改判(非 advanced 语料的教学不许被吞)", () => {
    const ds = summarize([targetWithBinding(10, 16), discPriest("h1")], {
      ...COMBAT,
      zoneId: "0",
    });
    expect(ds.missedCleanseWindows[0].losReachable).toBeNull();
    expect(
      missedCleanseEvents(ds.missedCleanseWindows, DISPEL_OWNER, [], false),
    ).toHaveLength(1);
  });
});

describe("门 d DR 语境(全新鲜 + 10s 内同类续控 → 注解不拦)", () => {
  it("窗口结束后 8s 内目标再吃同 DR 类控制且 DR 全新鲜 → drChainRisk=true,候选仍产出", () => {
    // After the previous Binding Shot window (10→16) ends, the target is CC'd
    // again at S22 (the same DR category is constructed with the same id)
    const t1 = targetWithBinding(10, 16, [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        BINDING_SHOT,
        S(22),
        "e1",
        "t1",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        BINDING_SHOT,
        S(24),
        "e1",
        "t1",
      ),
    ]);
    const ds = summarize([t1, discPriest("h1")]);
    const w = ds.missedCleanseWindows.find((x) => x.timeSeconds === 10)!;
    expect(w.drChainRisk).toBe(true);
    // Annotating is not blocking: the candidate survives (carrying the DR fact)
    // and the coaching wording is softened instead
    expect(
      missedCleanseEvents(
        ds.missedCleanseWindows,
        DISPEL_OWNER,
        [],
        false,
      ).some((c) => c.t === 10 && c.facts.drChainRisk === "yes"),
    ).toBe(true);
  });

  it("无后续同类控制 → drChainRisk=false", () => {
    const ds = summarize([targetWithBinding(10, 16), discPriest("h1")]);
    expect(ds.missedCleanseWindows[0].drChainRisk).toBe(false);
  });

  it("DR 已递减 × 签字 afterDR: skip(束缚射击)→ 窗口整个消失(2026-08-19 裁定册接线)", () => {
    // 语义演进:2026-08-02 的门 d 只「注解不拦」;2026-08-19 用户签字的
    // 规则 ①「已递减的控制和 DoT 一档」对 afterDR: skip 的行更进一步 ——
    // 递减态的窗口不是「谨慎建议」,是根本不产生。束缚射击签的正是 skip。
    const t1 = targetWithBinding(10, 16, [
      // The same category already landed at S4→S6, so the DR for the S10
      // window is not fully fresh
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        BINDING_SHOT,
        S(4),
        "e1",
        "t1",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        BINDING_SHOT,
        S(6),
        "e1",
        "t1",
      ),
    ]);
    const ds = summarize([t1, discPriest("h1")]);
    expect(
      ds.missedCleanseWindows.find((x) => x.timeSeconds === 10),
    ).toBeUndefined();
  });

  it("DR 已递减 × 签字 afterDR: situational(制裁之锤)→ 窗口保留,且即便有续控也不算 chain risk", () => {
    // 门 d 在递减态上的原语义(「不算 chain risk」)由 situational 行继续
    // 承载 —— 853 与束缚射击同为 Stun 递减类,只是签字档位不同。
    const HOJ = "853";
    const t1 = makeUnit("t1", {
      spec: CombatUnitSpec.Warrior_Arms,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, HOJ, S(4), "e1", "t1"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, HOJ, S(6), "e1", "t1"),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, HOJ, S(10), "e1", "t1"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, HOJ, S(16), "e1", "t1"),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, HOJ, S(22), "e1", "t1"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, HOJ, S(24), "e1", "t1"),
      ],
    });
    const ds = summarize([t1, discPriest("h1")]);
    const w = ds.missedCleanseWindows.find((x) => x.timeSeconds === 10)!;
    expect(w).toBeDefined();
    expect(w.drChainRisk).toBe(false);
  });
});

describe("豁免后缀与 purge 侧", () => {
  it("formatMissedCleanseExemption:各门后缀", () => {
    const base = {
      cleanseWasOnCD: false,
      cdBurnedOn: undefined,
      dispellersLockedOut: false,
      losReachable: null as boolean | null,
      drChainRisk: false,
    };
    expect(formatMissedCleanseExemption(base)).toBe("");
    expect(
      formatMissedCleanseExemption({ ...base, dispellersLockedOut: true }),
    ).toContain("locked out");
    expect(
      formatMissedCleanseExemption({ ...base, losReachable: false }),
    ).toContain("range/line of sight");
    expect(
      formatMissedCleanseExemption({ ...base, drChainRisk: true }),
    ).toContain("DR was fresh");
  });

  it("missedPurgeEvents:锁定/够不着的 purge 责难被拦", () => {
    const base = {
      timeSeconds: 20,
      durationSeconds: 8,
      enemyName: "e1",
      spellName: "Blessing of Freedom",
      spellId: "1044",
      priority: "High" as const,
      purgeWasOnCD: false,
      duringKillWindow: false,
      purgersLockedOut: false,
      losReachable: null as boolean | null,
    };
    expect(missedPurgeEvents([base])).toHaveLength(1);
    expect(
      missedPurgeEvents([{ ...base, purgersLockedOut: true }]),
    ).toHaveLength(0);
    expect(missedPurgeEvents([{ ...base, losReachable: false }])).toHaveLength(
      0,
    );
  });

  it("purge 集成:purger 超射程 → losReachable=false", () => {
    // The enemy carries a Critical/High priority Magic buff (Blessing of
    // Freedom 1044, given by their own side)
    const e1 = makeUnit("e1", {
      spec: CombatUnitSpec.Paladin_Holy,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "1044",
          S(20),
          "e1",
          "e1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "1044",
          S(28),
          "e1",
          "e1",
          "BUFF",
        ),
      ],
      advancedActions: [
        makeAdvancedAction(S(19), 60, 0),
        makeAdvancedAction(S(24), 60, 0),
      ],
    });
    (e1 as any).advancedActions = (e1 as any).advancedActions.map((a: any) => ({
      ...a,
      advancedActorId: "e1",
    }));
    const purger = discPriest("h1", {
      advancedActions: [
        makeAdvancedAction(S(19), 0, 0),
        makeAdvancedAction(S(24), 0, 0),
      ],
    });
    // 自由祝福 2026-08-13 起是「按我方阵容」判价值的目标(全近战则不值得驱)。
    // 本用例测的是射程/视线可行性,与阵容无关 —— 给我方补一个吃减速的专精,
    // 让自由回到应有的档位,判据不变。
    const kiter = makeUnit("h2", { spec: CombatUnitSpec.Mage_Frost });
    const ds = reconstructDispelSummary([purger, kiter] as any, [e1] as any, {
      ...COMBAT,
      zoneId: "0",
    });
    expect(ds.missedPurgeWindows).toHaveLength(1);
    expect(ds.missedPurgeWindows[0].losReachable).toBe(false);
    expect(formatMissedPurgeExemption(ds.missedPurgeWindows[0])).toContain(
      "range/line of sight",
    );
  });
});

/**
 * 2026-08-13 用户裁定:寒冰护体与真言术盾「的确可以驱散,而且优先级适中」。
 * 此前两者都进不了漏驱散分析 —— 寒冰护体没有分类表条目(优先级落 Low),
 * 真言术盾连技能效果表都没有(查不到驱散类型,更早被过滤)。
 * 本测试同时钉住三件事:官方驱散类型可查、分类为 buffs_defensive(映射 High)、
 * 且**不得**升到 Critical(那是免疫/硬控的档位,「适中」的含义就是低于它)。
 */
describe("护盾类的可驱散性与优先级档位(用户裁定)", () => {
  const SHIELDS = [
    { id: "17", name: "Power Word: Shield", duration: 15 },
    { id: "11426", name: "Ice Barrier", duration: 60 },
  ];

  it("官方数据认可驱散(Magic),且时长取自官方表", async () => {
    const { spellEffectData } = await import("../src/data/spellEffectData");
    for (const s of SHIELDS) {
      expect(spellEffectData[s.id]?.dispelType, s.name).toBe("Magic");
      expect(spellEffectData[s.id]?.durationSeconds, s.name).toBe(s.duration);
    }
  });

  it("分类为 buffs_defensive —— 进得了漏驱散分析,但不在 Critical 档", async () => {
    const { SPELL_CATEGORIES } = await import("../src/data/spellCategories");
    const { default: spellIdLists } = await import("../src/data/spellIdLists");
    for (const s of SHIELDS) {
      expect(SPELL_CATEGORIES[s.id]?.type, s.name).toBe("buffs_defensive");
      // Critical 来自这两张减伤白名单;护盾不得在其中,否则优先级会被顶到 Critical
      expect(
        (spellIdLists.bigDefensiveSpellIds as string[]).includes(s.id),
        s.name,
      ).toBe(false);
      expect(
        (spellIdLists.externalDefensiveSpellIds as string[]).includes(s.id),
        s.name,
      ).toBe(false);
    }
  });
});

/**
 * 2026-08-13 用户裁定:自由祝福的驱散优先级取决于对局 —— 双方全近战互撸时无所谓,
 * 我方有猎人/法师(靠减速与风筝施压)时,对面的自由就变得高优先。
 * 判据形态是「门」而非固定档位:我方没有吃减速的专精 → 直接判 Low(永远不进
 * 漏驱散结论),有 → 保持它本来的档位。
 */
describe("自由祝福:按我方阵容决定是否值得驱散(用户裁定)", () => {
  const mkUnit = (spec: CombatUnitSpec, id: string): ICombatUnit =>
    ({
      id,
      name: id,
      spec,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [],
      spellCastEvents: [],
      damageIn: [],
      damageOut: [],
      absorbsIn: [],
      actionsIn: [],
      actionsOut: [],
    }) as unknown as ICombatUnit;

  const FREEDOM = "1044";

  it("我方全近战 → 自由不进漏驱散候选", () => {
    const allMelee = [
      mkUnit(CombatUnitSpec.Warrior_Arms, "w"),
      mkUnit(CombatUnitSpec.Rogue_Assassination, "r"),
      mkUnit(CombatUnitSpec.Paladin_Holy, "p"),
    ];
    expect(purgePriorityForTest(FREEDOM, allMelee)).toBe("Low");
  });

  it("我方有猎人或法师 → 自由回到高优先", () => {
    for (const spec of [
      CombatUnitSpec.Hunter_Marksmanship,
      CombatUnitSpec.Mage_Frost,
    ]) {
      const team = [
        mkUnit(CombatUnitSpec.Warrior_Arms, "w"),
        mkUnit(spec, "x"),
        mkUnit(CombatUnitSpec.Paladin_Holy, "p"),
      ];
      expect(purgePriorityForTest(FREEDOM, team), String(spec)).not.toBe("Low");
    }
  });

  it("非上下文相关的目标不受阵容影响(真言术盾始终 High)", () => {
    const allMelee = [mkUnit(CombatUnitSpec.Warrior_Arms, "w")];
    expect(purgePriorityForTest("17", allMelee)).toBe("High");
  });
});
