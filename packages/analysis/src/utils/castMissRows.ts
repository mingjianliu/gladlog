/**
 * castMissRows.ts — which `SPELL_MISSED` row is a control cast's own, and
 * which miss types say the control did not land. One reading for
 *  - the fail tags of our own control casts (`[IMMUNE …]`, `[MISSED on …]`,
 *    `[REFLECTED by …]` on `[YOU] [CC]` / `[TEAM] [CC]` lines —
 *    `timelineSections/setup.ts`: `ccImmuneTagFor`, `ccMissTagFor`), and
 *  - the `logged <TYPE>` half of a `[CC AVOIDED?]` line (FT-T16 D15 "3c" —
 *    `ccTrinketAnalysis.ts`), whose gate
 *    (`promptQualityCheck.checkCcAvoidedMissType`) re-parses the type.
 *
 * Extracted from `setup.ts` when the second reader arrived (Shared-Predicate
 * Rule); the windows, the attribution rule and the type table are unchanged.
 */

/** A miss row can precede its cast's SPELL_CAST_SUCCESS by this much (same
 * instant, logged in either order). */
export const CAST_MISS_LEAD_MS = 100;
/** … and follow it by this much: an instant control misses on the same
 * instant, a Polymorph projectile lands up to ~1.5 s later. */
export const CAST_MISS_WINDOW_MS = 2500;

/**
 * The miss falls in the cast's window AND no later cast of the same spell by
 * the same caster happened at or before it — it belongs to the latest cast
 * before it (codex astra 2026-09-25: with only a window, a Polymorph reflected
 * at 31.55 s tagged the landed 30.0 s cast and left the reflected 31.5 s cast
 * bare).
 *
 * @param sameSpellCastMs every SPELL_CAST_SUCCESS time of that spell by that
 *   caster (the cast itself may be among them).
 * @param afterMs how long after the cast the miss may come — a control that
 *   lands seconds after its cast is asked with its own landing delay.
 */
export function missBelongsToCast(
  sameSpellCastMs: readonly number[],
  castMs: number,
  missMs: number,
  afterMs: number = CAST_MISS_WINDOW_MS,
): boolean {
  if (missMs < castMs - CAST_MISS_LEAD_MS || missMs > castMs + afterMs)
    return false;
  return !sameSpellCastMs.some(
    (t) => t > castMs + 5 && t <= missMs + CAST_MISS_LEAD_MS,
  );
}

/**
 * The miss types, other than IMMUNE, that say a control did not land on the
 * unit, with the word the cast-line tag prints (2026-09-25). Season sample
 * (1 file in 60): MISS 397, REFLECT 60, PARRY / DODGE 17 against IMMUNE
 * 1,866; after one of them the caster's CC aura appeared on that target
 * within 0.5 s 0 / 474 times. ABSORB is not here on purpose: it reports the
 * control's damage part, and the aura followed it 957 / 1,072 times (89 %).
 */
export const CC_MISS_TAG_WORD: Readonly<Record<string, string>> = {
  MISS: "MISSED",
  REFLECT: "REFLECTED by",
  PARRY: "PARRIED by",
  DODGE: "DODGED by",
  EVADE: "EVADED by",
  DEFLECT: "DEFLECTED by",
};

/** Every miss type that establishes a failed control: IMMUNE and the types
 * of `CC_MISS_TAG_WORD`. */
export const CONTROL_FAILED_MISS_TYPES: ReadonlySet<string> = new Set([
  "IMMUNE",
  ...Object.keys(CC_MISS_TAG_WORD),
]);
