/**
 * crisis-no-response — "your HP crossed ≤40% while taking dangerous damage
 * (gate 5: dmg2s >= CRISIS_MIN_DMG2S), you were free to act, and you did
 * nothing for 3 s". Replaces the hindsight framing of death-unused-defensive
 * ("the wall was ready") with the one behaviour that actually separates
 * outcomes in the corpus: acting at all. Task 10 / spec §1b (2026-08-29
 * amendment, after the value gate): the reference cited is OUTCOME-based
 * (how often did NOT/DID responders die within 10 s), never rank-based — the
 * producer must never read `diedWithin10s` itself, only
 * data/behaviorPrior.ts's pre-aggregated reference. The model may cite these
 * numbers, never prescribe from them.
 * Spec: docs/superpowers/specs/2026-08-29-crisis-no-response-design.md.
 */
import { type BehaviorPriorRef, outcomePhrase } from "../../data/behaviorPrior";
import {
  type DecisionRecord,
  isDecisionTraceActive,
  traceDecision,
} from "../../facts/decisionTrace";
import type { DecisionPoint } from "../crisisDecisionPoints";
import { fmtFactNum as fmt } from "../factFormat";
import type { CandidateEvent } from "../types";

export const CRISIS_NO_RESPONSE_CAP = 2;

export function crisisNoResponseEvents(
  points: DecisionPoint[],
  owner: { id: string; name: string },
  bracket: string,
  probes: { lookup: (dmg2s: number) => BehaviorPriorRef | null },
  overrides?: { cap?: number },
): CandidateEvent[] {
  const cap = overrides?.cap ?? CRISIS_NO_RESPONSE_CAP;
  const eligible = points.filter(
    (p) => p.feasible && p.dangerous && !p.responded,
  );
  // danger order — enemyBurst, then attackers, then damage; NEVER outcome
  const ranked = [...eligible].sort(
    (a, b) =>
      Number(b.enemyBurst) - Number(a.enemyBurst) ||
      b.attackers2s - a.attackers2s ||
      b.dmg2s - a.dmg2s,
  );
  // GH #96 D6 decision trace: every decision point is an opportunity.
  const tracing = isDecisionTraceActive();
  const trace: DecisionRecord[] = [];
  const oppId = (p: DecisionPoint) =>
    `crisis-no-response:${owner.id}:${Math.round(p.tSec)}`;
  const facts = (p: DecisionPoint) => ({
    tSec: p.tSec,
    hpPct: p.hpPct,
    dmg2s: p.dmg2s,
    inCC: p.inCC,
    lockedOut: p.lockedOut,
    diedInWindow: p.diedInWindow,
    hasTool: p.hasTool,
    responses: p.responses,
  });
  if (tracing) {
    for (const p of points) {
      if (!p.dangerous || !p.feasible)
        trace.push({
          type: "crisis-no-response",
          opportunityId: oppId(p),
          ownerId: owner.id,
          verdict: "ineligible",
          reason: !p.dangerous
            ? "not-dangerous"
            : p.inCC
              ? "owner-in-cc"
              : p.lockedOut
                ? "owner-locked-out"
                : p.diedInWindow
                  ? "died-in-window"
                  : "no-tool",
          facts: facts(p),
          candidateIds: [],
        });
      else if (p.responded)
        trace.push({
          type: "crisis-no-response",
          opportunityId: oppId(p),
          ownerId: owner.id,
          verdict: "suppressed",
          reason: "responded",
          facts: facts(p),
          candidateIds: [],
        });
    }
    for (const p of ranked.slice(cap))
      trace.push({
        type: "crisis-no-response",
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
    const ref = probes.lookup(p.dmg2s);
    if (!ref) {
      if (tracing)
        trace.push({
          type: "crisis-no-response",
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
        type: "crisis-no-response",
        opportunityId: oppId(p),
        ownerId: owner.id,
        verdict: "emitted",
        facts: { ...facts(p), cellKey: ref.cellKey },
        candidateIds: [oppId(p)],
      });
    out.push({
      id: `crisis-no-response:${owner.id}:${Math.round(p.tSec)}`,
      type: "crisis-no-response",
      t: p.tSec,
      unitNames: [owner.name],
      facts: {
        t: fmt(p.tSec),
        unit: owner.name,
        hpPct: String(p.hpPct),
        dmg2sPct: String(Math.round(p.dmg2s * 100)),
        attackers: String(p.attackers2s),
        burst: p.enemyBurst ? "yes" : "no",
        refNNoResp: String(ref.nNoResp),
        refDeathNoResp: String(ref.deathNoRespPct),
        refNResp: String(ref.nResp),
        refDeathResp: String(ref.deathRespPct),
        refOutcome: outcomePhrase(ref.outcome), // prose, never the enum token — model pastes this straight into a sentence
        refOutcomeKey: ref.outcome, // enum, for the gate / desktop branch — never rendered as prose
        refTop: ref.top.map(([k, v]) => `${k} ${v}%`).join("; "), // "; " — ", " is the facts separator the gate splits on
        cellKey: ref.cellKey,
        fellBack: ref.fellBack ? "yes" : "no",
      },
    });
  }
  // 2026-08-29 ruling: select by danger (cap), emit in time order — like
  // every sibling producer in candidates/ (spec §4). The danger sort above
  // only decides which ≤cap points survive; it is not the order reported.
  trace.forEach(traceDecision);
  return out.sort((a, b) => a.t - b.t);
}
