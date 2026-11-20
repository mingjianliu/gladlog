/**
 * scan5/t217.ts — pipeline T217 (round-14 D32, 7cadec17 r0 2:18): two
 * priests put Power Infusion on one warlock in one rendered second; the
 * first lasted 0.47 s, the second 15 s, and `[ENEMY BUFF]` printed
 * `unpurged for 15s` on the first — whose own `[ENEMY BUFF END]` follows in
 * the same second — and a bare `(purgeable)` on the second.
 *
 * Read from the rendered lines alone:
 *  - `unpurgedOutlastsBuffLine`: every `[ENEMY BUFF] <pid>: <spell> (…
 *    unpurged for Ns …)` line that has an `[ENEMY BUFF END]` of the same
 *    unit and spell after it. A window ends at the buff's removal
 *    (`unpurgedForText`: N is its length, rounded) and both stamps floor to
 *    the second, so the END line is at least N − 1 s later; a violation
 *    when it comes sooner — the window is another application's. A buff
 *    that reaches the round's end has no END line and is not judged.
 */
import { UNPURGED_FOR_RE_SRC } from "@gladlog/analysis/src/utils/dispelAnalysis";

import { type IRoundCtx, secOf } from "./ctx";

export const CHECKS = ["unpurgedOutlastsBuffLine"] as const;

const BUFF_RE = new RegExp(
  String.raw`^\s*(\d+:\d\d)\s+\[ENEMY BUFF\]\s+(\d+\([^)]*\)): (.+?) \(.*${UNPURGED_FOR_RE_SRC}`,
);
const END_RE = /^\s*(\d+:\d\d)\s+\[ENEMY BUFF END\]\s+(\d+\([^)]*\)): (.+?)\s*$/;

export interface IUnpurgedBuffLine {
  line: string;
  unit: string;
  spell: string;
  startS: number;
  unpurgedS: number;
  /** its `[ENEMY BUFF END]`'s second; undefined = none after it */
  endS?: number;
}

/** every annotated `[ENEMY BUFF]` line with the END line that follows it */
export function unpurgedBuffLines(
  lines: readonly string[],
): IUnpurgedBuffLine[] {
  const out: IUnpurgedBuffLine[] = [];
  lines.forEach((l, i) => {
    const m = BUFF_RE.exec(l);
    if (!m) return;
    const row: IUnpurgedBuffLine = {
      line: l,
      unit: m[2]!,
      spell: m[3]!,
      startS: secOf(m[1]!),
      unpurgedS: Number(m[4]),
    };
    for (let j = i + 1; j < lines.length; j++) {
      const e = END_RE.exec(lines[j]!);
      if (e && e[2] === row.unit && e[3] === row.spell) {
        row.endS = secOf(e[1]!);
        break;
      }
    }
    out.push(row);
  });
  return out;
}

/** does the window outlast the line's own buff */
export const outlastsOwnBuff = (r: IUnpurgedBuffLine): boolean =>
  r.endS !== undefined && r.endS - r.startS < r.unpurgedS - 1;

export function run(ctx: IRoundCtx): void {
  for (const r of unpurgedBuffLines(ctx.lines)) {
    if (r.endS === undefined) continue;
    ctx.bump("unpurgedOutlastsBuffLine");
    if (outlastsOwnBuff(r))
      ctx.violate(
        "unpurgedOutlastsBuffLine",
        r.spell,
        ctx.start + r.startS * 1000,
        `${r.unit}:${r.spell}:${r.startS}`,
        `${r.unit} ${r.spell}: unpurged for ${r.unpurgedS}s on a buff whose END line is ${r.endS - r.startS}s later`,
        r.line.trim().slice(0, 240),
      );
  }
}
