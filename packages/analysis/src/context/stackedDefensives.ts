/**
 * `[STACKED DEFENSIVES]` — a fact line for two major defensives from two
 * different players up on the same friendly at once (GH #95 "给重了",
 * 2026-09-17). Not a candidate and not an accusation: the user withdrew the
 * "one would have been enough" counterfactual on 2026-09-16 ("我们甚至有可能
 * 算错了" — the second aura often keeps blocking after the first expires, 702
 * of 7,492 archive pairs blocked ≥ 20 % max HP after the overlap). The line
 * says who cast A and B, how long they overlapped and what B blocked where
 * it can be priced (`analysis/stackedDefensives.ts`), and stops there.
 *
 * Every time on the line is a whole second on `fmtTime`'s grid; every
 * percent is the engine's own rounded integer.
 */
import type { StackedDefensivePair } from "../analysis/stackedDefensives";
import { fmtTime, renderedWindowSeconds } from "../utils/renderGrid";

export const STACKED_DEFENSIVES_TAG = "[STACKED DEFENSIVES]";

/** per-round cap, the same figure every sibling context producer uses */
export const STACKED_DEFENSIVES_CAP = 2;

export const STACKED_DEFENSIVES_LEGEND = [
  `  ${STACKED_DEFENSIVES_TAG} = two major defensives from two different players were up on the same friendly at once; the line says who cast each and what the later one blocked — a fact about the stack, not a verdict (the later aura often keeps working after the first expires).`,
  `    At most ${STACKED_DEFENSIVES_CAP} per round.`,
];

export interface StackedDefensivesEntry {
  /** whole second of the overlap start — already on `fmtTime`'s grid */
  atSeconds: number;
  /** the line WITHOUT its timestamp prefix (the caller adds `fmtTime`) */
  line: string;
}

export function formatStackedDefensiveLines(
  pairs: StackedDefensivePair[],
  overrides?: { cap?: number },
): StackedDefensivesEntry[] {
  const cap = overrides?.cap ?? STACKED_DEFENSIVES_CAP;
  // selection by overlap length (longest first), emission by time
  const ranked = [...pairs].sort(
    (a, b) =>
      b.overlapSeconds - a.overlapSeconds ||
      a.overlapFromSec - b.overlapFromSec,
  );
  return ranked
    .slice(0, cap)
    .map((s) => {
      const who = (c: { casterName: string; casterIsOwner: boolean }) =>
        c.casterIsOwner ? "you" : c.casterName;
      const target = s.targetIsOwner ? `${s.targetName} (you)` : s.targetName;
      let priced: string;
      if (s.pricing === "pct")
        priced = `blocked ~${s.blockedOverlapPct}% of their max HP during the overlap (~${s.blockedFullPct}% over its full ${s.secondRunSeconds}s run)`;
      else if (s.pricing === "absorb")
        priced = `absorbed ${s.blockedOverlapPct}% of their max HP during the overlap`;
      else priced = `is not priced here (${s.unpricedReason})`;
      // The span's duration is the difference of its RENDERED endpoints —
      // the gate re-parses "m:ss–m:ss (Ns)" (checkWindowSpanConsistency).
      // The raw 1-dp overlap ("0:34–0:38 (4.3s)") disagreed with its own
      // endpoints on ~3 of 4 lines and slipped past the gate's integer regex;
      // the 1 in 4 that rounded to a whole number failed it. An overlap
      // inside one rendered second says so instead of "(0s)".
      const spanS = renderedWindowSeconds(s.overlapFromSec, s.overlapToSec);
      const span =
        spanS === 0
          ? `for under 1 s at ${fmtTime(s.overlapFromSec)}`
          : `${fmtTime(s.overlapFromSec)}–${fmtTime(s.overlapToSec)} (${spanS}s)`;
      return {
        atSeconds: s.overlapFromSec,
        line:
          `${STACKED_DEFENSIVES_TAG}   ${target} had ${s.first.spellName} (from ${who(s.first)}) and ${s.second.spellName} (from ${who(s.second)}) up together ${span}; ` +
          `the later one, ${s.second.spellName}, ${priced} — a fact about the stack, not a verdict`,
      };
    })
    .sort((a, b) => a.atSeconds - b.atSeconds);
}
