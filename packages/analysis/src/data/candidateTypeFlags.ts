/**
 * ⚠ THIS FILE DOES NOT ANSWER "IS CANDIDATE TYPE X LIVE?" (GH #76).
 *
 * A candidate type can be dead **five** different ways, and this file is only
 * mechanism 1. Reading it as "the list of what's off" shows 5 of the 14
 * retirements (2026-09-11 inventory in GH #76):
 *
 *   1. flag `false` here                          (`CANDIDATE_TYPE_FLAGS`)
 *   2. emitter kept, assembly no longer calls it  (`candidateFindings.ts`:
 *      cc-locked, wasted-trinket, death-unused-defensive, mana-*)
 *   3. emitter deleted, legend text kept           (`candidateFindings.ts` /
 *      `buildFindingsPrompt.ts`: juked-kick, dr-clipped-cc,
 *      burst-into-immunity, off-target-in-window, unconverted-burst)
 *   4. bracket allow-list                          (`BRACKET_TYPE_ALLOWLIST`
 *      below — 2v2 keeps only cd-hoarded / missed-cleanse)
 *   5. desktop layer ignores it                    (`packages/desktop/.../derive/
 *      mistakes.ts` → `IGNORED_CANDIDATE_TYPES`: fires into the LLM prompt,
 *      never renders as a mistake card — and that set mixes "retired" with
 *      "menu-only by design", e.g. kick-eaten / md-cyclone-window)
 *
 * Four types are double-killed (flag + desktop ignore, or unwired + desktop
 * ignore): flipping one switch back silently does nothing and looks like "the
 * signal has no data" — the Curated-List failure shape. `missedPurge: true`
 * below would reach the LLM and still never reach a card.
 *
 * **The authoritative answer is the corpus scan, not any of the five places:**
 * `npx tsx packages/eval/scripts/candidateDiagnostics.ts --n 400 --json`
 * (`scanCandidateIncidence`, registered in docs/predicate-index.md). Four
 * code-reading counts of the live set came out 49 → 47 → 37 → 31, each missing
 * a different mechanism; the scan (16 types observed firing) was the only
 * correct one. A single registry that the five places derive from is the open
 * proposal in GH #76 — user ruling pending, because the "menu-only vs retired"
 * split is a product stance.
 *
 * ---
 *
 * P1/P2 起爆候选类型开关(2026-08-15,distillation Task 4;2026-08-15 Task 9
 * 全部翻 true,用户裁决全量上线)。
 *
 * 四个新候选类型(missedSyncWindow / unsyncedBurst / cdHoarded / cdSpentIdle,
 * candidateFindings.ts 里对应 missedSyncWindowEvents / unsyncedBurstEvents /
 * cdHoardedEvents / cdSpentIdleEvents 四个纯函数)——检测器本身恒可用,菜单装
 * 配处(teamPlayEvents)按开关逐类过滤,四开关全 true 时生产 prompt 常规产出全
 * 部四类型(与 A/B 阶段的默认全 false 基线不再字节一致,这正是本次上线的目的)。
 *
 * 上线依据(用户 2026-08-15 裁决,A/B 报告 p1p2-ab-p1.md/p1p2-ab-p2.md):
 * missedSyncWindow 采纳 25.9%/审计 97.6%/filler 30.9→26.3;unsyncedBurst 采纳
 * 26.5%/审计 88.9%/整体审计 92.9 vs 96.9(用户知情开启,§29(b) 前置修复已完成
 * 见 candidateFindings.ts `unsyncedBurstEvents` 的 healerNames 数组);cdHoarded
 * 采纳 26.3%/filler 24.8→18.2;cdSpentIdle 采纳 21.4%/审计 100%/filler
 * +6.4pp(用户知情开启)。
 *
 * A/B harness 仍可按臂翻转单个字段跑逐类对照实验——照 dispelFeatureFlags.ts
 * 先例,故意留成可变的普通对象字面量(而非 readonly/as const),测试和 harness
 * 都是直接赋值翻转(`CANDIDATE_TYPE_FLAGS.xxx = false`),不建单独的
 * override/reset 机制。
 *
 * `manaPressure`/`manaEfficiency` 两开关已随候选退役删除(2026-08-21,管线
 * 审查第 3 条「退役到零件」):BACKLOG #26 用户结案裁定不上线(#33 为后继
 * 项目,方向改为确定性归因引擎,不走候选菜单),菜单装配/图例/标定扫描
 * 三处接线同批摘除;纯函数 manaPressureEvents/manaEfficiencyEvents 与
 * 测试保留在 candidates/mana.ts。
 *
 * `attemptIntoTrinket`(2026-08-18,击杀尝试重设计):打在有徽章目标上的失败
 * 尝试、且同刻存在 prime 目标(candidateFindings.ts 装配
 * `attemptIntoTrinketEvents`,提取器 utils/killAttempts.ts)。默认 true ——
 * 用户当日拍板接线(GH #16,三档模型 8,791 次晕落地验证在前),与 P1/P2
 * 「先标定再裁决」路径不同:判据本身即当日验证产物。
 */
export const CANDIDATE_TYPE_FLAGS: Record<
  | "missedSyncWindow"
  | "unsyncedBurst"
  | "cdHoarded"
  | "cdSpentIdle"
  | "attemptIntoTrinket"
  | "mdCycloneWindow"
  | "missedPurge"
  | "ccHeld"
  | "killReview"
  | "backlashDispel",
  boolean
> = {
  // 下架 2026-08-19(GH #13,用户裁定)。判别力实测为负(−4.4pp)的根因
  // 拆解:①机会分母混杂 —— 胜局场均 8.30 个敌奶硬控窗 vs 负局 7.19,发生率
  // 型指标量的是控场能力;②洗掉分母后按机会归一化的转化率 **胜 26.7% vs
  // 负 27.8%,持平** —— 「打满这些窗口」的行为本身不区分胜负,信号前提
  // 不成立;③实现噪声:43.1% 被指控窗口 <2.5s(塞不下一个 GCD)、21.4%
  // 窗口前 6s 内团队刚摁过进攻大招。修实现救不回 ②,故下架而非收紧。
  // 纯函数 missedSyncWindowEvents 与其测试保留(测试自行翻 flag)。
  // 2026-09-02 复活(用户裁决,GH #13 撤销):重设计后重新启用 —— 正典进攻表
  // (OFFENSIVE_CD_SPELL_IDS)替代 isThroughput、t>=30s/时长>=3s/窗内敌亡除外、
  // 按 bracket 语料参照 + >=3pp 最小对比门(syncWindowPrior.ts;单排对比 ~0.7pp
  // 自动静音,#13 记录的 74% 洪水不会回来)。证据轴换了:击杀转化(3v3 进窗
  // 17.8% vs 7.6%)+ 分段行为梯度(pct>=90 进窗率 23.0% vs pct<30 16.2%),
  // 而 #13 的下架依据是胜负轴 + 全语料池化(76% 单排把 3v3 冲平)。
  missedSyncWindow: true,
  // 下架 2026-08-29(GH #50 (a),用户逐条裁定「降级为上下文事实」)。技能梯度
  // 实验(12.1 首周 10,301 场 / 23,056 回合,单排切片 n=15,306):触发率
  // 62–66%(每个进攻冷却)、分段梯度 +0.1 —— 它在描述常态;已知机制:被指控
  // 队伍整轮从未控过敌方治疗的占 0%,平均只差 13–18s,可行性门(3ad24bbb)只
  // 解释 9.5%。时间线上的爆发/控场事实照旧,只撤掉指控。纯函数
  // unsyncedBurstEvents 与其测试保留(测试自行翻 flag)。
  unsyncedBurst: false,
  cdHoarded: true,
  // 下架 2026-08-30(信号结果探针,用户裁定,CLAUDE.md 价值门第 4 条):
  // 19,019 个决策点(3,000 场新赛季归档)—— 威胁下按出之后 30s 内"被罚"
  // (敌方进攻大 CD 命中且 10s 内有人阵亡)3.6%,空当按出之后仅 3.1%
  // (Δ +0.5pp;前 10% 分段 −0.8pp;单排 −0.2pp)—— 指控没有可测量的代价。
  // 时间线冷却台账照旧,只撤掉指控;纯函数 cdSpentIdleEvents 与测试保留
  // (测试自行翻 flag)。数据:eval-private/reports/signal-outcomes-2026-08-30/report.md。
  cdSpentIdle: false,
  attemptIntoTrinket: true,
  // md-cyclone-window(2026-08-21,GH #25 MD 特例):用户当日拍板四门判据
  // (链条/压力/战略预留/可用)并签字 15s 缓冲与 CD_HOARD_CRISIS_HP_PCT 对齐,
  // 默认开。红线=默认不指控,四门缺一即静默;S2 语料接地 4 例全为解链形态,
  // 见 candidates/massDispel.ts 模块头。
  mdCycloneWindow: true,
  // 下架 2026-08-29(GH #50 (a),用户逐条裁定「降级为上下文事实」)。同一实验:
  // 触发率 63–79%(有高价值可偷增益的回合)、梯度 +4.0 但非单调(峰在中段);
  // 可行性门(purgeWasOnCD / purgersLockedOut / losReachable)齐全,所以不是
  // 可行性问题 —— 高分玩家同样不偷,「值不值得偷」这个价值判断不在判据里
  // (getPriority 是先验非后果)。formatDispelContextForAI 的 [PURGEABLE] 事实行
  // 照旧进 prompt,只撤掉 missed-purge 候选;missedPurgeEvents 与测试保留。
  missedPurge: false,
  // 下架 2026-08-29(GH #50 (d),用户裁定「梯度仍平则下架」)。机会归一化后
  // 的技能梯度(12.1 首周归档 10,682 场 / 23,056 回合;分母=我方对齐爆发开启
  // 时自己的控场大招可用,cdAvailableAt):转化率各分段 20–25%,单排未转化率
  // 82.8→88.2% 随分数**上升**,胜负差 +2–4pp、2400+ 反转;前置窗口变体
  // [−10,+5]s(「先控再爆发」假设)每段一致 +6pp、梯度依旧平。「爆发时按控」
  // 不区分水平,信号前提不成立。时间线冷却台账照旧,只撤掉指控;纯函数
  // ccHeldEvents 保留。数据:GH #50 评论 + eval-private/skill-gradient/。
  ccHeld: false,
  // 下架 2026-08-30(GH #18 人工标注裁定 (d))。`death` 候选里 side=enemy 的那一半
  // ——「你们打出的击杀值得复刻」——三张盲评卡全被标「泛泛/不可执行、低或无影响」,
  // 其中一张用户直接质疑因果(「伤害不够还是没打出来」)。击杀事实照旧进时间线,
  // 只撤掉这条候选;side=friendly 的死亡不受影响。
  killReview: false,
  // backlash-dispel / backlash-dispel-window (GH #80, 2026-09-12, user
  // approval after the archive cost/benefit model — 180k opportunities:
  // UA dispel net ≈ −200k HP + 1.4 s unanswerable CC unless it co-removed a
  // CC; VT net-negative at ≥ 80 % target HP, net-positive at 40–60 % × 3+
  // DoTs). Both producers live in candidates/backlashDispel.ts; the flag
  // gates them together. Validation (real-model smoke + acceptance capture)
  // pending — flip to false to retire without touching the emitters.
  backlashDispel: true,
};

/**
 * Per-bracket candidate allow-list (GH #18 human-label ruling 2026-08-30 (a)).
 * Key = `bracketKey(startInfo.bracket)`; a bracket listed here keeps ONLY the
 * named types in its candidate menu, everything else becomes context. A
 * bracket not listed is untouched.
 *
 * 2v2: of the 6 blind-labelled 2v2 cards (one match, one player) 4 were
 * "no impact" and 1 was judged false ("22 直接干,没那么多策略"); the only
 * cards with adopt value across all 43 labelled were cd-hoarded (9/9 concrete)
 * and missed-cleanse. n is small — this is a reversible switch, not a law.
 */
export const BRACKET_TYPE_ALLOWLIST: Readonly<
  Partial<Record<"2v2" | "3v3" | "solo", ReadonlySet<string>>>
> = {
  "2v2": new Set(["cd-hoarded", "missed-cleanse"]),
};
