/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, damageOut) */
/**
 * scan5/t248.ts — pipeline T248: the last tick of a channel whose own aura
 * ticks (`isOwnTickChannelAura`: a DB2 channel carrying a periodic-damage
 * aura itself, the tick rows under the aura's id — Disintegrate 356995) is
 * logged just after the aura's REMOVED, and `lastPeriodicTriggerEndS` ends
 * the effect at it when it sits within `PERIODIC_LAST_TRIGGER_SLACK_MS`.
 *
 *  - `channelOwnTickPastSlack`: the slack against the log. Counted: every
 *    REMOVED of such an aura a player put on itself that is followed, within
 *    1 s and before the aura's next APPLIED or next press (a channel chained
 *    into its next one), by a damage row of the aura's id from that player. Flagged: one whose first such row sits past the slack
 *    — a tick the endpoint does not reach (`within` = inside it, kept as the
 *    measurement the constant rests on).
 *
 *  - `scriptedChannelAbsorbedTickMissed` (codex 80-PIPE-234-B212 #2): a
 *    channel the game scripts (`SCRIPTED_PERIODIC_TRIGGER_AURA_IDS`: Void Ray
 *    473728, its ticks 1214595 by name) whose last tick a shield took whole —
 *    a SPELL_ABSORBED row, `spellId` the shield, the tick its attack — within
 *    the slack after the REMOVED. Counted: every such row; flagged: one
 *    `lastPeriodicTriggerEndS` does not reach (5443c00c r2: two Void Shield
 *    rows 12 ms after the REMOVED; 905ef1e0 r4, Life Cocoon).
 *
 * The printed side of the same fact is fact10 `channelLastTickDropped` (the
 * burst ledger's `your damage` against the sum with the tick).
 */
import { SCRIPTED_PERIODIC_TRIGGER_AURA_IDS } from "@gladlog/analysis/src/data/periodicAuraGenerated";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  isOwnTickChannelAura,
  lastPeriodicTriggerEndS,
  PERIODIC_LAST_TRIGGER_SLACK_MS,
} from "@gladlog/analysis/src/utils/enemyCDs";

import {
  ABSORBED,
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "channelOwnTickPastSlack",
  "scriptedChannelAbsorbedTickMissed",
] as const;

/** how far past a REMOVED a row of the aura's id is still looked at */
const LOOK_MS = 1000;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  scriptedAbsorbedTicks(ctx);
  for (const u of ctx.players as any[]) {
    const own = ((u.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.srcUnitId === u.id &&
        a.destUnitId === u.id &&
        isOwnTickChannelAura(String(a.spellId)),
    );
    for (const rem of own) {
      if (ev(rem) !== REMOVED) continue;
      const id = String(rem.spellId);
      const at = tsOf(rem);
      // its next APPLIED (the same millisecond counts: a channel chained
      // into the next is REMOVED and APPLIED at once) or next press: the
      // rows from there on are the next channel's
      const nextUp = own.find(
        (a, j) =>
          j > own.indexOf(rem) && String(a.spellId) === id && ev(a) === APPLIED,
      );
      const nextPress = successesOf(u).find(
        (c) => String(c.spellId) === id && tsOf(c) > at,
      );
      const before = Math.min(
        nextUp ? tsOf(nextUp) : Infinity,
        nextPress ? tsOf(nextPress) : Infinity,
      );
      const ticks = ((u.damageOut ?? []) as any[])
        .filter(
          (d) =>
            d.srcUnitId === u.id &&
            // a tick a shield took whole: `attackSpellId` on its
            // SPELL_ABSORBED row
            (String(d.spellId) === id ||
              String(d.attackSpellId ?? "") === id) &&
            tsOf(d) > at &&
            tsOf(d) <= at + LOOK_MS &&
            tsOf(d) < before,
        )
        .map(tsOf)
        .sort((a: number, b: number) => a - b);
      if (ticks.length === 0) continue;
      ctx.bump("channelOwnTickPastSlack");
      const lag = ticks[0]! - at;
      if (lag <= PERIODIC_LAST_TRIGGER_SLACK_MS) continue;
      ctx.violate(
        "channelOwnTickPastSlack",
        nameOf(id, rem.spellName),
        at,
        `${u.name}#${id}#${at}`,
        `${u.name} ${nameOf(id, rem.spellName)}: REMOVED +${at - ctx.start}ms, its next own row ${lag} ms later (slack ${PERIODIC_LAST_TRIGGER_SLACK_MS} ms)`,
      );
    }
  }
}

function scriptedAbsorbedTicks(ctx: IRoundCtx): void {
  const combat = {
    ...(ctx.legacy as any),
    startTime: ctx.start,
    endTime: ctx.end,
  };
  for (const u of ctx.players as any[]) {
    const own = ((u.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.srcUnitId === u.id &&
        a.destUnitId === u.id &&
        SCRIPTED_PERIODIC_TRIGGER_AURA_IDS.has(String(a.spellId)),
    );
    for (const rem of own) {
      if (ev(rem) !== REMOVED) continue;
      const id = String(rem.spellId);
      const name = getEnglishSpellName(id, "");
      if (!name) continue;
      const at = tsOf(rem);
      const nextUp = own.find(
        (a, j) =>
          j > own.indexOf(rem) && String(a.spellId) === id && ev(a) === APPLIED,
      );
      const before = nextUp ? tsOf(nextUp) : Infinity;
      const rows = ((u.damageOut ?? []) as any[]).filter(
        (d) =>
          ev(d) === ABSORBED &&
          d.srcUnitId === u.id &&
          !!d.attackSpellId &&
          getEnglishSpellName(
            String(d.attackSpellId),
            d.attackSpellName ?? "",
          ) === name &&
          tsOf(d) > at &&
          tsOf(d) <= Math.min(at + PERIODIC_LAST_TRIGGER_SLACK_MS, ctx.end) &&
          tsOf(d) < before,
      );
      if (rows.length === 0) continue;
      ctx.bump("scriptedChannelAbsorbedTickMissed");
      const last = Math.max(...rows.map(tsOf));
      const endS = lastPeriodicTriggerEndS(
        u,
        id,
        (at - ctx.start) / 1000,
        combat as never,
      );
      if (ctx.start + endS * 1000 >= last - 0.5) continue;
      ctx.violate(
        "scriptedChannelAbsorbedTickMissed",
        nameOf(id, rem.spellName),
        at,
        `${u.name}#${id}#${at}`,
        `${u.name} ${name}: REMOVED +${at - ctx.start}ms, a tick a shield took whole ${last - at} ms later, the endpoint at +${Math.round(endS * 1000)}ms`,
      );
    }
  }
}
