import type { DeathRecap } from "./deathRecap";

/**
 * What a death recap already established about a death, split the way the
 * report says it: an immunity the victim left unpressed (not while CC'd), an
 * external a teammate could have given (not CC'd, could pay for it), and one
 * a teammate wanted to give but was CC'd.
 *
 * One predicate, two consumers: the report headline (VerdictLine, first of
 * each) and the replay's GCD lanes (every one, in the caster's lane at the
 * death). Both read the same DeathRecap fields through this function, so the
 * headline and the lanes can never disagree about what was "available".
 */
export interface DeathReasons {
  unpressed: DeathRecap["availableImmunities"];
  missed: DeathRecap["missedExternals"];
  blocked: DeathRecap["missedExternals"];
}

export function deathReasons(recap: DeathRecap): DeathReasons {
  return {
    unpressed: recap.availableImmunities.filter((i) => !i.wasInCC),
    missed: recap.missedExternals.filter(
      (m) => !m.casterWasInCC && !m.casterCouldNotPay,
    ),
    blocked: recap.missedExternals.filter((m) => m.casterWasInCC),
  };
}

/** A note pinned in one player's GCD lane at a death. */
export interface LaneNote {
  tMs: number;
  kind: "unpressed" | "missed" | "blocked";
  spellName: string;
}

/**
 * Lane notes keyed by unitId. `unitIdByName` resolves a recap's caster name
 * to the lane it belongs to; a caster with no lane (not in this replay) is
 * dropped rather than guessed.
 */
export function laneNotesFromRecaps(
  recaps: DeathRecap[],
  startTimeMs: number,
  unitIdByName: Map<string, string>,
): Record<string, LaneNote[]> {
  const out: Record<string, LaneNote[]> = {};
  const push = (unitId: string | undefined, note: LaneNote) => {
    if (!unitId) return;
    (out[unitId] ??= []).push(note);
  };
  for (const r of recaps) {
    const tMs = startTimeMs + r.deathS * 1000;
    const why = deathReasons(r);
    for (const i of why.unpressed)
      push(r.unitId, { tMs, kind: "unpressed", spellName: i.spellName });
    for (const m of why.missed)
      push(unitIdByName.get(m.casterName), {
        tMs,
        kind: "missed",
        spellName: m.spellName,
      });
    for (const m of why.blocked)
      push(unitIdByName.get(m.casterName), {
        tMs,
        kind: "blocked",
        spellName: m.spellName,
      });
  }
  return out;
}
