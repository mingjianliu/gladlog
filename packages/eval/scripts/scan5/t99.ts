/**
 * scan5/t99.ts — ticket T99 (fact13 D18): a `| pressed during it: X ×N`
 * clause counts only presses of the owner's cooldown X — a button — never a
 * triggered sub-spell's refused row that only shares X's name (The Hunt
 * 370966, the charge's impact: "Can't do that while stunned" inside a Cheap
 * Shot, while the button 370965 had gone out). Truth is the recorder's own
 * SPELL_CAST_FAILED rows; DB2 only names what a row's id is.
 *
 *  - `pressedDuringSubSpell`: per item `X ×N` of an owner's `[CC ON TEAM]` /
 *    `[SILENCE]` line, the recorder's refused rows named X from the line's
 *    second to its end (its `| Ns`, else its `after Ns`, else
 *    `FALLBACK_SPAN_S`, plus a second for the floor). A row is a press when
 *    its id has a cooldown of its own in DB2, or DB2 does not know it. A
 *    violation when N is more than the presses and the window holds such a
 *    sub-spell row (the clause counted a row that is no button). The window
 *    is wide on purpose: a press in a neighbouring control only hides a
 *    violation, never makes one; a count the window reads short with no
 *    sub-spell row in it is not this class.
 *    Kind = X.
 */
import {
  effectiveCooldownSeconds,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";

import { type IRoundCtx, nameOf, secOf } from "./ctx";

export const CHECKS = ["pressedDuringSubSpell"] as const;

const LINE =
  /^(\d+:\d{2})\s+\[(?:CC ON TEAM|SILENCE)\]\s+.*\| pressed during it: (.+)$/;
const ITEMS = /(.+?) ×(\d+)(?:, |$)/g;
/** a line that prints no span of its own */
const FALLBACK_SPAN_S = 12;

const isButton = (id: string): boolean =>
  !spellEffectData[id] || (effectiveCooldownSeconds(id) ?? 0) > 0;

export function run(ctx: IRoundCtx): void {
  const C = "pressedDuringSubSpell";
  const streams = ctx.rawStreams();
  if (!streams.available || streams.castFailed.length === 0) return;
  const recorderId = streams.castFailed[0]!.unitGuid;
  if (ctx.owner?.id !== recorderId) return;
  const failed = streams.castFailed.filter((f) => f.unitGuid === recorderId);
  for (const l of ctx.lines) {
    const m = LINE.exec(l.trim());
    if (!m) continue;
    const from = secOf(m[1]!);
    const span =
      Number(/ \| (\d+)s(?: \[| \||$)/.exec(l)?.[1] ?? NaN) ||
      Number(/ after (\d+)s/.exec(l)?.[1] ?? NaN) ||
      FALLBACK_SPAN_S;
    const to = from + span + 1;
    // `X ×N` items; a name may hold a comma (`Invoke Chi-Ji, the Red Crane`)
    for (const it of m[2]!.matchAll(ITEMS)) {
      const name = it[1]!;
      const n = Number(it[2]!);
      ctx.bump(C);
      const rows = failed.filter(
        (f) =>
          f.tSeconds >= from &&
          f.tSeconds <= to &&
          nameOf(String(f.spellId), f.spellName) === name,
      );
      const presses = rows.filter((f) => isButton(String(f.spellId)));
      const sub = rows.filter((f) => !isButton(String(f.spellId)));
      // only a count the sub-spell rows explain: a window this scan reads
      // short (a line's span is printed in whole seconds) is not this class
      if (n <= presses.length || sub.length === 0) continue;
      ctx.violate(
        C,
        name,
        ctx.start + from * 1000,
        `${recorderId}#${name}#${m[1]}`,
        `the clause says ${name} ×${n}; the recorder's refused presses of it there are ${presses.length} (+${sub.length} row(s) of a same-named id with no cooldown: ${[...new Set(sub.map((f) => f.spellId))].join("/")})`,
        l.trim().slice(0, 300),
      );
    }
  }
}
