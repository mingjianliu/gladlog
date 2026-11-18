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
 *  - `rootReachCauseSplit` (per round, once): T170 changed two readings of
 *    the sweep — (1) the healer branch reads the healer's own reach
 *    (`healerReachToAccuse`, never under the flat 40 yd) instead of the
 *    flat 40 yd, (2) a landed targeted cast proves its second. The producer
 *    is run with each switched off (`computeRootReachability`'s `without`)
 *    and every root's claim — unreachable seconds, the named ally and its
 *    seconds — is compared with the claim under both off (the reading
 *    before T170). Inventory kinds, not in the total: `healer reach only`,
 *    `landed cast only`, `both` (each alone moves the claim). In the total:
 *    `healer reach adds or lengthens` — with (1) alone on, a root claims
 *    more unreachable seconds, or more for an ally, than before (a healer
 *    whose own reach is under 40 yd accused where the flat bound cleared
 *    it). Checked = the round's roots of at least `ROOT_MIN_DURATION_S`.
 */
import {
  computeRootReachability,
  rootedCastsOnOthers,
  rootIntervalsInRound,
  rootSweptSeconds,
} from "@gladlog/analysis/src/utils/rootReachability";

import { type IRoundCtx, nameOf, secOf } from "./ctx";

export const CHECKS = ["rootReachVsLandedCast", "rootReachCauseSplit"] as const;
const SPLIT = "rootReachCauseSplit";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  ["healer reach only", "landed cast only", "both"].map((k) => `${SPLIT}|${k}`),
);

const ROOT_LINE =
  /^(\d+:\d\d)\s+\[ROOT\]\s+(.+?) \(from .+?\) rooted (?:friendly|enemy) (?:\[YOU\] )?(\d+)\([^)]*\) \((melee|healer|ranged)\) for [\d.]+s — (.+)$/;
const HEALER_CLAIM =
  /^(\d+)\([^)]*\) \(taking damage\) out of range\/LoS for (\d+)s/;
const ATTACK_CLAIM =
  /^(?:nearest enemy beyond \d+yd|no enemy in range\/LoS) for (\d+)s/;

function causeSplit(ctx: IRoundCtx): void {
  const run4 = (without: {
    flatHealerReach?: boolean;
    noLandedCasts?: boolean;
  }) => computeRootReachability(ctx.legacy, ctx.players, ctx.units, without);
  const before = run4({ flatHealerReach: true, noLandedCasts: true });
  const reachOnly = run4({ noLandedCasts: true });
  const castOnly = run4({ flatHealerReach: true });
  const claim = (r: (typeof before)[number]): string =>
    `${r.unreachableSeconds}|${r.worstAlly?.name ?? ""}|${r.worstAlly?.seconds ?? ""}`;
  before.forEach((b, i) => {
    const r = reachOnly[i]!;
    const c = castOnly[i]!;
    if (r.rootedId !== b.rootedId || c.rootedId !== b.rootedId) return;
    ctx.bump(SPLIT);
    const at = ctx.start + b.atSeconds * 1000;
    const fact = `${ctx.roundKey}:${b.rootedId}:${b.atSeconds}:${b.spellId}`;
    const moved = `${b.spellName} on ${b.rootedName} (${b.rootedRole}), claim seconds|ally|ally seconds: before ${claim(b)}, reach only ${claim(r)}, cast only ${claim(c)}`;
    const byReach = claim(r) !== claim(b);
    const byCast = claim(c) !== claim(b);
    if (byReach || byCast)
      ctx.violate(
        SPLIT,
        byReach && byCast
          ? "both"
          : byReach
            ? "healer reach only"
            : "landed cast only",
        at,
        fact,
        moved,
      );
    const allyUp =
      !!r.worstAlly &&
      r.worstAlly.seconds >
        (b.worstAlly?.name === r.worstAlly.name ? b.worstAlly.seconds : 0) &&
      r.worstAlly.seconds > (b.worstAlly?.seconds ?? 0);
    if (r.unreachableSeconds > b.unreachableSeconds || allyUp)
      ctx.violate(SPLIT, "healer reach adds or lengthens", at, fact, moved);
  });
}

export function run(ctx: IRoundCtx): void {
  if (ctx.firstOwnerOfRound) causeSplit(ctx);
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
