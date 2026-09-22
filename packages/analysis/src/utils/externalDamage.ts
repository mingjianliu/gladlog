/**
 * Damage kept on a target while an ALLY-APPLIED external mitigation is on it
 * — tutorial rule 171 ("swap off a target the moment it receives an external
 * defensive") and the sustained mirror of `burst-into-mitigation`. GH #91,
 * split from #85 by user ruling 2026-09-12 (one local observation, no
 * general primary-target timeline); value gate passed by the user
 * 2026-09-22 ("先通过了看看").
 *
 * This is THE shared predicate for the fact: the timeline's `[ENEMY DEF]`
 * external line carries it as a `| during it:` annotation (the line whose
 * primary fact is the application owns it — the GH #99 item 3 ownership
 * rule), the `burst-into-mitigation` candidate attaches it as a fact when
 * owner, target and this specific application coincide, the eval gate
 * `checkDuringExternalConsistency` re-parses the rendered annotation, and
 * `externalDamageExampleGen.ts` reports with it.
 *
 * Measurement contract (pre-registered on GH #91, codex R1 — change the
 * issue before changing this):
 *   eligible aura   = observed (no inferred endpoint), ally-applied
 *                     (source ≠ target), non-positional, all-school (0x7f),
 *                     percentage (pct < 100) entry of MITIGATION_TABLE;
 *                     NO_MITIGATION_IDS, shields, immunities excluded — on the
 *                     local library only Pain Suppression, Time Dilation and
 *                     Ironbark pass (400 rounds, 752 observations)
 *   qualifying ally = landed a same-target DIRECT hit in the PRE_HIT_S before
 *                     the application (a sampling choice, not a reaction
 *                     standard)
 *   window W        = [ceil(apply), floor(remove)) on the render grid,
 *                     truncated at either combatant's death / round end
 *   N = damage on the target inside W · D = damage on all enemy players
 *   inside W · X = 100·N/D (undefined when D = 0) · direct / periodic
 *   reported separately · K/M = 1 s bins with damage / |W| · G = longest
 *   empty gap · legacy damage is NEGATIVE, SPELL_ABSORBED rows POSITIVE and
 *   excluded from N and D · pets already merged into the owner by
 *   mergePetEvents
 *   absorbed (2026-09-22 amendment, recorded on the issue): what the target's
 *   shields ate from this ally inside W — read from the TARGET's victim-keyed
 *   `absorbsIn` (attacker = the ally; the attacker's own damageOut only sees
 *   a fully absorbed hit as effective ≈ 0, or a positive residual, never the
 *   absorbed amount) — is reported SEPARATELY as `(+Ak absorbed)`, and a
 *   second with an absorbed hit counts in K. N / D / X are unchanged. Without
 *   it a Feral Druid hitting a shielded Havoc DH under Time Dilation rendered
 *   as `0k on target · damage in 6 of 8 s` (match 83bdf41e), which reads as
 *   a contradiction; the shape recurs under Touch of Karma.
 *
 * No accusatory verb anywhere: the line states numbers, the model decides.
 */
import { type ICombatUnit,LogEvent } from "@gladlog/parser-compat";

import { MITIGATION_TABLE, NO_MITIGATION_IDS } from "../data/mitigationData";
import { getEnglishSpellName } from "../data/spellEffectData";
import { buildAuraIntervals, type IAuraInterval } from "./auraIntervals";

/** Seconds before the application in which a direct hit makes an ally "qualifying". */
export const EXTERNAL_DAMAGE_PRE_HIT_S = 3;
/** K/M at or above this = the ally kept hitting through the external ("continues"). */
export const EXTERNAL_DAMAGE_CONTINUES_SHARE = 0.5;
/**
 * A hit counts as "a second with damage" (K) only at or above this effective
 * amount. A fully absorbed hit leaves an effective residual of 0–1 in the
 * attacker's damageOut; when the absorb cannot be matched back to the ally
 * (a pet's hit is merged into the owner, but the victim's absorb names the
 * pet as attacker) that residual would otherwise render as `0k on target ·
 * damage in 1 of 8 s`. N still sums every hit.
 */
export const EXTERNAL_DAMAGE_BIN_MIN_HIT = 100;

const DIRECT_EVENTS = new Set<string>([
  LogEvent.SPELL_DAMAGE,
  LogEvent.SWING_DAMAGE,
  LogEvent.RANGE_DAMAGE,
]);
const PERIODIC_EVENT = LogEvent.SPELL_PERIODIC_DAMAGE as string;
const ALL_SCHOOLS = 0x7f;

/** Contract eligibility for the aura itself (ally-applied is checked per interval). */
export function eligibleExternalMitigation(
  spellId: string,
): { pct: number } | null {
  if (NO_MITIGATION_IDS.has(spellId)) return null;
  const e = MITIGATION_TABLE[spellId];
  if (!e) return null;
  if (e.positional) return null;
  if (e.pct >= 100) return null; // immunity
  if ((e.schoolMask & ALL_SCHOOLS) !== ALL_SCHOOLS) return null; // school-limited
  return { pct: e.pct };
}

export type ExternalDamageKind = "continues" | "stops" | "periodic-only" | "empty";

export interface IExternalDamageObservation {
  allyId: string;
  allyName: string;
  targetId: string;
  targetName: string;
  spellId: string;
  /** English mitigation name. */
  mitName: string;
  mitPct: number;
  /** Who applied the external (log source name). */
  srcName: string;
  applyS: number;
  removeS: number;
  /** Window bounds on the render grid: [wFrom, wTo). */
  wFrom: number;
  wTo: number;
  /** |W| in whole seconds. */
  M: number;
  /** 1 s bins inside W with damage on the target. */
  K: number;
  /** Longest run of empty bins. */
  G: number;
  nDirect: number;
  nPeriodic: number;
  /** The ally's damage on ALL enemy players inside W. */
  dAll: number;
  /** SPELL_ABSORBED amounts the ally put on the target inside W (not in N or D). */
  absorbed: number;
  /** 100·(nDirect+nPeriodic)/dAll, null when dAll = 0. */
  X: number | null;
  /** Direct damage on the target in the PRE_HIT_S before the application. */
  preDirect: number;
  kind: ExternalDamageKind;
}

export function classifyExternalDamage(
  o: Pick<IExternalDamageObservation, "nDirect" | "nPeriodic" | "K" | "M">,
): ExternalDamageKind {
  if (o.nDirect === 0 && o.nPeriodic === 0) return "empty";
  if (o.nDirect === 0) return "periodic-only";
  return o.K / Math.max(o.M, 1) >= EXTERNAL_DAMAGE_CONTINUES_SHARE
    ? "continues"
    : "stops";
}

const deathSecondOf = (
  u: ICombatUnit,
  startMs: number,
): number | null => {
  const d = u.deathRecords?.[0]?.timestamp;
  return d ? (d - startMs) / 1000 : null;
};

/**
 * One application (an eligible, observed, ally-applied aura interval on
 * `target`) → one observation per qualifying friendly attacker. Returns []
 * when the interval is not eligible or nobody qualifies.
 */
export function externalDamageForApplication(
  iv: Pick<
    IAuraInterval,
    "spellId" | "spellName" | "srcUnitName" | "fromS" | "toS" | "inferredStart" | "inferredEnd"
  >,
  target: ICombatUnit,
  friends: readonly ICombatUnit[],
  enemies: readonly ICombatUnit[],
  combat: { startTime: number; endTime: number },
): IExternalDamageObservation[] {
  const mit = eligibleExternalMitigation(iv.spellId);
  if (!mit) return [];
  if (iv.inferredStart || iv.inferredEnd) return [];
  if (iv.srcUnitName === target.name) return []; // self-applied → not an external
  const startMs = combat.startTime;
  const endS = (combat.endTime - startMs) / 1000;
  const enemyIds = new Set(enemies.map((e) => e.id));
  const tDeath = deathSecondOf(target, startMs);
  const wToTarget = Math.floor(Math.min(iv.toS, endS, tDeath ?? Infinity));
  const wFrom = Math.ceil(iv.fromS);
  if (wToTarget <= wFrom) return [];
  const out: IExternalDamageObservation[] = [];
  for (const ally of friends) {
    if (!ally.damageOut) continue;
    const aDeath = deathSecondOf(ally, startMs);
    // Per-ally truncation (the ally's own death); the target-side bound stays.
    const wTo = Math.min(wToTarget, Math.floor(aDeath ?? Infinity));
    if (wTo <= wFrom) continue;
    let preDirect = 0;
    let nDirect = 0;
    let nPeriodic = 0;
    let dAll = 0;
    let absorbed = 0;
    const bins = new Set<number>();
    for (const a of target.absorbsIn ?? []) {
      if (a.attackerId !== ally.id) continue;
      const tS = (a.logLine.timestamp - startMs) / 1000;
      if (tS < wFrom || tS >= wTo) continue;
      absorbed += a.absorbedAmount;
      bins.add(Math.floor(tS));
    }
    for (const d of ally.damageOut) {
      const ev = d.logLine.event as string;
      if (ev === LogEvent.SPELL_ABSORBED || d.effectiveAmount >= 0) continue;
      if (!enemyIds.has(d.destUnitId)) continue;
      const tS = (d.logLine.timestamp - startMs) / 1000;
      const amt = -d.effectiveAmount;
      const onTarget = d.destUnitId === target.id;
      if (
        onTarget &&
        DIRECT_EVENTS.has(ev) &&
        tS >= iv.fromS - EXTERNAL_DAMAGE_PRE_HIT_S &&
        tS < iv.fromS
      )
        preDirect += amt;
      if (tS < wFrom || tS >= wTo) continue;
      dAll += amt;
      if (!onTarget) continue;
      if (DIRECT_EVENTS.has(ev)) nDirect += amt;
      else if (ev === PERIODIC_EVENT) nPeriodic += amt;
      else continue;
      if (amt >= EXTERNAL_DAMAGE_BIN_MIN_HIT) bins.add(Math.floor(tS));
    }
    if (preDirect <= 0) continue; // not a qualifying ally
    const M = wTo - wFrom;
    let G = 0;
    let run = 0;
    for (let s = wFrom; s < wTo; s++) {
      if (bins.has(s)) run = 0;
      else G = Math.max(G, ++run);
    }
    const base = {
      allyId: ally.id,
      allyName: ally.name,
      targetId: target.id,
      targetName: target.name,
      spellId: iv.spellId,
      mitName: getEnglishSpellName(iv.spellId, iv.spellName),
      mitPct: mit.pct,
      srcName: iv.srcUnitName,
      applyS: iv.fromS,
      removeS: iv.toS,
      wFrom,
      wTo,
      M,
      K: bins.size,
      G,
      nDirect,
      nPeriodic,
      dAll,
      absorbed,
      X: dAll > 0 ? (100 * (nDirect + nPeriodic)) / dAll : null,
      preDirect,
    };
    out.push({ ...base, kind: classifyExternalDamage(base) });
  }
  return out;
}

/** Every eligible application on `target` this round → all observations. */
export function externalDamageObservations(
  target: ICombatUnit,
  friends: readonly ICombatUnit[],
  enemies: readonly ICombatUnit[],
  combat: { startTime: number; endTime: number },
): IExternalDamageObservation[] {
  const out: IExternalDamageObservation[] = [];
  for (const iv of buildAuraIntervals(target, combat))
    out.push(...externalDamageForApplication(iv, target, friends, enemies, combat));
  return out;
}

const k = (x: number): string => `${Math.round(x / 1000)}k`;
/** `(+Ak absorbed)` when the target's shields ate a material amount. */
const absorbedTag = (o: IExternalDamageObservation): string =>
  o.absorbed >= 500 ? ` (+${k(o.absorbed)} absorbed)` : "";

/**
 * The rendered fact for one observation, appended to the `[ENEMY DEF]`
 * external line as `| during it: …`. Separators inside are ` · ` on purpose:
 * the candidate facts block forbids `, ` inside a value
 * (`checkFactsBlockIntegrity`), and one format serves both places.
 *   `1(AWarrior) 138k on target · 100% of their enemy-player damage · direct 101k / periodic 37k · damage in 11 of 11 s · longest gap 0 s`
 *   `1(AWarrior) 0k on target · no damage on any enemy player · 0 of 11 s`
 */
export function formatDuringExternal(
  o: IExternalDamageObservation,
  label: (allyName: string) => string,
): string {
  const who = label(o.allyName);
  const onTarget = o.nDirect + o.nPeriodic;
  if (o.dAll <= 0 && o.absorbed <= 0)
    return `${who} 0k on target · no damage on any enemy player · 0 of ${o.M} s`;
  const share = o.X === null ? "0%" : `${Math.round(o.X)}%`;
  return `${who} ${k(onTarget)} on target${absorbedTag(o)} · ${share} of their enemy-player damage · direct ${k(o.nDirect)} / periodic ${k(o.nPeriodic)} · damage in ${o.K} of ${o.M} s · longest gap ${o.G} s`;
}

/** Same fact from the OWNER's own point of view (the candidate facts block). */
export function formatDuringExternalForOwner(
  o: IExternalDamageObservation,
): string {
  const onTarget = o.nDirect + o.nPeriodic;
  if (o.dAll <= 0 && o.absorbed <= 0)
    return `0k on target · no damage on any enemy player · 0 of ${o.M} s`;
  const share = o.X === null ? "0%" : `${Math.round(o.X)}%`;
  return `${k(onTarget)} on target${absorbedTag(o)} · ${share} of your enemy-player damage · direct ${k(o.nDirect)} / periodic ${k(o.nPeriodic)} · damage in ${o.K} of ${o.M} s`;
}
