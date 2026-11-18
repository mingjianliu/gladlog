/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t154.ts — pipeline T154 (user ruling A8, 2026-11-17): Champion's
 * Spear 376079 is an offensive cooldown.
 *
 * Three checks, over every round of the capture (T72's two, and the line an
 * enemy's press gets):
 *  - `spearOffensivePress`: every SPELL_CAST_SUCCESS of 376079 by a player
 *    of either side, each round once. A violation is a press the producer's
 *    own predicate (`isOffensiveCdFor`, the reader of
 *    `OFFENSIVE_CD_SPELL_IDS`) does not call an offensive cooldown.
 *  - `spearKillWindowUnnamed`: a press by a player of the owner's side whose
 *    rendered second falls inside a rendered `[KILL WINDOW]` /
 *    `[VULNERABLE]` span `a–b` (seconds a … b−1). A violation is a line that
 *    does not name the spell — the line names every team offensive cooldown
 *    ready at, back inside or pressed inside the span.
 *  - `spearEnemyLine`: every timeline line of an enemy's press, by its tag.
 *    Counted: `[ENEMY UTILITY]` and `[ENEMY CD]` lines naming the spell; a
 *    violation is the `[ENEMY UTILITY]` one (kind `utility`) — an offensive
 *    cooldown's press is an `[ENEMY CD]` line.
 */
import { isOffensiveCdFor } from "@gladlog/analysis/src/utils/spellDanger";

import { type IRoundCtx, secOf, successesOf, tsOf } from "./ctx";
import { WINDOW_RE } from "./t72";

export const CHECKS = [
  "spearOffensivePress",
  "spearKillWindowUnnamed",
  "spearEnemyLine",
] as const;

const SPEAR = "376079";
const NAME = "Champion's Spear";
const ENEMY_LINE =
  /^(\d+:\d\d)\s+\[(ENEMY UTILITY|ENEMY CD)\]\s+(\d+)\(\S+\)[^:]*: Champion's Spear\b/;

export function run(ctx: IRoundCtx): void {
  const start = (ctx.legacy as any).startTime as number;
  for (const l of ctx.lines) {
    const m = ENEMY_LINE.exec(l);
    if (!m) continue;
    ctx.bump("spearEnemyLine");
    if (m[2] !== "ENEMY UTILITY") continue;
    ctx.violate(
      "spearEnemyLine",
      "utility",
      start + secOf(m[1]!) * 1000,
      `${ctx.unitOfPid(m[3]!)?.id ?? m[3]}|${m[1]}`,
      `${NAME} pressed by an enemy at ${m[1]} prints [ENEMY UTILITY]`,
      l.trim().slice(0, 200),
    );
  }
  const presses = ctx.players.flatMap((u: any) =>
    successesOf(u)
      .filter((c: any) => String(c.spellId) === SPEAR)
      .map((c: any) => ({ u, at: tsOf(c) as number })),
  );
  if (presses.length === 0) return;
  if (ctx.firstOwnerOfRound)
    for (const p of presses) {
      ctx.bump("spearOffensivePress");
      if (isOffensiveCdFor(SPEAR, p.u.spec)) continue;
      ctx.violate(
        "spearOffensivePress",
        String(p.u.spec),
        p.at,
        `${p.u.id}|${p.at}`,
        `${NAME} pressed at +${((p.at - start) / 1000).toFixed(1)}s is not an offensive cooldown to isOffensiveCdFor`,
      );
    }
  if (!ctx.owner) return;
  const own = presses.filter((p) => p.u.reaction === ctx.owner.reaction);
  for (const l of ctx.lines) {
    const m = WINDOW_RE.exec(l);
    if (!m) continue;
    const from = secOf(m[1]!);
    const to = secOf(m[2]!);
    for (const p of own) {
      const s = Math.floor((p.at - start) / 1000);
      if (s < from || s >= to) continue;
      ctx.bump("spearKillWindowUnnamed");
      if (l.includes(NAME)) continue;
      ctx.violate(
        "spearKillWindowUnnamed",
        "unnamed",
        p.at,
        `${ctx.owner.id}|${m[1]}|${p.at}`,
        `${NAME} pressed at +${((p.at - start) / 1000).toFixed(1)}s inside the ${m[1]}–${m[2]} window, the line does not name it`,
        l.trim().slice(0, 160),
      );
    }
  }
}
