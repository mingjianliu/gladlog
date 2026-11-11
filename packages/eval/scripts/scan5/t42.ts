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
 *    cast row names a TEAMMATE: a buff on that teammate (Power Infusion),
 *    and on its caster when its own aura went up there too (PvP Bloodlust) —
 *    while a player it buffed hit the target between the press and the
 *    bracket's last printed second (a buff has no hit of its own, so the
 *    producer asks no more of it). Kind = the
 *    opening press. Counted: every burst-anchored line named for a press of
 *    the team inside its bracket.
 */
import { isHealerHeldOffensive } from "@gladlog/analysis/src/data/healerHeldOffensive";
import { isEnemyCdWindowSpell } from "@gladlog/analysis/src/utils/cooldowns";
import { anchorsKillAttempt } from "@gladlog/analysis/src/utils/killAttempts";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["attemptNamedLaterPress"] as const;

const LINE =
  /^ {2}\[(\d+:\d{2})–(\d+:\d{2})\] on (\S+) — (.+?) burst \(no stun\)/;
const AURA_PAIR_MS = 1000;

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
      const onCaster = ((u.auraEvents ?? []) as any[]).some(
        (a) =>
          ev(a) === APPLIED &&
          a.srcUnitId === u.id &&
          nameOf(a.spellId, a.spellName) === nameOf(id, c.spellName) &&
          Math.abs(tsOf(a) - tsOf(c)) <= AURA_PAIR_MS,
      );
      return (onCaster ? [ally, u] : [ally]).some((b: any) =>
        ((b.damageOut ?? []) as any[]).some(
          (d) =>
            d.destUnitId === target.id && tsOf(d) >= tsOf(c) && tsOf(d) < hi,
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
