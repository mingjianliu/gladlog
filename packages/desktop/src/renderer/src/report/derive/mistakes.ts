import {
  analyzeKickAudit,
  annotateMissedPurgesWithKillWindows,
  type CandidateEvent,
  CARD_TYPES,
  computeOffensiveWindows,
  extractCandidateFindings,
  MENU_ONLY_TYPES,
  reconstructDispelSummary,
  RETIRED_TYPES,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { resolveOwner } from "./analysisInput";
import { toLegacySafe } from "./legacySource";
import { type TimeRange, tInRange } from "./timeRange";
import type { ReportSource } from "./types";

/**
 * Deterministic mistake engine (phase 4 ③ / backlog #8, the WoWAnalyzer
 * suggestions pattern): rules are enumerable data objects (three severity
 * tiers) that consume only analysis's existing deterministic predicates
 * (candidateFindings / kickAudit / dispelSummary) and go straight to the UI
 * without an LLM.
 * Anti-rot: when upstream candidateFindings adds a new type, it must be
 * registered in `packages/analysis/src/data/candidateTypeRegistry.ts`
 * (status / surface / ruling) and, if its surface is "card", get a
 * MISTAKE_RULES row here — report.mistakes.test asserts the rule table equals
 * the registry's CARD_TYPES and that every emitted type is triaged.
 */

export type MistakeSeverity = "minor" | "average" | "major";

export interface MistakeRule {
  type: string;
  label: string;
  severity: MistakeSeverity;
  source: "candidate" | "kick" | "dispel";
}

export const MISTAKE_RULES: readonly MistakeRule[] = [
  // juked-kick 已整体退役(2026-08-19,GH #15)—— 候选发射与本表规则同批
  // 摘除;kick 审计的统计表(landed/juked/missed 计数)不在本表体系,照常。
  {
    // 2026-08-18 击杀尝试重设计(GH #16):打在有徽章目标上的失败尝试,同刻
    // 存在 prime 目标。severity 与 burst-into-mitigation 同档 —— 同一「机会
    // 成本」框架,判据换成了已验证的三档模型。
    type: "attempt-into-trinket",
    label: "开晕在有徽章的目标上",
    severity: "average",
    source: "candidate",
  },
  // burst-into-immunity: RETIRED 2026-08-20(GH #17,用户裁定 —— 伪影修复后
  // 按爆发归一化仍持平 7.1% vs 6.8%,#13 同形;candidateFindings 已摘发射,
  // 类型移入下方 IGNORED_CANDIDATE_TYPES 容纳缓存回合)。
  {
    // OFFENSIVE-002 (2026-08-11, BACKLOG #18 second batch): a burst went into
    // a target with a major (non-immune) mitigation cooldown running, while a
    // softer target existed at that same moment. Same opportunity-cost framing
    // as burst-into-immunity, one tier down (mitigation is not full immunity).
    type: "burst-into-mitigation",
    label: "爆发打进大减伤",
    severity: "average",
    source: "candidate",
  },
  // off-target-in-window: RETIRED 2026-08-19 (user ruling: 集火按全队算;
  // candidateFindings 已摘发射,类型不再抵达 —— 见那边的退役注释)。
  // dr-clipped-cc: RETIRED 2026-08-20(GH #17,用户裁定 —— 判据集
  // {25%, Immune} 无合法定义域:25% 档 12.0 已从游戏移除,Immune 档实测
  // 全是链窗模型伪影;candidateFindings 已摘发射,类型移入下方
  // IGNORED_CANDIDATE_TYPES 容纳缓存回合)。
  // unconverted-burst: RETIRED 2026-08-19(用户裁定 C —— 被 [KILL ATTEMPTS]
  // 的逐尝试结果/归因替代;candidateFindings 已摘发射,类型不再抵达)。
  {
    type: "cd-waste",
    label: "保命 CD 整场未用",
    severity: "minor",
    source: "candidate",
  },
  {
    type: "missed-kick",
    label: "打断空放",
    severity: "minor",
    source: "kick",
  },
  {
    type: "missed-purge-kill-window",
    label: "击杀窗口内漏 purge",
    // major→average(2026-08-20,GH #19,用户裁定):12.1 正式重跑判别力仅
    // +2.6pp(弱正,#21 保留裁定口径),却占 major 桶 92%(1129 回合里
    // 1429 条 vs external-unused 81 / death-unused-defensive 43),把第一屏
    // 整个占掉。证据最弱的类型不该在最高档。
    severity: "average",
    source: "dispel",
  },
  // death-unused-defensive: RETIRED 2026-08-29(GH #58,用户裁定)—— 由
  // crisis-no-response 接替;规则移入 IGNORED_CANDIDATE_TYPES,candidateDetail
  // 分支保留供缓存回合渲染。
  {
    // Task 5 (spec 2026-08-29, healer-only): own HP crossed a crisis threshold
    // and nothing answered it for 3s while free to act. severity=major, same
    // tier as death-unused-defensive/external-unused — the crisis threshold
    // and free-to-act gate make this a real-consequence fact, not a pure
    // uptime one.
    type: "crisis-no-response",
    label: "危机 3 秒无应对",
    severity: "major",
    source: "candidate",
  },
  // GH #80 (2026-09-12, user approval): the owner dispelled Unstable
  // Affliction / Vampiric Touch in the archive-measured net-negative stratum
  // (UA ≤ 2 stacks at ≥ 60 % target HP: net ≈ −200k HP + 1.4 s unanswerable
  // CC per dispel; VT at ≥ 80 %: net ≈ −78k). "average": a real, per-event
  // cost (the dispeller's own 4 s numbers are in the facts), but the
  // discrimination has not been measured yet — not "major".
  {
    type: "backlash-dispel",
    label: "解反噬 DoT 得不偿失",
    severity: "average",
    source: "candidate",
  },
  // The mirror: a window where dispelling was worth it (VT at 40–60 % with
  // 3+ DoTs, or the owner was immune to the backlash) and nobody dispelled.
  // An alternative-line suggestion, so the lowest tier.
  {
    type: "backlash-dispel-window",
    label: "可解的反噬 DoT 没解",
    severity: "minor",
    source: "candidate",
  },
  {
    type: "external-unused",
    label: "队友阵亡时外减可用未给",
    severity: "major",
    source: "candidate",
  },
  // wasted-trinket: RETIRED 2026-08-19(GH #14 B 组复测,用户裁定 —— 出面
  // 事件 94.5% 是治疗解自己身上的控,按使用次数归一化后反向;candidateFindings
  // 已摘发射,类型移入下方 IGNORED_CANDIDATE_TYPES 容纳缓存回合)。
  {
    type: "questionable-external",
    label: "无压力窗口交出外减",
    // average→minor(2026-08-20,GH #16 severity 证据审计,用户裁定):判别力
    // 反向(赢 1.7% vs 输 1.1%)且样本显示在指控 burst 前 6.7–10.7s 的预判性
    // 外减 —— 证据最弱的档位不该居中档。
    severity: "minor",
    source: "candidate",
  },
  // Signal-expansion batch 1 (2026-08-06, BACKLOG #18 second batch).
  {
    type: "healing-gap",
    label: "治疗空窗",
    severity: "average",
    source: "candidate",
  },
  {
    type: "position-mistake",
    label: "走位失误",
    severity: "average",
    source: "candidate",
  },
  {
    // Opportunity-cost framing, same tier as cd-waste (never-used defensive):
    // a control major sitting available is a fact about uptime, not a proven
    // damage consequence — see the no-causation guard on this type's prompt
    // legend (buildFindingsPrompt.ts).
    type: "cc-held",
    label: "压手未放",
    severity: "minor",
    source: "candidate",
  },
  {
    // DEFENSIVE-001 (2026-08-07, BACKLOG #18 second batch): a healer ate a
    // hard CC with a non-trinket avoidance tool evidenced-and-available
    // beforehand. Same opportunity-cost framing as cc-held (a fact about kit
    // availability, not a proven "this would have saved you" claim — see the
    // no-causation guard on this type's prompt legend, buildFindingsPrompt.ts).
    type: "cc-avoidable",
    label: "规避手段可用未用",
    severity: "minor",
    source: "candidate",
  },
  {
    // DEFENSIVE-003 (rewritten 2026-09-01, GH #60 phase 2): the enemy opened
    // a bounded burst window, nobody answered inside 8 s although the
    // pressured friendly (or a teammate who could reach them) had a tool
    // ready, and that friendly dropped to the crisis HP line or died. A real
    // consequence context is attached (unlike cc-held's pure uptime fact),
    // hence "average" rather than "minor" — same tier as healing-gap.
    type: "slow-defensive-response",
    label: "敌方开大应对迟缓",
    severity: "average",
    source: "candidate",
  },
  // P1/P2 起爆候选(Task 9,2026-08-15,四开关默认开启上线): same "fact, not
  // proven causation" discipline as cc-held/cd-waste above — B8 explicitly
  // designed missed-sync-window with NO HP gate (enemyMinHpPct is an
  // accelerator-only fact, never a proof of consequence), and unsynced-burst
  // is documented as unsynced-burst's sibling to unconverted-burst ("two
  // different coaching facts about the same button press") — same tier as
  // that sibling.
  {
    type: "missed-sync-window",
    label: "锁死未起爆",
    severity: "minor",
    source: "candidate",
  },
  {
    type: "unsynced-burst",
    label: "起爆未同步",
    // minor→average(2026-08-20,GH #16 severity 证据审计,用户裁定):机会
    // 归一化未同步率 胜 34.7% vs 负 49.1%(+14.4pp,自有队列)—— 全库前三强
    // 正向信号,不该在最低档。
    severity: "average",
    source: "candidate",
  },
  // cd-hoarded/cd-spent-idle both cite a real consequence context (a
  // teammate's crisis HP% for cd-hoarded; the match's own medium+ threat
  // gate for cd-spent-idle — B6 red line means it never fires in a calm
  // match) rather than a pure uptime fact, so "average" like
  // healing-gap/slow-defensive-response above rather than cc-held's "minor".
  {
    type: "cd-hoarded",
    label: "大 CD 囤积过久",
    // average→major(2026-08-20,GH #19,用户裁定):四次测量(12.1 前
    // +25.4 / 初测两队列 +24.7、+27.1 / 正式重跑 +22.7pp)全库最强非循环
    // 信号,却被 major 档的 missed-purge 压在折叠区。
    severity: "major",
    source: "candidate",
  },
  {
    type: "cd-spent-idle",
    label: "保命 CD 打空当",
    severity: "average",
    source: "candidate",
  },
] as const;

/** Types candidateFindings produces that are deliberately NOT mistakes (a death
 * is an outcome, not a mistake; death-setup is narrative-chain evidence that
 * goes into the AI pipeline but not the mistake list; juked-kick goes through
 * kickAudit).
 * The four 2026-07-24 teamwork types: missed-cleanse/missed-purge are supplied
 * directly by dispelSummary (the missed-cleanse / missed-purge rows of
 * DispelDashboard; the candidate version would double count).
 *
 * kick-eaten is "a thing that happened TO you" — coachable (fake-casting is a
 * real, discriminative skill: +6.8~+10.9pp win/loss gap in the right
 * direction), but not an assertion of a mistake. 2026-08-19 user ruling
 * (GH #14): this "coachable non-mistake" positioning is the DELIBERATE
 * product stance, not an inconsistency — the LLM coaches it, the mistake
 * list does not show it, and both are correct.
 *
 * cc-locked was retired from the candidate menu entirely (GH #14, v28:
 * opportunity-normalized breakout conversion is REVERSE — winners sit
 * through CC with the trinket in hand MORE than losers — so neither of its
 * coaching claims held). Its entry here stays so cached rounds analysed
 * before the retirement still derive cleanly (same reason juked-kick's entry
 * survives its own retirement above).
 *
 * wasted-trinket followed the same day (GH #14 B-group re-measurement, v29:
 * 94.5% of emitted events were the healer breaking CC on THEMSELVES — the
 * healerInCCAt-always-false blind spot made "trinketing at high team HP"
 * itself the accusation — and the waste-share of presses ran REVERSE, 12.0%
 * win vs 10.4% loss). Entry kept for cached rounds, same as the two above.
 *
 * ⚠ DERIVED, NOT EDITED HERE (GH #76, user ruling 2026-09-12). This set used
 * to be a hand list that conflated two reasons for "no card": retired
 * (cc-locked, wasted-trinket, …) and menu-only by design (kick-eaten,
 * md-cyclone-window, death*, missed-cleanse — the LLM coaches them, the card
 * list does not). Five of its members are the corpus's most-fired types
 * (kick-eaten 44 %, death 43 %, death-setup 31 %, missed-cleanse 16 %,
 * md-cyclone-window 2 %, 400 library rounds 2026-09-06), and the coach-corpus
 * tooling once read it as a retirement list (GH #74).
 *
 * Now the two meanings are two exports of
 * `packages/analysis/src/data/candidateTypeRegistry.ts`:
 *   `MENU_ONLY_TYPES` — surface "menu-only": in the prompt, never a card;
 *   `RETIRED_TYPES`   — status retired | deleted: off entirely.
 * This set is their union MINUS `CARD_TYPES` (flag-retired card types keep
 * their MISTAKE_RULES row so an A/B flag flip renders without a code change —
 * cc-held / unsynced-burst / cd-spent-idle), which is exactly the hand list it
 * replaced, member for member (pinned in report.mistakes.test). Its only
 * consumer is that inventory test; the renderer never reads it. */
export const IGNORED_CANDIDATE_TYPES: ReadonlySet<string> = new Set(
  [...MENU_ONLY_TYPES, ...RETIRED_TYPES].filter((t) => !CARD_TYPES.has(t)),
);

export interface Mistake {
  tS: number;
  unitName: string;
  type: string;
  label: string;
  severity: MistakeSeverity;
  detail: string;
  /** ▶ Units the replay camera should focus on when jumping. */
  seekNames: string[];
  /**
   * 这条是不是关于**你自己**的。失误卡默认只展开 owner 的,队友的整块折叠 ——
   * 2026-08-17 实测:UI 每回合中位 28 条,其中近 30% 是 DPS 专属类型
   * (off-target-in-window / unconverted-burst),owner 视角下一条都不会出,
   * 全部来自 mistakes.ts 对每个友方各跑一遍候选提取;position-mistake 更是被
   * 放大 8.2×。收敛到 owner 视角后每回合 9.9 条。
   *
   * 归属判定走共享谓词 `resolveOwner`(docs/predicate-index.md 已登记),
   * 不另起一套「谁是本场主角」的判断。
   */
  isOwner: boolean;
  /**
   * Whether tS is a real time anchor (rather than the sentinel of a
   * "whole-round observation"). The only fake anchor today is cd-waste
   * (`candidateFindings.ts`: `t: 0, // whole-round observation, not
   * time-specific`) — it has no `facts.t`. StructuredAnalysisPanel's
   * splitFindings distinguishes "whole round" from "has a moment" with the same
   * predicate (`facts.t !== undefined`); this mirrors that judgement rather
   * than starting a second one. The kick/dispel sources are always real moments
   * (a missed interrupt or dispel happens at a specific instant), hence always
   * true.
   *
   * Consumers (e.g. the sliding-window dedup of uncovered highlights, BACKLOG
   * #13) filter the anchor set on this — whole-round observations have no
   * specific moment and must not be treated as "covering a time span", or the
   * opening window gets falsely marked covered (cd-waste's t=0 falls exactly
   * inside the tolerance of the sliding window's first window).
   */
  timed: boolean;
}

const RULE_BY_TYPE = new Map(MISTAKE_RULES.map((r) => [r.type, r]));

export function candidateDetail(c: CandidateEvent): string {
  const f = c.facts as Record<string, string | undefined>;
  switch (c.type) {
    case "attempt-into-trinket": {
      // 语料参照(2026-08-30 结果探针)是可选字段:老缓存的回合没有这三个
      // fact,缺一个就整句不渲染 —— 只补一句对照,不改原有措辞。
      const ref =
        f.refKillTrinketDown && f.refKillTrinketUp && f.refN
          ? `;语料参照:徽章已交时 15 秒内击杀 ${f.refKillTrinketDown}%,徽章还在时 ${f.refKillTrinketUp}%(n=${f.refN} 次尝试)`
          : "";
      return `${f.stun ?? ""} 开在 ${f.target ?? ""} 身上(徽章还在),当时 ${f.primeAlt ?? ""} 无徽章无控中减伤;失败原因 ${f.failedBy ?? "?"}${ref}`;
    }
    case "burst-into-immunity":
      return `${f.spell ?? ""} 打进 ${f.target ?? ""} 的 ${f.immunity ?? ""}(重叠 ${f.overlap ?? "?"}s)`;
    case "burst-into-mitigation":
      return `${f.spell ?? ""} 打进 ${f.target ?? ""} 的 ${f.mitSpell ?? ""}(减伤 ${f.mitPct ?? "?"}%),当时 ${f.betterTarget ?? ""} 是更软的目标`;
    case "dr-clipped-cc":
      return `${f.spell ?? ""} 打在 ${f.target ?? ""} 的 ${f.dr ?? ""} 递减上(仅 ${f.duration ?? "?"}s)`;
    case "cd-waste":
      return `${f.spell ?? ""} 整场未按`;
    case "death-unused-defensive":
      return `死亡时 ${f.walls ?? ""} 可用未按`;
    case "crisis-no-response": {
      // spec §1c: Solo Shuffle's reference counts ANY friendly death within
      // 15 s; everything else counts the owner's own death within 10 s —
      // same fact, two wordings. Branch on facts.refOutcomeKey (the enum),
      // the SAME field the gate (checkBehaviorPriorConsistency) cross-checks
      // against lookupBehaviorPrior — facts.refOutcome is prose now (a human
      // phrase, single-sourced from data/behaviorPrior.ts's outcomePhrase)
      // and must never be branched on. Fall back to facts.refOutcome for a
      // cached round produced before refOutcomeKey existed (pre-PROMPT_VERSION
      // 40), where refOutcome was still the bare enum token.
      const outcomeKey = f.refOutcomeKey ?? f.refOutcome;
      const outcomeClause =
        outcomeKey === "teamDeath15s"
          ? `此状态下无应对者 ${f.refDeathNoResp ?? "?"}% 十五秒内我方有人阵亡,有应对者 ${f.refDeathResp ?? "?"}%`
          : `此状态下无应对者 ${f.refDeathNoResp ?? "?"}% 十秒内死亡,有应对者 ${f.refDeathResp ?? "?"}%`;
      return `血量 ${f.hpPct ?? "?"}% 后 3 秒无应对(${outcomeClause},出手者常见应对:${f.refTop ?? ""})`;
    }
    case "external-unused":
      return `${f.victim ?? ""} 阵亡时 ${f.external ?? ""} 可用`;
    case "wasted-trinket":
      return `全队最低血量 ${f.teamMinHpPct ?? "?"}% 时开饰品`;
    case "questionable-external":
      return `${f.spell ?? ""} 给 ${f.target ?? ""}(${f.targetHp ?? "?"}% HP,距最近爆发窗 ${f.nearestBurstGapS ?? "?"}s)`;
    case "slow-defensive-response":
      // 2026-09-01 决策点重写(GH #60 phase 2):facts 从
      // enemyCds/reacted/delayS/damageK/dmgRatio 换成了
      // leadCd/extras/pressured/pressuredHpPct/diedInWindow —— 判据从「owner
      // 反应慢」变成「整队 8 秒内没人应对承压的那个人」。
      return `${f.leadCd ?? ""}${f.extras ? `(+${f.extras})` : ""} 开启后 8 秒内全队无应对,${f.pressured ?? ""} 被打到 ${f.pressuredHpPct ?? "?"}%${f.diedInWindow === "yes" ? "、窗口内阵亡" : ""}`;
    case "missed-sync-window":
      return `${f.healer ?? ""} 被 ${f.cc ?? ""} 控 ${f.durationS ?? "?"}s,${f.readyCds ?? ""} 均 ready 未按`;
    case "unsynced-burst":
      return `${f.spell ?? ""} 起爆时 ${f.healer ?? ""} 没有硬控在身,自由治疗`;
    case "cd-hoarded":
      // 2026-08-30 决策点重写(GH #34):facts 从 lateS/crisisT/castT/unresolved
      // 换成了 t/crisisUnit/crisisHpPct/readyCds/own —— 危机时刻本身就是 t,
      // 不再有一个独立更早的"转好时刻"。
      return `${f.crisisUnit ?? ""} 在 ${f.t ?? "?"}s 掉到 ${f.crisisHpPct ?? "?"}%${f.own === "yes" ? "(自己)" : ""}时,${f.readyCds ?? ""} 均可用却 5 秒内未按`;
    case "cd-spent-idle":
      return `${f.spell ?? ""} 在无威胁时段打出`;
    case "backlash-dispel":
      return `${f.t ?? "?"}s 给 ${f.targetHpPct ?? "?"}% 血的 ${f.target ?? ""} 解掉 ${f.debuff ?? ""}${f.stacks && f.stacks !== "1" ? `×${f.stacks}` : ""},自己吃 ${f.backlash ?? ""},4 秒内承伤 ${f.selfDmgBeforeK ?? "?"}k→${f.selfDmgAfterK ?? "?"}k、治疗 ${f.healBeforeK ?? "?"}k→${f.healAfterK ?? "?"}k${f.cdCcSpell ? `;驱散 CD 里 ${f.cdCcTarget ?? ""} 吃了 ${f.cdCcDurationS ?? "?"}s ${f.cdCcSpell} 无人能解` : ""}`;
    case "backlash-dispel-window":
      return f.reason === "immune"
        ? `${f.t ?? "?"}s ${f.target ?? ""}(${f.targetHpPct ?? "?"}%)身上的 ${f.debuff ?? ""} 可解:你当时有 ${f.immuneBuff ?? ""},反噬控制无效`
        : `${f.t ?? "?"}s ${f.target ?? ""}(${f.targetHpPct ?? "?"}%,${f.dots ?? "?"} 个 DoT)身上的 ${f.debuff ?? ""} 值得解,之后 15 秒又吃了 ${f.casterDmgAfterK ?? "?"}k`;
    default:
      return "";
  }
}

/**
 * Anchor extraction for the uncovered-highlights sliding-window dedup (BACKLOG
 * #13): take only rows with `timed=true`.
 * The tS of a "whole-round observation" (e.g. cd-waste) is a sentinel, not a
 * real time anchor — used as an anchor it falsely marks whichever sliding
 * window it happens to fall into within tolerance as "covered" (review-round
 * fix: the caller previously folded all of
 * `deriveMistakes(source).map(mk => mk.tS)` into the anchors, unfiltered).
 * Exported as its own small function so the consumer (MatchReport) and the
 * tests both import it, instead of each writing the same
 * `.filter((mk) => mk.timed)`.
 */
export function timedAnchorsFromMistakes(
  mistakes: readonly Mistake[],
): number[] {
  return mistakes.filter((mk) => mk.timed).map((mk) => mk.tS);
}

export function deriveMistakes(
  source: ReportSource,
  range?: TimeRange | null,
): Mistake[] {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    if (friends.length === 0 || enemies.length === 0) return [];
    // 共享谓词(docs/predicate-index.md 已登记),不另起一套主角判断。
    const ownerName = resolveOwner(legacy)?.name;
    const out: Mistake[] = [];
    const seen = new Set<string>();

    // candidate source: run once per friendly as the owner; dedup by candidate id
    for (const p of friends) {
      for (const c of extractCandidateFindings(legacy, p.id)) {
        const rule = RULE_BY_TYPE.get(c.type);
        if (!rule || rule.source !== "candidate") continue;
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push({
          tS: c.t,
          unitName: c.unitNames[0] ?? p.name,
          type: c.type,
          label: rule.label,
          severity: rule.severity,
          detail: candidateDetail(c),
          seekNames: c.unitNames.slice(0, 1),
          isOwner: (c.unitNames[0] ?? p.name) === ownerName,
          timed: c.facts.t !== undefined,
        });
      }
    }

    // kick source: all friendlies (the candidate version only covers DPS owners)
    for (const p of friends) {
      for (const k of analyzeKickAudit(p, enemies, legacy)) {
        // juked 分支已随 GH #15 退役(2026-08-19)—— 旧写法在这里
        // RULE_BY_TYPE.get("juked-kick")! 非空断言,规则删除后 undefined
        // 会把整个 deriveMistakes 在外层 try 里炸掉(连别的来源一起消失),
        // 退役时差点复现这个事故,故收窄成只取 missed 一种。
        if (k.result !== "missed") continue;
        const rule = RULE_BY_TYPE.get("missed-kick")!;
        out.push({
          tS: k.atSeconds,
          unitName: p.name,
          type: rule.type,
          label: rule.label,
          severity: rule.severity,
          detail: `${k.kickSpellName} 空放`,
          seekNames: [p.name],
          isOwner: p.name === ownerName,
          timed: true, // an interrupt happens at a specific instant, not over the whole round
        });
      }
    }

    // dispel source: missed purges inside a kill window (same annotation
    // predicate as the prompt side)
    const dispels = reconstructDispelSummary(friends, enemies, {
      startTime: legacy.startTime,
      endTime: legacy.endTime,
    });
    annotateMissedPurgesWithKillWindows(
      dispels.missedPurgeWindows,
      computeOffensiveWindows(enemies, friends, legacy),
    );
    for (const w of dispels.missedPurgeWindows) {
      if (!w.duringKillWindow) continue;
      const rule = RULE_BY_TYPE.get("missed-purge-kill-window")!;
      out.push({
        tS: w.timeSeconds,
        unitName: w.enemyName,
        type: rule.type,
        label: rule.label,
        severity: rule.severity,
        detail: `${w.spellName} 挂在 ${w.enemyName} 身上 ${Math.round(w.durationSeconds)}s 未被驱散`,
        seekNames: [w.enemyName],
        // 漏剥离是整队责任、不归属某个友方 —— 归到 owner 侧,否则它会掉进
        // 「队友」折叠区里消失(unitName 是敌人名,不是任何友方)。
        isOwner: true,
        timed: true, // a missed purge happens at a specific instant, not over the whole round
      });
    }

    return out
      .filter((mk) => tInRange(mk.tS, range))
      .sort((a, b) => a.tS - b.tS);
  } catch {
    return [];
  }
}

// ─── 时刻分组(2026-08-17) ──────────────────────────────────────────────────

/**
 * 同一时刻内的失误合成一组的窗口(秒)。
 *
 * **这是展示参数,不是分析谓词** —— 它只决定「几条并成一行给人看」,不参与
 * 任何事实判断,所以证据标准与 `HP_SAMPLE_RADIUS_MS` 那类不同,不需要签字册。
 *
 * 依据(2026-08-17,200 回合 owner 视角实测,平均 11.0 条/回合):
 *   ±5s → 7.8 个时刻(压缩 28%) · **±10s → 6.1 个(44%)** · ±15s → 4.8 个(55%)
 * 取 10s:它落在压缩率曲线的拐点上,且与最常共现的类型对的语义跨度相符 ——
 * 实测最高频的共现是 `cc-locked + unsynced-burst`(51 次)、
 * `cc-locked + missed-sync-window`(45)、`cc-locked + missed-purge/cleanse`
 * (36/35),都是「你被控住的同一波」里的不同侧面,本来就该并成一件事讲。
 *
 * 历史注记:这里曾刻意**不复用** `SLOW_DEF_RESPONSE_DEDUP_SLACK_S`(同样是
 * 10)—— 那是候选层的去重松弛,是另一个事实。该常量已随 slow-defensive-response
 * 的决策点重写下线(2026-09-01,GH #60 phase 2),但结论照旧:数值相同不等于
 * 概念相同,不共享(审计记过 `POSITION_MAX_GAP_MS` 被当成 HP 半径用的教训)。
 */
export const MISTAKE_MOMENT_GAP_S = 10;

export interface MistakeMoment {
  /** 组内最早的时刻,用于排序与跳转。 */
  tS: number;
  /** 组内最高严重度 —— 一组里只要有一条重大,这一组就是重大。 */
  severity: MistakeSeverity;
  /** 组内是否有真实时间锚点(全是整场型观察时为 false)。 */
  timed: boolean;
  items: Mistake[];
}

const SEVERITY_RANK: Record<MistakeSeverity, number> = {
  major: 3,
  average: 2,
  minor: 1,
};

/**
 * 把一串失误按时刻并成组。**先合并再截断** —— 反过来会把同一件事的碎片
 * 当成不同的事截掉一半。
 *
 * 只对有时间锚点的条目分组;整场型观察(`timed: false`,如 cd-waste)各自
 * 独立成组并排在最后,因为它们没有「发生在哪一刻」可言。
 */
export function groupMistakesByMoment(
  mistakes: readonly Mistake[],
): MistakeMoment[] {
  const timed = mistakes.filter((m) => m.timed).sort((a, b) => a.tS - b.tS);
  const untimed = mistakes.filter((m) => !m.timed);
  const groups: MistakeMoment[] = [];
  for (const m of timed) {
    const last = groups[groups.length - 1];
    if (
      last &&
      m.tS - last.items[last.items.length - 1]!.tS <= MISTAKE_MOMENT_GAP_S
    ) {
      last.items.push(m);
      if (SEVERITY_RANK[m.severity] > SEVERITY_RANK[last.severity]) {
        last.severity = m.severity;
      }
    } else {
      groups.push({ tS: m.tS, severity: m.severity, timed: true, items: [m] });
    }
  }
  for (const m of untimed) {
    groups.push({ tS: m.tS, severity: m.severity, timed: false, items: [m] });
  }
  return groups;
}

/**
 * 实测判别力(输−赢 触发率差,pp),同档内的排序键(GH #19,2026-08-20)。
 *
 * **来源**:`docs/coaching-grounding-audit.md` §C 正式重跑 —— 2026-08-20,
 * 459 场 / 2114 回合,外部 2100+ 队列,`packages/eval/scripts/discriminationScan.ts`;
 * 死亡锚定族(external-unused / death-unused-defensive)取同节「循环性质」行。
 * 没量过、或量出来是发生率伪影(slow-defensive-response 的 −4.1 已证实为
 * 分母伪影,转化率 +15.3pp 才是有效口径;unsynced-burst / attempt-into-trinket
 * 发生率 ≈0 但机会归一化有效)的类型**不登记** —— 缺席 = 0,退回按时间。
 * 不同口径的数字不能混进同一个排序键,宁可留空。
 *
 * **它只能证伪不能证实**(§C 自己的限制):所以它只在 severity 同档内打破平局,
 * 不做主序。表里的 key 必须是 MISTAKE_RULES 的 type(`missed-purge-kill-window`
 * 用候选 `missed-purge` 的数字 —— 击杀窗子集从未单独量过,这里取的是全集口径,
 * 已知偏差)。重跑 §C 后同步更新,测试钉住 key 都在规则表里。
 */
export const MISTAKE_DISCRIMINATION_PP: Readonly<Record<string, number>> = {
  "cd-hoarded": 22.7,
  "external-unused": 14.6,
  "cc-avoidable": 7.7,
  // death-unused-defensive (3.8) removed 2026-08-29 with its rule (GH #58 retirement) —
  // the discrimination table may only list types that still have a MISTAKE_RULES entry.
  "missed-purge-kill-window": 2.6,
};

function momentDiscrimination(m: MistakeMoment): number {
  let best = 0;
  for (const it of m.items) {
    const pp = MISTAKE_DISCRIMINATION_PP[it.type] ?? 0;
    if (pp > best) best = pp;
  }
  return best;
}

/**
 * 失误卡的展示顺序:严重度 → 同档内实测判别力 → 时间。纯函数,不改入参。
 * 之前卡片里是 `severity → 时间`,手工 severity 把判别力最差的类型排到
 * 第一屏(GH #19);现在 severity 仍是主序(它承载「死亡锚定」这类结构性
 * 判断),判别力只负责同档内谁先露面。
 */
export function rankMistakeMoments(
  moments: readonly MistakeMoment[],
): MistakeMoment[] {
  return [...moments].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      momentDiscrimination(b) - momentDiscrimination(a) ||
      a.tS - b.tS,
  );
}

/** owner 的 / 队友的 —— 卡片默认只展开前者,后者整块折叠。 */
export function splitMistakesByOwner(mistakes: readonly Mistake[]): {
  own: Mistake[];
  teammates: Mistake[];
} {
  return {
    own: mistakes.filter((m) => m.isOwner),
    teammates: mistakes.filter((m) => !m.isOwner),
  };
}
