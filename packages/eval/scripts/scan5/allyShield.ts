/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, absorbsIn) */
/**
 * scan5/allyShield.ts — D37 of the round-7 audit (fact7 F21, user ruling
 * 2026-10-30): an absorb shield an ally pressed on the target ends
 * `defenseless`, as the target's own pressed shield does.
 *
 * `allyShieldDefenseless`: every `[KILL WINDOW] … (defenseless a–b)` and
 * `[VULNERABLE] … no major defensives` span. Log truth: an absorb row on the
 * target inside the span, from a shield of a same-side other unit, with a
 * SPELL_CAST_SUCCESS of that unit at the target that names the shield or makes
 * it (the riders' table lookup is fine: it is a lookup), from a second before
 * the run's APPLIED to the row. A proc shield with no such press is no
 * violation.
 */
import { castsOfEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import { riderCastsOfShield } from "@gladlog/analysis/src/data/ownShieldLinks";

import {
  ABSORBED,
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["allyShieldDefenseless"] as const;

const SPAN =
  /^\s+\[(KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d)(?: \(\d+s\))? on [^(]+ \(([^()]+(?:\([^()]*\)[^()]*)*)\):(.*)$/;
const PRESS_PAIR_MS = 1000;

export function run(ctx: IRoundCtx): void {
  const seen = new Set<string>();
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
    const key = `${u.id}:${span[0]}:${span[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ctx.bump("allyShieldDefenseless");
    const fromMs = ctx.start + (span[0]! + 1) * 1000;
    const toMs = ctx.start + span[1]! * 1000;
    for (const r of (u.absorbsIn ?? []) as any[]) {
      if (ev(r) !== undefined && ev(r) !== ABSORBED) continue;
      const t = tsOf(r);
      if (t < fromMs || t > toMs || r.srcUnitId === u.id) continue;
      const caster = ctx.players.find(
        (p: any) => p.id === r.srcUnitId && p.reaction === u.reaction,
      );
      if (!caster) continue;
      const id = String(r.spellId);
      const name = nameOf(id, id);
      const runStart = ((u.auraEvents ?? []) as any[])
        .filter(
          (a) =>
            String(a.spellId) === id &&
            a.srcUnitId === caster.id &&
            ev(a) === APPLIED &&
            tsOf(a) <= t,
        )
        .pop();
      if (!runStart) continue;
      const press = successesOf(caster).find(
        (c: any) =>
          tsOf(c) <= t &&
          tsOf(c) >= tsOf(runStart) - PRESS_PAIR_MS &&
          c.destUnitId === u.id &&
          (String(c.spellId) === id ||
            nameOf(String(c.spellId), c.spellName ?? "") === name ||
            castsOfEffectAura(id).includes(String(c.spellId)) ||
            riderCastsOfShield(id).includes(String(c.spellId))),
      );
      if (!press) continue;
      ctx.violate(
        "allyShieldDefenseless",
        "pressed",
        t,
        `${u.id}#${span[0]}#${id}`,
        `${u.name} span ${m[2]} ate ${name} ${id} from ${caster.name} (press ${press.spellId} +${tsOf(press) - ctx.start}ms)`,
        line,
      );
      break;
    }
  }
}
