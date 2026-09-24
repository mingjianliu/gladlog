/**
 * Position-sampling predicates (single-source) — constants shared by the
 * analysis side and the eval gate side.
 *
 * Why its own module: CLAUDE.md's "gate predicates are the spec" rule demands
 * "one predicate per fact: same constant, same sampling function, same
 * tolerance", and "export the predicate from one place and import it on both
 * sides; when that is impossible, write a unit test asserting equality — never
 * rely on a comment".
 *
 * These constants used to be declared privately in four places, coupled only by
 * a comment in healerExposureAnalysis.ts saying "MUST stay equal to …
 * positioningScan.ts" — exactly the shape that rule forbids. In the 2026-07
 * full-corpus audit all 5 independent bugs were of this class (inconsistent HP
 * sample radius, bounded vs unbounded lookback, interpolated vs raw sampling,
 * fractional-second vs rendered-second grid), so this was turned into a real
 * single-source export.
 *
 * Note the two constants mean different things — do not mix them up just
 * because both are called "gap":
 *  - LOS_SWEEP_GAP_MS  = used by the LoS sweep decision; analysis and gate must
 *                        match byte for byte, or the gate cannot recompute the
 *                        analysis's conclusion (or, conversely, lets a
 *                        hallucinated claim through).
 *  - INTERP_MAX_GAP_MS = grounding guard for single-point position
 *                        interpolation, far stricter than the above — a sample
 *                        interval beyond it means the interpolation is made up
 *                        (unit idle / stealthed).
 *    It must **not** equal LOS_SWEEP_GAP_MS; historically both were once named
 *    POSITION_MAX_GAP_MS (values 1500 vs 3000), which made them very easy to
 *    confuse.
 */

/**
 * Time slack for the LoS sweep (seconds): sweep anchor ±N seconds on the
 * whole-second grid. Analysis and gate must agree.
 */
export const LOS_SWEEP_SLACK_S = 2;

/**
 * Max sampling interval for position interpolation in the LoS sweep
 * (milliseconds). Analysis and gate must agree.
 */
export const LOS_SWEEP_GAP_MS = 3_000;

/**
 * Verification window for a `[CC ON TEAM] … | Nyd from caster` distance claim
 * (GH #103 follow-up, codex astra ruling 2026-09-23). The producer
 * (`ccTrinketAnalysis`) samples caster and target at the aura-application
 * instant and the line is stamped `fmtTime` of that same instant, so the
 * instant lies in [t, t+1) of the rendered second — the gate needs no wider
 * window. It used to borrow the LoS sweep's ±LOS_SWEEP_SLACK_S, and in 4 s of
 * movement a +15 yd mutation still fell inside the distance span 38.7 % of
 * the time. The LoS / STAYED families keep their ±2 s: their anchors are not
 * a single sampled instant.
 */
export function ccDistanceClaimWindowS(renderedSecond: number): {
  fromS: number;
  toS: number;
} {
  return { fromS: renderedSecond, toS: renderedSecond + 1 };
}

/**
 * Grounding guard for single-point position interpolation (milliseconds). An
 * interpolated position across a larger interval is treated as fabricated — a
 * stale position would claim LoS exists while real samples show it broke long
 * ago, producing a bogus "go break line of sight" recommendation (2026-07-14
 * full-corpus audit, G5).
 */
export const INTERP_MAX_GAP_MS = 1_500;

// ---------------------------------------------------------------------------
// The two upper bounds on CC distance — these are two facts, not one
// ---------------------------------------------------------------------------
//
// The 2026-08-01 predicate-index investigation found three unrelated numbers
// here (45 / 40 / 50), all three commented as "the maximum distance of a CC".
// The conclusion after study (do not re-derive your own copy):
//
//  A. Cast range (CC_MAX_CAST_RANGE_YARDS) — **can it even reach**. The
//     longest-range CC in the game is about 40 yards (Freezing Trap / Cyclone /
//     Ring of Peace). Used for forward-looking judgments: an enemy standing
//     beyond 40 yards right now poses no CC threat to the healer
//     (healerExposureAnalysis).
//  B. Observation ceiling (CC_MAX_PLAUSIBLE_RANGE_YARDS) — **is the number we
//     computed believable**. This applies to CC that **already happened**: both
//     sides were moving at landing time, positions come from interpolation, and
//     projectiles have travel time, so a recomputed distance can *legitimately*
//     exceed the cast range slightly. Beyond it, the data is bad: the producing
//     side suppresses the distance outright (ccTrinketAnalysis) and the gate
//     rules G6 on it.
//
// They are not the same fact, and the corpus proves it: of 141237 rendered
// "Nyd from caster" claims, 90 fall in (40, 45], with a maximum of 44.7 — if A
// and B were one number, those 90 could not exist. The ordering (A ≤ B) is
// guaranteed structurally by the **derivation** below, not by a comment and not
// by a unit test.
//
// The gate side used to declare its own IMPOSSIBLE_CC_YARDS = 50, a full 5 yards
// looser than the producing side's suppression threshold, so the (45, 50] band
// could never fire — the gate was effectively dead code. The gate now imports B
// directly, becoming "verify the contract the producing side declares for
// itself" (same shape as G2 using HEALER_TRAINED_YARDS). Measured on the corpus,
// same criterion before and after tightening: >50 = 0 rows → >45 = 0 rows —
// behavior unchanged, criterion stronger.

/**
 * Maximum cast range of player CC abilities (yards). Used for forward-looking
 * judgments: an enemy beyond this cannot land a CC, line of sight or not. This
 * is **not** the believability ceiling on a recomputed distance — that is the
 * constant further below.
 */
export const CC_MAX_CAST_RANGE_YARDS = 40;

/**
 * Maximum cast range of dispels / offensive dispels (yards). Numerically equal
 * to CC_MAX_CAST_RANGE_YARDS but a **different fact** (dispel-family ranges are
 * 30-40 yards; the upper bound is taken for a lenient judgment) — do not merge
 * them into one constant, or the day the game changes one side you have to split
 * it again. Consumer: the LoS/range gate on dispelAnalysis's "missed cleanse"
 * blame (user's call, 2026-08-02: do not blame a missed cleanse when the ally is
 * behind a pillar or out of range).
 */
export const DISPEL_MAX_RANGE_YARDS = 40;

/**
 * Observation slack (yards): for a CC that already landed, its recomputed
 * distance may exceed the cast range by this much — position interpolation
 * error + projectile travel time + both sides still moving at cast time.
 */
const CC_RANGE_OBSERVATION_SLACK_YARDS = 5;

/**
 * Believability ceiling on the recomputed distance of a CC that happened
 * (yards). Beyond it the producing side suppresses the distance (better to make
 * no claim), and the gate side calls it a violation. Deliberately derived from
 * cast range + observation slack so it is always ≥ the cast range.
 */
export const CC_MAX_PLAUSIBLE_RANGE_YARDS =
  CC_MAX_CAST_RANGE_YARDS + CC_RANGE_OBSERVATION_SLACK_YARDS;

/**
 * Defining distance for "the healer is being trained" (yards): an enemy melee
 * inside this radius counts as camping.
 *
 * The producing side (positionAnalysis's HEALER_TRAINED) decides and renders
 * claims by it, and the gate (positioningScan's G2_TRAINED_DEFINITION) rechecks
 * by it — the definition itself must be single-source, otherwise the gate is
 * verifying a different definition.
 */
export const HEALER_TRAINED_YARDS = 8;

// ---------------------------------------------------------------------------
// The set of sampling instants the gate recomputes at
// ---------------------------------------------------------------------------

/**
 * Sub-second grid added during gate recomputation (milliseconds).
 * getUnitPositionAtTime is a linear interpolation and the pipeline may query any
 * sub-second instant; when two units' sample timestamps do not coincide, the
 * minimum of their closing approach exists only *between* sample points (D2,
 * measured: the claimed 1.7yd was true, while sweeping sample instants only gave
 * 5.3yd and a false violation).
 */
const GATE_SWEEP_GRID_MS = 250;

interface AdvancedSampleSource {
  advancedActions?: ReadonlyArray<{ timestamp: number }>;
}

/**
 * Which instants the gate must query when recomputing an interval
 * (single-source).
 *
 * = the anchor instants supplied by the caller ∪ every real advanced sample
 * timestamp of both units inside the interval ∪ the sub-second grid. All three
 * layers are required: whole seconds alone miss sub-second troughs, and sample
 * timestamps alone miss the crossing trough when the two units' samples do not
 * coincide. positioningScan's windowDistanceSpan and minDistanceInWindow each
 * used to carry their own copy, and forgetting to update either one means "one
 * fact, two sampling schemes".
 *
 * Note: this function defines **only** the set of instants, not the tolerance —
 * the gap tolerance is passed in by the caller per use case (LOS_SWEEP_GAP_MS vs
 * INTERP_MAX_GAP_MS, deliberately unequal).
 */
export function positionSampleInstants(
  units: ReadonlyArray<AdvancedSampleSource>,
  fromMs: number,
  toMs: number,
  anchorInstants: ReadonlyArray<number> = [],
): number[] {
  const instants = new Set<number>(anchorInstants);
  for (const u of units) {
    for (const act of u.advancedActions ?? []) {
      if (act.timestamp >= fromMs && act.timestamp <= toMs)
        instants.add(act.timestamp);
    }
  }
  for (let ts = fromMs; ts <= toMs; ts += GATE_SWEEP_GRID_MS) instants.add(ts);
  return [...instants].sort((a, b) => a - b);
}
