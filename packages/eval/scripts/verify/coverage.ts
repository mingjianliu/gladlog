/* eslint-disable @typescript-eslint/no-explicit-any -- reads each scan's accumulators by their common shapes */
/**
 * verify/coverage.ts — which archive exercises which check. `verify/run.ts
 * --coverage` records, per archive, the checks that counted a case on it and
 * the checks (and kinds) that failed on it; `verify/coverSet.ts` turns that
 * into the small set of archives a quick pass runs. A check that merely
 * failed nowhere is still covered only by an archive it counted on: a
 * zero-violation class has to be seen running, or a dead check passes.
 */
import type { IScan } from "./scan";

export interface ICoverageRow {
  archive: string;
  hit: string[];
  fail: string[];
}

const failuresOf = (state: any): Map<string, number> => {
  const out = new Map<string, number>();
  const fails = (state.missing ?? state.bad) as
    Map<string, string[]> | undefined;
  if (fails) for (const [c, l] of fails) out.set(c, l.length);
  const gates = state.total as Map<string, number> | undefined;
  if (gates) for (const [c, n] of gates) out.set(c, n);
  return out;
};

export class CoverageTracker {
  rows: ICoverageRow[] = [];
  private seen = new Map<string, number>();
  private violationsRead = new Map<string, number>();

  /** the scans' accumulators were emptied */
  restart(): void {
    this.seen.clear();
    this.violationsRead.clear();
  }

  /** everything the scans counted since the last call belongs to `archive` */
  step(archive: string, scans: Array<{ name: string; scan: IScan }>): void {
    const hit: string[] = [];
    const fail: string[] = [];
    const moved = (key: string, now: number): boolean => {
      const was = this.seen.get(key) ?? 0;
      this.seen.set(key, now);
      return now > was;
    };
    for (const { name, scan } of scans) {
      const state = scan.state() as any;
      const counts = (state.checked ?? state.expected) as
        Map<string, number> | undefined;
      if (counts)
        for (const [c, n] of counts)
          if (moved(`hit ${name}:${c}`, n)) hit.push(`${name}:${c}`);
      for (const [c, n] of failuresOf(state))
        if (moved(`fail ${name}:${c}`, n)) fail.push(`${name}:${c}`);
      const vs = state.violations as
        Array<{ check: string; kind: string }> | undefined;
      if (vs) {
        const from = this.violationsRead.get(name) ?? 0;
        const kinds = new Set<string>();
        for (let i = from; i < vs.length; i++) {
          const { check, kind } = vs[i]!;
          if (scan.inTotal?.(check, kind) ?? true)
            kinds.add(`${name}:${check}`);
          kinds.add(`${name}:${check}|${kind}`);
        }
        this.violationsRead.set(name, vs.length);
        fail.push(...kinds);
      }
    }
    if (hit.length + fail.length > 0) this.rows.push({ archive, hit, fail });
  }
}

/** What one scan's merged report states: its counted checks and — after
 * `report()` has run on the merged state — every `check|kind` it filed. */
export interface IReported {
  /** `<scan>:<check>` */
  id: string;
  checked: number;
  failed: number;
}

/**
 * A check a report states that no archive's row carries: counted or failed
 * only after the merge (`report`, `finalize`), so no archive can stand for
 * it. By check id, and by `check|kind` for the kinds the merged report holds
 * (GH #177 item 22): a check that files one kind while walking and another
 * only in its report (corpusFactScan `reflectReturn`: `unsupportedLine` in
 * the walk, `amount` in the report) is covered as a check once any archive
 * files the first, and its report-only kind had no gap entry.
 */
export function coverageGapsOf(
  rows: readonly ICoverageRow[],
  reported: readonly IReported[],
  reportedKinds: Iterable<string>,
): string[] {
  const items = new Set<string>();
  for (const r of rows) {
    for (const h of r.hit) items.add(`hit ${h}`);
    for (const f of r.fail) items.add(`fail ${f}`);
  }
  const gaps: string[] = [];
  for (const { id, checked, failed } of reported) {
    if (checked > 0 && !items.has(`hit ${id}`)) gaps.push(`hit ${id}`);
    if (failed > 0 && !items.has(`fail ${id}`)) gaps.push(`fail ${id}`);
  }
  for (const kind of [...new Set(reportedKinds)].sort())
    if (!items.has(`fail ${kind}`)) gaps.push(`fail ${kind}`);
  return gaps;
}
