/**
 * `[CD PRIOR]` — a cohort-norm context fact for a held save cooldown
 * (GH #54 (f) / BACKLOG #38 (a)(h); user ruling 2026-09-04, option 1).
 *
 * This is **not** a candidate and **not** an accusation. It states two facts
 * side by side and lets the model decide whether they matter: (1) the
 * cohort (spec × hero tree, spec-wide on fallback) spends this cooldown at a
 * stated median lowest-friendly HP; (2) in this round a friendly fell
 * through that HP while the cooldown was ready and stayed unspent. BACKLOG
 * #38 (h): the corpus says what MOST players do, not what is RIGHT (median
 * rating 1700–1850), so the line explicitly says "context, not a mistake".
 *
 * Every number on the line is either a rendered integer from the reference
 * table (`medianHpPct`, `n`) or the engine's own `gridHpPct` reading at a
 * whole second (`hpAtCrossPct`, `minHpPct`) — the `[STATE]` tick's sampler.
 * The `[ref=…]` suffix is machine-readable on purpose: the eval gate
 * `checkCdPriorRefConsistency` re-parses the line and redoes the lookup.
 */
import type { CdPriorHoldEpisode } from "../analysis/cdTriggerPrior";
import { CRISIS_HP_PCT_RENDERED } from "../analysis/crisisDecisionPoints";
import { fmtTime } from "../utils/renderGrid";

export const CD_PRIOR_TAG = "[CD PRIOR]";

/** At most this many lines per round — the cap every sibling context/candidate
 * producer uses (`BURST_ANSWERED_CAP`, `CD_HOARD_CAP`). Selection is by
 * depth of the dip (lowest `minHpPct` first), emission is by time. */
export const CD_PRIOR_CAP = 2;

export const CD_PRIOR_LEGEND = [
  `  ${CD_PRIOR_TAG} = a friendly dipped below the HP at which this healer's cohort (spec × hero tree, from the corpus) usually spends a save cooldown, while the owner had it ready and did not spend it — context, not a mistake.`,
  `    The cohort number is a median of what most players do, not a rule; dips that reached the crisis line (${CRISIS_HP_PCT_RENDERED}%) are judged by the crisis lines instead and are not listed here. At most ${CD_PRIOR_CAP} per round.`,
];

export interface CdPriorEntry {
  /** whole second of the crossing — already on `fmtTime`'s grid */
  atSeconds: number;
  /** the line WITHOUT its timestamp prefix (the caller adds `fmtTime`) */
  line: string;
}

export function formatCdPriorLines(
  episodes: CdPriorHoldEpisode[],
  cohort: { spec: string; heroTree: string },
  overrides?: { cap?: number },
): CdPriorEntry[] {
  const cap = overrides?.cap ?? CD_PRIOR_CAP;
  const ranked = [...episodes].sort(
    (a, b) => a.minHpPct - b.minHpPct || a.tSec - b.tSec,
  );
  return ranked
    .slice(0, cap)
    .map((e) => {
      const cohortLabel =
        e.ref.fellBack || cohort.heroTree === "*"
          ? `${cohort.spec} (spec-wide)`
          : `${cohort.spec} · ${cohort.heroTree}`;
      const who = e.minUnitIsOwner ? `${e.minUnitName} (you)` : e.minUnitName;
      return {
        atSeconds: e.tSec,
        line:
          `${CD_PRIOR_TAG}   ${cohortLabel} cohort spends ${e.spellName} at a median lowest-friendly HP of ${e.ref.medianHpPct}% (n=${e.ref.n}); ` +
          `${who} fell below that at ${fmtTime(e.tSec)} (${e.hpAtCrossPct}%) and bottomed at ${e.minHpPct}% by ${fmtTime(e.minSec)} with ${e.spellName} ready and unspent` +
          (e.ownerLockedSecs > 0
            ? ` (you could not cast for ${e.ownerLockedSecs}s of that dip)`
            : "") +
          ` — context, not a mistake [ref=${e.ref.cellKey}]`,
      };
    })
    .sort((a, b) => a.atSeconds - b.atSeconds);
}
