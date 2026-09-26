/**
 * `slow-defensive-response` — the enemy opened a burst window, nobody answered
 * inside 8 s, and the person under it went somewhere bad.
 *
 * GH #60 phase 2 (2026-09-01). The type name is unchanged; everything behind
 * it is. The retired predicate asked a per-OWNER question over the UNBOUNDED
 * builder windows ("did the healer react within 8 s of a window whose
 * `damageRatio` ≥ 1.5"); this one is decision-point shaped, exactly like
 * `crisisNoResponse.ts`:
 *
 *   decision point  the START of a bounded enemy burst window
 *                   (`burstWindowDecisionPoints`)
 *   behaviour       any friendly answering within 8 s — wall / external /
 *                   major healing CD / control on a caster / kite
 *   feasibility     the PRESSURED friendly could have saved themselves, or a
 *                   teammate had an ally-reaching tool ready (correction 1)
 *   triage          the pressured friendly reached the crisis HP line, or a
 *                   friendly died in the window (correction 2)
 *   outcome         never asserted — only the corpus reference
 *                   (`lookupBurstWindowPrior`) is cited, per lead CD and
 *                   bracket, as a descriptive contrast
 *
 * Every one of those predicates lives in the engine, which is also what the
 * corpus scan consumes, so the accused window and the quoted reference are
 * about the same population by construction (CLAUDE.md shared-predicate rule).
 * This module only selects, caps and renders.
 */
import type { BurstWindowPriorRef } from "../../data/burstWindowPrior";
import { burstRefClearsMinContrast } from "../../data/burstWindowPrior";
import {
  type DecisionRecord,
  isDecisionTraceActive,
  traceDecision,
} from "../../facts/decisionTrace";
import type { BurstWindowDecisionPoint } from "../burstWindowDecisionPoints";
import {
  BURST_RESPONSE_WINDOW_SEC,
  burstExtrasLabel,
} from "../burstWindowDecisionPoints";
import { fmtFactTime } from "../factFormat";
import type { CandidateEvent } from "../types";

/** At most this many windows per round reach the menu. Same cap as
 * `crisisNoResponse` / the retired predicate — two is what a coach can act on
 * and what every sibling producer in this directory uses. */
export const BURST_WINDOW_RESPONSE_CAP = 2;

/**
 * A window shorter than the response horizon it is judged against never
 * fires. Carried over from the retired predicate, whose own fairness gate
 * read "a no-reaction verdict requires the window itself to have lasted at
 * least the delay threshold — a player given a 6 s window is not held to an
 * 8 s standard"; the rewrite dropped it and this puts it back, as the SAME
 * number (`BURST_RESPONSE_WINDOW_SEC`, imported, never a second 8) compared
 * against the engine's already-render-grid `durationSec`.
 *
 * Measured on the 2026-09-01 archive scan (36,649 rounds, 62,298 feasible
 * windows): of the 7,301 windows that would otherwise fire, 1,009 (13.8%)
 * were shorter than the 8 s they were being judged over — 385 of them under
 * 4 s. Fire rate 11.7% → 10.1% of feasible windows, 0.199 → 0.172 per round.
 * The cut is in the "don't accuse" direction, not a volume knob.
 */
export const BURST_WINDOW_MIN_JUDGED_S = BURST_RESPONSE_WINDOW_SEC;

export function burstWindowResponseEvents(
  points: BurstWindowDecisionPoint[],
  owner: { id: string; name: string },
  probes: { lookup: (leadCdSpellId: string) => BurstWindowPriorRef | null },
  overrides?: { cap?: number },
): CandidateEvent[] {
  const cap = overrides?.cap ?? BURST_WINDOW_RESPONSE_CAP;
  // The reference lookup happens BEFORE the cap, not after: a window with no
  // cell, or with a cell whose contrast does not clear
  // `BURST_REF_MIN_CONTRAST_PP`, is not a candidate at all and must not eat
  // one of the two slots a window that IS one would have had. (Measured on
  // the 309-prompt corpus this freed no slot — 17 lines removed, 0 added —
  // because no round there had a third eligible window. It is still the
  // correct order: the alternative silently costs a real finding whenever a
  // round does.)
  const eligible = points
    .filter(
      (p) =>
        p.feasible &&
        p.triaged &&
        !p.responded &&
        p.pressured !== null &&
        p.durationSec >= BURST_WINDOW_MIN_JUDGED_S,
    )
    .map((p) => ({ p, ref: probes.lookup(p.leadCd.spellId) }))
    // no baseline → no accusation; a flat/reversed baseline → no accusation
    // either (the quoted numbers would argue against the sentence quoting
    // them — the door and the gate share `burstRefClearsMinContrast`)
    .filter(
      (e): e is { p: BurstWindowDecisionPoint; ref: BurstWindowPriorRef } =>
        e.ref !== null && burstRefClearsMinContrast(e.ref),
    );
  // Danger order: a window somebody died in first, then the deepest HP dip.
  // This is the SELECTION order only — the emitted order is time (see below),
  // the same split every sibling producer makes (spec §4, 2026-08-29 ruling).
  const ranked = [...eligible].sort(
    (a, b) =>
      Number(b.p.anyFriendlyDeath) - Number(a.p.anyFriendlyDeath) ||
      (a.p.pressured!.minHpPct ?? 101) - (b.p.pressured!.minHpPct ?? 101),
  );
  // GH #96 D6 decision trace: every bounded burst window is an opportunity.
  if (isDecisionTraceActive()) {
    const trace: DecisionRecord[] = [];
    const oppId = (p: BurstWindowDecisionPoint) =>
      `slow-defensive-response:${owner.id}:${p.tSec}`;
    const facts = (p: BurstWindowDecisionPoint) => ({
      tSec: p.tSec,
      leadCdId: p.leadCd.spellId,
      durationSec: p.durationSec,
      feasible: p.feasible,
      feasibleUnits: p.feasibleUnits,
      triaged: p.triaged,
      responses: p.responses,
      pressured: p.pressured?.unitId ?? null,
      pressuredMinHp: p.pressured?.minHpPct ?? null,
    });
    const kept = new Set(ranked.slice(0, cap).map((e) => e.p));
    const inEligible = new Set(eligible.map((e) => e.p));
    for (const p of points) {
      const base = {
        type: "slow-defensive-response",
        opportunityId: oppId(p),
        ownerId: owner.id,
        facts: facts(p),
      };
      if (!p.feasible || !p.triaged || p.pressured === null)
        trace.push({
          ...base,
          verdict: "ineligible",
          reason: !p.feasible
            ? "not-feasible"
            : p.pressured === null
              ? "no-pressured-friendly"
              : "not-triaged",
          candidateIds: [],
        });
      else if (p.responded)
        trace.push({
          ...base,
          verdict: "suppressed",
          reason: "responded",
          candidateIds: [],
        });
      else if (p.durationSec < BURST_WINDOW_MIN_JUDGED_S)
        trace.push({
          ...base,
          verdict: "ineligible",
          reason: "window-shorter-than-judged",
          candidateIds: [],
        });
      else if (!inEligible.has(p))
        trace.push({
          ...base,
          verdict: "suppressed",
          reason: "no-reference-or-flat-contrast",
          candidateIds: [],
        });
      else if (!kept.has(p))
        trace.push({
          ...base,
          verdict: "suppressed",
          reason: "capped",
          candidateIds: [],
        });
      else
        trace.push({ ...base, verdict: "emitted", candidateIds: [oppId(p)] });
    }
    trace.forEach(traceDecision);
  }
  const out: CandidateEvent[] = [];
  for (const { p, ref } of ranked.slice(0, cap)) {
    // Only the CDs inside the 8 s this sentence judges, each offset from the
    // opener — one helper with the [BURST ANSWERED] line.
    const extras = burstExtrasLabel(p);
    out.push({
      id: `slow-defensive-response:${owner.id}:${p.tSec}`,
      type: "slow-defensive-response",
      t: p.tSec,
      unitNames: [owner.name],
      spell: p.leadCd.spellName,
      spellId: p.leadCd.spellId,
      facts: {
        // `tSec` is already a whole rendered second (the engine floors the
        // lead cast onto `fmtTime`'s grid); `fmtFactTime` keeps it there.
        t: fmtFactTime(p.tSec),
        leadCd: p.leadCd.spellName,
        // The reference cell is keyed by this id, so the gate
        // (`checkBurstWindowRefConsistency`) needs it in the rendered text to
        // redo the lookup: `cellKey` alone cannot name it once the lookup fell
        // back to a `bracket|*` cell.
        leadCdId: p.leadCd.spellId,
        casterSpec: p.leadCd.casterSpec,
        caster: p.leadCd.casterName,
        ...(extras ? { extras } : {}),
        pressured: p.pressured!.name,
        pressuredHpPct: String(p.pressured!.minHpPct),
        // The rendered second `pressuredHpPct` was sampled at — NOT decoration:
        // it is what lets `checkCrisisHpStateConsistency` cross-check the HP
        // claim against that second's own `[STATE]` tick (the fact is a MIN
        // over the window, so the line's own `t` is the wrong second to check).
        pressuredHpT: fmtFactTime(p.pressured!.minHpSec ?? p.tSec),
        diedInWindow: p.anyFriendlyDeath ? "yes" : "no",
        refN: String(ref.nResp + ref.nNoResp),
        refDeathResp: String(ref.deathRespPct),
        refDeathNoResp: String(ref.deathNoRespPct),
        refTop: ref.topResponses.map(([k, v]) => `${k} ${v}%`).join("; "),
        cellKey: ref.cellKey,
        fellBack: ref.fellBack ? "yes" : "no",
      },
    });
  }
  return out.sort((a, b) => a.t - b.t);
}
