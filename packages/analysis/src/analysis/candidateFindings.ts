import type { ICombatUnit } from "@gladlog/parser-compat";
import { CombatUnitClass, CombatUnitReaction } from "@gladlog/parser-compat";

import { mateHitDuringCc } from "../context/observedConsequences";
import {
  lookupBacklashPrior,
  lookupBacklashWorth,
} from "../data/backlashDispelPrior";
import { lookupBehaviorPrior } from "../data/behaviorPrior";
import { lookupBurstWindowPrior } from "../data/burstWindowPrior";
import {
  BRACKET_TYPE_ALLOWLIST,
  CANDIDATE_TYPE_FLAGS,
} from "../data/candidateTypeFlags";
import { costNormPhrase } from "../data/curatedAbilityFacts";
import { CORPUS_OBSERVED_DISPEL_IDS } from "../data/dispelObservedGenerated";
import { lookupKickPriorityPrior } from "../data/kickPriorityPrior";
import { resolveMitigation, wallDoorPct } from "../data/mitigationComponents";
import { OFF_GCD_SPELL_IDS } from "../data/offGcdGenerated";
import { getEnglishSpellName } from "../data/spellEffectData";
import { spellSchoolMask } from "../data/spellSchools";
import { ccSpellIds } from "../data/spellTags";
import { lookupSyncWindowPrior } from "../data/syncWindowPrior";
import {
  type DecisionRecord,
  isDecisionTraceActive,
  traceDecision,
} from "../facts/decisionTrace";
import { buildAuraIntervals } from "../utils/auraIntervals";
import { bracketKey } from "../utils/bracketKey";
import { analyzeBurstLedger } from "../utils/burstLedger";
import {
  buildCannotCastIntervals,
  couldRespondFor,
} from "../utils/cannotCastIntervals";
import { type OwnerCastCancels,ownerCastCancels } from "../utils/castCancels";
import {
  analyzePlayerCCAndTrinket,
  applicableCCAvoidanceIds,
  CC_AVOIDANCE_BUFF_SPELLS,
  type ICCInstance,
  POST_KICK_WINDOW_S,
  postKickSeverityRank,
  REPOSITIONING_SPELL_IDS,
} from "../utils/ccTrinketAnalysis";
import {
  annotateDefensiveTimings,
  cdAvailableAt,
  cdIsProcOnly,
  DEFENSIVE_TAGS,
  extractMajorCooldowns,
  type IAvailableWindow,
  type IMajorCooldownInfo,
  isAllyCastableDefensive,
  isHealerSpec,
  isMeleeSpec,
  isPassiveProcCast,
  kitSpellReadyAt,
  playerTalentIdSets,
  REACTION_WINDOW_S,
  specToString,
  USABLE_WHILE_CC_SPELL_IDS,
  USABLE_WHILE_CONFUSED_SPELL_IDS,
  USABLE_WHILE_FEARED_SPELL_IDS,
} from "../utils/cooldowns";
import {
  annotateMissedPurgesWithKillWindows,
  canRemoveFrom,
  hardCastOccupancyWithin,
  type IMissedCleanseWindow,
  type IMissedPurgeWindow,
  reconstructDispelSummary,
} from "../utils/dispelAnalysis";
import { drResetMsAt } from "../utils/drAnalysis";
import { reconstructEnemyCDTimeline } from "../utils/enemyCDs";
import {
  externalDamageForApplication,
  formatDuringExternalForOwner,
} from "../utils/externalDamage";
import { detectHealingGaps, type IHealingGap } from "../utils/healingGaps";
import {
  attemptIntoTrinketEvents,
  extractKillAttempts,
} from "../utils/killAttempts";
import {
  analyzeKillWindowTargetSelection,
  matchMinHpPct,
} from "../utils/killWindowTargetSelection";
import { computeOffensiveWindows } from "../utils/offensiveWindows";
import {
  computeOwnerPositionEvents,
  type IPositionEvent,
  POSITION_MISTAKES,
  stayedInHadRealCost,
} from "../utils/positionAnalysis";
import {
  type CastFailedEvent,
  castFailedInWindow,
  type RawStreams,
} from "../utils/rawStreams";
import { toRenderSecond } from "../utils/renderGrid";
import { spellRangeForCaster, spellReachForCaster } from "../utils/spellRange";
import { getSpellSchoolName } from "../utils/spellSchools";
import { getTalentAvoidanceTriggers } from "../utils/talentBehaviors";
import { matchThreatLevel, threatActiveAt } from "../utils/threatAssessment";
import { burstWindowDecisionPoints } from "./burstWindowDecisionPoints";
import {
  backlashDispelDecisionPoints,
  backlashDispelEvents,
  backlashDispelWindowEvents,
} from "./candidates/backlashDispel";
import { burstWindowResponseEvents } from "./candidates/burstWindowResponse";
import {
  cdHoardedEvents,
  cdSpentIdleEvents,
  countsAsTeamBurst,
  enemyHealerCcWindows,
  enemyMinHpPctInWindow,
  friendlyCrisisMomentInWindow,
  missedSyncWindowEvents,
  unsyncedBurstEvents,
} from "./candidates/cooldownTiming";
import { crisisNoResponseEvents } from "./candidates/crisisNoResponse";
import {
  deathSetupEvents,
  type DeathSetupParts,
  externalUnusedEvents,
  questionableExternalEvents,
} from "./candidates/death";
import {
  kickPriorityDecisionPoints,
  kickPriorityMissedEvents,
  kickPriorityTeamEvents,
} from "./candidates/kickPriority";
import {
  CYCLONE_SPELL_ID,
  DIVINE_SHIELD_SPELL_ID,
  ICE_BLOCK_SPELL_ID,
  type IStrategicHolder,
  MD_SPELL_ID,
  mdCycloneWindowEvents,
} from "./candidates/massDispel";
import {
  filterIntentGuardEvidence,
  INTENT_GUARD_GCD_S,
} from "./candidates/shared";
import {
  teammateCrisisIdleEvents,
  teammateCrisisTriageEvents,
} from "./candidates/teammateCrisisIdle";
import { CRISIS_HP_PCT, crisisDecisionPoints } from "./crisisDecisionPoints";
import { fmtFactNum as fmt, fmtFactTime } from "./factFormat";
import {
  kickIsHarmless,
  type KickPressure,
  kickPressureFor,
  type KickSidePressure,
} from "./kickPressure";
import { majorWallIntervals } from "./stackedDefensives";
import { teammateCrisisPoints } from "./teammateCrisis";
import type { CandidateEvent } from "./types";

// Cooldown-timing producers moved to `candidates/cooldownTiming.ts` in the
// 2026-08-16 theme split; re-exported so importers keep their paths.
export {
  CD_HOARD_CRISIS_HP_PCT,
  CD_HOARD_RESPONSE_S,
  CD_HOARDED_OUTCOME_REF,
  cdHoardedEvents,
  cdSpentIdleEvents,
  enemyHealerCcWindows,
  enemyMinHpPctInWindow,
  friendlyCrisisMomentInWindow,
  HARD_CC_CATEGORIES,
  type ICdHoardedCrisisSource,
  type ICrisisMoment,
  type IEnemyHealerCcWindow,
  missedSyncWindowEvents,
  unsyncedBurstEvents,
} from "./candidates/cooldownTiming";

// Death-anchored producers moved to `candidates/death.ts` in the 2026-08-16
// theme split; re-exported so importers keep their paths.
export {
  deathSetupEvents,
  type DeathSetupParts,
  EXTERNAL_FREE_MIN_GAP_S,
  EXTERNAL_FREE_WINDOW_S,
  externalUnusedEvents,
  questionableExternalEvents,
} from "./candidates/death";

// The mana producers and their calibrated thresholds moved to
// `candidates/mana.ts` in the 2026-08-16 theme split. Re-exported here so the
// package barrel, eval's calibration sweep and the existing tests keep their
// import paths — the split is mechanical, the public surface is unchanged.
export {
  MANA_EFF_FLOOR,
  MANA_EFF_MIN_CASTS,
  MANA_PRESSURE_LOW_PCT,
  MANA_PRESSURE_MIN_FAILED,
  MANA_PRESSURE_MIN_WINDOW_S,
  MANA_PRESSURE_TAIL_MAX_GAP_S,
  manaEfficiencyEvents,
  manaPressureEvents,
} from "./candidates/mana";

// crisis-no-response (spec 2026-08-29): lives in `candidates/crisisNoResponse.ts`
// alongside the shared `crisisDecisionPoints` predicate it consumes;
// re-exported here so the package barrel and existing tests keep one import
// path, same convention as the mana/cooldownTiming/death splits above.
export {
  CRISIS_NO_RESPONSE_CAP,
  crisisNoResponseEvents,
} from "./candidates/crisisNoResponse";

/** Single-source predicate (CLAUDE.md shared-predicate rule; review round 1,
 * BACKLOG #26 Task 2 Minor finding): the candidate types
 * `formatAttemptedFact` ever populates `facts.attempted` on today (the second
 * one, death-unused-defensive, had its emitter deleted 2026-09-24).
 * `auditFindings.ts`'s severity downgrade gates on this set (mirroring how
 * `LEGACY_TOPIC_TYPES` gates the diversity cap) rather than on the bare
 * `facts.attempted` string key alone — a future candidate type that happens
 * to reuse that key for an unrelated fact must NOT silently start
 * downgrading severity too. */
export const ATTEMPTED_GUARD_TYPES: ReadonlySet<string> = new Set([
  "cd-hoarded",
]);

/**
 * Map never-used major cooldowns to cd-waste candidate events. Pure (no combat
 * traversal) so the mapping rule is unit-testable with hand-built cooldown
 * fixtures; the extractMajorCooldowns integration is exercised on real matches.
 *
 * Rule: emit for a cooldown that was never used AND is a pure survival wall.
 * Throughput CDs (isThroughput — e.g. Power Infusion) are excluded: a never-used
 * throughput CD is a different, weaker coaching point than a never-used defensive.
 *
 * Pressure gate (2026-07-26): if the owner's whole-round minHP >= threshold,
 * emit nothing. Empirical evidence from 12 Holy Priest rounds: low-pressure
 * rounds (minHP 70-94%) were false-positived as "never used all round" 8/8,
 * while rounds where the wall was genuinely needed had minHP 9-52%; 60% falls
 * inside the separating gap. minHpPct=null (old logs without advanced params)
 * still emits, conservatively — never silently drop coverage.
 */
export const CD_WASTE_PRESSURE_HP_PCT = 60;

export function cdWasteEvents(
  cds: (Pick<
    IMajorCooldownInfo,
    "spellId" | "spellName" | "neverUsed" | "isThroughput"
  > &
    /** GH #29 第 5 项(2026-08-23,DPS 视角实测):这条指控在 prompt 图例里写的是
     *  「a major **defensive** cooldown the player never pressed」,而判据用的是
     *  `!isThroughput` —— 那只等于「不是 Offensive-tagged」,于是**整个 Control
     *  集合**被当成「你整局没交的保命技能」。治疗视角看不到(0/17),换 DPS 视角
     *  立刻暴露:**58/176(33%)**引用的是 Control CD(致盲 13、龙息 7、雷鸣怒吼 6、
     *  恐惧嚎叫 4、变形术 4、焦油陷阱 4、震荡波 3…)。tag 可选,缺省退回原判据。 */
    Partial<Pick<IMajorCooldownInfo, "tag" | "responseOnly">>)[],
  healer: { id: string; name: string },
  minHpPct: number | null,
): CandidateEvent[] {
  if (minHpPct !== null && minHpPct >= CD_WASTE_PRESSURE_HP_PCT) return [];
  const out: CandidateEvent[] = [];
  for (const cd of cds) {
    // 指控说「防御」,就只能问防御 tag —— 不能拿「不是进攻」凑数。
    const isDefensive = cd.tag === undefined || DEFENSIVE_TAGS.has(cd.tag);
    // 「整局没交」对没有按键的能力不成立(`PROC_ONLY_ACTIVATION_IDS`)。
    if (cdIsProcOnly(cd)) continue;
    // A response-only save (Barkskin / Frenzied Regeneration, user ruling
    // 2026-09-25 「不指控」) is never "never used".
    if (cd.responseOnly) continue;
    if (cd.neverUsed && !cd.isThroughput && isDefensive) {
      // Cost-norm guard (#25, 2026-08-14): a never-used major defensive is
      // exactly the shape of fact that tempts the model into "you should
      // have used your X" — for a signed-off cost_norm ability (Divine
      // Shield/Ice Block: mechanically usable, but too costly to coach as a
      // routine reaction) that advice is wrong. Same precedent as the dispel
      // capability gates (candidateFindings.ts's missed-cleanse
      // ownerCanDispel): the fact carries the guard, the prompt explains it.
      const costNorm = costNormPhrase(cd.spellId);
      out.push({
        id: `cd-waste:${healer.id}:${cd.spellId}`,
        type: "cd-waste",
        t: 0, // whole-round observation, not time-specific
        unitNames: [healer.name],
        spell: cd.spellName,
        spellId: cd.spellId,
        facts: {
          spell: cd.spellName,
          unit: healer.name,
          ...(costNorm ? { costNorm } : {}),
        },
      });
    }
  }
  return out;
}

/**
 * Structured, verifiable candidate events for the findings pipeline. Built on
 * the parsed combat directly (NOT a refactor of buildMatchContext). Extensible
 * by pushing more typed events.
 *
 * Current menu:
 *  - death (all units, tagged friendly/enemy so the LLM knows kill vs loss)
 *  - death-setup (all owners): causal-chain precursors to a friendly death
 *    (healer-locked / trinket-early / defensive-early), <=2 per death, each
 *    timestamped before the death
 *  - cd-waste (the owner's — default: the Friendly healer's — never-used
 *    DEFENSIVE major cooldowns)
 *  - DPS owner only: burst-into-immunity / burst-into-mitigation /
 *    off-target-in-window / juked-kick / dr-clipped-cc / unconverted-burst
 */
/**
 * Major walls friendlies had up on a unit (reliability audit A2, 2026-09-24):
 * the shared protection-evidence record — the same `majorWallIntervals` the
 * [STACKED DEFENSIVES] line reads, friendly casters only (the unit's own team,
 * as that line defines it). Read by cd-hoarded and crisis-no-response (A2b),
 * which both ABSTAIN at a crossing a wall already covers — never "responded",
 * never "enough protection".
 */
function majorWallsOnFor(
  combat: any,
): (unit: any) => ReturnType<typeof majorWallIntervals> {
  const wallPlayers = (Object.values(combat.units ?? {}) as any[]).filter(
    (u) => u.info,
  );
  const wallById = new Map<string, any>(wallPlayers.map((u) => [u.id, u]));
  return (unit: any) => {
    try {
      return majorWallIntervals(
        unit,
        combat,
        wallById,
        new Set(
          wallPlayers
            .filter((u) => u.reaction === unit.reaction)
            .map((u) => u.name),
        ),
      );
    } catch {
      return [];
    }
  };
}

/**
 * The candidate type encoded in a candidate id — every builder in this file
 * and candidates/*.ts writes ids as `<type>:<...>` (e.g.
 * `cd-hoarded:Player-…:5211:0`). Shared inverse for consumers that only have
 * the id (a stored finding's `eventIds`, GH #18 review bench 2026-08-30);
 * returns null when the id carries no `:`.
 */
export function candidateTypeOfId(id: string): string | null {
  const i = id.indexOf(":");
  return i > 0 ? id.slice(0, i) : null;
}

export function extractCandidateFindings(
  combat: any,
  ownerId?: string,
  /**
   * Intent guard (BACKLOG #26 Task 2, 意图守护): raw.txt's SPELL_CAST_FAILED
   * stream, when the caller has it available — desktop main reads raw.txt
   * lazily and passes the parsed streams through; renderer callers fetch it
   * over the existing IPC boundary (see analysisInput.ts's
   * `getRawStreamsSync`). Optional and silently degrading (Global Constraint):
   * absent, or `available:false` (raw.txt missing/unreadable), makes every
   * downstream candidate byte-identical to before this param existed.
   */
  rawStreams?: RawStreams,
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  const units = Object.values(combat?.units ?? {}) as any[];
  const start = combat?.startTime ?? 0;

  // --- player deaths, tagged friendly/enemy ---
  // Players only: every arena combatant emits COMBATANT_INFO (u.info); pets,
  // totems, and guardians do not. A pet death is noise (they die and resummon
  // constantly) and would mislead the coach if tagged as a "friendly death".
  for (const u of units) {
    if (!u.info) continue;
    for (const d of (u.deathRecords ?? []) as any[]) {
      const t = ((d.timestamp ?? 0) - start) / 1000;
      const side =
        u.reaction === CombatUnitReaction.Friendly ? "friendly" : "enemy";
      // Enemy-side deaths (kill review) demoted 2026-08-30 — see the flag.
      if (side === "enemy" && !CANDIDATE_TYPE_FLAGS.killReview) continue;
      out.push({
        id: `death:${u.id}:${Math.round(t)}`,
        type: "death",
        t,
        unitNames: [u.name],
        // Render-grid fix (2026-08-30, same bug/fix as kick-eaten): matches
        // the [DEATH] timeline marker, which floors via fmtTime -- 23/375
        // (6.1%) death lines on the 2026-08-30 A/B corpus rounded up past
        // the marker's whole second before this.
        facts: { t: fmtFactTime(t), unit: u.name, side },
      });
    }
  }

  // When ownerId is absent, fall back to the friendly healer (existing
  // behavior; the healer pipeline's menu is unchanged). The fallback MUST be
  // resolved before calling extractDeathSetups — previously the raw ownerId
  // (undefined) was forwarded straight through, so isOwner/ownerUnit were
  // always false/undefined and death-unused-defensive / external-unused could
  // never be emitted, breaking the "default to the friendly healer" API
  // contract (found in agy review, adopted). The cd-waste branch reuses this
  // same healer instead of recomputing it.
  const healer = units.find(
    (u) =>
      u.info &&
      u.reaction === CombatUnitReaction.Friendly &&
      isHealerSpec(u.spec),
  );
  const resolvedOwnerId = ownerId ?? healer?.id;

  // --- death-setup: causal chain behind a friendly death (reasoning-chain
  // evidence, emitted for every owner perspective) ---
  try {
    out.push(
      ...extractDeathSetups(combat, units, start, resolvedOwnerId, rawStreams),
    );
  } catch {
    /* no analysis throw may take down the rest of the menu */
  }

  // --- cd-waste: the owner's never-used defensive cooldowns ---
  const owner =
    (ownerId ? units.find((u) => u.info && u.id === ownerId) : undefined) ??
    healer;
  // Hoisted out of the block below (2026-08-06) so team-play events (POSITION-001 /
  // COOLDOWN-001) can reuse the same computation instead of re-fetching it.
  let ownerCds: IMajorCooldownInfo[] = [];
  if (owner) {
    try {
      ownerCds = extractMajorCooldowns(owner, combat);
    } catch {
      ownerCds = [];
    }
    out.push(...cdWasteEvents(ownerCds, owner, matchMinHpPct(owner)));
  }

  // --- DPS owner events (D2) — healer owners skip this whole branch ---
  if (owner && !isHealerSpec(owner.spec)) {
    try {
      out.push(...dpsOwnerEvents(combat, owner, units));
    } catch {
      /* no analysis throw may take down the rest of the menu */
    }
  }

  // --- team-play events (every owner perspective; coverage expansion
  // 2026-07-24) ---
  // Motivation (measured via evidenceDist): the healer-perspective menu
  // averaged 3.4 events/match, 41% of matches had <=2, and 15/17 matches only
  // covered the final third — of the existing types the four offensive ones
  // can't fire for a healer, leaving only death (naturally at the end).
  // Missed cleanse / missed purge / chain-CC'd / eating a full kick span the
  // whole match and correlate strongly with healer play.
  if (owner) {
    try {
      out.push(
        ...teamPlayEvents(combat, owner, units, ownerCds, out, rawStreams),
      );
    } catch {
      /* no analysis throw may take down the rest of the menu */
    }
  }

  // Reliability round 2 W1a (2026-09-25): in Solo Shuffle the round ends at
  // the first player death — nothing after it is playable, yet the log keeps
  // running for a few seconds and candidates fired there (7b3c: crisis-no-
  // response and cd-hoarded at 1:47 after the round-ending death at 1:46.4).
  // Deaths themselves stay; every other event must be at or before it.
  const roundEnded = afterShuffleRoundEnd(combat, units, start);
  const inRound = roundEnded
    ? out.filter((e) => e.type === "death" || !roundEnded(e.t))
    : out;

  // Per-bracket allow-list (GH #18 ruling 2026-08-30): a listed bracket keeps
  // only its named types; the rest of the menu becomes context.
  const bk = bracketKey(combat?.startInfo?.bracket);
  const allow = bk ? BRACKET_TYPE_ALLOWLIST[bk] : undefined;
  return allow ? inRound.filter((e) => allow.has(e.type)) : inRound;
}

/**
 * Solo Shuffle only: a predicate "is second `t` after the round-ending death",
 * or undefined for other brackets / a round with no player death. `t` is a
 * candidate's own `t` (render-grid seconds for most types), compared with the
 * raw first death, so a candidate in the death's own displayed second stays.
 */
export function afterShuffleRoundEnd(
  combat: any,
  units: any[],
  start: number,
): ((t: number) => boolean) | undefined {
  if (combat?.startInfo?.bracket !== "Rated Solo Shuffle") return undefined;
  let firstDeathS = Infinity;
  for (const u of units) {
    if (!u.info) continue;
    for (const d of (u.deathRecords ?? []) as any[])
      firstDeathS = Math.min(firstDeathS, ((d.timestamp ?? 0) - start) / 1000);
  }
  if (!Number.isFinite(firstDeathS)) return undefined;
  return (t) => t > firstDeathS;
}

/** Per-match cap for each team-play type (sorted by coaching value, then
 * truncated, so one type can't flood the menu).
 *
 * Per-round throttle(2026-08-06 立,BACKLOG #22;**2026-08-20 复查后确认
 * 长期保留,不再是 TEMPORARY** —— 用户裁定):当年 200 场扫描四族占全部
 * 候选 ~66%,故设硬上限。当年写的取消条件(「信号扩容后恢复到 3」)已按
 * 数字复查:扩容落地、cc-locked/wasted-trinket 退役、族缩为
 * cleanse/purge 之后,cap=2 下族占菜单 16.8%(健康),但 **无 cap 模拟
 * = 64.6%,与当年触发限流的 64% 一模一样** —— purge 原始窗口场均 12.6
 * 条,cap 依然承重;恢复到 3 会把占比推到 ~25%,无收益证据(missed-purge
 * 判别力弱正,#21 保留裁定未要求更多曝光)。数字在 issue #16/#22 相关
 * 评论。cap 只砍量不砍质 —— 每类仍按自身 severity 排序后截断,最高价值
 * 实例保留。
 *
 * These same four types are also `LEGACY_TOPIC_TYPES` below — that set is the
 * SELECTION-layer counterpart of this menu-generation throttle: a 2026-08-11
 * four-backend measurement (diversity-baseline-report.md) found the model's
 * picking step ALSO over-selects these four relative to their already-capped
 * menu share (+3.4~+7.5pt at survival), so buildFindingsPrompt's prompt text
 * and auditFindings' deterministic cap both key off that one set instead of
 * re-listing the four names a third time.
 *
 * 2026-08-26 全族 at-cap 体检(GH #34 第二批;S2 快照 200 文件 / 782 owner-回合,
 * 治疗+DPS 双视角;「产出==cap」为截断的下界代理,全表在 GH #34 评论):
 * missed-purge 在 **94% 的有产出回合打到上限**(455/485)—— 与上段「原始窗口
 * 场均 12.6 条」的复查数字互证,cap 仍是全家族最承重的一条;kick-eaten 59%
 * (136/231)、missed-cleanse 28%(34/121);cc-locked / wasted-trinket 已退役,
 * 其产出函数与 cap 已于 2026-09-24 删除。
 */
const MISSED_CLEANSE_CAP = 2;
const MISSED_PURGE_CAP = 2;
const KICK_EATEN_CAP = 2;

/** Single-source predicate (CLAUDE.md shared-predicate rule): the
 * candidate-menu types this repo has repeatedly measured the SELECTION layer
 * (not just candidate generation) over-picking. `buildFindingsPrompt.ts`
 * enumerates these names into its per-type selection cap instruction, and
 * `auditFindings.ts` enforces the same cap deterministically on survivors —
 * both import this set rather than hand-listing the type strings a
 * second/third time. See the BACKLOG #22 block comment above for the
 * menu-generation-side throttle these mirror.
 *
 * 2026-08-19 (GH #14): cc-locked retired from the menu entirely, then
 * wasted-trinket followed the same day (B-group re-measurement, see both
 * retirement notes at their former emission sites) — the family shrank from
 * four to two. The selection instruction, the audit backstop, and the drift
 * tests all derive from this set and moved together. */
export const LEGACY_TOPIC_TYPES: ReadonlySet<string> = new Set([
  "missed-cleanse",
  "missed-purge",
]);

/**
 * Signal-expansion batch 1 thresholds/caps (2026-08-06, BACKLOG #18 second
 * batch, design: docs/superpowers/specs/2026-08-07-signal-expansion-batch1-design.md).
 * Corpus-empirical rates (200 matches / 899 sources, one predicate call per
 * signal, zero new tables — see
 * `.superpowers/sdd/2026-08-05-window-multi-finding/signal-rates-report.md`):
 *  - POSITION-001 (position-mistake): 10.9% of rounds with position data have
 *    >=1 mistake, 118 raw STAYED_IN-with-real-cost events (MISSED_PUSH /
 *    CD_OUT_OF_RANGE were 0/0 on this healer-heavy corpus — kept anyway, see
 *    the mapper's doc comment).
 *  - COOLDOWN-001 (cc-held): the report measured both a 60s and a 90s door;
 *    90s was chosen (259 raw windows vs 484) to keep the false-positive rate
 *    down — at 60s, 23% of ALL observed CC availableWindows already clear the
 *    bar, meaning a good chunk are just normal cast-rhythm gaps, not
 *    "sitting on it".
 */
// HEAL-001 (healing-gap) originally gated on `freeCastSeconds >=
// HEAL_GAP_FREE_MIN_S(4)` — "placed at the median" per the original comment.
// A 3,000-match outcome probe (2026-08-30,
// eval-private/reports/signal-outcomes-2026-08-30/report.md, healer-owner
// gaps from detectHealingGaps) showed friendly-death-within-10s FLAT across
// gap length (2-4s 5.3%, 4-6s 5.4%, 6+s 5.7%) but steeply keyed on the lowest
// friendly HP% reached during the gap (<=40% 13.0%, 40-70% 2.8%, >70% 0.8%) —
// gap seconds was the wrong axis. Replaced with an HP-crisis gate: same 40%
// line as crisisDecisionPoints' CRISIS_HP_PCT — imported rather than
// redeclared.
const HEAL_GAP_CRISIS_HP_PCT = CRISIS_HP_PCT * 100;
// at-cap 体检(2026-08-26,782 owner-回合,详见上方 *_CAP 块注释):healing-gap
// 打到上限 3/29 有产出回合(10%)、position-mistake 17/98(17%)、cc-held 7/121
// (6%)—— 三条 cap 基本惰性,截断可忽略。(pre-2026-08-30 gate; re-measure after
// the HP-crisis gate lands.)
const HEALING_GAP_CAP = 2;
const POSITION_MISTAKE_CAP = 2;
// GH #34 batch 4 (2026-08-28), same corpus, 2,328 available windows of the
// owner's CC majors (944/1,127 rounds have one): [0,30) 1,173 · [30,60) 610 ·
// [60,90) 270 · [90,120) 112 · [120,180) 102 · [180,240) 57 · ≥ 240 4 (p50
// 29.8 s, p90 101.8 s). Share that clears the gate: ≥ 60 s 23.4 % · **≥ 90 s
// 11.8 %** · ≥ 120 s 7.0 % — 90 s sits in the decaying tail (≈ one full CC
// cooldown of idle time), an editorial cut. Measured, not official.
const CC_HELD_MIN_S = 90;
const CC_HELD_CAP = 2;

/**
 * DEFENSIVE-001 (cc-avoidable, 2026-08-07, BACKLOG #18 second batch, design:
 * docs/superpowers/specs/2026-08-07-defensive-001-design.md). Corpus-empirical
 * (200 matches / 635 healer-owner rounds, `.defensive-rates-report.md` —
 * **该报告与其复现脚本 `packages/desktop/scripts/tmp-defensive-rates.mts` 现均已不在盘上
 * (2026-08-17 核实),下列数字只以本注释的形式存在,无法复现**;
 * acceptance-rescanned against this real implementation via
 * `packages/desktop/scripts/tmp-defensive-rates.mts` — evaluated then
 * deleted): 16.5% of healer rounds (105/635) qualify at the raw judgment
 * (full-DR CC >=3s + >=1 avoidance tool evidenced+available); 64.3% of the
 * raw hit EVENTS also carry `trinketState === "available_unused"` — already
 * covered by the cc-locked / wasted-trinket candidates — so this type
 * EXCLUDES that overlap (dedupe gate, see ccAvoidableEvents) rather than
 * double-charging the same instant under a second type. Post-exclusion,
 * measured by actually running this function over the corpus (not a
 * back-of-envelope estimate): 96 raw non-overlap events, 78 after the cap
 * (2/round), 59/635 rounds hit (9.3%). Divine Shield alone drives 62% of raw
 * hits and Holy Paladin alone drives 59.2% of raw hit rounds (33.7% after the
 * dedupe gate) — a real, reported skew (see the design doc), not a bug.
 */
// 2026-08-20 接地收紧(GH #16,用户裁定):3 → 4。门前 2083 条有工具 full-DR
// CC 实测,时长 ≤4s 的 10s 内友方死亡率全平(4.2–4.5%),4–6s 跳至 8.0%、
// ≥6s 10.2% —— 膝点在 4 不在 3;旧 3s 门多放的 3–4s 段(259 条,12.4%)
// 行为与背景无异。数字在 issue #16 的三小件接地评论。
const CC_AVOIDABLE_MIN_S = 4;
// at-cap 体检(2026-08-26):8/30 有产出回合打到上限(27%)。
const CC_AVOIDABLE_CAP = 2;

/**
 * OFFENSIVE-002 (burst-into-mitigation, 2026-08-11, BACKLOG #18 second batch):
 * a burst-ledger dominant target had a major (non-immune) mitigation cooldown
 * running that blocked >= BURST_INTO_MITIGATION_MIN_PCT of the damage school,
 * AND analyzeKillWindowTargetSelection reports a softer alternative target was
 * available at the same instant (a synthetic window built from the burst's own
 * span/target — the exact kill-opportunity-tier predicate BurstLedgerCard's
 * "窗口目标纪律" section and off-target-in-window already consume, not a second
 * implementation). MITIGATION_TABLE entries marked `positional: true`
 * (currently only Darkness/196718) are excluded outright: the #17 spec's
 * decision record #4 requires a coordinate judgement before counting them
 * ("判不了就不计入"), and this candidate does not implement position checking —
 * the same choice counterfactual.ts already made for its own three shapes.
 *
 * Corpus-empirical (200 matches / 899 sources, BACKLOG #18 second batch,
 * `packages/desktop/scripts/tmp-off002-rates.mts` — evaluated then deleted):
 * this library is 898/899 healer-recorded, so under the production
 * single-owner convention (resolveOwner) DPS-owner rounds measure 0/0 — a
 * corpus fact, not a signal fact (dpsOwnerEvents only ever runs for a
 * non-healer owner). Measured through the same per-friend loop
 * deriveMistakes.ts (mistakes.ts) actually uses to surface candidates for
 * teammates — every non-healer friendly taken as owner in turn — the
 * underlying signal is real: 1794 DPS-owner-rounds, 263 qualifying windows,
 * 225/1794 rounds (12.5%) hit >=1. No single mitigation spell dominates the
 * raw hits (11 distinct spells observed; the largest, Pain Suppression, is
 * 34.4% of raw hits — not a monoculture).
 */
const BURST_INTO_MITIGATION_MIN_PCT = 30;
/**
 * The cited wall must cover at least this share of the burst span, GH #96.
 * The ledger keeps any defensive that overlaps the burst by >= 0.5 s, so a
 * 20 s Avatar + Recklessness was once accused of going "into" a Barkskin it
 * overlapped for only 0.7 s.
 *
 * USER RULING 2026-09-24 ("用60 2v2不管"): 60 %, read from data rather than
 * guessed. The 09-14 value was a provisional 30 %.
 *
 * Method (eval-private reports/gh96-coverage-threshold-2026-09-24, S2
 * every-30): compare each burst with bursts into no wall at all, and find the
 * coverage where the target's HP drop becomes measurably smaller. Start HP
 * >= 80 %, mean drop with 95 % CI:
 *   - Solo Shuffle: no wall 19.2 [18.5, 20.0]; 30-60 % 21.3 [19.1, 23.6]
 *     (not different from no wall); > 60 % 15.2 [11.5, 18.8].
 *   - 3v3: no wall 18.2; 30-60 % 13.4; > 60 % 6.8.
 *   - Below 30 %: bursts did BETTER than no wall in every bracket (26-35).
 *     These are reactive walls, popped late because the burst hurt.
 * 2v2 shows no cost at any coverage (n = 46 above 60 %); the ruling leaves
 * it alone rather than special-casing it.
 */
const BURST_INTO_MITIGATION_MIN_COVERAGE = 0.6;
// at-cap 体检(2026-08-26):2/20(10%),惰性。
const BURST_INTO_MITIGATION_CAP = 2;

/**
 * DEFENSIVE-003 (`slow-defensive-response`) — the whole predicate moved to
 * `candidates/burstWindowResponse.ts` + `analysis/burstWindowDecisionPoints.ts`
 * on 2026-09-01 (GH #60 phase 2). What used to live here — the
 * `damageRatio >= 1.5` pressure gate, the 8 s owner-reaction door, the
 * `SLOW_DEF_RESPONSE_OVERLAP_TYPES` dedupe ring, `SLOW_DEF_REACTION_IDS` and
 * `firstDefensiveReactionToWindow` — is gone with it: the new type judges a
 * BOUNDED window (the retired one judged the unbounded builder group, corpus
 * p50 21.6 s), asks whether ANY friendly answered (not just the owner), gates
 * on the pressured friendly's own feasibility, and triages on that friendly's
 * HP. `PRE_WALL_SECONDS`' second consumer left with it; the engine's
 * `BURST_RESPONSE_PRE_MS` is the pre-wall grace now.
 */

/** missed-cleanse mapping (pure function, unit-testable with hand-built
 * fixtures): a high-value CC sat on a teammate too long without being
 * cleansed. Only Critical/High qualify; windows where the cleanse ability was
 * on cooldown are not reported (nothing to coach).
 *
 * Owner dispel-capability gate (2026-08-05, 37/200-match audit): the timeline
 * renderer already refuses to print an [UNCLEANSED DEBUFF] line the log owner
 * couldn't have cleansed themselves (matchTimeline.ts B16, same
 * `canDefensiveCleanse` predicate), but this candidate menu had no equivalent
 * check — a Holy Paladin (no Curse removal) or Discipline Priest (no Curse
 * removal either) got handed "you should have dispelled the Curse" candidates
 * that then produced "your Cleanse"/"your Purify" hallucinations for an
 * ability the owner's class does not have. Verdict when
 * `!canDefensiveCleanse(owner, w.dispelType)`:
 *  - solo shuffle (`isShuffle`): drop the window — a 1v1v1 round has no
 *    teammate to hand the debuff off to, so "call for a dispel" has no
 *    addressee and the candidate has zero coaching value.
 *  - team format (2v2/3v3): keep the window, but tag
 *    `facts.ownerCanDispel="no"` and `facts.eligibleDispellers` (the
 *    teammates who CAN, by spec — same list-building pattern as
 *    buildMatchContext's `teamPurgers`) so the model is steered toward a
 *    "call it out" suggestion instead of blaming the owner for an ability
 *    they don't have (guard note in buildFindingsPrompt's CHAIN_LEGENDS).
 */
export function missedCleanseEvents(
  windows: Pick<
    IMissedCleanseWindow,
    | "timeSeconds"
    | "durationSeconds"
    | "targetName"
    | "spellName"
    | "spellId"
    | "priority"
    | "postCcDamage"
    | "cleanseWasOnCD"
    | "dispellersLockedOut"
    | "losReachable"
    | "drChainRisk"
    | "dispelType"
    | "lateDispelSeconds"
    | "targetCharmed"
  >[],
  owner: any,
  friends: any[],
  isShuffle: boolean,
  // #34(b2) 2026-08-23 (user-ruled): when provided, each window gains
  // ownerCasting* facts describing what the owner was hard-casting during it,
  // so the coach can phrase "you chose Y for these N seconds" instead of the
  // false "you idly missed X". Optional so older callers/tests are untouched;
  // absent ⇒ no facts (unknown, not "idle").
  occupancy?: {
    enemyIds: Set<string>;
    matchStartMs: number;
    /** A5: the owner's SPELL_CAST_FAILED (absolute ms) — cuts a cancelled bar. */
    failedCasts?: ReadonlyArray<{ spellId: string; ms: number }>;
  },
): CandidateEvent[] {
  return windows
    .filter(
      (w) =>
        (w.priority === "Critical" || w.priority === "High") &&
        !w.cleanseWasOnCD &&
        // Feasibility gate (2026-08-02): windows where the dispellers were
        // CC'd/locked out with no reaction window, or where position data
        // exists and everyone was out of range / had no line of sight, do not
        // enter the coaching menu — there is nothing to coach. losReachable
        // === null (no position data) never flips the verdict; the tri-state
        // is an iron rule.
        !w.dispellersLockedOut &&
        w.losReachable !== false &&
        // Owner capability gate: solo shuffle has nobody to hand this off to.
        (canRemoveFrom(owner, w.dispelType, w.targetCharmed, w.targetName) ||
          !isShuffle),
    )
    .sort((a, b) => b.postCcDamage - a.postCcDamage)
    .slice(0, MISSED_CLEANSE_CAP)
    .map((w) => {
      const ownerCanDispel = canRemoveFrom(
        owner,
        w.dispelType,
        w.targetCharmed,
        w.targetName,
      );
      const occ = occupancy
        ? hardCastOccupancyWithin(
            owner,
            occupancy.enemyIds,
            occupancy.matchStartMs + w.timeSeconds * 1000,
            occupancy.matchStartMs + (w.timeSeconds + w.durationSeconds) * 1000,
            occupancy.failedCasts,
          )
        : null;
      // Rendering floor anchored to the rendered value itself: attach only
      // when the one-decimal rendering is non-zero. Zero is also what a
      // window full of instants looks like (instants emit no CAST_START), so
      // zero must never be shown — it would read as "was idle".
      const occS = occ ? (occ.occupiedMs / 1000).toFixed(1) : "0.0";
      return {
        id: `missed-cleanse:${w.targetName}:${Math.round(w.timeSeconds)}`,
        type: "missed-cleanse",
        t: w.timeSeconds,
        unitNames: [w.targetName],
        spell: w.spellName,
        spellId: w.spellId,
        facts: {
          // Render-grid fix (2026-08-30, same bug/fix as kick-eaten): matches
          // the [UNCLEANSED DEBUFF] timeline marker (fmtTime-floored) -- 3/58
          // (5.2%) never-cleansed missed-cleanse lines on the 2026-08-30 A/B
          // corpus rounded up past it before this. (Late-cleanse windows,
          // which render no [UNCLEANSED DEBUFF] marker at all by design, are
          // unaffected either way.)
          t: fmtFactTime(w.timeSeconds),
          target: w.targetName,
          cc: w.spellName,
          duration: w.durationSeconds.toFixed(1),
          priority: w.priority,
          postCcDamageK: (w.postCcDamage / 1000).toFixed(0),
          // Value gate d: DR was fully fresh and the target did get re-CC'd
          // afterwards — the coach must phrase this as a cautious suggestion,
          // not as blame for a mistake (the timeline row carries the same
          // annotation, keeping both channels consistent).
          drChainRisk: w.drChainRisk ? "yes" : "no",
          dispelType: w.dispelType,
          // #34(b2): what the owner's hands were doing during the window.
          // preCommitted "yes" = a counted cast started BEFORE the window
          // opened (couldn't have known); "no" = every counted cast started
          // after it (a priority choice — coach it as the choice it was).
          ...(occ && occS !== "0.0"
            ? {
                ownerCastingS: occS,
                ownerCastingSpells: joinSpellCounts(occ.spellNames),
                ownerCastingPreCommitted: occ.startedBeforeWindow
                  ? "yes"
                  : "no",
              }
            : {}),
          // DISPEL-002 (2026-08-06): set only on the lateCleanseWindows slice
          // (a cleanse DID land, just late) — undefined for ordinary "never
          // cleansed" windows, so this key is entirely absent from their
          // facts rather than rendering a misleading "latencyS=0".
          ...(w.lateDispelSeconds !== undefined
            ? { latencyS: String(Math.round(w.lateDispelSeconds)) }
            : {}),
          ...(ownerCanDispel
            ? {}
            : {
                ownerCanDispel: "no",
                // W1a (2026-09-25): a teammate already dead when the CC landed
                // cannot be asked to dispel it (1e37).
                eligibleDispellers:
                  friends
                    .filter(
                      (f) =>
                        f.id !== owner.id &&
                        canRemoveFrom(
                          f,
                          w.dispelType,
                          w.targetCharmed,
                          w.targetName,
                        ) &&
                        (occupancy?.matchStartMs === undefined ||
                          !((f.deathRecords ?? []) as any[]).some(
                            (d) =>
                              d.timestamp <=
                              occupancy.matchStartMs + w.timeSeconds * 1000,
                          )),
                    )
                    .map((f) => specToString(f.spec))
                    .join(", ") || "no one on your team",
              }),
        },
      };
    });
}

/** "精神控制, 精神控制, 快速治疗" → "精神控制×2, 快速治疗" */
function joinSpellCounts(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  // "、", never ", ": a facts block is a ", "-joined k=v list and every
  // text-side parser (the eval gate's `parseFactsBlock`, `interpolateResponses`)
  // splits on ", " — a comma inside a value truncates it (2026-09-16 A/B:
  // `ownerCastingSpells=Mind Control, Mind Blast` rendered as "Mind Control"
  // in both arms). `checkFactsBlockIntegrity` is the gate for this invariant.
  return [...counts].map(([n, c]) => (c > 1 ? `${n}×${c}` : n)).join("、");
}

/** missed-purge mapping (pure function): a high-value enemy buff ran its full
 * duration without being purged. Only Critical/High, or windows falling inside
 * one of our kill windows, are reported; windows where purge was on cooldown
 * are not. */
export function missedPurgeEvents(
  windows: Pick<
    IMissedPurgeWindow,
    | "timeSeconds"
    | "durationSeconds"
    | "enemyName"
    | "spellName"
    | "spellId"
    | "priority"
    | "purgeWasOnCD"
    | "duringKillWindow"
    | "purgersLockedOut"
    | "losReachable"
  >[],
): CandidateEvent[] {
  return windows
    .filter(
      (w) =>
        !w.purgeWasOnCD &&
        // Feasibility gate (same as on the cleanse side): CC'd/locked out, or
        // data exists and nobody could reach → keep it out of the menu
        !w.purgersLockedOut &&
        w.losReachable !== false &&
        (w.priority === "Critical" ||
          w.priority === "High" ||
          w.duringKillWindow === true),
    )
    .sort(
      (a, b) =>
        Number(b.duringKillWindow ?? false) -
          Number(a.duringKillWindow ?? false) ||
        b.durationSeconds - a.durationSeconds,
    )
    .slice(0, MISSED_PURGE_CAP)
    .map((w) => ({
      id: `missed-purge:${w.enemyName}:${Math.round(w.timeSeconds)}`,
      type: "missed-purge",
      t: w.timeSeconds,
      unitNames: [w.enemyName],
      spell: w.spellName,
      spellId: w.spellId,
      facts: {
        t: fmt(w.timeSeconds),
        enemy: w.enemyName,
        buff: w.spellName,
        duration: w.durationSeconds.toFixed(1),
        priority: w.priority,
        inKillWindow: w.duringKillWindow ? "yes" : "no",
      },
    }));
}

/** kick-eaten mapping (pure function): the owner hard-cast into an enemy
 * interrupt (especially coachable for healers: fake-casting).
 *
 * 排序键:2026-08-20 实测 lockoutDurationSeconds 无信息(840 条全部落在
 * 3–4s —— 2026-09-02 GH #62 查明那不是信息缺失而是 kickLockoutSeconds 当时
 * 对每个踢技都回答 3s 回退;2026-09-04 起读官方 DB2 PvP 时长、语料做校验门,
 * 法术反制 5 / 法术封锁 5 / 压制 4 / 风剪 2 / 近战踢 3,但排序键仍不用它),当时挂账「要新的排序谓词,另行立项」—— 2026-08-25 落地为
 * BACKLOG #36(b) 的 `postKick`(被踢后 5s 的行为):idle(整窗零施法,
 * 最该教)排最前,acted(动了但没换学派)次之,switched(换学派打穿
 * 锁定,几乎不用教)最后;同档内按时间。语料锚:切换率跟专精能力上限走
 * (戒律 76–80% vs 神骑 8%),同专精内 idle 率才是可教的那一半。 */

export function kickEatenEvents(
  instances: (Pick<
    ReturnType<typeof analyzePlayerCCAndTrinket>["interruptInstances"][number],
    | "atSeconds"
    | "lockoutDurationSeconds"
    | "kickSpellName"
    | "interruptedSpellName"
    | "sourceName"
    | "postKick"
    | "firstActionDelayS"
    | "switchSpellName"
    | "switchDelayS"
    | "switchWasHardCast"
    | "nearestKickerDistYd"
    | "kickersInRange"
    | "kickDepthPct"
    | "ccInWindowS"
  > &
    Partial<
      Pick<
        ReturnType<
          typeof analyzePlayerCCAndTrinket
        >["interruptInstances"][number],
        "channelS"
      >
    > &
    Partial<
      Pick<
        ReturnType<
          typeof analyzePlayerCCAndTrinket
        >["interruptInstances"][number],
        "interruptedSpellId" | "kickSpellId" | "sourceId"
      >
    >)[],
  owner: { id: string; name: string },
  /** Reliability audit A1 (2026-09-24): the owner's rejected presses. Without
   * them `postKick` is read off SUCCESSFUL casts only, and the line told the
   * model "no cast for 5s" / "waited out the lockout" while the player was
   * pressing — 825ca842 @263 pressed Hammer of Justice 4× inside the 2 s
   * lockout, 7c598eeb r0 @91 pressed Mind Control / Holy Fire 7× (line of
   * sight, then disoriented). Absent / `available:false` = today's behaviour
   * (old archives have no raw stream). */
  intent?: {
    rawStreams?: RawStreams;
    /** The owner's successful casts, seconds from match start — feeds the
     * shared `filterIntentGuardEvidence` exactly as cd-hoarded feeds it. */
    ownerCasts: { spellId: string; tSeconds: number }[];
  },
  /** Reliability audit D4(d) (2026-09-25): the interrupted spell's reach
   * for the owner and the kick's cast range for the kicker (official DB2
   * ranges with talents, `spellReachForCaster` / `spellRangeForCaster`).
   * The legend may coach "cast from outside kick range" only when the first
   * exceeds the second; null when either is unknown. */
  reach?: (k: (typeof instances)[number]) => {
    yourReachYd: number;
    kickRangeYd: number;
  } | null,
  /** GH #113 (2026-09-25): both sides' pressure during the lockout
   * (`kickPressure.ts`). A kick with both sides calm and no burst of ours
   * ready is not listed; every listed kick carries the facts. Absent = no
   * filter and no facts (hand-built fixtures). */
  pressure?: (k: (typeof instances)[number]) => KickPressure,
  /** The owner's own cancelled hardcasts and the enemy kicks they baited
   * (`castCancels.ts`) — the "you already fake-cast" contrast. null when the
   * owner is not the player who recorded the log (no SPELL_CAST_FAILED). */
  cancels?: OwnerCastCancels | null,
): CandidateEvent[] {
  const withPresses = instances
    .map((k) => ({
      k,
      rejected: rejectedPressesAfterKick(k, owner.id, intent),
      p: pressure?.(k),
    }))
    .filter(({ p }) => !p || !kickIsHarmless(p));
  return withPresses
    .sort(
      (a, b) =>
        // Shared rank (ccTrinketAnalysis.ts) — never a second severity table
        // here: the cap decides which kicks the model ever sees, so the
        // ordering and the field it reads must not be able to drift apart.
        postKickSeverityRank(a.k, a.rejected.length) -
          postKickSeverityRank(b.k, b.rejected.length) ||
        a.k.atSeconds - b.k.atSeconds,
    )
    .slice(0, KICK_EATEN_CAP)
    .map(({ k, rejected, p }) => ({
      id: `kick-eaten:${owner.id}:${Math.round(k.atSeconds)}`,
      type: "kick-eaten",
      t: k.atSeconds,
      unitNames: [owner.name, k.sourceName],
      spell: k.interruptedSpellName,
      facts: {
        // Render-grid fix (2026-08-30, CLAUDE.md Shared-Predicate Rule): the
        // matching [KICK] timeline line renders via fmtTime (floors to the
        // whole second); fmtFactNum's toFixed(1) rounds instead, so an
        // x.95-x.99 atSeconds rendered "t=(x+1).0s" while [KICK] still showed
        // the second still in progress -- 20/209 kick-eaten lines (9.6%) on
        // the 2026-08-30 A/B corpus. fmtFactTime truncates instead, keeping
        // this fact on the same whole-second grid as the timeline marker.
        t: fmtFactTime(k.atSeconds),
        interrupted: k.interruptedSpellName,
        kick: k.kickSpellName,
        source: k.sourceName,
        lockout: k.lockoutDurationSeconds.toFixed(1),
        // Reliability audit D4(c) (2026-09-25): WHICH school the kick locked
        // (the interrupted spell's official school — the same
        // `spellSchoolMask` the switched/acted classification tests). Without
        // it the model wrote "a kick locks only that school; instants are not
        // locked" (e9ea8a0c @363) — every spell of the school is locked,
        // instants included. Absent when the official mask is unknown.
        //
        // A multi-school name alone ("Chaos") read as one school: the model
        // told a Destruction Warlock that Fire stays open after a Chaos Bolt
        // kick (2026-09-26 fake-cast check, 114 twice) — Chaos contains
        // Fire. A multi-school lock now lists its schools.
        ...((): Record<string, string> => {
          const mask = k.interruptedSpellId
            ? spellSchoolMask(k.interruptedSpellId)
            : undefined;
          const school = getSpellSchoolName(mask);
          if (!school || mask === undefined) return {};
          const parts = [1, 2, 4, 8, 16, 32, 64]
            .filter((b) => (mask & b) === b)
            .map((b) => getSpellSchoolName(b))
            .filter((n): n is string => n !== null);
          return {
            lockedSchool:
              parts.length > 1 ? `${school} (${parts.join(" + ")})` : school,
          };
        })(),
        ...((): Record<string, string> => {
          const r = reach?.(k);
          return r
            ? {
                yourReachYd: String(Math.round(r.yourReachYd)),
                kickRangeYd: String(Math.round(r.kickRangeYd)),
              }
            : {};
        })(),
        ...(k.nearestKickerDistYd != null
          ? { nearestKickerDistYd: k.nearestKickerDistYd.toFixed(1) }
          : {}),
        ...(k.kickersInRange != null
          ? { kickersInRange: String(k.kickersInRange) }
          : {}),
        ...(k.kickDepthPct != null
          ? { kickDepthPct: String(k.kickDepthPct) }
          : {}),
        // W1k: the kick hit the channel after the spell had gone out
        ...(k.channelS != null
          ? { phase: "channel", channelS: k.channelS.toFixed(1) }
          : {}),
        // A3 (2026-09-25): seconds of the window the player could not act
        // for another reason (CC, silence, another kick). Only when the
        // one-decimal rendering is non-zero — zero is "no evidence of CC",
        // never shown as a fact.
        ...(k.ccInWindowS != null && k.ccInWindowS >= 0.1
          ? { ccInWindowS: k.ccInWindowS.toFixed(1) }
          : {}),
        // BACKLOG #36(b): the behavior fact the model can actually coach on.
        // 2026-09-06: the `switched` wording used to assert "kept playing
        // through the lockout (other school, first cast Xs later)". Two
        // things were wrong with that sentence and BOTH are fixed here —
        // the CLASSIFICATION is untouched, only what the line may claim.
        //
        //  (a) It welded two different casts together. The delay came from
        //      `firstActionDelayS` (the first cast of any kind) while the
        //      "other school" claim came from the first DISJOINT-school cast,
        //      which can be a later, different spell (match 825ca842: first
        //      cast 0.5s, the disjoint one — Will to Survive — 2.0s). The
        //      line now cites the switching cast's own delay.
        //  (b) "kept playing" over-claimed. `switched` only requires a
        //      disjoint school mask, not a hardcast: 276/292 corpus switches
        //      were instants — Cat Form, Hover, Will to Survive, the PvP
        //      trinket — and read to the model as "the lockout cost nothing"
        //      (packages/eval/scripts/postKickSwitchAudit.ts). Naming the
        //      spell lets the model tell "Cat Form + Wild Charge" (a
        //      disengage) from "Flash Heal" (really kept casting); the old
        //      text rendered those two identically.
        //
        // `switchWasHardCast` is three-state: null (no cast-start data, or
        // an old archive) prints no qualifier at all rather than guessing,
        // and `false` says "not a hard cast" because parser-compat exposes
        // no channel events — a channel cannot be told from an instant here,
        // so the line must not claim it is one. (It said "instant or
        // channel" until 2026-09-25: next to "another school" that read as
        // "instants escape the lockout" — reliability audit D4(c).) The qualifier
        // is joined with "; " not ", ": a ", " inside a facts value is cut off
        // by every text-side facts parser (`checkFactsBlockIntegrity`).
        postKick: postKickFact(k, rejected),
        ...(p ? kickPressureFacts(p) : {}),
        ...(cancels ? castCancelFacts(cancels, k.sourceName) : {}),
      },
    }));
}

/** The round's cancel / bait contrast on a kick-eaten line: how many of the
 * owner's hardcasts they cancelled themselves (and how far in, median), how
 * many enemy kicks those cancels baited, and which of them were this line's
 * kicker's (seconds, " + "-joined). */
function castCancelFacts(
  c: OwnerCastCancels,
  kicker: string,
): Record<string, string> {
  const pcts = c.cancels
    .map((x) => x.progressPct)
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  const mine = c.baitedKicks.filter((b) => b.kickerName === kicker);
  return {
    yourCancels: String(c.cancels.length),
    ...(pcts.length
      ? { yourCancelMedianPct: String(pcts[Math.floor(pcts.length / 2)]) }
      : {}),
    baitedKicks: String(c.baitedKicks.length),
    ...(mine.length
      ? { baitedThisKickerT: mine.map((b) => fmtFactTime(b.atSeconds)).join(" + ") }
      : {}),
  };
}

/** GH #113: the pressure facts of one kick. Values never contain ", "
 * (`checkFactsBlockIntegrity`); lists are joined with " + ". */
function kickPressureFacts(p: KickPressure): Record<string, string> {
  const f: Record<string, string> = {};
  const sideFacts = (prefix: string, s: KickSidePressure, burstKey: string) => {
    if (s.low) {
      f[`${prefix}LowUnit`] = s.low.unit;
      f[`${prefix}LowPct`] = String(s.low.pct);
      f[`${prefix}LowT`] = String(s.low.atSec);
    }
    if (s.death) {
      f[`${prefix}DeathUnit`] = s.death.unit;
      f[`${prefix}DeathT`] = fmtFactTime(s.death.atSec);
    }
    if (s.burstAgainst.length) f[burstKey] = s.burstAgainst.join(" + ");
  };
  sideFacts("our", p.ours, "enemyBurst");
  sideFacts("their", p.theirs, "ourBurst");
  if (p.burstReady.length) f.burstReady = p.burstReady.join(" + ");
  return f;
}

/** The owner's rejected presses in `[kick, kick + POST_KICK_WINDOW_S]`,
 * filtered per spell through the SAME `filterIntentGuardEvidence` cd-hoarded
 * uses (predicate index: "Which SPELL_CAST_FAILED hits count as genuine
 * pressed-but-rejected evidence") — so a GCD-spam 尚未恢复 or a press that
 * self-resolved into a same-spell cast within 2 s never counts here either. */
function rejectedPressesAfterKick(
  k: { atSeconds: number },
  ownerId: string,
  intent:
    | {
        rawStreams?: RawStreams;
        ownerCasts: { spellId: string; tSeconds: number }[];
      }
    | undefined,
): CastFailedEvent[] {
  if (!intent?.rawStreams) return [];
  // Strictly AFTER the kick, like the postKick classifier (`c.t >
  // inst.atSeconds`): the interrupted cast itself logs a same-millisecond
  // SPELL_CAST_FAILED "interrupted" (7c598eeb r0 @91.13, 1262763) — that is
  // the kick, not a press made after it.
  const hits = castFailedInWindow(
    intent.rawStreams,
    ownerId,
    k.atSeconds,
    k.atSeconds + POST_KICK_WINDOW_S,
  ).filter((h) => h.tSeconds > k.atSeconds);
  const ownCastSuccessSeconds = intent.ownerCasts.map((c) => c.tSeconds);
  const bySpell = new Map<number, CastFailedEvent[]>();
  for (const h of hits) {
    const list = bySpell.get(h.spellId) ?? [];
    list.push(h);
    bySpell.set(h.spellId, list);
  }
  return [...bySpell].flatMap(([spellId, list]) =>
    filterIntentGuardEvidence(
      list,
      intent.ownerCasts
        .filter((c) => c.spellId === String(spellId))
        .map((c) => c.tSeconds),
      { ownCastSuccessSeconds },
    ),
  );
}

/** What the kick-eaten line may say about the player after the kick.
 *
 * The CLASSIFICATION (`postKick`, `ccTrinketAnalysis.ts`) is untouched; this
 * only decides what the line may CLAIM, given the rejected presses:
 *  - idle + rejected presses → "no successful cast", never "no cast": the
 *    player was pressing (7c598eeb r0 @91).
 *  - acted → "waited out the lockout" only when the first successful cast
 *    came at or after the lockout end AND nothing was pressed inside the
 *    lockout. The old line said it unconditionally, which both contradicted
 *    the log (825ca842 @263, HoJ ×4 rejected inside the lockout) and itself
 *    ("waited out the lockout (first cast 1.3s later)" with a 2.0 s lockout,
 *    e9ea8a0c @363 — a first cast that early is an unknown- or multi-school
 *    spell, not a wait). The gate `checkKickWaitedOutConsistency` pins the
 *    second half on the rendered text.
 * Spell names are English (`getEnglishSpellName`) and joined by
 * `joinSpellCounts`, never with ", " (`checkFactsBlockIntegrity`); the
 * localized reject reasons stay out of the line (`checkCjkLeak`). */
function postKickFact(
  k: Pick<
    ReturnType<typeof analyzePlayerCCAndTrinket>["interruptInstances"][number],
    | "atSeconds"
    | "lockoutDurationSeconds"
    | "postKick"
    | "firstActionDelayS"
    | "switchSpellName"
    | "switchDelayS"
    | "switchWasHardCast"
  >,
  rejected: CastFailedEvent[],
): string {
  const pressed = (list: CastFailedEvent[]) =>
    `pressed ${list.length}x but rejected (${joinSpellCounts(
      list.map((h) => getEnglishSpellName(String(h.spellId), h.spellName)),
    )})`;
  if (k.postKick === "idle")
    return rejected.length > 0
      ? `no successful cast for 5s after the kick; ${pressed(rejected)}`
      : "no cast for 5s after the kick";
  if (k.postKick === "switched")
    return `acted on another school ${k.switchDelayS?.toFixed(1) ?? "?"}s later (${k.switchSpellName ?? "?"}${
      k.switchWasHardCast === true
        ? "; hard cast"
        : k.switchWasHardCast === false
          ? "; not a hard cast"
          : ""
    })`;
  // Strict `<`: the lockout's end instant belongs to "after", the same
  // boundary the "waited out" test below uses for successful casts (a first
  // cast at exactly the lockout end IS a wait) — codex astra review 2026-09-24.
  const inLockout = rejected.filter(
    (h) => h.tSeconds < k.atSeconds + k.lockoutDurationSeconds,
  );
  const first = k.firstActionDelayS?.toFixed(1) ?? "?";
  if (inLockout.length > 0)
    return `${pressed(inLockout)} inside the lockout; first successful cast ${first}s later`;
  if (
    k.firstActionDelayS != null &&
    k.firstActionDelayS < k.lockoutDurationSeconds
  )
    return `first cast ${first}s later`;
  return `waited out the lockout (first cast ${first}s later)`;
}

/**
 * healing-gap mapping (HEAL-001, pure function): the healer owner produced no
 * heal/cast for a stretch while a teammate was under real pressure
 * (detectHealingGaps' own three gates — see healingGaps.ts). This mapper
 * adds one more door on top: `lowestFriendlyHpPct <= HEAL_GAP_CRISIS_HP_PCT`
 * (a teammate actually dropped into crisis HP during the gap, not just "the
 * gap ran long") and `mostDamagedAmount > 0` (a pressured teammate actually
 * took damage, not just "someone was theoretically in range"). Gate keyed on
 * the lowest HP reached, not gap length — see the const block above for the
 * 2026-08-30 outcome-probe citation that drove this change. Sorted by lowest
 * HP ascending (most severe first), capped at HEALING_GAP_CAP.
 */
export function healingGapEvents(
  gaps: Pick<
    IHealingGap,
    | "fromSeconds"
    | "toSeconds"
    | "durationSeconds"
    | "freeCastSeconds"
    | "mostDamagedName"
    | "mostDamagedSpec"
    | "mostDamagedAmount"
    | "lowestFriendlyHpPct"
  >[],
  owner: { id: string; name: string },
): CandidateEvent[] {
  type Gap = (typeof gaps)[number];
  return gaps
    .filter(
      (g): g is Gap & { lowestFriendlyHpPct: number } =>
        g.lowestFriendlyHpPct !== null &&
        g.lowestFriendlyHpPct <= HEAL_GAP_CRISIS_HP_PCT &&
        g.mostDamagedAmount > 0,
    )
    .sort((a, b) => a.lowestFriendlyHpPct - b.lowestFriendlyHpPct)
    .slice(0, HEALING_GAP_CAP)
    .map((g) => {
      const t = toRenderSecond(g.fromSeconds);
      return {
        id: `healing-gap:${owner.id}:${t}`,
        type: "healing-gap",
        t,
        unitNames: [owner.name, g.mostDamagedName],
        facts: {
          t: String(t),
          durationS: String(Math.round(g.durationSeconds)),
          freeS: String(Math.round(g.freeCastSeconds)),
          pressured: g.mostDamagedName,
          pressuredSpec: g.mostDamagedSpec,
          lowestAllyHp: String(Math.round(g.lowestFriendlyHpPct)),
        },
      };
    });
}

/**
 * position-mistake mapping (POSITION-001, pure function): the owner's own
 * STAYED_IN / MISSED_PUSH / CD_OUT_OF_RANGE events from
 * `computeOwnerPositionEvents` — the same `POSITION_MISTAKES` allowlist and
 * `stayedInHadRealCost` gate deepDive.ts's teachable-signal filter uses
 * (single-source predicate; see predicate-index.md). Three-state discipline:
 * `computeOwnerPositionEvents` itself returns `[]` when the owner has no
 * advanced-logging position data, and this mapper adds nothing on top of
 * that — an empty `events` array here means "no position data" or "no
 * mistakes found", never a fabricated zero.
 *
 * MISSED_PUSH / CD_OUT_OF_RANGE measured 0/0 on this (healer-heavy) corpus —
 * kept in the allowlist rather than special-cased out, both because they are
 * forward-looking for non-healer owners (e.g. `fetch-pvp-logs` DPS corpora)
 * and because dropping them would be a second, redundant copy of
 * `POSITION_MISTAKES` (the CLAUDE.md predicate-index rule: consume the Set,
 * don't re-derive a narrower one).
 */
export function positionMistakeEvents(
  events: Pick<
    IPositionEvent,
    | "type"
    | "atSeconds"
    | "nearestEnemyName"
    | "ownerHpStartPct"
    | "ownerHpMinPct"
    | "spellName"
    | "startDistanceYards"
  >[],
  owner: { id: string; name: string },
): CandidateEvent[] {
  return events
    .filter((e) => POSITION_MISTAKES.has(e.type))
    .filter(
      (e) =>
        e.type !== "STAYED_IN" ||
        stayedInHadRealCost(e.ownerHpMinPct ?? null, e.ownerHpStartPct ?? null),
    )
    .sort((a, b) => (a.ownerHpMinPct ?? 101) - (b.ownerHpMinPct ?? 101))
    .slice(0, POSITION_MISTAKE_CAP)
    .map((e) => {
      const t = toRenderSecond(e.atSeconds);
      const kind =
        e.type === "STAYED_IN"
          ? "stayed-in"
          : e.type === "MISSED_PUSH"
            ? "missed-push"
            : "cd-out-of-range";
      const facts: Record<string, string> = { t: String(t), kind };
      if (e.nearestEnemyName) facts.enemy = e.nearestEnemyName;
      if (e.ownerHpStartPct != null)
        facts.hpStart = String(Math.round(e.ownerHpStartPct));
      if (e.ownerHpMinPct != null)
        facts.hpMin = String(Math.round(e.ownerHpMinPct));
      if (e.spellName) facts.spell = e.spellName;
      if (e.startDistanceYards != null)
        facts.dist = String(Math.round(e.startDistanceYards));
      return {
        id: `position-mistake:${owner.id}:${t}:${kind}`,
        type: "position-mistake",
        t,
        unitNames: [
          owner.name,
          ...(e.nearestEnemyName ? [e.nearestEnemyName] : []),
        ],
        ...(e.spellName ? { spell: e.spellName } : {}),
        facts,
      };
    });
}

/**
 * cc-held mapping (COOLDOWN-001, pure function): the owner's own CC major
 * cooldown (`ccSpellIds` — the same set `matchTimeline.ts` uses to label
 * `[YOU] [CC]`) sat available for `>= CC_HELD_MIN_S` continuously
 * (`IMajorCooldownInfo.availableWindows`, the identical predicate `cd-waste`
 * consumes for defensives). Three-state: an owner with no CC major in their
 * tracked kit (`cds` has no id in `ccSpellIds`) naturally produces zero
 * candidates, not a fabricated "held nothing".
 */
export function ccHeldEvents(
  cds: Pick<IMajorCooldownInfo, "spellId" | "spellName" | "availableWindows">[],
  owner: { id: string; name: string },
): CandidateEvent[] {
  const candidates: Array<{
    spellId: string;
    spellName: string;
    window: IAvailableWindow;
  }> = [];
  for (const cd of cds) {
    if (!ccSpellIds.has(cd.spellId)) continue;
    for (const w of cd.availableWindows) {
      if (w.durationSeconds >= CC_HELD_MIN_S) {
        candidates.push({
          spellId: cd.spellId,
          spellName: cd.spellName,
          window: w,
        });
      }
    }
  }
  return candidates
    .sort((a, b) => b.window.durationSeconds - a.window.durationSeconds)
    .slice(0, CC_HELD_CAP)
    .map(({ spellId, spellName, window }) => {
      const t = toRenderSecond(window.fromSeconds);
      const windowEndT = toRenderSecond(window.toSeconds);
      return {
        id: `cc-held:${owner.id}:${spellId}:${t}`,
        type: "cc-held",
        t,
        unitNames: [owner.name],
        spell: spellName,
        spellId,
        facts: {
          t: String(t),
          spell: spellName,
          heldS: String(Math.round(window.durationSeconds)),
          windowEndT: String(windowEndT),
        },
      };
    });
}

/**
 * cc-avoidable wiring helper (DEFENSIVE-001): for one full-DR CC instance the
 * owner ate, return the display names of avoidance tools that were BOTH
 * (a) in the owner's kit — cast at least once anywhere in the match (the
 * "the class doesn't even have this spell" guard the 2026-08-01 "candidate
 * gate bypass" incident taught: a spec without an ability must never be
 * blamed for not pressing it) — and (b) off cooldown at the moment the CC
 * landed. Availability reuses `cdAvailableAt`, the single-source predicate
 * cd-waste / cc-held / death-unused-defensive already consume — this
 * function only adapts an ad hoc spell's raw cast history into the
 * `{casts, cooldownSeconds, neverUsed}` shape `cdAvailableAt` expects,
 * exactly like `extractMajorCooldowns` would for a spell it tracks. A cast
 * that happens AFTER the CC still counts as kit evidence (proves the spec
 * had the button) while leaving the pre-CC availability check untouched —
 * `cdAvailableAt` itself only looks at casts at-or-before `cc.atSeconds`.
 * Iteration order of `applicableCCAvoidanceIds` (insertion order of the two
 * underlying Maps) makes the returned list deterministic.
 */
export function ccAvoidanceOptionsAt(
  owner: {
    spec?: string;
    info?: { talents?: unknown; pvpTalents?: string[] };
    spellCastEvents: Array<{
      spellId?: string;
      logLine: { event: string; timestamp: number };
    }>;
  },
  cc: { atSeconds: number; spellId: string; spellName: string },
  matchStartMs: number,
  /** Reliability audit A4 (2026-09-24): could the owner have reacted with a
   * tool whose press ids are these (the tool itself, or a proc tool's
   * triggers)? Wired to `ownerCouldReactWith` in production; absent = no
   * reaction gate (hand-built fixtures, the pre-A4 behaviour). */
  couldReactWith?: (pressIds: string[]) => boolean,
): string[] {
  // Talent-aware cooldowns (2026-08-18, user ruling 「这些数值要做成活的,根据
  // 玩家的天赋适应」). This used to read the RAW base cooldown out of
  // `spellEffectData`, while `extractMajorCooldowns` — the only other place
  // answering "is this ability off cooldown at t" — ran the same number
  // through `applyCdTalentModifiers` first. One fact, two answers: a Monk who
  // took Celerity has Roll at 3 charges / 15s, not the table's 2 / 20s, and
  // this function would still judge availability on the base numbers. Both
  // now go through the same predicate, and it adapts per player — a modifier
  // applies only when THAT player actually took THAT talent (regular, hero or
  // PvP). `spec` absent (hand-built test fixtures) degrades to base values,
  // exactly the old behaviour.
  const talentSets =
    owner.spec !== undefined
      ? playerTalentIdSets(
          owner as unknown as Parameters<typeof playerTalentIdSets>[0],
        )
      : undefined;
  const talentedSpellIds = talentSets?.talentedSpellIds ?? null;
  const pvpTalentIds = talentSets?.pvpTalentIds ?? new Set<string>();
  const triggers = getTalentAvoidanceTriggers();
  const out: string[] = [];
  for (const id of applicableCCAvoidanceIds(cc.spellId, cc.spellName)) {
    // Proc-style immunities (Nullifying Shroud ← Verdant Embrace, Phase Shift
    // ← Fade, Psychic Shroud ← Psychic Scream, Peaceweaver ← Revival/Restoral)
    // have no cast events of their own, so BOTH the kit-evidence gate and the
    // availability check must run against the trigger ability. Everything else
    // resolves to itself.
    //
    // TALENT GATE — non-negotiable for the proc entries. `TALENT_BEHAVIORS`
    // calls these buffs "self-gating: the aura only exists when the talent is
    // taken", and that WAS true while the check keyed on the buff's own casts
    // (no talent → no buff → no casts → never credited). Resolving to the
    // trigger destroys that property, because the triggers are BASELINE
    // abilities every such spec owns — every priest casts Fade and Psychic
    // Scream whether or not they took Phase Shift / Psychic Shroud. Measured
    // on n=300 before this gate existed: of the proc tools cited by
    // cc-avoidable, 303 citations belonged to players who had NOT taken the
    // talent (Psychic Shroud alone: 287 of 361 = 79.5%). Requires CONFIRMED
    // presence in `pvpTalents` — absent COMBATANT_INFO reads as "cannot
    // confirm" and withholds the tool, since crediting a tool the player may
    // not own turns straight into an accusation.
    const proc = triggers.get(id);
    if (proc && !pvpTalentIds.has(proc.talentSpellId)) continue;
    // cost_norm (user ruling 2026-08-14, curatedAbilityFacts 642 / 45438):
    // Divine Shield / Ice Block are "never a routine CC answer, only a last
    // resort under lethal threat" — and "you could have avoided this Hex
    // with it" is exactly the routine-answer advice the ruling forbids
    // (825ca842: the model told a Holy Paladin to bubble two Hexes). A tool
    // on the sign-off book is never offered here; with no other tool left
    // there is no accusation (reliability audit A4).
    if (costNormPhrase(id) !== null) continue;
    const resolvedIds = proc?.triggerSpellIds ?? [id];
    if (couldReactWith && !couldReactWith(resolvedIds)) continue;
    // Kit evidence, talent-aware cooldown, charges and the reaction window all
    // live in the shared `kitSpellReadyAt` (GH #77 made it a second consumer).
    const available = resolvedIds.some((rid) =>
      kitSpellReadyAt(
        owner,
        rid,
        cc.atSeconds,
        matchStartMs,
        talentSets ?? { talentedSpellIds, pvpTalentIds },
      ),
    );
    if (!available) continue;
    out.push(
      CC_AVOIDANCE_BUFF_SPELLS.get(id) ?? REPOSITIONING_SPELL_IDS.get(id) ?? id,
    );
  }
  return out;
}

/**
 * cc-avoidable mapping (DEFENSIVE-001, pure function, probe injected): the
 * owner (a healer — gated by the caller, see teamPlayEvents) ate a hard CC at
 * Full DR lasting >= CC_AVOIDABLE_MIN_S seconds, and at least one avoidance
 * tool (`avoidableWithAt`, wired to `ccAvoidanceOptionsAt` in production) was
 * evidenced-and-available before it landed.
 *
 * Dedupe gate (2026-08-07 empirical, `.defensive-rates-report.md` —— 原始报告已不在盘上,
 * 见上方 DEFENSIVE-001 块的说明): 64.3% of
 * the raw hit events also had `trinketState === "available_unused"` — a fact
 * that was then coached by cc-locked / wasted-trinket, so firing here too
 * would double-charge one instant and silently evade the per-round candidate
 * caps (BACKLOG #22's whole point).
 *
 * 2026-08-19 复测(GH #14 B 组,n=300/1178,替代上面那份不可复现的 64.3% 作为
 * 本门的现行依据):本类型机会归一化后方向正确 —— 触发 胜 29.3% vs 负 38.9%
 * (+9.6pp),转化率(真用了规避 ÷ 有工具的总机会)胜 43.9% vs 负 36.2%
 * (+7.7pp);#29 天赋自适应扩容(271→625)后构成以天赋 proc 工具为主
 * (Phase Shift 46%),天赋门有效。数字在 issue #14 关账评论。
 *
 * 2026-08-19 (GH #14): cc-locked has since been retired, so "left to cc-locked"
 * no longer applies — but the gate DELIBERATELY stays. The retirement scan
 * showed the "trinket in hand, sat through it" framing has REVERSE win/loss
 * conversion (winners hold the trinket more), so routing those instances into
 * cc-avoidable would re-open the exact accusation the data killed. The gate's
 * meaning is now "the available_unused story is unvalidated as a mistake",
 * not "another type covers it"; cc-avoidable still only fires on the
 * excuse-free "you had a DIFFERENT, non-trinket tool ready" story.
 */
/** Window before a CC application in which its cast must have started to
 * count as "you saw it coming". Covers the longest PvP CC cast (Polymorph /
 * Hex / Cyclone are all ≤ 2s after haste) plus travel/latency slack. */
export const CC_HARD_CAST_LOOKBACK_S = 4;

/** Did any enemy (or enemy pet) visibly begin casting this CC before it landed?
 * Evidence-only: a log without the cast start yields false, so the caller
 * declines to accuse rather than assuming. */
export function wasCcHardCastAt(
  enemies: ICombatUnit[],
  enemyPets: ICombatUnit[],
  cc: { atSeconds: number; spellId: string },
  matchStartMs: number,
): boolean {
  return ccCastStartSeconds(enemies, enemyPets, cc, matchStartMs) !== null;
}

/** When the visible cast bar of this CC began (seconds from match start):
 * the LATEST enemy / enemy-pet SPELL_CAST_START of the same spell within
 * `CC_HARD_CAST_LOOKBACK_S` before it landed, or null. The one cast-start
 * lookup both `wasCcHardCastAt` and the A4 reaction gate read.
 *
 * The start must precede the cast that LANDED (the latest same-spell
 * SPELL_CAST_SUCCESS at or before the landing), not the landing itself: a
 * chain-caster starts the NEXT Cyclone between the success and the aura —
 * 823c3f89 r4 @178, success 35.468, next start 35.469, aura 35.477 — and
 * taking that start measured a 0 s cast bar out of a 1.15 s one, so the A4
 * reaction gate declared the owner unable to react. */
export function ccCastStartSeconds(
  enemies: ICombatUnit[],
  enemyPets: ICombatUnit[],
  cc: { atSeconds: number; spellId: string },
  matchStartMs: number,
): number | null {
  const atMs = matchStartMs + cc.atSeconds * 1000;
  const lookbackMs = CC_HARD_CAST_LOOKBACK_S * 1000;
  const casters = [...enemies, ...enemyPets];
  let landedCastMs: number | null = null;
  for (const u of casters) {
    for (const e of u.spellCastEvents ?? []) {
      if (e.logLine?.event !== "SPELL_CAST_SUCCESS") continue;
      if (String(e.spellId) !== String(cc.spellId)) continue;
      const dt = atMs - e.timestamp;
      if (dt >= 0 && dt <= lookbackMs)
        landedCastMs = Math.max(landedCastMs ?? -Infinity, e.timestamp);
    }
  }
  let latest: number | null = null;
  for (const u of casters) {
    for (const start of u.castStartEvents ?? []) {
      if (String(start.spellId) !== String(cc.spellId)) continue;
      const dt = atMs - start.timestamp;
      if (dt < 0 || dt > lookbackMs) continue;
      if (landedCastMs !== null && start.timestamp >= landedCastMs) continue;
      latest = Math.max(latest ?? -Infinity, start.timestamp);
    }
  }
  return latest === null ? null : (latest - matchStartMs) / 1000;
}

/**
 * Could the owner have REACTED to a visible CC cast bar with a tool
 * (reliability audit A4, user ruling 2026-09-24 「需要满足」 on top of the
 * 2026-09-23 reaction-window ruling)?
 *
 * The reaction window is `[castStart + REACTION_WINDOW_S, land)` — a second
 * to see the bar and decide. Empty → no one could have reacted. For a tool on
 * the global cooldown (not in the DB2 `OFF_GCD_SPELL_IDS`) the owner must
 * also have been off the GCD at some instant of that window: an own on-GCD
 * cast at s locks `[s, s + INTENT_GUARD_GCD_S)`. 825ca842 @244: the owner
 * pressed Judgment 0.16 s into the Hex bar and was GCD-locked for all of it.
 * The GCD is taken at its 1.5 s ceiling (haste shortens it), and proc casts
 * the log attributes to the owner also count as GCD — both err toward FEWER
 * accusations, never more.
 */
export function ownerCouldReactWith(
  ownerOnGcdCastSeconds: readonly number[],
  castStartS: number,
  landS: number,
  toolOnGcd: boolean,
  /** Reliability round 2 W1a (2026-09-25): the owner's cannot-cast intervals
   * (`buildCannotCastIntervals`, in seconds since round start). An instant
   * inside one is no chance to react unless the tool is usable under CC
   * (`toolUsableWhileCc`). 9c9d @80: the whole Hex bar sat inside a Maim stun
   * and the owner was still told Fade / Phase Shift would have avoided it.
   * Absent ⇒ the pre-W1a behaviour (GCD only). */
  blockedS?: ReadonlyArray<{ from: number; to: number }>,
  toolUsableWhileCc = false,
): boolean {
  const from = castStartS + REACTION_WINDOW_S;
  if (from >= landS) return false;
  const gcdLocked = (tau: number) =>
    toolOnGcd &&
    ownerOnGcdCastSeconds.some((s) => s <= tau && tau < s + INTENT_GUARD_GCD_S);
  const ccLocked = (tau: number) =>
    !toolUsableWhileCc &&
    (blockedS ?? []).some((b) => b.from <= tau && tau < b.to);
  const probes = [
    from,
    ...ownerOnGcdCastSeconds.map((s) => s + INTENT_GUARD_GCD_S),
    ...(blockedS ?? []).map((b) => b.to),
  ].filter((t) => t >= from && t < landS);
  return probes.some((tau) => !gcdLocked(tau) && !ccLocked(tau));
}

export function ccAvoidableEvents(
  instances: Pick<
    ICCInstance,
    | "atSeconds"
    | "durationSeconds"
    | "spellName"
    | "spellId"
    | "trinketState"
    | "drInfo"
  >[],
  owner: { id: string; name: string },
  avoidableWithAt: (cc: {
    atSeconds: number;
    spellId: string;
    spellName: string;
  }) => string[],
  /** Did the enemy visibly START a cast of this CC before it landed? The
   * accusation is "you could have REACTED", so an instant leaves nothing to
   * react to. Absent evidence → no accusation (see the reactability note). */
  wasHardCastAt: (cc: { atSeconds: number; spellId: string }) => boolean,
): CandidateEvent[] {
  const candidates: Array<{
    cc: (typeof instances)[number];
    avoid: string[];
  }> = [];
  for (const cc of instances) {
    if (cc.durationSeconds < CC_AVOIDABLE_MIN_S) continue;
    if (cc.drInfo?.level !== "Full") continue;
    if (cc.trinketState === "available_unused") continue;
    // Reactability gate (2026-08-22, corpus adjudication): the prompt tells the
    // model to coach "reacting with one of these tools next time", and you
    // cannot react to an instant. Measured over ~390 sampled instances of the
    // 12.1 archive, ~75% of what this type accused were instants (Hammer of
    // Justice, Freezing Trap, Psychic Scream, Kidney Shot…), and the share was
    // FLAT across rating (26/30/23/28% hard-cast from 2400+ down to <1600) —
    // so this was not a high-rating artifact but a standing demand for
    // precognition. Firing only on a seen cast bar keeps the subset where
    // "react next time" is literally true; no cast-start evidence in the log
    // means no accusation, never an assumed one.
    if (!wasHardCastAt(cc)) continue;
    const avoid = avoidableWithAt(cc);
    if (avoid.length === 0) continue;
    candidates.push({ cc, avoid });
  }
  return candidates
    .sort((a, b) => b.cc.durationSeconds - a.cc.durationSeconds)
    .slice(0, CC_AVOIDABLE_CAP)
    .map(({ cc, avoid }) => {
      const t = toRenderSecond(cc.atSeconds);
      return {
        id: `cc-avoidable:${owner.id}:${cc.spellId}:${t}`,
        type: "cc-avoidable",
        t,
        unitNames: [owner.name],
        spell: cc.spellName,
        spellId: cc.spellId,
        facts: {
          t: String(t),
          spell: cc.spellName,
          durationS: String(Math.round(cc.durationSeconds)),
          avoidableWith: avoid.join("、"),
          castBarSeen: "yes",
        },
      };
    });
}

/** Team-play event integration: missed cleanse / missed purge (whole-team
 * scope) plus the owner being CC'd / interrupted. */
function teamPlayEvents(
  combat: any,
  owner: any,
  units: any[],
  ownerCds: IMajorCooldownInfo[],
  priorEvents: Pick<CandidateEvent, "type" | "t">[],
  /** Intent guard (BACKLOG #26 Task 2): threaded down to `cdHoardedEvents`
   * (intent guard, `facts.attempted`) — absent/`available:false` degrades
   * silently. (mana-pressure 的第二个消费点已随该候选退役摘除,2026-08-21。) */
  rawStreams?: RawStreams,
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  // (The `ccSummary` / `enemyTlShared` hoists that used to live here were the
  // retired slow-defensive-response's; its 2026-09-01 rewrite reads neither —
  // it runs `burstWindowDecisionPoints` on the combat directly. BACKLOG #18's
  // "duplicate reconstructEnemyCDTimeline calls" perf debt is unchanged.)
  const players = units.filter((u) => u.info);
  const friends = players.filter((u) => u.reaction === owner.reaction);
  const enemies = players.filter((u) => u.reaction !== owner.reaction);
  if (friends.length === 0 || enemies.length === 0) return out;
  const friendIds = new Set(friends.map((u) => u.id));
  const enemyIds = new Set(enemies.map((u) => u.id));
  const friendlyPets = units.filter(
    (u) => u.ownerId && friendIds.has(u.ownerId),
  );
  const enemyPets = units.filter((u) => u.ownerId && enemyIds.has(u.ownerId));

  try {
    const ds = reconstructDispelSummary(
      friends,
      enemies,
      combat,
      friendlyPets,
      enemyPets,
    );
    try {
      annotateMissedPurgesWithKillWindows(
        ds.missedPurgeWindows,
        computeOffensiveWindows(enemies, friends, combat),
      );
    } catch {
      /* kill-window annotation failed → duringKillWindow absent; the priority
         filter still applies */
    }
    // Dispellability confidence gate: only report ids the corpus has actually
    // seen dispelled (measured by confidenceAudit: Paralysis / Intimidating
    // Shout / Incapacitating Roar / Blind / Blessing of Sacrifice are flagged
    // Magic in DB2 yet were never observed dispelled across 1245 matches — so
    // "you should have dispelled it" does not hold up against the corpus.
    // After cutting them, both claim types are 100% backed by real observed
    // dispels).
    out.push(
      ...missedCleanseEvents(
        // DISPEL-002 (2026-08-06): lateCleanseWindows (cleansed, but late)
        // rides the same type/cap/sort pipeline as missedCleanseWindows
        // (never cleansed) — concatenated here, distinguished downstream
        // only by the presence of the latencyS fact.
        [...ds.missedCleanseWindows, ...ds.lateCleanseWindows].filter((w) =>
          CORPUS_OBSERVED_DISPEL_IDS.has(w.spellId),
        ),
        owner,
        friends,
        // Single-source predicate: the same bracket string the segmenter
        // stamps on a shuffle round (l2/segmenter.ts) and dampening.ts's own
        // rules table compare against — not a second shuffle judgment.
        combat?.startInfo?.bracket === "Rated Solo Shuffle",
        // #34(b2): lets the windows carry ownerCasting* facts (what the owner
        // was hard-casting during the window). startTime missing ⇒ omitted
        // entirely — the facts must never appear on a guessed clock.
        typeof combat?.startTime === "number"
          ? {
              enemyIds,
              matchStartMs: combat.startTime,
              failedCasts: rawStreams?.available
                ? rawStreams.castFailed
                    .filter((f) => f.unitGuid === owner.id)
                    .map((f) => ({
                      spellId: String(f.spellId),
                      ms: combat.startTime + f.tSeconds * 1000,
                    }))
                : undefined,
            }
          : undefined,
      ),
    );
    if (CANDIDATE_TYPE_FLAGS.missedPurge) {
      out.push(
        ...missedPurgeEvents(
          ds.missedPurgeWindows.filter((w) =>
            CORPUS_OBSERVED_DISPEL_IDS.has(w.spellId),
          ),
        ),
      );
    }
  } catch {
    /* dispel summary not computable → both types absent */
  }

  // missed-sync-window / unsynced-burst (P1 起爆-1/-2, 2026-08-15, Task 4
  // flag-gated wiring): team-wide sync-lens candidates — same scope as
  // missed-cleanse/missed-purge above (not owner-specific; the whole friendly
  // team's offensive economy against the enemy healer's hard-CC windows). See
  // enemyHealerCcWindows' doc comment for the hard-CC category decision.
  // Single source with buildFindingsPrompt.ts's legend gate: both read
  // CANDIDATE_TYPE_FLAGS directly, so a flag flip can never leave a candidate
  // in the menu with no legend (or a legend with no candidate). Both flags
  // are ON since 2026-08-15 (Task 9, user-ruled) — the current expected value
  // of every flag lives in docs/predicate-index.md's `Feature flag state`
  // table, asserted against runtime by predicateIndex.test.ts.
  // attempt-into-trinket (2026-08-18): stun-anchored kill attempts opened on
  // a trinket-up target while a PRIME target existed. Extractor + mapper live
  // in utils/killAttempts.ts; assembly here is flag-gated like every other
  // new candidate type.
  if (CANDIDATE_TYPE_FLAGS.attemptIntoTrinket) {
    try {
      out.push(
        ...attemptIntoTrinketEvents(
          extractKillAttempts(friends, enemies, combat),
        ),
      );
    } catch {
      /* same degradation policy as the other team-play sources */
    }
  }

  // GH #80 (2026-09-12, user approval "做出来看看是否对游戏建议有真正的帮助"):
  // backlash-dispel (the owner dispelled UA/VT in the archive-measured
  // net-negative stratum) and backlash-dispel-window (the owner could have
  // dispelled in a net-positive / immune stratum and did not). One decision
  // point list, two producers; the corpus reference comes from
  // data/backlashDispelPrior.ts and checkBacklashRefConsistency re-checks it.
  // GH #78 (2026-09-12, user rulings 1/2/3): kick-priority-missed (the owner
  // could have kicked the heal on the low kill target and did not) and
  // kick-priority-team (a teammate could — range included — call it out).
  if (CANDIDATE_TYPE_FLAGS.kickPriority) {
    try {
      const points = kickPriorityDecisionPoints(friends, enemies, combat);
      const probes = { lookup: lookupKickPriorityPrior };
      out.push(...kickPriorityMissedEvents(points, owner, probes));
      out.push(...kickPriorityTeamEvents(points, owner, probes));
    } catch {
      /* kick-priority not computable → types absent */
    }
  }

  if (CANDIDATE_TYPE_FLAGS.backlashDispel) {
    try {
      const points = backlashDispelDecisionPoints(
        friends,
        enemies,
        combat,
        friendlyPets,
        enemyPets,
      );
      out.push(
        ...backlashDispelEvents(points, owner, { lookup: lookupBacklashPrior }),
      );
      out.push(
        ...backlashDispelWindowEvents(points, owner, {
          lookup: lookupBacklashPrior,
          lookupWorth: lookupBacklashWorth,
        }),
      );
    } catch {
      /* backlash-dispel not computable → types absent */
    }
  }

  if (
    CANDIDATE_TYPE_FLAGS.missedSyncWindow ||
    CANDIDATE_TYPE_FLAGS.unsyncedBurst
  ) {
    try {
      const ccWindows = enemyHealerCcWindows(friends, enemies, combat);
      // Gate on at least one real hard-CC window on the enemy healer: with
      // zero windows, unsynced-burst's "no hard CC overlapped this cast"
      // predicate would trivially be true for EVERY offensive cast (nothing
      // to overlap), flooding the menu with a claim sync was never even
      // possible to attempt — not the coaching point this type exists for.
      if (ccWindows.length > 0) {
        // B3i: enemy CC can come from a pet or totem (Capacitor Totem,
        // e9ea8a0c @298), so the owner's cannot-cast sources include them.
        const enemyAndPetIds = new Set<string>([
          ...enemyIds,
          ...enemyPets.map((u: any) => u.id as string),
        ]);
        const teamOffensiveCds: Array<
          IMajorCooldownInfo & {
            ownerName: string;
            owner: any;
            ownerEnemyIds: Set<string>;
            matchStartMs: number;
          }
        > = [];
        for (const f of friends) {
          try {
            for (const cd of extractMajorCooldowns(f, combat)) {
              // Resurrection redesign (2026-09-02, GH #13): the canonical
              // offensive table (chg9) replaces `isThroughput`, which had
              // been listing Tiger's Lust / Berserker Shout / racials as
              // "ready offensive CDs". Deliberately also narrows
              // unsynced-burst's input (retired, flag false) — if that type
              // ever returns it must return on the canonical table too.
              // B3iii (2026-09-25): a healer's own CD counts only if it is
              // Power Infusion — the shared countsAsTeamBurst.
              if (!countsAsTeamBurst(f, String(cd.spellId))) continue;
              teamOffensiveCds.push({
                ...cd,
                ownerName: f.name,
                // B3i / B3iii (2026-09-25): who can press it, for the
                // shared evaluateSyncWindow feasibility + active-span test
                owner: f,
                ownerEnemyIds: enemyAndPetIds,
                matchStartMs: combat.startTime,
              });
            }
          } catch {
            /* this friend's CD ledger not computable → their CDs absent */
          }
        }
        if (CANDIDATE_TYPE_FLAGS.missedSyncWindow) {
          const startMs: number = combat.startTime;
          const enemyDeathS: number[] = enemies.flatMap((e: any) =>
            ((e.deathRecords ?? []) as any[]).map(
              (d: any) => ((d.timestamp as number) - startMs) / 1000,
            ),
          );
          out.push(
            ...missedSyncWindowEvents(ccWindows, teamOffensiveCds, {
              enemyMinHpPctAt: (from, to) =>
                enemyMinHpPctInWindow(enemies, combat, from, to),
              enemyDeathS,
              ref: lookupSyncWindowPrior(combat?.startInfo?.bracket ?? ""),
            }),
          );
        }
        if (CANDIDATE_TYPE_FLAGS.unsyncedBurst) {
          const teamOffensiveCasts = teamOffensiveCds.flatMap((cd) =>
            cd.casts.map((c) => ({
              ownerName: cd.ownerName,
              spellId: cd.spellId,
              spellName: cd.spellName,
              castTimeSeconds: c.timeSeconds,
              cooldownSeconds: cd.cooldownSeconds,
            })),
          );
          // §29b fix (2026-08-15): name EVERY enemy healer, not just the
          // first match — enemyHealerCcWindows' hard-CC gate already spans
          // all of them (see unsyncedBurstEvents' doc comment), so a
          // dual-healer comp must not misattribute the "was free" fact to
          // an arbitrary one.
          const enemyHealerNames = enemies
            .filter((e) => isHealerSpec(e.spec))
            .map((e) => e.name as string);
          // Feasibility gate input: the team's own hard-CC ledger, built from
          // the same extractMajorCooldowns pass the offensive list uses and
          // filtered to abilities that are hard CC (`ccSpellIds` — the official
          // predicate since 2026-08-22).
          const teamCcCds: IMajorCooldownInfo[] = [];
          for (const f of friends) {
            try {
              for (const cd of extractMajorCooldowns(f, combat))
                if (ccSpellIds.has(cd.spellId)) teamCcCds.push(cd);
            } catch {
              /* this friend's ledger not computable → their CC absent */
            }
          }
          out.push(
            ...unsyncedBurstEvents(
              teamOffensiveCasts,
              ccWindows,
              enemyHealerNames,
              (tSeconds) => teamCcCds.some((cd) => cdAvailableAt(cd, tSeconds)),
            ),
          );
        }
      }
    } catch {
      /* sync-lens analysis not computable → both types absent */
    }
  }

  // cd-hoarded (2026-08-30 rewrite, GH #34, decision-point shaped): crisis
  // decision points from `crisisDecisionPoints` — the owner's own crises,
  // plus each OTHER friendly's as a teammate crisis (the `own` flag on each
  // source decides which help-gate `cdHoardedEvents` applies). Reuses the
  // caller's already-computed `ownerCds` (no re-fetch), same convention as
  // cd-spent-idle below.
  if (CANDIDATE_TYPE_FLAGS.cdHoarded) {
    try {
      // BACKLOG #43 proc exemption needs the crisis unit's death instants, in
      // the same re-based seconds every tSec fact uses
      const deathSecondsOf = (u: any): number[] =>
        ((u.deathRecords ?? []) as any[]).map(
          (d) => (d.timestamp - combat.startTime) / 1000,
        );
      const wallsOn = majorWallsOnFor(combat);
      const cdHoardSources = [
        {
          crisisUnit: { id: owner.id, name: owner.name },
          own: true,
          points: crisisDecisionPoints(owner, combat),
          deathSeconds: deathSecondsOf(owner),
          majorWalls: wallsOn(owner),
        },
        ...friends
          .filter((f: any) => f.id !== owner.id)
          .map((f: any) => ({
            crisisUnit: { id: f.id, name: f.name },
            own: false,
            points: crisisDecisionPoints(f, combat),
            deathSeconds: deathSecondsOf(f),
            majorWalls: wallsOn(f),
          })),
      ];
      out.push(
        ...cdHoardedEvents(
          cdHoardSources,
          ownerCds,
          owner,
          undefined,
          rawStreams,
          // #29 (2026-08-17): feeds filterIntentGuardEvidence's gcd-locked
          // exclusion — the owner's own successful casts, re-based to
          // seconds the same way every other tSeconds fact is.
          (owner.spellCastEvents ?? []).map(
            (e: any) => (e.logLine.timestamp - combat.startTime) / 1000,
          ),
          // Reliability round 2 W1a: the owner's own feasibility — the one
          // could-react predicate (`couldReactWithin`) over the one
          // cannot-cast predicate, plus death.
          couldRespondFor(owner, enemyIds, combat.startTime),
        ),
      );
    } catch {
      /* cd-hoarded not computable → type absent */
    }
  }
  if (CANDIDATE_TYPE_FLAGS.cdSpentIdle) {
    try {
      const matchThreat = matchThreatLevel(enemies, friends, combat);
      out.push(
        ...cdSpentIdleEvents(ownerCds, owner, matchThreat, {
          threatActiveAt: (t) => threatActiveAt(t, enemies, friends, combat),
        }),
      );
    } catch {
      /* cd-spent-idle not computable → type absent */
    }
  }

  // md-cyclone-window (GH #25 MD 特例, user-ruled four-gate criterion
  // 2026-08-21): priest owner only. Every input is a shared predicate —
  // cyclone landings via buildAuraIntervals, chain gap via drResetMsAt (the
  // same walk extractKillAttempts groups stun chains with), pressure via
  // extractKillAttempts(enemies, friends) + friendlyCrisisMomentInWindow,
  // strategic-immunity cooldowns via official spellEffectData. All four
  // gates (and the red-line default-to-silence) live in
  // mdCycloneWindowEvents — see its module header.
  if (
    CANDIDATE_TYPE_FLAGS.mdCycloneWindow &&
    owner.class === CombatUnitClass.Priest
  ) {
    try {
      const cycloneHits = friends.flatMap((f: any) =>
        buildAuraIntervals(f, combat)
          .filter((iv) => iv.spellId === CYCLONE_SPELL_ID)
          .map((iv) => ({ atS: iv.fromS, targetName: f.name as string })),
      );
      const enemyStrategics: IStrategicHolder[] = enemies.flatMap((e: any) => {
        const spellId =
          e.class === CombatUnitClass.Mage
            ? ICE_BLOCK_SPELL_ID
            : e.class === CombatUnitClass.Paladin
              ? DIVINE_SHIELD_SPELL_ID
              : null;
        if (spellId === null) return [];
        return [
          {
            unitName: e.name as string,
            spellId,
            castSeconds: (e.spellCastEvents ?? [])
              .filter((c: any) => c.spellId === spellId)
              .map((c: any) => (c.timestamp - combat.startTime) / 1000),
          },
        ];
      });
      // Enemy attempts on the owner's team — computed lazily, at most once
      // (the probe only runs for chains that survived gates 3–4).
      let enemyAttempts: ReturnType<typeof extractKillAttempts> | null = null;
      out.push(
        ...mdCycloneWindowEvents({
          owner,
          cycloneHits,
          ownerMdCastSeconds: (owner.spellCastEvents ?? [])
            .filter((c: any) => c.spellId === MD_SPELL_ID)
            .map((c: any) => (c.timestamp - combat.startTime) / 1000),
          enemyStrategics,
          chainGapS: drResetMsAt(combat.startTime) / 1000,
          probes: {
            crisisMomentAt: (from, to) =>
              friendlyCrisisMomentInWindow(friends, combat, from, to),
            enemyAttemptOverlapping: (from, to) => {
              enemyAttempts ??= extractKillAttempts(enemies, friends, combat);
              const a = enemyAttempts.find(
                (k) => k.fromSeconds <= to && k.toSeconds >= from,
              );
              return a
                ? `enemy kill attempt on ${a.targetName} at ${toRenderSecond(a.fromSeconds)}s`
                : null;
            },
          },
        }),
      );
    } catch {
      /* md-cyclone-window not computable → type absent */
    }
  }

  try {
    const cc = analyzePlayerCCAndTrinket(owner, enemies, combat, enemyPets);
    // cc-locked 已退役(GH #14,用户裁定 2026-08-19,v28):机会归一化后转化率
    // 反向(能解时真解了:胜 23.2% vs 负 27.9%,−4.7pp;赢家更常全程不交徽章,
    // 有机会零解控回合 胜 23.4% vs 负 16.2%),出面事件 98.5% 落在两个无证据
    // 档位(available_unused 51% + on_cooldown 47%)。被控事实仍由时间线
    // [CC ON TEAM] 行完整供给模型;其产出函数与测试已于 2026-09-24 删除
    // (旧版本缓存从不被读取,渲染也不调产出函数)。
    out.push(
      ...kickEatenEvents(
        cc.interruptInstances,
        owner,
        {
          rawStreams,
          // Same seconds base and same source list as cd-hoarded's
          // `ownCastSuccessSeconds` (teamPlayEvents above).
          ownerCasts: (owner.spellCastEvents ?? []).map((e: any) => ({
            spellId: String(e.spellId ?? ""),
            tSeconds: (e.logLine.timestamp - combat.startTime) / 1000,
          })),
        },
        (k) => {
          if (!k.interruptedSpellId || !k.kickSpellId) return null;
          const kicker = k.sourceId
            ? ((combat.units ?? {})[k.sourceId] ?? null)
            : null;
          const yourReachYd = spellReachForCaster(owner, k.interruptedSpellId);
          const kickRangeYd = spellRangeForCaster(kicker, k.kickSpellId);
          return yourReachYd !== null && kickRangeYd !== null
            ? { yourReachYd, kickRangeYd }
            : null;
        },
        kickPressureFor({ combat, owner, friends, enemies }),
        ownerCastCancels({ owner, friends, enemies, combat, rawStreams }),
      ),
    );

    // wasted-trinket 已退役(GH #14 B 组复测,用户裁定 2026-08-19,v29):出面
    // 事件 94.9%(胜)/93.9%(负)是治疗解自己身上的控 —— healerInCCAt 对 owner
    // 恒 false 的结构性盲区让「满血时解控」本身成了罪名;按使用次数归一化后
    // 反向(胜 12.0% vs 负 10.4% 被判浪费),触发率持平(12.3/12.5)。徽章按压
    // 事实仍由时间线 [TRINKET] 行与 [CC ON TEAM] trinket 备注完整供给模型;
    // 其产出函数、团队血线辅助函数与测试已于 2026-09-24 删除。将来若要
    // 「徽章被钓」信号,应重新设计成看后果的
    // 版本(中立按压 + 真空期内落硬控/击杀尝试)再接地上线。
    //
    // owner/friends are passed through (2026-08-06, signal-expansion batch 1)
    // so alignedBurstWindows also carries mostPressuredTarget/healerCCed/
    // dangerScore — position-mistake below needs those (see
    // reconstructEnemyCDTimeline's own doc comment).
    const enemyTl = reconstructEnemyCDTimeline(enemies, combat, owner, friends);

    // position-mistake (POSITION-001, 2026-08-06): reuses this same try's
    // ownerCds / alignedBurstWindows / ownerCCSummary — the identical wiring
    // deepDive.ts's positioning pack uses. computeOwnerPositionEvents itself
    // enforces the three-state rule (silently [] with no advanced position
    // data), so no extra gate is needed here.
    out.push(
      ...positionMistakeEvents(
        computeOwnerPositionEvents({
          owner,
          enemies,
          combat,
          burstWindows: enemyTl.alignedBurstWindows,
          ownerCooldowns: ownerCds,
          ownerCCSummary: cc,
          isHealer: isHealerSpec(owner.spec),
          ownerIsMelee: isMeleeSpec(owner.spec),
          friends,
        }),
        owner,
      ),
    );

    // cc-avoidable (DEFENSIVE-001, 2026-08-07): healer-owner rounds only —
    // same gate healing-gap uses below; a DPS owner eating CC is normal
    // play, this candidate specifically coaches a healer's self-preservation
    // kit. Reuses this same try's `cc.ccInstances` (no re-fetch).
    if (isHealerSpec(owner.spec)) {
      // A4: the owner's own on-GCD successful casts (seconds from start) —
      // what locks the GCD during an enemy CC cast bar.
      const ownerOnGcdCastSeconds = (owner.spellCastEvents ?? [])
        .filter(
          (e: any) =>
            e.logLine?.event === "SPELL_CAST_SUCCESS" &&
            !OFF_GCD_SPELL_IDS.has(String(e.spellId ?? "")) &&
            // GH #108: a passive proc (Reclamation fired 5× at
            // 217.25–217.57) is not the owner locking their own GCD.
            !isPassiveProcCast(e),
        )
        .map((e: any) => (e.logLine.timestamp - combat.startTime) / 1000);
      // W1a: the owner's own cannot-cast intervals (CC, silence, kick
      // lockout) — the one predicate every feasibility gate reads.
      let ownerBlockedS: Array<{ from: number; to: number }> = [];
      try {
        ownerBlockedS = buildCannotCastIntervals(owner, enemyIds).map((b) => ({
          from: (b.from - combat.startTime) / 1000,
          to: (b.to - combat.startTime) / 1000,
        }));
      } catch {
        ownerBlockedS = [];
      }
      const usableWhileCc = (id: string) =>
        USABLE_WHILE_CC_SPELL_IDS.has(id) ||
        USABLE_WHILE_FEARED_SPELL_IDS.has(id) ||
        USABLE_WHILE_CONFUSED_SPELL_IDS.has(id);
      out.push(
        ...ccAvoidableEvents(
          cc.ccInstances,
          owner,
          (inst) => {
            const castStartS = ccCastStartSeconds(
              enemies,
              enemyPets,
              inst,
              combat.startTime,
            );
            return ccAvoidanceOptionsAt(
              owner,
              inst,
              combat.startTime,
              (pressIds) =>
                castStartS !== null &&
                ownerCouldReactWith(
                  ownerOnGcdCastSeconds,
                  castStartS,
                  inst.atSeconds,
                  pressIds.some((id) => !OFF_GCD_SPELL_IDS.has(id)),
                  ownerBlockedS,
                  pressIds.some(usableWhileCc),
                ),
            );
          },
          (inst) => wasCcHardCastAt(enemies, enemyPets, inst, combat.startTime),
        ),
      );
    }
  } catch {
    /* owner CC summary not computable → all three types (kick-eaten /
       position-mistake / cc-avoidable) absent */
  }

  // cc-held (COOLDOWN-001, 2026-08-06): pure filter over ownerCds, already
  // computed once by the caller (extractCandidateFindings) — no re-fetch.
  // Demoted 2026-08-29 (GH #50 (d), flag ledger in docs/predicate-index.md).
  if (CANDIDATE_TYPE_FLAGS.ccHeld) {
    try {
      out.push(...ccHeldEvents(ownerCds, owner));
    } catch {
      /* same as above */
    }
  }

  // healing-gap (HEAL-001, 2026-08-06): healer-owner rounds only — mirrors
  // the "DPS owner only" gate dpsOwnerEvents uses on the other side.
  if (isHealerSpec(owner.spec)) {
    try {
      out.push(
        ...healingGapEvents(
          detectHealingGaps(owner, friends, enemies, combat),
          owner,
        ),
      );
    } catch {
      /* healing-gap analysis not computable → type absent */
    }
  }

  // crisis-no-response: same predicate as the eval behavior-prior scan
  // (crisisDecisionPoints) and same lookup as the gate, keyed by role (spec
  // §1d, GH #59). Healer and DPS owners each get their own role-tagged
  // decision points and reference lookup.
  if (isHealerSpec(owner.spec)) {
    try {
      const bracket: string = combat?.startInfo?.bracket ?? "";
      out.push(
        ...crisisNoResponseEvents(
          crisisDecisionPoints(owner, combat, "healer"),
          owner,
          bracket,
          {
            lookup: (dmg2s) => lookupBehaviorPrior(bracket, "healer", dmg2s),
            majorWalls: majorWallsOnFor(combat)(owner),
          },
        ),
      );
    } catch {
      /* decision points not computable → type absent */
    }
    // teammate-crisis-idle (GH #95, 2026-09-17): the healer-side twin — a
    // TEAMMATE's crossing (same crisisDecisionPoints, run on the teammate),
    // judged on what the healer did toward them; same predicate the eval
    // reference scan uses (teammateCrisisPriorScan.ts), same lookup as the
    // gate (lookupTeammateCrisisPriorByBin).
    // Both accusations retired 2026-09-19 (user ruling; registry rows carry
    // the numbers) — one flag, the predicate and producers stay.
    if (CANDIDATE_TYPE_FLAGS.teammateCrisis)
      try {
        const bracket: string = combat?.startInfo?.bracket ?? "";
        const teammatePoints = teammateCrisisPoints(owner, combat);
        out.push(
          ...teammateCrisisIdleEvents(teammatePoints, owner, bracket),
          // teammate-crisis-triage (user ruling 2026-09-17): the healer spent
          // the window on a friendly who was NOT in crisis
          ...teammateCrisisTriageEvents(teammatePoints, owner, bracket),
        );
      } catch {
        /* teammate points not computable → type absent */
      }
  } else {
    // DPS side of the same signal (spec §1d): until the DPS behavior-prior
    // scan lands, behaviorPriorGenerated.json carries no `|dps|` cells, so
    // lookupBehaviorPrior always returns null here and crisisNoResponseEvents
    // emits nothing — byte-identical product output until that data exists.
    try {
      const bracket: string = combat?.startInfo?.bracket ?? "";
      out.push(
        ...crisisNoResponseEvents(
          crisisDecisionPoints(owner, combat, "dps"),
          owner,
          bracket,
          { lookup: (dmg2s) => lookupBehaviorPrior(bracket, "dps", dmg2s) },
        ),
      );
    } catch {
      /* decision points not computable → type absent */
    }
  }

  // slow-defensive-response (DEFENSIVE-003, rewritten 2026-09-01, GH #60
  // phase 2): decision-point shaped — every bounded enemy burst window of the
  // round, feasible for the PRESSURED friendly, triaged on that friendly's HP
  // (or a death), unanswered within 8 s. The predicate is the engine's; this
  // call site only supplies the reference lookup.
  //
  // Healer-owner rounds only, KEPT deliberately though its old justification
  // is gone: the retired thresholds were calibrated on 898 healer-owner rounds
  // and this engine's are calibrated on the whole 18k-match archive regardless
  // of owner, so nothing about the numbers demands the gate any more. What
  // does is scope: this is an in-place upgrade of an existing healer-only
  // type, and handing DPS owners a brand new candidate class is a product
  // change with no measurement behind it. Lifting the gate is a separate,
  // measurable step (BACKLOG #38).
  if (isHealerSpec(owner.spec)) {
    try {
      const bracket: string = combat?.startInfo?.bracket ?? "";
      out.push(
        ...burstWindowResponseEvents(
          burstWindowDecisionPoints(combat, {
            friendlyReaction: owner.reaction,
          }),
          owner,
          {
            lookup: (leadCdSpellId) =>
              lookupBurstWindowPrior(bracket, leadCdSpellId),
          },
        ),
      );
    } catch {
      /* slow-defensive-response not computable → type absent */
    }
  }

  return out;
}

/** death-setup integration: assemble parts for each friendly death (summaries
 * are computed lazily, once per victim). */
function extractDeathSetups(
  combat: any,
  units: any[],
  start: number,
  ownerId?: string,
  /** Intent guard (BACKLOG #26 Task 2): was threaded down only to the
   * death-unused-defensive producer, whose emitter was deleted 2026-09-24;
   * currently unused. */
  rawStreams?: RawStreams,
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  const players = units.filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction !== CombatUnitReaction.Friendly,
  );
  if (friends.length === 0 || enemies.length === 0) return out;
  const enemyIds = new Set(enemies.map((e) => e.id));
  const enemyPets = units.filter((u) => u.ownerId && enemyIds.has(u.ownerId));
  const healer = friends.find((u) => isHealerSpec(u.spec));
  const ownerUnit = ownerId ? friends.find((f) => f.id === ownerId) : undefined;

  const ccMemo = new Map<
    string,
    ReturnType<typeof analyzePlayerCCAndTrinket>
  >();
  const ccOf = (u: any) => {
    let v = ccMemo.get(u.id);
    if (!v) {
      v = analyzePlayerCCAndTrinket(u, enemies, combat, enemyPets);
      ccMemo.set(u.id, v);
    }
    return v;
  };
  // The timing audit needs the enemy cooldown timeline (computed once per
  // match). The casts from extractMajorCooldowns carry no timingLabel of their
  // own — they must go through annotateDefensiveTimings before an Early
  // verdict exists (agy review #1: skip the annotation and defensive-early
  // never fires in production).
  let enemyTl: ReturnType<typeof reconstructEnemyCDTimeline> | null = null;
  const cdMemo = new Map<string, IMajorCooldownInfo[]>();
  const cdsOf = (u: any) => {
    let v = cdMemo.get(u.id);
    if (!v) {
      enemyTl = enemyTl ?? reconstructEnemyCDTimeline(enemies, combat);
      v = annotateDefensiveTimings(
        extractMajorCooldowns(u, combat),
        u,
        combat,
        enemyTl,
      );
      cdMemo.set(u.id, v);
    }
    return v;
  };

  for (const u of friends) {
    for (const d of (u.deathRecords ?? []) as any[]) {
      const deathT = ((d.timestamp ?? 0) - start) / 1000;
      const parts: DeathSetupParts = {
        deathT,
        victim: { id: u.id, name: u.name },
        victimHitDuring: (cc) => mateHitDuringCc(u, start, cc),
      };
      // Each summary is independently fault-tolerant: when a synthetic fixture
      // lacks startInfo or an event array, only that one part goes missing and
      // the other precursor verdicts still stand (second layer on top of the
      // menu-wide try/catch).
      if (healer && healer.id !== u.id) {
        try {
          parts.healerCC = {
            healerName: healer.name,
            ccInstances: ccOf(healer).ccInstances,
          };
        } catch {
          /* same as above */
        }
      }
      out.push(...deathSetupEvents(parts));
      // death-unused-defensive 已退役(GH #58,用户裁定 2026-08-29,v38):
      // 它的指控「你死时减伤是好的却没按」在语料里是高手多数时候也不做的事
      // (自由态前 10% 治疗按个人减伤仅 19–36%),54% 的出面列的还是宁静/
      // 神圣赞美诗这类非个人减伤;真正有分段梯度的错误是「危机 3 秒无应对」,
      // 由 crisis-no-response(不以死亡为锚、承伤 ≥10%、结果参照)接替。
      // 死亡时哪些减伤可用的事实仍由时间线 [DEATH] 行的 (Unused: …) 供给模型;
      // 其产出函数与测试已于 2026-09-24 删除(旧版本缓存从不被读取,渲染
      // 也不调产出函数)。
      void rawStreams; // was threaded only to the retired producer
      if (ownerUnit && ownerUnit.id !== u.id) {
        try {
          out.push(
            ...externalUnusedEvents({
              deathT,
              victim: { id: u.id, name: u.name },
              owner: { id: ownerUnit.id, name: ownerUnit.name },
              ownerExternals: cdsOf(ownerUnit).filter((cd) =>
                isAllyCastableDefensive(cd.spellId),
              ),
              ownerCC: ccOf(ownerUnit).ccInstances,
              ownerAliveAt: (t) =>
                !(ownerUnit.deathRecords ?? []).some(
                  (dr: any) => (dr.timestamp - start) / 1000 <= t,
                ),
            }),
          );
        } catch {
          /* owner summary not computable → this type is absent */
        }
      }
    }
  }

  // --- questionable-external (17a): an external handed out in a
  // no-pressure window (the sixth tier, "Unnecessary", from
  // annotateDefensiveTimings). Unlike the above, this is not tied to a death —
  // every friendly external cast is checked, reusing the same cdsOf (annotate
  // already ran; don't recompute).
  // nearestBurstGapS is computed by annotateDefensiveTimings and stored on the
  // cast — that code already holds enemyCDTimeline.alignedBurstWindows, so we
  // just read it here rather than re-deriving the window geometry
  // (single-source predicate).
  for (const u of friends) {
    try {
      out.push(
        ...questionableExternalEvents(cdsOf(u), { id: u.id, name: u.name }),
      );
    } catch {
      /* same as above */
    }
  }

  return out;
}

// WASTED_DR_LEVELS({"25%","Immune"})随 dr-clipped-cc 退役删除(GH #17,
// 2026-08-20,用户裁定):"25%" 档 12.0 已从游戏移除(见 drAnalysis.ts 头注),
// "Immune" 按同文件 :325 的契约「outgoing 路径永远收不到」—— 实测两轮
// (12.1 前 21+4 条 / 12.1 DPS-owner 34 条,抽样 12/12)出面事件全是带真实
// 时长的 Immune 标注,即链窗模型与服务器窗口错位的解析伪影。谓词定义域 =
// {死档位, 伪影档} → 类型无合法定义域。

function dpsOwnerEvents(
  combat: any,
  owner: any,
  units: any[],
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  const players = units.filter((u) => u.info);
  const friends = players.filter((u) => u.reaction === owner.reaction);
  const enemies = players.filter((u) => u.reaction !== owner.reaction);
  if (enemies.length === 0) return out;
  const allies = friends.filter((u) => u.id !== owner.id);

  const ledger = analyzeBurstLedger(owner, allies, enemies, combat);

  // unconverted-burst: RETIRED from the menu 2026-08-19 (user ruling: C —
  // superseded). Measured grounds (GH #16/#17): 92.1% incidence (the noisiest
  // type after off-target), discrimination +4.1pp; every offensive-CD cast
  // counted as a "burst" with NO damage floor (18.5% of accusations carried
  // <0.2M dominant-target damage — a single Soul Immolation self-buff cast
  // qualified), and the CONVERTED_HP_DROP_PT=20 line sits at the flattest
  // part of the drop→death curve (see the #16 grounding report). What this
  // type wanted to say — "you swung and it did not convert" — is exactly the
  // [KILL ATTEMPTS] block's per-attempt outcome ("FAILED: not enough damage"
  // and friends), which is team-level, tier-aware, and attribution-backed.
  // Retirement follows the off-target-in-window shape one commit earlier:
  // assembly unplugged here; `isBurstConverted`/`CONVERTED_HP_DROP_PT` stay
  // in dpsMetrics (burstConversionRate + desktop keyMoments still consume
  // them), and deepDive/findingDisplay keep their branches so pre-retirement
  // cached findings still render.

  // burst-into-immunity 退役(GH #17,用户裁定 2026-08-20,v32;照 #14 系列
  // 先例摘发射)。区间伪影修复(buildFilteredAuraIntervals 双防伪规则)后
  // 样本已干净(overlap 全部 ≤ 真实免疫时长),但按爆发归一化的机会口径
  // 判别力持平:打进免疫率 胜 7.1%(44/618) vs 负 6.8%(35/511),n=492
  // DPS-recorder 回合 —— #13 下架时的同款形状;历史盲评 4.70/5 的 rubric
  // 明确不查事实,不构成留用依据。免疫事实仍由 [KILL ATTEMPTS] 失败归因
  // (mitigationVerdicts)与减伤表路径供给;legend/findingDisplay/deepDive
  // 分支保留(缓存 findings 仍要能渲染)。

  // burst-into-mitigation (OFFENSIVE-002): the dominant target had a major
  // non-immune mitigation cooldown running AND a softer target existed at the
  // same instant — see BURST_INTO_MITIGATION_MIN_PCT's doc comment for the
  // full predicate and corpus rates.
  {
    type BurstEntry = (typeof ledger)[number];
    type DominantTarget = NonNullable<BurstEntry["dominantTarget"]>;
    const mitCandidates: Array<{
      b: BurstEntry;
      t: DominantTarget;
      mitSpell: string;
      mitPct: number;
      betterTargetName: string;
      /** The covering wall itself (GH #91 attaches the during-external fact to it). */
      hitDef: DominantTarget["defensivesHit"][number];
    }> = [];
    // GH #96 D6 decision trace: every burst in the ledger is an opportunity.
    const bimTracing = isDecisionTraceActive();
    const bimTrace = new Map<BurstEntry, DecisionRecord>();
    const bimOpp = (b: BurstEntry) =>
      `burst-into-mitigation:${owner.id}:${Math.round(b.fromSeconds)}`;
    for (const b of ledger) {
      const t = b.dominantTarget;
      if (!t) {
        if (bimTracing)
          bimTrace.set(b, {
            type: "burst-into-mitigation",
            opportunityId: bimOpp(b),
            ownerId: owner.id,
            verdict: "ineligible",
            reason: "no-dominant-target",
            facts: { fromSeconds: b.fromSeconds },
            candidateIds: [],
          });
        continue;
      }
      // Priced on the unit that CARRIES the aura: a Flameshaper's Obsidian
      // Scales is 30 % on the Evoker and 15 % on the ally it was cast on, and
      // the ally's copy sat exactly on this door until 2026-09-12.
      const hits = t.defensivesHit
        .filter((d) => !d.isImmunity)
        .map((d) => {
          // GH #96 M3a: priced through the component resolver (door = the
          // strongest component's lower bound; immunity components included,
          // exactly as the table read did — `isImmunity` above is the
          // ledger's own exclusion).
          const ctx = {
            carrierIsCaster: !d.appliedByOther,
            caster: players.find((u) => u.name === d.casterName),
          };
          const res = resolveMitigation(d.spellId, ctx);
          return {
            d,
            res,
            // GH #114: the same helper prices the [ENEMY DEF] line
            pct: wallDoorPct(d.spellId, ctx) ?? 0,
          };
        })
        .filter(
          ({ res, pct }) =>
            !!res && !res.positional && pct >= BURST_INTO_MITIGATION_MIN_PCT,
        )
        .sort((a, c) => c.pct - a.pct);
      const spanS = b.toSeconds - b.fromSeconds;
      const covered = hits.filter(
        ({ d }) =>
          spanS > 0 &&
          d.overlapSeconds / spanS >= BURST_INTO_MITIGATION_MIN_COVERAGE,
      );
      const hit = covered[0];
      const bimFacts = () => ({
        fromSeconds: b.fromSeconds,
        target: t.unitId,
        defensivesHit: t.defensivesHit.map((d) => ({
          spellId: d.spellId,
          isImmunity: d.isImmunity,
          appliedByOther: !!d.appliedByOther,
          pct:
            wallDoorPct(d.spellId, {
              carrierIsCaster: !d.appliedByOther,
              caster: players.find((u) => u.name === d.casterName),
            }) ?? null,
        })),
      });
      if (!hit) {
        if (bimTracing)
          bimTrace.set(b, {
            type: "burst-into-mitigation",
            opportunityId: bimOpp(b),
            ownerId: owner.id,
            verdict: "suppressed",
            reason: hits.length
              ? "wall-covers-too-little"
              : "no-mitigation-over-door",
            facts: bimFacts(),
            candidateIds: [],
          });
        continue;
      }
      const evals = analyzeKillWindowTargetSelection(
        [
          {
            targetUnitId: t.unitId,
            fromSeconds: b.fromSeconds,
            toSeconds: b.toSeconds,
            durationSeconds: b.toSeconds - b.fromSeconds,
          },
        ],
        enemies,
        combat,
      );
      const ev = evals[0];
      if (!ev?.betterTargetExists || !ev.betterTargetName) {
        if (bimTracing)
          bimTrace.set(b, {
            type: "burst-into-mitigation",
            opportunityId: bimOpp(b),
            ownerId: owner.id,
            verdict: "suppressed",
            reason: "no-better-target",
            facts: bimFacts(),
            candidateIds: [],
          });
        continue;
      }
      if (bimTracing)
        bimTrace.set(b, {
          type: "burst-into-mitigation",
          opportunityId: bimOpp(b),
          ownerId: owner.id,
          verdict: "suppressed",
          reason: "capped",
          facts: { ...bimFacts(), mitSpellId: hit.d.spellId, mitPct: hit.pct },
          candidateIds: [],
        });
      mitCandidates.push({
        b,
        t,
        mitSpell: hit.d.spellName,
        mitPct: hit.pct,
        betterTargetName: ev.betterTargetName,
        hitDef: hit.d,
      });
    }
    for (const {
      b,
      t,
      mitSpell,
      mitPct,
      betterTargetName,
      hitDef,
    } of mitCandidates
      .sort((a, c) => c.t.damage - a.t.damage)
      .slice(0, BURST_INTO_MITIGATION_CAP)) {
      const rec = bimTrace.get(b);
      if (rec) {
        rec.verdict = "emitted";
        delete rec.reason;
        rec.candidateIds = [bimOpp(b)];
      }
      // GH #91: when the wall was an ally-applied external, attach what the
      // owner kept doing during THAT application — owner, target and the
      // specific aura interval (spell + applier + overlap with this burst)
      // must all coincide; otherwise no fact (the timeline's [ENEMY DEF]
      // line still carries it for every qualifying friendly).
      const duringExternal = (() => {
        if (!hitDef.appliedByOther) return undefined;
        const target = enemies.find((e) => e.id === t.unitId);
        if (!target) return undefined;
        const iv = buildAuraIntervals(target, combat).find(
          (a) =>
            a.spellId === hitDef.spellId &&
            a.srcUnitName === hitDef.casterName &&
            a.fromS <= b.toSeconds &&
            a.toS >= b.fromSeconds,
        );
        if (!iv) return undefined;
        const obs = externalDamageForApplication(
          iv,
          target,
          [owner],
          enemies,
          combat,
        )[0];
        return obs ? formatDuringExternalForOwner(obs) : undefined;
      })();
      out.push({
        id: `burst-into-mitigation:${owner.id}:${Math.round(b.fromSeconds)}`,
        type: "burst-into-mitigation",
        t: b.fromSeconds,
        unitNames: [owner.name, t.unitName],
        spell: b.spells[0]?.spellName,
        spellId: b.spells[0]?.spellId,
        facts: {
          t: fmt(b.fromSeconds),
          spell: b.spells.map((s) => s.spellName).join(" + "),
          target: t.unitName,
          mitSpell,
          mitPct: String(mitPct),
          betterTarget: betterTargetName,
          ...(duringExternal ? { duringExternal } : {}),
        },
      });
    }
    bimTrace.forEach((rec) => traceDecision(rec));
  }

  // off-target-in-window: RETIRED from the menu 2026-08-19 (user ruling
  // 2026-08-18: 集火程度要算全队的,算一个人的没有意思). Measured grounds
  // (GH #16/#17): 88.9% incidence / 4.03 per round with NO cap — the noisiest
  // candidate in the system; per-person exclusivity over 36s-median windows
  // that overlap another enemy's 80.3% of the time (37% fully covered)
  // produced 495 mutually-contradictory accusation pairs in n=300, and the
  // 50% threshold sat at p72 of a knee-less slope. The team-level replacement
  // is the [KILL ATTEMPTS] block's per-attempt team-focus share plus the
  // attempt-into-trinket candidate. Retirement follows the momentSnapshot
  // precedent — assembly unplugged here; `auditWindowTargeting` and
  // `ON_TARGET_GOOD_PCT` stay exported (BurstLedgerCard's 窗口目标纪律 section
  // still renders the per-window rows), and deepDive/findingDisplay keep
  // their branches so pre-retirement cached findings still render.

  // juked-kick 退役(2026-08-19,GH #15,用户裁定;照 off-target-in-window
  // 先例摘发射)。检测本身经实测无罪:601 条 juke 判定的 (读条起手→打断)
  // 间隔中位 1.0s、75% 在 2s 内 —— 是真实的反应链。下架理由是概念性的:
  // 检测全对也只能产出「你被假读条骗了」,2026-07-19 盲评 2.9/5(五类唯一
  // 低于 3.5),建议不可执行。analyzeKickAudit 纯函数与 kickAudit.test 保留
  // (kick 审计统计表仍在渲染);legend/findingDisplay 分支保留(退役前的
  // 缓存 findings 仍要能渲染)。

  // dr-clipped-cc 退役(GH #17,用户裁定 2026-08-20,v31;照 juked-kick #15
  // 先例摘发射)。判据集 WASTED_DR_LEVELS = {"25%","Immune"} 无合法定义域:
  // 25% 档 12.0 已从游戏移除,Immune 档按 drAnalysis.ts:325 的契约不该出现
  // 在 outgoing 路径,实测两轮出面事件却全是带真实时长(0.1–3.4s)的
  // Immune 标注 —— 链窗模型与服务器 DR 窗口错位的解析伪影,判别力亦反向
  // (−1.6)。legend/findingDisplay/deepDive 分支保留(缓存 findings 仍要能
  // 渲染);同一伪影谓词的另一消费方(drAnalysis 的 hasWastedApplications
  // → CC Chains "hit immune" 提示)同批删除。

  return out;
}
