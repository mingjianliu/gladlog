/**
 * Decision-level differential replay — classification (GH #96 D6).
 *
 * Two JSONL traces of the same recorded inputs, produced under two immutable
 * fact configurations (scripts/decisionTraceCapture.ts), are joined by
 * opportunity id and every opportunity is classified. Pure functions, so the
 * codex astra R2 fixtures run as unit tests:
 *  - an opportunity indeterminate in BOTH runs stays in the denominator;
 *  - an exception on one side is `evaluation-error`, never `removed`;
 *  - the result does not depend on which side ran first.
 */

export interface TraceLine {
  /** `${input}|${predicate opportunity id}` — input = file#round#owner */
  opportunityId: string;
  input: string;
  type: string;
  ownerId: string;
  spec: string;
  bracket: string;
  verdict:
    | "ineligible"
    | "suppressed"
    | "indeterminate"
    | "emitted"
    | "evaluation-error";
  reason?: string;
  facts: Record<string, unknown>;
  candidateIds: string[];
}

type DiffClass =
  | "unchanged"
  | "corrected-fact"
  | "removed"
  | "new"
  | "indeterminate"
  | "evaluation-error"
  | "unmatched";

interface DiffRow {
  opportunityId: string;
  type: string;
  spec: string;
  bracket: string;
  class: DiffClass;
  a?: Pick<TraceLine, "verdict" | "reason" | "facts" | "candidateIds">;
  b?: Pick<TraceLine, "verdict" | "reason" | "facts" | "candidateIds">;
}

const pick = (t: TraceLine) => ({
  verdict: t.verdict,
  ...(t.reason ? { reason: t.reason } : {}),
  facts: t.facts,
  candidateIds: t.candidateIds,
});

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([x], [y]) =>
            x < y ? -1 : 1,
          ),
        )
      : val,
  );

export function classifyPair(
  a: TraceLine | undefined,
  b: TraceLine | undefined,
  aInputErrored: boolean,
  bInputErrored: boolean,
): DiffClass {
  if (!a || !b) {
    if ((!a && aInputErrored) || (!b && bInputErrored))
      return "evaluation-error";
    return "unmatched";
  }
  if (a.verdict === "evaluation-error" || b.verdict === "evaluation-error")
    return "evaluation-error";
  const emittedA = a.verdict === "emitted";
  const emittedB = b.verdict === "emitted";
  if (
    a.verdict === b.verdict &&
    stable(a.candidateIds) === stable(b.candidateIds)
  ) {
    if (a.verdict === "indeterminate") return "indeterminate";
    return stable(a.facts) === stable(b.facts) && a.reason === b.reason
      ? "unchanged"
      : "corrected-fact";
  }
  if (a.verdict === "indeterminate" || b.verdict === "indeterminate")
    return "indeterminate";
  if (emittedA && !emittedB) return "removed";
  if (!emittedA && emittedB) return "new";
  // verdict moved between non-emitting states (e.g. ineligible → suppressed)
  return "corrected-fact";
}

export function diffTraces(a: TraceLine[], b: TraceLine[]): DiffRow[] {
  const erroredA = new Set(
    a.filter((t) => t.verdict === "evaluation-error").map((t) => t.input),
  );
  const erroredB = new Set(
    b.filter((t) => t.verdict === "evaluation-error").map((t) => t.input),
  );
  const index = (xs: TraceLine[]) => {
    const m = new Map<string, TraceLine>();
    for (const t of xs)
      if (t.verdict !== "evaluation-error") m.set(t.opportunityId, t);
    return m;
  };
  const ia = index(a);
  const ib = index(b);
  const ids = [...new Set([...ia.keys(), ...ib.keys()])].sort();
  const rows: DiffRow[] = [];
  for (const id of ids) {
    const x = ia.get(id);
    const y = ib.get(id);
    const ref = (x ?? y)!;
    rows.push({
      opportunityId: id,
      type: ref.type,
      spec: ref.spec,
      bracket: ref.bracket,
      class: classifyPair(
        x,
        y,
        !x && erroredA.has(ref.input),
        !y && erroredB.has(ref.input),
      ),
      ...(x ? { a: pick(x) } : {}),
      ...(y ? { b: pick(y) } : {}),
    });
  }
  // inputs that errored on one side and produced nothing there at all
  for (const input of new Set([...erroredA, ...erroredB])) {
    if (erroredA.has(input) && erroredB.has(input)) {
      const t = a.find(
        (z) => z.input === input && z.verdict === "evaluation-error",
      )!;
      rows.push({
        opportunityId: `${input}|evaluation`,
        type: t.type,
        spec: t.spec,
        bracket: t.bracket,
        class: "evaluation-error",
      });
    }
  }
  return rows;
}

interface DiffSummaryCell {
  /** opportunities eligible on at least one side (the denominator) */
  eligible: number;
  counts: Record<DiffClass, number>;
}

const emptyCounts = (): Record<DiffClass, number> => ({
  unchanged: 0,
  "corrected-fact": 0,
  removed: 0,
  new: 0,
  indeterminate: 0,
  "evaluation-error": 0,
  unmatched: 0,
});

/** Per type, and per type × spec × bracket. */
export function summarizeDiff(rows: DiffRow[]): {
  byType: Record<string, DiffSummaryCell>;
  byStratum: Record<string, DiffSummaryCell>;
} {
  const byType: Record<string, DiffSummaryCell> = {};
  const byStratum: Record<string, DiffSummaryCell> = {};
  const bump = (
    m: Record<string, DiffSummaryCell>,
    key: string,
    r: DiffRow,
  ) => {
    const cell = (m[key] ??= { eligible: 0, counts: emptyCounts() });
    const eligible =
      (r.a && r.a.verdict !== "ineligible") ||
      (r.b && r.b.verdict !== "ineligible") ||
      r.class === "evaluation-error";
    if (eligible) cell.eligible++;
    cell.counts[r.class]++;
  };
  for (const r of rows) {
    bump(byType, r.type, r);
    bump(byStratum, `${r.type}|${r.spec}|${r.bracket}`, r);
  }
  return { byType, byStratum };
}
