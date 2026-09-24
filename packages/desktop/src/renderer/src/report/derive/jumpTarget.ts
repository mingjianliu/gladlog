import type { CandidateEvent } from "@gladlog/analysis";

/** Evidence-chain jump target: the earliest instant among the events a finding
 *  references, plus every unit involved. */
interface JumpTarget {
  /** Seconds relative to the start of the match */
  t: number;
  unitNames: string[];
}

/**
 * Resolves a finding's eventIds into a replay jump target.
 *
 * Returns null when no candidate event matches — the caller uses that to **not
 * jump** (rather than jumping to 0:00). This lookup logic used to be inlined in
 * StructuredAnalysisPanel with no test coverage at all: a seeded E2E cannot
 * exercise it (fabricated eventIds never hit real candidates), so it can only be
 * pinned down by unit tests at this layer.
 */
export function resolveJumpTarget(
  candidates: readonly CandidateEvent[],
  eventIds: readonly string[],
): JumpTarget | null {
  const hits = candidates.filter((c) => eventIds.includes(c.id));
  if (hits.length === 0) return null;
  const earliest = hits.reduce((a, b) => (a.t <= b.t ? a : b));
  return {
    t: earliest.t,
    unitNames: [...new Set(hits.flatMap((e) => e.unitNames))],
  };
}
