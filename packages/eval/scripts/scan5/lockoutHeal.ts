/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents, healOut) */
/**
 * scan5/lockoutHeal.ts — class 6 of the round-7 audit (fact7 F21, D1): a kick's
 * school lockout counted as a healer's locked time while the healer kept
 * healing in another school (96fb4d42 1:55: Spell Lock on Mind Blast, then
 * Penance, Power Word: Shield and Radiance inside the printed lockout).
 *
 * Log truth, rows only: for each `… (school lockout) a-b` in a death-setup
 * row's `chain=`, a SPELL_CAST_SUCCESS by facts.healer strictly inside the
 * span of a spell whose name is on one of the healer's heal or absorb rows.
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";

import { type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["lockoutWhileHealing"] as const;

const ROW = /type=death-setup .*?healer=([^,]+),.*?chain=([^=]*?), chainFrom=/;
const LOCKOUT = /([^;]+?) \(school lockout\) ([\d.:]+)-([\d.:]+)/g;

const secs = (s: string): number => {
  const p = s.split(":").map(Number);
  return p.length === 2 ? p[0]! * 60 + p[1]! : p[0]!;
};

export function run(ctx: IRoundCtx): void {
  for (const row of ctx.menu.split("\n")) {
    const m = ROW.exec(row);
    if (!m) continue;
    const healer = ctx.byName.get(m[1]!);
    if (!healer) continue;
    const healNames = new Set(
      [...(healer.healOut ?? []), ...(healer.absorbsOut ?? [])].map((r: any) =>
        getEnglishSpellName(r.spellId ?? "", r.spellName ?? ""),
      ),
    );
    for (const l of m[2]!.matchAll(LOCKOUT)) {
      const fromMs = ctx.start + secs(l[2]!) * 1000;
      const toMs = ctx.start + secs(l[3]!) * 1000;
      ctx.bump("lockoutWhileHealing");
      const heal = successesOf(healer).find(
        (c) =>
          tsOf(c) > fromMs &&
          tsOf(c) < toMs &&
          healNames.has(nameOf(c.spellId, c.spellName)),
      );
      if (!heal) continue;
      ctx.violate(
        "lockoutWhileHealing",
        "healInsideLock",
        tsOf(heal),
        `${healer.name}#${fromMs}`,
        `${healer.name}: ${l[1]!.trim()} ${l[2]}-${l[3]}, ${nameOf(heal.spellId, heal.spellName)} at +${tsOf(heal) - ctx.start}ms`,
        row,
      );
    }
  }
}
