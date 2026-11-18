/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, missesOut) */
/**
 * scan5/t216.ts — pipeline T216 (fact14 D35): an owner cast line tagged
 * `[IMMUNE — <aura> was up]` for a press that had landed. Truth is read from
 * the raw rows and by name, not through the product's id tables: the
 * owner's press of the printed spell on the printed unit in the line's
 * second, the first non-periodic IMMUNE row of that name by the owner on
 * that unit in the 2.5 s after the press, and the owner's APPLIED / REFRESH
 * of an aura of that name on that unit between the two.
 *
 *  - `immuneTagAfterOwnAura`: counted, every `[YOU] [CAST]` / `[YOU] [CD]`
 *    line with the tag whose press and IMMUNE row are found. A violation
 *    when the press's own aura went up on the unit more than 100 ms before
 *    that IMMUNE row: the row is a later application refused (a bounce, a
 *    jump, the rest of a flurry), the press landed. A control is left out
 *    (the product keeps a refused control's tag whatever else of it
 *    landed).
 *    A line that names its unit (`Spell → 3(…)`) is judged on that unit. A
 *    cooldown line that names none (`[YOU] [CD] The Hunt (self: …)`; Mac
 *    job T216-1: three such presses lost the tag uncounted — The Hunt's and
 *    Feral Frenzy's hit and debuff landed, Cloak of Shadows / Divine Shield
 *    / Blessing of Protection went up 0.4-1.4 s later) is judged on every
 *    unit the press has such an IMMUNE row on: a violation only when the
 *    aura was up first on each of them.
 */
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["immuneTagAfterOwnAura"] as const;

const LINE_RE =
  /^(\d+:\d\d)\s+\[YOU\] \[(?:CAST|CD)\]\s+(.+?)\s*\[IMMUNE — .+ was up\]/;

/** the spell a tagged owner line prints, and the unit it names (if any) */
export function taggedLineParts(
  l: string,
): { time: string; name: string; pid?: string } | null {
  const m = LINE_RE.exec(l);
  if (!m) return null;
  const body = m[2]!;
  const arrow = / → (\d+)\([^)]*\)/.exec(body);
  const name = body
    .replace(/ → .*$/, "")
    .replace(/\s+[([].*$/, "")
    .trim();
  return { time: m[1]!, name, ...(arrow ? { pid: arrow[1] } : {}) };
}
const MISS_WINDOW_MS = 2500;
const SAME_INSTANT_MS = 100;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  for (const l of ctx.lines) {
    const parts = taggedLineParts(l);
    if (!parts) continue;
    const named1 = parts.pid !== undefined ? ctx.unitOfPid(parts.pid) : null;
    if (parts.pid !== undefined && !named1) continue;
    const name = parts.name;
    const secMs = ctx.start + secOf(parts.time) * 1000;
    const named = (r: any) => nameOf(r.spellId, r.spellName ?? "") === name;
    const press = successesOf(owner).find(
      (c) =>
        named(c) &&
        (!named1 || c.destUnitId === named1.id) &&
        tsOf(c) >= secMs &&
        tsOf(c) < secMs + 1000,
    );
    if (!press || ccSpellIds.has(String(press.spellId))) continue;
    const pressMs = tsOf(press);
    // the first such IMMUNE row per unit
    const firstMiss = new Map<string, any>();
    for (const x of ((owner.missesOut ?? []) as any[])
      .filter(
        (x) =>
          x.missType === "IMMUNE" &&
          (!named1 || x.destUnitId === named1.id) &&
          named(x) &&
          !String(ev(x)).startsWith("SPELL_PERIODIC") &&
          tsOf(x) >= pressMs &&
          tsOf(x) <= pressMs + MISS_WINDOW_MS,
      )
      .sort((a, b) => tsOf(a) - tsOf(b)))
      if (!firstMiss.has(x.destUnitId)) firstMiss.set(x.destUnitId, x);
    if (firstMiss.size === 0) continue;
    ctx.bump("immuneTagAfterOwnAura");
    const ups = [...firstMiss.entries()].map(([destId, miss]) => {
      const dest = (ctx.units as any[]).find((u) => u.id === destId);
      const up = ((dest?.auraEvents ?? []) as any[]).find(
        (a) =>
          a.srcUnitId === owner.id &&
          named(a) &&
          (ev(a) === APPLIED || ev(a) === REFRESH) &&
          tsOf(a) >= pressMs &&
          tsOf(a) < tsOf(miss) - SAME_INSTANT_MS,
      );
      return { miss, up };
    });
    if (ups.some((x) => !x.up)) continue;
    const { miss, up } = ups[0]!;
    ctx.violate(
      "immuneTagAfterOwnAura",
      "aura up before the IMMUNE row",
      pressMs,
      `${owner.id}:${press.spellId}:${pressMs}`,
      `${name} pressed +${pressMs - ctx.start}ms, its aura on the unit +${tsOf(up) - pressMs}ms after the press, the IMMUNE row +${tsOf(miss) - pressMs}ms after it`,
      l,
    );
  }
}
