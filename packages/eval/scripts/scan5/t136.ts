/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t136.ts — ticket T136 (wave-4 N01): Restless Blades' give-back, both
 * directions. The audits found Sprint pressed before the model had it back
 * (`back 1:58`, re-pressed 1:55.35); GH #198 left the other side open (a
 * press refused `not yet recovered` after the model called the spell back).
 * A change of the give-back moves both, so both are counted.
 *
 *  - `restlessBladesPressBeforeBack`: every Outlaw player, every spell
 *    Restless Blades gives back to (`EVENT_COOLDOWN_REDUCTIONS["79096"]`'s
 *    targets, the row under audit read as a list only), on the entry the
 *    lines read (`unitCooldownEntry`): a press after the first, not a free
 *    one, that the model has impossible with the presses before it
 *    (`cdAvailableAt`, then `cdMaybeAvailableAt`). Kind = the spell.
 *    Checked = the presses judged.
 *  - `restlessBladesRefusedAfterBack`: the log owner's own refusals (only
 *    the owner's are logged) of such a spell with a not-ready reason
 *    (`NOT_READY_REASONS`), no own cast success in the `GCD_S` before it (a
 *    press inside the global cooldown is refused with the same reason),
 *    at an instant the model has the spell certainly back (`cdAvailableAt`
 *    on the presses before, `REFUSED_SLACK_S` after its return). Kind = the
 *    spell. Checked = the refusals judged.
 */
import { NOT_READY_REASONS } from "@gladlog/analysis/src/analysis/candidates/shared";
import { EVENT_COOLDOWN_REDUCTIONS } from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import {
  CD_INSTANT_SLACK_S,
  cdAvailableAt,
  cdMaybeAvailableAt,
  cdSecondsUntilReady,
  type IMajorCooldownInfo,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "restlessBladesPressBeforeBack",
  "restlessBladesRefusedAfterBack",
] as const;

const OUTLAW = "260";
/** a refusal this soon after an own cast is the global cooldown's */
const GCD_S = 1.5;
/** the model's return must be at least this far behind the refusal */
const REFUSED_SLACK_S = 1;

function before(cd: IMajorCooldownInfo, t: number): IMajorCooldownInfo {
  const keep = (c: { timeSeconds: number }) => c.timeSeconds < t;
  return {
    ...cd,
    casts: cd.casts.filter(keep),
    ...(cd.sharedCasts ? { sharedCasts: cd.sharedCasts.filter(keep) } : {}),
  };
}

export function run(ctx: IRoundCtx): void {
  const targets = EVENT_COOLDOWN_REDUCTIONS["79096"]!.targets;
  if (ctx.firstOwnerOfRound)
    for (const u of ctx.players as any[]) {
      if (String(u.spec) !== OUTLAW) continue;
      for (const id of targets) {
        const cd = unitCooldownEntry(u, ctx.legacy, id);
        if (!cd) continue;
        for (const [i, c] of cd.casts.entries()) {
          if (i === 0 || c.freeRecast) continue;
          ctx.bump("restlessBladesPressBeforeBack");
          const t = c.timeSeconds;
          const prior = before(cd, t);
          if (cdAvailableAt(prior, t) || cdMaybeAvailableAt(prior, t)) continue;
          const last = prior.casts[prior.casts.length - 1]!.timeSeconds;
          ctx.violate(
            "restlessBladesPressBeforeBack",
            nameOf(id),
            ctx.start + t * 1000,
            `${ctx.roundKey}|${u.id}|${id}|${Math.floor(t)}`,
            `${nameOf(id)} at ${t.toFixed(2)}s: ${(t - last).toFixed(1)}s after the press before, model ${cd.cooldownSeconds}s x${cd.charges ?? 1}, ${cdSecondsUntilReady(prior, t).toFixed(1)}s short`,
          );
        }
      }
    }
  const owner = ctx.owner as any;
  if (!owner || String(owner.spec) !== OUTLAW) return;
  const own = successesOf(owner).map((c) => (tsOf(c) - ctx.start) / 1000);
  for (const f of ctx.rawStreams().castFailed) {
    if (f.unitGuid !== owner.id || !NOT_READY_REASONS.has(f.reason)) continue;
    const id = String(f.spellId);
    if (!targets.includes(id)) continue;
    const t = f.tSeconds;
    if (own.some((s) => s <= t && t - s < GCD_S)) continue;
    const cd = unitCooldownEntry(owner, ctx.legacy, id);
    if (!cd) continue;
    const prior = before(cd, t);
    if (prior.casts.length === 0) continue;
    ctx.bump("restlessBladesRefusedAfterBack");
    // `cdAvailableAt` reads `CD_INSTANT_SLACK_S` ahead: take it off too
    if (!cdAvailableAt(prior, t - REFUSED_SLACK_S - CD_INSTANT_SLACK_S))
      continue;
    const last = prior.casts[prior.casts.length - 1]!.timeSeconds;
    ctx.violate(
      "restlessBladesRefusedAfterBack",
      nameOf(id),
      ctx.start + t * 1000,
      `${ctx.roundKey}|${owner.id}|${id}|${Math.floor(t)}`,
      `${nameOf(id)} refused at ${t.toFixed(2)}s (${f.reason}), ${(t - last).toFixed(1)}s after the press before; the model has it back`,
    );
  }
}
