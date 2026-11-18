/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t174.ts — ticket T174 (round 13 P4): a `[HEALER EXPOSURE]` line's
 * `healer already in <control> until m:ss` states how long the healer stays
 * controlled from the window's start.
 *
 *  - `exposureAlreadyInEnd`: such a line while the healer's `[CC ON TEAM]`
 *    lines of the same context show another control on at the line's second
 *    that ends in a later second than the printed `until` — kind `a longer
 *    control is on`. Text against text: the other control is read from the
 *    rendered `[CC ON TEAM] <healer> ← <spell> … | Ns` lines (start second
 *    + the printed whole seconds), so only an end at least one rendered
 *    second past the claim counts. Checked = every `already in` line.
 */
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";

import { fmtS, type IRoundCtx, secOf } from "./ctx";

export const CHECKS = ["exposureAlreadyInEnd"] as const;

const LINE =
  /^\s*(\d+:\d\d)\s+\[HEALER EXPOSURE\].* — healer already in (.+?) until (\d+:\d\d) \(the DR levels count it\)/;
const CC =
  /^\s*(\d+:\d\d)\s+\[CC ON TEAM\]\s+(\d+)\([^)]*\) ← (.+?) \([^|]*\| (\d+(?:\.\d+)?)s\b/;

export function run(ctx: IRoundCtx): void {
  const healer = ctx.players.find(
    (u: any) => u.reaction === ctx.owner.reaction && isHealerSpec(u.spec),
  );
  if (!healer) return;
  const ccs: { from: number; to: number; spell: string }[] = [];
  for (const line of ctx.lines) {
    const m = CC.exec(line);
    if (!m || ctx.unitOfPid(m[2]!)?.id !== healer.id) continue;
    const from = secOf(m[1]!);
    ccs.push({ from, to: from + Number(m[4]), spell: m[3]! });
  }
  for (const line of ctx.lines) {
    const m = LINE.exec(line);
    if (!m) continue;
    ctx.bump("exposureAlreadyInEnd");
    const at = secOf(m[1]!);
    const until = secOf(m[3]!);
    // on at the line's second (strictly before it, so a control landing
    // later in that second is not asked) and ending over a second later
    const longer = ccs
      .filter((c) => c.from < at && c.to > until + 1 && c.spell !== m[2])
      .sort((a, b) => b.to - a.to)[0];
    if (longer)
      ctx.violate(
        "exposureAlreadyInEnd",
        "a longer control is on",
        ctx.start + at * 1000,
        `${ctx.roundKey}:${healer.id}:${at}`,
        `${longer.spell} from ${fmtS(longer.from)} for ${longer.to - longer.from} s; line says ${m[2]} until ${m[3]}`,
        line.trim().slice(0, 240),
      );
  }
}
