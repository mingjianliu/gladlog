/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, missesOut) */
/**
 * scan5/t51.ts — ticket T51 (r12b N13): the `N hits immune` of an
 * `[ENEMY DEF] … | during it:` segment counts one attacker unit, the one its
 * damage figures count: the ally and its pets / guardians. Truth is the
 * IMMUNE rows of the log.
 *
 *  - `immuneHitPetFold`: a segment whose printed `N hits immune` (0 when the
 *    field is absent) is below the damaging IMMUNE rows (`isImmuneHitRow`,
 *    the line's own row filter) the ally AND its summons logged on the
 *    target in the wall's whole seconds after its rendered start (the start
 *    is floored, so every row counted here is inside the analysis window),
 *    before the ally's death. Kinds: `petRows` — the ally's own rows fit the
 *    printed count and the summons' rows are what is missing; `ownRows` —
 *    the ally's own rows already exceed it.
 */
import { isImmuneHitRow } from "@gladlog/analysis/src/utils/externalDamage";

import { deathMs, type IRoundCtx, secOf, tsOf } from "./ctx";

export const CHECKS = ["immuneHitPetFold"] as const;

const ENEMY_DEF_DURING =
  /^(\d+:\d{2}) {2}\[ENEMY DEF\] {3}\d+\([^)]*\) \([^)]*\): .+? → (\d+\([^)]*\)) \((\d+(?:\.\d+)?)s.*\| during it: (.+)$/;
const SEG_ALLY = /^(\d+\([^)]*\)) /;
const SEG_IMMUNE = / · (\d+) hits? immune · /;

const unitOfLabel = (ctx: IRoundCtx, label: string | undefined): any =>
  ctx.unitOfPid(/^(\d+)\(/.exec(label ?? "")?.[1]);

export function run(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = ENEMY_DEF_DURING.exec(line);
    if (!m) continue;
    const target = unitOfLabel(ctx, m[2]);
    if (!target) continue;
    const fromMs = ctx.start + secOf(m[1]!) * 1000;
    const lo = fromMs + 1000;
    const hi = fromMs + Math.floor(Number(m[3])) * 1000;
    if (hi <= lo) continue;
    for (const seg of m[4]!.split("; ")) {
      const a = SEG_ALLY.exec(seg);
      const ally = a && unitOfLabel(ctx, a[1]);
      if (!ally) continue;
      const end = Math.min(hi, deathMs(ally));
      const rowsOf = (u: any): any[] =>
        ((u.missesOut ?? []) as any[]).filter(
          (r) =>
            isImmuneHitRow(r) &&
            r.destUnitId === target.id &&
            tsOf(r) >= lo &&
            tsOf(r) < end,
        );
      const own = rowsOf(ally).length;
      const pets = ctx.units
        .filter((u) => !u.info && u.ownerId === ally.id)
        .reduce((n, u) => n + rowsOf(u).length, 0);
      if (own + pets === 0) continue;
      ctx.bump("immuneHitPetFold");
      const printed = Number(SEG_IMMUNE.exec(seg)?.[1] ?? 0);
      if (printed >= own + pets) continue;
      ctx.violate(
        "immuneHitPetFold",
        printed >= own ? "petRows" : "ownRows",
        fromMs,
        `${m[1]}#${ally.id}#${target.id}`,
        `${printed} hits immune printed; ${own} own + ${pets} pet / guardian damaging IMMUNE rows inside the wall`,
        line.slice(0, 300),
      );
    }
  }
}
