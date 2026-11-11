/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, missesOut) */
/**
 * scan5/t51.ts — ticket T51 (r12b N13): the `N hits immune` of an
 * `[ENEMY DEF] … | during it:` segment counts one attacker unit, the one its
 * damage figures count: the ally and its pets / guardians. Truth is the
 * IMMUNE rows of the log.
 *
 *  - `immuneHitPetFold`: a segment whose printed `N hits immune` (0 when the
 *    field is absent) is below the damaging IMMUNE rows (`isImmuneHitRow`,
 *    the line's own row filter) the ally AND its summons (`foldsIntoOwner`,
 *    the parser's own fold) logged on the target strictly between the wall
 *    aura's own APPLIED and REMOVED rows (`wallAuraSpan`), before either
 *    unit's death. The line is stamped at the press and the aura can go on
 *    over a second later, so the span is read from the aura rows, never from
 *    the stamp; a line whose aura rows the log does not show is not judged.
 *    Kinds: `petRows` — the ally's own rows fit the printed count and the
 *    summons' rows are what is missing; `ownRows` — the ally's own rows
 *    already exceed it.
 */
import { isImmuneHitRow } from "@gladlog/analysis/src/utils/externalDamage";
import { foldsIntoOwner } from "@gladlog/parser-compat";

import {
  APPLIED,
  deathMs,
  ev,
  type IRoundCtx,
  nameOf,
  REMOVED,
  secOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["immuneHitPetFold"] as const;

const ENEMY_DEF_DURING =
  /^(\d+:\d{2}) {2}\[ENEMY DEF\] {3}\d+\([^)]*\) \([^)]*\): .+? → (\d+\([^)]*\)) \((\d+(?:\.\d+)?)s.*\| during it: (.+)$/;
const SEG_ALLY = /^(\d+\([^)]*\)) /;
const SEG_IMMUNE = / · (\d+) hits? immune · /;

const unitOfLabel = (ctx: IRoundCtx, label: string | undefined): any =>
  ctx.unitOfPid(/^(\d+)\(/.exec(label ?? "")?.[1]);

/** The wall's own aura rows on the target: the APPLIED row of the line's
 *  wall within a second before / three after its stamp, and the REMOVED row
 *  that ends its run — a re-application in the same instant goes on with it
 *  (the round's end when the log has none). */
/** REMOVED then APPLIED again this close is the same run going on */
const REAPPLIED_SAME_RUN_MS = 200;

export function wallAuraSpan(
  ctx: IRoundCtx,
  line: string,
  target: any,
  fromMs: number,
): { from: number; to: number } | undefined {
  const wallName = / \([^)]*\): (.+?) → /.exec(line)?.[1];
  const auras = (target.auraEvents ?? []) as any[];
  const k = auras.findIndex(
    (e) =>
      ev(e) === APPLIED &&
      nameOf(e.spellId, e.spellName) === wallName &&
      tsOf(e) >= fromMs - 1000 &&
      tsOf(e) < fromMs + 3000,
  );
  if (k < 0) return undefined;
  const a = auras[k];
  const same = (b: any) =>
    b.spellId === a.spellId && b.srcUnitId === a.srcUnitId;
  // a wall taken off and put back in the same instant is one run on the
  // line (605 file 119 r1 0:46: Time Dilation REMOVED and APPLIED in one ms,
  // twice 5 s, printed as 10.4 s)
  let at = k;
  let to = Infinity;
  for (;;) {
    const r = auras.findIndex((b, j) => j > at && same(b) && ev(b) === REMOVED);
    if (r < 0) {
      to = Infinity;
      break;
    }
    to = tsOf(auras[r]);
    const again = auras.findIndex(
      (b, j) =>
        j > r &&
        same(b) &&
        ev(b) === APPLIED &&
        tsOf(b) - to <= REAPPLIED_SAME_RUN_MS,
    );
    if (again < 0) break;
    at = again;
  }
  // a row logged after the round's end is outside every producer window
  return { from: tsOf(a), to: Math.min(to, ctx.roundEndAt) };
}

export function run(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = ENEMY_DEF_DURING.exec(line);
    if (!m) continue;
    const target = unitOfLabel(ctx, m[2]);
    if (!target) continue;
    const fromMs = ctx.start + secOf(m[1]!) * 1000;
    const span = wallAuraSpan(ctx, line, target, fromMs);
    if (!span) continue;
    const lo = span.from;
    const hi = Math.min(span.to, deathMs(target));
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
            tsOf(r) > lo &&
            tsOf(r) < end,
        );
      const own = rowsOf(ally).length;
      const pets = ctx.units
        .filter((u) => foldsIntoOwner(u, ally))
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
