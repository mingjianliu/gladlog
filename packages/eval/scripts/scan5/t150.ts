/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t150.ts — pipeline T150 (GH #218): where an offensive cooldown's
 * span ends (`buffEndSeconds`, what `burstCastSpan` and through it
 * kick-eaten's `enemyBurst` / `ourBurst`, the burst ledger and `[RES]`'s
 * `(Ns left)` read) against the caster's own aura rows.
 *
 * Truth, read from the raw rows of the round and nothing else: the press's
 * own aura (its cast id, caster on caster) was APPLIED at the press and
 * APPLIED again before any REMOVED / BROKEN row of it — the log says it was
 * up from the press to that second application. Counted once per round, per
 * press of the round's players with such a second application before the
 * caster's next press of the spell and before the round's end.
 *
 *  - `cooldownSpanEndsBeforeUnremovedReapply`: the span ends before that
 *    second application. Kinds: `re-applied within one length of the end`
 *    (the application came no later than the span's own length after its
 *    end); `later — a lost REMOVED reads the same` (out of the total: a
 *    REMOVED the log never wrote and a later, separate application look
 *    exactly like this, and the interval builder's official cap is the safe
 *    reading of it).
 */
import { reconstructEnemyCDTimeline } from "@gladlog/analysis/src/utils/enemyCDs";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  REFRESH,
  REMOVED,
  tsOf,
} from "./ctx";

export const CHECKS = ["cooldownSpanEndsBeforeUnremovedReapply"] as const;
export const OUT_OF_TOLERANCE_S = 0.05;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "cooldownSpanEndsBeforeUnremovedReapply|later — a lost REMOVED reads the same",
]);

/** the press's application is looked for this far around its cast row
 * (the product's `EFFECT_START_BEFORE_S` / `EFFECT_START_AFTER_S`, stated
 * here on purpose: the scan does not import the reading it checks) */
const START_BEFORE_S = 0.5;
const START_AFTER_S = 2;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const combat = { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end };
  const endS = (ctx.end - ctx.start) / 1000;
  for (const u of ctx.players as any[]) {
    const casts = reconstructEnemyCDTimeline(
      [u] as never,
      combat as never,
    ).players.flatMap((p) => p.offensiveCDs);
    for (const cd of casts) {
      if (cd.unseenPress) continue;
      const c = cd.castTimeSeconds;
      const nextS = Math.min(
        endS,
        ...casts
          .filter(
            (o) => o.spellId === cd.spellId && o.castTimeSeconds > c + 1e-6,
          )
          .map((o) => o.castTimeSeconds - START_BEFORE_S),
      );
      const rows = ((u.auraEvents ?? []) as any[])
        .filter(
          (a) =>
            String(a.spellId) === cd.spellId &&
            a.srcUnitId === u.id &&
            a.destUnitId === u.id,
        )
        .map((a) => ({ t: (tsOf(a) - ctx.start) / 1000, e: ev(a) }))
        .sort((a, b) => a.t - b.t);
      const first = rows.findIndex(
        (r) =>
          (r.e === APPLIED || r.e === REFRESH) &&
          r.t >= c - START_BEFORE_S &&
          r.t <= c + START_AFTER_S,
      );
      if (first < 0) continue;
      let reappliedS: number | undefined;
      for (const r of rows.slice(first + 1)) {
        if (r.t >= nextS) break;
        if (r.e === APPLIED) {
          // a second APPLIED inside the press's own start window is the
          // press's (a rebroadcast pair)
          if (r.t <= c + START_AFTER_S) continue;
          reappliedS = r.t;
          break;
        }
        if (r.e !== REFRESH && r.e !== "SPELL_AURA_APPLIED_DOSE") {
          // REMOVED, BROKEN, BROKEN_SPELL: the run ended in the log
          if (r.e === REMOVED || String(r.e).startsWith("SPELL_AURA_BROKEN"))
            break;
        }
      }
      if (reappliedS === undefined) continue;
      ctx.bump("cooldownSpanEndsBeforeUnremovedReapply");
      const end = cd.buffEndSeconds;
      if (end >= reappliedS - OUT_OF_TOLERANCE_S) continue;
      const lengthS = end - c;
      ctx.violate(
        "cooldownSpanEndsBeforeUnremovedReapply",
        reappliedS - end <= lengthS
          ? "re-applied within one length of the end"
          : "later — a lost REMOVED reads the same",
        ctx.start + c * 1000,
        `${u.id}:${cd.spellId}:${Math.round(c * 1000)}`,
        `${cd.spellName} pressed ${fmtS(c)} (${c.toFixed(2)}): its span ends ${end.toFixed(2)}, the aura was APPLIED again at ${reappliedS.toFixed(2)} with no REMOVED of it since the press`,
      );
    }
  }
}
