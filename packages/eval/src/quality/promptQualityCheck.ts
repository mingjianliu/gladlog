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
 *   npm run -w @wowarenalogs/tools start:promptQualityCheck
 *   BASE_DIR=packages/tools/local-batch/healer-eval/ab-test/treatment \
 *     npm run -w @wowarenalogs/tools start:promptQualityCheck
 *   STRICT=1 …   # exit 1 if any friendly death is missing from its prompt
 *
 * Expects under BASE_DIR: prompts/, manifests/, index.json.
 */

import { ensureAnalysisData } from "@gladlog/analysis";
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
import { ATTEMPT_INTO_TRINKET_OUTCOME_REF } from "@gladlog/analysis/src/data/outcomeRefs";
import {
  lookupSyncWindowPrior,
  SYNC_REF_MIN_CONTRAST_PP,
  syncRefClearsMinContrast,
  syncRefContrastPp,
} from "@gladlog/analysis/src/data/syncWindowPrior";
import { canHelpAnotherUnit } from "@gladlog/analysis/src/utils/cooldowns";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
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
    // criterion.
    const isSpike = line.includes("[DMG SPIKE]");
    const m = isSpike ? line.match(SPIKE_HP) : line.match(INLINE_HP);
    if (!m) return;
    const t = Number(m[1]) * 60 + Number(m[2]);
    const stateHp = stateAt.get(t)?.get(m[3]);
    if (stateHp === undefined) return;
    const claimed = Number(m[4]);
    const delta = Math.abs(stateHp - claimed);
    if (delta > HP_AGREEMENT_TOLERANCE_PP) {
      violations.push(
        `line ${i + 1}: ${m[1]}:${m[2]} ${m[3]} — ${isSpike ? "[DMG SPIKE]" : "行内嵌"} 报 ${claimed}% 而同秒 [STATE] 报 ${stateHp}%(Δ${delta}pp)`,
      );
    }
  });
  return violations;
}

// "2:57–3:15 (19s)" — window endpoints + labelled duration
const WINDOW_SPAN = /(\d+):(\d+)–(\d+):(\d+)\s*\((\d+)s\)/g;

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
          l.includes(spell),
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
export function checkHealedThroughConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("[DMG SPIKE]")) continue;
    const m = line.match(/\((\d+)% -> (\d+)% HP/);
    if (!m) continue;
    const delta = Number(m[2]) - Number(m[1]);
    const hasWord = line.includes("\u2014 healed through");
    if (hasWord && delta < 0)
      failures.push(
        `line ${i + 1}: [DMG SPIKE] 标注「healed through」但同行 HP ${m[1]}% -> ${m[2]}%(Δ${delta} < 0)`,
      );
    else if (!hasWord && delta >= 0)
      failures.push(
        `line ${i + 1}: [DMG SPIKE] 同行 HP ${m[1]}% -> ${m[2]}%(Δ${delta} ≥ 0)却没有「healed through」标注`,
      );
  }
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
    if (!line.includes("[CD PRIOR]")) continue;
    const ref = line.match(/\[ref=([^\]]+)\]\s*$/);
    const nums = line.match(/median lowest-friendly HP of (\d+)% \(n=(\d+)\)/);
    if (!ref || !nums) {
      failures.push(`line ${i + 1}: [CD PRIOR] 行缺 [ref=…] 或参照数字,无法核对语料参照`);
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
      failures.push(`line ${i + 1}: [CD PRIOR] 渲染 n=${nums[2]} ≠ 表 n=${found.n}`);
    const saysSpecWide = line.includes("(spec-wide) cohort");
    if (saysSpecWide !== (tree === "*"))
      failures.push(
        `line ${i + 1}: [CD PRIOR] 「spec-wide」措辞与 cellKey 的树 ${tree} 不一致`,
      );
  }
  return failures;
}

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
 * start, so it renders (and is checked at) its own `pressuredHpT`. */
const CRISIS_HP_FACT_KEYS = {
  "cd-hoarded": { unit: "crisisUnit", hp: "crisisHpPct", at: "t" },
  "crisis-no-response": { unit: "unit", hp: "hpPct", at: "t" },
  "slow-defensive-response": {
    unit: "pressured",
    hp: "pressuredHpPct",
    at: "pressuredHpT",
  },
} as const;

export interface CrisisHpStateProbe {
  type: keyof typeof CRISIS_HP_FACT_KEYS;
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
    for (const [type, keys] of Object.entries(CRISIS_HP_FACT_KEYS)) {
      if (!line.includes(`type=${type}`)) continue;
      const m = line.match(/facts=\{(.*)\}\s*$/);
      if (!m) continue;
      const f = parseFactsBlock(m[1]!);
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
        type: type as keyof typeof CRISIS_HP_FACT_KEYS,
        lineIndex: i,
        tSecond,
        unitName,
        unitId,
        factHp: hp,
        stateHp: tick === undefined || tick === "ghost" ? null : tick,
      });
    }
  });
  return probes;
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
 */
export function checkCrisisHpStateConsistency(lines: string[]): string[] {
  const failures: string[] = [];
  for (const p of crisisHpStateProbes(lines)) {
    if (p.stateHp === null) continue;
    if (p.stateHp === p.factHp) continue;
    failures.push(
      `line ${p.lineIndex + 1}: ${p.type} 声称 ${p.unitName} 在 ${fmtMmSs(p.tSecond)} 为 ${p.factHp}%,` +
        `而同秒 [STATE] 报 ${p.stateHp === "dead" ? "dead" : `${p.stateHp}%`}`,
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
export interface MenuTRenderGridSpec {
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

export function duplicateRatio(
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
  hardFailures.push(...checkWindowSpanConsistency(lines));
  hardFailures.push(...checkCooldownLedgerConsistency(lines));
  hardFailures.push(...checkSnapshotFactsConsistency(promptText));
  hardFailures.push(...checkSelfOnlyDefensiveClaims(lines));
  hardFailures.push(...checkDmgSpikeCcCoverConsistency(lines));
  hardFailures.push(...checkHealedThroughConsistency(lines));
  hardFailures.push(...checkBehaviorPriorConsistency(lines));
  hardFailures.push(...checkBurstWindowRefConsistency(lines));
  hardFailures.push(...checkSyncWindowRefConsistency(lines));
  hardFailures.push(...checkCdPriorRefConsistency(lines));
  hardFailures.push(...checkCrisisHpStateConsistency(lines));
  hardFailures.push(...checkOutcomeRefConsistency(lines));
  hardFailures.push(...checkMenuTRenderGrid(lines));

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
