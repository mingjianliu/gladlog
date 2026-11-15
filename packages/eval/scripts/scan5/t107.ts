/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (auraEvents, spellCastEvents) */
/**
 * scan5/t107.ts — ticket T107 (fact13 D20, user ruling R41 2026-11-14:
 * "print it"): a spell a Death Knight cast through Dark Simulacrum — another
 * class's spell, copied off an enemy — gets the caster's press line, as any
 * press of theirs does. Truth is read off the log rows; lookups only name
 * things.
 *
 *  - `darkSimulacrumPressUnlined`: a player's SPELL_CAST_SUCCESS (not Dark
 *    Simulacrum itself) in the ms its Dark Simulacrum copy buff (77616) came
 *    off it — the copy spent; the producer's own selection
 *    (`darkSimulacrumCopyCasts`). For a unit on the owner's side, the
 *    context must print a press line of that spell at that second: `[YOU]
 *    [CD]   X` / `[YOU] [CC]   … X` for the owner, `[TEAM] [CD]   N(…) (…):
 *    X` / `[TEAM] [CC]   N(…) (…) cast X` for a teammate. Kind = the spell's
 *    name; a copy spent by a unit of the other side is counted as kind
 *    `enemy` (an inventory — out of the total).
 */
import { darkSimulacrumCopyCasts } from "@gladlog/analysis/src/context/timelineSections/friendlyUtilityPress";

import { fmtS, type IRoundCtx, nameOf, tsOf } from "./ctx";

export const CHECKS = ["darkSimulacrumPressUnlined"] as const;

/** the other side's copies: an inventory, not a defect */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "darkSimulacrumPressUnlined|enemy",
]);

export function run(ctx: IRoundCtx): void {
  const C = "darkSimulacrumPressUnlined";
  if (!ctx.owner) return;
  for (const u of ctx.players) {
    const mine = u.reaction === ctx.owner.reaction;
    if (!mine && !ctx.firstOwnerOfRound) continue;
    // the producer's own selection (FIX-CONTRACT step 7)
    for (const c of darkSimulacrumCopyCasts(u) as any[]) {
      const id = String(c.spellId);
      const t = tsOf(c);
      if (t < ctx.start || t > ctx.roundEndAt) continue;
      const name = nameOf(id, c.spellName ?? id);
      if (!mine) {
        ctx.violate(
          C,
          "enemy",
          t,
          `${u.id}#${id}#${t}`,
          `${u.name} spent a Dark Simulacrum copy of ${name} at ${((t - ctx.start) / 1000).toFixed(2)}s`,
        );
        continue;
      }
      ctx.bump(C);
      const sec = fmtS((t - ctx.start) / 1000);
      const pid = ctx.pidOf(u.name);
      const isOwner = u.id === ctx.owner.id;
      const printed = ctx.lines.some((l) => {
        const s = l.trim();
        if (!s.startsWith(`${sec}  `)) return false;
        return isOwner
          ? new RegExp(
              `\\[YOU\\] \\[(?:CD|CC)\\]\\s+.*\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
            ).test(s)
          : pid !== undefined &&
              (s.includes(`[TEAM] [CD]   ${pid}(`) ||
                s.includes(`[TEAM] [CC]   ${pid}(`)) &&
              (s.includes(`): ${name}`) || s.includes(` cast ${name}`));
      });
      if (printed) continue;
      ctx.violate(
        C,
        name,
        t,
        `${u.id}#${id}#${t}`,
        `${u.name} cast ${name} through Dark Simulacrum at ${((t - ctx.start) / 1000).toFixed(2)}s; no press line of it at ${sec}`,
      );
    }
  }
}
