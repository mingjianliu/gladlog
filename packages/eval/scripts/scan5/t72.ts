/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t72.ts — pipeline T72 (user ruling R19, 2026-11-10): five 45 s damage
 * buttons with no use condition are major offensive cooldowns — Reaper's
 * Mark, Odyn's Fury, Meteor, Goremaw's Bite, Mindgames. Exactly these five.
 *
 * Two checks, both over every round of the capture:
 *  - `ruledOffensivePress`: every SPELL_CAST_SUCCESS of one of the five by a
 *    player of either side. A violation is a press the producer's own
 *    predicate (`isOffensiveCdFor`, the reader of `OFFENSIVE_CD_SPELL_IDS`)
 *    does not call an offensive cooldown. Kind = the spell.
 *  - `killWindowRuledPressUnnamed`: a press of one of the five by a player
 *    of the owner's side whose rendered second falls inside a rendered
 *    `[KILL WINDOW]` / `[VULNERABLE]` span `a–b` (seconds a … b−1: the
 *    producer's span end is fractional, so the last rendered second is left
 *    out). A violation is a line that does not name the spell — the line
 *    names every team offensive cooldown ready at, back inside or pressed
 *    inside the span (`createKillWindowFactsComputer`).
 *
 * `RULED` is the ruling's own list, not a copy of a producer table: the scan
 * asks the producer about each id.
 */
import { isOffensiveCdFor } from "@gladlog/analysis/src/utils/spellDanger";

import { type IRoundCtx, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "ruledOffensivePress",
  "killWindowRuledPressUnnamed",
] as const;

/** R19: id → the roster name the prompt prints */
export const RULED: Readonly<Record<string, string>> = {
  "439843": "Reaper's Mark",
  "385059": "Odyn's Fury",
  "153561": "Meteor",
  "426591": "Goremaw's Bite",
  "375901": "Mindgames",
};

export const WINDOW_RE =
  /^\s+\[(?:KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d)/;

export function run(ctx: IRoundCtx): void {
  const start = (ctx.legacy as any).startTime as number;
  const presses = ctx.players.flatMap((u: any) =>
    successesOf(u)
      .filter((c: any) => String(c.spellId) in RULED)
      .map((c: any) => ({ u, id: String(c.spellId), at: tsOf(c) as number })),
  );
  if (presses.length === 0) return;
  if (ctx.firstOwnerOfRound)
    for (const p of presses) {
      ctx.bump("ruledOffensivePress");
      if (isOffensiveCdFor(p.id, p.u.spec)) continue;
      ctx.violate(
        "ruledOffensivePress",
        RULED[p.id]!,
        p.at,
        `${p.u.id}|${p.id}|${p.at}`,
        `${RULED[p.id]} ${p.id} pressed at +${((p.at - start) / 1000).toFixed(1)}s is not an offensive cooldown to isOffensiveCdFor`,
      );
    }
  if (!ctx.owner) return;
  const own = presses.filter((p) => p.u.reaction === ctx.owner.reaction);
  if (own.length === 0) return;
  for (const l of ctx.lines) {
    const m = WINDOW_RE.exec(l);
    if (!m) continue;
    const from = secOf(m[1]!);
    const to = secOf(m[2]!);
    for (const p of own) {
      const s = Math.floor((p.at - start) / 1000);
      if (s < from || s >= to) continue;
      ctx.bump("killWindowRuledPressUnnamed");
      if (l.includes(RULED[p.id]!)) continue;
      ctx.violate(
        "killWindowRuledPressUnnamed",
        RULED[p.id]!,
        p.at,
        `${ctx.owner.id}|${m[1]}|${p.id}|${p.at}`,
        `${RULED[p.id]} pressed at +${((p.at - start) / 1000).toFixed(1)}s inside the ${m[1]}–${m[2]} window, the line does not name it`,
        l.trim().slice(0, 160),
      );
    }
  }
}
