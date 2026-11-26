/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, players) */
/**
 * scan5/t281.ts — pipeline T281: an IMMUNE row of a press whose refused
 * component had already landed on that unit (audit-1215 17 D1, 0d211b8b r1
 * 1:32: Merithra's Blessing 1256581 healed its target, Cyclone landed 64 ms
 * later, the next 1256581 pulse met IMMUNE and the line read `[IMMUNE —
 * Cyclone was up]`).
 *
 *  - `immuneRowAfterOwnComponentLanded`: every IMMUNE row of a non-control
 *    press on a unit (the cast's id or an effect aura's, in the cast's
 *    window, not excused by a hit in its own instant), each side's players,
 *    each round once. Read from the raw rows, not from the product's
 *    selection:
 *      · `kept as a refusal` (the total) — the row's own id has a damage /
 *        heal row on that unit from this press before it
 *        (`refusedComponentLandedBefore`), and the product's reading
 *        (`pressImmuneMissRows`) still returns the row;
 *      · `another component landed before` (out of the total) — an earlier
 *        hit of the press under ANOTHER id: one press, two components, one
 *        refused (Eviscerate's Shadow part under Blessing of Protection,
 *        Judgment's damage before its debuff). The tag stays.
 *
 * The wall half of the ticket (a cast counted into a wall it landed before,
 * or that another aura refused under it) is gated on the printed line by
 * `singles14b` `intoDefenseLanded`.
 */
import { castAndEffectIds } from "@gladlog/analysis/src/data/castEffectAuras";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  isControlCast,
  isPressHitRow,
  missBelongsToCast,
  PRESS_LANDED_SAME_INSTANT_MS,
  pressImmuneMissRows,
  refusedComponentLandedBefore,
} from "@gladlog/analysis/src/utils/castMissRows";

import { ev, fmtS, type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

const A = "immuneRowAfterOwnComponentLanded";
export const CHECKS = [A] as const;
const OTHER = "another component landed before";
/** the inventory: a partial refusal the line still states */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([`${A}|${OTHER}`]);

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const units = ctx.units as any[];
  for (const u of ctx.players as any[]) {
    const misses = ((u.missesOut ?? []) as any[]).filter(
      (m) =>
        m.missType === "IMMUNE" &&
        !String(ev(m) ?? "").startsWith("SPELL_PERIODIC_"),
    );
    if (misses.length === 0) continue;
    const casts = successesOf(u);
    const landed = [...(u.damageOut ?? []), ...(u.healOut ?? [])] as any[];
    const applied = units.flatMap((x) =>
      ((x.auraEvents ?? []) as any[]).filter((a) => a.srcUnitId === u.id),
    );
    const seen = new Set<any>();
    for (const c of casts) {
      const id = String(c.spellId ?? "");
      if (!id || ccSpellIds.has(id) || isControlCast(id)) continue;
      const t = tsOf(c);
      if (t > ctx.end) continue;
      const same = casts.filter((x) => String(x.spellId) === id).map(tsOf);
      const family = castAndEffectIds(id);
      const name = nameOf(id, c.spellName);
      const kept = new Set(
        pressImmuneMissRows(
          u.missesOut ?? [],
          id,
          same,
          t,
          c.destUnitId
            ? { casts: u.spellCastEvents ?? [], destUnitId: c.destUnitId }
            : undefined,
          landed,
          applied,
        ),
      );
      for (const m of misses) {
        if (seen.has(m) || !m.destUnitId) continue;
        if (!family.has(String(m.spellId))) continue;
        if (!missBelongsToCast(same, t, tsOf(m))) continue;
        seen.add(m);
        ctx.bump(A);
        const where = `${u.name} ${name} pressed ${fmtS((t - ctx.start) / 1000)} on ${m.destUnitName ?? m.destUnitId}`;
        if (
          refusedComponentLandedBefore(
            landed,
            String(m.spellId),
            same,
            t,
            m.destUnitId,
            tsOf(m),
          )
        ) {
          if (kept.has(m))
            ctx.violate(
              A,
              "kept as a refusal",
              t,
              `${u.id}|${id}|${t}|${m.destUnitId}`,
              `${where}: ${m.spellId} landed there before its IMMUNE row`,
            );
          continue;
        }
        const other = landed.find(
          (r) =>
            r.destUnitId === m.destUnitId &&
            // another id: an absorbed row is the attack's
            String(r.attackSpellId ?? r.spellId) !== String(m.spellId) &&
            !String(ev(r) ?? "").startsWith("SPELL_PERIODIC_") &&
            tsOf(r) >= t &&
            tsOf(r) < tsOf(m) - PRESS_LANDED_SAME_INSTANT_MS &&
            missBelongsToCast(same, t, tsOf(r)) &&
            isPressHitRow(id, name, r),
        );
        if (other)
          ctx.violate(
            A,
            OTHER,
            t,
            `${u.id}|${id}|${t}|${m.destUnitId}|other`,
            `${where}: ${ev(other)} ${other.attackSpellId ?? other.spellId} ${tsOf(m) - tsOf(other)} ms before the IMMUNE row of ${m.spellId}`,
          );
      }
    }
  }
}
