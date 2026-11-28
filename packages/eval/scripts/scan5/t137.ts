/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t137.ts — ticket T137 (wave-4 P06, GH #218 item 1.6): Hover 358267
 * pressed while the model has no charge of it back.
 *
 *  - `hoverPressBeforeBack`: every Evoker, on the entry the lines read
 *    (`unitCooldownEntry`): a press after the first, not a free one, that
 *    the model has impossible with the presses before it (`cdAvailableAt`,
 *    then `cdMaybeAvailableAt`). Kind = the holder's spec. Checked = the
 *    presses judged. Each round once.
 *  - `hoverRefusedAfterBack` (the opposite direction): the log owner's own
 *    not-ready refusal of Hover (`NOT_READY_REASONS`; only the owner's are
 *    logged), no own cast success in the `GCD_S` before it, at an instant
 *    the model has a charge certainly back (`cdAvailableAt` on the presses
 *    before, `REFUSED_SLACK_S` after its return). Checked = the refusals
 *    judged.
 */
import { NOT_READY_REASONS } from "@gladlog/analysis/src/analysis/candidates/shared";
import {
  CD_INSTANT_SLACK_S,
  cdAvailableAt,
  cdMaybeAvailableAt,
  cdSecondsUntilReady,
  type IMajorCooldownInfo,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "hoverPressBeforeBack",
  "hoverRefusedAfterBack",
] as const;
/** whole checks a model gap, in its own section (T314): Hover is in no kit
 * and no `back` line, so neither direction of the gap reaches a rendered
 * fact (the refusal side: codex 85-tk-L6-T314-1 #1, 6 rows on the 1215) */
export const MODEL_GAP: ReadonlySet<string> = new Set([
  "hoverPressBeforeBack",
  "hoverRefusedAfterBack",
]);
/** a refusal this soon after an own cast is the global cooldown's */
const GCD_S = 1.5;
/** the model's return must be at least this far behind the refusal */
const REFUSED_SLACK_S = 1;

const HOVER = "358267";
const EVOKER_SPECS = new Set(["1467", "1468", "1473"]);

function before(cd: IMajorCooldownInfo, t: number): IMajorCooldownInfo {
  const keep = (c: { timeSeconds: number }) => c.timeSeconds < t;
  return {
    ...cd,
    casts: cd.casts.filter(keep),
    ...(cd.sharedCasts ? { sharedCasts: cd.sharedCasts.filter(keep) } : {}),
  };
}

function refusals(ctx: IRoundCtx): void {
  const owner = ctx.owner as any;
  if (!owner || !EVOKER_SPECS.has(String(owner.spec))) return;
  const cd = unitCooldownEntry(owner, ctx.legacy, HOVER);
  if (!cd) return;
  const own = successesOf(owner).map((c) => (tsOf(c) - ctx.start) / 1000);
  for (const f of ctx.rawStreams().castFailed) {
    if (f.unitGuid !== owner.id || String(f.spellId) !== HOVER) continue;
    if (!NOT_READY_REASONS.has(f.reason)) continue;
    const t = f.tSeconds;
    if (own.some((s) => s <= t && t - s < GCD_S)) continue;
    const prior = before(cd, t);
    if (prior.casts.length === 0) continue;
    ctx.bump("hoverRefusedAfterBack");
    if (!cdAvailableAt(prior, t - REFUSED_SLACK_S - CD_INSTANT_SLACK_S))
      continue;
    ctx.violate(
      "hoverRefusedAfterBack",
      String(owner.spec),
      ctx.start + t * 1000,
      `${ctx.roundKey}|${owner.id}|refused|${Math.floor(t)}`,
      `Hover refused at ${t.toFixed(2)}s (${f.reason}); the model has a charge back (presses ${prior.casts.map((c) => c.timeSeconds.toFixed(1)).join(" ")})`,
    );
  }
}

export function run(ctx: IRoundCtx): void {
  refusals(ctx);
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.players as any[]) {
    if (!EVOKER_SPECS.has(String(u.spec))) continue;
    const cd = unitCooldownEntry(u, ctx.legacy, HOVER);
    if (!cd) continue;
    for (const [i, c] of cd.casts.entries()) {
      if (i === 0 || c.freeRecast) continue;
      ctx.bump("hoverPressBeforeBack");
      const t = c.timeSeconds;
      const prior = before(cd, t);
      if (cdAvailableAt(prior, t) || cdMaybeAvailableAt(prior, t)) continue;
      const last = prior.casts[prior.casts.length - 1]!.timeSeconds;
      ctx.violate(
        "hoverPressBeforeBack",
        String(u.spec),
        ctx.start + t * 1000,
        `${ctx.roundKey}|${u.id}|${Math.floor(t)}`,
        `Hover at ${t.toFixed(2)}s: ${(t - last).toFixed(1)}s after the press before, model ${cd.cooldownSeconds}s x${cd.charges ?? 1}, ${cdSecondsUntilReady(prior, t).toFixed(1)}s short`,
      );
    }
  }
}
