/* eslint-disable no-console */
/**
 * promptQualityCheck.ts
 *
 * Deterministic prompt-quality checks against the ground-truth coverage
 * manifests written by buildHealerPromptCorpus.ts. This replaces the LLM judge
 * for the mechanically checkable half of the rubric:
 *
 *   - sufficiency (coverage): every friendly death, and the bulk of CC /
 *     interrupt / dispel / trinket events present in the raw log, must be
 *     visible in the prompt text. The judge cannot see what the builder
 *     dropped — this check can, because the manifest is built from raw parser
 *     events, not from the prompt builder.
 *   - noise: measured duplicate-line ratios and known spam patterns.
 *   - labelBias: severity-lexicon hits with line numbers.
 *
 * It reports MEASURED METRICS only — never 1–5 rubric scores (see the Eval
 * Integrity section of AGENTS.md). The LLM judge stays responsible for the
 * dimensions that need judgment (outcomeAlignment, focusCalibration, …) and
 * reads this tool's output instead of guessing sufficiency/noise on its own.
 *
 * Usage:
 *   npm run -w @gladlog/eval quality
 *   BASE_DIR=packages/tools/local-batch/healer-eval/ab-test/treatment \
 *     npm run -w @gladlog/eval quality
 *   STRICT=1 …   # exit 1 if any friendly death is missing from its prompt
 *
 * Expects under BASE_DIR: prompts/, manifests/, index.json.
 */

import {
  creditSpikesToWindows,
  DAMPENING_DOSE_PCT,
  DMG_SPIKE_THRESHOLD,
  droppableNoChangeResRows,
  ensureAnalysisData,
  GUARDIAN_SPIRIT_SAVE_WINDOW_S,
  NO_CREDITED_SPIKE_CLAUSE,
  PEAK_SPIKE_MARKERS,
  peakSpikePlacement,
  spikeWindowOverlapSeconds,
} from "@gladlog/analysis";
import {
  AIMED_CONTROL_LANDING_LEAD_MS,
  GROUND_CONTROL_FUSE_MS,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import {
  CD_WASTE_SHARED_COOLDOWN_NOTE,
  cdWasteSpellNames,
  distanceFact,
  POST_KICK_OTHER_REASON_HEAD,
} from "@gladlog/analysis/src/analysis/candidateFindings";
import {
  CD_HOARD_RESPONSE_S,
  parseSyncReadyCdEntry,
  SYNC_LOCK_ENDED_BY_ROUND_END,
  SYNC_READY_CD_YOURS,
  syncRowHasOwnerPart,
  syncRowNarrowedToOwnerPart,
} from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import {
  CYCLONE_SPELL_ID,
  isDamageImmuneControl,
} from "@gladlog/analysis/src/analysis/candidates/massDispel";
import { fmtFactNum } from "@gladlog/analysis/src/analysis/factFormat";
import {
  citableEventCount,
  findingsPromptHead,
  menuEventIdsOfPrompt,
} from "@gladlog/analysis/src/analysis/findingsCount";
import { parseBurstAnsweredLine } from "@gladlog/analysis/src/context/burstAnswered";
import {
  CC_USE_CAP,
  CC_USE_MIN_S,
  CC_USE_MIN_SHARE,
} from "@gladlog/analysis/src/context/ccUse";
import {
  PRESSED_DURING_ITEM_RE_SRC,
  PRESSED_DURING_NOTE_HEAD,
  PRESSED_DURING_NOTE_RE_SRC,
  stripPressedDuringNote,
} from "@gladlog/analysis/src/context/controlRejectedPresses";
import {
  FORCED_FOLLOWUP_CAP,
  FORCED_FOLLOWUP_MAX_GAP_S,
  forcedFollowUpDurOk,
  forcedFollowUpGapOk,
  renderedInsideSpan,
} from "@gladlog/analysis/src/context/forcedTrinket";
import {
  KIT_REFUSED_WHY_WORDS,
  KIT_UNUSED_NOTE_RE_SRC,
} from "@gladlog/analysis/src/context/kitUnusedNote";
import {
  dmgSpikeListLegend,
  parseDmgSpikesNotListed,
} from "@gladlog/analysis/src/context/matchTimelineSections";
import {
  PEEL_LOOKBACK_S,
  PEEL_MIN_USABLE_S,
} from "@gladlog/analysis/src/context/peelOptions";
import { REFUSAL_WHY_WORDS } from "@gladlog/analysis/src/context/spellOutcomeLines";
import {
  parseTopSourceEntries,
  TOP_SOURCE_LIST_RE,
} from "@gladlog/analysis/src/context/timelineHelpers";
import {
  CAST_REFUSED_OTHER_REASON,
  CAST_STOPPED_NEAR_TEXT,
  CAST_STOPPED_REFUSAL_WORDS,
  CAST_STOPPED_TAG,
} from "@gladlog/analysis/src/context/timelineSections/castStopped";
import { CC_NOT_LANDED_TAG } from "@gladlog/analysis/src/context/timelineSections/setup";
import {
  BACKLASH_AURA_CC_TYPE,
  backlashCcTag,
} from "@gladlog/analysis/src/data/backlashCc";
import {
  lookupBacklashPrior,
  lookupBacklashWorth,
} from "@gladlog/analysis/src/data/backlashDispelPrior";
import {
  lookupBehaviorPrior,
  outcomePhrase,
} from "@gladlog/analysis/src/data/behaviorPrior";
import {
  BURST_REF_MIN_CONTRAST_PP,
  burstRefClearsMinContrast,
  burstRefContrastPp,
  lookupBurstWindowPrior,
} from "@gladlog/analysis/src/data/burstWindowPrior";
import { CANDIDATE_TYPE_REGISTRY } from "@gladlog/analysis/src/data/candidateTypeRegistry";
import { lookupCdTriggerPrior } from "@gladlog/analysis/src/data/cdTriggerPrior";
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import { FORM_COOLDOWN_BUFF_BY_CAST_ID } from "@gladlog/analysis/src/data/druidForms";
import { lookupKickPriorityPrior } from "@gladlog/analysis/src/data/kickPriorityPrior";
import { ATTEMPT_INTO_TRINKET_OUTCOME_REF } from "@gladlog/analysis/src/data/outcomeRefs";
import {
  getEnglishSpellName,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import {
  lookupSyncWindowPrior,
  SYNC_REF_MIN_CONTRAST_PP,
  syncRefClearsMinContrast,
  syncRefContrastPp,
} from "@gladlog/analysis/src/data/syncWindowPrior";
import {
  lookupTeammateCrisisPriorByBin,
  lookupTeammateCrisisTriageByBin,
  type TeammateCrisisDmgBin,
  teammateCrisisDmgBinOf,
} from "@gladlog/analysis/src/data/teammateCrisisPrior";
import {
  BURST_ALLY_OVERLAP_ITEM_RE_SRC,
  BURST_ALLY_OVERLAP_LABEL,
  BURST_TARGET_DAMAGE_RE_SRC,
  KILL_CREDIT_SLACK_S,
  ON_TARGET_GOOD_PCT,
} from "@gladlog/analysis/src/utils/burstLedger";
import {
  CC_MISS_TAG_WORD,
  CONTROL_FAILED_MISS_TYPES,
} from "@gladlog/analysis/src/utils/castMissRows";
import {
  CC_AVOIDED_RECAST_RE,
  CC_END_CAUSE_NOT_LOGGED,
  CC_ENDED_BY_LEAD,
  CC_FROM_OWN_TEAM_TAG,
  CC_LANDED_MATCH_WINDOW_MS,
  CC_LOGGED_END_NOTE_RE_SRC,
  CC_REFRESHED_LEAD,
  CC_REFRESHED_NOTE_RE_SRC,
  CC_STILL_ON_AT_ROUND_END,
  ccLandedMatchWindowMs,
  DEATH_BREAKABLE_CC_LOOKBACK_S,
  DEATH_BREAKABLE_CC_MIN_S,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { spanHoldsGhostSecond } from "@gladlog/analysis/src/utils/combatStates";
import {
  allyReachTalentNote,
  canHelpAnotherUnit,
  isHpTroughWorthPrinting,
  isSpikeHealedThrough,
  isTickBelowTrough,
  PRESS_HP_LINE_TAGS,
  PRESSURE_WINDOWS_TOP_N,
  REACTION_WINDOW_S,
  sharesChargePool,
} from "@gladlog/analysis/src/utils/cooldowns";
import { UNPURGED_FOR_RE_SRC } from "@gladlog/analysis/src/utils/dispelAnalysis";
import {
  deflectionNames,
  ENEMY_DEF_DEFLECTS_WORDS,
  ENEMY_DEF_END_NOT_LOGGED,
  ENEMY_DEF_END_NOT_LOGGED_SLOT_RE,
  ENEMY_DEF_IMMUNE_LABEL_RE_SRC,
  ENEMY_SAVE_EFFECT_BY_NAME,
  enemySaveEffectOfNote,
  ownWallLineNames,
  SAVE_AURA_END_UNSEEN_NAMES,
  schoolLimitedImmunityNames,
  selfSaveMechanismOfName,
  spanHoldsOwnWallSecond,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { DURING_ABSORBED_TAG_RE_SRC } from "@gladlog/analysis/src/utils/externalDamage";
import { FORCED_MOVE_TEXT } from "@gladlog/analysis/src/utils/forcedDisplacement";
import { parseEnemyCcKitLine } from "@gladlog/analysis/src/utils/healerExposureAnalysis";
import {
  CONTESTED_LINE_RE_SRC,
  contestedTailForm,
  contestedTailFormsOfName,
  VULNERABLE_OWNER_DAMAGE_RE_SRC,
} from "@gladlog/analysis/src/utils/healerOffenseAnalysis";
import {
  JUKE_LOOKBACK_MS,
  JUKED_BY_FAKE_HEAD,
} from "@gladlog/analysis/src/utils/kickAudit";
import {
  type IKillAttemptOwnControl,
  KILL_ATTEMPT_IMMUNITY_ALREADY_UP_NAME,
  KILL_ATTEMPT_OWN_CONTROL_LEAD,
  KILL_ATTEMPTS_ALREADY_UP_LEGEND,
  KILL_ATTEMPTS_OWN_CONTROL_LEGEND,
  killAttemptAlreadyUpFact,
  killAttemptBracketMeetsControl,
  killAttemptOwnControlClause,
} from "@gladlog/analysis/src/utils/killAttempts";
import { wallInHandKitNames } from "@gladlog/analysis/src/utils/killWindowTargetSelection";
import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import { STAYED_IN_NEAR_DEATH_PCT } from "@gladlog/analysis/src/utils/positionAnalysis";
import { INTERP_MAX_GAP_MS } from "@gladlog/analysis/src/utils/positionSampling";
import {
  fmtTime,
  parseWholeSeconds,
} from "@gladlog/analysis/src/utils/renderGrid";
import {
  AURA_STILL_UP_AT_ROUND_END,
  ROUND_ENDED_WORDS,
  roundEndLegend,
  SOLO_SHUFFLE_BRACKET,
} from "@gladlog/analysis/src/utils/roundEnd";
import {
  SELF_SAVE_PURPOSE_LABEL,
  selfDefensiveLabelWords,
  selfReductionLegend,
  statesSelfDefensiveLabel,
} from "@gladlog/analysis/src/utils/selfDefensiveMechanism";
import {
  PLACEHOLDER_RANGE_YD,
  RANGE_HITBOX_SLACK_YD,
} from "@gladlog/analysis/src/utils/spellRange";
import { SUMMON_KIND_RE_SRC } from "@gladlog/analysis/src/utils/summonKind";
import fs from "fs-extra";
import path from "path";

import type { IndexEntry } from "../corpus/buildCorpus";
import { CoverageManifest } from "./coverageManifest";

/** The single predicate for "a death-related line". The calibration's
 * removed-deaths perturbation and the sufficiency coverage gate here must use
 * the same regex — the moment the lines the perturbation deletes and the lines
 * the gate looks for drift apart, the calibration is measuring two different
 * things (a gate predicate IS the spec). */
export const DEATH_KEYWORDS = /death|died|dies|killed|\[DEATH\]/i;
const RES_READY_SPAM = /\[RES\] rdy:/;
const BIAS_LEXICON = [
  "[CRITICAL]",
  "[SPIKE]",
  "disastrous",
  "catastrophic",
  "critical failure",
  "fatal mistake",
  "terrible",
  "inexcusable",
  "panicked",
  "huge mistake",
  // GH #99 item 2 (2026-09-16): the retired verdict labels, as literal strings —
  // a bare "critical" would also match the "Critical burst" tier and never read 0.
  "⚠ CRITICAL",
  "⚠ Exposed",
  "Severe dampening",
  "severely compromised",
  "meaningfully impaired",
];

// The row shape of index.json is defined by buildCorpus (which writes that
// file); here we only consume it.

interface CoverageResult {
  present: number;
  total: number;
  missing: string[];
}

export interface MatchQuality {
  ordinal: number;
  matchId: string;
  spec: string;
  coverage: {
    friendlyDeaths: CoverageResult;
    ccSpells: CoverageResult;
    interruptSpells: CoverageResult;
    dispels: CoverageResult;
    trinketCasts: CoverageResult;
  };
  noise: {
    totalLines: number;
    approxTokens: number;
    exactDuplicateRatio: number;
    templateDuplicateRatio: number;
    resReadySpamLines: number;
  };
  labelBias: {
    hits: { term: string; count: number; sampleLines: number[] }[];
    totalHits: number;
  };
  hardFailures: string[];
}

interface NamedEvent {
  spellId: string | null;
  spellName: string | null;
  spellNameEn: string | null;
}

/** An event counts as covered if EITHER its logged (localized) name or its
 * canonical English name appears in the prompt — non-EN logs carry localized
 * names while the builder renders English from static data. */
export function checkSpells(
  promptText: string,
  events: NamedEvent[],
): CoverageResult {
  const distinct = new Map<string, string[]>();
  for (const e of events) {
    const candidates = [e.spellName, e.spellNameEn].filter(
      (n): n is string => !!n && n.length > 0,
    );
    if (candidates.length === 0) continue;
    distinct.set(e.spellId ?? candidates[0], candidates);
  }
  const missing: string[] = [];
  for (const [, candidates] of distinct) {
    if (!candidates.some((name) => promptText.includes(name))) {
      missing.push(candidates[candidates.length - 1]);
    }
  }
  return {
    present: distinct.size - missing.length,
    total: distinct.size,
    missing,
  };
}

/** Prompts never print the trinket spell name ("Gladiator's Medallion") — uses
 * are rendered as annotations like "trinketed", "trinket broke this CC", or a
 * "[TRINKET]" marker (status lines like "trinket: ON CD" are not uses). Count
 * use-annotation lines against the manifest's cast count. */
const TRINKET_USE =
  /trinketed|trinket broke|\[(ENEMY )?TRINKET\]|trinket:\s*used/i;

export function checkTrinkets(
  promptLines: string[],
  manifest: CoverageManifest,
): CoverageResult {
  const total = manifest.counts.trinketCasts;
  const mentions = promptLines.filter((l) => TRINKET_USE.test(l)).length;
  const present = Math.min(mentions, total);
  const missing =
    total > present
      ? [`${total - present} of ${total} trinket casts have no use annotation`]
      : [];
  return { present, total, missing };
}

export function checkFriendlyDeaths(
  promptLines: string[],
  manifest: CoverageManifest,
): CoverageResult {
  const friendlyDeaths = manifest.deaths.filter(
    (d) => d.reaction === "friendly",
  );
  const specByName = new Map(manifest.players.map((p) => [p.name, p.spec]));
  const missing: string[] = [];
  for (const death of friendlyDeaths) {
    // Prompts may reference the dead unit by short name ("Looß" from
    // "Looß-Tichondrius-US") or by unit-id + spec label ("1 (Discipline
    // Priest — friendly)") — accept either on a death-keyword line.
    const shortName = death.unitName.split("-")[0];
    const spec = specByName.get(death.unitName);
    const mentioned = promptLines.some(
      (line) =>
        DEATH_KEYWORDS.test(line) &&
        (line.includes(shortName) || (!!spec && line.includes(spec))),
    );
    if (!mentioned) missing.push(`${death.unitName} @ ${death.tRelSec}s`);
  }
  return {
    present: friendlyDeaths.length - missing.length,
    total: friendlyDeaths.length,
    missing,
  };
}

/**
 * Percentile tokens within one line, e.g.
 * `Marksmanship Hunter (n=87): p50 214k | p90 65k`. The number may carry a unit
 * suffix (k/m/s/%); tokens on the same line are only compared when their units
 * match.
 */
const PERCENTILE_TOKEN = /\bp(\d{1,2})\s+(-?\d+(?:\.\d+)?)(k|m|s|%)?/gi;

/**
 * Hard invariant: the percentile sequence within one line must be **monotonically
 * non-decreasing** (p50 ≤ p75 ≤ p90 ≤ p95).
 *
 * In the 2026-07-20 50-match eval, 11 matches showed inverted baselines
 * (`p50 214k | p90 65k`). Root cause: NaN entering the benchmarks sample pool,
 * after which `sort((a,b)=>a-b)` silently left the array unsorted. That class of
 * bug still emits "numbers that look fine" — only the ordering is wrong, which
 * is extremely hard for both the model and a human to spot, while this
 * deterministic check catches every instance without relying on any model
 * judgment.
 *
 * Per "a gate predicate IS the spec": this **re-parses the rendered prompt
 * text** rather than reading the analysis's internal objects. The criterion is
 * anchored on the exact characters the model actually reads.
 */
export function checkPercentileMonotonicity(lines: string[]): string[] {
  const violations: string[] = [];
  lines.forEach((line, i) => {
    const byUnit = new Map<string, { pct: number; value: number }[]>();
    for (const m of line.matchAll(PERCENTILE_TOKEN)) {
      const unit = (m[3] ?? "").toLowerCase();
      if (!byUnit.has(unit)) byUnit.set(unit, []);
      byUnit.get(unit)!.push({ pct: Number(m[1]), value: Number(m[2]) });
    }
    for (const [unit, tokens] of byUnit) {
      if (tokens.length < 2) continue;
      const seq = [...tokens].sort((a, b) => a.pct - b.pct);
      for (let k = 1; k < seq.length; k++) {
        if (seq[k].value < seq[k - 1].value) {
          violations.push(
            `line ${i + 1}: p${seq[k - 1].pct} ${seq[k - 1].value}${unit} > p${seq[k].pct} ${seq[k].value}${unit} — 百分位倒置: ${line.trim()}`,
          );
          break;
        }
      }
    }
  });
  return violations;
}

// "0:27–0:37  [DMG SPIKE]   2(SHunter) (Survival Hunter): 0.88M in 10s (…) (79% -> 29% HP, …)"
const SPIKE_HP =
  /^(\d+):(\d+)–(?:\d+):(?:\d+)\s+\[DMG SPIKE\]\s+(\S+)\s+\([^)]*\):.*?\((\d+)%\s*->\s*(\d+)%\s*HP/;
// "0:15  [YOU] [CD]   Holy Word: Chastise → 6(RPaladin) (68% HP)" — the
// class-C inline HP form
const INLINE_HP = /^(\d+):(\d+)\s+.*?→\s*(\S+)\s*\((\d+)%\s*HP/;
// Press lines — "[YOU] [CD] … → 6(RPaladin) (68% HP)", "[ENEMY DEF] … (at 28% HP)",
// "[ENEMY TRINKET] … (target at 31% HP)" — are NOT checked here: their HP is the
// HP at the press (analysis `hpAtPress`), the signed exception to the grid
// (user ruling 2026-09-30, triage A21). One list, exported by the analysis side.
const isPressHpLine = (line: string): boolean =>
  PRESS_HP_LINE_TAGS.some((tag) => line.includes(tag));
// "0:21  [STATE]   friends 1(HPriest):99 2(SHunter):76 / enemies 4(AWarrior):90"
const STATE_LINE = /^(\d+):(\d+)\s+\[STATE\]\s+(.*)$/;
/** Benign sampling jitter allowed, in percentage points. Anything above this is
 *  treated as two render paths contradicting each other. */
const HP_AGREEMENT_TOLERANCE_PP = 3;

/**
 * Hard invariant: for the same rendered second and the same unit, the HP claimed
 * by `[DMG SPIKE]` must agree with `[STATE]`.
 *
 * Measured on 2026-07-20: before the fix, 26/50 matches carried 33
 * contradictions (median 7pp, max 25pp). Root cause: STATE sampled on whole
 * seconds while DMG SPIKE sampled on fractional seconds, yet both rendered into
 * the same displayed second. Note the wrong turn taken earlier: the "unify the
 * sampling radius" fix moved not a single number — the radius only controls
 * accept/reject, it does not change which sample is picked. The criterion must
 * be anchored on the **rendered text** for the real effect to be measurable.
 *
 * Exception (user ruling 2026-09-30, triage A21 — hp-state F-R8 / enemy-def
 * F-E11): HP printed on a PRESS line (`PRESS_HP_LINE_TAGS`) is the HP at the
 * press, just before the press's own heal, and may legitimately differ from
 * the `[STATE]` tick of the displayed second (bd790c92 Bear Form: 8 % at the
 * press, 23 % on the grid). Those lines are skipped. The press ms is not
 * rendered, so the text cannot re-derive that number; the analysis-side
 * guarantee is `hpAtPress`'s own unit test. Without the exemption 43 press
 * lines of the 60 triage prompts would fail here.
 */
export function checkSameSecondHpConsistency(lines: string[]): string[] {
  const stateAt = new Map<number, Map<string, number>>();
  for (const line of lines) {
    const m = line.match(STATE_LINE);
    if (!m) continue;
    const units = new Map<string, number>();
    for (const u of m[3].matchAll(/(\S+?):(\d+)\b/g))
      units.set(u[1], Number(u[2]));
    stateAt.set(Number(m[1]) * 60 + Number(m[2]), units);
  }

  const violations: string[] = [];
  lines.forEach((line, i) => {
    // [DMG SPIKE]'s "X% -> Y% HP" (class A) and the inline "→ target (X% HP)"
    // (class C) are two rendered forms of the same invariant and share one
    // criterion. Press lines are exempt (see above).
    let m: RegExpMatchArray | null = null;
    let label = "行内嵌";
    if (line.includes("[DMG SPIKE]")) {
      m = line.match(SPIKE_HP);
      label = "[DMG SPIKE]";
    } else if (isPressHpLine(line)) {
      return;
    } else {
      m = line.match(INLINE_HP);
      label = "行内嵌";
    }
    if (!m) return;
    const t = Number(m[1]) * 60 + Number(m[2]);
    const stateHp = stateAt.get(t)?.get(m[3]);
    if (stateHp === undefined) return;
    const claimed = Number(m[4]);
    const delta = Math.abs(stateHp - claimed);
    if (delta > HP_AGREEMENT_TOLERANCE_PP) {
      violations.push(
        `line ${i + 1}: ${m[1]}:${m[2]} ${m[3]} — ${label} 报 ${claimed}% 而同秒 [STATE] 报 ${stateHp}%(Δ${delta}pp)`,
      );
    }
  });
  return violations;
}

// "… [UNNECESSARY — no pressure: target Name-Realm at 90% HP, no damage spike …]"
const UNNECESSARY_NOTE_HP =
  /\[UNNECESSARY — no pressure: target .+? at (\d+)% HP/;
// "… [CD]   Barkskin (self: 71% HP, …)" — the self-cast form of a press line
const SELF_PRESS_HP = /\(self: (\d+)% HP/;

/**
 * Hard invariant: one press line carries ONE reading of its target's HP. The
 * `→ X (N% HP …)` / `(self: N% HP …)` of a `[CD]` line and the `at N% HP`
 * inside its `[UNNECESSARY — …]` note both come from the analysis-side
 * `hpAtPress` of the same cast (hp-state F-R8 and its 2026-10-01 extension),
 * through two call sites: the timeline helper looks the target up by name
 * with the cooldown's id, the ledger by GUID with the cast's own id. The
 * press line is exempt from `checkSameSecondHpConsistency` (the press ms is
 * not rendered), so this is the text check that is still possible: the two
 * numbers on the line must be equal. Before the extension the note was the
 * `[STATE]` grid reading and could disagree with the press reading next to
 * it (review 2026-10-02: a 75 % press under a 90 % note). A teammate's
 * `[TEAM] [CD]` line prints only the note and is not checked here.
 */
export function checkUnnecessaryNoteHpAgreement(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const note = line.match(UNNECESSARY_NOTE_HP);
    if (!note) return;
    const inline = line.match(INLINE_HP)?.[4] ?? line.match(SELF_PRESS_HP)?.[1];
    if (inline === undefined) return;
    if (Number(inline) !== Number(note[1]))
      failures.push(
        `line ${i + 1}: 同一按键行两个目标血量不一致 — 行内 ${inline}% 而 [UNNECESSARY] 注记 ${note[1]}%: ${line.trim().slice(0, 160)}`,
      );
  });
  return failures;
}

// "2:57–3:15 (19s)" — window endpoints + labelled duration. A decimal label
// ("0:34–0:38 (4.3s)") is matched too (2026-09-25): the integer-only regex
// let 579 [STACKED DEFENSIVES] labels that disagreed with their endpoints
// pass unchecked.
const WINDOW_SPAN = /(\d+):(\d+)–(\d+):(\d+)\s*\((\d+(?:\.\d+)?)s\)/g;

/**
 * Hard invariant: a window's labelled duration must equal the difference of its
 * displayed endpoints.
 *
 * Classes E/G of the 2026-07-20 eval, "window duration doesn't add up":
 * `2:57–3:15 (19s)` — subtracting the displayed timestamps gives 18s while the
 * label says 19s (the label was taken from the un-rounded raw value). The
 * rendered text must be self-consistent, or the same token can be read as two
 * different numbers.
 */
export function checkWindowSpanConsistency(lines: string[]): string[] {
  const violations: string[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(WINDOW_SPAN)) {
      const from = Number(m[1]) * 60 + Number(m[2]);
      const to = Number(m[3]) * 60 + Number(m[4]);
      const labelled = Number(m[5]);
      if (to - from !== labelled) {
        violations.push(
          `line ${i + 1}: ${m[1]}:${m[2]}–${m[3]}:${m[4]} 相减为 ${to - from}s,却标注 (${labelled}s)`,
        );
      }
    }
  });
  return violations;
}

// "  [1:53] X died — Y had Ironbark available, caster was free"
// "  [2:21] Frost Mage (N) — had Ice Block available, was not CC'd"
const MISSED_OPTION = /^\s*\[(\d+):(\d+)\].*?\bhad ([A-Za-z' :]+?) available/;
// "      [RES] rdy:…  cd:Ironbark(48s),Stampeding Roar(91s),2:Icebound Fortitude(42s)  enemy:…"
// Teammate entries carry an "N:" prefix and charge entries a "[1/2]" suffix;
// both must be stripped.
const RES_CD_BLOCK = /\[RES\].*?\bcd:(\S(?:.*?))(?:\s{2,}|$)/;
/** Ledger entry: optional "N:" ownership prefix (captured) + spell name. No
 *  prefix = it belongs to the log owner. */
const CD_ENTRY = /(?:^|,)\s*(?:(\d+):)?([A-Za-z' :]+?)\s*\(/g;
/** Timestamped line: "1:53  [DEATH] …" */
const LEADING_TIME = /^(\d+):(\d+)\s/;
/** Roster line: '  <unit id="2" name="Ëxørçïsm-Tichondrius-US" spec="…" role="…">' */
const ROSTER_UNIT = /<unit\s+id="(\d+)"\s+name="([^"]+)"/;
/** The two sentence forms of the claimant — names contain non-ASCII characters
 *  and apostrophes (Øxý, Kel'Thuzad), so do not use ASCII character classes. */
const OWNER_DIED_FORM = /\bdied\s*—\s*(\S+)\s+had\b/;
const OWNER_SELF_FORM = /\(([^)]+)\)\s*—\s*had\b/;

/** Roster: character name → numeric id, plus the log owner's id (prefix-less
 *  ledger entries belong to them). */
function parseRoster(lines: string[]): {
  idByName: Map<string, string>;
  ownerId: string | null;
} {
  const idByName = new Map<string, string>();
  let ownerId: string | null = null;
  for (const line of lines) {
    const m = line.match(ROSTER_UNIT);
    if (!m) continue;
    idByName.set(m[2], m[1]);
    if (/role="log owner"/.test(line)) ownerId = m[1];
  }
  return { idByName, ownerId };
}

/**
 * Hard invariant: a cooldown that `DEATHS WITH MISSED OPTIONS` claims was
 * "available" must not simultaneously appear in the `cd:` (on-cooldown) list of
 * the `[RES]` ledger for the same instant.
 *
 * Measured on 2026-07-20 (ord 041): a death at 1:53 where the ledger said
 * `cd:Ironbark(7s)` while MISSED OPTIONS said "had Ironbark available". Root
 * cause: two independently maintained cooldown values for the same spell —
 * `deathOutcomeAnalysis`'s private table said 45s vs the main path's parsed 65s
 * (see the root-cause comment in that file). Fixed by a shared parser; this gate
 * prevents a regression.
 *
 * **The check must carry ownership** (correction from the 2026-07-20 full-corpus
 * audit): the `N:` prefix on a ledger entry says whose spell it is, and an early
 * implementation stripped it and compared by spell name alone — so in a mirror
 * comp (two Paladins on one team) player A's Divine Shield being on cooldown
 * would flag "player B has Divine Shield available" as a contradiction. 6 of the
 * 9 reports over the full corpus came from exactly this (67% false positives).
 * The missed-option line carries a character name while the ledger carries a
 * numeric id; the two are aligned through the roster. When ownership cannot be
 * determined, **report nothing** — a gate that cannot hold its ground is worse
 * than no gate.
 */
export function checkCooldownLedgerConsistency(lines: string[]): string[] {
  const { idByName, ownerId } = parseRoster(lines);

  // The set of on-cooldown spells (with ownership) for each [RES] line, located
  // by the nearest timestamped line above it.
  const onCooldownAt: { atSeconds: number; owned: Set<string> }[] = [];
  let currentSeconds: number | null = null;
  for (const line of lines) {
    const t = line.match(LEADING_TIME);
    if (t) currentSeconds = Number(t[1]) * 60 + Number(t[2]);
    const res = line.match(RES_CD_BLOCK);
    if (!res || currentSeconds === null) continue;
    const owned = new Set<string>();
    for (const e of res[1].matchAll(CD_ENTRY)) {
      // No prefix = the log owner's own cooldown
      const who = e[1] ?? ownerId;
      // Roster missing and entry has no prefix → ownership unknown, excluded
      if (!who) continue;
      owned.add(`${who}|${e[2].trim()}`);
    }
    onCooldownAt.push({ atSeconds: currentSeconds, owned });
  }

  const violations: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(MISSED_OPTION);
    if (!m) return;
    const claimant =
      line.match(OWNER_DIED_FORM)?.[1] ?? line.match(OWNER_SELF_FORM)?.[1];
    const claimantId = claimant ? idByName.get(claimant) : undefined;
    if (!claimantId) return; // whose spell it is cannot be determined → no report
    const at = Number(m[1]) * 60 + Number(m[2]);
    const spell = m[3].trim();
    // The nearest ledger entry at or before this instant
    let nearest: (typeof onCooldownAt)[number] | undefined;
    for (const entry of onCooldownAt) {
      if (entry.atSeconds > at) continue;
      if (!nearest || entry.atSeconds > nearest.atSeconds) nearest = entry;
    }
    if (nearest?.owned.has(`${claimantId}|${spell}`)) {
      violations.push(
        `line ${i + 1}: ${m[1]}:${m[2]} 声称 ${claimant} 的 "${spell}" available,但同时刻 [RES] 台账把它列在 cd: 中`,
      );
    }
  });
  return violations;
}

// "  - key=p1 kind=hp-snap facts={t0=10, t1=20, unit=Foo, role=owner, hpStart=80}"
// buildDeepDivePrompt's exact item-line rendering (deepDive.ts): `key=`/`kind=`
// are unquoted tokens, `facts={...}` is a `, `-joined `k=v` list. Values never
// contain a literal ", " themselves — enumerated lists (cd-ledger's ready/onCd)
// join with the Chinese enumeration comma "、" for exactly this reason — so
// splitting the facts block on ", " is safe.
const SNAPSHOT_ITEM_LINE =
  /^\s*-\s*key=(\S+)\s+kind=(\S+)\s+facts=\{(.*)\}\s*$/;

interface SnapshotItem {
  key: string;
  kind: string;
  facts: Record<string, string>;
}

export function parseFactsBlock(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const token of raw.split(", ")) {
    const eq = token.indexOf("=");
    if (eq < 0) continue;
    out[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return out;
}

/**
 * 18th hardFailure class (2026-09-16, confirmatory A/B of GH #78/#80): the
 * `facts={k=v, …}` invariant stated above — no value may contain a literal
 * ", " — is enforced, not assumed. Every text-side consumer of a menu or
 * snapshot line (this gate's `parseFactsBlock`, `interpolateResponses.ts`,
 * `baselineFindings.ts`) splits on ", ", so a comma inside a value is silently
 * cut off at the first parser and the placeholder renders truncated. Measured
 * before the producers were fixed: `kick-eaten` `postKick` 13/40 prompts
 * ("(Fade, instant or channel)" → "(Fade") and `missed-cleanse`
 * `ownerCastingSpells` 2/40 ("Mind Control, Mind Blast" → "Mind Control"),
 * identical in both arms — two of the run's 13 judge-refuted claims were this
 * artifact, not responder errors. A token without "=" after the split is the
 * fingerprint of the defect, so that is what is flagged.
 */
export function checkFactsBlockIntegrity(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/facts=\{(.*)\}\s*$/);
    if (!m) continue;
    for (const token of m[1]!.split(", ")) {
      if (/^[A-Za-z_][\w$]*=/.test(token)) continue;
      failures.push(
        `line ${i + 1}: facts 值内含 ", "(文本侧解析会截断)—— 碎片 "${token}"`,
      );
    }
  }
  return failures;
}

function parseSnapshotItems(lines: string[]): SnapshotItem[] {
  const items: SnapshotItem[] = [];
  for (const line of lines) {
    const m = line.match(SNAPSHOT_ITEM_LINE);
    if (!m) continue;
    items.push({ key: m[1], kind: m[2], facts: parseFactsBlock(m[3]) });
  }
  return items;
}

/**
 * Hard invariant (moment deep-dive, SDD 2026-08-05 Task 3): a moment snapshot
 * (`kind=hp-snap` / `kind=cd-ledger`) must not contradict the event-driven
 * items sharing the same deep-dive prompt.
 *
 *  - HP agreement: `kind=hp-snap`'s `hpStart`@`t0` / `hpEnd`@`t1` and any
 *    `kind=hp`'s `hp`@`t` are two independently-collected readings of the same
 *    (rendered second, role, unit) fact — same invariant as
 *    `checkSameSecondHpConsistency`, same shared tolerance
 *    (`HP_AGREEMENT_TOLERANCE_PP`; the brief for this check explicitly forbids
 *    re-writing that "3" as a new literal). Keyed on `t|role|unit`, not just
 *    `t|unit` (2026-08-05 final-review I-4 fix): `unit` is the realm-stripped
 *    short name, so a mirror comp can have the same short name on both teams;
 *    `role` (owner/teammate/enemy) separates them. As a further guard, if the
 *    SAME kind reports two different HP values for one `t|role|unit` key —
 *    itself only possible when "unit" is secretly two different real players
 *    — that key is flagged ambiguous and skipped entirely rather than
 *    compared cross-kind (a name collision is textually indistinguishable
 *    from a real inconsistency once the realm suffix is stripped, so this
 *    check declines to guess).
 *  - Cooldown agreement: `kind=cd-ledger`'s `ready` list for a unit must not
 *    be contradicted by a `kind=immunity-available` (checked against `unit`)
 *    or `kind=external-available` (checked against `holder` — the party
 *    claimed to have had the spell ready, not the dying player) claiming that
 *    same unit's spell was available — those two kinds and the ledger both
 *    ultimately read off `cdAvailableAt` (see momentSnapshot.ts /
 *    deathOutcomeAnalysis.ts), so a mismatch means the two collection passes
 *    disagree about the same cooldown state. Compared only when both facts
 *    blocks render the same whole second (2026-08-05 final-review I-3 fix):
 *    cd-ledger samples at the snapshot window's midpoint while
 *    immunity/external-available are judged at the death/event instant, up to
 *    ~10s apart, during which the spell can genuinely change cooldown state —
 *    a unit with no cd-ledger reading at that exact second is skipped rather
 *    than compared against a ready-set sampled at a different time.
 *
 * Returns `[]` when the prompt carries no item lines at all — pre-Task-1/2
 * prompts have no `key=`/`kind=`/`facts=` lines to match, so this is a
 * structural no-op on them, not a special case.
 */
/**
 * 第七类 hardFailure(GH #28,2026-08-22 用户报):prompt 不许在**队友**的死亡处
 * 印一条「你有 X 没用」,而 X 根本够不着那个队友。
 *
 * 用户原话:「我玩牧师,绝望祷言全场没用,然后我队友生命垂危的时候我应该用 ——
 * 这技能只能给自己加血。」kill sequence 段的相关性规则当时是
 * `isDyingPlayer || isExternal || isHealerSpec(player.spec)`,中间那项是死代码
 * (没有任何技能带 External tag),于是「治疗的每一个防御 CD」都会被印在任何一个
 * 队友的死亡前一秒。
 *
 * 判据与产品同源:`canHelpAnotherUnit`(analysis 侧的官方 targeting 谓词)。
 * 这里按 CLAUDE.md「把判据做成门里的确定性文本检查」重新在**渲染出来的文本**上
 * 验一遍 —— 分析侧改对了但渲染层又漏一条的情况,只有这样才拦得住。
 *
 * 名字查不到 id 的行一律跳过(不能证实的不报),死者行找不到也跳过。
 */
/** `1:10  [DEFENSIVE AVAILABLE]  1(HPriest): Desperate Prayer available but unused` */
const DEFENSIVE_AVAILABLE =
  /\[DEFENSIVE AVAILABLE\]\s+(\S+?):\s+(.+?) available but unused/;
/** `1:11  [KILL]  2(WMonk) (Windwalker Monk) dead` */
const KILL_LINE = /\[KILL\]\s+(\S+)\s.*dead/;
/** 技能名 → id(prompt 里印的是 classMetadata 的英文名) */
const DEFENSIVE_ID_BY_NAME = new Map<string, string>(
  classMetadata.flatMap((c) =>
    c.abilities.map((a) => [a.name, a.spellId] as const),
  ),
);

/**
 * [DMG SPIKE] 行的「敌方 CC 掩护」标注一致性 —— 第八类 hardFailure(2026-08-26)。
 *
 * 标注(`| enemy CC in window: Spell→who@M:SS (Xs)`)在生产端与 [CC ON TEAM] 行
 * 同源(同一个 ccTrinketSummaries 数组对象),**今天**不可能分叉;这道门防的是
 * 未来漂移 —— 逐行探针报告(2026-08-26)的植入实验证明模型对 prompt 里写出来的
 * 话照单全收、0/100 察觉内部矛盾,所以新事实进 prompt 必须配确定性门(报告建议 R5)。
 * 判据:标注里的每个 (spell, 渲染时刻) 都必须能在某条 [CC ON TEAM] 行找到 ——
 * 时刻用同一个 fmtTime 渲染,故按字符串比对即可。方向是单向的(只验正向断言;
 * 「no enemy CC in window」的反向验证需要解析 CC 时长,暂不做,注记在此)。
 */
export function checkDmgSpikeCcCoverConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("[DMG SPIKE]") || !line.includes("enemy CC in window:"))
      continue;
    const seg = line.split("enemy CC in window:")[1] ?? "";
    for (const m of seg.matchAll(/([^,:]+?)\u2192[^@,]+@(\d+:\d\d)/g)) {
      const spell = m[1].trim();
      const at = m[2];
      const ok = lines.some(
        (l) =>
          l.trimStart().startsWith(at) &&
          l.includes("[CC ON TEAM]") &&
          // FT-T16: not the owner's `pressed during it:` clause — it names
          // the owner's cooldowns, not the control on the line
          stripPressedDuringNote(l).includes(spell),
      );
      if (!ok)
        failures.push(
          `line ${i + 1}: [DMG SPIKE] CC 掩护标注引用 ${spell}@${at},但没有任何 [CC ON TEAM] 行与之对应`,
        );
    }
  }
  return failures;
}

/**
 * 9th hardFailure class (GH #36 item 5, 2026-08-27): the `— healed through`
 * outcome word on a `[DMG SPIKE]` line is the labelBias patch (three
 * independent judge batches, 2026-07-15) and is derived from the SAME two HP
 * samples the line prints (`(A% -> B% HP`). Micro-gate: word present ⟺
 * B − A ≥ 0. Guards refactor drift between the word and the numbers it
 * summarises; two-sided (a missing word on a non-negative delta is as much a
 * drift as a stray word on a negative one). Lines without the HP pair are
 * out of scope (the render site emits neither).
 */
/**
 * Trough half (2026-09-15, first Opus 5 baseline — 73/309 prompts read
 * `81% -> 87% HP — healed through` while the unit's own `[STATE]` tick inside
 * the window read 37%): the renderer now prints `, low N% @m:ss` instead of
 * the word whenever `isHpTroughWorthPrinting(A, B, min)` holds for the window's
 * minimum.
 *
 * FT-T03 (user ruling 2026-10-10, D7): that minimum is a TROUGH now —
 * `hpTroughInWindow`, the true minimum of every sample inside the displayed
 * seconds, not the lowest whole-second tick — so "the tick of the printed
 * second equals N" is no longer true and is no longer asked (141470d0: the
 * tick at 4:15 reads 33, the low inside that second is 6). What the text
 * still certifies, deterministically, because every `[STATE]` tick of the
 * window is part of the trough's minimum (`isTickBelowTrough`):
 *   - a printed `low N%` must satisfy the predicate, sit inside the window,
 *     not on a second that unit's tick reads `dead`, and no tick inside the
 *     window may read below N (the endpoints A / B are covered by the
 *     predicate itself: N is 10+ points under both);
 *   - with no `low` printed, no tick inside the window may satisfy the
 *     predicate (the trough is at or below that tick, so the renderer would
 *     have printed it).
 * The reverse ("a trough exists at a second no tick shows") is invisible in
 * the text by construction and is not adjudicated here. The word ⟺ Δ ≥ 0
 * half above also requires "and no trough".
 */
const SPIKE_OUTCOME =
  /^(\d+):(\d+)–(\d+):(\d+)\s+\[DMG SPIKE\]\s+(\S+)\s.*?\((\d+)% -> (\d+)% HP([^)]*)\)/;
const SPIKE_LOW = /, low (\d+)% @(\d+):(\d+)/;
export function checkHealedThroughConsistency(lines: string[]): string[] {
  const ticks: Array<{ s: number; hp: Map<number, number> }> = [];
  /** second → units a `dead` tick names (a printed low there is no low) */
  const deadAt = new Map<number, Set<number>>();
  for (const line of lines) {
    const st = line.match(STATE_LINE);
    if (!st) continue;
    const hp = new Map<number, number>();
    const s = Number(st[1]) * 60 + Number(st[2]);
    for (const tok of st[3]!.matchAll(STATE_TOKEN)) {
      const v = tok[2]!;
      if (v === "dead") {
        if (!deadAt.has(s)) deadAt.set(s, new Set());
        deadAt.get(s)!.add(Number(tok[1]));
      } else if (v !== "ghost") hp.set(Number(tok[1]), Number(v));
    }
    ticks.push({ s, hp });
  }

  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes("[DMG SPIKE]")) return;
    const pair = line.match(/\((\d+)% -> (\d+)% HP([^)]*)\)/);
    if (!pair) return;
    const A = Number(pair[1]);
    const B = Number(pair[2]);
    const tail = pair[3]!;
    const delta = B - A;
    // Whole line, not just the HP tail: a stray word anywhere on the line is
    // the drift this gate exists for (and what its pre-trough tests pin).
    const hasWord = line.includes("— healed through");
    const low = tail.match(SPIKE_LOW);
    const at = `line ${i + 1}: [DMG SPIKE]`;
    if (hasWord && delta < 0)
      failures.push(
        `${at} 标注「healed through」但同行 HP ${A}% -> ${B}%(Δ${delta} < 0)`,
      );
    if (hasWord && low)
      failures.push(`${at} 同时标注「healed through」和 low ${low[1]}%`);
    // T12 ① c: a window that ends at 0 % ended on a death (the renderer
    // prints 0 for a unit `dead` at the end second) — never "healed through",
    // whatever the delta (`0% -> 0%` for a bucket opened in the death second).
    if (hasWord && B === 0)
      failures.push(`${at} 标注「healed through」但终点 HP 为 0%(死亡)`);
    // the renderer's own predicate, so the two-sided rule cannot drift
    if (!hasWord && isSpikeHealedThrough(A, B, Boolean(low)))
      failures.push(
        `${at} 同行 HP ${A}% -> ${B}%(Δ${delta} ≥ 0)却没有「healed through」标注`,
      );

    // Legacy shape without the window prefix / unit token stops here.
    const m = line.match(SPIKE_OUTCOME);
    const unitId = m ? Number(m[5]!.match(/^\d+/)?.[0]) : NaN;
    if (!m || Number.isNaN(unitId)) return;
    const from = Number(m[1]) * 60 + Number(m[2]);
    const to = Number(m[3]) * 60 + Number(m[4]);
    // Both ends are the `[STATE]` tick of their second as a number
    // (`gridEndpointHpPct`): on a second that unit's tick reads `dead` the
    // endpoint is 0 %. The end has read so since T12 ① c; the start since
    // 2026-10-11 (a bucket opened in its victim's death second printed the
    // last pre-death sample: `60% -> 0% HP`). A numeric tick at the start
    // second is `checkSameSecondHpConsistency`'s; it does not read `dead`.
    if (deadAt.get(from)?.has(unitId) && A !== 0)
      failures.push(
        `${at} 起点写 ${A}%,但 ${fmtTime(from)} 的 [STATE] 报 dead(应为 0%)`,
      );
    if (deadAt.get(to)?.has(unitId) && B !== 0)
      failures.push(
        `${at} 终点写 ${B}%,但 ${fmtTime(to)} 的 [STATE] 报 dead(应为 0%)`,
      );
    const inWindow = ticks.filter(
      (t) => t.s >= from && t.s <= to && t.hp.has(unitId),
    );
    if (low) {
      const L = Number(low[1]);
      const lowS = Number(low[2]) * 60 + Number(low[3]);
      if (!isHpTroughWorthPrinting(A, B, L))
        failures.push(`${at} low ${L}% 不满足低谷判据(${A}% -> ${B}%)`);
      if (lowS < from || lowS > to)
        failures.push(
          `${at} low @${fmtTime(lowS)} 落在窗口 ${fmtTime(from)}–${fmtTime(to)} 之外`,
        );
      // same rule as the burst ledger's gate: a trough is never read on a
      // second the unit is `dead` at. The tick of the printed second is NOT
      // required to equal L any more (FT-T03) — only never to be below it,
      // like every other tick of the window.
      if (deadAt.get(lowS)?.has(unitId))
        failures.push(
          `${at} 标注 low ${L}% @${fmtTime(lowS)},但该秒 [STATE] 报 dead`,
        );
      for (const t of inWindow)
        if (isTickBelowTrough(t.hp.get(unitId)!, L))
          failures.push(
            `${at} 标注 low ${L}% 但 ${fmtTime(t.s)} [STATE] 报 ${t.hp.get(unitId)}%`,
          );
    } else {
      const tick = inWindow.find((t) =>
        isHpTroughWorthPrinting(A, B, t.hp.get(unitId)!),
      );
      if (tick)
        failures.push(
          `${at} ${A}% -> ${B}% 未标注低谷,但 ${fmtTime(tick.s)} [STATE] 报 ${tick.hp.get(unitId)}%`,
        );
    }
  });
  return failures;
}

// "  Burst #1 — 0:27–0:48 | Power Infusion + Voidform"
const BURST_HEAD = /^\s*Burst #\d+ — (\d+):(\d+)–(\d+):(\d+) \|/;
// "    Target: Cloudz-LaughingSkull-US 95% → 69% (low 39% at 0:38) | your damage 0.52M"
const BURST_TARGET_HP =
  /^\s*Target: (.+?) (\d+)% → (\d+)%(?: \(low (\d+)% at (\d+):(\d+)\))? \| your damage/;

/**
 * Hard invariant: the burst ledger's `Target: X A% → B% (low L% at m:ss)`
 * line agrees with the `[STATE]` ticks of the seconds its `Burst #` header
 * prints (triage 2026-09-29, group G15: hp-state F-B1, sync-burst F-L5 /
 * F-L5b, hp-state F-N5).
 *
 * Before: the endpoints were sampled at the raw cast / span-end millisecond,
 * off the render grid — 115 of 142 ledger targets on the 60 triage rounds
 * disagreed with `gridHpPct` at the displayed second (537209d8: "95% → 62%"
 * beside a `[STATE]` 69 % at 0:48), and no low was printed at all
 * (69546267: "100% → 100%" over a 37 % low). The analysis side reads the
 * endpoints with `gridHpPct`, the `[STATE]` tick's own sampler, and the low
 * with `hpTroughInWindow` — the true minimum inside the displayed seconds
 * (FT-T03, user ruling 2026-10-10, D7; it was the lowest whole-second tick).
 * So the text certifies:
 *   - a tick for the target at the start / end second EQUALS A / B (a `dead`
 *     tick at the end second means B = 0) — point readings, unchanged;
 *   - a printed low satisfies `isHpTroughWorthPrinting(A, B, L)` — the one
 *     trough rule, shared with `[DMG SPIKE]` — sits inside the span, not on
 *     a second the target's tick reads `dead`, and no tick inside the span
 *     reads below it (`isTickBelowTrough`). The tick of the low's own second
 *     no longer has to equal it: a trough between two ticks is below both;
 *   - with no low printed, no tick inside the span satisfies the rule (the
 *     trough is at or below every tick, so it would have been printed).
 * A target the roster block does not name is not checked (no id to look
 * for). The reverse ("a trough at a second no tick shows") is invisible in
 * the text and is not adjudicated here — and since FT-T03 neither is a low
 * stamped at the wrong second of its span.
 */
export function checkBurstTargetHpConsistency(lines: string[]): string[] {
  const { idByName } = parseRoster(lines);
  const ticks = new Map<number, Map<string, number | "dead">>();
  for (const line of lines) {
    const st = line.match(STATE_LINE);
    if (!st) continue;
    const hp = new Map<string, number | "dead">();
    for (const tok of st[3]!.matchAll(STATE_TOKEN)) {
      const v = tok[2]!;
      if (v === "dead") hp.set(tok[1]!, "dead");
      else if (v !== "ghost") hp.set(tok[1]!, Number(v));
    }
    ticks.set(Number(st[1]) * 60 + Number(st[2]), hp);
  }

  const failures: string[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const head = lines[i]!.match(BURST_HEAD);
    if (!head) continue;
    // this burst's own `Target:` line: the first one before the next header
    // or the end of the block — not "the next line", so a line added between
    // the two cannot make the gate fail open
    let m: RegExpMatchArray | null = null;
    let targetLine = i + 1;
    for (; targetLine < lines.length; targetLine++) {
      const l = lines[targetLine]!;
      if (!l.trim() || BURST_HEAD.test(l)) break;
      m = l.match(BURST_TARGET_HP);
      if (m) break;
    }
    if (!m) continue;
    const id = idByName.get(m[1]!);
    if (id === undefined) continue;
    const from = Number(head[1]) * 60 + Number(head[2]);
    const to = Number(head[3]) * 60 + Number(head[4]);
    const A = Number(m[2]);
    const B = Number(m[3]);
    const at = `line ${targetLine + 1}: Burst Target ${m[1]}`;
    const tickAt = (s: number) => ticks.get(s)?.get(id);

    const startTick = tickAt(from);
    if (typeof startTick === "number" && startTick !== A)
      failures.push(
        `${at} 起点 ${A}% 而 ${fmtTime(from)} [STATE] 报 ${startTick}%`,
      );
    if (startTick === "dead" && A !== 0)
      failures.push(`${at} 起点 ${A}% 而 ${fmtTime(from)} [STATE] 报 dead`);
    const endTick = tickAt(to);
    if (typeof endTick === "number" && endTick !== B)
      failures.push(
        `${at} 终点 ${B}% 而 ${fmtTime(to)} [STATE] 报 ${endTick}%`,
      );
    if (endTick === "dead" && B !== 0)
      failures.push(`${at} 终点 ${B}% 而 ${fmtTime(to)} [STATE] 报 dead`);

    const inSpan: Array<{ s: number; hp: number }> = [];
    for (const [s, hp] of ticks) {
      const v = hp.get(id);
      if (s >= from && s <= to && typeof v === "number")
        inSpan.push({ s, hp: v });
    }
    if (m[4] !== undefined) {
      const L = Number(m[4]);
      const lowS = Number(m[5]) * 60 + Number(m[6]);
      if (!isHpTroughWorthPrinting(A, B, L))
        failures.push(`${at} low ${L}% 不满足低谷判据(${A}% → ${B}%)`);
      if (lowS < from || lowS > to)
        failures.push(
          `${at} low at ${fmtTime(lowS)} 落在 ${fmtTime(from)}–${fmtTime(to)} 之外`,
        );
      // a trough is never read on a second the unit is `dead` at; the tick
      // of the printed second need not equal it (FT-T03) — like every tick
      // of the span, it only must not be below it
      if (tickAt(lowS) === "dead")
        failures.push(
          `${at} 标注 low ${L}% at ${fmtTime(lowS)},但该秒 [STATE] 报 dead`,
        );
      for (const t of inSpan)
        if (isTickBelowTrough(t.hp, L))
          failures.push(
            `${at} 标注 low ${L}% 但 ${fmtTime(t.s)} [STATE] 报 ${t.hp}%`,
          );
    } else {
      const tick = inSpan.find((t) => isHpTroughWorthPrinting(A, B, t.hp));
      if (tick)
        failures.push(
          `${at} ${A}% → ${B}% 未标注低谷,但 ${fmtTime(tick.s)} [STATE] 报 ${tick.hp}%`,
        );
    }
  }
  return failures;
}

/** The burst ledger's `Target:` line: 1 = the target's name; the rest is
 * the producer's own tail pattern (`BURST_TARGET_DAMAGE_RE_SRC`). */
const BURST_TARGET_DAMAGE = new RegExp(
  String.raw`^\s*Target: (.+?)(?: \d+% → \d+%(?: \(low \d+% at \d+:\d+\))?)?` +
    BURST_TARGET_DAMAGE_RE_SRC,
);

/**
 * Hard invariant (T12 ⑤, user ruling 2026-10-10): the damage parts of a
 * burst ledger `Target:` line add up the way the line says they do.
 *
 *   - `(A of it absorbed)` is a part of `your damage`: A <= the figure;
 *   - `second target: X N` is the NEXT highest: N <= the target's figure
 *     (the target is the head of the same list), X is not the target, its
 *     own absorbed part is <= N, and N is at least `ON_TARGET_GOOD_PCT` % of
 *     the target's figure — the producer's rule (`burstSecondTargetClause`),
 *     read with the two printed figures' rounding (0.02M);
 *   - a `Target:` line with `| your damage` reads in the producer's pattern.
 *
 * Before: the line printed one figure (dfcccbf2 `your damage 0.70M` = 0.30M
 * landed + 0.40M absorbed) and no second enemy (0.67M on the warrior).
 */
export function checkBurstTargetDamageParts(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!/^\s*Target: /.test(line) || !line.includes(" | your damage ")) return;
    const at = `line ${i + 1}: Burst Target`;
    const m = line.match(BURST_TARGET_DAMAGE);
    if (!m) {
      failures.push(`${at} 的伤害子句无法解析:${line.trim().slice(0, 160)}`);
      return;
    }
    const damage = Number(m[2]);
    if (m[3] !== undefined && Number(m[3]) > damage)
      failures.push(
        `${at} ${m[1]}:absorbed ${m[3]}M 大于 your damage ${m[2]}M`,
      );
    if (m[4] === undefined) return;
    const second = Number(m[5]);
    if (m[4] === m[1])
      failures.push(`${at} ${m[1]}:second target 与 Target 是同一单位`);
    if (second > damage)
      failures.push(
        `${at} ${m[1]}:second target ${m[4]} ${m[5]}M 大于 Target 的 ${m[2]}M`,
      );
    if (second * 100 + 2 < damage * ON_TARGET_GOOD_PCT)
      failures.push(
        `${at} ${m[1]}:second target ${m[4]} ${m[5]}M 不到 Target ${m[2]}M 的 ${ON_TARGET_GOOD_PCT}%,不该印`,
      );
    if (m[6] !== undefined && Number(m[6]) > second)
      failures.push(
        `${at} second target ${m[4]}:absorbed ${m[6]}M 大于它的 ${m[5]}M`,
      );
  });
  return failures;
}

const BURST_ALLY_OVERLAP_LINE = new RegExp(
  String.raw`^\s*${BURST_ALLY_OVERLAP_LABEL}: (.+)$`,
);

/**
 * Hard invariant (T12 ⑦, user ruling 2026-10-10): a burst's ally-cooldown
 * line says what was measured — an overlap in time.
 *
 *   - no ledger line reads `Aligned with:` (the word the measurement does
 *     not carry: 24 of 85 burst × teammate pairs on 60 raw rounds had the
 *     teammate's damage mostly on another enemy);
 *   - every item of an `Ally CDs overlapping:` line reads in the producer's
 *     pattern (`BURST_ALLY_OVERLAP_ITEM_RE_SRC`): the seconds, and that
 *     ally's top target in them or the statement that there was none;
 *   - an overlap is no longer than the burst it is an overlap with: at most
 *     the header's displayed width + 1 s (the endpoints are floored).
 */
export function checkBurstAllyOverlap(lines: string[]): string[] {
  const failures: string[] = [];
  let burstWidth: number | null = null;
  lines.forEach((line, i) => {
    const head = line.match(BURST_HEAD);
    if (head) {
      burstWidth =
        Number(head[3]) * 60 +
        Number(head[4]) -
        (Number(head[1]) * 60 + Number(head[2]));
      return;
    }
    if (/^\s*Aligned with: /.test(line)) {
      failures.push(
        `line ${i + 1}: burst ledger 仍写「Aligned with」—— 量的只是时间重叠,应写 ${BURST_ALLY_OVERLAP_LABEL}`,
      );
      return;
    }
    const m = line.match(BURST_ALLY_OVERLAP_LINE);
    if (!m) return;
    const at = `line ${i + 1}: ${BURST_ALLY_OVERLAP_LABEL}`;
    const items = [
      ...m[1]!.matchAll(new RegExp(BURST_ALLY_OVERLAP_ITEM_RE_SRC, "g")),
    ];
    if (items.length !== m[1]!.split("; ").length) {
      failures.push(`${at} 有无法解析的条目:${line.trim().slice(0, 160)}`);
      return;
    }
    if (burstWidth === null) {
      failures.push(`${at} 之前没有 Burst # 行`);
      return;
    }
    for (const item of items)
      if (Number(item[1]) > burstWidth + 1)
        failures.push(
          `${at} 重叠 ${item[1]}s 超过所在 burst 的显示长度 ${burstWidth}s(+1s 取整余量)`,
        );
  });
  return failures;
}

const VULNERABLE_OWNER_DAMAGE = new RegExp(VULNERABLE_OWNER_DAMAGE_RE_SRC);

/**
 * Hard invariant (T12 ⑤): on a healer-view `[VULNERABLE]` line the owner's
 * damage on the window's target is a part of the team's damage on it —
 * `your damage on it N` <= `team damage M total` (same target, same measure,
 * the owner's span inside the team's).
 *
 * Before: `your damage` was the owner's damage on every enemy, absorbs
 * included — 78 lines of the 605 capture read `team damage 0k total` beside
 * a `your damage` above 0.
 */
export function checkVulnerableOwnerDamage(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(VULNERABLE_OWNER_DAMAGE);
    if (!m) return;
    if (Number(m[2]) > Number(m[1]))
      failures.push(
        `line ${i + 1}: [VULNERABLE] your damage on it ${m[2]}k 大于同一目标的 team damage ${m[1]}k total`,
      );
  });
  return failures;
}

const CONTESTED_LINE = new RegExp(CONTESTED_LINE_RE_SRC);

/**
 * A `[CONTESTED]` line states cast risk only for a control that has a cast
 * to interrupt (FT I12, user ruling 2026-10-11, option b). The producer
 * (`contestedTradeTail`) reads the named control's own cast id through the
 * official `interruptibleCastOf`: a cast bar or a channel carries `enemy
 * interrupts ready: N` and `AND carried cast risk`; an instant carries
 * neither and says `(instant: no cast to interrupt)`; a cast DB2 has no row
 * for claims neither. Every line said the first until then — 332 lines on
 * the 605-file capture, 193 of them naming an instant (Psychic Scream 84,
 * Holy Word: Chastise 25, Maim 16, Hammer of Justice 16, …).
 *
 * Read back from the rendered name through the producer's own index
 * (`contestedTailFormsOfName`: the same ids, the same predicate). Fails a
 * `[CONTESTED]` line that is not in the generated format to its end, and one
 * whose tail is a form no cast of that name can have.
 */
export function checkContestedCastRisk(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes("[CONTESTED]")) return;
    const m = line.match(CONTESTED_LINE);
    const form = m ? contestedTailForm(m[10]!) : null;
    if (!m || !form) {
      failures.push(
        `line ${i + 1}: [CONTESTED] 格式不符(整行必须按生成格式)—— ${line.trim().slice(0, 200)}`,
      );
      return;
    }
    const allowed = contestedTailFormsOfName(m[5]!);
    const ok = allowed.size === 0 ? form === "silent" : allowed.has(form);
    if (!ok)
      failures.push(
        `line ${i + 1}: [CONTESTED] ${m[5]} 按官方施法时间应为 ${allowed.size === 0 ? "silent" : [...allowed].join(" / ")},行尾写的是 ${form} —— ${line.trim().slice(0, 200)}`,
      );
  });
  return failures;
}

/** `<unit id="4" name="…" spec="…" role="enemy">` — the roster. */
const KIT_ROSTER_UNIT =
  /<unit\s+id="(\d+)"\s+name="([^"]+)"[^>]*role="([^"]+)"/;
/** A `[CC ON TEAM]` data line whose victim and source are roster labels:
 * 1 = the victim's id, 2 = the control, 3 = the id of the source player — or
 * of the owner of the summon that cast it (`… (by 4(BMHunter)'s pet)`). A
 * control reflected back names no source and is not read. */
const KIT_CC_ON_TEAM_LINE =
  /^\s*\d+:\d{2}\s+\[CC ON TEAM\]\s+(\d+)\([^()]*\) ← (.+?) \(by (\d+)\([^()]*\)(?:'s [^()]*)?\)/;

/**
 * The `ENEMY CC KIT` line and the `[CC ON TEAM]` lines are one list (FT R03,
 * user ruling 2026-10-11, option b — it reopens A17's "labels only"). The
 * producer (`formatEnemyCCKitHeader` given `landedControlsForKit`) appends
 * every control that landed on the kit's unit this round to the burst-window
 * threats and marks it `(landed N×)`; the count is read from the instances
 * the timeline prints its `[CC ON TEAM]` lines from, under the emitter's own
 * test (`rendersCcOnTeamLine`). Before, the line was the burst-window list
 * alone: 9,390 of the 28,816 controls that landed on its unit were not on it
 * (605-file capture, by spell name).
 *
 * Read back through the producer's `parseEnemyCcKitLine` and the roster:
 *  - a kit line that is not in the generated format, or that does not
 *    promise the landed controls;
 *  - an enemy on it that the roster does not list as an enemy;
 *  - both ways, per enemy player and control name: N `[CC ON TEAM]` lines on
 *    the kit's unit from that enemy (or its summon) ⟺ `(landed N×)` entries
 *    summing to N — a control that landed and is missing or miscounted, and
 *    a `landed` mark with no such lines, both fail;
 *  - an entry marked `(spec default, not seen)` beside a landed entry of the
 *    same control.
 */
export function checkEnemyCcKitLanded(lines: string[]): string[] {
  const failures: string[] = [];
  const kitAt = lines.findIndex((l) => l.startsWith("ENEMY CC KIT ("));
  if (kitAt < 0) return failures;
  const where = `line ${kitAt + 1}: ENEMY CC KIT`;
  const kit = parseEnemyCcKitLine(lines[kitAt]!);
  if (!kit || !kit.statesLanded)
    return [
      `${where} 格式不符(整行必须按生成格式,且写明 landed N×)—— ${lines[kitAt]!.slice(0, 200)}`,
    ];
  const idOfEnemyName = new Map<string, string>();
  let ownerId: string | undefined;
  for (const line of lines) {
    const u = line.match(KIT_ROSTER_UNIT);
    if (!u) continue;
    if (u[3] === "enemy") idOfEnemyName.set(u[2]!, u[1]!);
    if (u[3] === "log owner") ownerId = u[1]!;
  }
  const unitId = kit.healerLabel
    ? /^(\d+)\(/.exec(kit.healerLabel)?.[1]
    : ownerId;
  if (unitId === undefined)
    return [
      `${where} 所指单位在名册里找不到 —— ${lines[kitAt]!.slice(0, 160)}`,
    ];
  const enemyIds = new Set(idOfEnemyName.values());

  const key = (enemyId: string, spell: string) => `${enemyId}\u0000${spell}`;
  const onTimeline = new Map<string, number>();
  for (const line of lines) {
    const m = line.match(KIT_CC_ON_TEAM_LINE);
    if (!m || m[1] !== unitId || !enemyIds.has(m[3]!)) continue;
    const k = key(m[3]!, m[2]!);
    onTimeline.set(k, (onTimeline.get(k) ?? 0) + 1);
  }
  const onKit = new Map<string, number>();
  for (const e of kit.enemies) {
    const id = idOfEnemyName.get(e.name);
    if (id === undefined) {
      failures.push(`${where} 上的 ${e.spec} (${e.name}) 不是名册里的敌方`);
      continue;
    }
    for (const s of e.entries) {
      if (
        s.specDefault &&
        e.entries.some((o) => o.spellName === s.spellName && o.landed > 0)
      )
        failures.push(
          `${where}: ${e.name} 的 ${s.spellName} 同时标了 spec default, not seen 和 landed`,
        );
      if (s.landed === 0) continue;
      const k = key(id, s.spellName);
      onKit.set(k, (onKit.get(k) ?? 0) + s.landed);
    }
  }
  const nameOfId = new Map([...idOfEnemyName].map(([n, id]) => [id, n]));
  for (const k of new Set([...onTimeline.keys(), ...onKit.keys()])) {
    const [id, spell] = k.split("\u0000") as [string, string];
    const lineCount = onTimeline.get(k) ?? 0;
    const kitCount = onKit.get(k) ?? 0;
    if (lineCount !== kitCount)
      failures.push(
        `${where}: ${nameOfId.get(id)} 的 ${spell} —— 名单写 landed ${kitCount}×,而落在该单位身上的 [CC ON TEAM] 行有 ${lineCount} 条`,
      );
  }
  return failures;
}

/** The header line's `|  Bracket: <bracket>  |  Result: …`. */
const BRACKET_HEADER = /\|\s+Bracket: (.+?)\s+\|\s+Result:/;
/** `1:40  [MATCH END]   damp: 27%` — the log's end. */
const MATCH_END_LINE = /^\d+:\d{2}\s+\[MATCH END\]/;
/** A `[KILL WINDOW]` / `[VULNERABLE]` line of either view, with its span. */
const KILL_WINDOW_SPAN =
  /^\s*\[(KILL WINDOW|VULNERABLE)\] (\d+):(\d{2})–(\d+):(\d{2})/;
/** The vulnerability span a `[KILL WINDOW]` line names beside its burst:
 *  `(defenseless a–b)` (DPS view) / `; target defenseless a–b` (healer view). */
const DEFENSELESS_SPAN = /\bdefenseless (\d+):(\d{2})–(\d+):(\d{2})/;

/**
 * The round's end as the prompt states it, on the render grid — what the
 * producers' `roundEndMs` prints:
 *
 *  - the log's end is the `[MATCH END]` line — every bracket;
 *  - a Solo Shuffle round (the header's `Bracket:` is `SOLO_SHUFFLE_BRACKET`,
 *    the constant `roundEndMs` itself tests) is over at its first player
 *    death, and every player death of either team is a timeline `[DEATH]`
 *    line — so the earliest `[DEATH]` line's second is the round's end.
 *
 * `null` when the prompt states neither.
 */
function statedRoundEnd(
  lines: string[],
): { second: number; says: string } | null {
  const secondOf = (line: string): number | null => {
    const m = line.match(LEADING_TIME);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const bracket = lines
    .map((l) => l.match(BRACKET_HEADER)?.[1])
    .find((b) => b !== undefined);
  let roundEnd: { second: number; says: string } | null = null;
  const consider = (second: number | null, says: string) => {
    if (second !== null && (roundEnd === null || second < roundEnd.second))
      roundEnd = { second, says };
  };
  for (const line of lines) {
    if (MATCH_END_LINE.test(line)) consider(secondOf(line), "[MATCH END]");
    else if (bracket === SOLO_SHUFFLE_BRACKET && DEATH_LINE.test(line))
      consider(secondOf(line), `${SOLO_SHUFFLE_BRACKET} 的第一条 [DEATH] 行`);
  }
  return roundEnd;
}

/**
 * Hard invariant (T12 ① a, user ruling 2026-10-10: a kill window does not run
 * past the round's end): no `[KILL WINDOW]` / `[VULNERABLE]` span — the line's
 * own, or the `defenseless a–b` it names — ends after the round's end AS THE
 * PROMPT STATES IT.
 *
 * The producer cuts the windows at `roundEndMs` (`computeOffensiveWindows`);
 * the prompt prints that instant, and this gate reads it there
 * (`statedRoundEnd`: `[MATCH END]`, and a Solo Shuffle round's first `[DEATH]`
 * line).
 *
 * A window's end is at or before the round's end, so on the render grid its
 * second is at or before that line's second — no tolerance.
 *
 * Before the cut: a still-open span closed at the LOG's end, ~2 s after a
 * Solo Shuffle round's ending death (`[VULNERABLE] 1:28–1:40` under a first
 * `[DEATH]` at 1:38), and casts after the round read as "inside a kill
 * window" (kick-priority, the missed purges).
 */
export function checkKillWindowWithinRound(lines: string[]): string[] {
  const failures: string[] = [];
  const end = statedRoundEnd(lines);
  if (end === null) return failures;
  lines.forEach((line, i) => {
    const m = line.match(KILL_WINDOW_SPAN);
    if (!m) return;
    const spans = [
      {
        what: `[${m[1]}] 的区间`,
        text: `${m[2]}:${m[3]}–${m[4]}:${m[5]}`,
        to: Number(m[4]) * 60 + Number(m[5]),
      },
    ];
    const d = line.match(DEFENSELESS_SPAN);
    if (d)
      spans.push({
        what: "defenseless 区间",
        text: `${d[1]}:${d[2]}–${d[3]}:${d[4]}`,
        to: Number(d[3]) * 60 + Number(d[4]),
      });
    for (const sp of spans)
      if (sp.to > end.second)
        failures.push(
          `line ${i + 1}: ${sp.what} ${sp.text} 结束于回合结束之后(${end.says}在 ${fmtTime(end.second)})—— ${line.trim().slice(0, 140)}`,
        );
  });
  return failures;
}

/** Any other way a control line states its end. */
const CC_OTHER_END_STATEMENT = new RegExp(
  String.raw`${CC_STILL_ON_AT_ROUND_END}|broken by |dispelled by |ended at their death|${CC_ENDED_BY_LEAD}|broke this CC|ended this CC|\[CLEANSED\]`,
);

/**
 * Hard invariant (F06b / F08): `CC_END_CAUSE_NOT_LOGGED` — "this control was
 * gone within half a second and the log names nothing that ended it"
 * (`ccUnloggedEarlyEnd`) — sits only where that is what the line shows: on a
 * `[CC ON TEAM]` / `[CC ON ENEMY]` line that prints `<1s` and states no other
 * end (a break, a dispel, the holder's death or press, a control immunity
 * that went up as it came off — `ended by their X` / `ended by <unit>'s X`,
 * the producer's `CC_ENDED_BY_LEAD` — a trinket / Tremor /
 * immunity break, `[CLEANSED]`, the round's end). A second end statement
 * beside it is a contradiction; a whole-second length beside it is the
 * claim the producer refuses to make (a control shorter than its table
 * length is not thereby "ended early").
 */
export function checkCcEndCauseNotLogged(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes(CC_END_CAUSE_NOT_LOGGED)) return;
    const fail = (why: string) =>
      failures.push(
        `line ${i + 1}: 「${CC_END_CAUSE_NOT_LOGGED}」${why} —— ${line.trim().slice(0, 180)}`,
      );
    if (!/^\s*\d+:\d{2}\s+\[CC ON (?:TEAM|ENEMY)\]/.test(line))
      return fail("不在 [CC ON TEAM] / [CC ON ENEMY] 行上");
    if (!/\) \| <1s|\) \(<1s\)/.test(line)) fail("所在的行没有印 <1s");
    if (CC_OTHER_END_STATEMENT.test(line)) fail("与该行另一处结束说明并存");
  });
  return failures;
}

/** `formatCcRefreshed`'s clause, whole. */
const CC_REFRESHED_NOTE = new RegExp(CC_REFRESHED_NOTE_RE_SRC.slice(0, -1));
/** A control's length where a break took the `| Ns` slot: `after 2s (cut
 *  short` (trinket / racial / Tremor), `broke this CC after 2s` (immunity). */
const CONTROL_BROKEN_AFTER_SECONDS = /after (?:(\d+)|<1)s/;

/**
 * Hard invariant (F06c): `refreshed at m:ss — the length printed runs across
 * it` (`formatCcRefreshed`: a SPELL_AURA_REFRESH of the control, from its own
 * source, inside the instance the line prints) holds on its own line —
 *
 *  - it sits on a `[CC ON TEAM]` / `[CC ON ENEMY]` line, in the producer's
 *    exact form;
 *  - every refresh second is inside the span the line prints: not before
 *    the line's own second, not after it + the printed whole seconds (+ the
 *    grid's one second — the start is floored, the length rounded). A line
 *    whose length it cannot read is not judged on that.
 */
export function checkCcRefreshedNote(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes(` | ${CC_REFRESHED_LEAD}`)) return;
    const fail = (why: string) =>
      failures.push(
        `line ${i + 1}: 「${CC_REFRESHED_LEAD}…」${why} —— ${line.trim().slice(0, 200)}`,
      );
    const head = line.match(CONTROL_SPAN_LINE);
    if (!head || (head[3] !== "CC ON TEAM" && head[3] !== "CC ON ENEMY"))
      return fail("不在 [CC ON TEAM] / [CC ON ENEMY] 行上");
    const note = line.match(CC_REFRESHED_NOTE)?.[0];
    if (!note) return fail("格式不符");
    const start = Number(head[1]) * 60 + Number(head[2]);
    const cut = line.match(CONTROL_CUT_SECONDS);
    const plain = line.match(CONTROL_PLAIN_SECONDS);
    const broken = line.match(CONTROL_BROKEN_AFTER_SECONDS);
    const seconds = cut
      ? Number(cut[1] ?? 0)
      : plain
        ? Number(plain[1] ?? plain[2])
        : /\) \| <1s|\) \(<1s\)/.test(line)
          ? 0
          : broken
            ? Number(broken[1] ?? 0)
            : null;
    for (const m of note.matchAll(/(\d+):(\d{2})/g)) {
      const at = Number(m[1]) * 60 + Number(m[2]);
      if (at < start) fail(`的刷新时刻 ${m[0]} 早于该行的起点`);
      else if (seconds !== null && at > start + seconds + 1)
        fail(`的刷新时刻 ${m[0]} 晚于该行印出的区间(起点 + ${seconds}s)`);
    }
  });
  return failures;
}

/** A line that states when a buff ended — inside the round, or it is not
 *  printed: `m:ss  [BUFF FADED] …`. */
const AURA_END_LINE = /^(\d+):(\d{2})\s+\[(BUFF FADED|ENEMY BUFF END)\]/;
/** A control line with its own start: `m:ss  [CC ON TEAM] …`. */
const CONTROL_SPAN_LINE =
  /^(\d+):(\d{2})\s+\[(CC ON TEAM|CC ON ENEMY|SILENCE|DISARM)\]/;
/** Its printed whole seconds, unlabelled: `) | 3s` (`[CC ON TEAM]` /
 *  `[SILENCE]` / `[DISARM]`) or `) (3s)` (`[CC ON ENEMY]`). */
const CONTROL_PLAIN_SECONDS = /\) \| (\d+)s\b|\) \((\d+)s\)/;
/** … and behind the round-end label (`renderedCcSpan`). */
const CONTROL_CUT_SECONDS = new RegExp(
  String.raw`${CC_STILL_ON_AT_ROUND_END}, (?:(\d+)s|<1s) in`,
);
/** An `[ENEMY DEF]` line's printed length — `: Barkskin (30%, 3.5s`,
 * `(immune, 8.0s`, `(absorb 64k, 2.0s`, an external's `→ 4(FMage) (6.6s` —
 * with its second (groups 1–2), the length (3) and the round-end label when
 * it follows (4). Read on the line's head, before any `| during it:`. */
const ENEMY_DEF_PRINTED_LENGTH = new RegExp(
  String.raw`^(\d+):(\d{2})\s+\[ENEMY DEF\][^|]*? \((?:(?:${ENEMY_DEF_IMMUNE_LABEL_RE_SRC}|\d+%|absorb(?: (?:\d+|<1)k)?), )?(\d+(?:\.\d+)?)s\b( — ${AURA_STILL_UP_AT_ROUND_END})?`,
);
/** The timeline's legend header — the gate asks for the round-end legend
 * only of a prompt that carries the timeline's legend at all. */
const TIMELINE_LEGEND_HEAD = /^MATCH TIMELINE$/;

/** The `[DEATH]` line's unit: `m:ss  [DEATH]  5(FMage) (…`. */
const DEATH_LINE_PID = /^\d+:\d{2}\s+\[DEATH\]\s+(\S+)/;
/** The one timestamped line a `[DEATH]` entry carries under it
 *  (`emitEnemyDeathEntries`): `m:ss  [ROSTER]  enemy 5(FMage) removed (dead)`. */
const DEATH_ROSTER_LINE = /^\d+:\d{2}\s+\[ROSTER\]\s+enemy (\S+) removed \(dead\)/;

/**
 * Hard invariant (A1, user 2026-10-24 「全按建议」): no timeline line is
 * after the round's end AS THE PROMPT STATES IT (`statedRoundEnd`) — the
 * timeline's `addEntry` drops an event past `roundEndMs`. Allowed after it:
 * `[MATCH END]` itself (the log's end, ~2 s after a Solo Shuffle round's
 * deciding death) and the block of a later `[DEATH]` (a death in that tail
 * is still a death — `addDeathEntry` keeps its entry). That block is what the
 * entry prints: the `[DEATH]` line, the `[ROSTER] enemy N removed (dead)` line
 * of the same unit and second directly under it, and untimestamped rows —
 * not every line of its second: an Astral Shift press at 1:46 beside an
 * unrelated 1:46 death is still past a 1:45 round end (codex 30-RV-02 #3).
 *
 * Before (605 capture of 8c3275fa, N4 F02b): `[TEAM] [CD]` 52, `[ENEMY DEF]`
 * 43, `[YOU] [CD]` 32, `[YOU] [CAST]` 26, `[CC BROKEN]` 24 … lines after a
 * Solo Shuffle round's deciding death.
 */
export function checkNoEventAfterRoundEnd(lines: string[]): string[] {
  const end = statedRoundEnd(lines);
  if (end === null) return [];
  const secondOf = (l: string) => {
    const m = l.match(LEADING_TIME);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  /** the `[DEATH]` entry the last timestamped line belongs to */
  let death: { sec: number; pid: string | undefined } | null = null;
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const sec = secondOf(line);
    if (sec === null) return;
    let inDeathBlock = false;
    if (DEATH_LINE.test(line)) {
      death = { sec, pid: line.match(DEATH_LINE_PID)?.[1] };
      inDeathBlock = true;
    } else {
      const removed = line.match(DEATH_ROSTER_LINE)?.[1];
      inDeathBlock =
        death !== null &&
        death.sec === sec &&
        removed !== undefined &&
        removed === death.pid;
      if (!inDeathBlock) death = null;
    }
    if (sec <= end.second) return;
    if (MATCH_END_LINE.test(line) || inDeathBlock) return;
    failures.push(
      `line ${i + 1}: 时间线行在回合结束之后(${end.says}在 ${fmtTime(end.second)})—— ${line.trim().slice(0, 160)}`,
    );
  });
  return failures;
}

/**
 * Hard invariant (F02b): no line states an aura's end, or a control's
 * length, past the round's end AS THE PROMPT STATES IT (`statedRoundEnd` —
 * `[MATCH END]`, and a Solo Shuffle round's first `[DEATH]` line; the
 * producers cut at `roundEndMs`).
 *
 *  1. `[BUFF FADED]` / `[ENEMY BUFF END]`: the line's second is not after the
 *     round's end, and NO line of the two families carries
 *     `AURA_STILL_UP_AT_ROUND_END` (user ruling 2026-10-11: a buff the round
 *     ended on did not end in the round and gets no line — the producers
 *     skip it at `roundEndMs`; a line here is a buff that ended inside the
 *     round). PV373 had printed the label on these lines, in the round-end
 *     second: 1,132 `[BUFF FADED]` and 350 `[ENEMY BUFF END]` lines of the
 *     605-file capture of ae42aa6f (fix-FT/scripts/n5_still_up_buff_lines.py).
 *  2. `[CC ON TEAM]` / `[CC ON ENEMY]` / `[SILENCE]` / `[DISARM]`: the line
 *     does not start after the round's end; an unlabelled `Ns` does not carry
 *     it more than a second past the round's end; a labelled
 *     `CC_STILL_ON_AT_ROUND_END, Ns in` ends within a second of it.
 *
 *  3. `[ENEMY DEF]` (2026-10-11): a printed length `N.Ns` does not carry the
 *     aura past the round's end, and one labelled `— still up when the round
 *     ended` ends IN the round-end second — the same instant as the lines of
 *     1. The line's second is floored and the length rounded to a tenth, so
 *     the end lies in [second + N − 0.05, second + 1 + N + 0.05); that span
 *     must reach the round-end second, and for a labelled line contain part
 *     of it. Before: the line counted to the LOG's end — `2:27 … Barkskin
 *     (30%, 3.5s — still up when the round ended)` under a round-ending
 *     `[DEATH]` at 2:28 — on 360 of the 432 such lines of the 605-file
 *     capture's Solo Shuffle contexts.
 *  4. The legend states which instant that is (`roundEndLegend`, the
 *     producer's own lines for the header's bracket) whenever a timeline line
 *     says the round ended (`ROUND_ENDED_WORDS`) — checked on a prompt that
 *     carries the timeline's legend at all.
 *
 * The one second is the grid: the start is floored (`fmtTime`), the length
 * rounded to the nearest second (`renderedCcSeconds`), so start + N lands on
 * the true end's second or either neighbour.
 *
 * Before (605-file capture of 8c3275fa, fix-FT/scripts/
 * n4_after_round_end.py): 126 `[BUFF FADED]` and 42 `[ENEMY BUFF END]` lines
 * after a Solo Shuffle round's ending death (`expired` 91, `ended early — no
 * dispel logged` 26 — the strip that follows a round), 54 `[SILENCE]` and 9
 * `[DISARM]` lengths running more than a second past it, 15 `[SILENCE]`
 * lines that start after it.
 */
export function checkAuraEndWithinRound(lines: string[]): string[] {
  const failures: string[] = [];
  // 1. a buff the round ended on has no end line at all (ruling 2026-10-11)
  // — held whatever the prompt states of its round's end
  lines.forEach((line, i) => {
    const a = line.match(AURA_END_LINE);
    if (a && line.includes(AURA_STILL_UP_AT_ROUND_END))
      failures.push(
        `line ${i + 1}: [${a[3]}] 行写「${AURA_STILL_UP_AT_ROUND_END}」,而回合结束时仍在的增益不印结束行 —— ${line.trim().slice(0, 160)}`,
      );
  });
  const end = statedRoundEnd(lines);
  if (end === null) return failures;
  const where = `${end.says}在 ${fmtTime(end.second)}`;
  // 4. one definition in the legend, when a line of the timeline needs it
  if (lines.some((l) => TIMELINE_LEGEND_HEAD.test(l))) {
    const stated = lines.findIndex(
      (l) => LEADING_TIME.test(l) && l.includes(ROUND_ENDED_WORDS),
    );
    const bracket = lines
      .map((l) => l.match(BRACKET_HEADER)?.[1])
      .find((b) => b !== undefined);
    if (
      stated >= 0 &&
      !roundEndLegend(bracket).every((legend) => lines.includes(legend))
    )
      failures.push(
        `line ${stated + 1}: 时间线写了「${ROUND_ENDED_WORDS}」,图例却没有说明它指哪一刻(roundEndLegend)—— ${lines[stated]!.trim().slice(0, 160)}`,
      );
  }
  lines.forEach((line, i) => {
    const fail = (why: string) =>
      failures.push(
        `line ${i + 1}: ${why}(${where})—— ${line.trim().slice(0, 160)}`,
      );
    // 3. [ENEMY DEF]: the aura's printed length against the round's end
    const d = line.match(ENEMY_DEF_PRINTED_LENGTH);
    if (d) {
      const sec = Number(d[1]) * 60 + Number(d[2]);
      const n = Number(d[3]);
      // the end lies in [lo, hi): floored second, length rounded to a tenth
      const lo = sec + n - 0.05;
      const hi = sec + 1 + n + 0.05;
      if (lo >= end.second + 1)
        fail(
          `[ENEMY DEF] 行的时长越过回合结束(起点 + 时长 ≥ ${fmtTime(Math.floor(lo))})`,
        );
      else if (d[4] !== undefined && hi <= end.second)
        fail(
          `[ENEMY DEF] 行写「${AURA_STILL_UP_AT_ROUND_END}」,但起点 + 时长在回合结束之前`,
        );
      return;
    }
    const a = line.match(AURA_END_LINE);
    if (a) {
      const sec = Number(a[1]) * 60 + Number(a[2]);
      if (sec > end.second) fail(`[${a[3]}] 行在回合结束之后`);
      return;
    }
    const c = line.match(CONTROL_SPAN_LINE);
    if (!c) return;
    const sec = Number(c[1]) * 60 + Number(c[2]);
    if (sec > end.second) return fail(`[${c[3]}] 行起于回合结束之后`);
    const cut = line.match(CONTROL_CUT_SECONDS);
    if (cut) {
      const to = sec + Number(cut[1] ?? 0);
      if (Math.abs(to - end.second) > 1)
        fail(
          `[${c[3]}] 行写「${CC_STILL_ON_AT_ROUND_END}」,但起点 + 时长 = ${fmtTime(to)} 不在回合结束处`,
        );
      return;
    }
    const plain = line.match(CONTROL_PLAIN_SECONDS);
    if (!plain) return;
    const to = sec + Number(plain[1] ?? plain[2]);
    if (to > end.second + 1)
      fail(`[${c[3]}] 行的时长越过回合结束(起点 + 时长 = ${fmtTime(to)})`);
  });
  return failures;
}

/** `unpurgedForText`, read back: 1 = the whole seconds it printed. */
const UNPURGED_FOR = new RegExp(UNPURGED_FOR_RE_SRC);

/**
 * Hard invariant (user instruction 2026-10-11, "facts stop at the round's
 * end"): no `unpurged for Ns` — a `[MISSED PURGE OPPORTUNITY]` line's, or the
 * note a missed purge leaves on an `[ENEMY BUFF]` / `[ENEMY CD]` line — runs
 * past the round's end AS THE PROMPT STATES IT (`statedRoundEnd`:
 * `[MATCH END]`, and a Solo Shuffle round's first `[DEATH]` line). The
 * producer ends the window at `roundEndMs` (`reconstructDispelSummary`) and
 * prints its length through `unpurgedForText`, whose pattern this reads.
 *
 * On the render grid: the line's second S is the application floored
 * (`fmtTime`), N the window's seconds rounded, so the window's true end lies
 * in [S + N − 0.5, S + N + 1.5) and the round's true end inside its second
 * R. A window that ends at or before the round's end has S + N ≤ R + 1 —
 * the one second is the grid, not a tolerance — and S + N > R + 1 is a
 * window that outlasted the round. What the text can resolve: a window
 * running 2.5 s or more past the round's end always fails; a shorter overrun
 * can sit inside the grid's second. Every bracket: elsewhere the round's end
 * is the log's, and a first death cuts nothing.
 *
 * Before the cut the window ran to the buff's removal row wherever the log
 * wrote it — a round's units keep the rows after its ending death — or to
 * the log's end: `2:22 [ENEMY CD] … Power Infusion (purgeable; unpurged for
 * 14s; …)` under a round-ending `[DEATH]` at 2:29 (its REMOVED 6.0 s after
 * the death). 143 of the 3,192 such lines of the 605-file capture's 2,395
 * Solo Shuffle contexts (94388b0f: 59 `[ENEMY CD]`, 42 `[ENEMY BUFF]`, 42
 * `[MISSED PURGE OPPORTUNITY]`, in 98 contexts), 0 of 1,423 in the other
 * brackets (fix-FT/scripts/upr_unpurged_past_round_end.py).
 */
export function checkUnpurgedWithinRound(lines: string[]): string[] {
  const failures: string[] = [];
  const end = statedRoundEnd(lines);
  if (end === null) return failures;
  lines.forEach((line, i) => {
    const at = line.match(LEADING_TIME);
    const note = line.match(UNPURGED_FOR);
    if (!at || !note) return;
    const to = Number(at[1]) * 60 + Number(at[2]) + Number(note[1]);
    if (to > end.second + 1)
      failures.push(
        `line ${i + 1}: 「${note[0]}」越过回合结束(起点 + 时长 = ${fmtTime(to)};${end.says}在 ${fmtTime(end.second)})—— ${line.trim().slice(0, 160)}`,
      );
  });
  return failures;
}

/**
 * Untranslated (client-locale) spell / unit names. The prompt is English by
 * contract, so a CJK run is a renderer printing a logged name instead of
 * resolving it. Player names are the one legitimate source of non-ASCII
 * (CN/TW realms): every roster name (`<unit … name="…">`, full and
 * realm-stripped) is removed from a line before the test.
 *
 * Why a hardFailure and not the 2026-07 audit gate that once read 0/1245:
 * that was a one-off script, and the KILL ATTEMPTS block (v25) shipped after
 * it printing `aura.spellName` raw — 230 of 309 prompts in the 2026-09-15
 * Opus baseline carried CJK, unnoticed for two months. Shared with
 * `scripts/pipelineFuzz.ts`'s invariant and with the producer's
 * `getEnglishSpellName` fallback guard (same regex object, defined in
 * analysis `utils/localizedText.ts`).
 */
export { CJK_LEAK };
export function checkCjkLeak(lines: string[]): string[] {
  const names = new Set<string>();
  for (const line of lines) {
    const m = line.match(UNIT_ROSTER_LINE);
    if (!m) continue;
    names.add(m[2]!);
    names.add(m[2]!.split("-")[0]!);
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    let scrubbed = line;
    for (const n of names) if (n) scrubbed = scrubbed.split(n).join("");
    if (CJK_LEAK.test(scrubbed))
      failures.push(
        `line ${i + 1}: 未翻译的名字(CJK)—— ${line.trim().slice(0, 140)}`,
      );
  });
  return failures;
}

/** A section header that promises a team-HP floor, e.g. the pre-GH-#99
 * `HEALER OFFENSE (slack-gated facts — team ≥85% HP, …)`. */
const HP_PROMISE_HEADER = /^[A-Z][A-Z ]+\(.*team ≥(\d+)% HP/;
/** A fact line reporting the team's minimum HP over its own span. */
const TEAM_MIN_HP = /team min HP (\d+)%/;

/**
 * A team-HP floor promised in a section header binds every line under it.
 *
 * Why (GH #99, 2026-09-20): `HEALER OFFENSE` opened with "slack-gated facts —
 * team ≥85% HP, no enemy offensive CDs active, you un-CC-d" and only the
 * `[SLACK]` lines are gated that way. `[KILL WINDOW]` / `[VULNERABLE]` are
 * enemy-vulnerability spans with no own-team HP gate, and `[CONTESTED]` is by
 * construction the 70–85% band, so the header contradicted 1028/1109,
 * 72/77 and 91/91 of those lines respectively — 288 of the 309 prompts in the
 * 2026-09-15 Opus baseline. The header now promises nothing and each family
 * carries its own condition (rendered from `SLACK_TEAM_HP_THRESHOLD`); this
 * gate is what keeps a blanket promise from being re-added over facts that do
 * not honour it. A line may still state its own floor — the gate keys on the
 * HEADER.
 */
export function checkHeaderHpPromise(lines: string[]): string[] {
  const failures: string[] = [];
  let promise: { pct: number; header: string; line: number } | null = null;
  lines.forEach((line, i) => {
    const h = line.trim().match(HP_PROMISE_HEADER);
    if (h) {
      promise = { pct: Number(h[1]), header: line.trim(), line: i + 1 };
      return;
    }
    // A blank line ends the block the header opened.
    if (line.trim() === "") {
      promise = null;
      return;
    }
    if (!promise) return;
    const m = line.match(TEAM_MIN_HP);
    if (m && Number(m[1]) < promise.pct)
      failures.push(
        `line ${i + 1}: 段首(第 ${promise.line} 行)承诺 team ≥${promise.pct}% HP,本行却报 team min HP ${m[1]}% —— ${line.trim().slice(0, 140)}`,
      );
  });
  return failures;
}

/** `DAMPENING (3v3): started at 10%, ended at …` — the header's start value. */
const DAMPENING_STARTED_HEADER = /^DAMPENING \([^)]*\): started at (\d+)%/;
/** `DAMPENING (2v2): started at 41% (derived: one 1% step below the first
 *  logged stack, 42% at 0:11 — the log prints no value before that), ended at
 *  …` — the start is derived from that stack. */
const DAMPENING_DERIVED_START_HEADER =
  /^DAMPENING \([^)]*\): started at (\d+)% \(derived: one (\d+)% step below the first logged stack, (\d+)% at (\d+):(\d{2})\b/;
/** `DAMPENING (2v2): n/a — no dampening stack was logged in this round (8s)` —
 *  no value is stated anywhere in the round. */
const DAMPENING_NO_STACK_HEADER =
  /^DAMPENING \([^)]*\): n\/a — no dampening stack was logged/;
/** The `| dampening: N%` note of a `[YOU] [CD]` / `[PROC]` / `[DEATH]` line. */
const DAMPENING_NOTE = /\| dampening: (\d+)%/;
/** Every dampening number a timeline line can carry: the note above, a
 *  `[DAMPENING ALERT: N%]`, the `damp: N%` of `[MATCH END]`. */
const DAMPENING_NUMBER_ON_LINE =
  /\| dampening: \d+%|\[DAMPENING ALERT: \d+%\]|\bdamp: \d+%/;
/** A dampening VALUE on a timeline line: the `| dampening: N%` note or the
 *  `damp: N%` of `[MATCH END]` (an alert names a milestone, not the value). */
const DAMPENING_VALUE_ON_LINE = /(?:\| dampening|\bdamp): (\d+)%/g;
/** `DAMPENING (2v2): first logged 28% at 0:09 (a stack drop; the log prints no
 *  value before that), ended at …` — no start is stated: nothing before that
 *  second carries a number. */
const DAMPENING_FIRST_DROP_HEADER =
  /^DAMPENING \([^)]*\): first logged (\d+)% at (\d+):(\d{2}) \(a stack drop/;
const DEATH_LINE = /^\d+:\d{2}\s+\[DEATH\]/;

/** An enemy [DEATH] line's dampening is the ENEMY team's reading, not the
 * owner's header (fact1215 R11, codex 20-F15-32: the teams tick apart). */
const ENEMY_DEATH_DAMPENING_LINE = /\[DEATH\].*— enemy\)/;

/**
 * One prompt states one dampening start, and says where it comes from
 * (FT-T13, D10 + D11).
 *
 * The DAMPENING header opens in one of three ways, and each binds the
 * timeline:
 *
 * - `started at N%` (3v3 / Solo Shuffle). The `| dampening: M%` notes are the
 *   same reading of the same aura, and the stack only goes down after a death
 *   (`buildDampeningEvents`: a REMOVED_DOSE on the survivors). So before the
 *   second of the first `[DEATH]` line no note may read below the header.
 * - `started at N% (derived: one D% step below the first logged stack, M% at
 *   m:ss …)` (2v2 — `getInitialDampening`; the user's D11: step back from
 *   the log's first stack, and say the number is derived). The step is
 *   re-done from the rendered numbers: D is `DAMPENING_DOSE_PCT` and
 *   N = M − D. Before m:ss the round's dampening IS N, so every
 *   `| dampening:` note and `damp:` stamped before that second reads N. The
 *   first rule holds for it too.
 * - `first logged M% at m:ss (a stack drop; …)` (a 2v2 round whose first
 *   logged line is a REMOVED_DOSE — not stepped back from). No start is
 *   stated, so no timeline line stamped before m:ss may carry a dampening
 *   number of any kind.
 * - `n/a — no dampening stack was logged in this round` (a 2v2 round without
 *   one). No timeline line may carry a dampening number at all.
 *
 * Why (D10): three consumers classified the bracket on a unit list that
 * carried pets, so a 2v2 round with a pet out printed `started at 30%` in the
 * header and `dampening: 10%` on the press lines until the first logged
 * stack — 159 of the 516 healer-2v2 prompts (220 lines) of the 605-file
 * capture. The producer has one classification (`dampeningRulesOf`); this
 * gate is what keeps a consumer from being handed a different roster again,
 * or a hand value from coming back in front of the first logged stack.
 */
export function checkDampeningStartConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  const secondOf = (line: string): number | null => {
    const m = line.match(LEADING_TIME);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };

  // ── no start stated (no stack logged, or the first logged line is a
  // drop): no dampening number before the first logged second ──
  const unstated = lines
    .map((l, i) => {
      const t = l.trim();
      const drop = t.match(DAMPENING_FIRST_DROP_HEADER);
      if (drop)
        return {
          line: i + 1,
          untilS: Number(drop[2]) * 60 + Number(drop[3]),
          says: `第一条记录是 ${drop[2]}:${drop[3]} 的掉层(${drop[1]}%),此前没有陈述值`,
        };
      return DAMPENING_NO_STACK_HEADER.test(t)
        ? { line: i + 1, untilS: Infinity, says: "日志整局没有打出衰减层数" }
        : null;
    })
    .find((h) => h !== null);
  if (unstated) {
    lines.forEach((line, i) => {
      if (ENEMY_DEATH_DAMPENING_LINE.test(line)) return;
      const s = secondOf(line);
      if (s === null || s >= unstated.untilS) return;
      const m = line.match(DAMPENING_NUMBER_ON_LINE);
      if (m)
        failures.push(
          `line ${i + 1}: DAMPENING 段首(第 ${unstated.line} 行)写${unstated.says},本行在那之前却带衰减数字「${m[0]}」—— ${line.trim().slice(0, 140)}`,
        );
    });
    return failures;
  }

  // ── a derived start: the step, and one value before the first logged stack ──
  // (those seconds are judged here and left out of the `started at` rule
  // below, which would report a low note a second time)
  let derivedUntilS = 0;
  lines.forEach((l, h) => {
    const d = l.trim().match(DAMPENING_DERIVED_START_HEADER);
    if (!d) return;
    const [startPct, stepPct, firstPct] = [d[1], d[2], d[3]].map(Number);
    const firstS = Number(d[4]) * 60 + Number(d[5]);
    derivedUntilS = Math.max(derivedUntilS, firstS);
    // the producer's own clamp: a stack cannot go below 0
    if (
      stepPct !== DAMPENING_DOSE_PCT ||
      startPct !== Math.max(0, firstPct - stepPct)
    )
      failures.push(
        `line ${h + 1}: DAMPENING 段首写 started at ${startPct}%,但它声称的推导是「第一次记录 ${firstPct}% 减一步 ${stepPct}%」(一步应为 ${DAMPENING_DOSE_PCT}%)—— ${l.trim().slice(0, 160)}`,
      );
    lines.forEach((line, i) => {
      if (ENEMY_DEATH_DAMPENING_LINE.test(line)) return;
      const s = secondOf(line);
      if (s === null || s >= firstS) return;
      for (const m of line.matchAll(DAMPENING_VALUE_ON_LINE))
        if (Number(m[1]) !== startPct)
          failures.push(
            `line ${i + 1}: DAMPENING 段首(第 ${h + 1} 行)写第一次记录在 ${d[4]}:${d[5]}、此前为 ${startPct}%,本行在那之前却写「${m[0]}」—— ${line.trim().slice(0, 140)}`,
          );
    });
  });

  // ── `started at N%`: no note below it before the first death ──
  const headerAt = lines.findIndex((l) =>
    DAMPENING_STARTED_HEADER.test(l.trim()),
  );
  if (headerAt < 0) return failures;
  const started = {
    pct: Number(lines[headerAt].trim().match(DAMPENING_STARTED_HEADER)![1]),
    line: headerAt + 1,
  };
  let firstDeathS = Infinity;
  for (const line of lines) {
    if (!DEATH_LINE.test(line)) continue;
    const s = secondOf(line);
    if (s !== null) firstDeathS = Math.min(firstDeathS, s);
  }
  lines.forEach((line, i) => {
    if (ENEMY_DEATH_DAMPENING_LINE.test(line)) return;
    const s = secondOf(line);
    if (s === null || s >= firstDeathS || s < derivedUntilS) return;
    const m = line.match(DAMPENING_NOTE);
    if (m && Number(m[1]) < started.pct)
      failures.push(
        `line ${i + 1}: DAMPENING 段首(第 ${started.line} 行)写 started at ${started.pct}%,本行(第一次死亡之前)却写 dampening: ${m[1]}% —— ${line.trim().slice(0, 140)}`,
      );
  });
  return failures;
}

/**
 * `[RES]` no-change rows (27th hardFailure class, GH #99 item 5, user ruling
 * 2026-09-22): a `rdy:Δ  cd:—` row may survive in the rendered prompt only
 * when it carries a fact the surviving text cannot reconstruct (a focus
 * target no non-no-change `[RES]` neighbour shows, a CC no same-named
 * `[CC ON …]` line covers at that second, an enemy CD with no earlier
 * `[ENEMY CD]` line). The renderer prunes with `pruneZeroLossResRows`; this
 * gate re-applies the same imported `droppableNoChangeResRows` to the
 * rendered lines and fails on every droppable row still present — one
 * predicate, two sides. Measured on the 82-prompt local rebuild: 717/954
 * no-change rows droppable at control (77/82 prompts fail this gate) → 0
 * after the renderer prunes, with the 146 focus episodes and 103 CC states
 * that only the other 237 rows carry kept.
 */
export function checkResNoChangeRowsPruned(lines: string[]): string[] {
  const failures: string[] = [];
  for (const i of [...droppableNoChangeResRows(lines)].sort((a, b) => a - b))
    failures.push(
      `line ${i + 1}: 零信息损失的 [RES] rdy:Δ cd:— 行仍在 prompt 里(它的每个事实别处都有)—— ${lines[i]!.trim().slice(0, 140)}`,
    );
  return failures;
}

const CC_AVOIDED_LINE =
  /^\s*(\d+):(\d{2})\s+\[CC AVOIDED\?\]\s+(\S+): (.+?) \(by /;
const CC_ON_TEAM_LINE =
  /^\s*(\d+):(\d{2})\s+\[CC ON TEAM\]\s+(\S+) ← (.+?) \(by /;
/** The caster's roster id inside a control line's `(by N(Spec)…`. */
const CC_LINE_CASTER_ID = /\(by (\d+)\(/;
const CC_AVOIDED_CAST_STAMP =
  /\(by [^;)]*(?:\([^)]*\)[^;)]*)*; cast (\d+):(\d{2})\)/;

/**
 * `[CC AVOIDED?] … did not land` ⟺ no landed `[CC ON TEAM]` line (30th
 * hardFailure class, GH #105, user "修" 2026-09-24) — the same for the line's
 * `logged <TYPE>` form (FT-T16 D15 "3c"). The producer
 * (`ccTrinketAnalysis`) drops an avoidance whenever a CC aura of the same id
 * or English name started on that player inside the cast's landing window —
 * `ccLandedMatchWindowMs(name)`: `CC_LANDED_MATCH_WINDOW_MS` either side of
 * the cast, and after it as long as that spell's own landing delay (FT-T16,
 * user decision D14 2026-10-10: Capacitor Totem, Sigil of Misery, Ring of
 * Frost — `AOE_CC_LANDING_WINDOW_S`). Rendered on the `fmtTime` grid, a
 * landing d whole seconds after the avoidance line is a real gap in
 * (d − 1, d + 1), so the gate fails only where the producer's own window,
 * called with the name the line prints, makes the contradiction certain:
 * 0 ≤ d and d + 1 ≤ after, or d < 0 and −d + 1 ≤ before. Before the GH #105
 * fix, 334 of 2,667 avoided lines on the S2 archive every-30 had a
 * same-second landed twin (BoS / SW:D / Tremor "breaks" of a CC that did
 * land, plus cast ≠ aura ids like Holy Word: Chastise 88625 → 200200);
 * before D14 the 605-file capture had 97 delayed-landing twins the 1.5 s
 * window could not call (Capacitor Totem 72, Sigil of Misery 19, Ring of
 * Frost 6 inside 4 s) and this gate, reading the same 1.5 s, passed them all.
 */
export function checkCcAvoidedLandedConsistency(lines: string[]): string[] {
  const landed = new Map<string, Array<{ at: number; caster?: string }>>();
  for (const line of lines) {
    const m = line.match(CC_ON_TEAM_LINE);
    if (!m) continue;
    const key = `${m[3]}\u0000${m[4]}`;
    const at = Number(m[1]) * 60 + Number(m[2]);
    landed.set(key, [
      ...(landed.get(key) ?? []),
      { at, caster: CC_LINE_CASTER_ID.exec(line)?.[1] },
    ]);
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(CC_AVOIDED_LINE);
    if (!m) return;
    // the producer's window is the cast's: a delayed control's line prints
    // its hit second and stamps the cast inside `(by …; cast m:ss)`
    // (`ccAvoidedCastTag`, codex 20-F15-21)
    // a line resting on the log's own failed-control row (`logged IMMUNE`,
    // `logged MISSED` …) is that trigger's outcome: a landing after it is
    // another trigger — a later trap, 41 s on (fact4 batch 2, cap-f2
    // 118-1-655 7:31 → 8:12, once the trap's landing window became its 60 s
    // area) — so only the same-instant window applies to it, centred on the
    // line's own (hit) second, not the cast's (codex 20-F17-02 #3: a
    // Capacitor Totem `cast 0:10` logged IMMUNE at 0:12 beside a 0:12
    // landing passed)
    const logged = / logged [A-Z]/.test(line);
    const c = logged ? null : line.match(CC_AVOIDED_CAST_STAMP);
    const at = c
      ? Number(c[1]) * 60 + Number(c[2])
      : Number(m[1]) * 60 + Number(m[2]);
    const { beforeMs, afterMs } = logged
      ? {
          beforeMs: CC_LANDED_MATCH_WINDOW_MS,
          afterMs: CC_LANDED_MATCH_WINDOW_MS,
        }
      : ccLandedMatchWindowMs(m[4]!);
    // …and only its own caster's landing answers it (the producer's
    // `landedOnPlayer(…, ownTrigger)`: a second shaman's Capacitor Totem
    // stunning the mage in the second the first one's logged IMMUNE is no
    // contradiction)
    const caster = logged ? CC_LINE_CASTER_ID.exec(line)?.[1] : undefined;
    const twin = (landed.get(`${m[3]}\u0000${m[4]}`) ?? [])
      .filter(
        (l) =>
          caster === undefined || l.caster === undefined || l.caster === caster,
      )
      .map((l) => l.at)
      // a line that names its caster's recast landing (`ccAvoidedRecastTag`,
      // user ruling 2026-10-27) is answered by one landing in the second(s)
      // that recast can render in: [line second + N, line second + 1 + N)
      .filter((t, k, all) => {
        const r = logged ? CC_AVOIDED_RECAST_RE.exec(line.trimEnd()) : null;
        if (!r) return true;
        const lineS = Number(m[1]) * 60 + Number(m[2]);
        // N is rounded to 0.1 s (codex 20-G1: a 0.96 s recast prints +1.0s
        // and can land in the line's own second)
        const d = Number(r[1]);
        const lo = Math.floor(lineS + d - 0.05);
        const hi = Math.floor(lineS + 1 + d + 0.05);
        const isRecast = (x: number) => x >= lo && x <= hi;
        return !(isRecast(t) && all.findIndex(isRecast) === k);
      })
      .find((t) => {
        const d = t - at;
        return d >= 0 ? d + 1 <= afterMs / 1000 : -d + 1 <= beforeMs / 1000;
      });
    if (twin !== undefined)
      failures.push(
        `line ${i + 1}: [CC AVOIDED?] 说 ${m[4]} 没落在 ${m[3]} 身上,但 ${fmtTime(twin)} 有同名 [CC ON TEAM] 落地行 —— ${line.trim().slice(0, 140)}`,
      );
  });
  return failures;
}

/**
 * A warlock purges through the Felhunter's Devour Magic, so the PURGE
 * RESPONSIBILITY header must follow the pet the roster prints (fact1215 C10,
 * 1120cb61: a Sayaad warlock listed as a team purger). A warlock whose
 * `[pet: …]` tag names no Devour Magic is never `CAN offensive purge` as the
 * log owner, and a warlock spec in `Team purgers:` needs a non-owner warlock
 * of that spec whose tag names it (or that has no tag — nothing logged says
 * which pet). The producer reads the same pets (`warlockRanPurgePet`, the
 * roster's predicate). 605 capture: 209 failures before the fix → 0.
 */
export function checkWarlockPurgeFollowsPet(lines: string[]): string[] {
  const failures: string[] = [];
  const team = lines.find((l) => /^\s*My team: /.test(l));
  if (!team) return failures;
  // the warlocks by the roster's own names (`<unit … name="…" spec="…
  // Warlock" role="…">`): a name may hold parentheses (codex 20-F15-29:
  // `Me (EU)-R` broke a pattern that stopped at the first `)`)
  const locks: Array<{
    spec: string;
    name: string;
    owner: boolean;
    purges: boolean | undefined;
  }> = [];
  for (const l of lines) {
    const u =
      /<unit id="\d+" name="([^"]+)" spec="((?:Affliction|Demonology|Destruction) Warlock)" role="([^"]+)"/.exec(
        l,
      );
    if (!u || u[3] === "enemy") continue;
    const at = team.indexOf(`${u[2]} (${u[1]})`);
    if (at < 0) continue;
    const after = team.slice(at + `${u[2]} (${u[1]})`.length);
    const pet = /^ \[pet: ([^\]]*)\]/.exec(after);
    locks.push({
      spec: u[2]!,
      name: u[1]!,
      owner: u[3] === "log owner",
      purges: pet ? pet[1]!.includes("Devour Magic") : undefined,
    });
  }
  lines.forEach((line, i) => {
    if (/^\s*Log owner \([^)]+ Warlock\): CAN offensive purge/.test(line)) {
      const me = locks.find((w) => w.owner);
      if (me && me.purges === false)
        failures.push(
          `line ${i + 1}: 日志主人术士的宠物标签没有 Devour Magic,却写 CAN offensive purge —— ${line.trim().slice(0, 140)}`,
        );
    }
    const tp = /^\s*Team purgers: (.+)$/.exec(line);
    if (!tp) return;
    // each listed warlock spec needs its own capable (or untagged) teammate
    // of that spec — one capable warlock does not vouch for two entries
    // (codex 20-F15-29)
    const listed = new Map<string, number>();
    // a swap mid-round prints `(Felhunter out until m:ss)` after the spec
    for (const entry of tp[1]!.split(/, (?![^(]*\))/)) {
      const spec = entry.replace(/ \(Felhunter out [^)]*\)$/, "");
      if (/ Warlock$/.test(spec)) listed.set(spec, (listed.get(spec) ?? 0) + 1);
    }
    for (const [spec, n] of listed) {
      const mates = locks.filter((w) => w.spec === spec && !w.owner);
      if (mates.length === 0) continue;
      const able = mates.filter((w) => w.purges !== false).length;
      if (n > able)
        failures.push(
          `line ${i + 1}: Team purgers 列了 ${n} 个 ${spec},但该专精能驱散(或未标宠物)的队友术士只有 ${able} 个 —— ${line.trim().slice(0, 140)}`,
        );
    }
  });
  return failures;
}

const CC_AVOIDED_DATA_LINE = /^\s*\d+:\d{2}\s+\[CC AVOIDED\?\]/;
// the second half: `; <avoidance> active`, or — an IMMUNE row the sweep
// could credit to nothing (corpusFactScan2 immunityTableForward, 2026-10-22)
// — the line ends at the miss, with the log's own cause when it shows one
// (`(DR: … Immune)` / `(a Cyclone was on them)`)
const CC_AVOIDED_OUTCOME =
  /\) (?:(?:did not land|logged (\S+)); |logged (IMMUNE)(?: \((?:DR: [^)]+ Immune|a Cyclone was on them)\))?(?: — recast landed \+\d+\.\ds)?$)/;

/**
 * The first half of a `[CC AVOIDED?]` line (FT-T16 D15 "3c", user approval
 * 2026-10-10): `did not land`, or `logged <TYPE>` when the log wrote a
 * SPELL_MISSED row for that cast on that player
 * (`ccTrinketAnalysis.ccAvoidedOutcomeText`). The producer admits only a miss
 * type that establishes a failed control — `CONTROL_FAILED_MISS_TYPES`,
 * imported here: IMMUNE and the types the cast-line fail tags use; never
 * ABSORB, which reports the control's damage part and is followed by the aura
 * 89 % of the time. It fails a line whose first half is neither form, and a
 * `logged <TYPE>` whose type is outside that set. Both forms are still read
 * by `checkCcAvoidedLandedConsistency` (its pattern stops at `(by`).
 */
export function checkCcAvoidedMissType(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!CC_AVOIDED_DATA_LINE.test(line)) return;
    const m = line.match(CC_AVOIDED_OUTCOME);
    if (!m)
      failures.push(
        `line ${i + 1}: [CC AVOIDED?] 前半句既不是 did not land 也不是 logged <TYPE> —— ${line.trim().slice(0, 140)}`,
      );
    else if (m[1] !== undefined && !CONTROL_FAILED_MISS_TYPES.has(m[1]))
      failures.push(
        `line ${i + 1}: [CC AVOIDED?] 写 logged ${m[1]},但 ${m[1]} 不是能断定控制没落地的 miss 类型 —— ${line.trim().slice(0, 140)}`,
      );
    // m[2]: the uncredited IMMUNE form — IMMUNE is in the set by construction
  });
  return failures;
}

/**
 * `[DEATH] … (PvP Trinket available)` vs the `[CC ON TEAM]` lines (triage
 * 2026-09-29 enemy-def F-E28, user ruling A28 2026-09-30). The bare tag
 * claims a breakable CC was on the dying player; the
 * `(PvP Trinket available; no breakable CC in the last 10 s)` form claims
 * none. Breakable = a `[CC ON TEAM]` line on that player whose rendered span
 * (m:ss start + its printed `| Ns` / "after Ns") overlaps
 * [death − DEATH_BREAKABLE_CC_LOOKBACK_S, death] with N ≥
 * DEATH_BREAKABLE_CC_MIN_S — the producer's `breakableCcBeforeDeath`, same
 * constants, read back from the text.
 */
// FT-T09: a CC the round ended on prints its landing → round-end time behind
// `CC_STILL_ON_AT_ROUND_END`; a sub-second CC prints `<1s` and is never
// breakable (MIN_S), so it is not read.
const CC_ON_TEAM_RENDERED_S = new RegExp(
  String.raw`\) \| (?:${CC_STILL_ON_AT_ROUND_END}, )?(\d+)s\b|after (\d+)s \(cut short`,
);
const DEATH_TRINKET_TAG =
  /\(PvP Trinket available(; no breakable CC in the last (\d+) s)?\)/;
export function checkDeathTrinketCcConsistency(lines: string[]): string[] {
  const ccByVictim = new Map<string, Array<{ at: number; n: number }>>();
  for (const line of lines) {
    const m = line.match(CC_ON_TEAM_LINE);
    if (!m) continue;
    const d = line.match(CC_ON_TEAM_RENDERED_S);
    if (!d) continue;
    const at = Number(m[1]) * 60 + Number(m[2]);
    const n = Number(d[1] ?? d[2]);
    ccByVictim.set(m[3]!, [...(ccByVictim.get(m[3]!) ?? []), { at, n }]);
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(FRIENDLY_DEATH_LINE);
    if (!m) return;
    const tag = line.match(DEATH_TRINKET_TAG);
    if (!tag) return;
    const death = Number(m[1]) * 60 + Number(m[2]);
    const breakable = (ccByVictim.get(m[3]!) ?? []).some(
      (c) =>
        c.n >= DEATH_BREAKABLE_CC_MIN_S &&
        c.at <= death &&
        c.at + c.n >= death - DEATH_BREAKABLE_CC_LOOKBACK_S,
    );
    const saysNone = tag[1] !== undefined;
    if (saysNone && Number(tag[2]) !== DEATH_BREAKABLE_CC_LOOKBACK_S)
      failures.push(
        `line ${i + 1}: [DEATH] 的饰品标签写 last ${tag[2]} s,口径是 ${DEATH_BREAKABLE_CC_LOOKBACK_S} s —— ${line.trim().slice(0, 140)}`,
      );
    if (saysNone === breakable)
      failures.push(
        `line ${i + 1}: [DEATH] 说${saysNone ? "死前 10 s 没有" : "死前 10 s 有"}可解控制,但 [CC ON TEAM] 行${breakable ? "有" : "没有"}(渲染时长 ≥ ${DEATH_BREAKABLE_CC_MIN_S} s 且与 [死亡 − ${DEATH_BREAKABLE_CC_LOOKBACK_S} s, 死亡] 相交) —— ${line.trim().slice(0, 140)}`,
      );
  });
  return failures;
}

const PRESSED_DURING_NOTE = new RegExp(PRESSED_DURING_NOTE_RE_SRC);
const PRESSED_DURING_HOST_LINE =
  /^\s*\d+:\d{2}\s+\[(?:CC ON TEAM|SILENCE)\]\s+(\d+)\(/;
const OWNER_KIT_LINE = /^\s*<cooldowns>(.*)<\/cooldowns>\s*$/;

/**
 * Every loadout unit with its `<cooldowns>` kit, entry text by spell name
 * (`Name [..]( [..])?` entries joined by ", "; a name may hold a comma;
 * every entry but the last has lost its closing `]` to the split). `kit` is
 * null for a unit with no kit line.
 */
function unitKitsOf(lines: string[]): Array<{
  id: string;
  name: string;
  role: string;
  kit: Map<string, string> | null;
}> {
  const units: ReturnType<typeof unitKitsOf> = [];
  lines.forEach((line, i) => {
    const u = line.match(UNIT_LEGEND_LINE);
    if (!u) return;
    const kit = lines[i + 1]?.match(OWNER_KIT_LINE)?.[1] ?? null;
    units.push({
      id: u[1]!,
      name: u[2]!,
      role: u[3]!,
      kit:
        kit === null
          ? null
          : new Map<string, string>(
              kit
                .split(/\](?:, )/)
                .map(
                  (e) => [e.slice(0, e.indexOf(" [")), e] as [string, string],
                ),
            ),
    });
  });
  return units;
}

/**
 * The log owner's unit id and its `<cooldowns>` kit (`unitKitsOf`). `kit` is
 * null without a `log owner` unit or its kit line.
 */
function ownerKitOf(lines: string[]): {
  ownerId: string | null;
  kit: Map<string, string> | null;
} {
  const owner = unitKitsOf(lines)
    .filter((u) => u.role === "log owner")
    .at(-1);
  return { ownerId: owner?.id ?? null, kit: owner?.kit ?? null };
}

/**
 * `| pressed during it: X ×N` (FT-T16, user decision D13 2026-10-10): the log
 * owner's major cooldowns refused because of the control that line states.
 * The producer (`context/controlRejectedPresses.ts`) reads the presses from
 * the raw log, which the prompt does not carry, so the gate checks what the
 * text can: the clause sits at the end of a `[CC ON TEAM]` / `[SILENCE]` line
 * (the producer's own pattern, parsed in full), that line is the log owner's
 * — only the recorder has refused presses — and every spell it names is an
 * entry of the owner's `<cooldowns>` kit with a button, named once, with a
 * count of at least 1. Without a `log owner` unit or its kit the ownership
 * checks say nothing.
 */
export function checkPressedDuringControlNote(lines: string[]): string[] {
  const { ownerId, kit: kitEntries } = ownerKitOf(lines);
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes(PRESSED_DURING_NOTE_HEAD)) return;
    const fail = (why: string) =>
      failures.push(
        `line ${i + 1}: \`pressed during it\` ${why} —— ${line.trim().slice(0, 160)}`,
      );
    const host = line.match(PRESSED_DURING_HOST_LINE);
    const note = line.match(PRESSED_DURING_NOTE);
    if (!host || !note) {
      fail("格式不符(必须是 [CC ON TEAM] / [SILENCE] 行的最后一个子句)");
      return;
    }
    if (ownerId !== null && host[1] !== ownerId)
      fail(`写在 ${host[1]} 的行上,被拒按键只有录制者 ${ownerId} 有`);
    const seen = new Set<string>();
    for (const item of note[1]!.matchAll(
      new RegExp(PRESSED_DURING_ITEM_RE_SRC, "g"),
    )) {
      const name = item[1]!;
      if (seen.has(name)) fail(`${name} 列了两次`);
      seen.add(name);
      if (Number(item[2]) < 1) fail(`${name} 的次数是 ${item[2]}`);
      if (kitEntries === null) continue;
      const entry = kitEntries.get(name);
      if (entry === undefined) fail(`${name} 不在录制者的 <cooldowns> 里`);
      else if (entry.includes("[PASSIVE"))
        fail(`${name} 在 <cooldowns> 里是 [PASSIVE](没有按键)`);
    }
  });
  return failures;
}

/** A kit entry's text from `[UNUSED` to its end, in full. */
const KIT_UNUSED_TAG_FULL = new RegExp(`^${KIT_UNUSED_NOTE_RE_SRC}$`);
const KIT_REFUSED_ITEM = /^(.+) ×(\d+)$/;

/**
 * A kit entry's `[UNUSED — …]` note (FT board F09, 2026-10-11:
 * `pressed N×, refused: …` beside FT-T06's `started K×, never finished`).
 * The producer (`context/kitUnusedNote.ts` → `formatKitUnusedNote`) reads the
 * refused presses from the raw log, which the prompt does not carry, so the
 * gate checks what the text can. It fails:
 *  - an `[UNUSED` tag, on any unit's `<cooldowns>`, that is not the
 *    producer's pattern to the end of the entry;
 *  - `pressed N×, refused: …` on a unit that is not the log owner — the log
 *    records refused presses for its recorder alone;
 *  - N < 1; a reason outside the producer's words (`KIT_REFUSED_WHY_WORDS`);
 *    a reason listed twice; a single reason with a count of its own, or
 *    several whose counts do not add up to N;
 *  - a disagreement with the owner's `| pressed during it: X ×M` clauses
 *    (`checkPressedDuringControlNote`), which state some of the same rows:
 *    for a cooldown the kit calls UNUSED, the M over the `[CC ON TEAM]` lines
 *    may not exceed the note's `under crowd control` count, nor the M over
 *    the `[SILENCE]` lines its `silenced` count (a press the control line
 *    states is a refused press of that cooldown).
 * Without a `log owner` unit the ownership and cross checks say nothing.
 */
export function checkKitUnusedNote(lines: string[]): string[] {
  const failures: string[] = [];
  const { ownerId } = ownerKitOf(lines);
  const words = new Set(KIT_REFUSED_WHY_WORDS);
  // the owner's UNUSED entries: name → count per reason
  const ownerUnused = new Map<string, Map<string, number>>();
  lines.forEach((line, i) => {
    const kit = line.match(OWNER_KIT_LINE)?.[1];
    if (kit === undefined || !kit.includes("[UNUSED")) return;
    const role = lines[i - 1]?.match(UNIT_LEGEND_LINE)?.[3];
    for (const entry of kit.split(/\](?:, )/)) {
      const at = entry.indexOf("[UNUSED");
      if (at < 0) continue;
      const name = entry.slice(0, entry.indexOf(" ["));
      const fail = (why: string) =>
        failures.push(
          `line ${i + 1}: <cooldowns> 的 ${name} [UNUSED…] ${why} —— ${entry.slice(at, at + 140)}`,
        );
      const m = entry.slice(at).match(KIT_UNUSED_TAG_FULL);
      if (!m) {
        fail(
          "格式不符(必须是 [UNUSED]、started K×, never finished、pressed N×, refused: …,或后两者以 ; 相连)",
        );
        continue;
      }
      const pressed = m[2] ?? m[4];
      const reasons = new Map<string, number>();
      if (pressed !== undefined) {
        if (role !== undefined && role !== "log owner")
          fail(`写在 ${role} 的技能组上,被拒按键只有录制者有`);
        const n = Number(pressed);
        if (n < 1) fail(`被拒次数是 ${n}`);
        const items = (m[3] ?? m[5])!.split(", ");
        if (items.length === 1) {
          if (!words.has(items[0]!))
            fail(`原因「${items[0]}」不是产品的措辞(单一原因不带次数)`);
          reasons.set(items[0]!, n);
        } else {
          let sum = 0;
          for (const item of items) {
            const it = item.match(KIT_REFUSED_ITEM);
            if (!it || !words.has(it[1]!)) {
              fail(`原因「${item}」不是「产品措辞 ×次数」`);
              continue;
            }
            if (reasons.has(it[1]!)) fail(`原因「${it[1]}」列了两次`);
            if (Number(it[2]) < 1) fail(`原因「${it[1]}」的次数是 ${it[2]}`);
            reasons.set(it[1]!, Number(it[2]));
            sum += Number(it[2]);
          }
          if (sum !== n) fail(`各原因次数之和 ${sum} ≠ 被拒次数 ${n}`);
        }
      }
      if (role === "log owner") ownerUnused.set(name, reasons);
    }
  });
  if (ownerId === null) return failures;
  // what the owner's control lines state of the same rows
  const stated = new Map<string, { control: number; silence: number }>();
  for (const line of lines) {
    if (!line.includes(PRESSED_DURING_NOTE_HEAD)) continue;
    const host = line.match(PRESSED_DURING_HOST_LINE);
    const note = line.match(PRESSED_DURING_NOTE);
    if (!host || !note || host[1] !== ownerId) continue;
    const kind = /^\s*\d+:\d{2}\s+\[SILENCE\]/.test(line)
      ? "silence"
      : "control";
    for (const item of note[1]!.matchAll(
      new RegExp(PRESSED_DURING_ITEM_RE_SRC, "g"),
    )) {
      const cur = stated.get(item[1]!) ?? { control: 0, silence: 0 };
      cur[kind] += Number(item[2]);
      stated.set(item[1]!, cur);
    }
  }
  for (const [name, want] of stated) {
    const have = ownerUnused.get(name);
    if (have === undefined) continue; // not UNUSED in the kit
    for (const [kind, why] of [
      ["control", "under crowd control"],
      ["silence", "silenced"],
    ] as const)
      if (want[kind] > (have.get(why) ?? 0))
        failures.push(
          `<cooldowns> 的 ${name} [UNUSED…] 写「${why}」${have.get(why) ?? 0} 次,而 \`pressed during it\` 在 ${kind === "control" ? "[CC ON TEAM]" : "[SILENCE]"} 行上共写了 ${want[kind]} 次`,
        );
  }
  return failures;
}

// The row marker alone decides "this is a PEEL row" — a mangled time prefix
// must fail the full parse, not escape detection (codex astra, 121c).
const PEEL_DATA_LINE = /\[PEEL OPTION\]/;
const PEEL_LINE =
  /^\s*(\d+):(\d{2})–(\d+):(\d{2})\s+\[PEEL OPTION\]\s+(\S+) (.+?) → (\S+)(?: \(the victim's own CC\))?: usable (\d+) s, not used \| (\S+) did \d+% of (\S+)'s damage taken in the \d+ s before dying at (\d+):(\d{2}) \| at (\d+):(\d{2}): [\d.]+yd, DR (\S+?)(?:, (\S+) PvP trinket (?:ready|on cooldown))?$/;
const FRIENDLY_DEATH_LINE =
  /^\s*(\d+):(\d{2})\s+\[DEATH\]\s+(\S+) \(.*— friendly\)/;
const CC_ON_ENEMY_LINE =
  /^\s*(\d+):(\d{2})\s+\[CC ON ENEMY\]\s+(\S+) ← (.+?) \(by (\S+)\)/;

/**
 * `[PEEL OPTION]` framing (31st hardFailure class, GH #77, user rulings
 * 2026-09-19 / 2026-09-24). The producer (`context/peelOptions.ts`) offers an
 * instant CC its owner had ready for >= PEEL_MIN_USABLE_S seconds inside the
 * PEEL_LOOKBACK_S before a friendly death and did not use; both constants are
 * imported here. The gate re-parses every line and fails when:
 *  - no `[DEATH]` line names that victim at the stated second;
 *  - the usable span leaves the lookback window or reaches past the death;
 *  - the second count is below the door or exceeds the span;
 *  - the line does not parse in full (every `[PEEL OPTION]` row is checked;
 *    a reworded row used to be skipped silently);
 *  - the damage / trinket facts name someone other than the target, or the
 *    distance / DR snapshot is not taken at the span's first second (audit
 *    121c: DR resets inside a span, so the snapshot carries its own time);
 *  - the DR is Immune;
 *  - a `[CC ON ENEMY]` line shows that owner landing the same-named CC on
 *    that target inside the window ("not used" would be false).
 */
export function checkPeelOptionConsistency(lines: string[]): string[] {
  /** `second\0victim` → the `[DEATH]` line's index */
  const deaths = new Map<string, number>();
  const landed: Array<{
    at: number;
    target: string;
    spell: string;
    by: string;
    line: number;
  }> = [];
  lines.forEach((line, i) => {
    const d = line.match(FRIENDLY_DEATH_LINE);
    if (d) deaths.set(`${Number(d[1]) * 60 + Number(d[2])}\u0000${d[3]}`, i);
    const c = line.match(CC_ON_ENEMY_LINE);
    if (c)
      landed.push({
        at: Number(c[1]) * 60 + Number(c[2]),
        target: c[3]!,
        spell: c[4]!,
        by: c[5]!,
        line: i,
      });
  });
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!PEEL_DATA_LINE.test(line)) return;
    const m = line.match(PEEL_LINE);
    if (!m) {
      failures.push(
        `line ${i + 1}: [PEEL OPTION] 格式不符(整行必须按生成格式)—— ${line.trim().slice(0, 160)}`,
      );
      return;
    }
    const from = Number(m[1]) * 60 + Number(m[2]);
    const to = Number(m[3]) * 60 + Number(m[4]);
    const [owner, spell, target] = [m[5]!, m[6]!, m[7]!];
    const n = Number(m[8]);
    const attacker = m[9]!;
    const victim = m[10]!;
    const death = Number(m[11]) * 60 + Number(m[12]);
    const atS = Number(m[13]) * 60 + Number(m[14]);
    const dr = m[15]!;
    const trinketUnit = m[16];
    const deathLine = deaths.get(`${death}\u0000${victim}`);
    const why: string[] = [];
    if (attacker !== target)
      why.push(`伤害占比写的是 ${attacker},不是控制目标`);
    if (trinketUnit && trinketUnit !== target)
      why.push(`饰品事实写的是 ${trinketUnit},不是控制目标`);
    if (atS !== from) why.push(`at ${fmtTime(atS)} 不是时段起点`);
    if (deathLine === undefined)
      why.push(`没有 ${victim} 在 ${fmtTime(death)} 的 [DEATH] 行`);
    if (from < death - PEEL_LOOKBACK_S || to > death || from > to)
      why.push(
        `可用时段 ${fmtTime(from)}–${fmtTime(to)} 不在死前 ${PEEL_LOOKBACK_S} 秒内`,
      );
    if (n < PEEL_MIN_USABLE_S || n > to - from + 1)
      why.push(`可用 ${n} 秒与门槛 ${PEEL_MIN_USABLE_S} 秒 / 时段长度不符`);
    if (dr === "Immune") why.push("递减为 Immune");
    // in the death's own second, only a landing printed before the [DEATH]
    // line came before it: the timeline orders a second's lines by their
    // instants (wide 240-16 1:42: a Paralysis 228 ms after the death)
    const used = landed.find(
      (c) =>
        c.by === owner &&
        c.target === target &&
        c.spell === spell &&
        c.at >= death - PEEL_LOOKBACK_S &&
        (c.at < death ||
          (c.at === death &&
            (deathLine === undefined || c.line < deathLine))),
    );
    if (used)
      why.push(
        `${fmtTime(used.at)} 已有 ${owner} 的 ${spell} 落在 ${target} 身上`,
      );
    if (why.length)
      failures.push(
        `line ${i + 1}: [PEEL OPTION] 自相矛盾(${why.join(";")})—— ${line.trim().slice(0, 160)}`,
      );
  });
  return failures;
}

const CC_BOOKMARK_DATA_LINE = /^\s*\d+:\d{2}–\d+:\d{2}\s+\[CC BOOKMARK\]/;
const CC_BOOKMARK_LINE =
  /^\s*(\d+):(\d{2})–(\d+):(\d{2})\s+\[CC BOOKMARK\]\s+(.+?) → (\S+): (?:during your Burst #(\d+) \((\d+):(\d{2})–(\d+):(\d{2})\) on \S+, their healer was not CC'd|(\S+) did (\d+)% of (\S+)'s damage taken in the \[DMG SPIKE\] (\d+):(\d{2})–(\d+):(\d{2})) \| at (\d+):(\d{2}): [\d.]+yd, DR Full(?:, (\S+) PvP trinket (?:ready|on cooldown))?$/;
const BURST_LEDGER_LINE = /^\s*Burst #(\d+) — (\d+):(\d{2})–(\d+):(\d{2}) \|/;
const DMG_SPIKE_BOUNDS_LINE =
  /^\s*(\d+):(\d{2})–(\d+):(\d{2})\s+\[DMG SPIKE\]\s+(\S+) \(/;
const YOU_CC_LINE = /^\s*(\d+):(\d{2})\s+\[YOU\] \[CC\]\s+(.+?) →/;
const CC_ON_ENEMY_HEAD_LINE = /^\s*(\d+):(\d{2})\s+\[CC ON ENEMY\]\s+(\S+) ← /;
/**
 * A `[CC ON ENEMY]` line from its `(by …)` to the end, in the two forms the
 * producer writes: `(Ns)` + optional ` [DR: …]` (cc-dr F-CE1) + optional
 * logged-end clause (`formatCcLoggedEnd`, FT-T08 step 3c) — group 1 = the
 * span — or the Tremor form, which has no `(Ns)`. Read as head + tail, not
 * as one pattern with a lazy `.*?` in front of optional groups: that
 * swallowed the span whenever something unknown followed it and let any
 * clause through (agy review of step 3c). Checked against all 58,321
 * `[CC ON ENEMY]` lines of the 605-file capture: 0 unmatched, 121 Tremor.
 */
const CC_ON_ENEMY_TAIL = new RegExp(
  String.raw`\((?:by [^|]*?|reflected back)\)(?:(?: \((?:${CC_STILL_ON_AT_ROUND_END}, )?(?:(\d+(?:\.\d+)?)s|<1s)(?: in)?\))?(?: \[DR: [^\]]+\])?${CC_LOGGED_END_NOTE_RE_SRC}|(?: \[DR: [^\]]+\])? \| enemy Tremor Totem from \S+ ended this CC after (?:\d+|<1)s \(cut short — it had not expired\))\s*$`,
);
const CC_USE_COUNTS_LINE = /^\s*Counts: (.*)$/;
const CC_USE_COUNT_ITEM = /^(.+) cast (\d+)× \(first (\d+):(\d{2})\)$/;
/** `formatCcUseCount`'s started form — `checkCcUseStartedCounts`' class. */
const CC_USE_STARTED_ITEM =
  /^(.+) cast bar started (\d+)×, went off (\d+)×(?: \(first (\d+):(\d{2})\))?$/;
/** A kit entry's `[UNUSED]` tag and its note — the producer's own pattern
 * (`context/kitUnusedNote.ts`): group 1 = the K of `started K×, never
 * finished`. */
const KIT_UNUSED_NOTE = new RegExp(KIT_UNUSED_NOTE_RE_SRC);

/**
 * `[CC BOOKMARK]` / CC USE counts (32nd hardFailure class, GH #77 part 2,
 * user 2026-09-24 after four codex astra rounds). The producer
 * (`context/ccUse.ts`) keeps a bookmark only when every condition held on each
 * of >= CC_USE_MIN_S consecutive whole seconds (render-second policy of
 * `ccSamplerFor`), inside a burst it cites by the <burst_ledger> number or a
 * [DMG SPIKE] on a teammate whose dominant attacker did >= CC_USE_MIN_SHARE of
 * the damage; at most CC_USE_CAP per round. All three constants are imported.
 *
 * Scope, stated honestly: this checks the textual consistency of what a
 * bookmark asserts against other rendered lines — it does not re-derive the
 * full feasibility predicate (reach, LoS, immunity, breakers, the defense
 * share's arithmetic). It fails:
 *  - any `[CC BOOKMARK]` data line that does not match the exact format to the
 *    end of the line (malformed lines also count toward the cap);
 *  - a span shorter than the door, or an `at m:ss` that is not its start;
 *  - a cited burst / teammate spike that is missing, has other bounds, or does
 *    not contain the span; a defense target that is not the named attacker, or
 *    a share under the door; a trinket fact about another unit;
 *  - a `[CC ON ENEMY]` on the bookmark's target active inside the span, or a
 *    `[YOU] [CC]` of that spell inside it;
 *  - more bookmarks than the cap;
 *  - counts contradicted by rendered casts (a "not cast" CC with a `[YOU]
 *    [CC]` line, a rendered cast before the stated first, or more rendered
 *    casts than N — the timeline may omit casts, so fewer is allowed).
 */
export function checkCcBookmarkConsistency(lines: string[]): string[] {
  const bursts = new Map<number, [number, number]>();
  const spikes: Array<{ from: number; to: number; unit: string }> = [];
  const youCc: Array<{ at: number; spell: string }> = [];
  const enemyCc: Array<{ from: number; to: number; unit: string }> = [];
  const unreadableCc: string[] = [];
  let countItems: string[] = [];
  lines.forEach((line, i) => {
    const e = line.match(CC_ON_ENEMY_HEAD_LINE);
    if (!e) return;
    const tail = line.match(CC_ON_ENEMY_TAIL);
    if (!tail)
      unreadableCc.push(
        `line ${i + 1}: [CC ON ENEMY] 行尾不是生成格式(时长 / DR / 结束原因子句)—— ${line.trim().slice(0, 160)}`,
      );
    const at = Number(e[1]) * 60 + Number(e[2]);
    // the Tremor form carries no span of its own here (as before)
    const dur = tail?.[1] ? Number(tail[1]) : 0;
    enemyCc.push({ from: at, to: at + Math.max(dur, 1) - 1, unit: e[3]! });
  });
  for (const line of lines) {
    const b = line.match(BURST_LEDGER_LINE);
    if (b)
      bursts.set(Number(b[1]), [
        Number(b[2]) * 60 + Number(b[3]),
        Number(b[4]) * 60 + Number(b[5]),
      ]);
    const d = line.match(DMG_SPIKE_BOUNDS_LINE);
    if (d)
      spikes.push({
        from: Number(d[1]) * 60 + Number(d[2]),
        to: Number(d[3]) * 60 + Number(d[4]),
        unit: d[5]!,
      });
    const y = line.match(YOU_CC_LINE);
    if (y) youCc.push({ at: Number(y[1]) * 60 + Number(y[2]), spell: y[3]! });
    const c = line.match(CC_USE_COUNTS_LINE);
    if (c) countItems = c[1]!.split(" · ");
  }
  const failures: string[] = [...unreadableCc];
  let bookmarks = 0;
  lines.forEach((line, i) => {
    if (!CC_BOOKMARK_DATA_LINE.test(line)) return;
    bookmarks++;
    const m = line.match(CC_BOOKMARK_LINE);
    if (!m) {
      failures.push(
        `line ${i + 1}: [CC BOOKMARK] 格式不符(整行必须按生成格式)—— ${line.trim().slice(0, 160)}`,
      );
      return;
    }
    const from = Number(m[1]) * 60 + Number(m[2]);
    const to = Number(m[3]) * 60 + Number(m[4]);
    const spell = m[5]!;
    const target = m[6]!;
    const atS = Number(m[19]) * 60 + Number(m[20]);
    const trinketUnit = m[21];
    const why: string[] = [];
    if (to - from + 1 < CC_USE_MIN_S)
      why.push(`时段 ${to - from + 1} 秒短于门槛 ${CC_USE_MIN_S} 秒`);
    if (atS !== from) why.push(`at ${fmtTime(atS)} 不是时段起点`);
    if (trinketUnit && trinketUnit !== target)
      why.push(`饰品事实写的是 ${trinketUnit},不是书签目标`);
    if (m[7]) {
      const k = Number(m[7]);
      const a = Number(m[8]) * 60 + Number(m[9]);
      const z = Number(m[10]) * 60 + Number(m[11]);
      const burst = bursts.get(k);
      if (!burst || burst[0] !== a || burst[1] !== z)
        why.push(`没有 Burst #${k} ${fmtTime(a)}–${fmtTime(z)} 这一行`);
      else if (from < a || to > z) why.push("书签不在引用的爆发内");
    } else {
      const attacker = m[12]!;
      const pct = Number(m[13]);
      const mate = m[14]!;
      const a = Number(m[15]) * 60 + Number(m[16]);
      const z = Number(m[17]) * 60 + Number(m[18]);
      if (attacker !== target) why.push("书签目标不是施压的攻击者");
      if (pct < Math.round(CC_USE_MIN_SHARE * 100))
        why.push(`占比 ${pct}% 低于门槛`);
      if (
        !spikes.some((sp) => sp.unit === mate && sp.from === a && sp.to === z)
      )
        why.push(
          `没有 ${mate} 在 ${fmtTime(a)}–${fmtTime(z)} 的 [DMG SPIKE] 行`,
        );
      else if (from < a || to > z) why.push("书签不在引用的施压窗口内");
    }
    const ccd = enemyCc.find(
      (c) => c.unit === target && c.from <= to && c.to >= from,
    );
    if (ccd) why.push(`${fmtTime(ccd.from)} 起 ${target} 已在控制中`);
    const cast = youCc.find(
      (y) => y.spell === spell && y.at >= from && y.at <= to,
    );
    if (cast) why.push(`${fmtTime(cast.at)} 已放出 ${spell}`);
    if (why.length)
      failures.push(
        `line ${i + 1}: [CC BOOKMARK] 自相矛盾(${why.join(";")})—— ${line.trim().slice(0, 160)}`,
      );
  });
  if (bookmarks > CC_USE_CAP)
    failures.push(`[CC BOOKMARK] ${bookmarks} 条,超过上限 ${CC_USE_CAP}`);
  for (const item of countItems) {
    if (item.endsWith(" not cast")) {
      const sp = item.slice(0, -" not cast".length);
      const cast = youCc.find((y) => y.spell === sp);
      if (cast)
        failures.push(
          `CC USE 计数说 ${sp} not cast,但 ${fmtTime(cast.at)} 有 [YOU] [CC] ${sp}`,
        );
      continue;
    }
    // the started form is `checkCcUseStartedCounts`' class
    if (CC_USE_STARTED_ITEM.test(item)) continue;
    const m = item.match(CC_USE_COUNT_ITEM);
    if (!m) {
      failures.push(`CC USE 计数格式不符:${item}`);
      continue;
    }
    const sp = m[1]!;
    const n = Number(m[2]);
    const first = Number(m[3]) * 60 + Number(m[4]);
    const rendered = youCc.filter((y) => y.spell === sp);
    if (rendered.length > n)
      failures.push(
        `CC USE 计数说 ${sp} ${n} 次,但时间线有 ${rendered.length} 条 [YOU] [CC]`,
      );
    const early = rendered.find((y) => y.at < first);
    if (early)
      failures.push(
        `CC USE 计数说 ${sp} 首次 ${fmtTime(first)},但 ${fmtTime(early.at)} 已有 [YOU] [CC]`,
      );
  }
  return failures;
}

/**
 * CC USE `<spell> cast bar started N×, went off M×[ (first m:ss)]` (FT-T16
 * D15 "2c", user approval 2026-10-10). The producer (`context/ccUse.ts` →
 * `formatCcUseCount`) writes this form for a control with a cast time only
 * when fewer casts went off (SPELL_CAST_SUCCESS) than cast bars were begun
 * (SPELL_CAST_START); with M ≥ N the entry is the plain `cast M×` / `not
 * cast`, which `checkCcBookmarkConsistency` reads. It fails:
 *  - N < 1 or M ≥ N (the form claims bars that did not go off);
 *  - a `(first m:ss)` with M = 0, or none with M > 0;
 *  - a second entry of the same spell on the line (two readings of one
 *    spell's casts);
 *  - like the plain form: more `[YOU] [CC]` lines of that spell than M, or
 *    one before the stated first (the timeline may omit casts, so fewer is
 *    allowed);
 *  - a disagreement with the log owner's `<cooldowns>` kit, which states the
 *    same bars for a cooldown never spent — `[UNUSED — started K×, never
 *    finished]` (`resourceSnapshot.ts`; both lines count
 *    `castBarsOfCooldown`): a spell the kit calls UNUSED must read
 *    `cast bar started K×, went off 0×` here when K ≥ 1, and may not read the
 *    started form at all when the kit's `[UNUSED]` carries no K.
 * A started-form entry the pattern does not read falls to
 * `checkCcBookmarkConsistency`'s "格式不符".
 */
export function checkCcUseStartedCounts(lines: string[]): string[] {
  const youCc: Array<{ at: number; spell: string }> = [];
  let countItems: string[] = [];
  for (const line of lines) {
    const y = line.match(YOU_CC_LINE);
    if (y) youCc.push({ at: Number(y[1]) * 60 + Number(y[2]), spell: y[3]! });
    const c = line.match(CC_USE_COUNTS_LINE);
    if (c) countItems = c[1]!.split(" · ");
  }
  const spellOf = (item: string) =>
    item.match(CC_USE_STARTED_ITEM)?.[1] ??
    item.match(CC_USE_COUNT_ITEM)?.[1] ??
    (item.endsWith(" not cast") ? item.slice(0, -" not cast".length) : item);
  const failures: string[] = [];
  // the kit's word on the same spell: null = not UNUSED there (or no kit),
  // else the K of `started K×, never finished` (0 for a bare `[UNUSED]`)
  const { kit } = ownerKitOf(lines);
  const kitUnusedStarted = (spell: string): number | null => {
    const u = kit?.get(spell)?.match(KIT_UNUSED_NOTE);
    return u ? Number(u[1] ?? 0) : null;
  };
  for (const item of countItems) {
    const k = kitUnusedStarted(spellOf(item));
    if (k === null) continue;
    const m = item.match(CC_USE_STARTED_ITEM);
    const agrees = m ? Number(m[2]) === k && Number(m[3]) === 0 : k === 0;
    if (!agrees)
      failures.push(
        `CC USE 计数与 <cooldowns> 对不上:技能组写 ${spellOf(item)} [UNUSED${k ? ` — started ${k}×, never finished` : ""}],计数写「${item}」`,
      );
  }
  for (const item of countItems) {
    const m = item.match(CC_USE_STARTED_ITEM);
    if (!m) continue;
    const sp = m[1]!;
    const started = Number(m[2]);
    const wentOff = Number(m[3]);
    const first =
      m[4] === undefined ? undefined : Number(m[4]) * 60 + Number(m[5]);
    if (started < 1 || wentOff >= started)
      failures.push(
        `CC USE 计数说 ${sp} 读条开了 ${started} 次、放出 ${wentOff} 次 —— 放出不少于开读时应写 cast N× / not cast:${item}`,
      );
    if ((wentOff === 0) !== (first === undefined))
      failures.push(
        `CC USE 计数的 (first m:ss) 与放出次数 ${wentOff} 不符:${item}`,
      );
    if (countItems.filter((x) => spellOf(x) === sp).length > 1)
      failures.push(`CC USE 计数里 ${sp} 出现了不止一条:${item}`);
    const rendered = youCc.filter((y) => y.spell === sp);
    if (rendered.length > wentOff)
      failures.push(
        `CC USE 计数说 ${sp} 放出 ${wentOff} 次,但时间线有 ${rendered.length} 条 [YOU] [CC]`,
      );
    const early =
      first === undefined ? undefined : rendered.find((y) => y.at < first);
    if (early)
      failures.push(
        `CC USE 计数说 ${sp} 首次放出 ${fmtTime(first!)},但 ${fmtTime(early.at)} 已有 [YOU] [CC]`,
      );
  }
  return failures;
}

const reEscape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CAST_STOPPED_DATA_LINE = /^\s*\d+:\d{2}\s+\[CAST STOPPED\]/;
/**
 * A `[CAST STOPPED]` line in full, built from the producer's own pieces
 * (`timelineSections/castStopped.ts`): 1–2 = m:ss, 3 = the spell, then one of
 * 4 = `cast bar stopped after N.Ns` + a `CAST_STOPPED_NEAR_TEXT`,
 * 5 = `refused N.Ns in` + (6 = a wording the producer prints there,
 * `CAST_STOPPED_REFUSAL_WORDS` | the bracketed untranslated marker), 7 = `no end logged; the round ended N.Ns after it began`.
 */
const CAST_STOPPED_LINE = new RegExp(
  String.raw`^\s*(\d+):(\d{2})\s+${reEscape(CAST_STOPPED_TAG)}\s+(.+?) — (?:cast bar stopped after (\d+\.\d)s(?:${Object.values(
    CAST_STOPPED_NEAR_TEXT,
  )
    .map(reEscape)
    .join(
      "|",
    )})|refused (\d+\.\d)s in(?:: (${CAST_STOPPED_REFUSAL_WORDS.map(reEscape).join("|")})| ${reEscape(CAST_REFUSED_OTHER_REASON)})|no end logged; the round ended (\d+\.\d)s after it began)$`,
);
const KICK_ON_UNIT_LINE =
  /^\s*\d+:\d{2}\s+\[KICK\]\s+.+? interrupted (\d+)\([^)]*\)'s (.+?) \(/;
const REJECTED_LINE =
  /^\s*(\d+):(\d{2})\s+\[REJECTED\]\s+your (.+?) ×\d+ — (.+?)(?: \(\d+:\d{2}–(\d+):(\d{2})\))?$/;

/**
 * `[CAST STOPPED]` (FT-T16 D15 "2b", user approval 2026-10-10): one line per
 * control cast bar the log owner began that did not go off and was not
 * kicked. The producer (`timelineSections/castStopped.ts`) reads the raw log,
 * which the prompt does not carry, so the gate checks what the text can. It
 * fails:
 *  - a line that is not one of the producer's wordings to its last character
 *    — an HP token, a target, "cancelled" / "moved", a quoted client string;
 *  - an elapsed time past `JUKE_LOOKBACK_MS`, the cap of the window a bar's
 *    end row is looked for in (`ownerCastBarOutcomes`);
 *  - a spell with no entry on CC USE's `Counts:` line: the lines and the
 *    `cast bar started N×` count are one set of bars
 *    (`ownerControlCastBars`), under one name;
 *  - more lines of a spell, plus `[KICK]` lines on the log owner's casts of
 *    it, than the entry has bars: N for `cast bar started N×, went off M×`,
 *    M for the plain `cast M×` (printed only when no more bars than casts
 *    were begun), none for `not cast`. A kicked bar has its `[KICK]` line
 *    and no line here, so the two families never count one bar twice;
 *  - a refusal a `[REJECTED]` line of that spell and reason already states:
 *    every second the refusal can have fallen on (the line's second + the
 *    printed N.N, rendered on the whole-second grid) inside that line's span.
 *
 * NOT checked, because it does not hold: lines ≤ N − M. `went off M×` counts
 * every SPELL_CAST_SUCCESS of the spell, one with no cast bar included (an
 * instant proc), so M can exceed the bars that completed.
 */
export function checkCastStoppedLines(lines: string[]): string[] {
  const failures: string[] = [];
  const { ownerId } = ownerKitOf(lines);
  let countItems: string[] | null = null;
  const kicked = new Map<string, number>();
  const rejected: Array<{
    from: number;
    to: number;
    spell: string;
    why: string;
  }> = [];
  for (const line of lines) {
    const c = line.match(CC_USE_COUNTS_LINE);
    if (c) countItems = c[1]!.split(" · ");
    const k = line.match(KICK_ON_UNIT_LINE);
    if (k && k[1] === ownerId) kicked.set(k[2]!, (kicked.get(k[2]!) ?? 0) + 1);
    const r = line.match(REJECTED_LINE);
    if (r) {
      const from = Number(r[1]) * 60 + Number(r[2]);
      rejected.push({
        from,
        to: r[5] === undefined ? from : Number(r[5]) * 60 + Number(r[6]),
        spell: r[3]!,
        why: r[4]!,
      });
    }
  }
  const perSpell = new Map<string, number>();
  lines.forEach((line, i) => {
    if (!CAST_STOPPED_DATA_LINE.test(line)) return;
    const m = line.match(CAST_STOPPED_LINE);
    if (!m) {
      failures.push(
        `line ${i + 1}: [CAST STOPPED] 不是生成格式(整行必须是生成器的措辞之一;不带血量、目标或客户端原文)—— ${line.trim().slice(0, 160)}`,
      );
      return;
    }
    const at = Number(m[1]) * 60 + Number(m[2]);
    const spell = m[3]!;
    perSpell.set(spell, (perSpell.get(spell) ?? 0) + 1);
    const elapsed = Number(m[4] ?? m[5] ?? m[7]);
    if (elapsed > JUKE_LOOKBACK_MS / 1000)
      failures.push(
        `line ${i + 1}: [CAST STOPPED] 写读条 ${elapsed} 秒后才结束,超过读条配对窗口 ${JUKE_LOOKBACK_MS / 1000} 秒 —— ${line.trim().slice(0, 160)}`,
      );
    if (m[6] !== undefined) {
      // the refusal row sits `elapsed` (printed to 0.1 s) after a start
      // somewhere inside the line's second
      const lo = Math.floor(at + elapsed - 0.05);
      const hi = Math.floor(at + elapsed + 1.05);
      const twin = rejected.find(
        (r) =>
          r.spell === spell && r.why === m[6] && r.from <= lo && hi <= r.to,
      );
      if (twin)
        failures.push(
          `line ${i + 1}: [CAST STOPPED] 的这次被拒已经由 ${fmtTime(twin.from)} 的 [REJECTED] 行说过(同技能、同原因、时间落在它的区间内)—— ${line.trim().slice(0, 160)}`,
        );
    }
  });
  for (const [spell, n] of perSpell) {
    const item = (countItems ?? []).find(
      (x) =>
        x === `${spell} not cast` ||
        x.match(CC_USE_STARTED_ITEM)?.[1] === spell ||
        x.match(CC_USE_COUNT_ITEM)?.[1] === spell,
    );
    if (item === undefined) {
      failures.push(
        `[CAST STOPPED] 有 ${n} 行 ${spell},但 CC USE 计数行里没有 ${spell} 这一项`,
      );
      continue;
    }
    const started = item.match(CC_USE_STARTED_ITEM);
    const bars = started
      ? Number(started[2])
      : Number(item.match(CC_USE_COUNT_ITEM)?.[2] ?? 0);
    const kicks = kicked.get(spell) ?? 0;
    if (n + kicks > bars)
      failures.push(
        `[CAST STOPPED] 有 ${n} 行 ${spell}${kicks ? `,另有 ${kicks} 条你被踢断 ${spell} 的 [KICK] 行` : ""},超过 CC USE 计数的读条数 ${bars}:${item}`,
      );
  }
  return failures;
}

/**
 * kick-eaten's `yourCancels` against the `[CAST STOPPED]` lines — one reading
 * of how a cast bar ended (`ownerCastBarOutcomes`), stated in two places. A
 * control bar whose line reads `cast bar stopped after N.Ns; not kicked; no
 * control, silence or knockback landed on you then`
 * (`CAST_STOPPED_NEAR_TEXT.none`) is a cancel of the ledger
 * (`ownerCastCancels`): a `stopped` bar with nothing landing on the owner.
 *
 * Only an inequality holds. The ledger counts every cast-time spell and is
 * not clamped to the round; the lines exist for controls begun inside the
 * round and may be fewer than the bars. So the gate fails a kick-eaten row
 * whose `yourCancels` is BELOW the number of those lines, and nothing else.
 * `yourCancels` is a round-wide count, the same on every kick-eaten row of
 * the prompt.
 *
 * Until 2026-10-11 the ledger left out a bar with a refused key press before
 * its stop (`earlierFailure`), which the line did state — the one way the
 * count could fall below the lines.
 */
export function checkKickEatenCancelsCoverCastStopped(
  lines: string[],
): string[] {
  let stopped = 0;
  for (const line of lines)
    if (
      CAST_STOPPED_DATA_LINE.test(line) &&
      line.endsWith(CAST_STOPPED_NEAR_TEXT.none) &&
      line.match(CAST_STOPPED_LINE)?.[4] !== undefined
    )
      stopped++;
  if (stopped === 0) return [];
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes("type=kick-eaten ")) return;
    const m = line.match(MENU_LINE_FACTS);
    if (!m) return;
    const cancels = parseFactsBlock(m[1]!)["yourCancels"];
    if (cancels === undefined) return;
    if (!(Number(cancels) >= stopped))
      failures.push(
        `line ${i + 1}: kick-eaten 写 yourCancels=${cancels},但时间线有 ${stopped} 条「没被踢、当时没有控制 / 沉默 / 击退落在你身上」的 [CAST STOPPED] 行 —— 这些读条每一次都是台账里的一次取消`,
      );
  });
  return failures;
}

/** A printed `N.Ns` is the exact elapsed time rounded to a tenth. */
const ONE_DECIMAL_HALF_STEP_S = 0.05;

/**
 * `[CAST STOPPED]` against the round's end AS THE PROMPT STATES IT
 * (`statedRoundEnd`: `[MATCH END]`, and a Solo Shuffle round's first
 * `[DEATH]` line) — FT I11. The producer cuts the lines at `roundEndMs`
 * (`castStoppedText`), with the test the cancel ledger counts by
 * (`isCancelInRound`): a cast bar stopped at or after the round's end is the
 * round ending, not the player stopping a cast, and a bar begun after it is
 * not the round's. On the render grid, with R the stated second, T the
 * line's second (the bar's start, floored) and N.N the printed elapsed time:
 *  - the bar began inside the round: T ≤ R;
 *  - `cast bar stopped after N.Ns …` / `refused N.Ns in …`: the end row is
 *    before the round's end, so T + N.N < R + 1 + the rounding half-step;
 *  - `no end logged; the round ended N.Ns after it began`: the bar's start
 *    + N.N IS the round's end, so T + N.N is within 1 s + the half-step of
 *    R on either side.
 *
 * Before the cut the lines ran to the LOG's end, ~2 s after a Solo Shuffle
 * round's ending death: f0a10402 round 3 printed `1:44 [CAST STOPPED] Mind
 * Control — cast bar stopped after 0.5s; not kicked; …` under a first
 * `[DEATH]` at 1:43 — the bar was begun 0.08 s after that death and broken
 * by the round ending; the ledger counted it as a cancel.
 */
export function checkCastStoppedWithinRound(lines: string[]): string[] {
  const failures: string[] = [];
  const end = statedRoundEnd(lines);
  if (end === null) return failures;
  const slack = 1 + ONE_DECIMAL_HALF_STEP_S + 1e-6;
  lines.forEach((line, i) => {
    if (!CAST_STOPPED_DATA_LINE.test(line)) return;
    // a line that is not one of the producer's wordings is
    // `checkCastStoppedLines`' failure, not this gate's
    const m = line.match(CAST_STOPPED_LINE);
    if (!m) return;
    const began = Number(m[1]) * 60 + Number(m[2]);
    const where = `(${end.says}在 ${fmtTime(end.second)})—— ${line.trim().slice(0, 160)}`;
    if (began > end.second) {
      failures.push(
        `line ${i + 1}: [CAST STOPPED] 的读条开始于回合结束之后 ${where}`,
      );
      return;
    }
    const endRow = m[4] ?? m[5];
    if (endRow !== undefined && began + Number(endRow) > end.second + slack)
      failures.push(
        `line ${i + 1}: [CAST STOPPED] 写读条 ${endRow} 秒后结束,那已在回合结束之后 —— 回合结束打断的读条不是玩家自己停的 ${where}`,
      );
    if (m[7] !== undefined) {
      const at = began + Number(m[7]);
      if (at > end.second + slack || at < end.second - slack)
        failures.push(
          `line ${i + 1}: [CAST STOPPED] 写回合在读条开始 ${m[7]} 秒后结束,与回合结束时刻对不上 ${where}`,
        );
    }
  });
  return failures;
}

/** 1 = m:ss, 2 = the kicker's label, 3 = `<victim>'s <spell>` (or the bare
 * victim when the log named no spell), 4 = the kick and its `back` note. */
const KICK_INTERRUPTED_LINE =
  /^\s*(\d+:\d{2})\s+\[KICK\]\s+(.+?) interrupted (.+) \(([^()]*)\)$/;
/** 1 = m:ss, 2 = the owner's kick, 3 = its target's label, 4 = the faked
 * spell; a trailing miss tag (`kickMissTag`) is not part of the spell. */
const KICK_JUKED_BY_FAKE_LINE = new RegExp(
  String.raw`^\s*(\d+:\d{2})\s+\[KICK\]\s+your (.+?) on (.+?) — ${reEscape(JUKED_BY_FAKE_HEAD)}(.+?)(?: \[[^\]]*\])?$`,
);

/**
 * `[KICK] your K on N — JUKED by fake Y` against the `[KICK] … interrupted
 * N's Y (…)` lines (FT F12): a cast bar somebody's interrupt ended was not a
 * fake. The kick audit reads how the target's LAST bar before the kick ended
 * (`castBarOutcomesOf`: `kicked` is no fake); of that the prompt carries the
 * interrupt lines, so the gate fails a JUKED line that follows, inside the
 * same rendered second, an interrupt of that very spell on that very target
 * — the target is inside the lockout then and cannot have begun the spell
 * again. The timeline is in time order within a second, so "follows" is
 * read off the line order; a fake BEFORE the interrupt in that second
 * passes.
 *
 * Until 2026-10-11 the audit named the EARLIEST unfinished bar of its
 * look-back, so a kick 0.14 s after a teammate's Rebuke had interrupted the
 * second Haunt read "JUKED by fake Haunt" off the first one (8930cb36 0:59):
 * 9 of the 562 `JUKED by fake` lines on the 605-file capture of 8c3275fa.
 * A completed cast and a wrongly named fake leave no line to check — the
 * prompt does not print an enemy's cast bars.
 */
export function checkJukedKickNotAfterInterrupt(lines: string[]): string[] {
  const failures: string[] = [];
  let second = "";
  let interrupted = new Map<string, string>();
  lines.forEach((line, i) => {
    const kicked = line.match(KICK_INTERRUPTED_LINE);
    const juked = kicked ? null : line.match(KICK_JUKED_BY_FAKE_LINE);
    const at = kicked?.[1] ?? juked?.[1];
    if (at === undefined) return;
    if (at !== second) {
      second = at;
      interrupted = new Map();
    }
    if (kicked) interrupted.set(kicked[3]!, line.trim());
    if (!juked) return;
    const earlier = interrupted.get(`${juked[3]}'s ${juked[4]}`);
    if (earlier)
      failures.push(
        `line ${i + 1}: [KICK] 写被 ${juked[3]} 的假 ${juked[4]} 骗了,但同一秒里前面已有「${earlier.slice(0, 120)}」—— 那条读条是被打断的,不是假读条;打断后的锁定期内对方也起不了同一个法术 —— ${line.trim().slice(0, 160)}`,
      );
  });
  return failures;
}

const CC_NOT_LANDED_DATA_LINE = /^\s*\d+:\d{2}\s+\[CC NOT LANDED\]/;
/** 1–2 = m:ss, 3 = the enemy, 4 = the spell, 5 = the caster's label (a
 * roster label, a summon's `N(Spec)'s pet`, or a bare name — nothing more
 * fits between `(by` and the dash), 6 = the log's miss type, 7 = the cause
 * (optional). */
const CC_NOT_LANDED_LINE = new RegExp(
  String.raw`^\s*(\d+):(\d{2})\s+${reEscape(CC_NOT_LANDED_TAG)}\s+(\S+) ← (.+?) \(by (\d+\([^()]*\)(?:'s [^()]+)?|[^()]+)\) — logged ([A-Z]+)(?: \((.+)\))?$`,
);
const CC_ON_ENEMY_BY_LINE =
  /^\s*(\d+):(\d{2})\s+\[CC ON ENEMY\]\s+(\S+) ← (.+?) \(by (\d+\([^)]*\)[^)]*)\)/;
/** A summon's label (`1(BDruid)'s pet`) → its player's. */
const playerOfLabel = (label: string) => label.replace(/'s .*$/, "");

/**
 * `[CC NOT LANDED]` (FT-T16 D15 "3b", user approval 2026-10-10): a control
 * by our team the log says did not land on an enemy player, on a line of its
 * own only when no other line states that miss. The producer
 * (`timelineSections/setup.ts` → `ccNotLandedLines`) reads SPELL_MISSED rows
 * the prompt does not carry; the gate checks what the text can. It fails:
 *  - a line that is not the producer's format to its last character;
 *  - a type outside `CONTROL_FAILED_MISS_TYPES` (imported — IMMUNE and the
 *    types the cast-line fail tags use; never ABSORB);
 *  - a `[CC ON ENEMY]` line for the same player's same spell on the same
 *    enemy at the same second: the control is on the target, so "not landed"
 *    is false (the producer drops a miss whose aura starts in its second);
 *  - the same miss also stated on that caster's cast line of that second —
 *    `[YOU] …` for the log owner, `[TEAM] … <caster> …` for a teammate — by
 *    the fail tag of that type (`[IMMUNE …]`, or `CC_MISS_TAG_WORD`'s
 *    `[MISSED on …]` / `[REFLECTED by …]` …) on that enemy.
 */
export function checkCcNotLandedLines(lines: string[]): string[] {
  const failures: string[] = [];
  const { ownerId } = ownerKitOf(lines);
  const landed = new Set<string>();
  for (const line of lines) {
    const c = line.match(CC_ON_ENEMY_BY_LINE);
    if (c)
      landed.add(
        [
          Number(c[1]) * 60 + Number(c[2]),
          c[3],
          c[4],
          playerOfLabel(c[5]!),
        ].join("\u0000"),
      );
  }
  lines.forEach((line, i) => {
    if (!CC_NOT_LANDED_DATA_LINE.test(line)) return;
    const m = line.match(CC_NOT_LANDED_LINE);
    if (!m) {
      failures.push(
        `line ${i + 1}: [CC NOT LANDED] 不是生成格式(<敌人> ← <技能> (by <施法者>) — logged <TYPE>[ (<原因>)])—— ${line.trim().slice(0, 160)}`,
      );
      return;
    }
    const at = Number(m[1]) * 60 + Number(m[2]);
    const [target, spell, by, type] = [m[3]!, m[4]!, m[5]!, m[6]!];
    const show = line.trim().slice(0, 160);
    if (!CONTROL_FAILED_MISS_TYPES.has(type))
      failures.push(
        `line ${i + 1}: [CC NOT LANDED] 写 logged ${type},但 ${type} 不是能断定控制没落地的 miss 类型 —— ${show}`,
      );
    // every reflect has its own [REFLECTED] line (`reflectedSpells`)
    if (type === "REFLECT")
      failures.push(
        `line ${i + 1}: [CC NOT LANDED] 写 logged REFLECT —— 反射一律由 [REFLECTED] 行陈述,这里不该再出一行 —— ${show}`,
      );
    if (landed.has([at, target, spell, playerOfLabel(by)].join("\u0000")))
      failures.push(
        `line ${i + 1}: [CC NOT LANDED] 说 ${spell} 没落在 ${target} 身上,但同一秒有同一施法者的 [CC ON ENEMY] 落地行 —— ${show}`,
      );
    // the same miss on that caster's cast line of that second
    const player = playerOfLabel(by);
    const isOwner = ownerId !== null && player.startsWith(`${ownerId}(`);
    const castLine = new RegExp(
      isOwner
        ? String.raw`^\s*${fmtTime(at)}\s+\[YOU\] \[(?:CC|CD)\]\s+${reEscape(spell)}(?: |$)`
        : String.raw`^\s*${fmtTime(at)}\s+\[TEAM\] \[(?:CC|CD)\]\s+${reEscape(player)} \([^)]*\)(?: cast|:) ${reEscape(spell)}(?: |$)`,
    );
    const word = CC_MISS_TAG_WORD[type];
    const states = (l: string) =>
      type === "IMMUNE"
        ? l.includes(`[IMMUNE: ${target}`) ||
          (/\[IMMUNE(?:\]| — )/.test(l) && l.includes(target))
        : word !== undefined &&
          l.includes(`[${word}${word === "MISSED" ? " on" : ""} ${target}`);
    const twin = lines.find((l) => castLine.test(l) && states(l));
    if (twin)
      failures.push(
        `line ${i + 1}: [CC NOT LANDED] 的这次 ${type} 已经写在同一秒的施法行上(${twin.trim().slice(0, 90)})—— ${show}`,
      );
  });
  return failures;
}

const FORCED_TRINKET_DATA_LINE = /^\s*\d+:\d{2}\s+\[FORCED TRINKET\]/;
const FORCED_TRINKET_LINE =
  /^\s*(\d+):(\d{2})\s+\[FORCED TRINKET\]\s+(\S+) used PvP trinket inside your team's kill attempt \[(\d+):(\d{2})–(\d+):(\d{2})\] on them → (\d+):(\d{2}) your (.+?) landed on (\S+) (\d+) s later \((\d+)s\)$/;
const UNIT_LEGEND_LINE = /<unit id="(\d+)" name="([^"]+)"[^>]*role="([^"]+)"/;
const ENEMY_TRINKET_AT_LINE =
  /^\s*(\d+):(\d{2})\s+\[ENEMY TRINKET\]\s+(\S+) used PvP trinket/;
const KILL_ATTEMPT_SPAN_LINE =
  /^\s*\[(\d+):(\d{2})–(\d+):(\d{2})\] on (\S+) — /;

/**
 * `[FORCED TRINKET]` quick follow-ups (33rd hardFailure class, GH #69, user
 * 2026-09-24 after two codex astra rounds). The producer
 * (`context/forcedTrinket.ts`) keeps an enemy PvP trinket that fell inside one
 * of our kill attempts on that enemy, followed by the log owner's own CC
 * landing on them shortly after and lasting long enough; at most
 * FORCED_FOLLOWUP_CAP per round. The gap, duration and span-membership
 * predicates are the producer's own exports. The gate fails a malformed data
 * line, and any line whose trinket has no same-second [ENEMY TRINKET] on that
 * unit, whose attempt span has no [KILL ATTEMPTS] line on that unit (resolved
 * through the `<unit>` legend) containing the trinket, whose follow-up has no
 * [CC ON ENEMY] line by the log owner on that unit, with that spell and that
 * duration — `(Ns)` or the Tremor form `ended this CC after Ns` — at that
 * second, whose stated gap is not the rendered difference or fails the
 * window, or whose duration fails the door; and more lines than the cap.
 * Only the aura line counts as evidence: the producer makes the timeline keep
 * it for an owner CC that otherwise renders on its [YOU] [CC] cast line only,
 * and a cast line shows neither the landing nor the duration (codex astra
 * implementation review: with a cast-line fallback, a 99 s claim passed).
 */
export function checkForcedTrinketConsistency(lines: string[]): string[] {
  const nameOfId = new Map<string, string>();
  let ownerId: string | null = null;
  const trinkets: Array<{ at: number; unit: string }> = [];
  const attempts: Array<{ from: number; to: number; name: string }> = [];
  for (const line of lines) {
    const u = line.match(UNIT_LEGEND_LINE);
    if (u) {
      nameOfId.set(u[1]!, u[2]!);
      if (u[3] === "log owner") ownerId = u[1]!;
    }
    const t = line.match(ENEMY_TRINKET_AT_LINE);
    if (t) trinkets.push({ at: Number(t[1]) * 60 + Number(t[2]), unit: t[3]! });
    const a = line.match(KILL_ATTEMPT_SPAN_LINE);
    if (a)
      attempts.push({
        from: Number(a[1]) * 60 + Number(a[2]),
        to: Number(a[3]) * 60 + Number(a[4]),
        name: a[5]!,
      });
  }
  const failures: string[] = [];
  let count = 0;
  lines.forEach((line, i) => {
    if (!FORCED_TRINKET_DATA_LINE.test(line)) return;
    count++;
    const m = line.match(FORCED_TRINKET_LINE);
    if (!m) {
      failures.push(
        `line ${i + 1}: [FORCED TRINKET] 格式不符 —— ${line.trim().slice(0, 160)}`,
      );
      return;
    }
    const tS = Number(m[1]) * 60 + Number(m[2]);
    const unit = m[3]!;
    const aFrom = Number(m[4]) * 60 + Number(m[5]);
    const aTo = Number(m[6]) * 60 + Number(m[7]);
    const cS = Number(m[8]) * 60 + Number(m[9]);
    const spell = m[10]!;
    const landedOn = m[11]!;
    const gap = Number(m[12]);
    const dur = Number(m[13]);
    const why: string[] = [];
    if (landedOn !== unit) why.push("后续控制的目标不是交饰品的人");
    if (gap !== cS - tS)
      why.push(`写的间隔 ${gap} 秒不等于渲染时间差 ${cS - tS} 秒`);
    if (!forcedFollowUpGapOk(tS, cS))
      why.push(`间隔超出 0–${FORCED_FOLLOWUP_MAX_GAP_S} 秒`);
    if (!forcedFollowUpDurOk(dur)) why.push(`时长 ${dur} 秒低于门槛`);
    if (!trinkets.some((t) => t.at === tS && t.unit === unit))
      why.push(`${fmtTime(tS)} 没有 ${unit} 的 [ENEMY TRINKET] 行`);
    const id = unit.match(/^(\d+)\(/)?.[1];
    const name = id ? nameOfId.get(id) : undefined;
    if (!name) why.push(`<unit> 图例里查不到 ${unit}`);
    else if (
      !attempts.some(
        (a) =>
          a.name === name &&
          a.from === aFrom &&
          a.to === aTo &&
          renderedInsideSpan(tS, a.from, a.to),
      )
    )
      why.push(
        `没有 [${fmtTime(aFrom)}–${fmtTime(aTo)}] on ${name} 且包含饰品时间的 [KILL ATTEMPTS] 行`,
      );
    const esc = spell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ccOn = ownerId
      ? new RegExp(
          `^\\s*${fmtTime(cS)}\\s+\\[CC ON ENEMY\\]\\s+${unit.replace(/[()]/g, "\\$&")} ← ${esc} \\(by ${ownerId}\\([^)]*\\)\\)(?: \\((?:${CC_STILL_ON_AT_ROUND_END}, )?${dur}s(?: in)?\\)(?: \\[DR: [^\\]]+\\])?${CC_LOGGED_END_NOTE_RE_SRC}$|(?: \\[DR: [^\\]]+\\])? \\| enemy Tremor Totem from \\S+ ended this CC after ${dur}s )`,
        )
      : null;
    if (!ccOn || !lines.some((l) => ccOn.test(l)))
      why.push(
        `${fmtTime(cS)} 没有你把 ${spell} 放到 ${unit} 身上、时长 ${dur} 秒的 [CC ON ENEMY] 行`,
      );
    if (why.length)
      failures.push(
        `line ${i + 1}: [FORCED TRINKET] 自相矛盾(${why.join(";")})—— ${line.trim().slice(0, 160)}`,
      );
  });
  if (count > FORCED_FOLLOWUP_CAP)
    failures.push(
      `[FORCED TRINKET] ${count} 条,超过上限 ${FORCED_FOLLOWUP_CAP}`,
    );
  return failures;
}

/**
 * A dispel backlash that is a SILENCE is not on a `[CC ON ENEMY]` line (FT
 * F22). The producer (`timelineSections/ccOnEnemy.ts`) renders an enemy's
 * silence-type backlash aura (`BACKLASH_AURA_CC_TYPE`: Unstable Affliction's
 * 196364) as a `[SILENCE]` line carrying `backlashCcTag("silence")`; it read
 * `[CC ON ENEMY] … ← Unstable Affliction (by …) (4s)` on 515 lines of the
 * 605-file capture, under a legend that says the [CC ON …] lines hold no
 * silences. Fails:
 *  - a `[CC ON ENEMY]` data line whose control is named after a silence-type
 *    backlash aura — unless a `[FORCED TRINKET]` line cites that landing
 *    (same second, spell and unit): the producer keeps that one line, the
 *    anchor `checkForcedTrinketConsistency` reads;
 *  - a `[SILENCE]` line that carries the backlash tag for a spell that is
 *    not such an aura.
 * The names are the table's own (`getEnglishSpellName` of each silence-type
 * aura id) — no list of spells here.
 */
export function checkBacklashSilenceFamily(lines: string[]): string[] {
  const names = new Set(
    [...BACKLASH_AURA_CC_TYPE]
      .filter(([, type]) => type === "silence")
      .map(([id]) => getEnglishSpellName(id)),
  );
  const tag = backlashCcTag("silence");
  const cited = new Set<string>();
  for (const line of lines) {
    const f = line.match(FORCED_TRINKET_LINE);
    if (f) cited.add(`${Number(f[8]) * 60 + Number(f[9])}|${f[10]}|${f[11]}`);
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const cc = line.match(
      /^\s*(\d+):(\d{2})\s+\[CC ON ENEMY\]\s+(\S+) ← (.+?) \(by /,
    );
    if (
      cc &&
      names.has(cc[4]!) &&
      !cited.has(`${Number(cc[1]) * 60 + Number(cc[2])}|${cc[4]}|${cc[3]}`)
    )
      failures.push(
        `line ${i + 1}: [CC ON ENEMY] 写的是驱散反噬的沉默(${cc[4]}),应当是 [SILENCE] 行 —— ${line.trim().slice(0, 160)}`,
      );
    const s = line.match(/^\s*\d+:\d{2}\s+\[SILENCE\]\s+\S+ ← (.+?) \(by /);
    if (s && line.includes(tag) && !names.has(s[1]!))
      failures.push(
        `line ${i + 1}: [SILENCE] 行带了${tag.trim()},但 ${s[1]} 不是沉默类的驱散反噬 —— ${line.trim().slice(0, 160)}`,
      );
  });
  return failures;
}

/**
 * A `Top sources:` / `Top damage in final Ns:` list names one source +
 * ability once (FT F22). The producer (`getTopDamageSourcesInWindow`) sums by
 * "source — English spell name"; keyed on the whole label it split an
 * ability wherever its spell ids did not carry the same school tag
 * (`4 — Eviscerate [Physical] (85k), …, 4 — Eviscerate [Shadow] (69k)`;
 * `4 — The Hunt (116k; 116k of it absorbed), 4 — The Hunt [Chaos] (108k)`) —
 * 312 of 20,847 lists on the 605-file capture. Read back through the
 * producer's own `parseTopSourceEntries`. Fails a list that is not in the
 * generated format to its end, and one with two entries of the same
 * `ability`.
 */
export function checkTopSourcesOneEntryPerAbility(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(TOP_SOURCE_LIST_RE);
    if (!m) return;
    const entries = parseTopSourceEntries(m[1]!);
    if (!entries) {
      failures.push(
        `line ${i + 1}: Top sources 列表不是生成格式 —— ${line.trim().slice(0, 160)}`,
      );
      return;
    }
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.ability))
        failures.push(
          `line ${i + 1}: Top sources 把同一来源的同一技能(${e.ability})拆成了两项 —— ${line.trim().slice(0, 160)}`,
        );
      seen.add(e.ability);
    }
  });
  return failures;
}

/** `1:38  [DEATH]  5(AWarrior) (Arms Warrior — enemy)` — the second and the
 *  dying unit's `<unit>` id. */
const DEATH_UNIT_LINE = /^(\d+):(\d{2})\s+\[DEATH\]\s+(\d+)\(/;

/**
 * Hard invariant (T12 ① d, user ruling 2026-10-10: a kill-attempt line does
 * not run past the target's death or the round's end). For every
 * `[m:ss–m:ss] on <target>` line of KILL ATTEMPTS:
 *
 *  - the bracket does not end after the round's end as the prompt states it
 *    (`statedRoundEnd` — `[MATCH END]`, and a Solo Shuffle round's first
 *    `[DEATH]` line);
 *  - a bracket that holds its target's death does not run on after it: with
 *    the target (resolved through the `<unit>` legend) on a `[DEATH]` line at
 *    second D, a bracket that starts at or before D ends at or before D —
 *    whatever its outcome reads, KILL or FAILED.
 *
 * The producer cuts both on the attempt object (`extractKillAttempts`: the
 * anchors at `roundEndMs`, every row credited with a death at that death), so
 * on the render grid the bracket's end second is at or before the line's — no
 * tolerance. Post-hoc review 45-FT-98 asked for this gate: nothing checked
 * that an attempt line stops at its target's death.
 */
export function checkKillAttemptBracketEnd(lines: string[]): string[] {
  const failures: string[] = [];
  const idOfName = new Map<string, string>();
  const firstDeathOfId = new Map<string, number>();
  for (const line of lines) {
    const u = line.match(UNIT_LEGEND_LINE);
    if (u) idOfName.set(u[2]!, u[1]!);
    const d = line.match(DEATH_UNIT_LINE);
    if (d) {
      const s = Number(d[1]) * 60 + Number(d[2]);
      firstDeathOfId.set(d[3]!, Math.min(firstDeathOfId.get(d[3]!) ?? s, s));
    }
  }
  const roundEnd = statedRoundEnd(lines);
  lines.forEach((line, i) => {
    const a = line.match(KILL_ATTEMPT_SPAN_LINE);
    if (!a) return;
    const from = Number(a[1]) * 60 + Number(a[2]);
    const to = Number(a[3]) * 60 + Number(a[4]);
    const show = `[${a[1]}:${a[2]}–${a[3]}:${a[4]}] on ${a[5]}`;
    if (roundEnd !== null && to > roundEnd.second)
      failures.push(
        `line ${i + 1}: KILL ATTEMPTS ${show} 结束于回合结束之后(${roundEnd.says}在 ${fmtTime(roundEnd.second)})`,
      );
    const id = idOfName.get(a[5]!);
    const death = id === undefined ? undefined : firstDeathOfId.get(id);
    if (death !== undefined && from <= death && to > death)
      failures.push(
        `line ${i + 1}: KILL ATTEMPTS ${show} 越过了目标的死亡(${fmtTime(death)} 的 [DEATH] 行)—— ${line.trim().slice(-60)}`,
      );
  });
  return failures;
}

/** The target of a `[KILL WINDOW]` / `[VULNERABLE]` line of either view:
 *  `[…] a–b[ (Ns)] on <Spec> (<Name>): …`. A realm may carry its own
 *  parentheses (`Target-Aggra(Português)-EU`) — one nested group is allowed,
 *  or the line was skipped and both window gates below silently passed
 *  (codex post-hoc review U1). */
const KILL_WINDOW_TARGET =
  /^\s*\[(?:KILL WINDOW|VULNERABLE)\] \d+:\d{2}–\d+:\d{2}(?: \(\d+s\))? on [^(]+ \(([^()]+(?:\([^()]*\)[^()]*)*)\):/;

/**
 * Hard invariant (F17, user ruling 2026-10-11, option b): a Holy Priest in
 * Spirit of Redemption form cannot be hit, so no kill window and no
 * kill-attempt bracket on that priest runs across the form. For every
 * `[KILL WINDOW]` / `[VULNERABLE]` span (the line's own and the `defenseless
 * a–b` it names) and every KILL ATTEMPTS bracket: no `[STATE]` tick strictly
 * between its two printed seconds shows its target (resolved through the
 * `<unit>` legend) as `:ghost` — `spanHoldsGhostSecond`, the producers' own
 * reading of "a cut span shares at most its boundary second with the form".
 *
 * The producers cut at the form's interval (`extractSpiritOfRedemptionIntervals`,
 * the `[STATE]` tick's source): `computeOffensiveWindows` step 2c subtracts
 * it from the vulnerability spans, `extractKillAttempts` ends a bracket where
 * the form begins. One-directional by construction: enemy ticks are printed
 * only inside critical windows, so a form no tick shows cannot be read here.
 */
export function checkNoWindowAcrossSpiritOfRedemption(
  lines: string[],
): string[] {
  const failures: string[] = [];
  const ghostSecondsOf = new Map<string, Set<number>>();
  for (const line of lines) {
    const st = line.match(STATE_LINE);
    if (!st) continue;
    const second = Number(st[1]) * 60 + Number(st[2]);
    for (const tok of st[3]!.matchAll(STATE_TOKEN))
      if (tok[2] === "ghost")
        ghostSecondsOf.set(
          tok[1]!,
          (ghostSecondsOf.get(tok[1]!) ?? new Set()).add(second),
        );
  }
  if (ghostSecondsOf.size === 0) return failures;
  const idOf = unitIdsByName(lines);
  const check = (
    i: number,
    line: string,
    what: string,
    targetName: string,
    from: number,
    to: number,
  ) => {
    const id = idOf.get(targetName);
    const ghost = id === undefined ? undefined : ghostSecondsOf.get(id);
    if (!ghost) return;
    const held = [...ghost]
      .filter((s) => spanHoldsGhostSecond(from, to, s))
      .sort((a, b) => a - b);
    if (held.length > 0)
      failures.push(
        `line ${i + 1}: ${what} ${fmtTime(from)}–${fmtTime(to)} 的目标 ${targetName} 在其中 ${held.map((s) => fmtTime(s)).join("、")} 的 [STATE] 行上是 :ghost(救赎之魂形态,打不到)—— ${line.trim().slice(0, 140)}`,
      );
  };
  lines.forEach((line, i) => {
    const w = line.match(KILL_WINDOW_SPAN);
    const target = w ? line.match(KILL_WINDOW_TARGET)?.[1] : undefined;
    if (w && target !== undefined) {
      check(
        i,
        line,
        `[${w[1]}] 的区间`,
        target,
        Number(w[2]) * 60 + Number(w[3]),
        Number(w[4]) * 60 + Number(w[5]),
      );
      const d = line.match(DEFENSELESS_SPAN);
      if (d)
        check(
          i,
          line,
          "defenseless 区间",
          target,
          Number(d[1]) * 60 + Number(d[2]),
          Number(d[3]) * 60 + Number(d[4]),
        );
    }
    const a = line.match(KILL_ATTEMPT_SPAN_LINE);
    if (a)
      check(
        i,
        line,
        "KILL ATTEMPTS 括号",
        a[5]!,
        Number(a[1]) * 60 + Number(a[2]),
        Number(a[3]) * 60 + Number(a[4]),
      );
  });
  return failures;
}

/** `m:ss  […] … Guardian Spirit … | save triggered N.Ns later (m:ss): a killing blow was prevented[, healed Nk]` */
const GUARDIAN_SAVE_LINE =
  /^(\d+):(\d\d) {2}\[.*\| save triggered (\d+\.\d)s later \((\d+):(\d\d)\): a killing blow was prevented(?:, healed (\d+)k)?(?: \||$| \[)/;

/**
 * The Guardian Spirit `| save triggered` clause (B-tier B18, 2026-10-07) is
 * rendered by `guardianSpiritSaveClause` from the priest's save heal
 * (`guardianSpiritSaveOf`). The text must agree with itself: the clause sits
 * on a Guardian Spirit press line, the delay is inside the predicate's own
 * window (`GUARDIAN_SPIRIT_SAVE_WINDOW_S`, imported — not a second number),
 * the stamp is the line's second plus the delay on the rendered grid (the
 * press is anywhere inside its floored second and the delay is rounded to
 * 0.1 s, so ±1 s), and a quoted heal is never 0k.
 */
export function checkGuardianSpiritSaveClause(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes("| save triggered ")) return;
    // the legend quotes the clause's shape
    if (line.includes("`| save triggered Ns later")) return;
    const fail = (why: string) =>
      failures.push(
        `line ${i + 1}: Guardian Spirit save clause (${why}) —— ${line.trim().slice(0, 200)}`,
      );
    const m = line.match(GUARDIAN_SAVE_LINE);
    if (!m) return fail("unreadable");
    if (!line.includes("Guardian Spirit"))
      return fail("not a Guardian Spirit line");
    const lineS = Number(m[1]) * 60 + Number(m[2]);
    const delay = Number(m[3]);
    const stampS = Number(m[4]) * 60 + Number(m[5]);
    if (delay > GUARDIAN_SPIRIT_SAVE_WINDOW_S)
      fail(
        `delay ${delay}s is past the ${GUARDIAN_SPIRIT_SAVE_WINDOW_S}s save window`,
      );
    if (Math.abs(stampS - (lineS + delay)) > 1.05)
      fail(`stamp ${m[4]}:${m[5]} is not the line's second + ${delay}s`);
    if (m[6] !== undefined && Number(m[6]) === 0) fail("healed 0k");
  });
  return failures;
}

/**
 * The Touch of Karma `| fed by` clause (B-tier B20a, 2026-10-07) is rendered
 * by `karmaFeedClause` (`utils/karmaFeed.ts`). The text must add up: the
 * per-player amounts, the DoT ticks, the hits of earlier presses and the
 * pressless rest (user ruling 2026-10-07, option B) are a partition of
 * `absorbed Nk in all` (each figure is rounded to 1k on its own, so the sum
 * may differ by one per figure — and a part under 0.5k is not printed at
 * all: KARMA_UNPRINTED_PARTS_K covers those), the clause sits on a Touch of
 * Karma line, no player is listed twice, and `nobody pressed into it` names
 * no player.
 */
/** Parts the clause leaves out because they round to 0k: up to three
 * players and the three unnamed parts, each under 0.5k. */
const KARMA_UNPRINTED_PARTS_K = 3;

export function checkKarmaFedClause(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const at = line.indexOf(" | fed by");
    if (at < 0 || !line.includes("[ENEMY DEF]")) return;
    const fail = (why: string) =>
      failures.push(
        `line ${i + 1}: Touch of Karma fed-by clause (${why}) —— ${line.trim().slice(0, 220)}`,
      );
    if (!line.slice(0, at).includes("Touch of Karma"))
      return fail("not a Touch of Karma line");
    const parts = line.slice(at + 3).split(" · ");
    const head = parts[0]!;
    const total = parts
      .map((p) => p.match(/^absorbed (\d+)k in all by \d+:\d\d$/))
      .find(Boolean);
    const sent = parts.find((p) => p.startsWith("sent back: "));
    if (!sent) return fail("no `sent back`");
    let figures: number[] = [];
    const players: string[] = [];
    const nobody = head.startsWith("fed by: nobody pressed into it");
    if (nobody) {
      // no per-player figure
    } else {
      const first = head.match(
        /^fed by \(pressed \d+ s or more after it went up\): (\S+) (\d+)k$/,
      );
      if (!first) return fail("unreadable head");
      players.push(first[1]!);
      figures.push(Number(first[2]));
    }
    for (const p of parts.slice(1)) {
      if (p === sent || /^absorbed \d+k in all by /.test(p)) continue;
      const dots = p.match(/^DoTs already ticking: (\d+)k$/);
      const before = p.match(/^pressed before that: (\d+)k$/);
      const rest = p.match(/^procs \/ auto-attacks \/ pets: (\d+)k$/);
      const player = p.match(/^(\S+) (\d+)k$/);
      const m = dots ?? before ?? rest ?? player;
      if (!m) return fail(`unreadable part "${p}"`);
      if (player && !dots && !before && !rest) players.push(player[1]!);
      figures = figures.concat(Number(m[m.length - 1]));
    }
    if (new Set(players).size !== players.length) fail("a player listed twice");
    if (nobody && players.length > 0)
      fail("`nobody pressed into it` beside a player's figure");
    if (figures.some((n) => n === 0)) fail("a 0k figure");
    if (!total) {
      if (figures.length) fail("figures without `absorbed Nk in all`");
      return;
    }
    const sum = figures.reduce((a, b) => a + b, 0);
    if (
      Math.abs(sum - Number(total[1])) >
      figures.length + KARMA_UNPRINTED_PARTS_K
    )
      fail(`parts sum to ${sum}k, total says ${total[1]}k`);
  });
  return failures;
}

/** `      [RES] rdy:<…>  cd:<…>[  enemy:… / focus:… / cc:… | Atonements: N]` */
const RES_ROW =
  /^ {6}\[RES\] rdy:(.*?) {2}cd:(.*?)(?: {2}(?:enemy|focus|cc):| \| Atonements|$)/;
/** A `cd:` entry whose return is exact: `Name(Ns)` — no `a–b` range, no `≤`,
 * no charge suffix. */
const RES_CD_EXACT = /^(.*)\((\d+)s\)$/;
/** A ledger name without its display suffixes (`[1/2]`, `(no mana 6.1k/11.5k)`). */
const resLedgerName = (n: string): string =>
  n.trim().replace(/(\[[\d–-]+\/\d+\]|\(no mana [^)]*\))+$/, "");
/** The ledger joins entries with a bare comma; a name may hold ", " itself
 * (Invoke Chi-Ji, the Red Crane). */
const splitResList = (s: string): string[] => s.split(/,(?! )/);

/**
 * The [RES] delta chain must let a reader follow a cooldown back to ready.
 * A row prints `cd:X(Ns)`: X is back N s after that row's second. At the
 * first later row at least 1 s past that moment, the reader's picture — the
 * last full `rdy:` list plus every `+X` / `-X` since — must hold X as ready,
 * unless that row lists X under `cd:` again (pressed again).
 *
 * What it catches: the delta state taken at another instant than the row
 * prints. Main 7315f4fd, 605 S2 files: 2,826 of 33,050 followed returns
 * (8.6 %, in 1,569 of 3,520 prompts) were never shown — the state was read at
 * the request's fractional instant with the availability slack on top, so a
 * cooldown back within a second of a row was "already ready" in the state
 * and never printed as `+X`. With the state read at the row's rendered
 * second: 0 of 33,227.
 *
 * Only exact `(Ns)` entries are followed. The check stops at the prompt's
 * first friendly [DEATH]: a dead holder's entries leave the ledger without a
 * `-X` (F-C4) and a death row cuts what was out of reach (B14a), by design.
 */
export function checkResReturnAnnounced(lines: string[]): string[] {
  const failures: string[] = [];
  let ready: Set<string> | null = null;
  /** ledger name → the second it is back, with the row that said so */
  const pending = new Map<string, { backS: number; line: number }>();
  let t: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stamp = line.match(/^(\d+):(\d\d)\s/);
    if (stamp) {
      const s = Number(stamp[1]) * 60 + Number(stamp[2]);
      if (line.includes("[DEATH]") && line.includes("friendly")) break;
      // another stamped block starting over is not this chain
      if (t !== null && s < t) {
        ready = null;
        pending.clear();
      }
      t = s;
      continue;
    }
    const m = line.match(RES_ROW);
    if (!m || t === null) continue;
    const rdy = m[1];
    const cd = m[2];
    if (rdy.startsWith("Δ")) {
      if (ready === null) ready = new Set();
      for (const tok of rdy
        .slice(1)
        .trim()
        .split(/ (?=[+-])/)) {
        if (tok.startsWith("+")) ready.add(resLedgerName(tok.slice(1)));
        else if (tok.startsWith("-")) ready.delete(resLedgerName(tok.slice(1)));
      }
    } else {
      ready = new Set(
        rdy.trim() === "—" ? [] : splitResList(rdy).map(resLedgerName),
      );
      pending.clear();
    }
    const listed = new Set<string>();
    if (cd.trim() !== "—") {
      for (const raw of splitResList(cd)) {
        const entry = raw.trim();
        const exact = entry.match(RES_CD_EXACT);
        const name = resLedgerName(
          entry.replace(/\([^()]*\)(\[[^\]]*\])?$/, ""),
        );
        listed.add(name);
        if (exact)
          pending.set(resLedgerName(exact[1]), {
            backS: t + Number(exact[2]),
            line: i + 1,
          });
        else pending.delete(name);
      }
    }
    for (const [name, p] of [...pending]) {
      if (listed.has(name) || p.backS + 1 > t) continue;
      pending.delete(name);
      if (!ready.has(name))
        failures.push(
          `line ${i + 1}: [RES] never shows ${name} coming back — line ${p.line} put it back at ${Math.floor(p.backS / 60)}:${String(p.backS % 60).padStart(2, "0")}, and no row since lists it as ready —— ${line.trim().slice(0, 160)}`,
        );
    }
  }
  return failures;
}

/** `[ENEMY DEF] … X → 5(DDHunter) (11.0s …)` — the observed duration of an
 * external. An external whose end the log never showed prints
 * `(end not logged)` there (ruling D6) and has none: `checkEnemyDefEndNotLogged`
 * holds that such a line carries no `| during it:` at all. */
const ENEMY_DEF_EXTERNAL_DUR =
  /\[ENEMY DEF\]\s+.*?→\s*\S+\s*\((\d+(?:\.\d+)?)s/;
/** One `during it:` segment (segments are `; `-joined; fields ` · `-joined). */
const DURING_SEG = new RegExp(
  String.raw`^(\S+) (\d+)k on target${DURING_ABSORBED_TAG_RE_SRC} · (\d+)% of their enemy-player damage · direct (\d+)k \/ periodic (\d+)k(?: · (\d+)k \((\d+)%\) of it in the wall's school)?(?: · (\d+) hits? immune)? · damage in (\d+) of (\d+) s · longest gap (\d+) s$`,
);
const DURING_EMPTY_SEG =
  /^(\S+) 0k on target · no damage on any enemy player · 0 of (\d+) s$/;

/**
 * `[ENEMY DEF] … | during it:` annotation consistency (28th hardFailure
 * class, GH #91, value gate passed 2026-09-22). The annotation is rendered
 * from `externalDamageForApplication` (`utils/externalDamage.ts`); this gate
 * re-parses every segment and checks the arithmetic the renderer promised:
 * direct + periodic = the on-target total (±1k rounding), the round-2
 * in-school amount ≤ the total, K ≤ M, G ≤ M − K, 0 ≤ X ≤ 100, and
 * M ≤ ⌈observed duration + 0.05⌉ + 1 when the line carries one — the window
 * can never be longer than the aura was seen on the target. M counts the
 * rendered seconds the aura's own span touches (round-3 audit D31,
 * 2026-10-21): a span of L s touches at most ⌈L⌉ + 1 of them, and the line
 * prints L to 0.1 s, so the true L is below the printed value + 0.05
 * (105-4-585 0:21: a Pain Suppression printed 8.0 s, 20.98–29.03, touches
 * ten seconds).
 */
export function checkDuringExternalConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes("[ENEMY DEF]")) return;
    const at = line.indexOf("| during it: ");
    if (at < 0) return;
    const observed = line.match(ENEMY_DEF_EXTERNAL_DUR)?.[1];
    const maxM =
      observed !== undefined ? Math.ceil(Number(observed) + 0.05) + 1 : null;
    const fail = (why: string) =>
      failures.push(
        `line ${i + 1}: [ENEMY DEF] during-it 标注自相矛盾(${why})—— ${line.trim().slice(0, 160)}`,
      );
    for (const seg of line.slice(at + "| during it: ".length).split("; ")) {
      const e = seg.match(DURING_EMPTY_SEG);
      if (e) {
        if (maxM !== null && Number(e[2]) > maxM)
          fail(`窗口 ${e[2]} s 长于观测时长 ${observed}s`);
        continue;
      }
      const m = seg.match(DURING_SEG);
      if (!m) {
        fail(`段落格式不可解析:${seg.slice(0, 80)}`);
        continue;
      }
      const num = (i: number) =>
        m[i] === undefined ? undefined : Number(m[i]);
      const total = num(2)!;
      const x = num(3)!;
      const direct = num(4)!;
      const periodic = num(5)!;
      const inSchool = num(6);
      const K = num(9)!;
      const M = num(10)!;
      const G = num(11)!;
      if (Math.abs(direct + periodic - total) > 1)
        fail(`direct ${direct}k + periodic ${periodic}k ≠ ${total}k`);
      if (inSchool !== undefined && inSchool > total + 1)
        fail(`本学派 ${inSchool}k > 总量 ${total}k`);
      if (x < 0 || x > 100) fail(`份额 ${x}% 越界`);
      if (K > M) fail(`有伤害秒数 ${K} > 窗口 ${M}`);
      if (G > M - K) fail(`最长空档 ${G} > ${M - K}`);
      if (maxM !== null && M > maxM)
        fail(`窗口 ${M} s 长于观测时长 ${observed}s`);
    }
  });
  return failures;
}

/** `  [m:ss–m:ss] on <unit> — … | opportunity: <tier …> | …` — the tier segment. */
const KILL_ATTEMPT_OPPORTUNITY =
  /^\s*\[\d+:\d\d–\d+:\d\d\] on .*\| opportunity: ([^|]+)\|/;
/** The pre-v93 summary tail that counted every trinket-up opener as a mark. */
const KILL_ATTEMPT_SUMMARY_TRINKET_UP = /^\s*Summary: .*trinket was still up/;

/**
 * [KILL ATTEMPTS] framing (26th hardFailure class, user ruling 2026-09-22):
 * a trinket-up target is the default state at the gates and forcing the
 * trinket with the opener is the play, so no attempt line may stamp its
 * target `locked` and the summary may not count "opened while the target's
 * trinket was still up". The block renders `trinket up (no softer target)`
 * or names the softer alternative (`softerTargetAt`, shared with the retired
 * attempt-into-trinket mapper); the model turned the old `locked (trinket
 * up) … FAILED` at 0:05 into "you should not have opened on someone with a
 * trinket". Structural check on the rendered text — the softer-target
 * predicate itself is unit-tested in analysis.
 */
export function checkKillAttemptFraming(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(KILL_ATTEMPT_OPPORTUNITY);
    if (m && /^locked\b/.test(m[1]!.trim()))
      failures.push(
        `line ${i + 1}: KILL ATTEMPTS 行把徽章在手的目标标成 locked(用户裁决 2026-09-22:徽章在手是默认态,不是失误;只能写 trinket up (no softer target) 或点名更软目标)—— ${line.trim().slice(0, 140)}`,
      );
    if (KILL_ATTEMPT_SUMMARY_TRINKET_UP.test(line))
      failures.push(
        `line ${i + 1}: KILL ATTEMPTS 汇总仍在统计「徽章在手时开的尝试」,只能统计存在更软目标的尝试 —— ${line.trim().slice(0, 140)}`,
      );
  });
  return failures;
}

/** `<unit id="4" … role="enemy">` — the side a rendered id belongs to. */
const UNIT_ROLE_LINE = /<unit\s+id="(\d+)"[^>]*role="([^"]+)"/;
/** `[CC ON TEAM] 1(RShaman) ← Capacitor Totem (by 6(RShaman)'s totem)` — the
 * credited owner id of a summon-cast CC, whatever kind word the summon got
 * (`SUMMON_KIND_RE_SRC`, the analysis side's own list). The inner `(Spec)` is why this cannot
 * be `[^)]*`. */
const CC_PET_CREDIT = new RegExp(
  String.raw`\[(CC ON TEAM|CC ON ENEMY|ENEMY TRINKET)\][^\n]*?\(by (\d+)[^()]*(?:\([^()]*\)[^()]*)*'s ${SUMMON_KIND_RE_SRC}\)`,
);

/**
 * A summon-cast CC must be credited to the side that could have cast it:
 * `[CC ON TEAM]` → an enemy, `[CC ON ENEMY]` → a teammate, `[ENEMY TRINKET]` → friendly.
 *
 * Why this is a hardFailure (GH #99, 2026-09-20): matchTimeline resolved a
 * summon's owner by matching the unit NAME, and both teams field same-named
 * summons — with two shamans in the round, `find` returned whichever
 * "Capacitor Totem" the unit table held first. 48 lines across 16 of the 309
 * prompts in the 2026-09-15 Opus baseline credited the wrong side, including
 * `3(EShaman) ← Capacitor Totem (by 3(EShaman)'s pet)` — a teammate rendered
 * as stunning his own team. The fix keys on the event's own source GUID
 * (`ICCInstance.sourceId`); this gate re-parses the rendered line so a
 * regression cannot land silently. Same predicate as
 * `packages/ev[a]l/scripts/petSideScan.ts`, which measures it over the match
 * library.
 */
export function checkPetCreditSide(lines: string[]): string[] {
  const side = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(UNIT_ROLE_LINE);
    if (m) side.set(m[1]!, m[2] === "enemy" ? "enemy" : "friendly");
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(CC_PET_CREDIT);
    if (!m) return;
    // a control from the holder's own team while it was charmed names that
    // team's unit, and says so (F16 retest idx 21)
    if (line.includes(CC_FROM_OWN_TEAM_TAG)) return;
    const want = m[1] === "CC ON TEAM" ? "enemy" : "friendly";
    const got = side.get(m[2]!);
    if (got !== undefined && got !== want) {
      if (m[1] === "ENEMY TRINKET") {
        failures.push(
          `line ${i + 1}: [ENEMY TRINKET] credits enemy pet ${m[2]!}, must be friendly`,
        );
      } else {
        failures.push(
          `line ${i + 1}: ${m[1]} 的施放者被记到${got === "enemy" ? "敌方" : "友方"}(应为${want === "enemy" ? "敌方" : "友方"})—— ${line.trim().slice(0, 140)}`,
        );
      }
    }
  });
  return failures;
}

/** The KILL ATTEMPTS legend line that only renders while
 * `TIMELINE_LINE_FLAGS.enemyDef === "timeline"` — the gate keys on it so a
 * prompt built with the line off is not accused of missing it. */
const ENEMY_DEF_LEGEND = /^\s*\[ENEMY DEF\] = /;
/** `  [m:ss–m:ss] on <unit> — … | FAILED: popped A/B`,
 * `… | FAILED: saved by external (A/B)` or (B4a, 2026-09-25)
 * `… | FAILED: self-saved (A/B)`; names may carry `@m:ss` (stamp mode).
 * Since B-tier B16b (2026-10-07) a cause can be several of those clauses
 * joined with "; " (`popped A; saved by external (B)`): the line regex takes
 * the whole cause and `KILL_ATTEMPT_SAVE_CLAUSE` reads each clause. The
 * FAILED clause is the line's last, or (I10, 2026-10-11) is followed by the
 * `| target in your team's …` fact clause, which is not part of the cause. */
const KILL_ATTEMPT_DEFENSIVE = new RegExp(
  String.raw`^\s*\[(\d+):(\d\d)–(\d+):(\d\d)\] on (\S+) — .*\| FAILED: ((?:popped |saved by external \(|self-saved \()[^|]+?)(?: \| ${KILL_ATTEMPT_OWN_CONTROL_LEAD}[^|]+)?\s*$`,
);
const KILL_ATTEMPT_SAVE_CLAUSE =
  /^(?:popped ([^()]+?)|saved by external \(([^()]+)\)|self-saved \(([^()]+)\))$/;
/** `m:ss  [ENEMY DEF]   <pid> (<spec>): <Spell> (…)` / `: <Spell> → <pid> (…)` */
const ENEMY_DEF_LINE =
  /^(\d+):(\d\d) {2}\[ENEMY DEF\] {3}[^:]+: (.+?)(?: \(| → |$)/;
/** The unit a `[ENEMY DEF]` line's save is ON: the recipient of an external
 * (`… → 4(ORogue) …`), else the unit that pressed it (the line's own id). */
const ENEMY_DEF_RECIPIENT_ID = / → (\d+)\(/;
const ENEMY_DEF_CASTER_ID = /\[ENEMY DEF\] {3}(\d+)\(/;

/** Rendered unit name → rendered id, from the roster (`<unit id="4" name=…>`).
 * KILL ATTEMPTS names its target; the timeline lines carry the id. A gate
 * that pairs the two compares units only when the roster resolves the name —
 * no roster, no unit claim. */
function unitIdsByName(lines: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines) {
    const m = UNIT_LEGEND_LINE.exec(line);
    if (m) out.set(m[2]!, m[1]!);
  }
  return out;
}
/** Every `[ENEMY DEF]` line of a prompt, as the KILL ATTEMPTS gates pair it:
 * its second, the save it names, the unit the save is on, and whether it
 * says the log never showed the aura end. */
interface EnemyDefLine {
  atS: number;
  spell: string;
  onId?: string;
  /** the line reads `end not logged` where its duration would stand */
  endNotLogged: boolean;
  /** the line can be an immunity: it prints `(immune…`, or it is an external
   * (Blessing of Protection on an ally prints no strength) */
  canBeImmunity: boolean;
  /** an area save (`X (area)`), with the rendered id of the unit that
   * pressed it */
  areaCasterId?: string;
}
function enemyDefLinesOf(lines: readonly string[]): EnemyDefLine[] {
  const defs: EnemyDefLine[] = [];
  for (const line of lines) {
    const m = ENEMY_DEF_LINE.exec(line);
    if (!m) continue;
    const recipient = ENEMY_DEF_RECIPIENT_ID.exec(line);
    defs.push({
      atS: Number(m[1]) * 60 + Number(m[2]),
      spell: m[3]!,
      // an area save (`X (area)`) is on nobody in particular
      onId: line.includes(" (area)")
        ? undefined
        : (recipient ?? ENEMY_DEF_CASTER_ID.exec(line))?.[1],
      endNotLogged: ENEMY_DEF_END_NOT_LOGGED_SLOT_RE.test(line),
      canBeImmunity:
        recipient !== null || line.includes(": " + m[3] + " (immune"),
      ...(line.includes(" (area)")
        ? { areaCasterId: ENEMY_DEF_CASTER_ID.exec(line)?.[1] }
        : {}),
    });
  }
  return defs;
}
/**
 * How long each unit's save can last, as its `<cooldowns>` kit prints it
 * (`X [… lasts Ns]`, or `lasts a–Ns` → N: `buffDurationRangeForCaster`'s
 * top), keyed by the unit's rendered id and the save's name. What an area
 * save's line (`X (area)`, at the press) is read against: its aura reaches a
 * unit any time inside its lifetime, which is when KILL ATTEMPTS dates it
 * (`areaSaveSpansOnS`: the on-target start within the save's lifetime of
 * the press; user ruling 2026-10-27, option A — fact5 wide 200-5: a
 * Rallying Cry pressed at 1:46 first on a cycloned feral at 1:51).
 */
function kitLifetimesById(
  lines: readonly string[],
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  let unitId: string | undefined;
  for (const line of lines) {
    const u = UNIT_LEGEND_LINE.exec(line);
    if (u) {
      unitId = u[1];
      continue;
    }
    if (unitId === undefined || !line.includes("<cooldowns>")) continue;
    const kit = new Map<string, number>();
    for (const e of line.matchAll(
      /(?:<cooldowns>|, )([^,[\]<]+?) \[[^\]]*?lasts (?:[\d.]+–)?([\d.]+)s\]/g,
    ))
      kit.set(e[1]!.trim(), Number(e[2]));
    out.set(unitId, kit);
    unitId = undefined;
  }
  return out;
}

/** The aura APPLIED that KILL ATTEMPTS attributes and the `[ENEMY DEF]` line
 * both render from the same log instant, but one is floored from the aura
 * event and the other from a paired cast ≤ 1.5 s away (externals), so the
 * gate allows that pairing radius on either side of the attribution span. */
const ENEMY_DEF_PAIR_SLACK_S = 2;

/** `X [up since m:ss]` — a cause that was already up when the attempt began
 * (killAttempts.ts `stampNames`, enemy-def F-E22 rule 2). */
const KILL_ATTEMPT_UP_SINCE = / \[up since (\d+):(\d\d)\]$/;
/** `… | FAILED: [target trinketed out; ]forced a full immunity [up since m:ss] (…)`
 * — an immunity already up when the attempt began (`failureText`). The cause
 * carries no spell name, so the gate can only ask for a `[ENEMY DEF]` line at
 * that second. */
const KILL_ATTEMPT_IMMUNITY_UP_SINCE =
  /\| FAILED: .*forced a full immunity \[up since (\d+):(\d\d)\]/;

/**
 * KILL ATTEMPTS `popped X` / `saved by external (X)` / `self-saved (X)` ⇒ a
 * `[ENEMY DEF]` line naming X where the attribution says it went up:
 *  - inside the attempt's own span `[from, to]` — since triage 2026-09-29
 *    (enemy-def F-E22 rule 3′ / crisis-external F-E22b, ruling A′4) a wall,
 *    external or self-save pressed in the kill-credit slack after the span is
 *    no longer a cause, so the gate no longer looks there either;
 *  - or, for a cause rendered `X [up since m:ss]` (already up when the
 *    attempt began, rule 2), at that second.
 * `forced a full immunity [up since m:ss]` names no spell: it needs some
 * `[ENEMY DEF]` line at that second.
 * Both sides render from `enemyDefensives.ts`'s one predicate (GH #97), so a
 * miss here is a producer bug: the summary claims a wall the timeline never
 * showed, and the model is back to "check the VOD".
 */
export function checkEnemyDefRefConsistency(lines: string[]): string[] {
  if (!lines.some((l) => ENEMY_DEF_LEGEND.test(l))) return [];
  const idOf = unitIdsByName(lines);
  const defs = enemyDefLinesOf(lines);
  const lifetimes = kitLifetimesById(lines);
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const imm = KILL_ATTEMPT_IMMUNITY_UP_SINCE.exec(line);
    if (imm) {
      const atS = Number(imm[1]) * 60 + Number(imm[2]);
      if (!defs.some((d) => Math.abs(d.atS - atS) <= ENEMY_DEF_PAIR_SLACK_S))
        failures.push(
          `line ${i + 1}: KILL ATTEMPTS says an immunity was up since ${fmtTime(atS)} but no [ENEMY DEF] line sits at that second: "${line.trim()}"`,
        );
    }
    const m = KILL_ATTEMPT_DEFENSIVE.exec(line);
    if (!m) return;
    const spanFromS = Number(m[1]) * 60 + Number(m[2]);
    const spanToS = Number(m[3]) * 60 + Number(m[4]);
    // the attempt's target, as the timeline numbers it (undefined = the
    // roster does not resolve the name → the unit is not compared)
    const targetId = idOf.get(m[5]!);
    const names: string[] = [];
    for (const clause of m[6]!.split("; ")) {
      const c = KILL_ATTEMPT_SAVE_CLAUSE.exec(clause.trim());
      if (!c) {
        failures.push(
          `line ${i + 1}: KILL ATTEMPTS FAILED cause has a clause the gate cannot read ("${clause.trim()}"): "${line.trim()}"`,
        );
        continue;
      }
      names.push(...(c[1] ?? c[2] ?? c[3])!.split("/"));
    }
    for (const raw of names) {
      let spell = raw.replace(/@\d+:\d\d$/, "").trim();
      const up = KILL_ATTEMPT_UP_SINCE.exec(spell);
      if (up) spell = spell.slice(0, up.index).trim();
      if (!spell) continue;
      const lo = up ? Number(up[1]) * 60 + Number(up[2]) : spanFromS;
      const hi = up ? lo : spanToS;
      const hit = defs.some((d) => {
        if (d.spell !== spell) return false;
        if (
          targetId !== undefined &&
          d.onId !== undefined &&
          d.onId !== targetId
        )
          return false;
        // an area save reaches the unit inside its lifetime after the press
        // (`kitLifetimesById`); else the line's own instant
        const reachS =
          d.areaCasterId !== undefined
            ? (lifetimes.get(d.areaCasterId)?.get(spell) ?? 0)
            : 0;
        return (
          d.atS >= lo - ENEMY_DEF_PAIR_SLACK_S - reachS &&
          d.atS <= hi + ENEMY_DEF_PAIR_SLACK_S
        );
      });
      if (!hit)
        failures.push(
          `line ${i + 1}: KILL ATTEMPTS attributes "${spell}" in [${fmtTime(lo)}–${fmtTime(hi)}] but no [ENEMY DEF] line names it there on that unit: "${line.trim()}"`,
        );
    }
  });
  return failures;
}

/** `  [m:ss–m:ss] on <unit> — …` — the target of any KILL ATTEMPTS line. */
const KILL_ATTEMPT_TARGET = /^\s*\[\d+:\d\d–\d+:\d\d\] on (\S+) — /;

/**
 * KILL ATTEMPTS never calls a cause "already up" on an aura whose end the log
 * did not show, when the aura's carrier goes unseen — user ruling P-FU-b8
 * (2026-10-06: Mass Invisibility / Vanish / Burrow, "丢 REMOVED 的不按 12 s
 * 封顶"), extended to Greater Invisibility by ruling D6 (2026-10-10). The
 * producer's rule is `saveAuraCountsWhenAlreadyUp`; here it is read off the
 * text, with the producer's names (`SAVE_AURA_END_UNSEEN_NAMES`):
 *  - `popped X [up since m:ss]` (or the external / self-save form) with X one
 *    of those names ⇒ the `[ENEMY DEF]` line of X at that second, on that
 *    unit, does not read `end not logged`;
 *  - `forced a full immunity [up since m:ss]` names no spell ⇒ the lines at
 *    that second that can be an immunity are not ALL such `end not logged`
 *    lines on that unit (checked only when the roster resolves the unit and
 *    no teammate's line sits there: a Mass Invisibility on the target is
 *    printed on the mage who cast it).
 * Before D6, 605 new-season files: `popped Greater Invisibility [up since …]`
 * on at least 219 prompt lines, each off a `(60%, 20.0s)` that was the cap
 * (fix-FT/T07-notes §2.2). A cause that went up INSIDE the attempt carries
 * no `[up since]` and is not this gate's business.
 */
export function checkKillAttemptUpSinceEndLogged(lines: string[]): string[] {
  if (!lines.some((l) => ENEMY_DEF_LEGEND.test(l))) return [];
  const idOf = unitIdsByName(lines);
  const defs = enemyDefLinesOf(lines);
  const failures: string[] = [];
  /** every line found is an unseen-carrier aura with no logged end */
  const onlyUnseenEnds = (found: readonly EnemyDefLine[]): boolean =>
    found.length > 0 &&
    found.every(
      (d) => d.endNotLogged && SAVE_AURA_END_UNSEEN_NAMES.has(d.spell),
    );
  lines.forEach((line, i) => {
    const target = KILL_ATTEMPT_TARGET.exec(line)?.[1];
    if (target === undefined) return;
    const targetId = idOf.get(target);
    const fail = (what: string, atS: number) =>
      failures.push(
        `line ${i + 1}: KILL ATTEMPTS counts ${what} as up since ${fmtTime(atS)}, but its [ENEMY DEF] line there says \`${ENEMY_DEF_END_NOT_LOGGED}\` — the log never showed it last until the attempt: "${line.trim()}"`,
      );
    const imm = KILL_ATTEMPT_IMMUNITY_UP_SINCE.exec(line);
    if (imm && targetId !== undefined) {
      const atS = Number(imm[1]) * 60 + Number(imm[2]);
      const there = defs.filter(
        (d) =>
          d.canBeImmunity && Math.abs(d.atS - atS) <= ENEMY_DEF_PAIR_SLACK_S,
      );
      // A teammate's press at that second may be what is on the target (Mass
      // Invisibility lands on the mage's allies, and its line sits on the
      // mage): the text cannot say whose aura the cause is, so no claim.
      if (there.every((d) => d.onId === targetId) && onlyUnseenEnds(there))
        fail("an immunity", atS);
    }
    const m = KILL_ATTEMPT_DEFENSIVE.exec(line);
    if (!m) return;
    for (const clause of m[6]!.split("; ")) {
      const c = KILL_ATTEMPT_SAVE_CLAUSE.exec(clause.trim());
      // an unreadable clause is `checkEnemyDefRefConsistency`'s failure
      if (!c) continue;
      for (const raw of (c[1] ?? c[2] ?? c[3])!.split("/")) {
        const up = KILL_ATTEMPT_UP_SINCE.exec(raw.trim());
        if (!up) continue;
        const spell = raw.trim().slice(0, up.index).trim();
        if (!SAVE_AURA_END_UNSEEN_NAMES.has(spell)) continue;
        const atS = Number(up[1]) * 60 + Number(up[2]);
        if (
          onlyUnseenEnds(
            defs.filter(
              (d) =>
                d.spell === spell &&
                (targetId === undefined ||
                  d.onId === undefined ||
                  d.onId === targetId) &&
                Math.abs(d.atS - atS) <= ENEMY_DEF_PAIR_SLACK_S,
            ),
          )
        )
          fail(spell, atS);
      }
    }
  });
  return failures;
}

/** `… | FAILED: <what the attempt ran into>[ | …]` — the FAILED clause alone. */
const KILL_ATTEMPT_FAILED_CLAUSE = /\| FAILED: ([^|]+?)\s*(?:\||$)/;
/** One `X [up since m:ss]` inside a FAILED clause: X runs back to the clause
 * punctuation before it (`/` between names, `(` of a list, `; ` between
 * clauses). */
const KILL_ATTEMPT_UP_SINCE_STAMP = /([^/(;]+?) \[up since (\d+:\d\d)\]/g;
/** One `X already up since m:ss` of an opportunity clause (its `; ` items). */
const KILL_ATTEMPT_ALREADY_UP_ITEM = /^(.+) already up since (\d+:\d\d)$/;

/**
 * R08 (c) (user ruling 2026-10-11): a KILL ATTEMPTS line states, where its
 * tier is, everything its own FAILED clause marks as already up when the
 * attempt began — `opportunity: PRIME (no trinket, no 20-99% wall in hand;
 * Barkskin already up since 0:59) | … | FAILED: popped Barkskin [up since
 * 0:59]`. Before it the line said "no wall in hand" and, four clauses on,
 * that a wall had been up since before the attempt, with nothing joining the
 * two (605 new-season files, PROMPT_VERSION 377: this gate fails 2,314 times
 * in 1,492 of 3,520 owner contexts — one per `[up since]` mark).
 *
 * Both directions, on the text, with the producer's own formatter
 * (`killAttemptAlreadyUpFact`):
 *  - every `X [up since m:ss]` of the FAILED clause is in the opportunity
 *    clause as `X already up since m:ss` (an immunity, which names no spell,
 *    as `KILL_ATTEMPT_IMMUNITY_ALREADY_UP_NAME`);
 *  - the opportunity clause states none the FAILED clause does not mark.
 * And the legend sentence is there exactly when a line carries the fact.
 */
export function checkKillAttemptAlreadyUpStated(lines: string[]): string[] {
  const failures: string[] = [];
  let carried = false;
  lines.forEach((line, i) => {
    const opp = line.match(KILL_ATTEMPT_OPPORTUNITY)?.[1];
    if (opp === undefined) return;
    const failed = line.match(KILL_ATTEMPT_FAILED_CLAUSE)?.[1] ?? "";
    const expected = [...failed.matchAll(KILL_ATTEMPT_UP_SINCE_STAMP)].map(
      (m) => {
        const name = m[1]!.trim().replace(/^popped /, "");
        return killAttemptAlreadyUpFact(
          name === "forced a full immunity"
            ? KILL_ATTEMPT_IMMUNITY_ALREADY_UP_NAME
            : name,
          m[2]!,
        );
      },
    );
    // the parenthesis of the tier: `PRIME (a; b)` / `gated (a; b; c)` / …
    const inner = opp.trim().match(/^[^(]*\((.*)\)$/)?.[1] ?? "";
    const stated = inner
      .split("; ")
      .filter((item) => KILL_ATTEMPT_ALREADY_UP_ITEM.test(item));
    if (stated.length > 0) carried = true;
    for (const fact of expected)
      if (!stated.includes(fact))
        failures.push(
          `line ${i + 1}: KILL ATTEMPTS 的 FAILED 子句写了 [up since],opportunity 子句却没写 "${fact}" —— ${line.trim()}`,
        );
    for (const fact of stated)
      if (!expected.includes(fact))
        failures.push(
          `line ${i + 1}: KILL ATTEMPTS 的 opportunity 子句写了 "${fact}",同一行的 FAILED 子句没有对应的 [up since] —— ${line.trim()}`,
        );
  });
  const legend = lines.includes(KILL_ATTEMPTS_ALREADY_UP_LEGEND);
  if (carried && !legend)
    failures.push(
      "KILL ATTEMPTS 有行写了 `already up since`,图例里没有解释它的那一句",
    );
  if (!carried && legend)
    failures.push(
      "KILL ATTEMPTS 的图例解释了 `already up since`,却没有一行写它",
    );
  return failures;
}

/** What follows the ability's name on an own `[ENEMY DEF]` wall line:
 * `(N%)`, `(N%, 8.0s…`, `(N%, end not logged…` — the percentage and, when
 * the line prints one, its length in seconds — or a deflection's label in
 * the percentage's place (`(deflects direct attacks; …, 8.0s)`: Aspect of
 * the Turtle, a wall of the producer's cut since fact4 batch 1 — codex
 * 20-F17-01 #3: the gate skipped it). The words hold no regex metacharacter. */
const ENEMY_DEF_OWN_PCT_LABEL = new RegExp(
  String.raw`^\((?:(\d+)%|${ENEMY_DEF_DEFLECTS_WORDS})(?:, (?:${ENEMY_DEF_END_NOT_LOGGED}|(\d+(?:\.\d+)?)s))?`,
);

/**
 * Hard invariant (R08 d, gap 1; 2026-10-13): "defenseless" says nothing was
 * up, so no `[KILL WINDOW]` / `[VULNERABLE]` span — the line's own, or the
 * `defenseless a–b` it names — runs across a 20–99 % wall its target put up
 * itself. For every such span: no `[ENEMY DEF]` line of the target's own
 * (resolved through the `<unit>` legend) that names a wall with a percentage
 * sits strictly between the span's two printed seconds
 * (`spanHoldsOwnWallSecond`, the producer's own reading of "a cut span shares
 * at most its boundary second with the wall's line").
 *
 * The producer cuts the spans on the wall events the line is rendered from
 * (`computeOffensiveWindows` step 2b: `enemyDefensiveEvents` of kind "self",
 * the interval `ownWallSpanS` — from the aura's start, the instant the line
 * is printed at, for as long as the aura was up). Which names are walls is
 * the events' own set (`ownWallLineNames`, `MITIGATION_TABLE` 20–99 %): Roar
 * of Sacrifice prints a percentage and is no wall (rulings A20 + U3), an
 * external (`X → unit`) is step 2b's older half and has no label of its own.
 * A wall on the span's first or last printed second is the cut itself: the
 * span ends in the second the wall's line prints, and starts again in the
 * second the wall ended — the line's own when the wall lasted under one. A
 * line that prints no length (the aura went up as the round ended) or `0.0s`
 * is not read: an aura of no length cuts nothing.
 *
 * Before (cap605-cl, 3,520 owner contexts of 605 new-season files, the tree
 * before the cut): 755 failures on 587 window lines in 286 contexts, every
 * one a `[KILL WINDOW]` line — its `defenseless` span 578, its own burst span
 * 177; Survival of the Fittest 443, Divine Protection 298, Ancient of Lore
 * 14. f4da82c5 round 5 printed `defenseless 1:35–2:51` on a hunter whose
 * Survival of the Fittest line sits at 2:04.
 */
export function checkNoWindowAcrossOwnWall(lines: string[]): string[] {
  const wallNames = ownWallLineNames();
  /** rendered unit id → the seconds and names of its own wall lines */
  const wallsOf = new Map<string, Array<{ second: number; spell: string }>>();
  for (const line of lines) {
    const m = ENEMY_DEF_LINE.exec(line);
    // an external (`X → unit`) is not the unit's own line
    if (!m || !m[0].endsWith("(") || !wallNames.has(m[3]!)) continue;
    const label = ENEMY_DEF_OWN_PCT_LABEL.exec(
      line.slice(m.index + m[0].length - 1),
    );
    const id = ENEMY_DEF_CASTER_ID.exec(line)?.[1];
    if (!label || id === undefined) continue;
    // no printed length, or one that prints 0.0s: no interval to cut
    if (!label[0].includes(", ")) continue;
    if (label[2] !== undefined && Number(label[2]) <= 0) continue;
    wallsOf.set(id, [
      ...(wallsOf.get(id) ?? []),
      { second: Number(m[1]) * 60 + Number(m[2]), spell: m[3]! },
    ]);
  }
  return windowsAcrossOwnLines(lines, wallsOf, "自己开了 20–99% 的墙");
}

/** The window half of the own-line gates: every `[KILL WINDOW]` /
 * `[VULNERABLE]` span of a target — the line's own and the `defenseless a–b`
 * it names — must not hold the second of one of `ownOf`'s lines of that
 * target (`spanHoldsOwnWallSecond`, the producer's reading). */
function windowsAcrossOwnLines(
  lines: string[],
  ownOf: ReadonlyMap<string, Array<{ second: number; spell: string }>>,
  what: string,
): string[] {
  const failures: string[] = [];
  if (ownOf.size === 0) return failures;
  const idOf = unitIdsByName(lines);
  lines.forEach((line, i) => {
    const w = line.match(KILL_WINDOW_SPAN);
    const target = w ? line.match(KILL_WINDOW_TARGET)?.[1] : undefined;
    if (!w || target === undefined) return;
    const id = idOf.get(target);
    const own = id === undefined ? undefined : ownOf.get(id);
    if (!own) return;
    const check = (span: string, from: number, to: number) => {
      const held = own
        .filter((x) => spanHoldsOwnWallSecond(from, to, x.second))
        .sort((a, b) => a.second - b.second);
      if (held.length > 0)
        failures.push(
          `line ${i + 1}: ${span} ${fmtTime(from)}–${fmtTime(to)} 的目标 ${target} 在其中 ${held.map((x) => `${fmtTime(x.second)} ${x.spell}`).join("、")} ${what}([ENEMY DEF] 行)—— ${line.trim().slice(0, 140)}`,
        );
    };
    check(
      `[${w[1]}] 的区间`,
      Number(w[2]) * 60 + Number(w[3]),
      Number(w[4]) * 60 + Number(w[5]),
    );
    const d = line.match(DEFENSELESS_SPAN);
    if (d)
      check(
        "defenseless 区间",
        Number(d[1]) * 60 + Number(d[2]),
        Number(d[3]) * 60 + Number(d[4]),
      );
  });
  return failures;
}

/** What follows the ability's name on an own `[ENEMY DEF]` immunity or
 * absorb line: `(immune, 3.0s`, `(immune to magic, end not logged`,
 * `(absorb, 2.0s` / `(absorb 494k, 3.5s` — with its length, or the
 * official-length cap the producer cut at when the end was never logged. */
const ENEMY_DEF_OWN_SAVE_LABEL = new RegExp(
  String.raw`^\((?:immune(?: to [a-z]+(?:\/[a-z]+)*)?|absorb(?: (?:<1k|\d+k))?), (?:${ENEMY_DEF_END_NOT_LOGGED}|(\d+(?:\.\d+)?)s)`,
);

/**
 * fact1215 R7 (2026-10-18, user approved): the own-wall invariant for the
 * target's own immunity and absorb shield — "defenseless" says nothing was
 * up, so no `[KILL WINDOW]` / `[VULNERABLE]` span runs across the target's
 * own `[ENEMY DEF]` line labelled `immune …` / `absorb …` (`ownSaveSpanS`,
 * the producer's cut). A line of no length (`0.0s`) cuts nothing. 605
 * capture before the cut: see docs/prompt-version-history.md v420.
 */
export function checkNoWindowAcrossOwnSave(lines: string[]): string[] {
  const savesOf = new Map<string, Array<{ second: number; spell: string }>>();
  for (const line of lines) {
    const m = ENEMY_DEF_LINE.exec(line);
    if (!m || !m[0].endsWith("(")) continue;
    const label = ENEMY_DEF_OWN_SAVE_LABEL.exec(
      line.slice(m.index + m[0].length - 1),
    );
    const id = ENEMY_DEF_CASTER_ID.exec(line)?.[1];
    if (!label || id === undefined) continue;
    if (label[1] !== undefined && Number(label[1]) <= 0) continue;
    savesOf.set(id, [
      ...(savesOf.get(id) ?? []),
      { second: Number(m[1]) * 60 + Number(m[2]), spell: m[3]! },
    ]);
  }
  return windowsAcrossOwnLines(lines, savesOf, "自己开着免疫 / 吸收盾");
}

/** `softer target then: <unit> — PRIME` / `— gated, A/B in hand` inside an
 * opportunity clause. */
const KILL_ATTEMPT_SOFTER_TARGET =
  /softer target then: (\S+) — (PRIME|gated, (.+?) in hand)(?:;|\)|$)/;
/** `gated (A/B in hand; …)` — the target's own walls in hand. */
const KILL_ATTEMPT_GATED_WALLS = /^gated \((.+?) in hand[;)]/;

/**
 * R08 (b) (user ruling 2026-10-11): "does this unit have this wall" is one
 * answer in a prompt. A 20–99 % wall the kit line tags `[UNUSED]` for a unit
 * — owned, never pressed this round — is in that unit's hand wherever a
 * KILL ATTEMPTS line states its tier:
 *
 *  - a target printed `PRIME (no trinket, no 20-99% wall in hand …)`, or an
 *    alternative printed `softer target then: X — PRIME`, has no such wall;
 *  - a target printed `gated (A/B in hand …)`, or an alternative printed
 *    `X — gated, A/B in hand`, names every such wall among A/B.
 * A `trinket up` line says nothing about the target's walls and is not read.
 *
 * Both sides are the cooldown ledger: the kit's tag is `kitRowUnused`, the
 * tier's input is `unpressedWallsOwned` (the same rows, the same reading).
 * Which kit names are walls is the tier's own set (`wallInHandKitNames`). A
 * unit with no `<cooldowns>` kit in the roster is not compared.
 *
 * Before (the tier counted a wall only when the unit CAST it this round):
 * f4da82c5 printed `Unending Resolve [180s, lasts 8s] [UNUSED]` for an enemy
 * it called `softer target then: … — PRIME`.
 */
export function checkKillTierWallOwnership(lines: string[]): string[] {
  const failures: string[] = [];
  const wallNames = wallInHandKitNames();
  /** unit name → the 20–99 % walls its kit tags `[UNUSED]` */
  const unusedWallsOf = new Map<string, string[]>();
  lines.forEach((line, i) => {
    const u = line.match(UNIT_LEGEND_LINE);
    if (!u) return;
    const kit = lines[i + 1]?.match(OWNER_KIT_LINE)?.[1];
    if (kit === undefined) return;
    unusedWallsOf.set(
      u[2]!,
      kit
        .split(/\](?:, )/)
        .filter((e) => / \[UNUSED/.test(e))
        .map((e) => e.slice(0, e.indexOf(" [")))
        .filter((name) => wallNames.has(name)),
    );
  });
  if (unusedWallsOf.size === 0) return failures;
  lines.forEach((line, i) => {
    const target = line.match(KILL_ATTEMPT_SPAN_LINE)?.[5];
    const opp = line.match(KILL_ATTEMPT_OPPORTUNITY)?.[1]?.trim();
    if (target === undefined || opp === undefined) return;
    const check = (
      who: string,
      says: string,
      inHand: readonly string[] | null,
    ) => {
      const unused = unusedWallsOf.get(who);
      if (!unused) return;
      const missing =
        inHand === null ? unused : unused.filter((w) => !inHand.includes(w));
      if (missing.length > 0)
        failures.push(
          `line ${i + 1}: KILL ATTEMPTS 把 ${who} 写成 ${says},而技能栏里 ${missing.join(" / ")} 标着 [UNUSED](拥有、本回合没按过的 20–99% 墙就在手里)—— ${line.trim().slice(0, 200)}`,
        );
    };
    if (/^PRIME\b/.test(opp)) check(target, "PRIME", null);
    const gated = opp.match(KILL_ATTEMPT_GATED_WALLS);
    if (gated)
      check(target, `gated (${gated[1]} in hand)`, gated[1]!.split("/"));
    const softer = opp.match(KILL_ATTEMPT_SOFTER_TARGET);
    if (softer)
      check(
        softer[1]!,
        `更软的目标 — ${softer[2]}`,
        softer[3] === undefined ? null : softer[3].split("/"),
      );
  });
  return failures;
}

/** `m:ss  [CC ON ENEMY]   <pid> ← <Spell> (by <who>) (Ns)` — or `(still on
 * them when the round ended, Ns in)`: the second, the unit, the control and
 * the whole seconds the line prints (`<1` = none). */
const CC_ON_ENEMY_SPAN_LINE = new RegExp(
  String.raw`^\s*(\d+):(\d\d)\s+\[CC ON ENEMY\]\s+(\d+)\([^)]*\) ← (.+?) \(by .+?\) \((?:${CC_STILL_ON_AT_ROUND_END}, )?(<1|\d+)s(?: in)?\)`,
);
/** The trailing `| target in your team's …` clause of a KILL ATTEMPTS line. */
const KILL_ATTEMPT_OWN_CONTROL_CLAUSE = new RegExp(
  String.raw` \| (${KILL_ATTEMPT_OWN_CONTROL_LEAD}[^|]+?)\s*$`,
);

/**
 * I10 (user ruling 2026-10-11, option b): a KILL ATTEMPTS line whose bracket
 * meets one of our own damage-immune controls on its target says so in a
 * trailing fact clause — `… | FAILED: not enough damage | target in your
 * team's Cyclone 0:42–0:47` — and no other line carries the clause.
 *
 * Re-derived from the text with the producer's own pieces: which control
 * (`isDamageImmuneControl` — its English name is the `[CC ON ENEMY]` line's),
 * the interval (the line's second, and that second plus the whole seconds it
 * prints), "meets" (`killAttemptBracketMeetsControl`, on the printed seconds)
 * and the clause's wording (`killAttemptOwnControlClause`). The expected
 * clause must equal the printed one — both directions in one comparison: a
 * missing clause, a clause with no such `[CC ON ENEMY]` line, another
 * interval, another unit's Cyclone all differ. A target the `<unit>` legend
 * does not resolve is not compared. The legend sentence is there exactly
 * when a line carries the clause.
 *
 * Before (605 new-season files, PROMPT_VERSION 377): no line carries the
 * clause, and this gate fails once per line that should — see the commit.
 */
export function checkKillAttemptOwnControlClause(lines: string[]): string[] {
  const failures: string[] = [];
  const idOf = unitIdsByName(lines);
  const controlName = isDamageImmuneControl(CYCLONE_SPELL_ID)
    ? getEnglishSpellName(CYCLONE_SPELL_ID, "")
    : "";
  const controlsOf = new Map<string, IKillAttemptOwnControl[]>();
  for (const line of lines) {
    const m = CC_ON_ENEMY_SPAN_LINE.exec(line);
    if (!m || !controlName || m[4] !== controlName || m[5] === "<1") continue;
    const fromSecond = Number(m[1]) * 60 + Number(m[2]);
    controlsOf.set(m[3]!, [
      ...(controlsOf.get(m[3]!) ?? []),
      { spellName: m[4]!, fromSecond, toSecond: fromSecond + Number(m[5]) },
    ]);
  }
  let carried = false;
  lines.forEach((line, i) => {
    const a = line.match(KILL_ATTEMPT_SPAN_LINE);
    if (!a) return;
    const printed = line.match(KILL_ATTEMPT_OWN_CONTROL_CLAUSE)?.[1] ?? "";
    if (printed) carried = true;
    const id = idOf.get(a[5]!);
    if (id === undefined) return;
    const from = Number(a[1]) * 60 + Number(a[2]);
    const to = Number(a[3]) * 60 + Number(a[4]);
    const meeting = (controlsOf.get(id) ?? [])
      .filter((c) =>
        killAttemptBracketMeetsControl(from, to, c.fromSecond, c.toSecond),
      )
      .sort((x, y) => x.fromSecond - y.fromSecond);
    const expected =
      meeting.length > 0 ? killAttemptOwnControlClause(meeting) : "";
    if (printed !== expected)
      failures.push(
        `line ${i + 1}: KILL ATTEMPTS [${a[1]}:${a[2]}–${a[3]}:${a[4]}] on ${a[5]} ${
          expected
            ? `应以 "| ${expected}" 结尾(该目标的 [CC ON ENEMY] 行与括号相交)`
            : "不该带我方控制子句(没有与括号相交的 [CC ON ENEMY] 行)"
        },实际${printed ? ` "| ${printed}"` : "没有"} —— ${line.trim().slice(-140)}`,
      );
  });
  const legend = lines.includes(KILL_ATTEMPTS_OWN_CONTROL_LEGEND);
  if (carried && !legend)
    failures.push(
      "KILL ATTEMPTS 有行带 `target in your team's …` 子句,图例里没有解释它的那一句",
    );
  if (!carried && legend)
    failures.push(
      "KILL ATTEMPTS 的图例解释了 `target in your team's …` 子句,却没有一行带它",
    );
  return failures;
}

/** The label an own-press `[ENEMY DEF]` line may open its parenthesis with
 * when its ability is neither an effect save nor a pressed self defensive:
 * a wall's `(N%…`, an immunity's `(immune…`, an area save's `(area)`. */
const ENEMY_DEF_WALL_LABEL = new RegExp(
  String.raw`^\((?:${ENEMY_DEF_IMMUNE_LABEL_RE_SRC}[,)]|\d+%[,)]|area\))`,
);

/**
 * What an own-press `[ENEMY DEF]` line says the ability DOES — the label in
 * the parenthesis after its name — is the producer's, for every ability:
 *
 *  - an effect save (user ruling D8, 2026-10-10) reads its effect: Feign
 *    Death `(absorb …)`, Nature's Guardian `(heal proc)`, Cheat Death /
 *    Cauterize `(cheat-death proc)` — never `(immune …)`, the wording that
 *    made a shield and three passives read as "cannot be hit" (605
 *    new-season files: an enemy player's direct damage landed inside 510 of
 *    697 Feign Death "immunities", 164 of 174 Nature's Guardian, 31 of 34
 *    Cauterize, 7 of 10 Cheat Death) — `ENEMY_SAVE_EFFECT_BY_NAME`,
 *    `enemySaveEffectOfNote`;
 *  - a pressed self defensive (user ruling 2026-10-11) reads the mechanism
 *    the shared function gives for it — `selfSaveMechanismOfName` =
 *    `selfDefensiveMechanism` by the printed name, read with
 *    `statesSelfDefensiveLabel`: Dark Pact `(absorb …)`, Crimson Vial
 *    `(heal)`, Evasion `(dodge)`, Nether Ward `(spell reflect)` …;
 *  - one of them prints a percentage in the wall line's form — Roar of
 *    Sacrifice `(25%, Ts)`, the official figure a corpus split stands behind
 *    (2026-10-11, `ownAuraReductionPct`) — and is no wall: a prompt that
 *    carries the `[ENEMY DEF]` legend must carry that press's own entry
 *    (`selfReductionLegend`, the producer's sentence), or the line reads as
 *    a wall and KILL ATTEMPTS' `popped X` as a wall's;
 *  - a deflection (`DEFLECTION_IDS`: Aspect of the Turtle, fact4 D6) opens
 *    with the producer's `ENEMY_DEF_DEFLECTS_WORDS`, and nothing else does;
 *  - any other ability opens with a wall's, an immunity's or an area save's
 *    label, and carries no effect note — so a press nobody classified cannot
 *    print without a label;
 *  - and no `[ENEMY DEF]` line prints `(self-save)` (`SELF_SAVE_PURPOSE_LABEL`)
 *    at all: that label stated why the button was pressed, which the log
 *    does not show (605-file capture `cap605-n9`: 13,068 such lines in 2,907 of 3,520
 *    contexts, the unit at ≥ 95 % HP at the press on 160 of 292 Spirit Walk
 *    lines, 424 of 1,543 Dark Pact, 313 of 1,022 Alter Time).
 * An external (`X → unit`) carries no label of its own and is not read.
 */
export function checkEnemyDefSaveEffect(lines: string[]): string[] {
  const failures: string[] = [];
  const hasLegend = lines.some((l) => ENEMY_DEF_LEGEND.test(l));
  /** pressed self defensives printed with a percentage whose legend entry
   * the prompt lacks — reported once a name */
  const unexplained = new Set<string>();
  lines.forEach((line, i) => {
    const m = ENEMY_DEF_LINE.exec(line);
    if (!m) return;
    const quoted = `"${line.trim().slice(0, 160)}"`;
    if (line.includes(SELF_SAVE_PURPOSE_LABEL)) {
      failures.push(
        `line ${i + 1}: [ENEMY DEF] prints \`${SELF_SAVE_PURPOSE_LABEL}\` — a purpose the log does not show, not what the ability does: ${quoted}`,
      );
      return;
    }
    if (m[0].endsWith(" → ")) return;
    const spell = m[3]!;
    // the text after the ability's name, from its parenthesis
    const after = line.slice(
      m.index + m[0].length - (m[0].endsWith("(") ? 1 : 0),
    );
    const stated = enemySaveEffectOfNote(after);
    const expected = ENEMY_SAVE_EFFECT_BY_NAME.get(spell);
    if (expected !== undefined) {
      if (stated !== expected)
        failures.push(
          `line ${i + 1}: [ENEMY DEF] prints ${spell} as something other than its effect (${expected}): ${quoted}`,
        );
      return;
    }
    const mechanism = selfSaveMechanismOfName(spell);
    if (mechanism !== undefined) {
      if (!statesSelfDefensiveLabel(after, mechanism))
        failures.push(
          `line ${i + 1}: [ENEMY DEF] prints ${spell} with a label other than what it does (${selfDefensiveLabelWords(mechanism)}): ${quoted}`,
        );
      else if (
        mechanism.kind === "reduction" &&
        hasLegend &&
        !unexplained.has(spell) &&
        !lines.some((l) => l.trim() === selfReductionLegend(spell))
      ) {
        unexplained.add(spell);
        failures.push(
          `line ${i + 1}: [ENEMY DEF] prints ${spell} with a percentage, in a wall's form, and the legend does not say it is no wall: ${quoted}`,
        );
      }
      return;
    }
    // a deflection (Aspect of the Turtle, fact4 D6) reads the producer's
    // deflect words, and only a deflection does
    const deflectLabel = after.startsWith(`(${ENEMY_DEF_DEFLECTS_WORDS}`);
    if (deflectLabel !== deflectionNames().has(spell)) {
      failures.push(
        deflectLabel
          ? `line ${i + 1}: [ENEMY DEF] prints ${spell} as a deflection, which it is not: ${quoted}`
          : `line ${i + 1}: [ENEMY DEF] prints the deflection ${spell} without its deflect label: ${quoted}`,
      );
      return;
    }
    if (deflectLabel) return;
    if (stated !== undefined)
      failures.push(
        `line ${i + 1}: [ENEMY DEF] gives ${spell} an effect note (${stated}) it has no claim to: ${quoted}`,
      );
    else if (!ENEMY_DEF_WALL_LABEL.test(after))
      failures.push(
        `line ${i + 1}: [ENEMY DEF] prints ${spell} with no label the producer writes for it: ${quoted}`,
      );
  });
  return failures;
}

/** `m:ss  [YOU] [CD]   <Spell>…` / `m:ss  [TEAM] [CD]   <pid> (<spec>): <Spell>…`
 * / `m:ss  [ENEMY HEAL CD]   <pid> (<spec>): <Spell>…` — the press lines a
 * form cooldown can be printed on; group 3 / 4 = the unit's id. */
const FORM_COOLDOWN_PRESS_LINE =
  /^(\d+):(\d\d) {2}(?:\[YOU\] \[CD\] {3}|\[TEAM\] \[CD\] {3}(\d+)\([^)]*\) \([^)]*\): |\[ENEMY HEAL CD\] {3}(\d+)\([^)]*\) \([^)]*\): )(.*)$/;

/**
 * F11: a cooldown that opens a form — Incarnation: Tree of Life — logs a
 * SPELL_CAST_SUCCESS for the press and for every shift back into the form
 * while the cooldown's own buff runs (`FORM_COOLDOWN_BUFF_BY_CAST_ID`); only
 * the press is a press (`isFormReshiftCast`, the producers' predicate). Two
 * press lines of it for ONE unit closer together than that buff's official
 * duration cannot both be presses: the cooldown cannot come back inside its
 * own buff. b711d4ac printed `[YOU] [CD] Incarnation: Tree of Life` at 0:22
 * and at 1:00; 14055cb2's druid pressed at 2:41 and shifted back at 3:05.
 *
 * Read on the rendered grid: both lines are floored to whole seconds, so
 * two casts less than D apart can print up to D seconds apart — a gap of
 * D − 2 printed seconds or less is always under D. A lower bound: a talent
 * that lengthens the buff (b711d4ac's ran 40 s) lets a later shift back
 * through, which only the log-side tests can see.
 */
export function checkFormCooldownPressSpacing(lines: string[]): string[] {
  const forms = Object.entries(FORM_COOLDOWN_BUFF_BY_CAST_ID).flatMap(
    ([castId, buffId]) => {
      const name = getEnglishSpellName(castId, "");
      const buffSeconds = spellEffectData[buffId]?.durationSeconds;
      return name && buffSeconds ? [{ name, buffSeconds }] : [];
    },
  );
  const failures: string[] = [];
  const last = new Map<string, { t: number; line: number }>();
  lines.forEach((line, i) => {
    const m = FORM_COOLDOWN_PRESS_LINE.exec(line);
    if (!m) return;
    const rest = m[5]!;
    const form = forms.find(
      (f) =>
        rest.startsWith(f.name) && !/[A-Za-z]/.test(rest[f.name.length] ?? ""),
    );
    if (!form) return;
    const unit = m[3] ?? m[4] ?? "YOU";
    const t = Number(m[1]) * 60 + Number(m[2]);
    const key = `${unit}|${form.name}`;
    const prev = last.get(key);
    last.set(key, { t, line: i });
    if (prev && t - prev.t <= form.buffSeconds - 2)
      failures.push(
        `line ${i + 1}: ${form.name} printed as pressed ${t - prev.t}s after the press on line ${prev.line + 1} — inside its own ${form.buffSeconds}s buff, so a shift back into the form: "${line.trim().slice(0, 140)}"`,
      );
  });
  return failures;
}

/**
 * HardFailure class (F15 / fact1215 C2, 2026-10-17): an `[ENEMY DEF]` line of
 * a school-limited immunity — Cloak of Shadows, Blessing of Protection,
 * Blessing of Spellwarding (`limitedImmunitySchoolMask`) — names the schools
 * it stops (`immune to magic`), never a bare `immune`, which the legend
 * defines as full immunity (0f894aee 5:00: `Cloak of Shadows (immune, 5.0s)`
 * while 9 physical hits landed).
 */
const ENEMY_DEF_BARE_IMMUNE =
  /^\s*\d+:\d{2}\s+\[ENEMY DEF\].*?: (.+?) \(immune[,)]/;
export function checkSchoolLimitedImmuneLabel(lines: string[]): string[] {
  const names = schoolLimitedImmunityNames();
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = ENEMY_DEF_BARE_IMMUNE.exec(line);
    if (m && names.has(m[1]!))
      failures.push(
        `line ${i + 1}: ${m[1]} 只免疫部分学派,却写成完全免疫 \`immune\` —— ${line.trim().slice(0, 160)}`,
      );
  });
  return failures;
}

/**
 * `[ENEMY DEF] … (…, end not logged)` — an aura whose end the log never
 * showed (user ruling D6, 2026-10-10: "prints `end not logged`, not the
 * official duration presented as OBSERVED"; 605 new-season files: 1,302 of
 * 7,541 lines with a duration had no logged end, 1,129 of them printed the
 * official maximum). What the rendered text can be held to:
 *  - the phrase stands in the duration's slot and closes the parenthesis
 *    (`ENEMY_DEF_END_NOT_LOGGED_SLOT_RE`, the producer's) — never beside a
 *    duration, never with an end note (`— removed early`, `— still up …`):
 *    an end the log never showed has no length and no cause;
 *  - the line carries no `| during it:` — what the attackers did "while it
 *    was up" cannot be measured on an aura with no end
 *    (`externalDamageForApplication` returns nothing for it);
 *  - a prompt that prints the phrase defines it in the `[ENEMY DEF]` legend.
 * Whether a given aura HAD a logged end is the log's to say, not the text's:
 * `test/enemyDefEndNotLogged.test.ts` (analysis) pins that side.
 */
export function checkEnemyDefEndNotLogged(lines: string[]): string[] {
  const failures: string[] = [];
  let printed = false;
  lines.forEach((line, i) => {
    if (!ENEMY_DEF_LINE.test(line) || !line.includes(ENEMY_DEF_END_NOT_LOGGED))
      return;
    printed = true;
    const fail = (why: string) =>
      failures.push(
        `line ${i + 1}: [ENEMY DEF] \`${ENEMY_DEF_END_NOT_LOGGED}\` ${why}: "${line.trim().slice(0, 160)}"`,
      );
    if (!ENEMY_DEF_END_NOT_LOGGED_SLOT_RE.test(line))
      fail("is not alone in the duration's slot");
    if (line.includes("| during it:"))
      fail("beside a `during it` window, which needs the aura's end");
  });
  if (
    printed &&
    !lines.some(
      (l) =>
        !ENEMY_DEF_LINE.test(l) &&
        l.includes(`\`${ENEMY_DEF_END_NOT_LOGGED}\``),
    )
  )
    failures.push(
      `[ENEMY DEF] lines print \`${ENEMY_DEF_END_NOT_LOGGED}\` but no legend line defines it`,
    );
  return failures;
}

/** `  [m:ss–m:ss] on <unit> — … | FAILED: broke out (A/B)[; forced a full immunity …]` */
const KILL_ATTEMPT_BROKE_OUT =
  /^\s*\[(\d+):(\d\d)–(\d+):(\d\d)\] on (\S+) — .*\| FAILED: broke out \(([^()|]+)\)/;
/** `m:ss  [ENEMY TRINKET]   <pid> used <ability>[ out of …]` */
const ENEMY_BREAK_LINE =
  /^(\d+):(\d\d) {2}\[ENEMY TRINKET\] {3}(\S+) used (.+?)(?: out of | \[| \(|$)/;

/** `m:ss  [CC REMOVED]   <pid>'s Blessing of Sanctuary removed … from <pid>` */
const SANCTUARY_REMOVED_LINE =
  /^(\d+):(\d\d) {2}\[CC REMOVED\] {3}\S+ Blessing of Sanctuary removed .* from (\S+?)(?: after |$)/;

/**
 * KILL ATTEMPTS `broke out (X)` ⇒ an `[ENEMY TRINKET] … used X out of …` line
 * — or, for `Blessing of Sanctuary`, its `[CC REMOVED]` line on the target
 * (fact4 D11, an ally's removal) —
 * inside the attempt's credit window `[from, to + KILL_CREDIT_SLACK_S]` — the
 * window `attributeFailure` reads a break over (the trinket's window; triage
 * enemy-def F-E21). Both render from `analyzePlayerCCAndTrinket`'s
 * `breakAbilityUses`, so a miss is a producer bug: the summary names a break
 * the timeline never showed. Keyed on the `[ENEMY TRINKET]` legend line.
 */
export function checkBrokeOutRefConsistency(lines: string[]): string[] {
  const idOf = unitIdsByName(lines);
  const breaks: Array<{
    atS: number;
    what: string;
    outOf: boolean;
    byId?: string;
  }> = [];
  for (const line of lines) {
    const m = ENEMY_BREAK_LINE.exec(line);
    if (m)
      breaks.push({
        atS: Number(m[1]) * 60 + Number(m[2]),
        what: m[4]!,
        outOf: line.includes(" out of "),
        byId: /^(\d+)\(/.exec(m[3]!)?.[1],
      });
  }
  // fact4 D11: an ally's Blessing of Sanctuary is a break of its own — its
  // `[CC REMOVED] … Blessing of Sanctuary removed … from <unit>` line
  for (const line of lines) {
    const m = SANCTUARY_REMOVED_LINE.exec(line);
    if (m)
      breaks.push({
        atS: Number(m[1]) * 60 + Number(m[2]),
        what: "Blessing of Sanctuary",
        outOf: true,
        byId: /^(\d+)\(/.exec(m[3]!)?.[1],
      });
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = KILL_ATTEMPT_BROKE_OUT.exec(line);
    if (!m) return;
    const fromS = Number(m[1]) * 60 + Number(m[2]);
    const toS = Number(m[3]) * 60 + Number(m[4]) + KILL_CREDIT_SLACK_S;
    // the target as the timeline numbers it; unresolved → unit not compared
    const targetId = idOf.get(m[5]!);
    for (const raw of m[6]!.split("/")) {
      const what = raw.trim();
      if (!what) continue;
      const hit = breaks.some(
        (b) =>
          b.what === what &&
          b.outOf &&
          (targetId === undefined ||
            b.byId === undefined ||
            b.byId === targetId) &&
          b.atS >= fromS &&
          b.atS <= toS,
      );
      if (!hit)
        failures.push(
          `line ${i + 1}: KILL ATTEMPTS says the target broke out with "${what}" in [${fmtTime(fromS)}–${fmtTime(toS)}] but no [ENEMY TRINKET] line shows that unit breaking a control with it there: "${line.trim()}"`,
        );
    }
  });
  return failures;
}

/** crisis-no-response: every rendered reference number must be exactly what
 * lookupBehaviorPrior returns for the line's own bracket/role/dmg2s (spec
 * §5, role dimension spec §1d GH #59) — the analysis side and this gate
 * share the lookup, so any drift is a bug in the producer's formatting, not
 * a judgement call. Role is derived from the rendered `cellKey` itself
 * (`${bracket}|${role}|${dmgBin}`), never assumed to be "healer". */
export function checkBehaviorPriorConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("type=crisis-no-response")) continue;
    const m = line.match(/facts=\{(.*)\}\s*$/);
    if (!m) {
      failures.push(`line ${i + 1}: crisis-no-response 行无 facts`);
      continue;
    }
    const f = parseFactsBlock(m[1]!);
    const dmg2s = Number(f.dmg2sPct);
    if (!Number.isFinite(dmg2s)) {
      failures.push(`line ${i + 1}: crisis-no-response 行缺 dmg2sPct`);
      continue;
    }
    const cellKeyParts = (f.cellKey ?? "").split("|");
    const bracket = cellKeyParts[0] ?? "";
    // Role travels inside cellKey itself (spec §1d, GH #59: `${bracket}|
    // ${role}|${dmgBin}`) — derive it from the rendered fact rather than
    // hardcoding "healer", and reject anything that isn't a known role so a
    // corrupted/renamed cellKey fails closed instead of silently looking up
    // the wrong population.
    const role = cellKeyParts[1] ?? "";
    if (role !== "healer" && role !== "dps") {
      failures.push(
        `line ${i + 1}: crisis-no-response cellKey 里的 role「${role}」不是 healer/dps(${f.cellKey ?? ""})`,
      );
      continue;
    }
    const ref = lookupBehaviorPrior(bracket, role, dmg2s / 100);
    if (!ref) {
      failures.push(
        `line ${i + 1}: crisis-no-response 引用了表里不存在的赛制 ${bracket}`,
      );
      continue;
    }
    const expect: Record<string, string> = {
      cellKey: ref.cellKey,
      refNNoResp: String(ref.nNoResp),
      refDeathNoResp: String(ref.deathNoRespPct),
      refNResp: String(ref.nResp),
      refDeathResp: String(ref.deathRespPct),
      refOutcome: outcomePhrase(ref.outcome),
      refOutcomeKey: ref.outcome,
      refTop: ref.top.map(([k, v]) => `${k} ${v}%`).join("; "),
      fellBack: ref.fellBack ? "yes" : "no",
    };
    for (const [k, v] of Object.entries(expect))
      if (f[k] !== v)
        failures.push(
          `line ${i + 1}: crisis-no-response ${k}=${f[k]} 与参照表 ${v} 不一致(${ref.cellKey})`,
        );
  }
  return failures;
}

/**
 * 14th hardFailure class (2026-09-01, GH #60 phase 2). Exactly the same shape
 * as `checkBehaviorPriorConsistency` above and for the same reason: the
 * producer renders the corpus reference from
 * `lookupBurstWindowPrior(bracket, leadCdId)`, and this gate re-parses the
 * rendered menu line and demands the SAME lookup return the SAME numbers
 * (CLAUDE.md shared-predicate rule — one import, two sides). A drifting
 * producer, a stale cached round or a model-edited prompt all go red.
 *
 * The bracket is read out of `cellKey`'s first field, exactly as
 * `checkBehaviorPriorConsistency` does. When the reference fell all the way
 * back to the global `*|*` cell, that field IS `*`, so the re-lookup can only
 * confirm the global cell's own numbers — a real (and stated) limit, not a
 * hole: a `*|*` line is by definition not making a bracket-specific claim.
 * Fails closed — a missing fact is a failure, otherwise a producer that simply
 * stopped emitting the reference would leave the legend citing facts that do
 * not exist.
 *
 * 2026-09-01 also verifies the **minimum-contrast door**: a rendered line
 * whose own `refDeathNoResp - refDeathResp` is below
 * `BURST_REF_MIN_CONTRAST_PP` is a hardFailure. The producer refuses to emit
 * such a line (`burstRefClearsMinContrast` in
 * `candidates/burstWindowResponse.ts`) and this side re-checks it on the
 * numbers parsed back out of the prompt text, through the SAME imported
 * predicate — analysis consumes the gate's predicate, and the door cannot
 * drift on one side only. Checked on the rendered integers, which is why the
 * door lives on `BurstWindowPriorRef`'s already-rounded percentages.
 */
export function checkBurstWindowRefConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // `type=<t> ` — the menu renderer always follows the type with a space
    if (!line.includes("type=slow-defensive-response ")) continue;
    const m = line.match(/facts=\{(.*)\}\s*$/);
    if (!m) {
      failures.push(`line ${i + 1}: slow-defensive-response 行无 facts`);
      continue;
    }
    const f = parseFactsBlock(m[1]!);
    const leadCdId = f.leadCdId;
    const cellKey = f.cellKey ?? "";
    if (!leadCdId || !cellKey) {
      failures.push(
        `line ${i + 1}: slow-defensive-response 缺 leadCdId/cellKey,无法核对语料参照`,
      );
      continue;
    }
    const bracket = cellKey.split("|")[0] ?? "";
    const ref = lookupBurstWindowPrior(bracket, leadCdId);
    if (!ref) {
      failures.push(
        `line ${i + 1}: slow-defensive-response 引用了表里查不到的单元格 ${cellKey}`,
      );
      continue;
    }
    const expect: Record<string, string> = {
      cellKey: ref.cellKey,
      refN: String(ref.nResp + ref.nNoResp),
      refDeathResp: String(ref.deathRespPct),
      refDeathNoResp: String(ref.deathNoRespPct),
      refTop: ref.topResponses.map(([k, v]) => `${k} ${v}%`).join("; "),
      fellBack: ref.fellBack ? "yes" : "no",
    };
    for (const [k, v] of Object.entries(expect))
      if (f[k] !== v)
        failures.push(
          `line ${i + 1}: slow-defensive-response ${k}=${f[k]} 与参照表 ${v} 不一致(${ref.cellKey})`,
        );
    // Minimum-contrast door, checked on THIS LINE's own rendered numbers.
    const rendered = {
      deathRespPct: Number(f.refDeathResp),
      deathNoRespPct: Number(f.refDeathNoResp),
    };
    if (
      !Number.isFinite(rendered.deathRespPct) ||
      !Number.isFinite(rendered.deathNoRespPct)
    ) {
      failures.push(
        `line ${i + 1}: slow-defensive-response 的 refDeathResp/refDeathNoResp 不是数字,无法核对最小对比度门槛`,
      );
    } else if (!burstRefClearsMinContrast(rendered)) {
      failures.push(
        `line ${i + 1}: slow-defensive-response 引用的对比度只有 ${burstRefContrastPp(rendered)} pp(${f.refDeathNoResp}% vs ${f.refDeathResp}%),低于门槛 ${BURST_REF_MIN_CONTRAST_PP} pp —— 被引用的数字在反驳这条指控(${ref.cellKey})`,
      );
    }
  }
  return failures;
}

const OFFENSIVE_WINDOW_LINE =
  /\[OFFENSIVE WINDOW\]\s+(\d+):(\d+)–(\d+):(\d+)\s+\|\s+peak spike\s+.*?over\s+(\d+):(\d+)–(\d+):(\d+)(.*?)\s+\|\s+CDs:/;

/**
 * HardFailure class (GH #99 item 4): verifies that each [OFFENSIVE WINDOW] line's
 * peak spike placement marker matches the spike's placement relative to the window
 * on the prompt's render grid.
 *
 * Imports `peakSpikePlacement` and `PEAK_SPIKE_MARKERS` from `@gladlog/analysis`.
 */
export function checkOffensiveWindowSpikeMarker(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (
      !line.includes("[OFFENSIVE WINDOW]") ||
      !line.includes("| peak spike")
    ) {
      continue;
    }
    const m = line.match(OFFENSIVE_WINDOW_LINE);
    if (!m) {
      failures.push(
        `line ${i + 1}: [OFFENSIVE WINDOW] 无法解析 window / peak spike 区间`,
      );
      continue;
    }
    const windowToSeconds = Number(m[3]) * 60 + Number(m[4]);
    const spikeFromSeconds = Number(m[5]) * 60 + Number(m[6]);
    const spikeToSeconds = Number(m[7]) * 60 + Number(m[8]);

    const placement = peakSpikePlacement(
      windowToSeconds,
      spikeFromSeconds,
      spikeToSeconds,
    );
    const requiredMarker = PEAK_SPIKE_MARKERS[placement].trim();
    const rawMarker = m[9] ?? "";
    const presentMarker = rawMarker.trim();

    if (presentMarker !== requiredMarker) {
      if (requiredMarker === "") {
        failures.push(
          `line ${i + 1}: [OFFENSIVE WINDOW] peak spike 区间 ${m[5]}:${m[6]}–${m[7]}:${m[8]} 位于窗口 ${m[1]}:${m[2]}–${m[3]}:${m[4]} 内,不应有标注 ${presentMarker}`,
        );
      } else if (presentMarker === "") {
        failures.push(
          `line ${i + 1}: [OFFENSIVE WINDOW] peak spike 区间 ${m[5]}:${m[6]}–${m[7]}:${m[8]} 相对窗口 ${m[1]}:${m[2]}–${m[3]}:${m[4]} 为 ${placement},缺少标注 ${requiredMarker}`,
        );
      } else {
        failures.push(
          `line ${i + 1}: [OFFENSIVE WINDOW] peak spike 区间 ${m[5]}:${m[6]}–${m[7]}:${m[8]} 相对窗口 ${m[1]}:${m[2]}–${m[3]}:${m[4]} 为 ${placement},标注应为 ${requiredMarker},实为 ${presentMarker}`,
        );
      }
    } else if (requiredMarker !== "" && !rawMarker.startsWith(" ")) {
      failures.push(
        `line ${i + 1}: [OFFENSIVE WINDOW] 标注 ${presentMarker} 前缺少空格`,
      );
    }
  }
  return failures;
}

/** A timeline `[OFFENSIVE WINDOW]` header: its own span and the clause
 * between the span and `CDs:` (the legend's mention of the tag has no
 * timestamp column and does not match). */
const OFFENSIVE_WINDOW_HEADER =
  /^\s*\d+:\d{2}\s+\[OFFENSIVE WINDOW\]\s+(\d+):(\d{2})–(\d+):(\d{2}) \| (.*) \| CDs: /;
const OFFENSIVE_WINDOW_PEAK_CLAUSE =
  /^peak spike (\d+\.\d{2})M on (\S+) \(.*\) over (\d+):(\d{2})–(\d+):(\d{2})(?: \([^)]*\))?$/;
const DMG_SPIKE_AMOUNT_LINE =
  /^\s*(\d+):(\d{2})–(\d+):(\d{2})\s+\[DMG SPIKE\]\s+(\S+) \(.*?\): (\d+\.\d{2})M in /;

/**
 * HardFailure class (D4, user ruling 2026-10-10): the `[DMG SPIKE]` list's
 * cap and the line that counts what it dropped
 * (`formatDmgSpikesNotListed`, read back by the producer's own
 * `parseDmgSpikesNotListed`).
 *
 *  - The list never holds more than `PRESSURE_WINDOWS_TOP_N` lines — the cap
 *    the legend sentence now states (signed 2026-08-23).
 *  - A count line is printed once at most, under the legend sentence, and
 *    only when the list is full: a window is dropped by the cap only after
 *    `PRESSURE_WINDOWS_TOP_N` larger ones were kept.
 *  - It states the listing threshold (`DMG_SPIKE_THRESHOLD`); its largest is
 *    at least that and no more than any listed line's total (it ranked below
 *    them all); and its window overlaps no listed line of the same unit on
 *    the displayed seconds (one unit's windows never overlap).
 *
 * The count itself is not re-derivable from the text — the dropped windows
 * are exactly what the prompt does not print; it is pinned on the selection
 * (`selectPressureWindows`) by the analysis tests.
 */
export function checkDmgSpikeListCap(lines: string[]): string[] {
  const failures: string[] = [];
  const listed: {
    fromSeconds: number;
    toSeconds: number;
    unit: string;
    amount: number;
  }[] = [];
  const counts: {
    line: number;
    s: NonNullable<ReturnType<typeof parseDmgSpikesNotListed>>;
  }[] = [];
  // one window is one line; a section that quotes a timeline line again is
  // not a second window
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    const sp = line.match(DMG_SPIKE_AMOUNT_LINE);
    if (sp) {
      const key = sp.slice(1, 7).join("|");
      if (seen.has(key)) return;
      seen.add(key);
      listed.push({
        fromSeconds: Number(sp[1]) * 60 + Number(sp[2]),
        toSeconds: Number(sp[3]) * 60 + Number(sp[4]),
        unit: sp[5]!,
        amount: Number(sp[6]),
      });
      return;
    }
    const s = parseDmgSpikesNotListed(line);
    if (s) counts.push({ line: i + 1, s });
  });
  if (listed.length > PRESSURE_WINDOWS_TOP_N)
    failures.push(
      `[DMG SPIKE] 列了 ${listed.length} 行,超过上限 ${PRESSURE_WINDOWS_TOP_N}`,
    );
  if (counts.length > 1)
    failures.push(
      `「not listed」汇总行出现了 ${counts.length} 次(line ${counts.map((c) => c.line).join(" / ")})`,
    );
  const thresholdM = Number((DMG_SPIKE_THRESHOLD / 1_000_000).toFixed(2));
  const legend = dmgSpikeListLegend().trim();
  for (const { line, s } of counts) {
    const at = `line ${line}: [DMG SPIKE] 汇总行`;
    if (lines[line - 2]?.trim() !== legend)
      failures.push(`${at} 不在说明上限的图例句之下`);
    if (s.count < 1) failures.push(`${at} 的数量是 ${s.count}`);
    if (listed.length !== PRESSURE_WINDOWS_TOP_N)
      failures.push(
        `${at} 说还有 ${s.count} 个未列,但只列了 ${listed.length} 行(上限 ${PRESSURE_WINDOWS_TOP_N})`,
      );
    if (s.thresholdM !== thresholdM)
      failures.push(`${at} 写的门槛 ${s.thresholdM}M ≠ ${thresholdM}M`);
    if (s.largestM < thresholdM)
      failures.push(`${at} 的最大值 ${s.largestM}M 低于门槛 ${thresholdM}M`);
    const smaller = listed.filter((l) => l.amount < s.largestM);
    if (smaller.length > 0)
      failures.push(
        `${at} 的最大值 ${s.largestM}M 超过已列出的 ${smaller.map((l) => `${l.amount.toFixed(2)}M`).join(" / ")}`,
      );
    const clash = listed.filter(
      (l) =>
        l.unit === s.unit &&
        Math.min(l.toSeconds, s.toSec) - Math.max(l.fromSeconds, s.fromSec) > 0,
    );
    if (clash.length > 0)
      failures.push(
        `${at} 的窗口 ${s.unit} ${fmtTime(s.fromSec)}–${fmtTime(s.toSec)} 与已列出的 ${clash.map((l) => `${fmtTime(l.fromSeconds)}–${fmtTime(l.toSeconds)}`).join(" / ")} 重叠`,
      );
  }
  return failures;
}

/**
 * HardFailure class (T12 ③, user ruling 2026-10-10): which `[DMG SPIKE]` an
 * `[OFFENSIVE WINDOW]` header names. Re-runs the producer's own rule
 * (`creditSpikesToWindows`) on the rendered headers and the rendered
 * `[DMG SPIKE]` lines:
 *
 *  - a named spike is a listed `[DMG SPIKE]` line, overlaps the window on the
 *    displayed seconds, and is credited to THIS window — so no spike is named
 *    on two headers and none on a window it lies outside of;
 *  - it is the largest credited to the window;
 *  - a header that says none is credited has none.
 *
 * "Overlaps" is the producer's `spikeWindowOverlapSeconds`, whole: a spike
 * line that prints one second (`0:45–0:45`, a bucket closed in the second it
 * opened) is in every window whose printed span holds that second.
 *
 * Before the rule: 444 of 8,154 headers on the 605 capture named a spike that
 * began after the window ended, 180 spikes were named on two headers.
 */
export function checkOffensiveWindowSpikeCredit(lines: string[]): string[] {
  const failures: string[] = [];
  const headers: {
    line: number;
    fromSeconds: number;
    toSeconds: number;
    clause: string;
  }[] = [];
  const spikes: {
    fromSeconds: number;
    toSeconds: number;
    unit: string;
    amount: number;
  }[] = [];
  lines.forEach((line, i) => {
    const h = line.match(OFFENSIVE_WINDOW_HEADER);
    if (h) {
      headers.push({
        line: i + 1,
        fromSeconds: Number(h[1]) * 60 + Number(h[2]),
        toSeconds: Number(h[3]) * 60 + Number(h[4]),
        clause: h[5]!,
      });
      return;
    }
    const sp = line.match(DMG_SPIKE_AMOUNT_LINE);
    if (sp)
      spikes.push({
        fromSeconds: Number(sp[1]) * 60 + Number(sp[2]),
        toSeconds: Number(sp[3]) * 60 + Number(sp[4]),
        unit: sp[5]!,
        amount: Number(sp[6]),
      });
  });
  if (headers.length === 0) return failures;
  const creditedTo = creditSpikesToWindows(headers, spikes);
  const describe = (sp: (typeof spikes)[number]) =>
    `${sp.amount.toFixed(2)}M on ${sp.unit} over ${fmtTime(sp.fromSeconds)}–${fmtTime(sp.toSeconds)}`;
  headers.forEach((h, w) => {
    const at = `line ${h.line}: [OFFENSIVE WINDOW] ${fmtTime(h.fromSeconds)}–${fmtTime(h.toSeconds)}`;
    const credited = spikes.filter((_, s) => creditedTo[s] === w);
    if (h.clause === NO_CREDITED_SPIKE_CLAUSE) {
      if (credited.length > 0)
        failures.push(
          `${at} 写「${NO_CREDITED_SPIKE_CLAUSE}」,但 [DMG SPIKE] ${describe(credited[0]!)} 归属本窗口`,
        );
      return;
    }
    const m = h.clause.match(OFFENSIVE_WINDOW_PEAK_CLAUSE);
    if (!m) {
      failures.push(`${at} 无法解析 spike 子句「${h.clause}」`);
      return;
    }
    const amount = Number(m[1]);
    const unit = m[2]!;
    const sFrom = Number(m[3]) * 60 + Number(m[4]);
    const sTo = Number(m[5]) * 60 + Number(m[6]);
    if (
      spikeWindowOverlapSeconds(h.fromSeconds, h.toSeconds, sFrom, sTo) <= 0
    ) {
      failures.push(
        `${at} 的 peak spike ${fmtTime(sFrom)}–${fmtTime(sTo)} 与窗口没有交集`,
      );
      return;
    }
    const s = spikes.findIndex(
      (sp) =>
        sp.unit === unit && sp.fromSeconds === sFrom && sp.toSeconds === sTo,
    );
    if (s < 0) {
      failures.push(
        `${at} 的 peak spike 没有对应的 [DMG SPIKE] 行(${unit} ${fmtTime(sFrom)}–${fmtTime(sTo)})`,
      );
      return;
    }
    if (spikes[s]!.amount !== amount)
      failures.push(
        `${at} 的 peak spike 写 ${amount.toFixed(2)}M,对应的 [DMG SPIKE] 行写 ${spikes[s]!.amount.toFixed(2)}M`,
      );
    if (creditedTo[s] !== w) {
      const other = headers[creditedTo[s]!]!;
      failures.push(
        `${at} 的 peak spike ${describe(spikes[s]!)} 归属 ${fmtTime(other.fromSeconds)}–${fmtTime(other.toSeconds)} 的窗口(重叠更长 / 同长取先开的),不归本窗口`,
      );
      return;
    }
    const larger = credited.find((sp) => sp.amount > amount);
    if (larger)
      failures.push(
        `${at} 的 peak spike ${amount.toFixed(2)}M 不是归属本窗口的最大一个:${describe(larger)}`,
      );
  });
  return failures;
}

/**
 * HardFailure class (T12 ① b, user ruling 2026-10-10, option A — the header's
 * END is cut at the round's end; post-hoc review 45-FT-98, finding 3): the
 * span an `[OFFENSIVE WINDOW]` header prints.
 *
 *  - it does not end before it starts (`0:42–0:40`: a window opened after the
 *    round's end, its end cut at that end);
 *  - it neither starts nor ends after the round's end as the prompt states it
 *    (`statedRoundEnd` — `[MATCH END]`, and a Solo Shuffle round's first
 *    `[DEATH]` line). The producer prints min(the window's end, `roundEndMs`)
 *    and gives a window that opens at or after `roundEndMs` no header
 *    (`emitOffensiveWindowEntries`), so both seconds are at or before that
 *    line's — no tolerance. A header in the round-end second itself is not
 *    judged: before or after the death inside that second is under the grid.
 *
 * The header only — the window OBJECT is not cut, on purpose (docs
 * "Not yet unified", WP-A1 2).
 */
export function checkOffensiveWindowHeaderSpan(lines: string[]): string[] {
  const failures: string[] = [];
  const roundEnd = statedRoundEnd(lines);
  lines.forEach((line, i) => {
    const h = line.match(OFFENSIVE_WINDOW_HEADER);
    if (!h) return;
    const from = Number(h[1]) * 60 + Number(h[2]);
    const to = Number(h[3]) * 60 + Number(h[4]);
    const at = `line ${i + 1}: [OFFENSIVE WINDOW] ${h[1]}:${h[2]}–${h[3]}:${h[4]}`;
    if (to < from) failures.push(`${at} 的结束早于开始`);
    if (roundEnd !== null && Math.max(from, to) > roundEnd.second)
      failures.push(
        `${at} ${from > roundEnd.second ? "开始" : "结束"}于回合结束之后(${roundEnd.says}在 ${fmtTime(roundEnd.second)})`,
      );
  });
  return failures;
}

/**
 * HardFailure class (codex post-hoc 60-POSTHOC-03 U3, 2026-10-18): the spans
 * a multi-CD burst-ledger header gives each cooldown (`Burst #1 — 0:10–0:20 |
 * Avatar 0:10–0:20 + Recklessness 0:21–0:20`). Every span lies inside the
 * header's: it does not end before it starts, and it starts and ends within
 * the header's span. A press after the round's end used to join the burst it overlapped
 * and print a span that started after the clipped header end
 * (`analyzeBurstLedger` drops it before grouping now). No tolerance: both
 * sides print the same seconds.
 */
export function checkBurstLedgerSpellSpans(lines: string[]): string[] {
  const failures: string[] = [];
  const toS = (m: string, ss: string) => Number(m) * 60 + Number(ss);
  lines.forEach((line, i) => {
    const h = line.match(BURST_LEDGER_LINE);
    if (!h) return;
    const headerFrom = toS(h[2]!, h[3]!);
    const headerTo = toS(h[4]!, h[5]!);
    const spells = line.slice(line.indexOf("|") + 1).split(" + ");
    for (const sp of spells) {
      const m = sp.match(/ (\d+):(\d{2})–(\d+):(\d{2})\s*$/);
      if (!m) continue;
      const from = toS(m[1]!, m[2]!);
      const to = toS(m[3]!, m[4]!);
      const at = `line ${i + 1}: Burst #${h[1]} 的 ${sp.trim()}`;
      if (to < from) failures.push(`${at} 结束早于开始`);
      // inside the header's span (codex 20-F15-20: `0:05–0:20` under a
      // `0:10–0:20` header passed)
      if (from < headerFrom || from > headerTo || to > headerTo)
        failures.push(`${at} 不在整段 ${h[2]}:${h[3]}–${h[4]}:${h[5]} 之内`);
    }
  });
  return failures;
}

/**
 * `[CD PRIOR]`'s crossing reads ONE unit: "<unit> fell below that at m:ss
 * (N%)" is that unit's `[STATE]` reading at that second (the producer's
 * `gridHpPct` of the named unit at its own crossing second — codex
 * 60-POSTHOC-06c #1 / 07a #2: the name came from the dip's minimum and the
 * second and HP from another friendly's crossing, "Bob fell below that at
 * 0:02 (48%)" with 48 % Alice's). A second with no `[STATE]` line, or a
 * unit the line does not list, is not read.
 */
export function checkCdPriorCrossingHp(lines: string[]): string[] {
  const stateAt = new Map<number, Map<string, number>>();
  for (const line of lines) {
    const m = line.match(STATE_LINE);
    if (!m) continue;
    const units = new Map<string, number>();
    for (const u of m[3]!.matchAll(/(\S+?):(\d+)\b/g))
      units.set(u[1]!, Number(u[2]));
    stateAt.set(Number(m[1]) * 60 + Number(m[2]), units);
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!/^\s*\d+:\d{2}\s+\[CD PRIOR\]/.test(line)) return;
    const m = /;\s*(\d+\([^()]*\))(?: \(you\))? fell below that at (\d+):(\d{2}) \((\d+)%\)/.exec(
      line,
    );
    if (!m) return;
    const tick = stateAt.get(Number(m[2]) * 60 + Number(m[3]))?.get(m[1]!);
    if (tick === undefined) return;
    if (Math.abs(tick - Number(m[4])) > HP_AGREEMENT_TOLERANCE_PP)
      failures.push(
        `line ${i + 1}: [CD PRIOR] 说 ${m[1]} 在 ${m[2]}:${m[3]} 跌到 ${m[4]}%,但同秒 [STATE] 读 ${tick}%`,
      );
  });
  return failures;
}

/**
 * 16th hardFailure class (2026-09-04, GH #54 (f) / BACKLOG #38 (a)(h)): a
 * `[CD PRIOR]` context line's cohort numbers equal the reference table's.
 * The producer (`context/cdPrior.ts`) renders `medianHpPct` / `n` and the
 * cohort label from `lookupCdTriggerPrior(spec, heroTree, spellId)`; this
 * gate re-parses the line's `[ref=spec|tree|spellId]` suffix, redoes the
 * SAME lookup and demands the same integers and the same fallback wording
 * ("(spec-wide)" ⟺ the resolved key's tree is `*`). One import, both sides.
 * Fails closed on a malformed line.
 */
export function checkCdPriorRefConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Only the timestamped entry lines — the legend ("  [CD PRIOR] = a friendly
    // dipped …") carries the tag too and has no reference by design (33/309
    // false hardFailures on the first corpus run, 2026-09-04).
    if (!/^\s*\d+:\d{2}\s+\[CD PRIOR\]/.test(line)) continue;
    const ref = line.match(/\[ref=([^\]]+)\]\s*$/);
    const nums = line.match(/median lowest-friendly HP of (\d+)% \(n=(\d+)\)/);
    if (!ref || !nums) {
      failures.push(
        `line ${i + 1}: [CD PRIOR] 行缺 [ref=…] 或参照数字,无法核对语料参照`,
      );
      continue;
    }
    const cellKey = ref[1]!;
    const parts = cellKey.split("|");
    if (parts.length !== 3) {
      failures.push(`line ${i + 1}: [CD PRIOR] 的 cellKey 形状不对 ${cellKey}`);
      continue;
    }
    const [spec, tree, spellId] = parts as [string, string, string];
    const found = lookupCdTriggerPrior(spec, tree, spellId);
    if (!found) {
      failures.push(
        `line ${i + 1}: [CD PRIOR] 引用了表里查不到/不够样本的单元格 ${cellKey}`,
      );
      continue;
    }
    if (found.cellKey !== cellKey)
      failures.push(
        `line ${i + 1}: [CD PRIOR] cellKey=${cellKey} 但查表解析到 ${found.cellKey}`,
      );
    if (Number(nums[1]) !== found.medianHpPct)
      failures.push(
        `line ${i + 1}: [CD PRIOR] 渲染中位血线 ${nums[1]}% ≠ 表 ${found.medianHpPct}%`,
      );
    if (Number(nums[2]) !== found.n)
      failures.push(
        `line ${i + 1}: [CD PRIOR] 渲染 n=${nums[2]} ≠ 表 n=${found.n}`,
      );
    const saysSpecWide = line.includes("(spec-wide) cohort");
    if (saysSpecWide !== (tree === "*"))
      failures.push(
        `line ${i + 1}: [CD PRIOR] 「spec-wide」措辞与 cellKey 的树 ${tree} 不一致`,
      );
  }
  return failures;
}

/**
 * teammate-crisis-idle (GH #95, 2026-09-17): the healer-side twin of
 * `checkBehaviorPriorConsistency`, same shape and same reason — the producer
 * (`candidates/teammateCrisisIdle.ts`) renders the reference from
 * `lookupTeammateCrisisPriorByBin(bracket, bin)`; this gate re-parses the
 * menu line's facts and demands the SAME lookup return the SAME integers.
 * The bin is re-derived from the rendered `dmg2sPct` through the SAME
 * `teammateCrisisDmgBinOf`, and must also equal the bin inside `cellKey`
 * unless the line fell back to the bracket-wide `*` cell. Fails closed.
 */
export function checkTeammateCrisisRefConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // two producers, one table: the idle twin quotes the idle/answered
    // populations, the triage twin (user ruling 2026-09-17) the two triage
    // populations — each re-done through its own bin-keyed lookup
    const kind = line.includes("type=teammate-crisis-idle")
      ? "teammate-crisis-idle"
      : line.includes("type=teammate-crisis-triage")
        ? "teammate-crisis-triage"
        : null;
    if (!kind) continue;
    const m = line.match(/facts=\{(.*)\}\s*$/);
    if (!m) {
      failures.push(`line ${i + 1}: ${kind} 行无 facts`);
      continue;
    }
    const f = parseFactsBlock(m[1]!);
    const dmg2s = Number(f.dmg2sPct);
    if (!Number.isFinite(dmg2s)) {
      failures.push(`line ${i + 1}: ${kind} 行缺 dmg2sPct`);
      continue;
    }
    const parts = (f.cellKey ?? "").split("|");
    if (parts.length !== 2) {
      failures.push(
        `line ${i + 1}: ${kind} 的 cellKey 形状不对 ${f.cellKey ?? ""}`,
      );
      continue;
    }
    const [bracket, keyBin] = parts as [string, string];
    const bin = teammateCrisisDmgBinOf(dmg2s / 100);
    if (keyBin !== "*" && keyBin !== bin) {
      failures.push(
        `line ${i + 1}: ${kind} cellKey 的档位 ${keyBin} 与 dmg2sPct=${dmg2s} 推出的 ${bin} 不一致`,
      );
      continue;
    }
    let expect: Record<string, string> | null = null;
    let resolvedKey = "";
    if (kind === "teammate-crisis-idle") {
      const ref = lookupTeammateCrisisPriorByBin(
        bracket,
        bin as TeammateCrisisDmgBin,
      );
      if (ref) {
        resolvedKey = ref.cellKey;
        expect = {
          cellKey: ref.cellKey,
          refNIdle: String(ref.nIdle),
          refDeathIdle: String(ref.deathIdlePct),
          refNAnswered: String(ref.nAnswered),
          refDeathAnswered: String(ref.deathAnsweredPct),
          fellBack: ref.fellBack ? "yes" : "no",
        };
      }
    } else {
      const ref = lookupTeammateCrisisTriageByBin(
        bracket,
        bin as TeammateCrisisDmgBin,
      );
      if (ref) {
        resolvedKey = ref.cellKey;
        expect = {
          cellKey: ref.cellKey,
          refNWrong: String(ref.nTriageWrong),
          refDeathWrong: String(ref.deathTriageWrongPct),
          refNOther: String(ref.nTriageOther),
          refDeathOther: String(ref.deathTriageOtherPct),
          fellBack: ref.fellBack ? "yes" : "no",
        };
      }
    }
    if (!expect) {
      failures.push(
        `line ${i + 1}: ${kind} 引用了表里查不到/不够样本的单元格 ${f.cellKey}`,
      );
      continue;
    }
    for (const [k, v] of Object.entries(expect))
      if (f[k] !== v)
        failures.push(
          `line ${i + 1}: ${kind} ${k}=${f[k]} 与参照表 ${v} 不一致(${resolvedKey})`,
        );
  }
  return failures;
}

/**
 * 16th hardFailure class (GH #80, 2026-09-12): a `backlash-dispel` /
 * `backlash-dispel-window` menu line quotes corpus reference numbers from
 * data/backlashDispelPrior.ts; re-check every rendered ref* fact against the
 * table the producer read, keyed by facts.refKey. Same shape as
 * checkSyncWindowRefConsistency.
 */
/**
 * 17th hardFailure class (GH #78, 2026-09-12): `kick-priority-missed` /
 * `kick-priority-team` lines quote the one corpus cell of
 * data/kickPriorityPrior.ts; re-check the four rendered ref* facts.
 */
/**
 * kick-eaten `postKick=waited out the lockout (first cast Xs later)` must not
 * contradict its own `lockout` fact: X ≥ lockout (reliability audit A1,
 * 2026-09-24). The producer used to print "waited out" for every same-school
 * (or unknown-school) first cast, so e9ea8a0c @363 read "waited out the
 * lockout (first cast 1.3s later)" against `lockout=2.0`. The producer now
 * says "waited out" only when the first successful cast came at or after the
 * lockout end and nothing was pressed inside it; both numbers render with one
 * decimal and rounding is monotone, so a line the producer may print always
 * passes here.
 */
// A "; outside the locked school …" own-cooldown suffix may follow (2026-09-26).
const KICK_WAITED_OUT =
  /^waited out the lockout \(first cast ([\d.]+)s later\)(?:;|$)/;
export function checkKickWaitedOutConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("type=kick-eaten ")) continue;
    const m = line.match(MENU_LINE_FACTS);
    if (!m) continue;
    const f = parseFactsBlock(m[1]!);
    const w = (f["postKick"] ?? "").match(KICK_WAITED_OUT);
    if (!w) continue;
    const first = Number(w[1]);
    const lockout = Number(f["lockout"]);
    if (!(first >= lockout))
      failures.push(
        `line ${i + 1}: kick-eaten 说「等满锁定」但首次施法 ${w[1]}s < lockout ${f["lockout"] ?? "(缺)"}s`,
      );
  }
  return failures;
}

/**
 * Hard invariant (re-eval 2026-10-08 I05, user ruling 2026-10-11): a
 * cd-hoarded row says the player "had a usable cooldown ready and spent none"
 * only when they could press one for `REACTION_WINDOW_S` of the span its own
 * `ownerFreeS` fact counts — from `facts.t` to the end of the response window
 * (`ownerFreeSpan`, the owner gate's span). Until then the gate also counted
 * the 1.5 s BEFORE `t`, and 22 of the 644 rows that print the fact on the 605
 * capture stated less than 1 s (6 of them `ownerFreeS=0.0`) under a legend
 * that says "coach only that free part". Held on the rendered row, with the
 * producer's own constants:
 *  - `ownerFreeS` ≥ `REACTION_WINDOW_S`;
 *  - `ownerFreeS` ≤ the window the row states — `windowS` when present (the
 *    owner's death or the round end cut it), else `CD_HOARD_RESPONSE_S`;
 *  - `ownerCc` and `ownerFreeS` come together (the legend reads one by the
 *    other).
 * All three numbers print with one decimal and rounding is monotone, so a row
 * the producer may print always passes. A row with neither fact (nothing
 * blocked the owner) is not this gate's.
 */
export function checkCdHoardedOwnerFree(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("type=cd-hoarded ")) continue;
    const m = line.match(MENU_LINE_FACTS);
    if (!m) continue;
    const f = parseFactsBlock(m[1]!);
    const free = f["ownerFreeS"];
    if (free === undefined && f["ownerCc"] === undefined) continue;
    if (free === undefined || f["ownerCc"] === undefined) {
      failures.push(
        `line ${i + 1}: cd-hoarded prints ${free === undefined ? "ownerCc without ownerFreeS" : "ownerFreeS without ownerCc"}`,
      );
      continue;
    }
    const freeS = Number(free);
    const windowS =
      f["windowS"] === undefined ? CD_HOARD_RESPONSE_S : Number(f["windowS"]);
    if (!(freeS >= REACTION_WINDOW_S))
      failures.push(
        `line ${i + 1}: cd-hoarded ownerFreeS=${free} is under the ${REACTION_WINDOW_S} s the owner gate needs after facts.t — the row accuses a player who could not press`,
      );
    else if (!(freeS <= windowS))
      failures.push(
        `line ${i + 1}: cd-hoarded ownerFreeS=${free} is more than the ${f["windowS"] ?? CD_HOARD_RESPONSE_S} s window the row states`,
      );
  }
  return failures;
}

/**
 * kick-eaten `postKick` lists refused presses in three kinds of clause, each
 * with its count and the presses (`Spell×n +a/+b s`, one offset per press):
 *   pressed Nx but rejected (…)                                   — "not ready"
 *   refused for another reason Nx — <reason> (…)                  — the log's own reason
 *   outside the locked school Nx not ready yet — its own … (…)    — a school the kick did not lock
 * Re-eval 2026-10-08, I01: a press the log gives another reason for (moving,
 * out of range, silenced, …) used to sit in the first list and read as
 * rejected by the lockout — 15 of the 103 presses the 60 prompts printed
 * there. Held here, on the rendered text:
 *  - a "refused for another reason" clause names one of the reasons the
 *    producer can word (`REFUSAL_WHY_WORDS` — the producer's own list), and
 *    no reason has two clauses on a line;
 *  - every clause's N is the number of presses it lists.
 * What the gate cannot see is the log's reason itself (the row does not
 * print it); `candidateFindings.test.ts` pins that half on the producer.
 */
const POST_KICK_PRESS_LIST = String.raw`\(((?:[^()]|\([^()]*\))*)\)`;
const POST_KICK_OTHER_REASON_CLAUSE = new RegExp(
  `${reEscape(POST_KICK_OTHER_REASON_HEAD)}(\\d+)x — (${REFUSAL_WHY_WORDS.map(reEscape).join("|")}) ${POST_KICK_PRESS_LIST}(?=; |$)`,
  "g",
);
const POST_KICK_COUNTED_CLAUSE = new RegExp(
  `(pressed|outside the locked school) (\\d+)x (?:but rejected|not ready yet — its own cooldown or the GCD) ${POST_KICK_PRESS_LIST}`,
  "g",
);
const pressesListed = (list: string) => (list.match(/\+\d+\.\d/g) ?? []).length;
export function checkKickEatenRefusedForAnotherReason(
  lines: string[],
): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("type=kick-eaten ")) continue;
    const m = line.match(MENU_LINE_FACTS);
    if (!m) continue;
    const postKick = parseFactsBlock(m[1]!)["postKick"] ?? "";
    const heads = postKick.split(POST_KICK_OTHER_REASON_HEAD).length - 1;
    const clauses = [...postKick.matchAll(POST_KICK_OTHER_REASON_CLAUSE)];
    if (clauses.length !== heads)
      failures.push(
        `line ${i + 1}: kick-eaten postKick has a "${POST_KICK_OTHER_REASON_HEAD.trim()}" clause that is not "Nx — <a reason the product words> (presses)"`,
      );
    const seen = new Set<string>();
    for (const c of clauses) {
      if (seen.has(c[2]!))
        failures.push(
          `line ${i + 1}: kick-eaten postKick states "${c[2]}" in two clauses`,
        );
      seen.add(c[2]!);
      if (Number(c[1]) !== pressesListed(c[3]!))
        failures.push(
          `line ${i + 1}: kick-eaten postKick says ${c[1]}x refused (${c[2]}) and lists ${pressesListed(c[3]!)} press(es)`,
        );
    }
    for (const c of postKick.matchAll(POST_KICK_COUNTED_CLAUSE))
      if (Number(c[2]) !== pressesListed(c[3]!))
        failures.push(
          `line ${i + 1}: kick-eaten postKick says "${c[1]} ${c[2]}x" and lists ${pressesListed(c[3]!)} press(es)`,
        );
  }
  return failures;
}

/**
 * kick-eaten `ourLowT` / `theirLowT` sit inside the lockout the row prints
 * (work order 2026-10-14b Part 2): the low is read from the second the kick
 * floors onto to the second its lockout's end floors onto. A tick up to 1 s
 * after the lock (`ceil` of the end) used to be read, and on the three
 * raw-checked rows it was the only reading at or below 40 (1bad0a5c,
 * 2c6e85ec, 3306e8ee).
 */
export function checkKickEatenLowInsideLockout(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("type=kick-eaten ")) continue;
    const m = line.match(MENU_LINE_FACTS);
    if (!m) continue;
    const f = parseFactsBlock(m[1]!);
    const t = Number(f["t"]);
    const lockout = Number(f["lockout"]);
    if (!Number.isFinite(t) || !Number.isFinite(lockout)) continue;
    // …and inside the round (codex 60-POSTHOC-09h #2: a low read after a
    // Solo Shuffle round's ending death passed, still inside the lockout)
    const roundEnd = statedRoundEnd(lines)?.second ?? Infinity;
    const last = Math.min(Math.floor(t + lockout + 1e-9), roundEnd);
    for (const side of ["our", "their"]) {
      const atRaw = f[`${side}LowT`];
      if (atRaw === undefined) continue;
      const at = Number(atRaw);
      if (at < Math.floor(t) || at > last)
        failures.push(
          `line ${i + 1}: kick-eaten ${side}LowT=${atRaw} is outside the lockout's seconds ${Math.floor(t)}–${last} (t=${f["t"]}, lockout=${f["lockout"]})`,
        );
    }
  }
  return failures;
}

/**
 * kick-eaten `kickSilence` (re-eval 2026-10-08, F21): an interrupt whose own
 * spell also silences — Shield of Virtue — put a `[SILENCE]` line of that
 * spell on the player at the kick, and the row printed its school lockout
 * alone (dfcccbf2 @166.5: `lockedSchool=Arcane` over five presses the log
 * refused "silenced"). Both directions, on the rendered text, the player and
 * the kick resolved through the `<unit>` legend and the spell's name:
 *  - a kick-eaten row whose player has a `[SILENCE] … ← <facts.kick>` line
 *    at the kick's second (or the next: the aura row follows the interrupt by
 *    a few ms) carries `kickSilence`;
 *  - a row with `kickSilence` has such a line, and the line prints that
 *    duration — unless a trinket broke the silence, where the line prints the
 *    time to the press.
 * Both read `silenceIntervals` and `renderedCcDuration`.
 */
const SILENCE_AT_LINE =
  /^\s*(\d+):(\d{2})\s+\[SILENCE\]\s+(\d+)\([^)]*\) ← (.+?) \((?:by |reflected back\))(.*)$/;
export function checkKickEatenKickSilence(lines: string[]): string[] {
  const idOfName = new Map<string, string>();
  const silences: Array<{
    at: number;
    unitId: string;
    spell: string;
    rest: string;
  }> = [];
  for (const line of lines) {
    const u = line.match(UNIT_LEGEND_LINE);
    if (u) idOfName.set(u[2]!, u[1]!);
    const sl = line.match(SILENCE_AT_LINE);
    // a silence the log wrote no aura for (`| no aura logged — …`, fact1215
    // R11: Solar Beam, also a kick) has no length for `kickSilence` to state
    if (sl && !line.includes("| no aura logged — "))
      silences.push({
        at: Number(sl[1]) * 60 + Number(sl[2]),
        unitId: sl[3]!,
        spell: sl[4]!,
        rest: sl[5]!,
      });
  }
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("type=kick-eaten ")) continue;
    const m = line.match(MENU_LINE_FACTS);
    const units = line.match(/ units=([^/]+)\//);
    if (!m || !units) continue;
    const f = parseFactsBlock(m[1]!);
    const ownerId = idOfName.get(units[1]!);
    const kickS = Math.floor(Number(f["t"]));
    const own = silences.filter(
      (sl) =>
        sl.unitId === ownerId &&
        sl.spell === f["kick"] &&
        (sl.at === kickS || sl.at === kickS + 1),
    );
    const stated = f["kickSilence"];
    if (stated === undefined) {
      if (own.length > 0)
        failures.push(
          `line ${i + 1}: kick-eaten kick=${f["kick"]} also silenced the player ([SILENCE] at ${fmtTime(own[0]!.at)}) and the row has no kickSilence`,
        );
      continue;
    }
    // without the timeline (a menu-only text) there is nothing to hold it to
    if (ownerId === undefined) continue;
    if (own.length === 0) {
      failures.push(
        `line ${i + 1}: kick-eaten kickSilence=${stated} has no [SILENCE] line of ${f["kick"]} on the player at ${fmtTime(kickS)}`,
      );
      continue;
    }
    if (
      !own.some(
        (sl) =>
          sl.rest.includes("trinket broke this silence") ||
          // `renderedCcSpan`: `| 2s`, or `| still on them when the round
          // ended, 2s in` for a silence the round's end cut (codex post-hoc
          // review U1: the round-end form failed as a mismatch)
          new RegExp(
            `\\| (?:${reEscape(CC_STILL_ON_AT_ROUND_END)}, )?${reEscape(stated)}(?: in)?(?: \\||$)`,
          ).test(sl.rest),
      )
    )
      failures.push(
        `line ${i + 1}: kick-eaten kickSilence=${stated} is not the duration its [SILENCE] line prints (${own[0]!.rest.trim().slice(0, 60)})`,
      );
  }
  return failures;
}

/**
 * kick-eaten range and distance facts (re-eval 2026-10-08, F07), each line
 * re-read from its own rendered numbers:
 *  - no table placeholder as a range: `kickRangeYd` / `yourReachYd` /
 *    `maxKickRangeYd` below `PLACEHOLDER_RANGE_YD` (dfcccbf2 @166.5 printed
 *    `kickRangeYd=50000`, DB2's "anywhere" row for Shield of Virtue);
 *  - a distance is `N.N`, or `~N (position samples N.Ns apart)` with a
 *    spacing of `INTERP_MAX_GAP_MS` or more as printed (`distanceFact`, the
 *    producer's own writer and bound) — nothing else;
 *  - `kickLandedFromYd` is printed only beyond the printed `kickRangeYd`;
 *  - `outRangeable=yes` is a permission and rests on a measured distance:
 *    `sourceDistYd` is not approximate, lies beyond `kickRangeYd` by more
 *    than `RANGE_HITBOX_SLACK_YD` (less the half yard `kickRangeYd` is
 *    rounded by) and beyond `kickLandedFromYd` when the kick landed from
 *    farther than its range.
 */
const KICK_RANGE_FACT_KEYS = ["kickRangeYd", "yourReachYd", "maxKickRangeYd"];
const KICK_DISTANCE_FACT_KEYS = ["sourceDistYd", "nearestKickerDistYd"];
const APPROX_DISTANCE_FACT = /^~(\d+) \(position samples (\d+\.\d)s apart\)$/;
export function checkKickEatenRangeFacts(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("type=kick-eaten ")) continue;
    const m = line.match(MENU_LINE_FACTS);
    if (!m) continue;
    const f = parseFactsBlock(m[1]!);
    const fail = (msg: string) =>
      failures.push(`line ${i + 1}: kick-eaten ${msg}`);
    for (const key of KICK_RANGE_FACT_KEYS) {
      const v = f[key];
      if (v !== undefined && !(Number(v) < PLACEHOLDER_RANGE_YD))
        fail(
          `${key}=${v} is not a range (a table placeholder is ${PLACEHOLDER_RANGE_YD} yd or more)`,
        );
    }
    for (const key of KICK_DISTANCE_FACT_KEYS) {
      const v = f[key];
      if (v === undefined || /^\d+\.\d$/.test(v)) continue;
      const approx = v.match(APPROX_DISTANCE_FACT);
      if (!approx)
        fail(`${key}=${v} is neither N.N nor an approximate distance`);
      else if (
        v !== distanceFact(Number(approx[1]), Number(approx[2])) ||
        // one decimal: a spacing just above the bound prints as the bound
        !(Number(approx[2]) * 1000 >= INTERP_MAX_GAP_MS)
      )
        fail(
          `${key}=${v} is marked approximate with samples less than ${INTERP_MAX_GAP_MS} ms apart`,
        );
    }
    const range = f["kickRangeYd"];
    const landed = f["kickLandedFromYd"];
    if (
      landed !== undefined &&
      !(range !== undefined && Number(landed) > Number(range))
    )
      fail(
        `kickLandedFromYd=${landed} is printed without a kickRangeYd below it (${range ?? "absent"})`,
      );
    if (!(f["outRangeable"] ?? "").startsWith("yes")) continue;
    const dist = f["sourceDistYd"] ?? "";
    if (!/^\d+\.\d$/.test(dist) || range === undefined) {
      fail(
        `outRangeable=yes without a measured sourceDistYd and a kickRangeYd (sourceDistYd=${dist || "absent"})`,
      );
      continue;
    }
    if (!(Number(dist) > Number(range) + RANGE_HITBOX_SLACK_YD - 0.5))
      fail(
        `outRangeable=yes with the kicker ${dist} yd away from a ${range} yd kick`,
      );
    if (landed !== undefined && !(Number(dist) > Number(landed)))
      fail(
        `outRangeable=yes with the kicker ${dist} yd away at cast start and the kick landing from ${landed} yd`,
      );
  }
  return failures;
}

/**
 * A candidate legend that names ANOTHER candidate type sends the reader to
 * that type's legend ("as in kick-priority-missed") — and a legend is printed
 * only when its type has a row in the menu. b711d4ac (re-eval 2026-10-08,
 * I06): a `kick-priority-team` row with no `kick-priority-missed` row cited
 * the absent legend three times. The legends are self-contained now; this
 * holds them to it: a legend line that names another registered candidate
 * type has that type's legend in the same prompt.
 *
 * Type names come from `CANDIDATE_TYPE_REGISTRY` (the one list of types).
 * Only hyphenated names are read: `death` is an English word every legend
 * uses.
 */
const CANDIDATE_LEGEND_LINE = /^- "([a-z][a-z0-9-]*)": /;
const LEGEND_REFERENCE_TYPES: readonly string[] = Object.keys(
  CANDIDATE_TYPE_REGISTRY,
).filter((t) => t.includes("-"));
export function checkLegendCrossReferences(lines: string[]): string[] {
  const legendAt = new Map<string, number>();
  lines.forEach((line, i) => {
    const m = CANDIDATE_LEGEND_LINE.exec(line);
    if (m) legendAt.set(m[1]!, i);
  });
  const failures: string[] = [];
  for (const [type, i] of legendAt) {
    for (const other of LEGEND_REFERENCE_TYPES) {
      if (other === type || legendAt.has(other)) continue;
      if (
        new RegExp(`(?<![a-z0-9-])${reEscape(other)}(?![a-z0-9-])`).test(
          lines[i]!,
        )
      )
        failures.push(
          `line ${i + 1}: the "${type}" legend names "${other}", whose legend is not in this prompt`,
        );
    }
  }
  return failures;
}

/**
 * The number of findings a findings prompt asks for agrees with its own menu
 * (L07, user ruling 2026-10-11). The prompt opened "Produce 4-8 coaching
 * findings" whatever followed, and 1,861 of the 2,677 non-empty menus on the
 * 605 capture hold one to three events; the stored replies to it carry 34
 * surplus findings in 195.
 *
 * Both sides are the builder's own: the menu is read back from the rendered
 * rows by `menuEventIdsOfPrompt`, counted by `citableEventCount` (distinct ids
 * — what `auditFindings` can resolve), and the first line must be
 * `findingsPromptHead` of that count. So a prompt that states a count its menu
 * cannot carry fails, and so does one that states the right count in other
 * words than the builder's.
 *
 * The bare match context (the default corpus prompt) has no menu block and is
 * not held.
 */
const FINDINGS_HEAD =
  /^You are a World of Warcraft arena coach reviewing a (.+?)'s match\. /;
export function checkFindingsCountFollowsMenu(lines: string[]): string[] {
  const ids = menuEventIdsOfPrompt(lines);
  if (ids === null) return [];
  const n = citableEventCount(ids.map((id) => ({ id })));
  const head = lines[0] ?? "";
  const spec = FINDINGS_HEAD.exec(head)?.[1];
  if (spec === undefined)
    return [
      `line 1: a findings prompt (it has an event menu of ${n}) does not open with the coach sentence`,
    ];
  if (head === findingsPromptHead(spec, n)) return [];
  const asked =
    /Produce (.+? coaching findings?) as JSON/.exec(head)?.[1] ??
    "no count the builder writes";
  return [
    `line 1: asks for "${asked}" while its menu holds ${n} event${n === 1 ? "" : "s"} (${ids.length} row${ids.length === 1 ? "" : "s"}) — not the instruction findingsCountInstruction(${n}) writes`,
  ];
}

/**
 * A roster unit named as the owner of something — `5(BMHunter)'s pet`,
 * `2(FMage)'s Pyroblast` — carries its spec tag, like every other reference
 * to it (`unitLabel.ts` `rosterLabelByName`, the one builder of the tag).
 *
 * FT leftovers 2026-10-11: the id maps answer to a character name with and
 * without its realm, the tag answered to the full name only, so a name that
 * reached the label in its short form printed a bare `5` — and on those
 * lines the unit was a pet read as its owner (`[CC BROKEN] 2's Kill Command`,
 * `broken by 5's Bestial Wrath`): 433 lines of the 3,520-prompt capture of
 * main 8c3275fa.
 *
 * Not held: the damage rows (`Top sources` / `killing blow` / `killed by`),
 * which print `N — Spell` and `N's pet — Spell` without tags throughout.
 */
const ROSTER_UNIT_SPEC = /<unit\s+id="(\d+)"[^>]*\sspec="([^"]+)"/;
const BARE_ID_POSSESSIVE = new RegExp(
  String.raw`(?<![\w)%.:])(\d{1,2})'s (?!${SUMMON_KIND_RE_SRC} —)`,
  "g",
);
export function checkBareRosterPossessive(lines: string[]): string[] {
  const tagged = new Set<string>();
  for (const line of lines) {
    const m = ROSTER_UNIT_SPEC.exec(line);
    if (m && m[2]!.trim()) tagged.add(m[1]!);
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(BARE_ID_POSSESSIVE))
      if (tagged.has(m[1]!))
        failures.push(
          `line ${i + 1}: roster id ${m[1]} named without its spec tag — ${line.trim().slice(0, 140)}`,
        );
  });
  return failures;
}

/**
 * A STAYED IN line's "you moved N yd" calls the yards the owner's own only
 * when no forced move lies between the span's two ends
 * (`forcedDisplacement.ts` `forcedMovesInRenderedSpan` — the reading the
 * `[GRIP]` line shares).
 *
 * FT leftovers 2026-10-11 (the I13 fact half): `you moved 29.2 yd yourself
 * (span start→end)` with a landed Death Grip on the owner inside the span —
 * 10 lines in 9 of the 3,520 capture prompts of main 8c3275fa. From text only
 * the grip can be held (a knockback has no line of its own):
 *  - a landed `[GRIP]` on the log owner at a second in [start, end) → the
 *    line does not say `yourself` after the yards, and names that grip;
 *  - a grip the line names has its `[GRIP]` line, landed, at that second;
 *  - every forced move the line names lies in [start, end).
 */
const STAYED_MOVED_LINE =
  /^\s+(\d+):(\d\d)–(\d+):(\d\d) \[[^\]]* burst\] .* — you moved [\d.]+ yd( yourself)? \(span start→end\)(?:, not all of it yourself: (.*?))?(?: — |$)/;
const OWNER_ROSTER_ID = /<unit\s+id="(\d+)"[^>]*role="log owner"/;
const GRIP_LINE = /^(\d+):(\d\d)\s+\[GRIP\]\s+(\d+)[( ]/;
const FORCED_MOVE_ITEM = new RegExp(
  `(${Object.values(FORCED_MOVE_TEXT).map(reEscape).join("|")}) at (\\d+):(\\d\\d)`,
  "g",
);
export function checkStayedInForcedMove(lines: string[]): string[] {
  let ownerId: string | undefined;
  for (const line of lines) {
    const m = OWNER_ROSTER_ID.exec(line);
    if (m) ownerId = m[1];
  }
  const grips = new Set<number>();
  for (const line of lines) {
    const m = GRIP_LINE.exec(line);
    if (m && m[3] === ownerId && !line.includes("did not land"))
      grips.add(Number(m[1]) * 60 + Number(m[2]));
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = STAYED_MOVED_LINE.exec(line);
    if (!m) return;
    const from = Number(m[1]) * 60 + Number(m[2]);
    const to = Number(m[3]) * 60 + Number(m[4]);
    const at = `line ${i + 1}`;
    const named = [...(m[6] ?? "").matchAll(FORCED_MOVE_ITEM)].map((x) => ({
      grip: x[1] === FORCED_MOVE_TEXT.grip,
      s: Number(x[2]) * 60 + Number(x[3]),
    }));
    if (!m[5] && named.length === 0)
      failures.push(
        `${at}: the yards are not called the owner's own, and no forced move is named`,
      );
    for (const n of named) {
      if (n.s < from || n.s >= to)
        failures.push(
          `${at}: a forced move at ${fmtTime(n.s)} is outside the span's two ends`,
        );
      if (n.grip && !grips.has(n.s))
        failures.push(
          `${at}: Death Grip at ${fmtTime(n.s)} has no landed [GRIP] line on the owner`,
        );
    }
    for (const g of grips)
      if (g >= from && g < to && !named.some((n) => n.grip && n.s === g))
        failures.push(
          `${at}: a landed [GRIP] on the owner at ${fmtTime(g)} is inside the span and the line ${m[5] ? 'says "yourself"' : "does not name it"}`,
        );
  });
  return failures;
}

export function checkKickPriorityRefConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (
      !line.includes("type=kick-priority-missed ") &&
      !line.includes("type=kick-priority-team ")
    )
      continue;
    const m = line.match(/facts=\{(.*)\}\s*$/);
    if (!m) {
      failures.push(`line ${i + 1}: kick-priority 行无 facts`);
      continue;
    }
    const f = parseFactsBlock(m[1]!);
    const ref = lookupKickPriorityPrior();
    if (!ref) {
      failures.push(
        `line ${i + 1}: kick-priority 出面但参照表为空/不够样本 —— 生产者本不该发`,
      );
      continue;
    }
    const expect: Record<string, string> = {
      refNCompleted: String(ref.nCompleted),
      refNInterrupted: String(ref.nInterrupted),
      refDeathCompleted: String(ref.deathCompletedPct),
      refDeathInterrupted: String(ref.deathInterruptedPct),
    };
    for (const [key, want] of Object.entries(expect))
      if (f[key] !== want)
        failures.push(
          `line ${i + 1}: kick-priority ${key}=${f[key] ?? "(缺)"} ≠ 表值 ${want}`,
        );
  }
  return failures;
}

export function checkBacklashRefConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isDispel = line.includes("type=backlash-dispel ");
    const isWindow = line.includes("type=backlash-dispel-window ");
    if (!isDispel && !isWindow) continue;
    const m = line.match(/facts=\{(.*)\}\s*$/);
    if (!m) {
      failures.push(`line ${i + 1}: backlash-dispel 行无 facts`);
      continue;
    }
    const f = parseFactsBlock(m[1]!);
    const refKey = f.refKey ?? "";
    if (!refKey) {
      failures.push(
        `line ${i + 1}: backlash-dispel 缺 refKey,无法核对语料参照`,
      );
      continue;
    }
    let expect: Record<string, string>;
    const windowKind = refKey.endsWith(":worth")
      ? "worth"
      : refKey.endsWith(":immune")
        ? "immune"
        : null;
    if (windowKind) {
      const ref = lookupBacklashWorth(
        refKey.slice(0, -(windowKind.length + 1)),
        windowKind,
      );
      if (!ref) {
        failures.push(
          `line ${i + 1}: backlash-dispel-window 引用了表里查不到/不够样本的单元格 ${refKey}`,
        );
        continue;
      }
      expect = {
        refND: String(ref.nD),
        refNL: String(ref.nL),
        refDeathDispelled: String(ref.deathDPct),
        refDeathLeft: String(ref.deathLPct),
        refNetK: String(ref.netK),
      };
    } else {
      const ref = lookupBacklashPrior(refKey);
      if (!ref) {
        failures.push(
          `line ${i + 1}: backlash-dispel 引用了表里查不到/不够样本的单元格 ${refKey}`,
        );
        continue;
      }
      expect = isDispel
        ? {
            refN: String(ref.n),
            refRemovedK: String(ref.removedK),
            refHealLostK: String(ref.healLostK),
            refBacklashDmgK: String(ref.backlashDmgK),
            refCcExposureS: fmtFactNum(ref.ccExposureS),
            backlash: `${ref.backlashKind} ${ref.backlashS}s`,
          }
        : {
            refN: String(ref.n),
            refRemovedK: String(ref.removedK),
            refCcExposureS: fmtFactNum(ref.ccExposureS),
            backlash: `${ref.backlashKind} ${ref.backlashS}s`,
          };
    }
    for (const [key, want] of Object.entries(expect)) {
      if (f[key] !== want)
        failures.push(
          `line ${i + 1}: backlash-dispel ${key}=${f[key] ?? "(缺)"} ≠ 表值 ${want}(${refKey})`,
        );
    }
  }
  return failures;
}

/** `0:47  [CC ON ENEMY]   4(HPaladin) ← Kidney Shot (by …` — the second,
 *  the unit's `<unit>` id, the control and the rest of the line. The source
 *  label nests parentheses (`(by 3(ORogue))`), so the length is searched for
 *  in the tail, not anchored. */
const CC_ON_ENEMY_AT_LINE =
  /^\s*(\d+):(\d{2})\s+\[CC ON ENEMY\]\s+(\d+)\([^)]*\) ← (.+?) \((?:by |reflected back)(.*)$/;
/** … its length: `) (4s)`, the round-end cut `) (still on them when the
 *  round ended, 4s in)`, or the Tremor form. */
const CC_ON_ENEMY_TAIL_SECONDS = new RegExp(
  String.raw`\) \((${CC_STILL_ON_AT_ROUND_END}, )?(<1|\d+)s(?: in)?\)|ended this CC after (<1|\d+)s `,
);

/**
 * Hard invariant (F06a): a missed-sync-window row states its lock's length
 * as the timeline does.
 *
 *  1. A ONE-control lock (`cc=` names no chain: no `→`, no `×N`) whose
 *     `[CC ON ENEMY]` line the timeline prints — at the row's `t`, on the
 *     row's healer (through the `<unit>` legend), with that control — reads
 *     `durationS` = the seconds that line prints (`<1` = `<1s`). Both come
 *     out of `renderedCcDuration`; the row's value is
 *     `syncLockLengthFacts`. And a line cut at the round's end
 *     (`CC_STILL_ON_AT_ROUND_END`) pairs with `endedBy` =
 *     `SYNC_LOCK_ENDED_BY_ROUND_END`, and only such a line does.
 *     A row with no such line is not judged: an owner control can sit on its
 *     `[YOU] [CC]` cast line alone, an area control in a fold.
 *  2. No row's `windowEndT` is after the round's end as the prompt states it
 *     (`statedRoundEnd`), chain or not.
 *
 * Before (605-file capture of 8c3275fa, fix-FT/scripts/
 * n4_sync_duration_pairs.py; `durationS` was `windowEndT − t`): 473
 * one-control rows paired with a line, 51 off it — 32 by one second either
 * way (the floored endpoints against the rounded length), 19 where the round
 * ended on the control (16 of them 1–6 s off: `durationS=5` for a Kidney
 * Shot the round ended 1 s into).
 */
export function checkSyncWindowLockLength(lines: string[]): string[] {
  const failures: string[] = [];
  const idOfName = new Map<string, string>();
  const ccLines: Array<{
    at: number;
    unitId: string;
    spell: string;
    seconds: string;
    cut: boolean;
  }> = [];
  for (const line of lines) {
    const u = line.match(UNIT_ROSTER_LINE);
    if (u) idOfName.set(u[2]!, u[1]!);
    const c = line.match(CC_ON_ENEMY_AT_LINE);
    if (!c) continue;
    const tail = c[5]!.match(CC_ON_ENEMY_TAIL_SECONDS);
    if (!tail) continue;
    ccLines.push({
      at: Number(c[1]) * 60 + Number(c[2]),
      unitId: c[3]!,
      spell: c[4]!,
      seconds: (tail[2] ?? tail[3])!,
      cut: tail[1] !== undefined,
    });
  }
  const end = statedRoundEnd(lines);
  lines.forEach((line, i) => {
    if (!line.includes("type=missed-sync-window ")) return;
    const m = line.match(/facts=\{(.*)\}\s*$/);
    if (!m) return; // `checkSyncWindowRefConsistency` reports it
    const f = parseFactsBlock(m[1]!);
    const fail = (why: string) =>
      failures.push(
        `line ${i + 1}: missed-sync-window ${why} —— t=${f.t} windowEndT=${f.windowEndT} durationS=${f.durationS} cc=${f.cc}${f.endedBy ? ` endedBy=${f.endedBy}` : ""}`,
      );
    const t = Number(f.t);
    const windowEndT = Number(f.windowEndT);
    if (end !== null && Number.isFinite(windowEndT) && windowEndT > end.second)
      fail(
        `的 windowEndT 在回合结束之后(${end.says}在 ${fmtTime(end.second)})`,
      );
    const cc = f.cc ?? "";
    if (!cc || cc.includes("→") || / ×\d+$/.test(cc)) return;
    const unitId = idOfName.get(f.healer ?? "");
    if (unitId === undefined) return;
    const paired = ccLines.filter(
      (c) => c.at === t && c.unitId === unitId && c.spell === cc,
    );
    if (paired.length !== 1) return; // none, or two in one second: not judged
    const cl = paired[0]!;
    if (f.durationS !== cl.seconds)
      fail(
        `的 durationS=${f.durationS ?? "(缺)"} 与同秒 [CC ON ENEMY] 行印的 ${cl.seconds}s 不一致`,
      );
    const rowCut = f.endedBy === SYNC_LOCK_ENDED_BY_ROUND_END;
    if (rowCut !== cl.cut)
      fail(
        cl.cut
          ? `的 [CC ON ENEMY] 行写「${CC_STILL_ON_AT_ROUND_END}」,该行却没有 endedBy=${SYNC_LOCK_ENDED_BY_ROUND_END}`
          : `写 endedBy=${SYNC_LOCK_ENDED_BY_ROUND_END},[CC ON ENEMY] 行却没有被回合结束截断`,
      );
  });
  return failures;
}

/** missed-sync-window (GH #13 resurrection, 2026-09-02): every rendered line
 * must quote exactly the bracket cell syncWindowPrior.ts holds, and the
 * quoted contrast must clear the same min-contrast door the producer used —
 * a line citing numbers that argue against its own accusation is a
 * hardFailure, not a style problem. */
export function checkSyncWindowRefConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("type=missed-sync-window ")) continue;
    const m = line.match(/facts=\{(.*)\}\s*$/);
    if (!m) {
      failures.push(`line ${i + 1}: missed-sync-window 行无 facts`);
      continue;
    }
    const f = parseFactsBlock(m[1]!);
    const cellKey = f.cellKey ?? "";
    if (!cellKey) {
      failures.push(
        `line ${i + 1}: missed-sync-window 缺 cellKey,无法核对语料参照`,
      );
      continue;
    }
    const ref = lookupSyncWindowPrior(cellKey);
    if (!ref) {
      failures.push(
        `line ${i + 1}: missed-sync-window 引用了表里查不到/不够样本的单元格 ${cellKey}`,
      );
      continue;
    }
    const expect: Record<string, string> = {
      cellKey: ref.cellKey,
      refN: String(ref.nEntered + ref.nUnentered),
      refKillEntered: String(ref.killEnteredPct),
      refKillUnentered: String(ref.killUnenteredPct),
    };
    for (const [k, v] of Object.entries(expect))
      if (f[k] !== v)
        failures.push(
          `line ${i + 1}: missed-sync-window ${k}=${f[k]} 与参照表 ${v} 不一致(${ref.cellKey})`,
        );
    const rendered = {
      killEnteredPct: Number(f.refKillEntered),
      killUnenteredPct: Number(f.refKillUnentered),
    };
    if (
      !Number.isFinite(rendered.killEnteredPct) ||
      !Number.isFinite(rendered.killUnenteredPct)
    ) {
      failures.push(
        `line ${i + 1}: missed-sync-window 的 refKillEntered/refKillUnentered 不是数字,无法核对最小对比度门槛`,
      );
    } else if (!syncRefClearsMinContrast(rendered)) {
      failures.push(
        `line ${i + 1}: missed-sync-window 引用的对比度只有 ${syncRefContrastPp(rendered)} pp(${f.refKillEntered}% vs ${f.refKillUnentered}%),低于门槛 ${SYNC_REF_MIN_CONTRAST_PP} pp —— 被引用的数字在反驳这条指控(${ref.cellKey})`,
      );
    }
  }
  return failures;
}

const CD_WASTE_ROW = /\bid=cd-waste:([^:\s]+):(\d+) type=cd-waste /;

/**
 * Hard invariant (X1, user ruling 2026-10-11): one cd-waste row per
 * cooldown, not per button.
 *
 *  1. No menu carries two cd-waste rows of one unit whose spells draw on
 *     one DB2 charge pool — the producer's own relation (`sharesChargePool`,
 *     what readiness reads) asked of the spell ids the rows' ids carry.
 *  2. A row whose `spell` ends `CD_WASTE_SHARED_COOLDOWN_NOTE` names two or
 *     more buttons (`cdWasteSpellNames`, the producer's fact read back), and
 *     with a loadout in the text each of them is an entry of that unit's
 *     `<cooldowns>` kit marked `[UNUSED` — "never spent" on both sides is
 *     the ledger's `cdNeverSpent`.
 *
 * Before (605-file capture of ebb689de, fix-FT/scripts/
 * ms_shared_cd_text.py): 40 menus carried a `Blessing of Protection` and a
 * `Blessing of Spellwarding` row of one unit (ChargeCategory 1392); no other
 * pool had two rows.
 */
export function checkCdWasteSharedCooldown(lines: string[]): string[] {
  const failures: string[] = [];
  const units = unitKitsOf(lines);
  const rows: Array<{ line: number; unit: string; spellId: string }> = [];
  lines.forEach((line, i) => {
    const row = line.match(CD_WASTE_ROW);
    if (!row) return;
    const prior = rows.find(
      (r) => r.unit === row[1] && sharesChargePool(r.spellId, row[2]!),
    );
    if (prior)
      failures.push(
        `line ${i + 1}: cd-waste 行的技能 ${row[2]} 与第 ${prior.line + 1} 行的 ${prior.spellId} 是同一个冷却(同一个充能池),同一单位 ${row[1]} 却各出一行`,
      );
    rows.push({ line: i, unit: row[1]!, spellId: row[2]! });
    const m = line.match(/facts=\{(.*)\}\s*$/);
    if (!m) return;
    const f = parseFactsBlock(m[1]!);
    const spell = cdWasteSpellNames(f.spell ?? "");
    if (!spell.shared) return;
    const fail = (why: string) =>
      failures.push(
        `line ${i + 1}: cd-waste 写「${CD_WASTE_SHARED_COOLDOWN_NOTE}」${why} —— spell=${f.spell}`,
      );
    if (new Set(spell.names).size < 2) fail(",却只列了一个技能");
    const kit = units.find((u) => u.name === f.unit)?.kit;
    if (!kit) return;
    for (const name of spell.names) {
      const entry = kit.get(name.replace(/\u00a0/g, " "));
      if (entry === undefined)
        fail(`,其中 ${name} 不在 ${f.unit} 的 <cooldowns> 里`);
      else if (!entry.includes("[UNUSED"))
        fail(`,其中 ${name} 在 <cooldowns> 里不是 [UNUSED]`);
    }
  });
  return failures;
}

/**
 * Hard invariant (L04, user ruling 2026-10-11): a missed-sync-window row
 * says whose each ready cooldown is, and the loadout agrees.
 *
 *  1. Every `readyCds` entry carries a holder — `X (yours)` or
 *     `X (Name-Realm's)`, the producer's `syncReadyCdEntry` read back with
 *     its own `parseSyncReadyCdEntry`.
 *  2. With a loadout in the prompt: an entry marked `yours` is an entry of
 *     the log owner's `<cooldowns>` kit, with a button (not `[PASSIVE]`);
 *     an entry marked as a unit's names a `teammate` of the loadout — never
 *     the log owner by name, whose cooldowns read `yours` — and is an entry
 *     of that teammate's kit. Row and kit both come from the unit's
 *     `extractMajorCooldowns` ledger (`spellName`), so a holder the kit
 *     contradicts is the wrong holder.
 *
 * Before (605-file capture of ebb689de, fix-FT/scripts/
 * ms_sync_holder_text.py): 726 rows, none stating a holder; by the kits, 211
 * name only the owner's cooldowns, 74 some, 441 none.
 */
export function checkSyncWindowReadyCdHolders(lines: string[]): string[] {
  const failures: string[] = [];
  const units = unitKitsOf(lines);
  const owner = units.filter((u) => u.role === "log owner").at(-1);
  const inKit = (kit: Map<string, string>, spell: string) =>
    // the facts serializer turns a spell name's ", " into ",\u00a0"
    kit.get(spell.replace(/\u00a0/g, " "));
  lines.forEach((line, i) => {
    if (!line.includes("type=missed-sync-window ")) return;
    const m = line.match(/facts=\{(.*)\}\s*$/);
    if (!m) return; // `checkSyncWindowRefConsistency` reports it
    const f = parseFactsBlock(m[1]!);
    const fail = (why: string) =>
      failures.push(
        `line ${i + 1}: missed-sync-window ${why} —— t=${f.t} readyCds=${f.readyCds ?? "(缺)"}`,
      );
    if (!f.readyCds) {
      fail("没有 readyCds");
      return;
    }
    for (const entry of f.readyCds.split("、")) {
      const e = parseSyncReadyCdEntry(entry);
      if (!e.yours && e.holder === null) {
        fail(
          `的「${entry}」没写是谁的冷却(应为 (${SYNC_READY_CD_YOURS}) 或 (Name's))`,
        );
        continue;
      }
      if (units.length === 0) continue;
      if (e.yours) {
        if (!owner?.kit) continue;
        const kitEntry = inKit(owner.kit, e.spell);
        if (kitEntry === undefined)
          fail(`写 ${e.spell} 是录制者的,录制者的 <cooldowns> 里没有它`);
        else if (kitEntry.includes("[PASSIVE"))
          fail(`写 ${e.spell} 是录制者的,它在 <cooldowns> 里是 [PASSIVE]`);
        continue;
      }
      const holder = units.find((u) => u.name === e.holder);
      if (!holder) fail(`的「${entry}」的持有者不在技能栏的单位里`);
      else if (holder.role === "log owner")
        fail(
          `的「${entry}」按名字写了录制者(自己的冷却应写 (${SYNC_READY_CD_YOURS}))`,
        );
      else if (holder.role !== "teammate")
        fail(`的「${entry}」的持有者是 ${holder.role},不是队友`);
      else if (holder.kit && inKit(holder.kit, e.spell) === undefined)
        fail(`写 ${e.spell} 是 ${holder.name} 的,其 <cooldowns> 里没有它`);
    }
  });
  return failures;
}

/**
 * Hard invariant (L04 (c), user ruling 2026-10-11): a Solo Shuffle menu has
 * no missed-sync-window row nothing of which is the log owner's — every row
 * there names a ready cooldown as `(yours)` or carries `setupBy`. The
 * producer's two predicates on the rendered row: `syncRowNarrowedToOwnerPart`
 * (the bracket — the header's `Bracket:` when the text has one, else the
 * row's `cellKey`, which is the bracket the reference was looked up with)
 * and `syncRowHasOwnerPart`. 2v2 / 3v3 rows are not judged.
 *
 * Before (605-file capture of ebb689de, fix-FT/scripts/
 * ms_sync_holder_text.py, holders read off the loadout kits): 211 of the 549
 * Solo Shuffle rows, in 202 menus, had neither (61 of the 177 3v3 rows do,
 * and stay).
 */
export function checkSyncWindowOwnerPart(lines: string[]): string[] {
  const failures: string[] = [];
  const headerBracket = lines
    .map((l) => l.match(BRACKET_HEADER)?.[1])
    .find((b) => b !== undefined);
  lines.forEach((line, i) => {
    if (!line.includes("type=missed-sync-window ")) return;
    const m = line.match(/facts=\{(.*)\}\s*$/);
    if (!m) return; // `checkSyncWindowRefConsistency` reports it
    const f = parseFactsBlock(m[1]!);
    if (!syncRowNarrowedToOwnerPart(headerBracket ?? f.cellKey)) return;
    if (!syncRowHasOwnerPart(f))
      failures.push(
        `line ${i + 1}: ${SOLO_SHUFFLE_BRACKET} 的 missed-sync-window 行没有录制者的份(没有 (${SYNC_READY_CD_YOURS}) 的冷却,也没有 setupBy)—— t=${f.t} cc=${f.cc} readyCds=${f.readyCds ?? "(缺)"}`,
      );
  });
  return failures;
}

/** The roster line that assigns every player the numeric id each [STATE]
 * token is keyed on: `<unit id="3" name="Supatease-Tichondrius-US" …>`. */
const UNIT_ROSTER_LINE = /<unit\s+id="(\d+)"\s+name="([^"]+)"/;
/** One [STATE] HP token: `3(BDruid):97`, `2(SHunter):dead`,
 * `1(HPriest):ghost`. */
const STATE_TOKEN = /(\d+)\([^)]*\):(\d+|dead|ghost)\b/g;
/** The candidate-menu types that cite a unit's HP at a rendered second, and
 * which facts carry the unit name / the HP claim / the second the claim is
 * about. `t` is that second by default; `slow-defensive-response` overrides it
 * because its HP fact is a MIN over the window, not the value at the window
 * start, so it renders (and is checked at) its own `pressuredHpT`.
 *
 * `trough: true` (FT-T03, user ruling 2026-10-10, D7): the fact is a TROUGH —
 * the true minimum inside its window (`hpTroughInWindow`), printed at the
 * second it happened — not a point reading. Its same-second `[STATE]` tick
 * is the reading at the START of that second, so the two are not equal; the
 * invariant is that the tick never reads BELOW the fact (`isTickBelowTrough`)
 * and is not `dead`. The point readings (no flag: cd-hoarded,
 * crisis-no-response) keep exact equality: the ruling leaves cd-hoarded's
 * `crisisHpPct` and the crossing instants on the grid. */
type CrisisHpFactType =
  | "cd-hoarded"
  | "crisis-no-response"
  | "slow-defensive-response"
  | "kick-eaten";
const CRISIS_HP_FACT_KEYS: Record<
  CrisisHpFactType,
  ReadonlyArray<{ unit: string; hp: string; at: string; trough?: true }>
> = {
  "cd-hoarded": [{ unit: "crisisUnit", hp: "crisisHpPct", at: "t" }],
  "crisis-no-response": [{ unit: "unit", hp: "hpPct", at: "t" }],
  // the pressured friendly's lowest HP inside the burst window — the
  // engine's trough pair (`troughHpPct` / `troughHpSec`); whether the window
  // is a candidate is decided on the grid pair (`triaged`)
  "slow-defensive-response": [
    {
      unit: "pressured",
      hp: "pressuredHpPct",
      at: "pressuredHpT",
      trough: true,
    },
  ],
  // GH #113: the lowest unit of each side during the kick's lockout. Whether
  // the fact exists is decided on the [STATE] grid (`gridHpMinInWindow`);
  // its value is the trough inside the lockout. Only the fact's own second
  // is checked: a full-immunity second is left out of the minimum, and the
  // text does not say which seconds those were.
  "kick-eaten": [
    { unit: "ourLowUnit", hp: "ourLowPct", at: "ourLowT", trough: true },
    { unit: "theirLowUnit", hp: "theirLowPct", at: "theirLowT", trough: true },
  ],
};

export interface CrisisHpStateProbe {
  type: CrisisHpFactType;
  /** the fact is a trough (a minimum inside a window), not a point reading —
   * see `CRISIS_HP_FACT_KEYS` and `crisisHpProbeMismatch` */
  trough: boolean;
  /** 0-based index into `lines` */
  lineIndex: number;
  /** the rendered second the fact's `t` floors onto (`fmtTime`'s grid) */
  tSecond: number;
  unitName: string;
  /** the roster id the unit's [STATE] tokens are keyed on, null when the
   * roster block does not name this unit (nothing to cross-check against) */
  unitId: number | null;
  factHp: number;
  /** the same-second [STATE] tick's reading for this unit — a number, the
   * literal "dead", or null when no such tick carries the unit at all
   * (STATE is emitted only inside critical windows, so partial coverage is
   * normal and is NOT a failure). "ghost" (Spirit of Redemption) is also
   * reported as null: it is a third state that no HP fact can equal. */
  stateHp: number | "dead" | null;
  /** whether a same-second [STATE] line carries this unit at all (any
   * token, "ghost" included) — `checkCrisisStateTickPresent` */
  stateSeen: boolean;
  /** a kick-eaten trough on the lockout's first second, the one after it,
   * or its last rendered second: that second's tick can read a sample from before the
   * kick or after the lock (user ruling 2026-10-17, F15: an event span reads only its own
   * samples), so it says nothing about the trough */
  spanEdge?: true;
  /** the tick at `tSecond` is the unit's FIRST `dead` tick — its death
   * second, whose live samples belong to a trough (user ruling 2026-10-20) */
  deathSecond?: true;
}

/**
 * The probe behind `checkCrisisHpStateConsistency`, exported so the standing
 * measurement (`packages/eval/scripts/crisisHpStateScan.ts`) counts coverage
 * and mismatches through the SAME parser the gate fails on — one fact, one
 * predicate (CLAUDE.md).
 */
export function crisisHpStateProbes(lines: string[]): CrisisHpStateProbe[] {
  const idByName = new Map<string, number>();
  const stateAt = new Map<number, Map<number, number | "dead" | "ghost">>();
  for (const line of lines) {
    const roster = line.match(UNIT_ROSTER_LINE);
    if (roster) {
      idByName.set(roster[2]!, Number(roster[1]));
      continue;
    }
    const st = line.match(STATE_LINE);
    if (!st) continue;
    const units = new Map<number, number | "dead" | "ghost">();
    for (const tok of st[3]!.matchAll(STATE_TOKEN)) {
      const v = tok[2]!;
      units.set(Number(tok[1]), v === "dead" || v === "ghost" ? v : Number(v));
    }
    stateAt.set(Number(st[1]) * 60 + Number(st[2]), units);
  }

  const probes: CrisisHpStateProbe[] = [];
  lines.forEach((line, i) => {
    for (const [type, keySets] of Object.entries(CRISIS_HP_FACT_KEYS)) {
      if (!line.includes(`type=${type}`)) continue;
      const m = line.match(/facts=\{(.*)\}\s*$/);
      if (!m) continue;
      const f = parseFactsBlock(m[1]!);
      for (const keys of keySets) {
        const t = Number(f[keys.at]);
        const hp = Number(f[keys.hp]);
        const unitName = f[keys.unit];
        if (!Number.isFinite(t) || !Number.isFinite(hp) || !unitName) continue;
        // The fact is rendered on the fmtFactNum scale (crisis-no-response keeps
        // one decimal); [STATE] is rendered by fmtTime, i.e. floored.
        const tSecond = Math.floor(t);
        const unitId = idByName.get(unitName) ?? null;
        const tick =
          unitId === null ? undefined : stateAt.get(tSecond)?.get(unitId);
        // the lockout's own edges (kick-eaten: `t` = the kick, `lockout` = s)
        const kickT = Number(f["t"]);
        const lock = Number(f["lockout"]);
        const spanEdge =
          type === "kick-eaten" &&
          Number.isFinite(kickT) &&
          Number.isFinite(lock) &&
          (tSecond === Math.floor(kickT) ||
            // the tick of the next second reads its NEAREST sample, which
            // can still predate the kick (38-1 1:11: kick 70.8 s, the 1:11
            // tick read ~70.7 s; codex 20-F15-07: a kick at 26.4 s with no
            // sample until 27.8 s does the same) — no cutoff on the fraction
            tSecond === Math.floor(kickT) + 1 ||
            tSecond === Math.floor(kickT + lock));
        const deathSecond =
          tick === "dead" &&
          unitId !== null &&
          ![...stateAt].some(
            ([s, units]) => s < tSecond && units.get(unitId) === "dead",
          );
        probes.push({
          type: type as CrisisHpFactType,
          ...(spanEdge ? { spanEdge: true as const } : {}),
          ...(deathSecond ? { deathSecond: true as const } : {}),
          trough: keys.trough === true,
          lineIndex: i,
          tSecond,
          unitName,
          unitId,
          factHp: hp,
          stateHp: tick === undefined || tick === "ghost" ? null : tick,
          stateSeen: tick !== undefined,
        });
      }
    }
  });
  return probes;
}

/**
 * `free Xs of Ys` (healer-offense windows, triage 2026-09-29 res-readiness
 * F-C11): the free seconds can never exceed the window's rendered length —
 * X used to round the raw window while Y is the rendered one ("17s of 16s").
 *
 * X is the producer's `fmtWholeSecondsOrZero` text — `12s`, `0s` (no free
 * second at all) or `<1s` (a positive remainder that rounds to zero) — and is
 * read back with the same module's `parseWholeSeconds` (`<1s` = 0, the number
 * it rounded to). A slot the parser cannot read is a failure too: a private
 * `\d+s` pattern here would simply stop seeing a line whose form changed.
 */
const FREE_OF = /\bfree (\S+s) of (\d+)s\b/g;
export function checkFreeOfWindowConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(FREE_OF)) {
      const free = parseWholeSeconds(m[1]!);
      if (free === undefined)
        failures.push(
          `line ${i + 1}: free ${m[1]} of ${m[2]}s —— 空闲秒数不是 fmtWholeSecondsOrZero 的写法(Ns / <1s)`,
        );
      else if (free > Number(m[2]))
        failures.push(
          `line ${i + 1}: free ${m[1]} of ${m[2]}s —— 空闲秒数超过窗口渲染长度`,
        );
    }
  });
  return failures;
}

/**
 * `[BURST ANSWERED] … <name> bottomed at P% at M:SS` (triage 2026-09-29
 * sync-burst F-B3). The bottom is the engine's `pressured.troughHpPct` /
 * `troughHpSec` — the true minimum inside the window's outcome span
 * (`hpTroughInWindow`; FT-T03, user ruling 2026-10-10, D7 — it was the
 * lowest whole-second `gridHpPct` reading, and a same-second `[STATE]` tick
 * had to print the same number). What the text certifies now:
 *  - its second can never precede the line's own second (the window opens
 *    there);
 *  - it is not after the unit's death second: a tick BEFORE its second may
 *    not read `dead` (user ruling 2026-10-20 — the death second's own live
 *    samples belong to the trough, so its own tick may);
 *  - no `[STATE]` tick of that unit from the line's second to the bottom's
 *    second reads below it (`isTickBelowTrough`) — those seconds are inside
 *    the window for sure; the window's end is not printed, so later ticks
 *    are not adjudicated.
 */
const BURST_ANSWERED_BOTTOM =
  /^\s*(\d+):(\d{2})\s+\[BURST ANSWERED\].*;\s+(\S+) bottomed at (\d+)% at (\d+):(\d{2})/;
/** A `[STATE]` tick of unit `id` before second `sec` already read `dead`:
 * a trough stamped at `sec` would come after the death second (user ruling
 * 2026-10-20 — the death second itself carries its live samples). */
function diedBefore(
  stateAt: ReadonlyMap<number, ReadonlyMap<number, number | "dead" | "ghost">>,
  id: number,
  sec: number,
): boolean {
  for (const [s, units] of stateAt)
    if (s < sec && units.get(id) === "dead") return true;
  return false;
}
export function checkBurstAnsweredBottomConsistency(lines: string[]): string[] {
  const idByName = new Map<string, number>();
  const stateAt = new Map<number, Map<number, number | "dead" | "ghost">>();
  for (const line of lines) {
    const roster = line.match(UNIT_ROSTER_LINE);
    if (roster) {
      idByName.set(roster[2]!, Number(roster[1]));
      continue;
    }
    const st = line.match(STATE_LINE);
    if (!st) continue;
    const units = new Map<number, number | "dead" | "ghost">();
    for (const tok of st[3]!.matchAll(STATE_TOKEN)) {
      const v = tok[2]!;
      units.set(Number(tok[1]), v === "dead" || v === "ghost" ? v : Number(v));
    }
    stateAt.set(Number(st[1]) * 60 + Number(st[2]), units);
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(BURST_ANSWERED_BOTTOM);
    if (!m) return;
    const t = Number(m[1]) * 60 + Number(m[2]);
    const b = Number(m[5]) * 60 + Number(m[6]);
    const pct = Number(m[4]);
    if (b < t)
      failures.push(
        `line ${i + 1}: [BURST ANSWERED] 触底时刻 ${fmtTime(b)} 早于本行 ${fmtTime(t)}`,
      );
    // the unit is a roster label since FT (`1(FMage)`), a character name in
    // older prompts
    const byLabel = m[3]!.match(/^(\d+)\(/);
    const id = byLabel ? Number(byLabel[1]) : idByName.get(m[3]!);
    if (id === undefined) return;
    // user ruling 2026-10-20 (fact2 R1): the death second's live samples
    // are part of the trough, so a bottom stamped at the death second — the
    // first tick that reads `dead` — is allowed; one after it is not
    if (diedBefore(stateAt, id, b))
      failures.push(
        `line ${i + 1}: [BURST ANSWERED] 说 ${m[3]} 在 ${fmtTime(b)} 触底 ${pct}%,此前 [STATE] 已为 dead`,
      );
    for (let s = t; s <= b; s++) {
      const tick = stateAt.get(s)?.get(id);
      if (typeof tick === "number" && isTickBelowTrough(tick, pct))
        failures.push(
          `line ${i + 1}: [BURST ANSWERED] 说 ${m[3]} 在 ${fmtTime(b)} 触底 ${pct}%,但 ${fmtTime(s)} 的 [STATE] 为 ${tick}`,
        );
    }
  });
  return failures;
}

// "    0:54–1:04 [Critical burst] 2.8→5.7yd from … — your HP 98%→70% (min over window) (HP stayed at or above 35%) — …"
const STAYED_IN_HP =
  /^\s+(\d+):(\d\d)–(\d+):(\d\d) \[[^\]]* burst\] .* — your HP (\d+)%→(\d+)% \(min over window\)( \(near-death — the stay was costly\)| \(HP stayed at or above (\d+)%\))?/;

/**
 * Hard invariant (FT-T03, user ruling 2026-10-10, D7): a POSITIONING
 * `STAYED IN` line's `your HP A%→B% (min over window)` — B is a TROUGH, the
 * true minimum of the log owner's HP inside the span
 * (`computeOwnerPositionEvents` → `ownerHpLowPct`, `hpTroughInWindow`), so:
 *  - B is not above A (the start reading is part of the minimum);
 *  - A is a point reading — the `[STATE]` tick of the span's first displayed
 *    second (`gridHpPct` at the rendered start second): when that tick
 *    carries the log owner, the two are EQUAL;
 *  - no `[STATE]` tick of the log owner on a whole second inside the span —
 *    its first displayed second included — reads below B
 *    (`isTickBelowTrough`);
 *  - the tag is true of the number it stands next to:
 *    `(HP stayed at or above N%)` needs N = `STAYED_IN_NEAR_DEATH_PCT` (the
 *    renderer's own constant) and B ≥ N; `(near-death — the stay was
 *    costly)` needs B < N (the verdict is decided on the whole-second
 *    minimum, and the trough is never above that).
 * Before the ruling this line had no gate: B was the lowest whole-second
 * reading and nothing re-read it. Until 2026-10-11 the span's first displayed
 * second was left out, because the producer read the window from its
 * fractional start (A = the raw reading at that instant, the minimum's ticks
 * from the next whole second) — so a tick of the second the line begins on
 * could sit below the printed minimum unseen. The producer now reads the
 * rendered seconds the line prints, and the gate checks every one of them.
 * A line with no span (`m:ss [...]`) or no HP clause is out of scope; so is a
 * roster without a `log owner`.
 */
export function checkStayedInHpConsistency(lines: string[]): string[] {
  let ownerId: number | null = null;
  const ownerTick = new Map<number, number>();
  // the seconds whose tick prints the owner `dead`
  const ownerDeadAt = new Set<number>();
  for (const line of lines) {
    const role = line.match(UNIT_ROLE_LINE);
    if (role && role[2] === "log owner") ownerId = Number(role[1]);
  }
  if (ownerId !== null)
    for (const line of lines) {
      const st = line.match(STATE_LINE);
      if (!st) continue;
      for (const tok of st[3]!.matchAll(STATE_TOKEN)) {
        if (Number(tok[1]) !== ownerId) continue;
        const at = Number(st[1]) * 60 + Number(st[2]);
        if (/^\d+$/.test(tok[2]!)) ownerTick.set(at, Number(tok[2]));
        else if (tok[2] === "dead") ownerDeadAt.add(at);
      }
    }

  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(STAYED_IN_HP);
    if (!m) return;
    const from = Number(m[1]) * 60 + Number(m[2]);
    const to = Number(m[3]) * 60 + Number(m[4]);
    const A = Number(m[5]);
    const B = Number(m[6]);
    const at = `line ${i + 1}: STAYED IN ${fmtTime(from)}–${fmtTime(to)}`;
    if (B > A) failures.push(`${at} 窗口最低 ${B}% 高于起点 ${A}%`);
    if (m[7]?.includes("near-death") && B >= STAYED_IN_NEAR_DEATH_PCT)
      failures.push(
        `${at} 标注 near-death,但窗口最低 ${B}% ≥ ${STAYED_IN_NEAR_DEATH_PCT}%`,
      );
    if (m[8] !== undefined) {
      const n = Number(m[8]);
      if (n !== STAYED_IN_NEAR_DEATH_PCT)
        failures.push(
          `${at} 标注「HP stayed at or above ${n}%」与判据常量 ${STAYED_IN_NEAR_DEATH_PCT}% 不一致`,
        );
      if (B < n)
        failures.push(
          `${at} 标注「HP stayed at or above ${n}%」但窗口最低 ${B}%`,
        );
    }
    const startTick = ownerTick.get(from);
    if (startTick !== undefined && startTick !== A)
      failures.push(
        `${at} 起点写 ${A}%,但 ${fmtTime(from)} 的 [STATE] 报 ${startTick}%`,
      );
    for (let s = from; s <= to; s++) {
      const tick = ownerTick.get(s);
      if (tick !== undefined && isTickBelowTrough(tick, B))
        failures.push(
          `${at} 窗口最低写 ${B}%,但 ${fmtTime(s)} 的 [STATE] 报 ${tick}%`,
        );
    }
    // a span that ends on the owner's death second reads 0 there
    if (ownerDeadAt.has(to) && B !== 0)
      failures.push(
        `${at} 窗口最低写 ${B}%,但 ${fmtTime(to)} 的 [STATE] 报主人 dead(应为 0%)`,
      );
  });
  return failures;
}

/**
 * Does a covered probe contradict its `[STATE]` tick? One predicate for the
 * gate and the standing measurement (`scripts/crisisHpStateScan.ts`):
 *  - a point reading must EQUAL the tick;
 *  - a trough must not be ABOVE it (`isTickBelowTrough`, the analysis side's
 *    own invariant);
 *  - `dead` contradicts either. An uncovered probe (`stateHp === null`) is
 *    never a mismatch.
 */
export function crisisHpProbeMismatch(p: CrisisHpStateProbe): boolean {
  if (p.stateHp === null) return false;
  // a trough may sit in its unit's death second (user ruling 2026-10-20:
  // the live samples of that second are part of it); a point reading may not
  if (p.stateHp === "dead") return !(p.trough && p.deathSecond);
  return p.trough
    ? !p.spanEdge && isTickBelowTrough(p.stateHp, p.factHp)
    : p.stateHp !== p.factHp;
}

/**
 * HardFailure class (T12 ⑧ i, user ruling 2026-10-10): the answer a
 * `[BURST ANSWERED] … — L still died` line credits was pressed BEFORE L's
 * death (`creditedAnswer` skips the engine's `afterPressuredDeath`, `isDeadAt`
 * on raw instants). The prompt prints whole seconds, so the gate asserts what
 * the grid can prove, with no tolerance of its own: the line opens at second
 * `t` (the lead cast is at or after it), the answer came `N` s after the lead
 * cast (one decimal, so at least `N − 0.05`), and L's earliest `[DEATH]` line
 * at second `D` means the death was before `D + 1`. An answer at or after
 * `D + 1` is therefore after the death — `t + N − 0.05 ≥ D + 1` fails. An
 * answer inside the death's own second is beyond the grid and is pinned by
 * the unit tests on the raw instants instead.
 */
export function checkBurstAnsweredBeforeDeath(lines: string[]): string[] {
  const deathSec = new Map<string, number>();
  for (const line of lines) {
    const d = line.match(FRIENDLY_DEATH_LINE);
    if (!d) continue;
    const at = Number(d[1]) * 60 + Number(d[2]);
    if (at < (deathSec.get(d[3]!) ?? Infinity)) deathSec.set(d[3]!, at);
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const a = parseBurstAnsweredLine(line);
    if (!a || !a.pressuredDied) return;
    const died = deathSec.get(a.pressured);
    if (died === undefined) return;
    // tenths, so the comparison is exact
    if (a.atSec * 10 + Math.round(a.latencySec * 10) - 0.5 >= (died + 1) * 10)
      failures.push(
        `line ${i + 1}: [BURST ANSWERED] 记 ${a.answerer} 的 ${a.spellName} 为回应(开手 ${fmtTime(a.atSec)} 后 ${a.latencySec}s),但 ${a.pressured} 已在 ${fmtTime(died)} 死亡`,
      );
  });
  return failures;
}

const LOG_OWNER_ROSTER_LINE = /<unit\s+id="(\d+)"[^>]*role="log owner"/;
/**
 * HardFailure class (T12 ⑧ i, user ruling 2026-10-10): the length a
 * `[BURST ANSWERED] … answered with X on T (span)` line prints for a control
 * is the one its `[CC ON ENEMY]` line prints — `ccSpanLookup` joins the
 * credit line to the CC instance of the same aura application and both go
 * through `renderedCcSpan`.
 *
 * Read on the rendered text: among the `[CC ON ENEMY] T ← X (by <answerer>)`
 * lines whose second can be that application's — the line opens at `t`, the
 * answer came `N` s after the lead cast, and the aura lands from
 * `AIMED_CONTROL_LANDING_LEAD_MS` before the press to
 * `GROUND_CONTROL_FUSE_MS` after it, the engine's own two bounds — at least
 * one prints the same span. No such line (a spell whose cast and aura carry
 * different names, a pet's control) proves nothing and passes.
 *
 * The log owner's answers are not read: the owner's control prints on its
 * `[YOU] [CC]` cast line and keeps a `[CC ON ENEMY]` line only in two cases,
 * so the lines present are not all of that player's applications.
 */
export function checkBurstAnsweredControlSpan(lines: string[]): string[] {
  let ownerId: string | undefined;
  const landings: Array<{
    sec: number;
    target: string;
    spell: string;
    by: string;
    span: string;
  }> = [];
  for (const line of lines) {
    ownerId ??= line.match(LOG_OWNER_ROSTER_LINE)?.[1];
    const c = line.match(CC_ON_ENEMY_LINE);
    if (!c) continue;
    const rest = line.slice(c[0].length);
    const span =
      rest.match(/^ \(([^)]*)\)/)?.[1] ??
      rest.match(/ ended this CC after (\S+) \(cut short/)?.[1];
    if (span === undefined) continue;
    landings.push({
      sec: Number(c[1]) * 60 + Number(c[2]),
      target: c[3]!,
      spell: c[4]!,
      by: c[5]!,
      span,
    });
  }
  if (ownerId === undefined) return [];
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const a = parseBurstAnsweredLine(line);
    if (!a || a.answerer.startsWith(`${ownerId}(`)) return;
    // the answer is in [t + N − 0.05, t + 1 + N + 0.05)
    const lo = Math.floor(
      a.atSec + a.latencySec - 0.05 - AIMED_CONTROL_LANDING_LEAD_MS / 1000,
    );
    const hi = Math.floor(
      a.atSec + 1 + a.latencySec + 0.05 + GROUND_CONTROL_FUSE_MS / 1000,
    );
    for (const on of a.controlOn) {
      if (on.span === undefined) continue;
      const same = landings.filter(
        (l) =>
          l.target === on.target &&
          l.spell === a.spellName &&
          l.by === a.answerer &&
          l.sec >= lo &&
          l.sec <= hi,
      );
      if (same.length > 0 && !same.some((l) => l.span === on.span))
        failures.push(
          `line ${i + 1}: [BURST ANSWERED] 写 ${a.spellName} 在 ${on.target} 身上 (${on.span}),` +
            `同一次控制的 [CC ON ENEMY] 行(${same.map((l) => fmtTime(l.sec)).join(" / ")})写 (${same.map((l) => l.span).join(" / ")})`,
        );
    }
  });
  return failures;
}

/**
 * Hard invariant (2026-08-30): a `cd-hoarded` / `crisis-no-response` menu line
 * claims a unit's HP at a rendered second; when the timeline also emits a
 * `[STATE]` tick for that unit at that same rendered second, the two numbers
 * must be identical.
 *
 * Same class as `checkSameSecondHpConsistency` (the 2026-07-20 [DMG SPIKE] vs
 * [STATE] bug), same root cause: the crisis crossing was sampled at the raw
 * advancedAction timestamp while [STATE] samples
 * `getUnitHpAtTimestamp(unit, startMs + s*1000, HP_SAMPLE_RADIUS_MS)` on whole
 * seconds, and both rendered into one displayed second. Measured before the
 * fix over the 309-prompt A/B corpus: cd-hoarded 155/167 covered lines
 * mismatched, crisis-no-response 7/8. The fix re-anchors the analysis side
 * (`crisisDecisionPoints.gridHpPct`) onto the render grid; this gate is what
 * keeps it there.
 *
 * A `dead` [STATE] tick against a numeric HP fact is also a failure — the two
 * lines then disagree about whether the unit was even alive.
 *
 * FT-T03 (user ruling 2026-10-10, D7): a TROUGH fact (kick-eaten's
 * `ourLowPct` / `theirLowPct`, slow-defensive-response's `pressuredHpPct`)
 * is the true minimum inside its window and may
 * sit below its second's tick; for those the failure is a tick BELOW the
 * fact, or `dead` after the unit's death second (`crisisHpProbeMismatch`; user
 * ruling 2026-10-20: the death second's own live samples belong to the
 * trough). The point readings — cd-hoarded, crisis-no-response — keep exact
 * equality.
 */
export function checkCrisisHpStateConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (const p of crisisHpStateProbes(lines)) {
    if (!crisisHpProbeMismatch(p)) continue;
    failures.push(
      `line ${p.lineIndex + 1}: ${p.type} 声称 ${p.unitName} 在 ${fmtMmSs(p.tSecond)} 为 ${p.factHp}%,` +
        `而同秒 [STATE] 报 ${p.stateHp === "dead" ? "dead" : `${p.stateHp}%`}`,
    );
  }
  return failures;
}

/** The crisis types whose `t` is a `crisisDecisionPoints` anchor second —
 * the seconds the timeline always ticks (`crisisAnchorSeconds`). */
const CRISIS_ANCHOR_TYPES: ReadonlySet<string> = new Set([
  "cd-hoarded",
  "crisis-no-response",
]);

/**
 * Hard invariant (triage 2026-09-29 H18): a `cd-hoarded` / `crisis-no-response`
 * line's crisis second has a `[STATE]` tick that carries the crisis unit, so
 * the cited HP is on the page and `checkCrisisHpStateConsistency` can compare
 * it. buildMatchTimeline admits every friendly's `crisisDecisionPoints`
 * anchor as a key moment for exactly this; before that, 16 of 28 cd-hoarded
 * lines in the 60 HEAD prompts (14 of 28 re-parsed) had no same-second tick
 * (a crisis outside every critical window, or thinned by the 3 s gap rule).
 * A unit the roster block does not name is not checked (no id to look for).
 */
export function checkCrisisStateTickPresent(lines: string[]): string[] {
  const failures: string[] = [];
  for (const p of crisisHpStateProbes(lines)) {
    if (!CRISIS_ANCHOR_TYPES.has(p.type) || p.unitId === null) continue;
    if (p.stateSeen) continue;
    failures.push(
      `line ${p.lineIndex + 1}: ${p.type} 引用 ${p.unitName} 在 ${fmtMmSs(p.tSecond)} 的 HP,但该秒没有带这个单位的 [STATE] 行`,
    );
  }
  return failures;
}

/**
 * Which candidate types render a corpus-wide OUTCOME reference, and which
 * `facts.*` key carries which field of which constant. One row per type; the
 * check below is type-agnostic, so registering a new reference (the planned
 * `kick-eaten` one, for instance) is one entry here plus the producer
 * rendering the same numbers — no new gate code.
 *
 * The values are the CONSTANTS THEMSELVES, imported from
 * `@gladlog/analysis/src/data/outcomeRefs` — never re-typed literals. That is
 * the whole point of this class (CLAUDE.md shared-predicate rule): analysis
 * renders from the constant, this gate re-parses the rendered text and
 * compares against the same constant, so a drifting producer, a stale cached
 * round, or a model-edited prompt all go red.
 */
export const OUTCOME_REF_FACTS: {
  type: string;
  facts: Record<string, number>;
}[] = [
  {
    type: "attempt-into-trinket",
    facts: {
      refN: ATTEMPT_INTO_TRINKET_OUTCOME_REF.n,
      refKillTrinketDown: ATTEMPT_INTO_TRINKET_OUTCOME_REF.killPctTrinketDown,
      refKillTrinketUp: ATTEMPT_INTO_TRINKET_OUTCOME_REF.killPctTrinketUp,
    },
  },
];

/** 12th hardFailure class (2026-08-30 outcome probe wiring): every menu line
 * of a type registered in OUTCOME_REF_FACTS must render that type's reference
 * numbers exactly as the constant does. Fails closed — a registered fact that
 * is MISSING from the line is a failure too, otherwise a producer that simply
 * stopped emitting the reference would leave the legend citing facts that do
 * not exist. */
export function checkOutcomeRefConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const entry of OUTCOME_REF_FACTS) {
      // `type=<t> ` — the menu renderer always follows the type with a space
      // (`type=${c.type} ${when}`), so this cannot prefix-match a longer type.
      if (!line.includes(`type=${entry.type} `)) continue;
      const m = line.match(/facts=\{(.*)\}\s*$/);
      if (!m) {
        failures.push(`line ${i + 1}: ${entry.type} 行无 facts`);
        continue;
      }
      const f = parseFactsBlock(m[1]!);
      for (const [key, value] of Object.entries(entry.facts)) {
        const want = String(value);
        if (f[key] === undefined)
          failures.push(
            `line ${i + 1}: ${entry.type} 缺少语料参照事实 ${key}(应为 ${want})`,
          );
        else if (f[key] !== want)
          failures.push(
            `line ${i + 1}: ${entry.type} ${key}=${f[key]} 与语料参照常量 ${want} 不一致`,
          );
      }
    }
  }
  return failures;
}

/** `95` → `1:35` — the gate's own rendering of a rendered second, only for
 * failure messages (the analysis side's `fmtTime` is the authority on the
 * text itself). */
// "1:15  [CONSEQ]   friendly healer 1(HPriest) in Fear for 2s → during it: 2(AWarrior) 80% → low 59% at 1:02"
// "0:46  [CONSEQ]   enemy healer 5(HPriest) kicked (Heal; 4s school lockout) → inside the lockout: …"
const CONSEQ_LINE =
  /^(\d+):(\d+)\s+\[CONSEQ\]\s+(friendly|enemy) healer (\d+)\([^)]*\) (?:kicked \([^;]*; ([\d.]+)s school lockout\) → inside the lockout|in .*? for (\d+)s → during it): (.*)$/;
const CONSEQ_DROP = /(\d+)\([^)]*\) (\d+)% → low (\d+)% at (\d+):(\d+)/g;

/**
 * Hard invariant (GH #70, 2026-09-24): an `[CONSEQ]` line's START HP is the
 * reading at the event's own instant (user ruling 2026-10-21 — no longer the
 * [STATE] tick of its second; the text is checked only for agreeing with the
 * line's own claim about it), and its LOW is a trough (`hpTroughInWindow`, the true minimum
 * inside the lockout / CC — FT-T03, user ruling 2026-10-10, D7), so wherever
 * the timeline also printed a tick:
 *  - `A% → low B% at m:ss`: the tick at the line's second reads A; the tick
 *    at m:ss does not read below B (it no longer has to EQUAL B — the tick
 *    is the start of that second, the low the lowest sample inside it); and
 *    no tick of that unit inside the span reads below B (`isTickBelowTrough`)
 *    — from the span's third rendered second on: the first two can read a
 *    sample from before the CC landed (the `spanEdge` of kick-eaten);
 *  - `no teammate dropped 10% or more`: no teammate of that healer (same side
 *    of the [STATE] line) reads 10+ points below its tick at the line's second
 *    anywhere inside the span (the trough is at or below every such tick, so
 *    the line would have named the drop).
 * The span end is only known to the second the analysis floored, so the
 * check covers [start, start + rendered duration − 1], which is always
 * inside it. Same class as checkHealedThroughConsistency.
 */
export function checkConseqHpStateConsistency(lines: string[]): string[] {
  const stateAt = new Map<
    number,
    { friends: Map<number, number>; enemies: Map<number, number> }
  >();
  for (const line of lines) {
    const st = line.match(STATE_LINE);
    if (!st) continue;
    const [fPart, ePart] = st[3]!.split(" / ");
    const read = (part: string | undefined): Map<number, number> => {
      const m = new Map<number, number>();
      for (const tok of (part ?? "").matchAll(STATE_TOKEN))
        if (/^\d+$/.test(tok[2]!)) m.set(Number(tok[1]), Number(tok[2]));
      return m;
    };
    const friendsPart = fPart?.startsWith("friends") ? fPart : undefined;
    const enemiesPart = fPart?.startsWith("enemies") ? fPart : ePart;
    stateAt.set(Number(st[1]) * 60 + Number(st[2]), {
      friends: read(friendsPart),
      enemies: read(enemiesPart),
    });
  }
  const tick = (sec: number, side: "friends" | "enemies", id: number) =>
    stateAt.get(sec)?.[side].get(id);

  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(CONSEQ_LINE);
    if (!m) return;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const side = m[3] === "friendly" ? "friends" : "enemies";
    const healerId = Number(m[4]);
    const spanS = Math.floor(Number(m[5] ?? m[6]));
    const lastSure = start + Math.max(0, spanS - 1);
    const body = m[7]!;
    const where = `line ${i + 1}: [CONSEQ] ${fmtMmSs(start)}`;
    // `no (surviving) teammate dropped 10% or more (<readings>)`
    const heldPart =
      /^no (?:surviving )?teammate dropped \d+% or more \((.*?)\)(?:;|$)/.exec(
        body,
      )?.[1];
    const drops = [...body.matchAll(CONSEQ_DROP)];
    for (const d of drops) {
      const id = Number(d[1]);
      const a = Number(d[2]);
      const b = Number(d[3]);
      const lowSec = Number(d[4]) * 60 + Number(d[5]);
      // the start is the reading at the event's own instant (user ruling
      // 2026-10-21), inside the line's second and not that second's tick:
      // the text cannot re-derive it — it must agree with the claim the
      // line makes about it (a drop part ≥ 10, a held reading under 10)
      const inHeld = heldPart !== undefined && heldPart.includes(d[0]!);
      if (inHeld ? a - b >= 10 : a - b < 10)
        failures.push(
          `${where} ${id} ${a}% → ${b}% 与「${inHeld ? "没掉 10%" : "掉了 10%+"}」的说法不符`,
        );
      // the low's own second lies inside the analysis's span even when it
      // is past `lastSure`, so its tick is checked on its own
      const tl = tick(lowSec, side, id);
      if (
        tl !== undefined &&
        isTickBelowTrough(tl, b) &&
        (lowSec < start || lowSec > lastSure)
      )
        failures.push(
          `${where} 低点写 ${id} 在 ${fmtMmSs(lowSec)} 为 ${b}%,同秒 [STATE] 报 ${tl}%`,
        );
      // the span's first rendered second and the one after it: their ticks
      // read the last sample at or before the second (the [STATE] sampler
      // since fact2, 59cd11023), which can predate the CC's landing — and an
      // event span reads only its own samples (user ruling 2026-10-17), the
      // kick-eaten gate's `spanEdge`. 605 at fact2: 177-6 3:20, a Fear from
      // 3:20.x, the 3:21 tick read 85 % from before it, the low 86 %.
      for (let s = start + 2; s <= lastSure; s++) {
        const v = tick(s, side, id);
        if (v !== undefined && isTickBelowTrough(v, b))
          failures.push(
            `${where} 低点写 ${id} ${b}%,但 ${fmtMmSs(s)} 的 [STATE] 报 ${v}%`,
          );
      }
    }
    // hp-state F-C1: "no surviving teammate dropped" is the same claim for the
    // living (the dead ids carry no numeric tick and are skipped). A line
    // that prints its readings (user ruling 2026-10-21) is checked on them
    // above; this tick-based reading is for one that does not
    if (
      heldPart === undefined &&
      drops.length === 0 &&
      /^no (surviving )?teammate dropped/.test(body)
    ) {
      const startTicks = stateAt.get(start)?.[side];
      if (!startTicks) return;
      for (const [id, v0] of startTicks) {
        if (id === healerId) continue;
        for (let s = start; s <= lastSure; s++) {
          const v = tick(s, side, id);
          if (v !== undefined && v0 - v >= 10)
            failures.push(
              `${where} 写「no teammate dropped」,但 ${id} 从 ${v0}% 掉到 ${fmtMmSs(s)} 的 ${v}%`,
            );
        }
      }
    }
  });
  return failures;
}

function fmtMmSs(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// A candidate-menu line: "  - id=… type=death-setup t=140.2s units=…
// facts={t=140.2, kind=trinket-early, deathT=145.9, …}". `type=` gives the
// candidate type; the fact block (parsed by `parseFactsBlock`) gives every
// named time fact, not just the leading `t=` the "when" prefix shows.
const MENU_LINE_TYPE = /\btype=(\S+)/;
const MENU_LINE_FACTS = /facts=\{(.*)\}\s*$/;

/**
 * (candidate type, fact key) -> the timeline marker rendering the SAME
 * instant that fact describes, one candidate to one marker line at the same
 * rendered second. Only facts with such an unambiguous 1:1 marker are listed
 * here; `menuTRenderGridScan.ts` documents the ones left out (death-setup's
 * OWN `t` -- the setup moment -- whose marker varies by `kind`;
 * crisis-no-response's `t` -- a derived HP threshold, not a printed event)
 * and why. `death-setup`'s `deathT` fact IS listed: it names the same later
 * death `death`'s own `t` names, so it shares that marker.
 */
interface MenuTRenderGridSpec {
  readonly type: string;
  readonly factKey: string;
  readonly marker: string;
}
export const MENU_T_RENDER_GRID_SPECS: readonly MenuTRenderGridSpec[] = [
  { type: "kick-eaten", factKey: "t", marker: "[KICK]" },
  { type: "death", factKey: "t", marker: "[DEATH]" },
  { type: "missed-cleanse", factKey: "t", marker: "[UNCLEANSED DEBUFF]" },
  { type: "death-setup", factKey: "deathT", marker: "[DEATH]" },
  // 2026-09-01 (GH #60 phase 2): slow-defensive-response's `t` is the lead
  // enemy cooldown's own cast second, which the timeline prints as an
  // `[ENEMY CD]` line at that same second — a genuine 1:1 marker, unlike
  // crisis-no-response's derived HP-threshold moment.
  { type: "slow-defensive-response", factKey: "t", marker: "[ENEMY CD]" },
];

export type MenuTRenderGridStatus = "ok" | "off-by-one" | "no-marker";

export interface MenuTRenderGridResult {
  type: string;
  factKey: string;
  lineIndex: number;
  t: number;
  flooredSecond: number;
  status: MenuTRenderGridStatus;
}

/**
 * 13th hardFailure class (2026-08-30, kick-eaten render-grid bug): a
 * candidate-menu line's time fact and its matching timeline marker are two
 * renderings of the same instant (the fact via `fmtFactNum`/`fmtFactTime`,
 * the marker via `fmtTime`) and must floor onto the same rendered second, per
 * CLAUDE.md's Shared-Predicate Rule ("anchored to the rendered value …
 * floored to the rendering grid"). `fmtFactNum`'s `toFixed(1)` rounds instead
 * of floors, so a raw value in x.95–x.99 rendered `(x+1).0` one second past
 * where `fmtTime` still floors its marker — measured on the 2026-08-30 A/B
 * corpus: kick-eaten 20/209 (9.6%), death 23/375 (6.1%), missed-cleanse
 * 3/58 (5.2%, the other 8/58 are late-cleanse windows that legitimately have
 * no `[UNCLEANSED DEBUFF]` marker — see menuTRenderGridScan.ts), death-setup
 * `deathT` 10/129 (7.8%) — always this exact shape. `Math.floor(t) - 1`
 * matching the marker (not just "no marker anywhere") is the fingerprint of
 * the rounding-up bug specifically, vs. a marker missing for some unrelated
 * reason (e.g. the late-cleanse case above).
 */
export function scanMenuTRenderGrid(
  lines: string[],
  specs: readonly MenuTRenderGridSpec[] = MENU_T_RENDER_GRID_SPECS,
): MenuTRenderGridResult[] {
  const hasMarkerAt = (sec: number, marker: string): boolean =>
    sec >= 0 &&
    lines.some(
      (l) => l.trimStart().startsWith(fmtTime(sec)) && l.includes(marker),
    );

  const results: MenuTRenderGridResult[] = [];
  lines.forEach((line, i) => {
    if (!line.trimStart().startsWith("- id=")) return;
    const typeM = line.match(MENU_LINE_TYPE);
    const factsM = line.match(MENU_LINE_FACTS);
    if (!typeM || !factsM) return;
    const type = typeM[1]!;
    const relevant = specs.filter((s) => s.type === type);
    if (relevant.length === 0) return;
    const facts = parseFactsBlock(factsM[1]!);
    for (const spec of relevant) {
      const raw = facts[spec.factKey];
      if (raw === undefined || !/^\d+(?:\.\d+)?$/.test(raw)) continue;
      const t = Number(raw);
      const flooredSecond = Math.floor(t);
      const status: MenuTRenderGridStatus = hasMarkerAt(
        flooredSecond,
        spec.marker,
      )
        ? "ok"
        : hasMarkerAt(flooredSecond - 1, spec.marker)
          ? "off-by-one"
          : "no-marker";
      results.push({
        type,
        factKey: spec.factKey,
        lineIndex: i,
        t,
        flooredSecond,
        status,
      });
    }
  });
  return results;
}

/** Gate wrapper: kick-eaten's `t` only. The other specs
 * (death/missed-cleanse's `t`, death-setup's `deathT`) are real,
 * corpus-verified instances of the SAME bug (see the doc comment above) and
 * were fixed the same way, but this particular hardFailure text is
 * kick-eaten-specific per the fix's scope; `scanMenuTRenderGrid`'s full
 * spec list is what `menuTRenderGridScan.ts` audits going forward. */
export function checkMenuTRenderGrid(lines: string[]): string[] {
  return scanMenuTRenderGrid(
    lines,
    MENU_T_RENDER_GRID_SPECS.filter((s) => s.type === "kick-eaten"),
  )
    .filter((r) => r.status === "off-by-one")
    .map(
      (r) =>
        `line ${r.lineIndex + 1}: type=kick-eaten t=${r.t} floors to ${fmtTime(r.flooredSecond)} but its [KICK] marker sits one render-grid second earlier at ${fmtTime(r.flooredSecond - 1)} (fmtFactNum's toFixed(1) rounded an x.95–x.99 timestamp up past the whole-second boundary fmtTime floors to)`,
    );
}

export function checkSelfOnlyDefensiveClaims(lines: string[]): string[] {
  const violations: string[] = [];
  lines.forEach((line, i) => {
    const m = DEFENSIVE_AVAILABLE.exec(line);
    if (!m) return;
    const [, whoPid, spellName] = m;
    let dyingPid: string | null = null;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const k = KILL_LINE.exec(lines[j]);
      if (k) {
        dyingPid = k[1];
        break;
      }
    }
    if (!dyingPid || dyingPid === whoPid) return; // 自己的死:自保 CD 合理
    // `X (on an ally — Talent)`: the holder's talent puts this self-only
    // wall on an ally (`allyReachTalentNote`, user ruling 2026-10-27) — the
    // note must be the one that spell's talent prints
    const note = / \((on an ally — [^)]+)\)$/.exec(spellName.trim());
    const name = note ? spellName.trim().slice(0, note.index) : spellName.trim();
    const spellId = DEFENSIVE_ID_BY_NAME.get(name);
    if (!spellId) return; // 认不出的技能不报
    if (canHelpAnotherUnit(spellId)) return;
    if (
      note &&
      allyReachTalentNote({ spellId, allyReach: true }) === note[1]
    )
      return;
    violations.push(
      `self-only defensive offered for another unit's death: "${line.trim()}" ` +
        `(${spellName.trim()}/${spellId} 够不着 ${dyingPid})`,
    );
  });
  return violations;
}

export function checkSnapshotFactsConsistency(promptText: string): string[] {
  const items = parseSnapshotItems(promptText.split("\n"));
  const violations: string[] = [];

  // --- HP agreement between kind=hp-snap and kind=hp ---
  // Keyed on `t|role|unit`, not just `t|unit` (I-4 fix, 2026-08-05 final
  // review): `unit` is the realm-stripped short name (`sn()`), so a mirror
  // comp with the same short name on both sides (one owner/teammate, one
  // enemy) would otherwise collide into one bucket and read as a same-unit
  // HP contradiction when it's really two different real players. `role`
  // (owner/teammate/enemy) is already carried on every hp/hp-snap facts
  // block, so folding it into the key costs nothing and fully separates the
  // cross-team case.
  interface HpPoint {
    t: number;
    role: string;
    unit: string;
    hp: number;
    kind: "hp" | "hp-snap";
    source: string;
  }
  const hpPoints: HpPoint[] = [];
  for (const it of items) {
    if (it.kind === "hp") {
      const t = Number(it.facts.t);
      const hp = Number(it.facts.hp);
      const role = it.facts.role;
      if (it.facts.unit && role && Number.isFinite(t) && Number.isFinite(hp)) {
        hpPoints.push({
          t,
          role,
          unit: it.facts.unit,
          hp,
          kind: "hp",
          source: `${it.key}(hp)`,
        });
      }
    } else if (it.kind === "hp-snap") {
      const unit = it.facts.unit;
      const role = it.facts.role;
      if (!unit || !role) continue;
      const t0 = Number(it.facts.t0);
      const t1 = Number(it.facts.t1);
      if (it.facts.hpStart !== undefined && Number.isFinite(t0)) {
        const hpStart = Number(it.facts.hpStart);
        if (Number.isFinite(hpStart))
          hpPoints.push({
            t: t0,
            role,
            unit,
            hp: hpStart,
            kind: "hp-snap",
            source: `${it.key}(hpStart)`,
          });
      }
      if (it.facts.hpEnd !== undefined && Number.isFinite(t1)) {
        const hpEnd = Number(it.facts.hpEnd);
        if (Number.isFinite(hpEnd))
          hpPoints.push({
            t: t1,
            role,
            unit,
            hp: hpEnd,
            kind: "hp-snap",
            source: `${it.key}(hpEnd)`,
          });
      }
    }
  }
  const byInstant = new Map<string, HpPoint[]>();
  for (const p of hpPoints) {
    const k = `${p.t}|${p.role}|${p.unit}`;
    if (!byInstant.has(k)) byInstant.set(k, []);
    byInstant.get(k)!.push(p);
  }
  for (const pts of byInstant.values()) {
    // Same-name-collision self-check (I-4): if the SAME kind reports more
    // than one distinct HP value for this exact (t, role, unit) key, that is
    // a textually-detectable sign that "unit" is actually two different real
    // players sharing a short name (the collector reads one real unit
    // deterministically, so two disagreeing same-kind readings can't both be
    // genuine re-samples of one player). Treat the whole key as ambiguous
    // and skip the cross-kind comparison entirely rather than report a
    // false contradiction.
    const byKind = new Map<string, Set<number>>();
    for (const p of pts) {
      const set = byKind.get(p.kind) ?? new Set<number>();
      set.add(p.hp);
      byKind.set(p.kind, set);
    }
    const ambiguous = [...byKind.values()].some((set) => set.size > 1);
    if (ambiguous) continue;

    for (let i = 1; i < pts.length; i++) {
      const delta = Math.abs(pts[i].hp - pts[0].hp);
      if (delta > HP_AGREEMENT_TOLERANCE_PP) {
        violations.push(
          `${pts[0].source} 与 ${pts[i].source} 同秒(${pts[0].t}s)同单位(${pts[0].unit})HP 不一致:${pts[0].hp}% vs ${pts[i].hp}%(Δ${delta}pp)`,
        );
      }
    }
  }

  // --- cd-ledger ready list vs immunity-available / external-available ---
  // Keyed on `floor(t)|unit` (I-3 fix, 2026-08-05 final review): cd-ledger is
  // sampled at the snapshot window's midpoint while immunity/external-available
  // are judged at the death/event instant — those can be ~10s apart, during
  // which the spell can genuinely go on/off cooldown, so comparing across
  // different rendered seconds is comparing two different truths. Only
  // compare when both facts blocks render the same whole second; a unit with
  // no cd-ledger reading at that exact second is skipped rather than compared
  // against a ready-set sampled at some other time.
  const readyByUnitAtSecond = new Map<string, Set<string>>();
  for (const it of items) {
    if (it.kind !== "cd-ledger" || !it.facts.unit || it.facts.t === undefined)
      continue;
    const t = Math.floor(Number(it.facts.t));
    if (!Number.isFinite(t)) continue;
    const ready = (it.facts.ready ?? "")
      .split("、")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== "无");
    const key = `${t}|${it.facts.unit}`;
    const set = readyByUnitAtSecond.get(key) ?? new Set<string>();
    for (const r of ready) set.add(r);
    readyByUnitAtSecond.set(key, set);
  }
  for (const it of items) {
    if (it.kind === "immunity-available") {
      const unit = it.facts.unit;
      const spell = it.facts.spell;
      const t =
        unit && it.facts.t !== undefined ? Math.floor(Number(it.facts.t)) : NaN;
      if (!unit || !spell || !Number.isFinite(t)) continue;
      const ready = readyByUnitAtSecond.get(`${t}|${unit}`);
      if (ready && !ready.has(spell)) {
        violations.push(
          `${it.key} kind=immunity-available 声称 ${unit} 的 "${spell}" 可用,但同秒(${t}s)cd-ledger 未把它列入 ${unit} 的 ready 中`,
        );
      }
    } else if (it.kind === "external-available") {
      const holder = it.facts.holder;
      const spell = it.facts.spell;
      const t =
        holder && it.facts.t !== undefined
          ? Math.floor(Number(it.facts.t))
          : NaN;
      if (!holder || !spell || !Number.isFinite(t)) continue;
      const ready = readyByUnitAtSecond.get(`${t}|${holder}`);
      if (ready && !ready.has(spell)) {
        violations.push(
          `${it.key} kind=external-available 声称 ${holder} 的 "${spell}" 可用,但同秒(${t}s)cd-ledger 未把它列入 ${holder} 的 ready 中`,
        );
      }
    }
  }

  return violations;
}

function duplicateRatio(
  lines: string[],
  normalize: (line: string) => string,
): number {
  const nonEmpty = lines.map(normalize).filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const line of nonEmpty) counts.set(line, (counts.get(line) ?? 0) + 1);
  let duplicated = 0;
  for (const count of counts.values()) if (count > 1) duplicated += count - 1;
  return Math.round((duplicated / nonEmpty.length) * 1000) / 1000;
}

export function checkMatch(
  entry: IndexEntry,
  promptText: string,
  manifest: CoverageManifest,
): MatchQuality {
  const lines = promptText.split("\n");

  const friendlyDeaths = checkFriendlyDeaths(lines, manifest);
  const coverage = {
    friendlyDeaths,
    ccSpells: checkSpells(promptText, manifest.ccApplied),
    interruptSpells: checkSpells(promptText, manifest.interrupts),
    dispels: checkSpells(promptText, manifest.dispels),
    trinketCasts: checkTrinkets(lines, manifest),
  };

  const labelHits = BIAS_LEXICON.map((term) => {
    const needle = term.toLowerCase();
    const sampleLines: number[] = [];
    let count = 0;
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(needle)) {
        count++;
        if (sampleLines.length < 5) sampleLines.push(i + 1);
      }
    });
    return { term, count, sampleLines };
  }).filter((h) => h.count > 0);

  const hardFailures: string[] = [];
  if (friendlyDeaths.missing.length > 0) {
    hardFailures.push(
      `friendly death(s) absent from prompt: ${friendlyDeaths.missing.join(", ")}`,
    );
  }
  hardFailures.push(...checkPercentileMonotonicity(lines));
  hardFailures.push(...checkSameSecondHpConsistency(lines));
  hardFailures.push(...checkUnnecessaryNoteHpAgreement(lines));
  hardFailures.push(...checkWindowSpanConsistency(lines));
  hardFailures.push(...checkCooldownLedgerConsistency(lines));
  hardFailures.push(...checkSnapshotFactsConsistency(promptText));
  hardFailures.push(...checkSelfOnlyDefensiveClaims(lines));
  hardFailures.push(...checkDmgSpikeCcCoverConsistency(lines));
  hardFailures.push(...checkHealedThroughConsistency(lines));
  hardFailures.push(...checkBurstTargetHpConsistency(lines));
  hardFailures.push(...checkBurstTargetDamageParts(lines));
  hardFailures.push(...checkBurstAllyOverlap(lines));
  hardFailures.push(...checkVulnerableOwnerDamage(lines));
  hardFailures.push(...checkContestedCastRisk(lines));
  hardFailures.push(...checkEnemyCcKitLanded(lines));
  hardFailures.push(...checkKillWindowWithinRound(lines));
  hardFailures.push(...checkAuraEndWithinRound(lines));
  hardFailures.push(...checkNoEventAfterRoundEnd(lines));
  hardFailures.push(...checkUnpurgedWithinRound(lines));
  hardFailures.push(...checkCcEndCauseNotLogged(lines));
  hardFailures.push(...checkCcRefreshedNote(lines));
  hardFailures.push(...checkBehaviorPriorConsistency(lines));
  hardFailures.push(...checkBurstWindowRefConsistency(lines));
  hardFailures.push(...checkOffensiveWindowSpikeMarker(lines));
  hardFailures.push(...checkOffensiveWindowSpikeCredit(lines));
  hardFailures.push(...checkOffensiveWindowHeaderSpan(lines));
  hardFailures.push(...checkBurstLedgerSpellSpans(lines));
  hardFailures.push(...checkDmgSpikeListCap(lines));
  hardFailures.push(...checkSyncWindowRefConsistency(lines));
  hardFailures.push(...checkSyncWindowLockLength(lines));
  hardFailures.push(...checkSyncWindowReadyCdHolders(lines));
  hardFailures.push(...checkSyncWindowOwnerPart(lines));
  hardFailures.push(...checkCdWasteSharedCooldown(lines));
  hardFailures.push(...checkBacklashRefConsistency(lines));
  hardFailures.push(...checkKickPriorityRefConsistency(lines));
  hardFailures.push(...checkCdPriorRefConsistency(lines));
  hardFailures.push(...checkCdPriorCrossingHp(lines));
  hardFailures.push(...checkTeammateCrisisRefConsistency(lines));
  hardFailures.push(...checkCrisisHpStateConsistency(lines));
  hardFailures.push(...checkCrisisStateTickPresent(lines));
  hardFailures.push(...checkOutcomeRefConsistency(lines));
  hardFailures.push(...checkMenuTRenderGrid(lines));
  hardFailures.push(...checkCjkLeak(lines));
  hardFailures.push(...checkKickWaitedOutConsistency(lines));
  hardFailures.push(...checkCdHoardedOwnerFree(lines));
  hardFailures.push(...checkLegendCrossReferences(lines));
  hardFailures.push(...checkFindingsCountFollowsMenu(lines));
  hardFailures.push(...checkBareRosterPossessive(lines));
  hardFailures.push(...checkStayedInForcedMove(lines));
  hardFailures.push(...checkKickEatenRefusedForAnotherReason(lines));
  hardFailures.push(...checkKickEatenLowInsideLockout(lines));
  hardFailures.push(...checkKickEatenKickSilence(lines));
  hardFailures.push(...checkKickEatenRangeFacts(lines));
  hardFailures.push(...checkEnemyDefRefConsistency(lines));
  hardFailures.push(...checkEnemyDefSaveEffect(lines));
  hardFailures.push(...checkFormCooldownPressSpacing(lines));
  hardFailures.push(...checkEnemyDefEndNotLogged(lines));
  hardFailures.push(...checkSchoolLimitedImmuneLabel(lines));
  hardFailures.push(...checkKillAttemptUpSinceEndLogged(lines));
  hardFailures.push(...checkBrokeOutRefConsistency(lines));
  hardFailures.push(...checkFactsBlockIntegrity(lines));
  hardFailures.push(...checkPetCreditSide(lines));
  hardFailures.push(...checkHeaderHpPromise(lines));
  hardFailures.push(...checkDampeningStartConsistency(lines));
  hardFailures.push(...checkKillAttemptFraming(lines));
  hardFailures.push(...checkResNoChangeRowsPruned(lines));
  hardFailures.push(...checkDuringExternalConsistency(lines));
  hardFailures.push(...checkConseqHpStateConsistency(lines));
  hardFailures.push(...checkCcAvoidedLandedConsistency(lines));
  hardFailures.push(...checkCcAvoidedMissType(lines));
  hardFailures.push(...checkWarlockPurgeFollowsPet(lines));
  hardFailures.push(...checkDeathTrinketCcConsistency(lines));
  hardFailures.push(...checkPressedDuringControlNote(lines));
  hardFailures.push(...checkKitUnusedNote(lines));
  hardFailures.push(...checkBurstAnsweredBottomConsistency(lines));
  hardFailures.push(...checkBurstAnsweredBeforeDeath(lines));
  hardFailures.push(...checkBurstAnsweredControlSpan(lines));
  hardFailures.push(...checkFreeOfWindowConsistency(lines));
  hardFailures.push(...checkPeelOptionConsistency(lines));
  hardFailures.push(...checkCcBookmarkConsistency(lines));
  hardFailures.push(...checkCcUseStartedCounts(lines));
  hardFailures.push(...checkCastStoppedLines(lines));
  hardFailures.push(...checkKickEatenCancelsCoverCastStopped(lines));
  hardFailures.push(...checkJukedKickNotAfterInterrupt(lines));
  hardFailures.push(...checkCastStoppedWithinRound(lines));
  hardFailures.push(...checkCcNotLandedLines(lines));
  hardFailures.push(...checkForcedTrinketConsistency(lines));
  hardFailures.push(...checkBacklashSilenceFamily(lines));
  hardFailures.push(...checkTopSourcesOneEntryPerAbility(lines));
  hardFailures.push(...checkKillAttemptBracketEnd(lines));
  hardFailures.push(...checkKillAttemptAlreadyUpStated(lines));
  hardFailures.push(...checkKillAttemptOwnControlClause(lines));
  hardFailures.push(...checkNoWindowAcrossSpiritOfRedemption(lines));
  hardFailures.push(...checkNoWindowAcrossOwnWall(lines));
  hardFailures.push(...checkNoWindowAcrossOwnSave(lines));
  hardFailures.push(...checkKillTierWallOwnership(lines));
  hardFailures.push(...checkGuardianSpiritSaveClause(lines));
  hardFailures.push(...checkKarmaFedClause(lines));
  hardFailures.push(...checkResReturnAnnounced(lines));
  hardFailures.push(...checkStayedInHpConsistency(lines));

  return {
    ordinal: entry.ordinal,
    matchId: entry.matchId,
    spec: entry.spec,
    coverage,
    noise: {
      totalLines: lines.length,
      approxTokens: Math.round(promptText.length / 4),
      exactDuplicateRatio: duplicateRatio(lines, (l) => l),
      templateDuplicateRatio: duplicateRatio(lines, (l) =>
        l.replace(/\d+(\.\d+)?/g, "#"),
      ),
      resReadySpamLines: lines.filter((l) => RES_READY_SPAM.test(l)).length,
    },
    labelBias: {
      hits: labelHits,
      totalHits: labelHits.reduce((sum, h) => sum + h.count, 0),
    },
    hardFailures,
  };
}

function coveragePct(r: CoverageResult): string {
  if (r.total === 0) return "  n/a";
  return `${String(Math.round((r.present / r.total) * 100)).padStart(4)}%`;
}

export async function main(): Promise<void> {
  // 官方技能事实动态载入(2026-08-22):checkMatch 是同步的,里面的
  // canHelpAnotherUnit 在数据到位前按空表回答。门规必须在跑之前 await 聚合入口,
  // 否则「自保技能被要求救队友」这类检查会随载入时机漂移。
  await ensureAnalysisData();
  const baseDir = process.env.BASE_DIR ?? "";
  const strict = process.env.STRICT === "1";

  if (!baseDir) {
    console.error(
      "BASE_DIR environment variable is not set. Please set BASE_DIR or use --run with GLADLOG_EVAL_HOME.",
    );
    process.exit(1);
  }

  const indexFile = path.join(baseDir, "index.json");
  if (!(await fs.pathExists(indexFile))) {
    console.error(`No index.json under ${baseDir} — build a corpus first.`);
    process.exit(1);
  }
  const entries = (await fs.readJson(indexFile)) as IndexEntry[];
  const manifestsDir = path.join(baseDir, "manifests");
  if (!(await fs.pathExists(manifestsDir))) {
    console.error(
      `No manifests/ under ${baseDir}. Rebuild the corpus (the builder now writes manifests/NNN.json).`,
    );
    process.exit(1);
  }

  const results: MatchQuality[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const ordinalStr = String(entry.ordinal).padStart(3, "0");
    const promptPath = path.join(baseDir, entry.file);
    const manifestPath = path.join(manifestsDir, `${ordinalStr}.json`);
    if (
      !(await fs.pathExists(promptPath)) ||
      !(await fs.pathExists(manifestPath))
    ) {
      console.warn(`  ${ordinalStr}: prompt or manifest missing, skipping`);
      skipped++;
      continue;
    }
    const promptText = await fs.readFile(promptPath, "utf8");
    const manifest = (await fs.readJson(manifestPath)) as CoverageManifest;
    results.push(checkMatch(entry, promptText, manifest));
  }

  const reportPath = path.join(baseDir, "quality-report.json");
  await fs.writeJson(
    reportPath,
    {
      generatedAt: new Date().toISOString(),
      baseDir,
      skipped,
      results,
    },
    {
      spaces: 2,
    },
  );

  console.log(
    `\nPrompt quality check — ${results.length} match(es), ${skipped} skipped`,
  );
  console.log(
    "ord  deaths   cc    kicks  disp  trink  dupEx  dupTmpl  resSpam  biasHits",
  );
  for (const r of results) {
    console.log(
      [
        String(r.ordinal).padStart(3, "0"),
        coveragePct(r.coverage.friendlyDeaths),
        coveragePct(r.coverage.ccSpells),
        coveragePct(r.coverage.interruptSpells),
        coveragePct(r.coverage.dispels),
        coveragePct(r.coverage.trinketCasts),
        r.noise.exactDuplicateRatio.toFixed(3).padStart(6),
        r.noise.templateDuplicateRatio.toFixed(3).padStart(7),
        String(r.noise.resReadySpamLines).padStart(7),
        String(r.labelBias.totalHits).padStart(8),
      ].join("  "),
    );
  }

  const failures = results.filter((r) => r.hardFailures.length > 0);
  if (failures.length > 0) {
    console.log(`\nHARD FAILURES (${failures.length} match(es)):`);
    for (const f of failures) {
      for (const msg of f.hardFailures)
        console.log(
          `  ${String(f.ordinal).padStart(3, "0")} ${f.matchId}: ${msg}`,
        );
    }
  } else {
    console.log("\nNo hard failures (all friendly deaths present in prompts).");
  }
  console.log(`\nFull report: ${reportPath}`);

  if (strict && failures.length > 0) process.exit(1);
}
