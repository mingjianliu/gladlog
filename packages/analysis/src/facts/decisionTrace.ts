/**
 * Decision trace — GH #96 D6 (codex astra R2 ruling 4).
 *
 * Joining two runs' EMITTED candidates cannot show what talent integration did
 * to coaching: a suppressed opportunity has no candidate, an opportunity that
 * is indeterminate in both runs disappears, and candidates carry no
 * denominator. So decision predicates record every OPPORTUNITY before
 * emission — eligible or not, emitted or not, with the facts the verdict read.
 *
 * The product never installs a sink, so `traceDecision` is a no-op there and
 * the call sites cost one null check. packages/eval/scripts/decisionTraceCapture.ts
 * installs one per replay process.
 */

export type DecisionVerdict =
  /** the opportunity was not in this predicate's scope (gate failed) */
  | "ineligible"
  /** in scope; the predicate decided NOT to accuse */
  | "suppressed"
  /** in scope; the facts could not support either verdict */
  | "indeterminate"
  /** in scope; a candidate was produced (it may still be capped) */
  | "emitted";

export interface DecisionRecord {
  /** candidate type the predicate feeds, e.g. "cd-hoarded" */
  type: string;
  /**
   * Stable across configurations for the SAME recorded input: built only from
   * input identity (owner, subject unit, rendered second, source spell…),
   * never from facts that talent integration can change.
   */
  opportunityId: string;
  ownerId: string;
  verdict: DecisionVerdict;
  /** machine-readable reason for ineligible / suppressed / indeterminate */
  reason?: string;
  /** the facts the verdict read (small, JSON-serialisable) */
  facts: Record<string, unknown>;
  /** candidate ids this opportunity produced (0..n) */
  candidateIds: string[];
}

export type DecisionSink = (record: DecisionRecord) => void;

let sink: DecisionSink | null = null;

/** Install (or clear with null) the process-wide sink. Eval-only. */
export function setDecisionSink(next: DecisionSink | null): void {
  sink = next;
}

export function isDecisionTraceActive(): boolean {
  return sink !== null;
}

export function traceDecision(record: DecisionRecord): void {
  if (sink) sink(record);
}
