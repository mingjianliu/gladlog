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
  droppableNoChangeResRows,
  ensureAnalysisData,
  GUARDIAN_SPIRIT_SAVE_WINDOW_S,
  NO_CREDITED_SPIKE_CLAUSE,
  PEAK_SPIKE_MARKERS,
  peakSpikePlacement,
  spikeWindowOverlapSeconds,
} from "@gladlog/analysis";
import { fmtFactNum } from "@gladlog/analysis/src/analysis/factFormat";
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
  PEEL_LOOKBACK_S,
  PEEL_MIN_USABLE_S,
} from "@gladlog/analysis/src/context/peelOptions";
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
import { lookupCdTriggerPrior } from "@gladlog/analysis/src/data/cdTriggerPrior";
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import { lookupKickPriorityPrior } from "@gladlog/analysis/src/data/kickPriorityPrior";
import { ATTEMPT_INTO_TRINKET_OUTCOME_REF } from "@gladlog/analysis/src/data/outcomeRefs";
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
  CC_LOGGED_END_NOTE_RE_SRC,
  CC_STILL_ON_AT_ROUND_END,
  ccLandedMatchWindowMs,
  DEATH_BREAKABLE_CC_LOOKBACK_S,
  DEATH_BREAKABLE_CC_MIN_S,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  canHelpAnotherUnit,
  isHpTroughWorthPrinting,
  isSpikeHealedThrough,
  isTickBelowTrough,
  PRESS_HP_LINE_TAGS,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  ENEMY_DEF_END_NOT_LOGGED,
  ENEMY_DEF_END_NOT_LOGGED_SLOT_RE,
  ENEMY_SAVE_EFFECT_BY_NAME,
  enemySaveEffectOfNote,
  SAVE_AURA_END_UNSEEN_NAMES,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { DURING_ABSORBED_TAG_RE_SRC } from "@gladlog/analysis/src/utils/externalDamage";
import { VULNERABLE_OWNER_DAMAGE_RE_SRC } from "@gladlog/analysis/src/utils/healerOffenseAnalysis";
import { STAYED_IN_NEAR_DEATH_PCT } from "@gladlog/analysis/src/utils/positionAnalysis";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
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
function checkSpells(promptText: string, events: NamedEvent[]): CoverageResult {
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

function checkTrinkets(
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
 * `scripts/pipelineFuzz.ts`'s invariant (same regex object).
 */
export const CJK_LEAK = /[一-鿿぀-ヿ가-힯]/;
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
/** `DAMPENING (2v2): first logged at 42% (0:11; the log prints no value before
 *  that), ended at …` — no value is stated before that second. */
const DAMPENING_FIRST_LOGGED_HEADER =
  /^DAMPENING \([^)]*\): first logged at (\d+)% \((\d+):(\d{2})[;)]/;
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
const DEATH_LINE = /^\d+:\d{2}\s+\[DEATH\]/;

/**
 * One prompt states one dampening start, and none the log does not print
 * (FT-T13, D10 + D11).
 *
 * The DAMPENING header opens in one of three ways, and each binds the
 * timeline:
 *
 * - `started at N%` (3v3 / Solo Shuffle). The `| dampening: M%` notes are the
 *   same reading of the same aura, and the stack only goes down after a death
 *   (`buildDampeningEvents`: a REMOVED_DOSE on the survivors). So before the
 *   second of the first `[DEATH]` line no note may read below the header.
 * - `first logged at N% (m:ss; …)` (2v2). No value is stated before the
 *   round's first logged stack (`getInitialDampening` — the extrapolated
 *   41 / 21 would be a number the log never prints). So no timeline line
 *   stamped before m:ss may carry a dampening number of any kind.
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

  // ── `first logged at` / no stack: nothing before the first logged second ──
  const unstated = lines
    .map((l, i) => {
      const t = l.trim();
      const first = t.match(DAMPENING_FIRST_LOGGED_HEADER);
      if (first)
        return {
          line: i + 1,
          untilS: Number(first[2]) * 60 + Number(first[3]),
          says: `first logged at ${first[1]}% (${first[2]}:${first[3]})`,
        };
      return DAMPENING_NO_STACK_HEADER.test(t)
        ? { line: i + 1, untilS: Infinity, says: "日志整局没有打出衰减层数" }
        : null;
    })
    .find((h) => h !== null);
  if (unstated) {
    lines.forEach((line, i) => {
      const s = secondOf(line);
      if (s === null || s >= unstated.untilS) return;
      const m = line.match(DAMPENING_NUMBER_ON_LINE);
      if (m)
        failures.push(
          `line ${i + 1}: DAMPENING 段首(第 ${unstated.line} 行)写 ${unstated.says},本行在那之前却带衰减数字「${m[0]}」—— ${line.trim().slice(0, 140)}`,
        );
    });
    return failures;
  }

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
    const s = secondOf(line);
    if (s === null || s >= firstDeathS) return;
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

/**
 * `[CC AVOIDED?] … did not land` ⟺ no landed `[CC ON TEAM]` line (30th
 * hardFailure class, GH #105, user "修" 2026-09-24). The producer
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
  const landed = new Map<string, number[]>();
  for (const line of lines) {
    const m = line.match(CC_ON_TEAM_LINE);
    if (!m) continue;
    const key = `${m[3]}\u0000${m[4]}`;
    const at = Number(m[1]) * 60 + Number(m[2]);
    landed.set(key, [...(landed.get(key) ?? []), at]);
  }
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(CC_AVOIDED_LINE);
    if (!m) return;
    const at = Number(m[1]) * 60 + Number(m[2]);
    const { beforeMs, afterMs } = ccLandedMatchWindowMs(m[4]!);
    const twin = (landed.get(`${m[3]}\u0000${m[4]}`) ?? []).find((t) => {
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
  let ownerId: string | null = null;
  let kit: string | null = null;
  lines.forEach((line, i) => {
    const u = line.match(UNIT_LEGEND_LINE);
    if (u?.[3] !== "log owner") return;
    ownerId = u[1]!;
    kit = lines[i + 1]?.match(OWNER_KIT_LINE)?.[1] ?? null;
  });
  // `Name [..]( [..])?` entries joined by ", "; a name may hold a comma
  const kitEntries = new Map<string, string>(
    ((kit as string | null) ?? "")
      .split(/\](?:, )/)
      .map((e) => [e.slice(0, e.indexOf(" [")), e] as [string, string]),
  );
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
      if (kit === null) continue;
      const entry = kitEntries.get(name);
      if (entry === undefined) fail(`${name} 不在录制者的 <cooldowns> 里`);
      else if (entry.includes("[PASSIVE"))
        fail(`${name} 在 <cooldowns> 里是 [PASSIVE](没有按键)`);
    }
  });
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
  const deaths = new Set<string>();
  const landed: Array<{
    at: number;
    target: string;
    spell: string;
    by: string;
  }> = [];
  for (const line of lines) {
    const d = line.match(FRIENDLY_DEATH_LINE);
    if (d) deaths.add(`${Number(d[1]) * 60 + Number(d[2])}\u0000${d[3]}`);
    const c = line.match(CC_ON_ENEMY_LINE);
    if (c)
      landed.push({
        at: Number(c[1]) * 60 + Number(c[2]),
        target: c[3]!,
        spell: c[4]!,
        by: c[5]!,
      });
  }
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
    const why: string[] = [];
    if (attacker !== target)
      why.push(`伤害占比写的是 ${attacker},不是控制目标`);
    if (trinketUnit && trinketUnit !== target)
      why.push(`饰品事实写的是 ${trinketUnit},不是控制目标`);
    if (atS !== from) why.push(`at ${fmtTime(atS)} 不是时段起点`);
    if (!deaths.has(`${death}\u0000${victim}`))
      why.push(`没有 ${victim} 在 ${fmtTime(death)} 的 [DEATH] 行`);
    if (from < death - PEEL_LOOKBACK_S || to > death || from > to)
      why.push(
        `可用时段 ${fmtTime(from)}–${fmtTime(to)} 不在死前 ${PEEL_LOOKBACK_S} 秒内`,
      );
    if (n < PEEL_MIN_USABLE_S || n > to - from + 1)
      why.push(`可用 ${n} 秒与门槛 ${PEEL_MIN_USABLE_S} 秒 / 时段长度不符`);
    if (dr === "Immune") why.push("递减为 Immune");
    const used = landed.find(
      (c) =>
        c.by === owner &&
        c.target === target &&
        c.spell === spell &&
        c.at >= death - PEEL_LOOKBACK_S &&
        c.at <= death,
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
 * M ≤ ⌈observed duration⌉ + 1 when the line carries one — the window can
 * never be longer than the aura was seen on the target.
 */
export function checkDuringExternalConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes("[ENEMY DEF]")) return;
    const at = line.indexOf("| during it: ");
    if (at < 0) return;
    const observed = line.match(ENEMY_DEF_EXTERNAL_DUR)?.[1];
    const maxM =
      observed !== undefined ? Math.ceil(Number(observed)) + 1 : null;
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
 * the whole cause and `KILL_ATTEMPT_SAVE_CLAUSE` reads each clause. */
const KILL_ATTEMPT_DEFENSIVE =
  /^\s*\[(\d+):(\d\d)–(\d+):(\d\d)\] on (\S+) — .*\| FAILED: ((?:popped |saved by external \(|self-saved \()[^|]+?)\s*$/;
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
    });
  }
  return defs;
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
      const hit = defs.some(
        (d) =>
          d.spell === spell &&
          (targetId === undefined ||
            d.onId === undefined ||
            d.onId === targetId) &&
          d.atS >= lo - ENEMY_DEF_PAIR_SLACK_S &&
          d.atS <= hi + ENEMY_DEF_PAIR_SLACK_S,
      );
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

/**
 * An `[ENEMY DEF]` line names a save by its EFFECT exactly when the ability
 * is an effect save (user ruling D8, 2026-10-10): Feign Death reads
 * `(absorb …)`, Nature's Guardian `(heal proc)`, Cheat Death / Cauterize
 * `(cheat-death proc)` — never `(immune …)`, the wording that made a shield
 * and three passives read as "cannot be hit" (605 new-season files: an enemy
 * player's direct damage landed inside 510 of 697 Feign Death "immunities",
 * 164 of 174 Nature's Guardian, 31 of 34 Cauterize, 7 of 10 Cheat Death).
 * And the reverse: no other ability's line carries an effect note. Names and
 * the note's reader are the producer's (`ENEMY_SAVE_EFFECT_BY_NAME`,
 * `enemySaveEffectOfNote`).
 */
export function checkEnemyDefSaveEffect(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    const m = ENEMY_DEF_LINE.exec(line);
    if (!m) return;
    const spell = m[3]!;
    // the text after the ability's name, from its parenthesis
    const after = line.slice(
      m.index + m[0].length - (m[0].endsWith("(") ? 1 : 0),
    );
    const expected = ENEMY_SAVE_EFFECT_BY_NAME.get(spell);
    const stated = enemySaveEffectOfNote(after);
    if (expected === stated) return;
    failures.push(
      expected
        ? `line ${i + 1}: [ENEMY DEF] prints ${spell} as something other than its effect (${expected}): "${line.trim().slice(0, 160)}"`
        : `line ${i + 1}: [ENEMY DEF] gives ${spell} an effect note (${stated}) it has no claim to: "${line.trim().slice(0, 160)}"`,
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

/**
 * KILL ATTEMPTS `broke out (X)` ⇒ an `[ENEMY TRINKET] … used X out of …` line
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

/** missed-sync-window (GH #13 resurrection, 2026-09-02): every rendered line
 * must quote exactly the bracket cell syncWindowPrior.ts holds, and the
 * quoted contrast must clear the same min-contrast door the producer used —
 * a line citing numbers that argue against its own accusation is a
 * hardFailure, not a style problem. */
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

function checkSyncWindowRefConsistency(lines: string[]): string[] {
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
        probes.push({
          type: type as CrisisHpFactType,
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
 */
const FREE_OF = /\bfree (\d+)s of (\d+)s\b/g;
export function checkFreeOfWindowConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(FREE_OF))
      if (Number(m[1]) > Number(m[2]))
        failures.push(
          `line ${i + 1}: free ${m[1]}s of ${m[2]}s —— 空闲秒数超过窗口渲染长度`,
        );
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
 *  - it is not on a second that unit's tick reads `dead`;
 *  - no `[STATE]` tick of that unit from the line's second to the bottom's
 *    second reads below it (`isTickBelowTrough`) — those seconds are inside
 *    the window for sure; the window's end is not printed, so later ticks
 *    are not adjudicated.
 */
const BURST_ANSWERED_BOTTOM =
  /^\s*(\d+):(\d{2})\s+\[BURST ANSWERED\].*;\s+(\S+) bottomed at (\d+)% at (\d+):(\d{2})/;
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
    if (stateAt.get(b)?.get(id) === "dead")
      failures.push(
        `line ${i + 1}: [BURST ANSWERED] 说 ${m[3]} 在 ${fmtTime(b)} 触底 ${pct}%,同秒 [STATE] 为 dead`,
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
 *  - no `[STATE]` tick of the log owner on a whole second inside the span
 *    reads below B (`isTickBelowTrough`). The span's first displayed second
 *    is left out: the window opens on a fractional instant, and the tick of
 *    that second can be a reading from before it;
 *  - the tag is true of the number it stands next to:
 *    `(HP stayed at or above N%)` needs N = `STAYED_IN_NEAR_DEATH_PCT` (the
 *    renderer's own constant) and B ≥ N; `(near-death — the stay was
 *    costly)` needs B < N (the verdict is decided on the whole-second
 *    minimum, and the trough is never above that).
 * Before the ruling this line had no gate: B was the lowest whole-second
 * reading and nothing re-read it. A line with no span (`m:ss [...]`) or no
 * HP clause is out of scope; so is a roster without a `log owner`.
 */
export function checkStayedInHpConsistency(lines: string[]): string[] {
  let ownerId: number | null = null;
  const ownerTick = new Map<number, number>();
  for (const line of lines) {
    const role = line.match(UNIT_ROLE_LINE);
    if (role && role[2] === "log owner") ownerId = Number(role[1]);
  }
  if (ownerId !== null)
    for (const line of lines) {
      const st = line.match(STATE_LINE);
      if (!st) continue;
      for (const tok of st[3]!.matchAll(STATE_TOKEN))
        if (Number(tok[1]) === ownerId && /^\d+$/.test(tok[2]!))
          ownerTick.set(Number(st[1]) * 60 + Number(st[2]), Number(tok[2]));
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
    for (let s = from + 1; s <= to; s++) {
      const tick = ownerTick.get(s);
      if (tick !== undefined && isTickBelowTrough(tick, B))
        failures.push(
          `${at} 窗口最低写 ${B}%,但 ${fmtTime(s)} 的 [STATE] 报 ${tick}%`,
        );
    }
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
  if (p.stateHp === "dead") return true;
  return p.trough
    ? isTickBelowTrough(p.stateHp, p.factHp)
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
 * fact, or `dead` (`crisisHpProbeMismatch`). The point readings — cd-hoarded,
 * crisis-no-response — keep exact equality.
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
 * Hard invariant (GH #70, 2026-09-24): an `[CONSEQ]` line's START HP is a
 * `[STATE]` grid reading (`gridHpPct`, the sampler behind every [STATE]
 * tick), and its LOW is a trough (`hpTroughInWindow`, the true minimum
 * inside the lockout / CC — FT-T03, user ruling 2026-10-10, D7), so wherever
 * the timeline also printed a tick:
 *  - `A% → low B% at m:ss`: the tick at the line's second reads A; the tick
 *    at m:ss does not read below B (it no longer has to EQUAL B — the tick
 *    is the start of that second, the low the lowest sample inside it); and
 *    no tick of that unit inside the span reads below B (`isTickBelowTrough`);
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
    const drops = [...body.matchAll(CONSEQ_DROP)];
    for (const d of drops) {
      const id = Number(d[1]);
      const a = Number(d[2]);
      const b = Number(d[3]);
      const lowSec = Number(d[4]) * 60 + Number(d[5]);
      const t0 = tick(start, side, id);
      if (t0 !== undefined && t0 !== a)
        failures.push(`${where} 起点写 ${id} 为 ${a}%,同秒 [STATE] 报 ${t0}%`);
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
      for (let s = start; s <= lastSure; s++) {
        const v = tick(s, side, id);
        if (v !== undefined && isTickBelowTrough(v, b))
          failures.push(
            `${where} 低点写 ${id} ${b}%,但 ${fmtMmSs(s)} 的 [STATE] 报 ${v}%`,
          );
      }
    }
    // hp-state F-C1: "no surviving teammate dropped" is the same claim for the
    // living (the dead ids carry no numeric tick and are skipped)
    if (drops.length === 0 && /^no (surviving )?teammate dropped/.test(body)) {
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
    const spellId = DEFENSIVE_ID_BY_NAME.get(spellName.trim());
    if (!spellId) return; // 认不出的技能不报
    if (canHelpAnotherUnit(spellId)) return;
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
  hardFailures.push(...checkBehaviorPriorConsistency(lines));
  hardFailures.push(...checkBurstWindowRefConsistency(lines));
  hardFailures.push(...checkOffensiveWindowSpikeMarker(lines));
  hardFailures.push(...checkOffensiveWindowSpikeCredit(lines));
  hardFailures.push(...checkSyncWindowRefConsistency(lines));
  hardFailures.push(...checkBacklashRefConsistency(lines));
  hardFailures.push(...checkKickPriorityRefConsistency(lines));
  hardFailures.push(...checkCdPriorRefConsistency(lines));
  hardFailures.push(...checkTeammateCrisisRefConsistency(lines));
  hardFailures.push(...checkCrisisHpStateConsistency(lines));
  hardFailures.push(...checkCrisisStateTickPresent(lines));
  hardFailures.push(...checkOutcomeRefConsistency(lines));
  hardFailures.push(...checkMenuTRenderGrid(lines));
  hardFailures.push(...checkCjkLeak(lines));
  hardFailures.push(...checkKickWaitedOutConsistency(lines));
  hardFailures.push(...checkEnemyDefRefConsistency(lines));
  hardFailures.push(...checkEnemyDefSaveEffect(lines));
  hardFailures.push(...checkEnemyDefEndNotLogged(lines));
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
  hardFailures.push(...checkDeathTrinketCcConsistency(lines));
  hardFailures.push(...checkPressedDuringControlNote(lines));
  hardFailures.push(...checkBurstAnsweredBottomConsistency(lines));
  hardFailures.push(...checkBurstAnsweredBeforeDeath(lines));
  hardFailures.push(...checkFreeOfWindowConsistency(lines));
  hardFailures.push(...checkPeelOptionConsistency(lines));
  hardFailures.push(...checkCcBookmarkConsistency(lines));
  hardFailures.push(...checkForcedTrinketConsistency(lines));
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
