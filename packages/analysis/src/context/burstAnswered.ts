/**
 * `[BURST ANSWERED]` — the POSITIVE side of the burst-window work
 * (GH #60 follow-up, user-approved 2026-09-01).
 *
 * This is **not** a candidate and **not** an accusation. It is a descriptive
 * timeline context fact that credits a correct reaction: the enemy opened a
 * burst window, somebody answered it inside the response horizon, and the
 * person under it bottomed out at a stated HP. Nothing here reaches the
 * candidate menu, `mistakes.ts`, or any verdict surface.
 *
 * **One engine, both signs.** Every window this module renders came out of
 * `burstWindowDecisionPoints` with the same `feasible` gate the
 * `slow-defensive-response` candidate uses, and is disqualified from that
 * candidate by exactly the field this one requires (`responded`). So the
 * population that can be credited and the population that can be blamed are
 * complementary halves of one predicate rather than two independent
 * derivations of "was this answered" (CLAUDE.md shared-predicate rule). Every
 * HP number is the engine's own `gridHpPct` reading at a whole second — the
 * `[STATE]` tick's sampler and radius — never a raw sample, and `tSec` /
 * `minHpSec` are already the seconds `fmtTime` displays.
 *
 * **No corpus reference numbers on these lines, deliberately.** The
 * kick-eaten A/B (GH #34) showed per-line corpus references inflate whatever
 * they touch; a credit line quoting `n=` would be arguing a case. One clause,
 * descriptive, no numbers beyond the facts of the moment itself.
 */
import {
  BURST_RESPONSE_WINDOW_SEC,
  burstExtrasLabel,
  type BurstWindowDecisionPoint,
} from "../analysis/burstWindowDecisionPoints";

export const BURST_ANSWERED_TAG = "[BURST ANSWERED]";

/**
 * At most this many `[BURST ANSWERED]` lines per round.
 *
 * **Volume control is the whole reason this constant exists.** 71.4% of
 * bounded burst windows are answered (GH #60 phase-2 archive scan, 36,649
 * rounds / 68,756 windows), so rendering every one of them would bury the
 * timeline in praise and dilute everything around it. Two is also the cap
 * every sibling producer in this repo uses (`BURST_WINDOW_RESPONSE_CAP`,
 * `crisisNoResponse`) — the number a coach can act on.
 *
 * Selection is by DANGER, not by time: a window somebody died in first, then
 * the lowest grid min HP reached. Emission order is time, the same
 * select-by-danger / emit-by-time split every sibling producer makes.
 */
export const BURST_ANSWERED_CAP = 2;

/**
 * The pressured friendly's grid min HP must have reached at least this low
 * for the window to be worth a credit line.
 *
 * A "you answered that" line about a window where nobody dropped below 60% is
 * noise: nothing was at stake, so nothing was saved, and the sentence teaches
 * the reader that the bar for praise is meaninglessly low. This is
 * deliberately LOOSER than the candidate's own severity door
 * (`CRISIS_HP_PCT_RENDERED` = 40, plus a 15-point drop): a window answered
 * WELL never reaches the crisis line precisely because it was answered, so
 * reusing the accusation's triage would select for the answers that barely
 * worked and hide the ones that worked.
 */
export const BURST_ANSWERED_MAX_HP_PCT = 60;

/** Legend lines, emitted only when at least one `[BURST ANSWERED]` line is.
 * The second one is load-bearing: with `BURST_ANSWERED_CAP` = 2 the list is
 * not exhaustive, and an unqualified list reads as one (the same
 * "only such roots are listed" clause GH #24 had to add to `[ROOT]`). */
export const BURST_ANSWERED_LEGEND = [
  `  ${BURST_ANSWERED_TAG} = an enemy burst window the team DID answer inside ${BURST_RESPONSE_WINDOW_SEC}s — context, not a mistake.`,
  `    At most ${BURST_ANSWERED_CAP} of them are listed per round (the most dangerous first), so this is NOT a full list of answered bursts.`,
];

export interface BurstAnsweredEntry {
  /** whole second the window opened — already on `fmtTime`'s grid */
  atSeconds: number;
  /** the line WITHOUT its timestamp prefix (the caller adds `fmtTime`) */
  line: string;
}

/**
 * Which windows earn a line. Exported so a test can pin the gate rather than
 * re-deriving it, and so it reads as one predicate at the call site.
 *
 * `responseCasts.length > 0` is required on top of `responded`: a kite-only
 * answer has no spell and no cast instant, and the sentence's shape ("answered
 * with X in Ns") cannot be written for it. Those windows are silently skipped
 * in v1 rather than rendered in a second wording.
 */
function isCreditable(p: BurstWindowDecisionPoint): boolean {
  return (
    p.feasible &&
    p.responded &&
    p.responseCasts.length > 0 &&
    p.pressured !== null &&
    p.pressured.minHpPct !== null &&
    p.pressured.minHpPct <= BURST_ANSWERED_MAX_HP_PCT
  );
}

export function formatBurstAnsweredLines(
  points: BurstWindowDecisionPoint[],
  overrides?: { cap?: number },
): BurstAnsweredEntry[] {
  const cap = overrides?.cap ?? BURST_ANSWERED_CAP;
  const eligible = points.filter(isCreditable);
  // Danger order — a window somebody died in first, then the deepest HP dip.
  // `anyFriendlyDeath` is the engine's own field (the same predicate the
  // candidate's cap ordering and the corpus reference's death outcome use),
  // not a second death derivation.
  const ranked = [...eligible].sort(
    (a, b) =>
      Number(b.anyFriendlyDeath) - Number(a.anyFriendlyDeath) ||
      (a.pressured!.minHpPct ?? 101) - (b.pressured!.minHpPct ?? 101),
  );
  return ranked
    .slice(0, cap)
    .map((p) => {
      // Only the CDs inside the response horizon this line talks about, each
      // offset from the opener — the same helper as `burstWindowResponseEvents`.
      const extras = burstExtrasLabel(p);
      const extrasPart = extras ? ` (+${extras})` : "";
      const first = p.responseCasts[0];
      // Latency is an INTERVAL between two instants, not a grid-anchored
      // instant, so one decimal is legitimate here where a rendered timestamp
      // would have to be floored (the engine already rounds it to 0.1s).
      // It can be negative down to `-BURST_RESPONSE_PRE_MS`: a wall pressed
      // just before the opener is a pre-wall, and "in -0.8s" is not English.
      const when =
        first.latencySec < 0
          ? `${Math.abs(first.latencySec).toFixed(1)}s before it opened`
          : `in ${first.latencySec.toFixed(1)}s`;
      const pressured = p.pressured!;
      const diedPart = pressured.died ? ` — ${pressured.name} still died` : "";
      return {
        atSeconds: p.tSec,
        line:
          `${BURST_ANSWERED_TAG}   enemy opened ${p.leadCd.spellName}${extrasPart} ` +
          `(${p.leadCd.casterSpec} ${p.leadCd.casterName}): ` +
          `${first.casterName} answered with ${first.spellName} ${when}; ` +
          `${pressured.name} bottomed at ${pressured.minHpPct}%${diedPart}`,
      };
    })
    .sort((a, b) => a.atSeconds - b.atSeconds);
}
