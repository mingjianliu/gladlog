/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/friendlyUtilityPress.ts — D19 / D26 of the round-7 audit (fact7 F21,
 * user ruling 2026-10-30): every friendly SPELL_CAST_SUCCESS of Spell
 * Reflection 23920 has a press line in its printed second.
 */
import { fmtS, type IRoundCtx, successesOf, tsOf } from "./ctx";

export const CHECKS = ["friendlyReflectLine"] as const;

export function run(ctx: IRoundCtx): void {
  const friends = ctx.players.filter(
    (u: any) => u.reaction === ctx.owner?.reaction,
  );
  for (const u of friends)
    for (const c of successesOf(u)) {
      if (String(c.spellId) !== "23920") continue;
      ctx.bump("friendlyReflectLine");
      const t = fmtS((tsOf(c) - ctx.start) / 1000);
      const pid = ctx.pidOf(u.name);
      const printed = ctx.lines.some(
        (l) =>
          l.startsWith(`${t}  `) &&
          l.includes("[CD]") &&
          l.includes("Spell Reflection") &&
          (u.id === ctx.owner?.id
            ? l.includes("[YOU]")
            : pid !== undefined && l.includes(`[TEAM] [CD]   ${pid}(`)),
      );
      if (!printed)
        ctx.violate(
          "friendlyReflectLine",
          u.id === ctx.owner?.id ? "owner" : "teammate",
          tsOf(c),
          `${u.name}#${tsOf(c)}`,
          `${u.name} Spell Reflection at ${t} has no press line`,
        );
    }
}
