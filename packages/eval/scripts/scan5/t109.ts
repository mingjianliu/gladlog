/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t109.ts — ticket T109 (fact13 D1, ruling R43): a cd-hoarded row's
 * `crisisUnitSaved` ("a save facts.crisisUnit pressed on itself") listed the
 * crisis unit's own Master's Call — a 4 s root / snare freedom on the caster
 * that takes no damage off anyone — beside Feign Death and Survival of the
 * Fittest.
 *
 * Whether a redirect on oneself saves its caster is the producer's own
 * predicate (`redirectSavesItsCaster`, never replayed here):
 *
 *  - `selfRedirectListed`: an entry of `crisisUnitSaved` names a grip /
 *    redirect save (`ENEMY_REDIRECT_SAVE_IDS`), the crisis unit's cast of it
 *    at the entry's offset (±0.1 s, the one-decimal print) has no target or
 *    targets the unit itself, and `redirectSavesItsCaster` says it does not
 *    save its caster (Master's Call; Roar of Sacrifice's 25 % does).
 */
import { ENEMY_REDIRECT_SAVE_IDS } from "@gladlog/analysis/src/data/spellIdLists";
import { redirectSavesItsCaster } from "@gladlog/analysis/src/utils/selfDefensiveMechanism";

import { type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["selfRedirectListed"] as const;

const ROW_RE =
  /\bid=cd-hoarded:[^:\s]+:([^:\s]+):[\d.]+ type=cd-hoarded t=([\d.]+)s/;
const SAVED_RE = /\bcrisisUnitSaved=([^,}]+)/;
const ITEM_RE = /^(.+?) ([+-]\d+\.\d)s(?: \(broken [+-]\d+\.\d+s\))?$/;

let byName: Map<string, string[]> | undefined;
/** English name → the redirect ids that carry it */
function redirectIdsByName(): Map<string, string[]> {
  if (byName) return byName;
  byName = new Map();
  for (const id of ENEMY_REDIRECT_SAVE_IDS) {
    const n = nameOf(id);
    if (n) byName.set(n, [...(byName.get(n) ?? []), id]);
  }
  return byName;
}

export function run(ctx: IRoundCtx): void {
  for (const row of ctx.menu.split("\n")) {
    const m = ROW_RE.exec(row);
    if (!m) continue;
    const saved = SAVED_RE.exec(row)?.[1];
    if (!saved) continue;
    const unitId = m[1]!;
    const t = parseFloat(m[2]!);
    const unit = ctx.units.find((u: any) => u.id === unitId);
    for (const item of saved.split(/;\s*/)) {
      const it = ITEM_RE.exec(item.trim());
      if (!it) continue;
      const ids = redirectIdsByName().get(it[1]!);
      if (!ids) continue;
      const C = "selfRedirectListed";
      ctx.bump(C);
      const atMs = ctx.start + (t + parseFloat(it[2]!)) * 1000;
      const cast = (unit ? successesOf(unit) : []).find(
        (c: any) =>
          ids.includes(String(c.spellId)) && Math.abs(tsOf(c) - atMs) <= 100,
      );
      if (!cast) continue;
      const dest = String(cast.destUnitId ?? "");
      const onSelf = dest === "" || /^0+$/.test(dest) || dest === unitId;
      if (!onSelf || redirectSavesItsCaster(String(cast.spellId))) continue;
      ctx.violate(
        C,
        it[1]!,
        atMs,
        `${unitId}#${t}#${it[1]}`,
        `crisisUnitSaved lists ${it[1]} the crisis unit cast on itself; it does not save its caster`,
        row.trim().slice(0, 300),
      );
    }
  }
}
