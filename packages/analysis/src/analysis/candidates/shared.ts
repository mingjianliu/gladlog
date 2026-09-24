/**
 * Helpers shared by more than one candidate producer.
 *
 * Split out of `candidateFindings.ts` on 2026-08-16 (mechanical split by
 * theme). Nothing here decides whether a candidate fires — these only format
 * facts once a producer has already decided to emit one.
 */
import type { CastFailedEvent } from "../../utils/rawStreams";

/**
 * Intent guard (BACKLOG #26 Task 2, 意图守护 — "pressed but rejected ≠ never
 * pressed"): formats the `CastFailedEvent`s `castFailedInWindow` returns into
 * the `attempted` fact `cdHoardedEvents` attaches (as did the
 * death-unused-defensive producer until its emitter was deleted 2026-09-24)
 * when the player actually pressed the button and the game rejected the cast (stun/silence/oom/GCD/etc). Aggregated by the localized `reason`
 * string kept verbatim (rawStreams.ts's own rule — never translated or
 * normalized), most-frequent reason first; ties keep first-seen order (`Map`
 * preserves insertion order and `Array.prototype.sort` is stable, so no
 * separate tie-break is needed). `undefined` for zero hits so call sites can
 * spread `...(attempted ? { attempted } : {})` without a second presence
 * check — matches this file's existing `costNorm` optional-fact idiom.
 */
/** The reason-aggregation convention itself (Task 2): group `CastFailedEvent`s
 * by their verbatim `reason` string, most-frequent first (ties keep
 * first-seen order — `Map` preserves insertion order and `Array.prototype.sort`
 * is stable). Factored out of `formatAttemptedFact` so mana-pressure (Task 3)
 * can reuse the exact same aggregation instead of a second copy — the two
 * differ only in wrapper text (Task 2's is a negation-guard sentence, Task
 * 3's is a bare fact), never in HOW reasons get counted/ordered. `undefined`
 * for zero hits, matching this file's existing optional-fact idiom.
 */
export function aggregateReasonCounts(
  events: CastFailedEvent[],
): string | undefined {
  if (events.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${reason}×${n}`)
    .join("、");
}

export function formatAttemptedFact(
  events: CastFailedEvent[],
): string | undefined {
  const agg = aggregateReasonCounts(events);
  return agg === undefined ? undefined : `曾尝试施放被拒(${agg})`;
}

/**
 * BACKLOG #29 (2026-08-17 rewrite — the original "cross-round CD carryover"
 * premise was REFUTED): user ruling (domain expert, 2026-08-17) is that Solo
 * Shuffle resets ALL cooldowns at every round boundary, and the corpus
 * confirms it three ways — 3df6ccf8 round 1 accepted an Ultimate Penitence
 * CAST_START 140s after the round-0 success (CD 240s: impossible without a
 * reset), n=300 found 4681 cross-boundary same-spell cast pairs with gap <
 * CD, and every one of the 尚未恢复 failures the original #29 read as "still
 * on cooldown" sits within GCD range of the player's own casts. So the
 * ledger's "never cast this round ⇒ ready since t=0" default is CORRECT;
 * what was wrong is the intent guard counting GCD-spam presses as "pressed
 * but rejected" evidence. n=300 classification of the 478 尚未恢复 events
 * inside cd-hoarded guard windows: 81.2% spam-then-cast, 15.7% gcd-locked,
 * 3.1% genuine — 96.9% artifacts, and 125/334 guard-hit candidates (37.4%)
 * carried NOTHING but artifacts, wrongly triggering both the severity
 * downgrade (auditFindings.ts) and the prompt legend's "never phrase this
 * as hoarding" instruction on the single most win-discriminative candidate
 * type (+25.4pp).
 */
/** A failure this many seconds (or less) BEFORE a same-spell successful cast
 * is the mechanical act of finally pressing the button — spam clicks during
 * the GCD immediately preceding the successful press — not blocked intent.
 * 2s matches `extractMajorCooldowns`' own cast-dedup radius (cooldowns.ts:
 * two raw casts within 2s collapse into one ledger cast), not a new number. */
export const INTENT_GUARD_PRE_CAST_EXCLUSION_S = 2;

/** WoW's base global-cooldown ceiling (game constant, 1.5s): a 尚未恢复
 * failure within this window after the player's own successful cast is the
 * game reporting the GCD, not the spell's own cooldown. */
export const INTENT_GUARD_GCD_S = 1.5;

/** The zh-client SPELL_CAST_FAILED reason for "spell is not ready yet"
 * (fires for GCD as well as real cooldowns). Used ONLY to NARROW the
 * gcd-locked exclusion below — matching this string can only ever KEEP a
 * genuinely blocked press (stunned/silenced adjacent to an own cast) from
 * being swallowed; on a non-zh client the narrowing makes the exclusion a
 * no-op and evidence is kept (status-quo behavior). This is the opposite
 * direction from the locale trap `extendOomTailWithFailedCasts` once had
 * (mana.ts round-1 fix), where string-matching was REQUIRED for a feature
 * to fire at all. */
export const NOT_READY_REASON_ZH = "尚未恢复";

/**
 * Filters `castFailedInWindow` hits down to genuine "pressed but rejected"
 * intent-guard evidence (see the #29 block comment above for the corpus
 * numbers behind each exclusion):
 *
 *  - pre-cast (any reason): drop a hit within
 *    `INTENT_GUARD_PRE_CAST_EXCLUSION_S` before a same-spell successful cast
 *    (`sameSpellCastSeconds` — the builder's own `cd.casts` timeSeconds).
 *    Whatever blocked that instant self-resolved within 2s: the cast went
 *    through.
 *  - gcd-locked (尚未恢复 only): drop a `NOT_READY_REASON_ZH` hit within
 *    `INTENT_GUARD_GCD_S` after any of the player's own successful casts
 *    (`opts.ownCastSuccessSeconds`). Optional — absent means this exclusion
 *    is skipped entirely (graceful degradation, same convention as the
 *    guard's own `rawStreams?` param).
 *
 * Known tail (agy flash review, 2026-08-17, accepted): `cd.casts` is the
 * ledger's 2s-DEDUP'D cast list, so a double-charge spell cast twice within
 * 2s keeps only the first timestamp — a failure just before the collapsed
 * second cast is NOT pre-cast-excluded. The miss keeps the evidence
 * (pre-fix behavior), never wrongly drops genuine evidence, so the error
 * direction is conservative; fixing it would need a per-spell un-dedup'd
 * cast list threaded through both builders, complexity that doesn't match
 * the (double-charge ∩ sub-2s double-cast ∩ interleaved failure) tail.
 */
export function filterIntentGuardEvidence(
  hits: CastFailedEvent[],
  sameSpellCastSeconds: number[],
  opts?: { ownCastSuccessSeconds?: number[] },
): CastFailedEvent[] {
  const ownCasts = opts?.ownCastSuccessSeconds;
  return hits.filter((h) => {
    const preCast = sameSpellCastSeconds.some(
      (ct) =>
        ct >= h.tSeconds &&
        ct <= h.tSeconds + INTENT_GUARD_PRE_CAST_EXCLUSION_S,
    );
    if (preCast) return false;
    if (h.reason === NOT_READY_REASON_ZH && ownCasts) {
      const gcdLocked = ownCasts.some(
        (ct) => ct <= h.tSeconds && ct >= h.tSeconds - INTENT_GUARD_GCD_S,
      );
      if (gcdLocked) return false;
    }
    return true;
  });
}
