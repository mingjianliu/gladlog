/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t147.ts — pipeline T147 (draft U05): a `[CD PRIOR]` line's `(you
 * could not cast it for Ns of that dip)` note against the product's one
 * reading of "could this cooldown be PRESSED" (`pressBlockedIntervalsForSpells`:
 * a stun does not stop what the game lets a stunned player press — Pain
 * Suppression, Guardian Spirit; a silence, a lockout of its school, a fear
 * or a disarm of a weapon spell still does).
 *
 *  - `cdPriorCannotCastWhilePressable`: counted, every [CD PRIOR] line with
 *    the note. The line prints where the dip began ("fell below that at")
 *    but not where it ended, so the check is a lower bound that cannot
 *    accuse a right line (codex 85-tk-KICK-T147-1 #4): a violation when the
 *    note claims more seconds than the whole seconds, from the second the
 *    dip began to the round's end, at which a press-blocking interval of
 *    the line's cooldown (its `[ref=…|<id>]`) holds — the product's own
 *    per-second test. The note then counted a stun the cooldown goes
 *    through.
 */
import {
  enemySourceIds,
  pressBlockedIntervalsForSpells,
} from "@gladlog/analysis/src/utils/cannotCastIntervals";

import { type IRoundCtx, secOf } from "./ctx";

export const CHECKS = ["cdPriorCannotCastWhilePressable"] as const;

const LINE_RE =
  /\[CD PRIOR\].* fell below that at (\d+:\d\d) .* by (\d+:\d\d) with .* \(you could not cast it for ([\d.]+)s of that dip\).*\[ref=[^\]]*\|(\d+)\]/;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  let blockedOf: Map<string, Array<{ from: number; to: number }>> | undefined;
  for (const l of ctx.lines) {
    const m = LINE_RE.exec(l);
    if (!m) continue;
    ctx.bump("cdPriorCannotCastWhilePressable");
    const fromSec = secOf(m[1]!);
    const claimed = Number(m[3]);
    const id = m[4]!;
    blockedOf ??= new Map();
    let blocked = blockedOf.get(id);
    if (!blocked) {
      const enemies = (ctx.players as any[]).filter(
        (p) => p.reaction !== owner.reaction,
      );
      blocked = pressBlockedIntervalsForSpells(
        owner,
        enemySourceIds(enemies, ctx.units as never),
        [id],
        ctx.units as never,
        false,
      );
      blockedOf.set(id, blocked);
    }
    const lastSec = Math.floor((ctx.end - ctx.start) / 1000);
    let held = 0;
    for (let sec = fromSec; sec <= lastSec; sec++) {
      const t = ctx.start + sec * 1000;
      if (blocked.some((b) => b.from <= t && t < b.to)) held++;
    }
    if (held >= Math.floor(claimed)) continue;
    ctx.violate(
      "cdPriorCannotCastWhilePressable",
      "stun only",
      ctx.start + fromSec * 1000,
      `${owner.id}:${id}:${m[1]}`,
      `the note claims ${claimed}s; a press of ${id} is stopped at ${held} whole seconds from ${m[1]} to the round's end`,
      l,
    );
  }
}
