/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t170.ts — ticket T170 (round 14 D6 / D7 / D11): a `[ROOT]` line
 * counts seconds in which the rooted unit could not reach its target, read
 * from position samples. The log can say otherwise: a targeted cast of the
 * rooted unit that landed on that target in one of those seconds.
 *
 *  - `rootReachVsLandedCast`: a `[ROOT]` line whose `for Ns` claims more
 *    unreachable seconds than the root's swept seconds minus the seconds in
 *    which the rooted unit landed a targeted cast on the claimed target (a
 *    healer line: the ally it names; a melee / ranged line: any enemy
 *    player). The root, its swept seconds and the casts are the producer's
 *    own (`rootIntervalsInRound`, `rootSweptSeconds`,
 *    `rootedCastsOnOthers`); the claim is the rendered line's. Kind = the
 *    line's role. Checked = every `[ROOT]` line whose root is found.
 *    3c8cd2a3 r0 1:25: `3(AWarrior) (taking damage) out of range/LoS for 4s
 *    — could not be healed`, a 4-second sweep with Prayer of Mending landing
 *    on the Warrior in its first second.
 */
import {
  rootedCastsOnOthers,
  rootIntervalsInRound,
  rootSweptSeconds,
} from "@gladlog/analysis/src/utils/rootReachability";

import { type IRoundCtx, nameOf, secOf } from "./ctx";

export const CHECKS = ["rootReachVsLandedCast"] as const;

const ROOT_LINE =
  /^(\d+:\d\d)\s+\[ROOT\]\s+(.+?) \(from .+?\) rooted (?:friendly|enemy) (?:\[YOU\] )?(\d+)\([^)]*\) \((melee|healer|ranged)\) for [\d.]+s — (.+)$/;
const HEALER_CLAIM =
  /^(\d+)\([^)]*\) \(taking damage\) out of range\/LoS for (\d+)s/;
const ATTACK_CLAIM =
  /^(?:nearest enemy beyond \d+yd|no enemy in range\/LoS) for (\d+)s/;

export function run(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = ROOT_LINE.exec(line);
    if (!m) continue;
    const X = ctx.unitOfPid(m[3]);
    if (!X) continue;
    const atS = secOf(m[1]!);
    const iv = rootIntervalsInRound(X, ctx.legacy).find(
      (i) =>
        Math.floor(i.fromS) === atS && nameOf(i.spellId, i.spellName) === m[2],
    );
    if (!iv) continue;
    let claimed: number;
    let targets: Set<string>;
    if (m[4] === "healer") {
      const h = HEALER_CLAIM.exec(m[5]!);
      const ally = h && ctx.unitOfPid(h[1]);
      if (!h || !ally) continue;
      claimed = +h[2]!;
      targets = new Set([ally.id]);
    } else {
      const a = ATTACK_CLAIM.exec(m[5]!);
      if (!a) continue;
      claimed = +a[1]!;
      targets = new Set(
        (ctx.players as any[])
          .filter((p) => p.reaction !== X.reaction)
          .map((p) => p.id as string),
      );
    }
    ctx.bump("rootReachVsLandedCast");
    const swept = rootSweptSeconds(iv);
    const fromMs = ctx.start + iv.fromS * 1000;
    const casts = rootedCastsOnOthers(
      X,
      ctx.players,
      fromMs,
      ctx.start + iv.toS * 1000,
    ).filter((c) => targets.has(c.destId));
    const reached = swept.filter((s) =>
      casts.some((c) => Math.floor((c.atMs - ctx.start) / 1000) === s),
    );
    if (claimed > swept.length - reached.length)
      ctx.violate(
        "rootReachVsLandedCast",
        m[4]!,
        fromMs,
        `${ctx.roundKey}:${X.id}:${atS}:${iv.spellId}`,
        `claims ${claimed}s unreachable; ${swept.length} swept seconds, ${reached.length} with a landed cast on the target (${[...new Set(casts.map((c) => c.spellName))].join(", ")})`,
        line.trim().slice(0, 260),
      );
  }
}
