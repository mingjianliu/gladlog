/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t42.ts — ticket T42 (r12 D12, r12b N14): a burst-anchored KILL
 * ATTEMPTS line `[a–b] on T — X burst (no stun)` is named for the press that
 * opened the bracket and went into the target. Truth is the cast and damage
 * rows of the log.
 *
 *  - `attemptNamedLaterPress`: the team pressed nothing named X in the
 *    bracket's first printed second, pressed X later inside it, and that
 *    first second holds an earlier offensive-cooldown press of the team
 *    (`isEnemyCdWindowSpell`, `anchorsKillAttempt` — table lookups) whose
 *    cast row names a TEAMMATE and whose aura went onto that teammate: a
 *    buff on it (Power Infusion), and on its caster when its own aura went
 *    up there too (PvP Bloodlust) — while a player it buffed hit the target
 *    between the press and the end of the kill-credit slack after the
 *    bracket (a buff has no hit of its own, so the producer asks no more of
 *    it). Kind = the
 *    opening press. Counted: every burst-anchored line named for a press of
 *    the team inside its bracket.
 */
import { isHealerHeldOffensive } from "@gladlog/analysis/src/data/healerHeldOffensive";
import { SAVE_CAST_AURA_PAIR_S } from "@gladlog/analysis/src/utils/auraIntervals";
import { KILL_CREDIT_SLACK_S } from "@gladlog/analysis/src/utils/burstLedger";
import { isEnemyCdWindowSpell } from "@gladlog/analysis/src/utils/cooldowns";
import { anchorsKillAttempt } from "@gladlog/analysis/src/utils/killAttempts";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["attemptNamedLaterPress"] as const;

const LINE =
  /^ {2}\[(\d+:\d{2})–(\d+:\d{2})\] on (\S+) — (.+?) burst \(no stun\)/;
// the producer's own pairing tolerance and credit slack (codex
// 85-tk-H-T42-1 #2, #3)
const AURA_PAIR_MS = SAVE_CAST_AURA_PAIR_S * 1000;

export function run(ctx: IRoundCtx): void {
  const team = ctx.players.filter(
    (u: any) => u.reaction === ctx.owner.reaction,
  );
  for (const l of ctx.lines) {
    const m = LINE.exec(l);
    if (!m || m[4]!.includes(" (cast into ")) continue;
    const target = ctx.byName.get(m[3]!);
    if (!target) continue;
    const lo = ctx.start + secOf(m[1]!) * 1000;
    const hi = ctx.start + (secOf(m[2]!) + 1) * 1000;
    // the span the producer reads a buffed player's hits over: the bracket
    // and the kill-credit slack after it, never past the round's end
    const creditEnd = Math.min(
      ctx.start + (secOf(m[2]!) + KILL_CREDIT_SLACK_S) * 1000,
      ctx.roundEndAt,
    );
    const presses = team
      .flatMap((u: any) => successesOf(u).map((c) => ({ u, c })))
      .filter(({ c }) => tsOf(c) >= lo && tsOf(c) < hi)
      .sort((a, b) => tsOf(a.c) - tsOf(b.c));
    const named = presses.filter(
      ({ c }) => nameOf(c.spellId, c.spellName) === m[4],
    );
    if (named.length === 0) continue;
    ctx.bump("attemptNamedLaterPress");
    if (tsOf(named[0]!.c) < lo + 1000) continue;
    const opener = presses.find(({ u, c }) => {
      if (tsOf(c) >= lo + 1000) return false;
      const id = String(c.spellId);
      if (
        !isEnemyCdWindowSpell(id, u.spec) ||
        isHealerHeldOffensive(id, u.spec) ||
        !anchorsKillAttempt(u, id)
      )
        return false;
      const ally = team.find(
        (f: any) => f.id === c.destUnitId && f.id !== u.id,
      );
      if (!ally) return false;
      const auraOn = (holder: any): boolean =>
        ((holder.auraEvents ?? []) as any[]).some(
          (a) =>
            (ev(a) === APPLIED || ev(a) === REFRESH) &&
            a.srcUnitId === u.id &&
            nameOf(a.spellId, a.spellName) === nameOf(id, c.spellName) &&
            Math.abs(tsOf(a) - tsOf(c)) <= AURA_PAIR_MS,
        );
      // a buff on the teammate is its aura there: a press that only names
      // one buffs nobody
      if (!auraOn(ally)) return false;
      return (auraOn(u) ? [ally, u] : [ally]).some((b: any) =>
        ((b.damageOut ?? []) as any[]).some(
          (d) =>
            d.destUnitId === target.id &&
            tsOf(d) >= tsOf(c) &&
            tsOf(d) <= creditEnd,
        ),
      );
    });
    if (!opener) continue;
    const name = nameOf(opener.c.spellId, opener.c.spellName);
    ctx.violate(
      "attemptNamedLaterPress",
      name,
      lo,
      `${m[3]}:${m[1]}`,
      `${name} (cast on a teammate) opened the bracket at ${((tsOf(opener.c) - ctx.start) / 1000).toFixed(1)}s; the line is named for ${m[4]}, first pressed at ${((tsOf(named[0]!.c) - ctx.start) / 1000).toFixed(1)}s`,
      l,
    );
  }
}
