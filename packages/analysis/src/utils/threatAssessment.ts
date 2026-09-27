import { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { getPressureThreshold, hasOffensiveSpellActive } from "./cooldowns";
import { getLowestHpPercentInWindow } from "./killWindowTargetSelection";

/**
 * threatAssessment.ts — P2 共用威胁谓词(单源 export),供 `cd-hoarded` /
 * `cd-spent-idle` 两个候选类型的威胁分级门消费(spec:
 * docs/superpowers/specs/2026-08-15-p1p2-distillation-design.md「威胁谓词」节,
 * B6 裁决:威胁不分级不出 cd-spent-idle)。
 *
 * 复用清单(先读后写,CLAUDE.md 共享谓词规则 —— 不重新发明既有压力判定):
 *  - `hasOffensiveSpellActive`(cooldowns.ts):panic-press 检测器
 *    (`detectPanicDefensives`)原有的私有判定,现导出复用。判「敌方进攻大 CD
 *    光环活跃」用的是真实光环区间(既有表 OFFENSIVE_SPELL_IDS,SpellTag.Offensive
 *    在 classMetadata 里的既有标注),不是从 extractMajorCooldowns 的施放时刻 +
 *    spellEffectGenerated 时长外推的估算窗口 —— 真实数据优先于估算这条先例见
 *    burstLedger.ts 里 defensivesHit 的同类注释。
 *  - `getPressureThreshold`(cooldowns.ts,已导出):同一「有意义的压力量」单源
 *    (面板血量 15%,无进阶数据时按角色兜底)。panic press 已用它反向判「无威胁
 *    才算 panic」;threatActiveAt 判「有威胁」是它的直接对偶,不新造一套阈值。
 *  - `getLowestHpPercentInWindow`(killWindowTargetSelection.ts,已导出,同一
 *    文件里 `matchMinHpPct` 也是它的一个特化调用)。**本文件不调用
 *    `matchMinHpPct`**——2026-08-15 复审明确指出两者语义不同,不能混用:
 *    `matchMinHpPct` 回答的是「整场有没有出现过任何一次真实险情」(无界窗口,
 *    单次险情就该算,cdWasteEvents 的承压门要的正是这个语义);
 *    `matchThreatLevel` 要回答的是「这场是不是持续/反复危险」,一次孤立的
 *    亚秒级 HP 谷值不能单独定性整场——同一个原始采样器
 *    `getLowestHpPercentInWindow`,两处各自传自己的窗口边界,不是同一个事实。
 *
 * ## `threatActiveAt` 的窗口口径
 * 判「t 时刻附近己方承伤」用多宽的窗口求和——healingGaps 的窗口锚在一段无治疗
 * 区间(变长,≥3.5s),panic press 的窗口锚在一次施放前后(3s前/4s后,不对称);
 * `threatActiveAt` 要回答的是「任意 t 附近有没有威胁」,不锚在某个事件,于是给
 * 了自己的对称窗口常量 `THREAT_DAMAGE_WINDOW_MS`(未做语料标定)。
 *
 * ## `matchThreatLevel` 的聚合形状(2026-08-15 复审 FINDING 1 修法)
 * 原实现直接分级 `matchMinHpPct`(全场最小值),被复审当场推翻:一次真实的
 * ~150ms HP 谷值(三敌合围瞬间打穿再被急救拉回)在原口径下会把「转好即用、
 * 危机被完美化解」的一局误判成 high——这正是 B6「威胁不分级就会反向误报」要
 * 防的那类事故,只是换了个方向发生。改为**事件式聚合**:固定步长采样
 * `threatActiveAt`,收拢成连续「威胁片段」;丢弃时长小于地板的片段(单个亚秒级
 * 样本形成的片段不算数);片段必须真的把某个友方打穿到 `THREAT_LEVEL_LOW_MIN_HP_PCT`
 * 分界线以下才算候选(44ea4cf6 第二个窗口——4:26 只打到 81% ——在这一步就被
 * 挡掉,根本不需要靠「持续时长」去救);候选片段若在结束后的恢复窗内回升到
 * 分界线以上,判定为「答坑」(B11:玩家 48% 开圣盾,守住即为正解,不计入错过),
 * 不计入升级;`"high"` 仅当剩余的「真实」片段持续够长,或出现 ≥2 个独立的真实
 * 片段(复现)。
 */

/** Symmetric half-width of the "friendly under fire" sampling window around a
 * queried instant. <标定定稿 2026-08-15,报告 p1p2-calibration.md>: narrowed
 * from the 5,000ms placeholder to 3,000ms — the placeholder's wider window
 * bridged routine incidental pokes across a match into one continuous
 * mega-segment (measured: 44ea4cf6's `threatActiveAt` true for 93.8% of
 * samples at 5,000ms — saturation, not signal), which broke B11's own
 * "answered" forgiveness (a segment that never actually closes has no "after
 * it ended" recovery window to check near the real dip). 双向误差注: any
 * WIDER window re-admits that saturation failure (5,000ms is the exact value
 * that produced it); a narrower window (2,000ms tested) over-fragments a
 * single sustained engagement into more, smaller segments, which push toward
 * false "high" via the "≥2 unanswered segments" recurrence rule instead. */
export const THREAT_DAMAGE_WINDOW_MS = 3_000;

/**
 * True when there is active enemy threat at `tSeconds`:
 *   - any enemy has an Offensive-tagged major CD aura active (existing table,
 *     real aura intervals via `hasOffensiveSpellActive`), OR
 *   - any friendly took damage totalling at least their own
 *     `getPressureThreshold` inside `[t - THREAT_DAMAGE_WINDOW_MS, t +
 *     THREAT_DAMAGE_WINDOW_MS]`.
 *
 * A per-instant primitive — `matchThreatLevel` samples this at a fixed step to
 * reconstruct threat *segments*; it is not itself a claim about how long or
 * how often the danger lasted.
 */
export function threatActiveAt(
  tSeconds: number,
  enemies: ICombatUnit[],
  friendlies: ICombatUnit[],
  combat: Pick<AtomicArenaCombat, "startTime"> &
    Partial<Pick<AtomicArenaCombat, "endTime">>,
  // Calibration-only override (Task 5, packages/eval/src/explore/
  // candidateCalibration.ts): defaults to the module constant, so every
  // production call site (unparameterized) is byte-identical to before this
  // was added — the override exists so the corpus sensitivity sweep calls
  // the REAL predicate at swept values instead of a second, drift-prone
  // reimplementation (CLAUDE.md shared-predicate rule).
  overrides?: { damageWindowMs?: number },
): boolean {
  const windowMs = overrides?.damageWindowMs ?? THREAT_DAMAGE_WINDOW_MS;
  const tMs = combat.startTime + tSeconds * 1000;

  // GH #119: the round, so aura-evidenced bursts read the timeline's bounds
  const round =
    typeof combat.endTime === "number"
      ? { startTime: combat.startTime, endTime: combat.endTime }
      : undefined;
  if (
    enemies.some((e) =>
      hasOffensiveSpellActive(e, tMs, null, undefined, round),
    )
  )
    return true;

  const fromMs = tMs - windowMs;
  const toMs = tMs + windowMs;
  for (const f of friendlies) {
    const dmg = f.damageIn
      .filter(
        (d) => d.logLine.timestamp >= fromMs && d.logLine.timestamp <= toMs,
      )
      .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
    if (dmg >= getPressureThreshold(f)) return true;
  }
  return false;
}

export type MatchThreatLevel = "low" | "med" | "high";

/**
 * Depth line a threat segment must actually cross to count as dangerous at
 * all, and the bar a segment must recover back above ("answered") to be
 * forgiven. <标定定稿 2026-08-15,报告 p1p2-calibration.md>: lowered from the
 * 70% placeholder to 45% — at 70%, a long grindy match's ordinary HP
 * oscillation (five-plus separate real-corpus segments dipping to
 * 33–56% while otherwise under control) already exceeds the "≥2 unanswered
 * segments" recurrence bar on its own, independent of the window-width fix
 * above (measured on 44ea4cf6, a match the user ruled should read "low").
 * 45% matches `CD_HOARD_CRISIS_HP_PCT` (candidateFindings.ts) — both name
 * "a friendly is in a real HP crisis", landing on the same number is a
 * coincidence of two independent calibration passes agreeing, not a shared
 * constant. 双向误差注: raising this back toward 70% re-admits the
 * saturation false-"high" above; lowering it further (35% tested) risks
 * under-catching a sustained mid-30s-to-40s HP grind that never quite
 * touches a single extreme low — the number is shared for both directions on
 * purpose, a segment that never crosses it never needed forgiveness, and a
 * segment that climbs back above it has, by the same definition, stopped
 * being a low-HP scare.
 */
export const THREAT_LEVEL_LOW_MIN_HP_PCT = 45;

/** Fixed-step grid `matchThreatLevel` samples `threatActiveAt` on to
 * reconstruct contiguous threat segments. <标定定稿 2026-08-15,报告
 * p1p2-calibration.md>: confirmed adequate at its 1s placeholder — every
 * downstream constant in this file is denominated in seconds, a coarser step
 * would just be sampling noise on top of an already-second-granular render
 * grid, unchanged. */
export const THREAT_SAMPLE_STEP_S = 1;
/** A run of true samples shorter than this is a lone/sub-step blip, not a
 * segment — this is what keeps a single ~150ms HP trough (one sample wide at
 * this grid) from reading as "a period of danger" on its own. <标定定稿
 * 2026-08-15,报告 p1p2-calibration.md>: confirmed adequate at its 2s
 * placeholder — the corpus hard-acceptance frontier search (44ea4cf6=low,
 * 76ea5f90=high) was satisfied at every tested value from 2s through 20s, so
 * the window/low-HP-line fixes above did the real work; kept at 2s (the
 * floor of "more than one lone sample") rather than moved with no
 * corpus-driven reason to move it. 双向误差注: raising it toward the
 * 20s persist bar would fold this gate's job into
 * `THREAT_SEGMENT_PERSIST_S`'s, losing the "drop a sub-step blip" floor
 * this constant exists for; there was no evidence lowering it below 2s (a
 * single rendered second) would change anything, since one sample cannot be
 * shorter than the sampling grid itself. */
export const THREAT_SEGMENT_MIN_DURATION_S = 2;
/** A single un-answered segment lasting at least this long counts as "high"
 * even without a second segment (the "persists" half of B6's "high only when
 * a segment persists or recurs"). <标定定稿 2026-08-15,报告
 * p1p2-calibration.md>: confirmed adequate at its 20s placeholder — the
 * hard-acceptance frontier held at every tested value (15s/20s/25s/30s/40s),
 * so no corpus evidence favored moving it; kept at 20s, the value the
 * placeholder's own doc comment already justified against
 * `EXTERNAL_FREE_MIN_GAP_S`-style reaction-time noise floors. 双向误差注:
 * shorter would start reclassifying a single brief real scare as
 * match-defining "high" on persistence alone; longer would let a sustained
 * ~20–30s crisis undercount as merely "med" unless a second segment recurs.
 */
export const THREAT_SEGMENT_PERSIST_S = 20;
/** Window after a segment ends in which every friendly must recover back
 * above THREAT_LEVEL_LOW_MIN_HP_PCT for the segment to count as "answered"
 * (B11). <标定定稿 2026-08-15,报告 p1p2-calibration.md>: confirmed adequate
 * at its 15s placeholder — same frontier-search result as
 * `THREAT_SEGMENT_PERSIST_S` above (held at every tested value 10s–30s), and
 * this is the exact mechanism the B11 ruling (48% bubble, 守住是正解) is
 * built on, so it was left untouched absent corpus evidence to move it.
 * 双向误差注: a shorter window would forgive fewer real saves (a bubble that
 * pulls a friendly back above the line 16s later would wrongly still count
 * as "not answered"); a longer window risks crediting an UNRELATED later
 * recovery (a different heal, minutes on) as having answered this specific
 * segment. */
export const THREAT_RECOVERY_WINDOW_S = 15;

interface IThreatSegment {
  fromS: number;
  toS: number;
}

/** Calibration-only override bundle for `matchThreatLevel` (Task 5, see the
 * `threatActiveAt` override doc comment above for why this exists — same
 * "swept values through the real predicate" rationale, just threaded through
 * every constant this aggregation consumes). Every field defaults to its
 * module constant; omitting `overrides` entirely reproduces today's
 * production behavior exactly. */
export interface IThreatLevelOverrides {
  damageWindowMs?: number;
  segmentMinDurationS?: number;
  lowMinHpPct?: number;
  persistS?: number;
  recoveryWindowS?: number;
}

/**
 * Fixed-step reconstruction of `threatActiveAt`'s true/false timeline into
 * contiguous segments (step 1), dropping any segment shorter than
 * `THREAT_SEGMENT_MIN_DURATION_S` (step... the floor half of step 1).
 */
function threatSegments(
  enemies: ICombatUnit[],
  friendlies: ICombatUnit[],
  combat: Pick<AtomicArenaCombat, "startTime" | "endTime">,
  overrides?: IThreatLevelOverrides,
): IThreatSegment[] {
  const minDurationS =
    overrides?.segmentMinDurationS ?? THREAT_SEGMENT_MIN_DURATION_S;
  const matchDurationS = (combat.endTime - combat.startTime) / 1000;
  const segments: IThreatSegment[] = [];
  let openFromS: number | null = null;

  for (let t = 0; t <= matchDurationS; t += THREAT_SAMPLE_STEP_S) {
    const active = threatActiveAt(t, enemies, friendlies, combat, {
      damageWindowMs: overrides?.damageWindowMs,
    });
    if (active && openFromS === null) {
      openFromS = t;
    } else if (!active && openFromS !== null) {
      segments.push({ fromS: openFromS, toS: t });
      openFromS = null;
    }
  }
  if (openFromS !== null) {
    segments.push({ fromS: openFromS, toS: matchDurationS });
  }

  return segments.filter((s) => s.toS - s.fromS >= minDurationS);
}

/**
 * The worst (lowest) HP% any friendly reached DURING the segment's own span —
 * bounded to the segment, unlike `matchMinHpPct`'s whole-match unbounded
 * window (see the file header: deliberately not the same predicate). A
 * segment whose worst point never actually dropped below
 * `THREAT_LEVEL_LOW_MIN_HP_PCT` never counted as dangerous — the gate that
 * keeps the 44ea4cf6 second window (4:26, only down to 81%) from reading as
 * its own dangerous episode.
 */
function segmentWorstHpPct(
  seg: IThreatSegment,
  friendlies: ICombatUnit[],
  matchStartMs: number,
): number | null {
  const vals = friendlies
    .map((f) => getLowestHpPercentInWindow(f, seg.fromS, seg.toS, matchStartMs))
    .filter((v): v is number => v !== null);
  return vals.length > 0 ? Math.min(...vals) : null;
}

/**
 * "Answered the pit" (B11: player pressed a 48% defensive, held, and the user
 * ruled that surviving it is the correct play — not a miss to coach). Every
 * friendly must recover back above `THREAT_LEVEL_LOW_MIN_HP_PCT` within
 * `THREAT_RECOVERY_WINDOW_S` of the segment ending for it to count as
 * answered. Missing data in the recovery window (e.g. the friendly died and
 * left no further samples) is NOT recovery — silence here must not read as
 * "fine", or a death right at a segment's edge would be forgiven.
 */
function segmentAnswered(
  seg: IThreatSegment,
  friendlies: ICombatUnit[],
  matchStartMs: number,
  overrides?: IThreatLevelOverrides,
): boolean {
  const recoveryWindowS =
    overrides?.recoveryWindowS ?? THREAT_RECOVERY_WINDOW_S;
  const lowMinHpPct = overrides?.lowMinHpPct ?? THREAT_LEVEL_LOW_MIN_HP_PCT;
  return friendlies.every((f) => {
    const recovered = getLowestHpPercentInWindow(
      f,
      seg.toS,
      seg.toS + recoveryWindowS,
      matchStartMs,
    );
    return recovered !== null && recovered >= lowMinHpPct;
  });
}

/**
 * Whole-match pressure classification (B6): "was this match sustained or
 * recurringly dangerous for my team" — deliberately NOT "did HP ever dip
 * anywhere" (see the file header). No advanced-logging data on any friendly →
 * "low" (cannot confirm threat, and B6's ruling is specifically that an
 * unconfirmed/absent threat must not gate a warning into existence).
 *
 * Otherwise: reconstruct threat segments (see `threatSegments`), keep only
 * the ones that (a) actually crossed `THREAT_LEVEL_LOW_MIN_HP_PCT` and (b)
 * were not "answered" within the recovery window. Zero such segments → low;
 * a single one shorter than `THREAT_SEGMENT_PERSIST_S` → med; a single one at
 * least that long, or two or more independent ones (recurrence) → high.
 */
export function matchThreatLevel(
  enemies: ICombatUnit[],
  friendlies: ICombatUnit[],
  combat: Pick<AtomicArenaCombat, "startTime" | "endTime">,
  // Calibration-only override, see IThreatLevelOverrides' doc comment —
  // omitted (the production call shape) reproduces today's behavior exactly.
  overrides?: IThreatLevelOverrides,
): MatchThreatLevel {
  const hasAnyHpData = friendlies.some((f) => f.advancedActions.length > 0);
  if (!hasAnyHpData) return "low";

  const lowMinHpPct = overrides?.lowMinHpPct ?? THREAT_LEVEL_LOW_MIN_HP_PCT;
  const persistS = overrides?.persistS ?? THREAT_SEGMENT_PERSIST_S;
  const matchStartMs = combat.startTime;
  const real = threatSegments(enemies, friendlies, combat, overrides).filter(
    (seg) => {
      const worst = segmentWorstHpPct(seg, friendlies, matchStartMs);
      if (worst === null || worst >= lowMinHpPct) return false;
      return !segmentAnswered(seg, friendlies, matchStartMs, overrides);
    },
  );

  if (real.length >= 2) return "high";
  if (real.length === 1) {
    const durationS = real[0].toS - real[0].fromS;
    return durationS >= persistS ? "high" : "med";
  }
  return "low";
}
