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
