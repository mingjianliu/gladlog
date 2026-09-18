/**
 * teammate-crisis-idle — "a teammate crossed the crisis line while taking
 * dangerous damage; you were free to act, in reach and in line of sight, with
 * mana; you cast nothing in the window and nothing of yours was healing them"
 * (GH #95, 2026-09-17).
 *
 * The healer-side twin of `crisis-no-response`. User rulings: 2026-09-13
 * "队友被打也要算进去"; 2026-09-17 "这个东西可以做一下指控,我觉得价值其实挺高的" —
 * an ACCUSATION, overruling codex R3's observation-only ruling, on the
 * strength of the feasibility door (every codex R1/R2 exclusion is applied
 * in `analysis/teammateCrisis.ts`, which makes it rare: 60 clean-idle
 * points in 11,536 rounds on the 1/10 archive, 0.0052 per round). Same
 * discipline as the twin: the reference is OUTCOME-based (teammate death
 * within 10 s when the healer cast nothing vs when the healer answered, same
 * exclusions on both sides), the producer never reads `diedWithin10s`, and
 * the model cites the numbers and never prescribes a button.
 *
 * Enemy burst is a FACT on the card ("X opened Y Ns earlier"); when the
 * press came ≥ `TEAMMATE_CRISIS_CUE_MIN_S` before the crossing the fact is
 * labelled a cue (cooldown trackers show it — user ruling 2026-09-17).
 * Spec: docs/superpowers/specs/2026-09-16-teammate-crisis-design.md.
 */
import {
  lookupTeammateCrisisPriorByBin,
  lookupTeammateCrisisTriageByBin,
  teammateCrisisDmgBinOf,
  type TeammateCrisisPriorRef,
  type TeammateCrisisTriageRef,
} from "../../data/teammateCrisisPrior";
import {
  type DecisionRecord,
  isDecisionTraceActive,
  traceDecision,
} from "../../facts/decisionTrace";
import { fmtTime } from "../../utils/renderGrid";
import { RESPONSE_PRE_MS, RESPONSE_WINDOW_MS } from "../crisisDecisionPoints";
import { fmtFactNum as fmt } from "../factFormat";
import {
  TEAMMATE_CRISIS_CUE_MIN_S,
  type TeammateCrisisPoint,
} from "../teammateCrisis";
import type { CandidateEvent } from "../types";

export const TEAMMATE_CRISIS_IDLE_CAP = 2;

/** The rendered window edges: `RESPONSE_PRE_MS` before the crossing (floored
 * to the grid) to `RESPONSE_WINDOW_MS` after it — the same window the
 * predicate judged "cast nothing" over. */
export function teammateCrisisWindowSeconds(tSec: number): {
  from: number;
  to: number;
} {
  return {
    from: Math.max(0, Math.floor(tSec - RESPONSE_PRE_MS / 1000)),
    to: Math.floor(tSec + RESPONSE_WINDOW_MS / 1000),
  };
}

export function teammateCrisisIdleEvents(
  points: TeammateCrisisPoint[],
  owner: { id: string; name: string },
  bracket: string,
  probes: {
    lookup: (
      bin: ReturnType<typeof teammateCrisisDmgBinOf>,
    ) => TeammateCrisisPriorRef | null;
  } = { lookup: (bin) => lookupTeammateCrisisPriorByBin(bracket, bin) },
  overrides?: { cap?: number },
): CandidateEvent[] {
  const cap = overrides?.cap ?? TEAMMATE_CRISIS_IDLE_CAP;
  const eligible = points.filter((p) => p.cleanIdle);
  // danger order — biggest 2 s hit first, then earliest; NEVER outcome
  const ranked = [...eligible].sort(
    (a, b) => b.dmg2s - a.dmg2s || a.tSec - b.tSec,
  );
  const tracing = isDecisionTraceActive();
  const trace: DecisionRecord[] = [];
  const oppId = (p: TeammateCrisisPoint) =>
    `teammate-crisis-idle:${owner.id}:${p.mateId}:${Math.round(p.tSec)}`;
  const facts = (p: TeammateCrisisPoint) => ({
    tSec: p.tSec,
    mate: p.mateName,
    hpPct: p.hpPct,
    dmg2s: p.dmg2s,
    excluded: p.excluded,
    idleReason: p.idleReason,
    healerAnswers: p.healerAnswers,
    mateResponded: p.mateResponded,
    distanceYd: p.distanceYd,
    manaPct: p.manaPct,
  });
  if (tracing) {
    for (const p of points) {
      if (p.cleanIdle) continue;
      trace.push({
        type: "teammate-crisis-idle",
        opportunityId: oppId(p),
        ownerId: owner.id,
        verdict: p.excluded ? "ineligible" : "suppressed",
        reason: p.excluded
          ? p.excluded
          : p.healerAnswered
            ? "healer-answered"
            : p.mateResponded
              ? "mate-responded"
              : (p.idleReason ?? "not-idle"),
        facts: facts(p),
        candidateIds: [],
      });
    }
    for (const p of ranked.slice(cap))
      trace.push({
        type: "teammate-crisis-idle",
        opportunityId: oppId(p),
        ownerId: owner.id,
        verdict: "suppressed",
        reason: "capped",
        facts: facts(p),
        candidateIds: [],
      });
  }
  const out: CandidateEvent[] = [];
  for (const p of ranked.slice(0, cap)) {
    const bin = teammateCrisisDmgBinOf(p.dmg2s);
    const ref = probes.lookup(bin);
    if (!ref) {
      if (tracing)
        trace.push({
          type: "teammate-crisis-idle",
          opportunityId: oppId(p),
          ownerId: owner.id,
          verdict: "suppressed",
          reason: "no-reference",
          facts: facts(p),
          candidateIds: [],
        });
      continue; // no baseline → no accusation
    }
    if (tracing)
      trace.push({
        type: "teammate-crisis-idle",
        opportunityId: oppId(p),
        ownerId: owner.id,
        verdict: "emitted",
        facts: { ...facts(p), cellKey: ref.cellKey },
        candidateIds: [oppId(p)],
      });
    const w = teammateCrisisWindowSeconds(p.tSec);
    const burst = p.enemyBurst;
    out.push({
      id: oppId(p),
      type: "teammate-crisis-idle",
      t: p.tSec,
      unitNames: [owner.name, p.mateName],
      facts: {
        t: fmt(p.tSec),
        unit: owner.name,
        mate: p.mateName,
        mateHpPct: String(p.hpPct),
        dmg2sPct: String(Math.round(p.dmg2s * 100)),
        // "; " — ", " is the facts separator the gate splits on
        attackers: p.attackerNames.length ? p.attackerNames.join("; ") : "none",
        windowFrom: fmtTime(w.from),
        windowTo: fmtTime(w.to),
        distanceYd: p.distanceYd === null ? "?" : String(p.distanceYd),
        externalsReady: p.externalsReady.length
          ? p.externalsReady.map((e) => e.spellName).join("; ")
          : "none",
        burst: burst
          ? `${burst.casterName} ${burst.spellName} ${burst.secondsBefore}s before`
          : "none",
        burstCue:
          burst && burst.secondsBefore >= TEAMMATE_CRISIS_CUE_MIN_S
            ? "yes"
            : "no",
        refNIdle: String(ref.nIdle),
        refDeathIdle: String(ref.deathIdlePct),
        refNAnswered: String(ref.nAnswered),
        refDeathAnswered: String(ref.deathAnsweredPct),
        cellKey: ref.cellKey,
        fellBack: ref.fellBack ? "yes" : "no",
      },
    });
  }
  // select by danger (cap), emit in time order — like every sibling producer
  trace.forEach(traceDecision);
  return out.sort((a, b) => a.t - b.t);
}

export const TEAMMATE_CRISIS_TRIAGE_CAP = 1;

/**
 * teammate-crisis-triage (user ruling 2026-09-17 「1 我觉得可以」): the healer
 * was free, in reach and in LoS, answered neither this teammate nor — and
 * spent the window casting on ANOTHER friendly whose [STATE] HP was above
 * the crisis line, while the teammate who crossed did not answer either.
 * Reference: at comparable moments, the teammate died within 10 s X % when
 * the other recipient was NOT in crisis vs Y % when they WERE (Solo Shuffle
 * 44 % vs 21 % on the full archive; 3v3 has 36 / 14 points and falls under
 * the floor, so nothing renders there yet). Same discipline as the twin —
 * cite, never prescribe.
 */
export function teammateCrisisTriageEvents(
  points: TeammateCrisisPoint[],
  owner: { id: string; name: string },
  bracket: string,
  probes: {
    lookup: (
      bin: ReturnType<typeof teammateCrisisDmgBinOf>,
    ) => TeammateCrisisTriageRef | null;
  } = { lookup: (bin) => lookupTeammateCrisisTriageByBin(bracket, bin) },
  overrides?: { cap?: number },
): CandidateEvent[] {
  const cap = overrides?.cap ?? TEAMMATE_CRISIS_TRIAGE_CAP;
  const eligible = points.filter((p) => p.misprioritized && p.busyOn);
  const ranked = [...eligible].sort(
    (a, b) => b.dmg2s - a.dmg2s || a.tSec - b.tSec,
  );
  const tracing = isDecisionTraceActive();
  const trace: DecisionRecord[] = [];
  const oppId = (p: TeammateCrisisPoint) =>
    `teammate-crisis-triage:${owner.id}:${p.mateId}:${Math.round(p.tSec)}`;
  const facts = (p: TeammateCrisisPoint) => ({
    tSec: p.tSec,
    mate: p.mateName,
    hpPct: p.hpPct,
    dmg2s: p.dmg2s,
    excluded: p.excluded,
    idleReason: p.idleReason,
    busyOn: p.busyOn,
    busyOnInCrisis: p.busyOnInCrisis,
  });
  if (tracing) {
    for (const p of points)
      if (!p.misprioritized)
        trace.push({
          type: "teammate-crisis-triage",
          opportunityId: oppId(p),
          ownerId: owner.id,
          verdict: p.excluded ? "ineligible" : "suppressed",
          reason: p.excluded
            ? p.excluded
            : p.healerAnswered
              ? "healer-answered"
              : p.idleReason !== "busyElsewhere"
                ? "not-busy-elsewhere"
                : p.busyOnInCrisis
                  ? "other-recipient-in-crisis"
                  : "recipient-hp-unknown",
          facts: facts(p),
          candidateIds: [],
        });
    for (const p of ranked.slice(cap))
      trace.push({
        type: "teammate-crisis-triage",
        opportunityId: oppId(p),
        ownerId: owner.id,
        verdict: "suppressed",
        reason: "capped",
        facts: facts(p),
        candidateIds: [],
      });
  }
  const out: CandidateEvent[] = [];
  for (const p of ranked.slice(0, cap)) {
    const bin = teammateCrisisDmgBinOf(p.dmg2s);
    const ref = probes.lookup(bin);
    if (!ref) {
      if (tracing)
        trace.push({
          type: "teammate-crisis-triage",
          opportunityId: oppId(p),
          ownerId: owner.id,
          verdict: "suppressed",
          reason: "no-reference",
          facts: facts(p),
          candidateIds: [],
        });
      continue;
    }
    if (tracing)
      trace.push({
        type: "teammate-crisis-triage",
        opportunityId: oppId(p),
        ownerId: owner.id,
        verdict: "emitted",
        facts: { ...facts(p), cellKey: ref.cellKey },
        candidateIds: [oppId(p)],
      });
    const w = teammateCrisisWindowSeconds(p.tSec);
    out.push({
      id: oppId(p),
      type: "teammate-crisis-triage",
      t: p.tSec,
      unitNames: [owner.name, p.mateName, p.busyOn!.name],
      facts: {
        t: fmt(p.tSec),
        unit: owner.name,
        mate: p.mateName,
        mateHpPct: String(p.hpPct),
        dmg2sPct: String(Math.round(p.dmg2s * 100)),
        attackers: p.attackerNames.length ? p.attackerNames.join("; ") : "none",
        windowFrom: fmtTime(w.from),
        windowTo: fmtTime(w.to),
        castOn: p.busyOn!.name,
        castOnHpPct: String(p.busyOn!.hpPct),
        castSpell: p.busyOn!.spellName,
        distanceYd: p.distanceYd === null ? "?" : String(p.distanceYd),
        refNWrong: String(ref.nTriageWrong),
        refDeathWrong: String(ref.deathTriageWrongPct),
        refNOther: String(ref.nTriageOther),
        refDeathOther: String(ref.deathTriageOtherPct),
        cellKey: ref.cellKey,
        fellBack: ref.fellBack ? "yes" : "no",
      },
    });
  }
  trace.forEach(traceDecision);
  return out.sort((a, b) => a.t - b.t);
}
