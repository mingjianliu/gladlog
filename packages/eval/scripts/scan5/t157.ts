/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, aura rows) */
/**
 * scan5/t157.ts — pipeline T157 (user ruling R58, 2026-11-18; batch review
 * 80-PIPE-160-B146): Greater Invisibility is no mitigation and no immunity,
 * and a unit nobody can see is no kill target while the aura is up.
 *
 * `invisibleInsideDefenseless`: every rendered `[KILL WINDOW] … (defenseless
 * a–b)` / `[VULNERABLE] a–b … no major defensives` span on a unit that has
 * an invisibility aura row (`ENEMY_INVISIBILITY_AURAS`: 110960) in the
 * round, each (unit, span) once. The printed bounds are floored, so the
 * span is read as the instants from second a+1 to second b. A violation is
 * an invisibility up inside it, read off the aura's own rows:
 *  - kind `logged`: an APPLIED whose REMOVED the log shows, the two rows'
 *    interval overlapping the span;
 *  - kind `applied`: an APPLIED with no REMOVED before the unit's next
 *    APPLIED of it (an opponent who went unseen takes the row along), its
 *    own instant inside the span — the unit was invisible there whatever
 *    ended it.
 */
import { ENEMY_INVISIBILITY_AURAS } from "@gladlog/analysis/src/data/spellIdLists";

import { APPLIED, ev, type IRoundCtx, REMOVED, secOf, tsOf } from "./ctx";

export const CHECKS = ["invisibleInsideDefenseless"] as const;

const SPAN =
  /^\s+\[(KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d)(?: \(\d+s\))? on [^(]+ \(([^()]+(?:\([^()]*\)[^()]*)*)\):(.*)$/;

export function run(ctx: IRoundCtx): void {
  const seen = new Set<string>();
  const runsOf = new Map<string, Array<{ from: number; to?: number }>>();
  const runs = (u: any) => {
    let r = runsOf.get(u.id);
    if (r) return r;
    r = [];
    const rows = ((u.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          String(a.spellId) in ENEMY_INVISIBILITY_AURAS &&
          (a.destUnitId === undefined || a.destUnitId === u.id) &&
          (ev(a) === APPLIED || ev(a) === REMOVED),
      )
      .sort((a, b) => tsOf(a) - tsOf(b));
    for (const a of rows) {
      if (ev(a) === APPLIED) r.push({ from: tsOf(a) });
      else {
        const open = r[r.length - 1];
        if (open && open.to === undefined) open.to = tsOf(a);
      }
    }
    runsOf.set(u.id, r);
    return r;
  };
  for (const line of ctx.lines) {
    const m = SPAN.exec(line);
    if (!m) continue;
    const u = ctx.byName.get(m[4]!);
    if (!u) continue;
    const dl = /\(defenseless (\d+:\d\d)–(\d+:\d\d)\)/.exec(m[5]!);
    const span = dl
      ? [secOf(dl[1]!), secOf(dl[2]!)]
      : m[1] === "VULNERABLE" && /no major defensives/.test(m[5]!)
        ? [secOf(m[2]!), secOf(m[3]!)]
        : undefined;
    if (!span) continue;
    const invis = runs(u);
    if (invis.length === 0) continue;
    const key = `${u.id}:${span[0]}:${span[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ctx.bump("invisibleInsideDefenseless");
    const fromMs = ctx.start + (span[0]! + 1) * 1000;
    const toMs = ctx.start + span[1]! * 1000;
    for (const r of invis) {
      const logged = r.to !== undefined;
      const inside = logged
        ? r.from < toMs && r.to! > fromMs
        : r.from >= fromMs && r.from < toMs;
      if (!inside) continue;
      const s = (t: number) => ((t - ctx.start) / 1000).toFixed(3);
      ctx.violate(
        "invisibleInsideDefenseless",
        logged ? "logged" : "applied",
        r.from,
        `${u.id}|${span[0]}|${span[1]}|${r.from}`,
        `invisible ${s(r.from)}–${logged ? s(r.to!) : "(end not logged)"} s inside the defenseless span ${span[0]}–${span[1]} s`,
        line.trim().slice(0, 200),
      );
    }
  }
}
