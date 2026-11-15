/* eslint-disable @typescript-eslint/no-explicit-any -- the check walks the untyped legacy parse objects */
/**
 * scan5/t119.ts — ticket T119 (fact12 retest, cf63da4a r0 0:22): a
 * `[MINOR DISPELS]` line is stamped at its source's first removal and its
 * non-deliberate parts (`X (passive)`, `X (side effect of the cast)`) carry
 * no time of their own, so a part that removed nothing until later reads as
 * removing at the line's second (Fortifying Brew, first removal 1:43, on a
 * line stamped 0:22).
 *
 *  - `minorPartStampedEarly`: per non-deliberate part of a player's line
 *    (pet / guardian lines skipped), the source's SPELL_DISPEL /
 *    SPELL_STOLEN rows of that spell name in the round, merged by
 *    `MINOR_DISPEL_CAST_MERGE_S`. Violation `firstLater`: the part's first
 *    removal is in a later second than the line's stamp. Kind `foldedLater`
 *    (out of the total): the first is in the stamp's second, a later one is
 *    not — the counted `xN` fold. Counted: every such part with a row.
 */
import { MINOR_DISPEL_CAST_MERGE_S } from "@gladlog/analysis/src/context/timelineSections/minorDispels";

import { ev, fmtS, type IRoundCtx, nameOf, secOf, tsOf } from "./ctx";

export const CHECKS = ["minorPartStampedEarly"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "minorPartStampedEarly|foldedLater",
]);

const LINE =
  /^\s*(\d+:\d\d)\s+\[MINOR DISPELS\]\s+(\d+)\([^)]*\)('s \w+)?: (.*) \(low-priority, folded\)\s*$/;
const PART = /^(.+?) \((passive|side effect of the cast)\)(?: x\d+)?$/;
const DISPEL_ROWS = new Set(["SPELL_DISPEL", "SPELL_STOLEN"]);

/** top-level `, ` split (a deliberate part's list nests `, +N`) */
function partsOf(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && body.startsWith(", ", i)) {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function run(ctx: IRoundCtx): void {
  const C = "minorPartStampedEarly";
  for (const l of ctx.lines) {
    const m = LINE.exec(l);
    if (!m || m[3]) continue;
    const stamp = secOf(m[1]!);
    const unit = ctx.unitOfPid(m[2]);
    if (!unit) continue;
    for (const part of partsOf(m[4]!)) {
      const p = PART.exec(part.trim());
      if (!p) continue;
      const name = p[1]!;
      const instants: number[] = [];
      for (const t of ((unit.actionOut ?? []) as any[])
        .filter(
          (r) =>
            DISPEL_ROWS.has(ev(r)) &&
            r.srcUnitId === unit.id &&
            nameOf(r.spellId, r.spellName) === name &&
            tsOf(r) >= ctx.start &&
            tsOf(r) <= ctx.roundEndAt,
        )
        .map(tsOf)
        .sort((a, b) => a - b))
        if (
          !instants.some(
            (x) => Math.abs(x - t) <= MINOR_DISPEL_CAST_MERGE_S * 1000,
          )
        )
          instants.push(t);
      if (instants.length === 0) continue;
      ctx.bump(C);
      const secs = instants.map((t) => Math.floor((t - ctx.start) / 1000));
      if (secs[0]! > stamp)
        ctx.violate(
          C,
          "firstLater",
          instants[0]!,
          `${unit.id}#${part}#${m[1]}`,
          `${part} first removed at ${fmtS(secs[0]!)}; the line is stamped ${m[1]}`,
          l.trim(),
        );
      else if (secs.some((s) => s > stamp))
        ctx.violate(
          C,
          "foldedLater",
          instants[0]!,
          `${unit.id}#${part}#${m[1]}`,
          `${part} removed at ${secs.map(fmtS).join(", ")}; the line is stamped ${m[1]}`,
          l.trim(),
        );
    }
  }
}
