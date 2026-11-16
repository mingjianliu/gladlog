/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, absorbsIn) */
/**
 * scan5/t127.ts — ticket T127 (fact13 D35): an absorb shield pressed on a
 * kill-window target by a unit of the OTHER side ends `defenseless` as an
 * ally's does — the shield absorbs the attackers' damage whoever cast it
 * (b8a9f3e3 r0: a Discipline Priest's Void Shield went onto the warlock it had
 * Mind-Controlled in the ms the control ended, 118k, and absorbed 117k of the
 * priest's team's damage inside `defenseless 0:56–1:12`).
 *
 * `crossTeamShieldDefenseless`: scan5/allyShield's check
 * (`shieldDefenseless`, same log truth: an absorb row on the target inside
 * the span, a press of that shield by its caster at the target or with no
 * target beside the run's start, within a minute) with the caster on the
 * target's other side. Kind `pressed`. A copy the target STOLE keeps its
 * victim's caster as its source and does not count (user ruling 2026-10-30,
 * #167; the producer's `isStolenAuraAcquisition`): kind `stolen`, out of the
 * total. Inventory, each round once, out of the total: every application on
 * a player of an aura whose source is a player of the other side and that
 * absorbed for it — `inventoryStolen` (a stolen copy) / `inventoryOther`.
 */
import { isStolenAuraAcquisition } from "@gladlog/analysis/src/utils/enemyDefensives";

import { shieldDefenseless } from "./allyShield";
import { ABSORBED, APPLIED, ev, type IRoundCtx, nameOf, tsOf } from "./ctx";

export const CHECKS = ["crossTeamShieldDefenseless"] as const;

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "crossTeamShieldDefenseless|stolen",
  "crossTeamShieldDefenseless|inventoryStolen",
  "crossTeamShieldDefenseless|inventoryOther",
]);

export function run(ctx: IRoundCtx): void {
  const C = "crossTeamShieldDefenseless";
  shieldDefenseless(ctx, C, "other");
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.players as any[]) {
    const absorbed = new Set(
      ((u.absorbsIn ?? []) as any[])
        .filter((r) => ev(r) === undefined || ev(r) === ABSORBED)
        .map((r) => `${r.spellId}|${r.srcUnitId}`),
    );
    for (const a of (u.auraEvents ?? []) as any[]) {
      if (ev(a) !== APPLIED) continue;
      const t = tsOf(a);
      if (t < ctx.start || t > ctx.roundEndAt) continue;
      const id = String(a.spellId);
      if (!absorbed.has(`${id}|${a.srcUnitId}`)) continue;
      const src = (ctx.players as any[]).find((p) => p.id === a.srcUnitId);
      if (!src || src.reaction === u.reaction) continue;
      ctx.violate(
        C,
        isStolenAuraAcquisition(u, id, t)
          ? "inventoryStolen"
          : "inventoryOther",
        t,
        `${u.id}#${id}#${t}`,
        `${u.name} carried ${nameOf(id, a.spellName ?? id)} ${id} from ${src.name} of the other side at ${((t - ctx.start) / 1000).toFixed(2)}s`,
      );
    }
  }
}
