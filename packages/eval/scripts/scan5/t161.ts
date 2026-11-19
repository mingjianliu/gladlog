/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t161.ts — pipeline T161 (round-13 retest P8), count first: a press
 * that puts its aura on its caster AND on another player (Power Infusion
 * with Twins of the Sun Priestess) has two copies, each with its own end.
 * The span of the caster's cooldown (`buffEndSeconds`, what `burstCastSpan`
 * reads: the burst ledger's `Power Infusion 0:16–0:31`, the burst's end) is
 * taken from the copy that ends last — 77a6b63e: the priest's own copy was
 * purged at 0:26, the hunter's ran to 0:31.
 *
 * Counted, once per round, per offensive-cooldown press of every player (the
 * product's own `reconstructEnemyCDTimeline`), unseen presses left out. Log
 * truth, on the raw aura rows the caster wrote: a copy = an APPLIED / REFRESH
 * of an aura with the cast's own spell id by the caster in [cast − 0.5 s,
 * cast + 2 s] on a player; its end = the first REMOVED of that aura on that
 * unit by the caster (or with no source) after it, inside the round.
 *
 * Check `spanReadsAnotherUnitsCopy` — the presses with a copy on the caster
 * and one on another player, both ends logged, kinds:
 *  - `span ends at a teammate's copy, own copy gone ≥ 1 s earlier`;
 *  - `span ends at the copy on an enemy (the effect on its target)` — out of
 *    the total: a debuff of the cast's id on its target is the effect itself
 *    (Kingsbane, Fury of Elune);
 *  - `own copy ended later, span at the own copy` — out of the total;
 *  - `copies end within 1 s` — out of the total;
 *  - `span at the own copy, the other's ran on` — out of the total: the
 *    caster's copy ended first and the span sits there;
 *  - `span at neither end` — out of the total (another rule set it: a death
 *    cut, the next press, a refresh).
 */
import { dropAuraRebroadcasts } from "@gladlog/analysis/src/utils/auraRebroadcast";
import * as enemyCDs from "@gladlog/analysis/src/utils/enemyCDs";

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

export const CHECKS = [
  "spanReadsAnotherUnitsCopy",
  "ledgerSpanReadsAnotherUnitsCopy",
] as const;
const C = "spanReadsAnotherUnitsCopy";
/** the same pairing against the end the BURST LEDGER reads
 * (`casterCopyEndSeconds`, user ruling R83: the caster's own copy). On a
 * tree before the ruling the function is missing and the ledger's end is
 * `buffEndSeconds` — the scan then counts what the ledger read there. */
const L = "ledgerSpanReadsAnotherUnitsCopy";
const ledgerEndOf = (cd: any): number =>
  (enemyCDs as any).casterCopyEndSeconds?.(cd) ?? cd.buffEndSeconds;
const TEAMMATE = "span ends at a teammate's copy, own copy gone ≥ 1 s earlier";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  // R83: the threat readers keep the latest copy — the first check's
  // teammate kind is the accepted cost, counted, not a violation
  `${C}|${TEAMMATE}`,
  ...[
    "own copy ended later, span at the own copy",
    "copies end within 1 s",
    "span at neither end",
    "span at the own copy, the other's ran on",
    "span ends at the copy on an enemy (the effect on its target)",
  ].map((k) => `${L}|${k}`),
  `${C}|own copy ended later, span at the own copy`,
  `${C}|copies end within 1 s`,
  `${C}|span at neither end`,
  `${C}|span at the own copy, the other's ran on`,
  `${C}|span ends at the copy on an enemy (the effect on its target)`,
]);

/** the product's `EFFECT_START_BEFORE_S` / `EFFECT_START_AFTER_S`, stated
 * here on purpose: the scan does not import the reading it checks */
const START_BEFORE_S = 0.5;
const START_AFTER_S = 2;
const APART_S = 1;
const AT_S = 0.2;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const combat = { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end };
  const players = ctx.players as any[];
  for (const u of players) {
    const casts = enemyCDs.reconstructEnemyCDTimeline(
      [u] as never,
      combat as never,
    ).players.flatMap((p) => p.offensiveCDs);
    for (const cd of casts) {
      if (cd.unseenPress) continue;
      const castMs = ctx.start + cd.castTimeSeconds * 1000;
      const id = String(cd.spellId);
      // the caster's copies of the cast's own aura, per holder
      const endOf = (holder: any): number | undefined => {
        // the product's own rebroadcast predicate (`dropAuraRebroadcasts`):
        // a REMOVED / APPLIED pair the log re-states is no end (codex
        // 85-tk-WIN-T161-1 #3, -2 #2)
        const rows = (dropAuraRebroadcasts(holder.auraEvents ?? []) as any[])
          .filter(
            (a) =>
              String(a.spellId) === id &&
              a.destUnitId === holder.id &&
              (a.srcUnitId === u.id ||
                (ev(a) === REMOVED &&
                  (!a.srcUnitId || /^0+$/.test(a.srcUnitId)))),
          )
          .sort((a, b) => tsOf(a) - tsOf(b));
        const start = rows.find(
          (a) =>
            (ev(a) === APPLIED || ev(a) === REFRESH) &&
            a.srcUnitId === u.id &&
            tsOf(a) >= castMs - START_BEFORE_S * 1000 &&
            tsOf(a) <= castMs + START_AFTER_S * 1000,
        );
        if (!start) return undefined;
        const end = rows.find(
          (a) => ev(a) === REMOVED && tsOf(a) > tsOf(start),
        );
        if (!end || tsOf(end) > ctx.end) return undefined;
        return (tsOf(end) - ctx.start) / 1000;
      };
      const own = endOf(u);
      if (own === undefined) continue;
      const others = players
        .filter((p) => p.id !== u.id)
        .map((p) => ({
          name: p.name as string,
          ally: p.reaction === u.reaction,
          end: endOf(p),
        }))
        .filter(
          (o): o is { name: string; ally: boolean; end: number } =>
            o.end !== undefined,
        );
      if (others.length === 0) continue;
      ctx.bump(C);
      const other = others.sort((a, b) => b.end - a.end)[0]!;
      for (const [check, span] of [
        [C, cd.buffEndSeconds],
        [L, ledgerEndOf(cd)],
      ] as const) {
        if (check === L) ctx.bump(L);
        const kind =
          Math.abs(own - other.end) < APART_S
            ? "copies end within 1 s"
            : Math.abs(span - own) <= AT_S
              ? own > other.end
                ? "own copy ended later, span at the own copy"
                : "span at the own copy, the other's ran on"
              : Math.abs(span - other.end) <= AT_S && own < other.end
                ? other.ally
                  ? TEAMMATE
                  : "span ends at the copy on an enemy (the effect on its target)"
                : "span at neither end";
        ctx.violate(
          check,
          kind,
          castMs,
          `${u.name}#${id}#${Math.round(cd.castTimeSeconds * 1000)}`,
          `${nameOf(id, cd.spellName)} ${id}: ${u.name} pressed ${fmtS(cd.castTimeSeconds)} (${cd.castTimeSeconds.toFixed(2)} s): own copy ended ${own.toFixed(2)} s, ${other.name}'s ${other.end.toFixed(2)} s; span ends ${span.toFixed(2)} s`,
        );
      }
    }
  }
}
