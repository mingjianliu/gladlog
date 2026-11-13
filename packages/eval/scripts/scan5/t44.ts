/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t44.ts — ticket T44 (r12 D26, r12b N7): the `rooted Ns` of a
 * POSITIONING `STAYED IN` line counts every root that stopped the owner
 * moving. Truth is the owner's aura rows of the movement-root set
 * (`ROOT_SPELL_IDS` / `ROOT_DR_IDS`, table lookups).
 *
 *  - `stayedInRootUnder`: the owner carried a movement root — an aura of
 *    the root DR class, or any other root aura another unit applied, from
 *    its APPLIED row to its REMOVED / BROKEN row (a run the log never
 *    closes is not judged), never past the round's end — for more of the
 *    span than the line says: the merged root time inside the
 *    seconds wholly inside the printed span (the line prints whole seconds,
 *    the producer reads the span's own bounds) is over the printed `rooted
 *    Ns` (0 when the line has none, under 1 for `<1`) by more than half a
 *    second. Kind = the root that held longest. Counted: every STAYED IN
 *    line whose span meets a movement root of the owner.
 */
import {
  ROOT_DR_IDS,
  ROOT_SPELL_IDS,
} from "@gladlog/analysis/src/data/rootSpells";
import { LogEvent } from "@gladlog/parser-compat";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REMOVED,
  secOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["stayedInRootUnder"] as const;

const HEADER = /^ {2}STAYED IN during enemy burst/;
const LINE = /^ {4}(\d+:\d{2})–(\d+:\d{2}) \[[^\]]+\] .*/;
const ROOTED = / — rooted (<1|\d+)s/;
const ENDS = new Set<string>([
  REMOVED,
  LogEvent.SPELL_AURA_BROKEN,
  LogEvent.SPELL_AURA_BROKEN_SPELL,
]);

export function run(ctx: IRoundCtx): void {
  const C = "stayedInRootUnder";
  if (!ctx.owner) return;
  // the owner's movement-root runs, each APPLIED to its next REMOVED
  const auras = (ctx.owner.auraEvents ?? []) as any[];
  const runs: Array<{ from: number; to: number; name: string }> = [];
  auras.forEach((a, i) => {
    const id = String(a.spellId ?? "");
    if (ev(a) !== APPLIED || !ROOT_SPELL_IDS.has(id)) return;
    if (!ROOT_DR_IDS.has(id) && a.srcUnitId === ctx.owner.id) return;
    // its end is the row that took it off: its REMOVED, or the row of the
    // hit that broke it. A run the log never closes has no end on the rows
    // (the producer caps it at the aura's length) and is not judged (codex
    // 85-tk-H-T44-1 #2)
    const rm = auras.find(
      (b, j) =>
        j > i &&
        ENDS.has(ev(b)) &&
        b.spellId === a.spellId &&
        b.srcUnitId === a.srcUnitId,
    );
    if (!rm) return;
    runs.push({
      from: tsOf(a),
      to: Math.min(tsOf(rm), ctx.roundEndAt),
      name: nameOf(id, a.spellName),
    });
  });
  let inBlock = false;
  for (const l of ctx.lines) {
    if (HEADER.test(l)) {
      inBlock = true;
      continue;
    }
    const m = inBlock ? LINE.exec(l) : null;
    if (!m) {
      if (inBlock && !l.startsWith("    ")) inBlock = false;
      continue;
    }
    const lo = ctx.start + (secOf(m[1]!) + 1) * 1000;
    const hi = ctx.start + secOf(m[2]!) * 1000;
    const inside = runs
      .map((r) => ({
        ...r,
        from: Math.max(r.from, lo),
        to: Math.min(r.to, hi),
      }))
      .filter((r) => r.to > r.from)
      .sort((a, b) => a.from - b.from);
    if (inside.length === 0) continue;
    ctx.bump(C);
    let total = 0;
    let end = -Infinity;
    for (const r of inside) {
      total += Math.max(0, r.to - Math.max(r.from, end));
      end = Math.max(end, r.to);
    }
    const p = ROOTED.exec(l)?.[1];
    const printed = p === undefined ? 0 : p === "<1" ? 0.5 : Number(p);
    if (total / 1000 <= printed + 0.5) continue;
    const top = [...inside].sort((a, b) => b.to - b.from - (a.to - a.from))[0]!;
    ctx.violate(
      C,
      top.name,
      ctx.start + secOf(m[1]!) * 1000,
      `${m[1]}–${m[2]}`,
      `${p === undefined ? "no rooted clause" : `rooted ${p}s printed`}; the owner carried a movement root for ${(total / 1000).toFixed(1)}s of the span's whole seconds (${top.name})`,
      l.slice(0, 300),
    );
  }
}
