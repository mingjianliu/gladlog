/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t104.ts — ticket T104 (fact13 D9, D12): the name of a burst-anchored
 * KILL ATTEMPTS line `[a–b] on T — X burst (no stun)`. Truth is the cast,
 * aura, damage and miss rows of the log.
 *
 *  - `selfBuffReadCastInto`: `X (cast into U) burst`, where every press of X
 *    by the team in the bracket's first printed second whose cast row names
 *    U put X's own aura (its id or an effect aura, `castAndEffectIds` — a
 *    table lookup) on its caster within `SAVE_CAST_AURA_PAIR_S`, and no
 *    damage or miss row of X (same ids, or the same English name) from that
 *    caster ever met U before the caster's next press of X. A self-buff whose
 *    cast row names the current target went nowhere near it (36e987ca 3:17:
 *    Voidform's row names a Grounding Totem; the totem ate the Shadow Word:
 *    Madness of the same millisecond). Counted: every `(cast into` line.
 *  - `anchorPressedAfterOpen`: `X burst` (no `cast into`) where the team
 *    pressed X inside the bracket (a SUCCESS row of X, or X's aura going up
 *    on its own caster) but not in its first printed second — the
 *    bracket says X opened the go at `a` (54251a4b-r0 1:57: a Volley pressed
 *    18 s after the Malevolence that opened the cluster). Kind = X. Counted:
 *    every burst-anchored line named for a press of the team inside its
 *    bracket.
 */
import { castAndEffectIds } from "@gladlog/analysis/src/data/castEffectAuras";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { SAVE_CAST_AURA_PAIR_S } from "@gladlog/analysis/src/utils/auraIntervals";

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

export const CHECKS = [
  "selfBuffReadCastInto",
  "anchorPressedAfterOpen",
] as const;

const LINE =
  /^ {2}\[(\d+:\d{2})–(\d+:\d{2})\] on (\S+) — (.+?) burst \(no stun\)/;
const CAST_INTO = /^(.+) \(cast into (.+)\)$/;
const AURA_PAIR_MS = SAVE_CAST_AURA_PAIR_S * 1000;

const rowSpell = (r: any): { id: string; name: string } => ({
  id: String(r.attackSpellId ?? r.spellId ?? ""),
  name: String((r.attackSpellId ? r.attackSpellName : r.spellName) ?? ""),
});

/** a damage / miss row of the press (its id, an effect aura's, or its name) */
function isRowOf(spellId: string, spellName: string, r: any): boolean {
  const { id, name } = rowSpell(r);
  if (!id) return false;
  if (castAndEffectIds(spellId).has(id)) return true;
  return (
    (getEnglishSpellName(id, name) || id) ===
    (getEnglishSpellName(spellId, spellName) || spellId)
  );
}

export function run(ctx: IRoundCtx): void {
  const team = ctx.players.filter(
    (u: any) => u.reaction === ctx.owner.reaction,
  );
  for (const l of ctx.lines) {
    const m = LINE.exec(l);
    if (!m) continue;
    const target = ctx.byName.get(m[3]!);
    if (!target) continue;
    const lo = ctx.start + secOf(m[1]!) * 1000;
    const hi = ctx.start + (secOf(m[2]!) + 1) * 1000;
    const into = CAST_INTO.exec(m[4]!);
    const spell = into ? into[1]! : m[4]!;
    const presses = team
      .flatMap((u: any) => successesOf(u).map((c) => ({ u, c })))
      .filter(
        ({ c }) =>
          tsOf(c) >= lo &&
          tsOf(c) < hi &&
          nameOf(c.spellId, c.spellName) === spell,
      )
      .sort((a, b) => tsOf(a.c) - tsOf(b.c));
    if (into) {
      ctx.bump("selfBuffReadCastInto");
      const unitName = into[2]!;
      const opening = presses.filter(
        ({ c }) =>
          tsOf(c) < lo + 1000 &&
          ctx.units.find((x: any) => x.id === c.destUnitId)?.name === unitName,
      );
      if (opening.length === 0) continue;
      const selfBuff = opening.every(({ u, c }) => {
        const id = String(c.spellId);
        const ids = castAndEffectIds(id);
        const onCaster = ((u.auraEvents ?? []) as any[]).some(
          (a) =>
            (ev(a) === APPLIED || ev(a) === REFRESH) &&
            a.srcUnitId === u.id &&
            ids.has(String(a.spellId)) &&
            Math.abs(tsOf(a) - tsOf(c)) <= AURA_PAIR_MS,
        );
        if (!onCaster) return false;
        const next = successesOf(u)
          .filter((e) => String(e.spellId) === id && tsOf(e) > tsOf(c) + 5)
          .reduce((mn, e) => Math.min(mn, tsOf(e)), Infinity);
        const rows = [
          ...((u.damageOut ?? []) as any[]),
          ...((u.missesOut ?? []) as any[]),
        ];
        return !rows.some(
          (r) =>
            r.destUnitId === c.destUnitId &&
            tsOf(r) >= tsOf(c) &&
            tsOf(r) < next &&
            isRowOf(id, c.spellName, r),
        );
      });
      if (!selfBuff) continue;
      ctx.violate(
        "selfBuffReadCastInto",
        spell,
        lo,
        `${m[3]}:${m[1]}`,
        `${spell} put its own aura on its caster and never met ${unitName}: a self-buff, its cast row only names the current target`,
        l,
      );
      continue;
    }
    // a press is also its own aura going up on its caster: Metamorphosis'
    // 162264 lands ~1 s before the impact's SUCCESS row, Doom Winds' 466772
    // has no SUCCESS row of its own (its ticks' 469270 follow)
    const selfAuraUps = team
      .flatMap((u: any) =>
        ((u.auraEvents ?? []) as any[]).filter(
          (a) =>
            ev(a) === APPLIED &&
            a.srcUnitId === u.id &&
            a.destUnitId === u.id &&
            nameOf(a.spellId, a.spellName) === spell,
        ),
      )
      .map(tsOf)
      .filter((t: number) => t >= lo && t < hi);
    const firstMs = Math.min(
      ...presses.map(({ c }) => tsOf(c)),
      ...selfAuraUps,
    );
    if (!Number.isFinite(firstMs)) continue;
    ctx.bump("anchorPressedAfterOpen");
    if (firstMs < lo + 1000) continue;
    ctx.violate(
      "anchorPressedAfterOpen",
      spell,
      lo,
      `${m[3]}:${m[1]}`,
      `the bracket opens at ${m[1]}; ${spell} was first pressed in it at ${((firstMs - ctx.start) / 1000).toFixed(1)}s`,
      l,
    );
  }
}
