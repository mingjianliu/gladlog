/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t68.ts — pipeline T68 (GH #132 item 15, "a re-send's length"): the
 * DR, disarm and cast-blocking pairings decide "is this re-send the same
 * application" on the control's DB2 base length, the break and
 * missed-cleanse pairings on the application's own (caster-resolved)
 * length. The two differ only for a control sent again on a unit AFTER its
 * base length and INSIDE its caster-resolved one, with no REMOVED between.
 *
 * Check `resendPastBaseLength` counts those occasions on the raw aura rows,
 * each round once: a hard control or disarm APPLIED on a player, then
 * REFRESHed or APPLIED again from the same source with no REMOVED / BROKEN
 * of it in between — a violation when the gap is past the base length
 * (`ccFullDurationSeconds`) by more than `SLACK_S`; kind `inside-extended`
 * when it is still inside the caster's own length
 * (`ccFullDurationForCaster`), `past-both` otherwise (the log lost the
 * REMOVED — both readings close it at their length).
 */
import { ccFullDurationSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import {
  ccSpellIds,
  disarmSpellIds,
} from "@gladlog/analysis/src/data/spellTags";
import { ccFullDurationForCaster } from "@gladlog/analysis/src/utils/ccDuration";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  tsOf,
} from "./ctx";

export const CHECKS = ["resendPastBaseLength"] as const;

/** a re-send this close to the base length is the expiry's own row order */
const SLACK_S = 0.1;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const byId = new Map<string, any>(ctx.units.map((u: any) => [u.id, u]));
  for (const unit of ctx.players) {
    const open = new Map<string, number>();
    for (const a of unit.auraEvents ?? []) {
      const id = a.spellId as string | undefined;
      if (!id || (!ccSpellIds.has(id) && !disarmSpellIds.has(id))) continue;
      const key = `${id}|${a.srcUnitId ?? ""}`;
      const e = ev(a);
      if (e === REMOVED || /BROKEN/.test(e)) {
        open.delete(key);
        continue;
      }
      if (e !== APPLIED && e !== REFRESH) continue;
      const t = tsOf(a);
      const from = open.get(key);
      open.set(key, t);
      if (from === undefined) continue;
      const base = ccFullDurationSeconds(id);
      if (base === undefined) continue;
      ctx.bump("resendPastBaseLength");
      const gapS = (t - from) / 1000;
      if (gapS <= base + SLACK_S) continue;
      const own = ccFullDurationForCaster(id, byId.get(a.srcUnitId)) ?? base;
      ctx.violate(
        "resendPastBaseLength",
        gapS <= own + SLACK_S ? "inside-extended" : "past-both",
        t,
        `${unit.id}:${key}:${t}`,
        `${nameOf(id, a.spellName ?? "")} ${id} re-sent on a player at ${fmtS((t - ctx.start) / 1000)}, ${gapS.toFixed(2)}s after its application (base ${base}s, caster's ${own}s) with no REMOVED between`,
      );
    }
  }
}
