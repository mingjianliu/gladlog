/**
 * scan5/t116.ts — ticket T116 (fact13 G1): a menu row printing a unit's
 * client-localized name. A kick by a warlock's Felhunter put the pet's own
 * name — CJK on a Chinese client, in no roster — into the kick-eaten row's
 * `units=` and `source=`, while the [KICK] line and the row's own
 * `nearestKicker=` named it through its owner (`X's pet`).
 *
 *  - `menuCjkLeak`: a findings row (`- id=…`) that `checkCjkLeak` — the
 *    prompt gate, fed the context's roster lines so player names are
 *    scrubbed exactly as in the gate — fails on. Checked = every menu row.
 *    Kind = the row's `type=` and where the name sits (`units` / `facts`).
 */
import { checkCjkLeak } from "../../src/quality/promptQualityCheck";
import type { IRoundCtx } from "./ctx";

export const CHECKS = ["menuCjkLeak"] as const;

const ROW_RE = /^\s*- id=(\S+) type=(\S+)/;
const ROSTER_RE = /<unit\s+id="\d+"\s+name="[^"]+"/;

export function run(ctx: IRoundCtx): void {
  if (!ctx.menu) return;
  const roster = ctx.lines.filter((l) => ROSTER_RE.test(l));
  const rows = ctx.menu.split("\n").filter((l) => ROW_RE.test(l));
  const C = "menuCjkLeak";
  for (const row of rows) {
    ctx.bump(C);
    if (checkCjkLeak([...roster, row]).length === 0) continue;
    const m = ROW_RE.exec(row)!;
    const units = /units=(\S+)/.exec(row)?.[1] ?? "";
    const where = checkCjkLeak([...roster, `units=${units}`]).length
      ? "units"
      : "facts";
    ctx.violate(
      C,
      `${m[2]} ${where}`,
      ctx.start,
      m[1]!,
      `untranslated name in a ${m[2]} row's ${where}`,
      row.trim().slice(0, 300),
    );
  }
}
