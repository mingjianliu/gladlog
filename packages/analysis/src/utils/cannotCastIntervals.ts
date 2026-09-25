import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  isCastBlockingAuraType,
  SPELL_CATEGORIES as SPELLS,
} from "../data/spellCategories";
import { kickLockoutSeconds } from "../data/spellEffectData";
import { ccSpellIds, officialSilenceIds } from "../data/spellTags";

/**
 * "When could this unit not cast?" — ONE predicate for the two consumers that
 * used to answer it separately (BACKLOG #38 (e), unified 2026-09-02):
 *
 *   - `dispelAnalysis.ts` → the "dispeller was locked out" exemption on
 *     missed-cleanse / missed-purge (gate b+c; this function was born there);
 *   - `healingGaps.ts` → the free-cast seconds of a healing gap ("he COULD
 *     have cast"), which until 2026-09-02 subtracted hard CC + silence auras
 *     but NOT kick lockouts — a pure interrupt (Pummel / Kick / Counterspell)
 *     logs no SPELL_AURA_APPLIED, so the 3–6 s the healer could not cast the
 *     locked school counted as "free" and a Holy Paladin (36 % of kicks
 *     followed by 5 s of nothing, corpus #36 (b)) was charged with a healing
 *     gap he was locked out of.
 *
 * Two sources, both enemy-inflicted:
 *   1. cast-blocking auras (hard CC + silence; `isCastBlockingAuraType`)
 *      from APPLIED to the first REMOVED/BROKEN at or after it (open-ended
 *      when never removed);
 *   2. school lockouts from SPELL_INTERRUPT (`kickLockoutSeconds`, the
 *      corpus-observed table — GH #62). In SPELL_INTERRUPT `spellId` IS the
 *      kick (same source as matchTimeline's [KICK]; gate-predicate divergence
 *      case 13: do NOT read extraSpellId here). The school itself is not
 *      checked — the locked school is almost always the healing one, and a
 *      wrong exemption costs far less than a wrong accusation.
 *
 * Intervals are raw (unclipped, possibly overlapping); `coveredMsWithin`
 * clips them to a window and merges before summing.
 */
export function buildCannotCastIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
): Array<{ from: number; to: number }> {
  const intervals: Array<{ from: number; to: number }> =
    castBlockingAuraIntervals(unit, enemyIds).map((a) => ({
      from: a.from,
      to: a.to,
    }));

  for (const action of unit.actionIn ?? []) {
    if (action.logLine.event !== LogEvent.SPELL_INTERRUPT) continue;
    if (!enemyIds.has(action.srcUnitId)) continue;
    const kickSpellId = action.spellId ?? "";
    intervals.push({
      from: action.timestamp,
      to: action.timestamp + kickLockoutSeconds(kickSpellId) * 1000,
    });
  }

  return intervals;
}

export interface CastBlockingAura {
  spellId: string;
  spellName: string;
  srcUnitId: string;
  srcUnitName: string;
  /** SPELL_AURA_APPLIED, epoch ms */
  from: number;
  /** first REMOVED / BROKEN at or after `from`; Infinity when never removed */
  to: number;
}

/**
 * The enemy-applied cast-blocking auras on `unit` (hard CC + silence,
 * `isCastBlockingAuraType`), APPLIED paired with the first REMOVED/BROKEN of
 * the same spell at or after it. The aura half of `buildCannotCastIntervals`,
 * exported so a renderer can name what blocked the unit without a second
 * predicate (2026-09-25, reliability round 2 W1b).
 */
export function castBlockingAuraIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
): CastBlockingAura[] {
  const applied = new Map<
    string,
    Array<{ ts: number; name: string; srcId: string; srcName: string }>
  >();
  const removedTimes = new Map<string, number[]>();

  // Fixture-built units may lack either stream (momentSnapshot.test.ts has
  // healers with no actionIn) — an absent stream is "nothing happened", not a
  // throw that the caller's try/catch would turn into "no gaps at all".
  for (const aura of unit.auraEvents ?? []) {
    const spellId = aura.spellId;
    if (!spellId) continue;
    if (!enemyIds.has(aura.srcUnitId)) continue;
    const spell = SPELLS[spellId];
    if (!spell || !isCastBlockingAuraType(spell.type)) continue;

    if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      const bucket = applied.get(spellId) ?? [];
      bucket.push({
        ts: aura.timestamp,
        name: aura.spellName ?? spellId,
        srcId: aura.srcUnitId,
        srcName: aura.srcUnitName ?? "",
      });
      applied.set(spellId, bucket);
    } else if (
      aura.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
    ) {
      const bucket = removedTimes.get(spellId) ?? [];
      bucket.push(aura.timestamp);
      removedTimes.set(spellId, bucket);
    }
  }

  const out: CastBlockingAura[] = [];
  for (const [spellId, applications] of applied) {
    const removals = removedTimes.get(spellId) ?? [];
    for (const a of applications) {
      const removalTs = removals.find((r) => r >= a.ts);
      out.push({
        spellId,
        spellName: a.name,
        srcUnitId: a.srcId,
        srcUnitName: a.srcName,
        from: a.ts,
        to: removalTs ?? Infinity,
      });
    }
  }
  return out;
}

/**
 * Silences on `unit`: the cast-blocking auras (the same predicate as
 * `buildCannotCastIntervals`, which already locks the unit for them) that are
 * in the official DR `silence` category and not hard CC (`ccSpellIds`, which
 * the [CC ON TEAM] / [CC ON ENEMY] lines already render). The official
 * category keeps kick-lockout auras out (Shambling Rush 91807 is mechanic
 * "interrupt": 349 of the first run's 11,625 lines). Round 2 found Garrote -
 * Silence, Strangulate and Spider Venom on the log owner in 4 of 24 matches
 * with no timeline line at all, so the prompt read the healer as free
 * (reliability round 2 W1b).
 */
export function silenceIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
): CastBlockingAura[] {
  return castBlockingAuraIntervals(unit, enemyIds)
    .filter(
      (a) => officialSilenceIds.has(a.spellId) && !ccSpellIds.has(a.spellId),
    )
    .sort((x, y) => x.from - y.from);
}

/**
 * Milliseconds of [fromMs, toMs] covered by the union of the intervals
 * (clipped to the window, overlaps merged so a stun inside a silence is not
 * counted twice).
 */
export function coveredMsWithin(
  intervals: ReadonlyArray<{ from: number; to: number }>,
  fromMs: number,
  toMs: number,
): number {
  const clipped: Array<{ from: number; to: number }> = [];
  for (const iv of intervals) {
    const from = Math.max(iv.from, fromMs);
    const to = Math.min(iv.to, toMs);
    if (to > from) clipped.push({ from, to });
  }
  if (clipped.length === 0) return 0;
  clipped.sort((a, b) => a.from - b.from);
  let covered = 0;
  let cur = clipped[0]!;
  for (let i = 1; i < clipped.length; i++) {
    const w = clipped[i]!;
    if (w.from <= cur.to) cur = { from: cur.from, to: Math.max(cur.to, w.to) };
    else {
      covered += cur.to - cur.from;
      cur = w;
    }
  }
  covered += cur.to - cur.from;
  return covered;
}
