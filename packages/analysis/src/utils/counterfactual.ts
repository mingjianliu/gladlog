import { ICombatUnit } from "@gladlog/parser-compat";

import { IMitigationEntry, MITIGATION_TABLE } from "../data/mitigationData";
import { getEnglishSpellName } from "../data/spellEffectData";
import spellIdLists from "../data/spellIdLists";
import { absorbContributionsInWindow } from "./absorbShields";
import { buildAuraIntervals, IAuraInterval } from "./auraIntervals";
import { binarySearchClosest } from "./binarySearch";
import { IPlayerCCTrinketSummary } from "./ccTrinketAnalysis";
import {
  cdAvailableAt,
  HP_SAMPLE_RADIUS_MS,
  IMajorCooldownInfo,
} from "./cooldowns";
import {
  IMissedExternal,
  wasLockedOutThroughWindow,
} from "./deathOutcomeAnalysis";

/**
 * counterfactual.ts — mitigation counterfactual accounting (#17b): the
 * single-source three-tier predicate plus the arithmetic of three shapes.
 *
 * Three independent measures, computed entry by entry, with no modelling of
 * stacking within the same window:
 *  - A (computeMitigationAudit): entry-by-entry accounting of whitelisted
 *    mitigation **already active** inside the death window — arith entries
 *    back out the blocked amount from the observed damage; immunity (pct=100)
 *    is never back-computed, it only reports coverage duration and the damage
 *    observed during it; mechanic/off-table entries (transfer, reflect, …) get
 *    no invented numbers; positional (Darkness) is not modelled this round and
 *    is skipped without emitting a row.
 *  - B (computeMissedExternalCounterfactuals): a teammate external that was
 *    **available but not given**, on the discount measure (saved = damage of
 *    matching schools in the window × pct%), reported only when "clearly would
 *    have survived".
 *  - Narrow gate (computeUnusedSelfCounterfactuals): the player's own
 *    available-but-unused cooldown, same discount measure, silent for the whole
 *    window when CC-locked; reported only when "clearly would have survived".
 *
 * Single-source predicate discipline (gate predicates are the spec): HP
 * sampling always reuses `HP_SAMPLE_RADIUS_MS` (the single-source constant in
 * cooldowns.ts), the whitelist is always derived from `spellIdLists`, and the
 * mitigation table is always consumed from `MITIGATION_TABLE` — this file must
 * not redefine any existing constant or table.
 */

export const COUNTERFACTUAL_WINDOW_S = 10;
/** Margin above the decisive line: 15% of maxHp. */
export const DECISIVE_MARGIN_PCT = 15;
/** Lower bound of the marginal tier: 0.5 × net HP lost. */
export const MARGINAL_FLOOR_RATIO = 0.5;

export type CounterfactualTier = "decisive" | "marginal" | "fatal";

/**
 * Single-source three-tier predicate (same measure as the quantified report).
 * savedAmount/netDamage/maxHp share one unit (absolute HP values).
 *   decisive: savedAmount > netDamage + DECISIVE_MARGIN_PCT% × maxHp
 *   marginal: savedAmount ∈ (MARGINAL_FLOOR_RATIO × netDamage, decisive line]
 *   fatal:    everything else
 */
export function counterfactualTier(
  savedAmount: number,
  netDamage: number,
  maxHp: number,
): CounterfactualTier {
  const decisiveLine = netDamage + (DECISIVE_MARGIN_PCT / 100) * maxHp;
  if (savedAmount > decisiveLine) return "decisive";
  if (savedAmount > MARGINAL_FLOOR_RATIO * netDamage) return "marginal";
  return "fatal";
}

// Single-source whitelist derivation: big personals ∪ externals. Deliberately
// not externalOrBigDefensiveSpellIds — that list also contains team-buff ids
// (64843/740/200183, …) and serves the "who can double as a healer" judgement
// in cooldowns.ts, which is a different semantic from the mitigation
// counterfactual whitelist (walls that actually block damage or grant immunity).
const WHITELIST_IDS: ReadonlySet<string> = new Set<string>([
  ...spellIdLists.bigDefensiveSpellIds,
  ...spellIdLists.externalDefensiveSpellIds,
  // Attribution-only mitigation (stances, ally-maintained buffs) — see the
  // list's own comment for why it is separate from the other two.
  ...spellIdLists.attributedMitigationSpellIds,
]);

/**
 * Direct absolute-HP sampling: `getUnitHpAtTimestamp` returns a percentage and
 * the counterfactual arithmetic needs absolute values, so it cannot be reused —
 * but the sampling logic (nearest advancedAction, source validation, radius
 * gate) is identical to it, and the sampling radius reuses the very same
 * `HP_SAMPLE_RADIUS_MS`; no second radius constant is invented.
 */
function absHpAt(
  unit: ICombatUnit,
  tMs: number,
): { hp: number; maxHp: number } | null {
  const closest = binarySearchClosest(
    unit.advancedActions,
    tMs,
    (a) => a.logLine.timestamp,
  );
  if (!closest) return null;
  if (closest.advancedActorId !== unit.id) return null;
  if (closest.advancedActorMaxHp <= 0) return null;
  if (Math.abs(closest.logLine.timestamp - tMs) > HP_SAMPLE_RADIUS_MS) {
    return null;
  }
  return {
    hp: closest.advancedActorCurrentHp,
    maxHp: closest.advancedActorMaxHp,
  };
}

/**
 * Single source for net HP lost / max HP: the absolute HP at the window start
 * IS the net HP lost (HP → 0 at death, and healing is already netted into the
 * HP curve, so no separate healing subtraction — same measure as the quantified
 * report); maxHp is sampled at the death instant, falling back to the window
 * start sample (both missing → null, and rows/hits each take the "omit rather
 * than guess" path instead of extrapolating a number). All three shapes (A / B /
 * narrow gate) share this one computation, so all three read the same net HP
 * lost / max HP for the same death.
 */
function windowNetDamageAndMaxHp(
  victim: ICombatUnit,
  matchStartMs: number,
  deathS: number,
): { netDamage: number | null; maxHp: number | null } {
  const windowStartMs = matchStartMs + windowStartSecondsOf(deathS) * 1000;
  const deathMs = matchStartMs + deathS * 1000;
  const startSample = absHpAt(victim, windowStartMs);
  const deathSample = absHpAt(victim, deathMs);
  return {
    netDamage: startSample ? startSample.hp : null,
    maxHp: deathSample
      ? deathSample.maxHp
      : startSample
        ? startSample.maxHp
        : null,
  };
}

/**
 * Total observed damage in the window matching schoolMask (absolute value;
 * `effectiveAmount` is already the post-mitigation amount actually taken).
 */
export function windowDamage(
  unit: ICombatUnit,
  fromS: number,
  toS: number,
  schoolMask: number,
  matchStartMs: number,
): number {
  const fromMs = matchStartMs + fromS * 1000;
  const toMs = matchStartMs + toS * 1000;
  let sum = 0;
  for (const d of unit.damageIn) {
    const ts = d.logLine.timestamp;
    if (ts < fromMs || ts > toMs) continue;
    const school = Number.parseInt(d.spellSchoolId ?? "0x0", 16);
    if ((school & schoolMask) === 0) continue;
    sum += Math.abs(d.effectiveAmount);
  }
  return sum;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Death-window start (relative seconds), clamped to 0: early in a match
 * (deathS < WINDOW_S) `deathS - COUNTERFACTUAL_WINDOW_S` goes negative, and
 * without the clamp the HP sample target lands at least (WINDOW_S - deathS)
 * seconds before matchStartMs — beyond `HP_SAMPLE_RADIUS_MS` (3s) it is always
 * null, so early deaths silently lost all counterfactual output (found by an
 * agy flash review, 2026-07-30). All four window boundaries (the netDamage /
 * maxHp sampling plus the windowDamage call in each of the three functions)
 * must use this same clamped value — no per-site clamping.
 */
function windowStartSecondsOf(deathS: number): number {
  return Math.max(0, deathS - COUNTERFACTUAL_WINDOW_S);
}

export interface IMitigationAuditRow {
  spellId: string;
  spellName: string;
  kind: "arith" | "immunity" | "mechanic" | "absorb";
  /** Seconds of (active interval ∩ death window), one decimal. */
  activeOverlapS: number;
  /** kind=arith: blocked amount (absolute) and its share of maxHp. */
  blockedAmount?: number;
  blockedPctMaxHp?: number;
  /** kind=immunity: damage observed during the immunity coverage (should be ≈0; reported as-is). */
  damageTakenDuringImmunity?: number;
  /** kind=absorb: damage the shield actually ate inside the window, i.e. the
   * effective HP it was worth. Measured from SPELL_ABSORBED, so a shield that
   * expired unconsumed contributes nothing — see absorbShields.ts. */
  absorbedAmount?: number;
  absorbedPctMaxHp?: number;
}

/** A whitelisted aura interval clipped to the death window (both ends in
 * relative seconds; `overlapTo > overlapFrom` is guaranteed). */
export interface IWindowedAuraInterval extends IAuraInterval {
  overlapFrom: number;
  overlapTo: number;
}

/**
 * The one predicate for "which whitelisted mitigation auras were active on
 * the victim inside the death window": shape A iterates exactly this list, and
 * `packages/eval/scripts/mitigationStackScan.ts` (BACKLOG #41 (6) — does the
 * un-modelled stacking between entries matter?) measures overlap on the same
 * list, so the probe can never disagree with the product about which auras
 * count.
 */
export function whitelistedIntervalsInDeathWindow(
  victim: ICombatUnit,
  combat: { startTime: number; endTime: number },
  deathS: number,
): IWindowedAuraInterval[] {
  const windowStartS = windowStartSecondsOf(deathS);
  const out: IWindowedAuraInterval[] = [];
  for (const iv of buildAuraIntervals(victim, combat)) {
    if (!WHITELIST_IDS.has(iv.spellId)) continue;
    const overlapFrom = Math.max(iv.fromS, windowStartS);
    const overlapTo = Math.min(iv.toS, deathS);
    if (overlapTo <= overlapFrom) continue; // no overlap, emit no row
    out.push({ ...iv, overlapFrom, overlapTo });
  }
  return out;
}

/**
 * Shape A: entry-by-entry accounting of whitelisted mitigation active on the
 * victim inside the death window (independent measure; interaction between
 * multiple entries is not modelled).
 */
export function computeMitigationAudit(
  victim: ICombatUnit,
  combat: {
    startTime: number;
    endTime: number;
    units: Record<string, ICombatUnit>;
  },
  deathS: number,
): {
  rows: IMitigationAuditRow[];
  netDamage: number | null;
  maxHp: number | null;
} {
  const { netDamage, maxHp } = windowNetDamageAndMaxHp(
    victim,
    combat.startTime,
    deathS,
  );

  const rows: IMitigationAuditRow[] = [];

  for (const iv of whitelistedIntervalsInDeathWindow(victim, combat, deathS)) {
    const { overlapFrom, overlapTo } = iv;
    const activeOverlapS = round1(overlapTo - overlapFrom);
    const spellName = getEnglishSpellName(iv.spellId, iv.spellName);
    const entry: IMitigationEntry | undefined = MITIGATION_TABLE[iv.spellId];

    if (!entry) {
      // Off-table (including NO_MITIGATION_IDS; the two are mutually
      // exclusive). Absorb shields are the one off-table class that CAN be
      // measured rather than guessed: the log records what each shield actually
      // ate. Everything else stays "mechanic" and invents no numbers.
      const absorbed = absorbContributionsInWindow(
        victim,
        combat.startTime + overlapFrom * 1000,
        combat.startTime + overlapTo * 1000,
      ).find((c) => c.spellId === iv.spellId);
      if (absorbed) {
        rows.push({
          spellId: iv.spellId,
          spellName,
          kind: "absorb",
          activeOverlapS,
          absorbedAmount: absorbed.absorbedAmount,
          absorbedPctMaxHp:
            maxHp !== null && maxHp > 0
              ? round1((absorbed.absorbedAmount / maxHp) * 100)
              : undefined,
        });
        continue;
      }
      rows.push({
        spellId: iv.spellId,
        spellName,
        kind: "mechanic",
        activeOverlapS,
      });
      continue;
    }
    if (entry.positional) continue; // Darkness class: positional conditions are not modelled this round, skip without a row

    const observed = windowDamage(
      victim,
      overlapFrom,
      overlapTo,
      entry.schoolMask,
      combat.startTime,
    );

    if (entry.pct >= 100) {
      // Immunity: the divisor is zero — never back-compute; report the coverage
      // seconds and the damage observed during it, as-is.
      rows.push({
        spellId: iv.spellId,
        spellName,
        kind: "immunity",
        activeOverlapS,
        damageTakenDuringImmunity: observed,
      });
      continue;
    }

    const blockedAmount = Math.round(
      (observed * entry.pct) / (100 - entry.pct),
    );
    rows.push({
      spellId: iv.spellId,
      spellName,
      kind: "arith",
      activeOverlapS,
      blockedAmount,
      blockedPctMaxHp:
        maxHp !== null && maxHp > 0
          ? round1((blockedAmount / maxHp) * 100)
          : undefined,
    });
  }

  return { rows, netDamage, maxHp };
}

export interface ICounterfactualHit {
  spellId: string;
  spellName: string;
  source: "unused-self" | "missed-external";
  casterName?: string; // for missed-external
  savedAmount: number;
  savedPctMaxHp: number;
  tier: CounterfactualTier;
}

/**
 * The discount measure shared by B and the narrow gate: the candidate was
 * **not active**, so no back-computation (that is exclusive to shape A) —
 * discount the observed damage of matching schools in the window by the table's
 * pct. Only tier=decisive produces a hit; marginal/fatal stay silent (honesty
 * discipline: do not state what is uncertain).
 */
function decisiveHitFor(
  spellId: string,
  rawSpellName: string,
  source: ICounterfactualHit["source"],
  casterName: string | undefined,
  saved: number,
  netDamage: number | null,
  maxHp: number | null,
): ICounterfactualHit | null {
  if (netDamage === null || maxHp === null || maxHp <= 0) return null;
  const tier = counterfactualTier(saved, netDamage, maxHp);
  if (tier !== "decisive") return null;
  return {
    spellId,
    spellName: getEnglishSpellName(spellId, rawSpellName),
    source,
    casterName,
    savedAmount: saved,
    savedPctMaxHp: round1((saved / maxHp) * 100),
    tier,
  };
}

/**
 * Narrow gate: the player's own available-but-unused cooldown (in the table and
 * non-positional; returns empty when CC-locked). Returns decisive hits only.
 */
export function computeUnusedSelfCounterfactuals(
  victim: ICombatUnit,
  victimCds: IMajorCooldownInfo[],
  victimCcSummary: Pick<IPlayerCCTrinketSummary, "playerName" | "ccInstances">,
  combat: { startTime: number; units: Record<string, ICombatUnit> },
  deathS: number,
): ICounterfactualHit[] {
  if (wasLockedOutThroughWindow(victimCcSummary, deathS)) return [];

  const windowStartS = windowStartSecondsOf(deathS);
  const { netDamage, maxHp } = windowNetDamageAndMaxHp(
    victim,
    combat.startTime,
    deathS,
  );

  const hits: ICounterfactualHit[] = [];
  for (const cd of victimCds) {
    if (!cdAvailableAt(cd, deathS)) continue;
    const entry = MITIGATION_TABLE[cd.spellId];
    if (!entry || entry.positional) continue;

    const observed = windowDamage(
      victim,
      windowStartS,
      deathS,
      entry.schoolMask,
      combat.startTime,
    );
    const saved = Math.round((observed * entry.pct) / 100);
    const hit = decisiveHitFor(
      cd.spellId,
      cd.spellName,
      "unused-self",
      undefined,
      saved,
      netDamage,
      maxHp,
    );
    if (hit) hits.push(hit);
  }
  return hits;
}

/** Shape B: missedExternals × table → three tiers; returns decisive only. */
export function computeMissedExternalCounterfactuals(
  missedExternals: IMissedExternal[],
  victim: ICombatUnit,
  combat: { startTime: number },
  deathS: number,
): ICounterfactualHit[] {
  const windowStartS = windowStartSecondsOf(deathS);
  const { netDamage, maxHp } = windowNetDamageAndMaxHp(
    victim,
    combat.startTime,
    deathS,
  );

  const hits: ICounterfactualHit[] = [];
  for (const m of missedExternals) {
    const entry = MITIGATION_TABLE[m.spellId];
    if (!entry || entry.positional) continue; // skip off-table / positional

    const observed = windowDamage(
      victim,
      windowStartS,
      deathS,
      entry.schoolMask,
      combat.startTime,
    );
    const saved = Math.round((observed * entry.pct) / 100);
    const hit = decisiveHitFor(
      m.spellId,
      m.spellName,
      "missed-external",
      m.casterName,
      saved,
      netDamage,
      maxHp,
    );
    if (hit) hits.push(hit);
  }
  return hits;
}
