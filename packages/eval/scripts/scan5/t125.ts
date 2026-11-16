/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t125.ts — pipeline T125 (fact13 D29): Cascading Horrors 358861 (an
 * enemy Shadow Priest's horror, DB2 mechanic 24) controlled two teammates and
 * no `[CC ON TEAM]` line was printed: the CC walk admits only `ccSpellIds`
 * (the hand `cc` type ∪ the official stun / incapacitate / disorient DR ids)
 * and the dispel backlash table, and the aura is in neither.
 *
 *  - `lossOfControlAuraNoCcLine`: an aura APPLIED on a player of the owner's
 *    side by a unit of the other side, inside the round, whose DB2 mechanic
 *    (`ccMechanicOf`, a lookup) is a loss-of-control one (charm, disorient,
 *    fear, sleep, stun, freeze, knockout, polymorph, banish, shackle, horror,
 *    sap), that is neither in `ccSpellIds` nor a dispel backlash aura: the
 *    timeline must print a `[CC ON TEAM] <victim> ← <aura name>` line within
 *    a second of it. Counted per application; kind = `<name> <id> (mech N)`.
 */
import { BACKLASH_AURA_CC_TYPE } from "@gladlog/analysis/src/data/backlashCc";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { ccMechanicOf } from "@gladlog/analysis/src/utils/spellMechanics";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REMOVED,
  secOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["lossOfControlAuraNoCcLine"] as const;

/** DB2 SpellMechanic ids that take control of the unit */
const LOSS_OF_CONTROL_MECHANICS: ReadonlySet<number> = new Set([
  1, 2, 5, 10, 12, 13, 14, 17, 18, 20, 24, 30,
]);

/** ids this check found and a ruling made controls (R48, 2026-11-15:
 * Cascading Horrors) — still counted after they joined `ccSpellIds`, so the
 * count reads the same on a capture from before and after */
const RULED_IN: ReadonlySet<string> = new Set(["358861"]);

const CC_LINE = /^\s*(\d+:\d\d)\s+\[CC ON TEAM\]\s+(\d+)\([^)]*\) ← (.+?) \(/;

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const side = ctx.owner.reaction;
  const roundEnd = roundEndMs({
    endTime: ctx.end,
    startInfo: ctx.legacy.startInfo,
    units: ctx.legacy.units,
  });
  const reactionOf = new Map<string, unknown>(
    (ctx.units as any[]).map((u) => [u.id, u.reaction]),
  );
  const ccLines: Array<{ sec: number; pid: string; name: string }> = [];
  for (const l of ctx.lines) {
    const m = CC_LINE.exec(l);
    if (m) ccLines.push({ sec: secOf(m[1]!), pid: m[2]!, name: m[3]! });
  }
  for (const u of ctx.players as any[]) {
    if (u.reaction !== side) continue;
    const pid = ctx.pidOf(u.name);
    if (!pid) continue;
    for (const a of (u.auraEvents ?? []) as any[]) {
      if (ev(a) !== APPLIED || a.destUnitId !== u.id) continue;
      const t = tsOf(a);
      // the product's round: an application at or after its end is not in
      // it (`roundEndMs`, exclusive), and one removed in its own millisecond
      // never held the unit (codex 85-tk-M-T125-2 #3)
      if (t < ctx.start || t >= roundEnd) continue;
      if (
        (u.auraEvents as any[]).some(
          (r) =>
            ev(r) === REMOVED &&
            r.spellId === a.spellId &&
            r.srcUnitId === a.srcUnitId &&
            tsOf(r) === t,
        )
      )
        continue;
      const src = reactionOf.get(a.srcUnitId);
      if (src === undefined || src === side) continue;
      const id = String(a.spellId);
      const mech = ccMechanicOf(id);
      if (mech === undefined || !LOSS_OF_CONTROL_MECHANICS.has(mech)) continue;
      if (
        (ccSpellIds.has(id) && !RULED_IN.has(id)) ||
        BACKLASH_AURA_CC_TYPE.has(id)
      )
        continue;
      const name = nameOf(id, a.spellName);
      ctx.bump("lossOfControlAuraNoCcLine");
      const sec = Math.floor((t - ctx.start) / 1000);
      if (
        ccLines.some(
          (c) => c.pid === pid && c.name === name && Math.abs(c.sec - sec) <= 1,
        )
      )
        continue;
      ctx.violate(
        "lossOfControlAuraNoCcLine",
        `${name} ${id} (mech ${mech})`,
        t,
        `${u.name}:${id}:${t}`,
        `${u.name} got ${name} ${id} (DB2 mechanic ${mech}) at ${fmtS(sec)} from the other side; no [CC ON TEAM] line`,
        "",
      );
    }
  }
}
