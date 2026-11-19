/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t177.ts — ticket T177 (GH #221 group 1): "loss-of-control auras with
 * no CC line, 1,779 of 3,528" (`lossOfControlAuraNoCcLine`, scan5/t125) had
 * never been broken down by spell. By spell: Binding Shot's tether 117405
 * ×1,229 and Snowdrift's pulse 390171 ×427 — neither aura takes control
 * (DB2: a dummy aura, a periodic damage aura; the spell's mechanic label
 * says "stunned" for both) — Fel Cleave 213688 ×114 and Earthquake 77505 ×6
 * (ruled not controls, R48), Intimidation 1258508 ×3 (a 0.5 s pet stun
 * with no DR family; ruled not a control, 2026-11-19).
 *
 *  - `controlAuraNoCcLine` asks the aura itself: every aura APPLIED on a
 *    player of the owner's side by a unit of the other side, inside the
 *    round (`roundEndMs`), whose own DB2 effects apply MOD_CONFUSE /
 *    MOD_CHARM / MOD_FEAR / MOD_STUN (`auraTakesControl`, a lookup), must
 *    have a `[CC ON TEAM] <victim> ← <aura name>` line within a second of
 *    it. Checked = every such application, whether or not the control set
 *    (`ccSpellIds`) or the dispel backlash table holds the id. Kinds: `not
 *    in the control set: <name> <id>` (a control the product does not know),
 *    `in the control set, no line` (one it knows and did not print). Out of
 *    the total: the ids a ruling left out (`RULED_OUT`). A re-broadcast pair
 *    is one aura (`dropAuraRebroadcasts`), read at its first application.
 *    Reads `[CC ON TEAM]` lines only.
 */
import { BACKLASH_AURA_CC_TYPE } from "@gladlog/analysis/src/data/backlashCc";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { dropAuraRebroadcasts } from "@gladlog/analysis/src/utils/auraRebroadcast";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { auraTakesControl } from "@gladlog/analysis/src/utils/spellMechanics";

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
import { RULED_OUT, RULED_OUT_KIND } from "./t125";

export const CHECKS = ["controlAuraNoCcLine"] as const;
const KNOWN_NO_LINE = "in the control set, no line";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `controlAuraNoCcLine|${RULED_OUT_KIND}`,
]);

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
    // a re-broadcast pair (REMOVED then APPLIED of one aura within a
    // millisecond: Chaos Nova, Mighty Bash, Sleep Walk's two phases) is one
    // aura, whose line is its first application's — the producers' own
    // filter (605 base: all 21 `in the control set, no line` were these)
    for (const a of dropAuraRebroadcasts((u.auraEvents ?? []) as any[])) {
      if (ev(a) !== APPLIED || a.destUnitId !== u.id) continue;
      const id = String(a.spellId);
      if (auraTakesControl(id) !== true) continue;
      const t = tsOf(a);
      // the product's round, and an aura removed in its own millisecond
      // never held the unit (the t125 selection)
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
      const ruledOut = RULED_OUT.has(id);
      if (!ruledOut) ctx.bump("controlAuraNoCcLine");
      const name = nameOf(id, a.spellName);
      const sec = Math.floor((t - ctx.start) / 1000);
      if (
        ccLines.some(
          (c) => c.pid === pid && c.name === name && Math.abs(c.sec - sec) <= 1,
        )
      )
        continue;
      const known = ccSpellIds.has(id) || BACKLASH_AURA_CC_TYPE.has(id);
      ctx.violate(
        "controlAuraNoCcLine",
        ruledOut
          ? RULED_OUT_KIND
          : known
            ? KNOWN_NO_LINE
            : `not in the control set: ${name} ${id}`,
        t,
        `${u.name}:${id}:${t}`,
        `${u.name} got ${name} ${id} at ${fmtS(sec)} from the other side; no [CC ON TEAM] line`,
        "",
      );
    }
  }
}
