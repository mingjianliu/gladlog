/**
 * scan5/t238.ts — pipeline T238: cd-hoarded's `pressedLate` (`X → whom +Ns`)
 * printed the cast row's destination for every late press, and a self-only
 * button's cast row logs the caster's current target — an enemy
 * (Survival of the Fittest → the enemy Discipline Priest, 69915cc5 r1;
 * Touch of Karma → its enemy). The product now names a recipient only for a
 * cooldown that can reach another unit (`cdCanHelpAnotherUnit`, the predicate
 * the row's `pressedFor` supplier reads).
 *
 * Two checks over every `pressedLate` destination of the menu:
 * - `pressedLateNamesEnemy`: the named unit is on the other side (the log's
 *   roster `reaction`, not the product's reading);
 * - `pressedLateSelfOnlyDestination`: the press is a self-only cooldown — its
 *   spell id taken from the owner's own SPELL_CAST_SUCCESS row of that name in
 *   the log, judged by the producer's predicate `cdCanHelpAnotherUnit`.
 */
import { cdCanHelpAnotherUnit } from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx } from "./ctx";

export const CHECKS = [
  "pressedLateNamesEnemy",
  "pressedLateSelfOnlyDestination",
] as const;

const PRESSED_LATE_RE = /\bpressedLate=(.*?)(?:, [a-zA-Z]+=|\}\s*$)/;
const ITEM_RE = /^(.+?) → (.+?) \+\d+(?:\.\d)?s$/;

/** the owner's own cast id of a spell name, from its SUCCESS rows */
function ownerCastIdsOf(ctx: IRoundCtx, spellName: string): Set<string> {
  const ids = new Set<string>();
  const ownerId = String(ctx.owner.id);
  const needle = `,"${spellName}",`;
  for (const l of ctx.rawLines) {
    if (!l.includes("SPELL_CAST_SUCCESS,") || !l.includes(needle)) continue;
    const body = l.slice(l.indexOf("SPELL_CAST_SUCCESS,") + 19);
    if (!body.startsWith(ownerId + ",")) continue;
    const at = body.indexOf(needle);
    const id = /,(\d+)$/.exec(body.slice(0, at))?.[1];
    if (id) ids.add(id);
  }
  return ids;
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner || !ctx.menu.includes("pressedLate=")) return;
  for (const row of ctx.menu.split("\n")) {
    const late = PRESSED_LATE_RE.exec(row)?.[1];
    if (!late) continue;
    const factId = /\bid=(\S+)/.exec(row)?.[1] ?? row.slice(0, 60);
    for (const item of late.split("; ")) {
      const m = ITEM_RE.exec(item.trim());
      if (!m) continue;
      const [, spell, who] = m as unknown as [string, string, string];
      ctx.bump("pressedLateNamesEnemy");
      ctx.bump("pressedLateSelfOnlyDestination");
      const unit = ctx.byName.get(who);
      if (unit && unit.reaction !== ctx.owner.reaction)
        ctx.violate(
          "pressedLateNamesEnemy",
          spell,
          ctx.start,
          factId,
          `${ctx.owner.name}: pressedLate names the enemy ${who} for ${spell}`,
          row.trim().slice(0, 300),
        );
      const ids = ownerCastIdsOf(ctx, spell);
      if (
        ids.size > 0 &&
        [...ids].every((spellId) => !cdCanHelpAnotherUnit({ spellId }))
      )
        ctx.violate(
          "pressedLateSelfOnlyDestination",
          spell,
          ctx.start,
          factId,
          `${ctx.owner.name}: self-only ${spell} (${[...ids].join("/")}) pressed late names ${who}`,
          row.trim().slice(0, 300),
        );
    }
  }
}
