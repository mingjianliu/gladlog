/* eslint-disable @typescript-eslint/no-explicit-any -- the checks walk the untyped legacy parse objects by the hundred */
/**
 * scan5/t92.ts — ticket T92: a channel pressed under one spell id and
 * carried by another. Lightning Lasso's press is 305483; the channel DB2
 * marks "Is Channelled" is 305485, the debuff the shaman holds on the target
 * for as long as the channel runs. The occupancy reader asked the channelled
 * table about the PRESS's id and saw no channel: a healer inside a Lasso
 * read as free hands (`[NO HEAL CAST]`, missed-cleanse `ownerCasting`).
 *
 *  - `channelUnderAnotherId`: a player's SPELL_CAST_SUCCESS whose id is not
 *    in the channelled table, while that player put an aura of the same
 *    English name and a channelled id on some unit within 100 ms of it (the
 *    log's own start of the channel). The product must hold a channel span
 *    of that press (`channelSpans` ∪ `tickEndedChannelSpans`, the occupancy
 *    reader's two sources). Kind = the spell's name. Once per round.
 *    Not a press of this shape: a row inside a channel the same player
 *    pressed under a channelled id of that name (Divine Hymn's tick 64844
 *    logs a SUCCESS). Out of the total, kind `noTick`: the caster has no
 *    effect row of the carrying id and no kick of the channel before their
 *    next press — the channel was cut before its first tick with no row to
 *    end it on, and the reader guesses no length (the 11 looked at in the
 *    605 raw logs all lost the aura within 1.1 s). Read from the log alone,
 *    whatever span the product holds.
 */
import { CHANNELED_SPELL_IDS } from "@gladlog/analysis/src/data/channeledGenerated";
import {
  channelSpans,
  tickEndedChannelSpans,
} from "@gladlog/analysis/src/utils/castCommitSpans";

import { APPLIED, ev, type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["channelUnderAnotherId"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "channelUnderAnotherId|noTick",
]);

const START_MATCH_MS = 100;
/** a row this long after a channelled press of its name is that channel's */
const RUNNING_CHANNEL_MS = 10_000;
let channelledNames: Set<string> | undefined;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const C = "channelUnderAnotherId";
  channelledNames ??= new Set(
    [...CHANNELED_SPELL_IDS].map((id) => nameOf(id)).filter((n) => n !== ""),
  );
  // every aura a player put on anyone, by source
  const applied = new Map<string, Array<{ t: number; id: string }>>();
  for (const u of ctx.units)
    for (const a of (u.auraEvents ?? []) as any[]) {
      if (ev(a) !== APPLIED || !CHANNELED_SPELL_IDS.has(String(a.spellId)))
        continue;
      const list = applied.get(a.srcUnitId) ?? [];
      list.push({ t: tsOf(a), id: String(a.spellId) });
      applied.set(a.srcUnitId, list);
    }
  for (const u of ctx.players) {
    const mine = applied.get(u.id);
    if (!mine) continue;
    let spans: Array<{ startMs: number }> | undefined;
    const casts = successesOf(u);
    for (const c of casts) {
      const id = String(c.spellId);
      const t = tsOf(c);
      if (t < ctx.start || t > ctx.roundEndAt) continue;
      if (CHANNELED_SPELL_IDS.has(id)) continue;
      const name = nameOf(id);
      if (name === "" || !channelledNames.has(name)) continue;
      const carrier = mine.find(
        (a) => Math.abs(a.t - t) <= START_MATCH_MS && nameOf(a.id) === name,
      );
      if (!carrier) continue;
      if (
        casts.some(
          (o: any) =>
            CHANNELED_SPELL_IDS.has(String(o.spellId)) &&
            nameOf(String(o.spellId)) === name &&
            tsOf(o) <= t + START_MATCH_MS &&
            tsOf(o) >= t - RUNNING_CHANNEL_MS,
        )
      )
        continue;
      ctx.bump(C);
      // what the log shows of the channel's end, read before the product is
      // asked (codex 85-tk-J-T92-1 #1: the out-of-total kind must not depend
      // on what the reader returned): an effect row of the carrying id, or a
      // kick of the channel, before the caster's next press
      const nextPress = Math.min(
        ...casts.map((o: any) => tsOf(o)).filter((x: number) => x > t),
        Infinity,
      );
      const ticked = [
        ...((u.damageOut ?? []) as any[]),
        ...((u.healOut ?? []) as any[]),
        ...((u.missesOut ?? []) as any[]),
      ].some(
        (r) =>
          r.srcUnitId === u.id &&
          String(r.attackSpellId ?? r.spellId) === carrier.id &&
          tsOf(r) > t &&
          tsOf(r) <= nextPress,
      );
      const kicked = ((u.actionIn ?? []) as any[]).some(
        (a) =>
          ev(a) === "SPELL_INTERRUPT" &&
          a.destUnitId === u.id &&
          [id, carrier.id].includes(String(a.extraSpellId ?? "")) &&
          tsOf(a) >= t &&
          tsOf(a) <= nextPress,
      );
      if (!ticked && !kicked) {
        ctx.violate(
          C,
          "noTick",
          t,
          `${u.id}#${id}#${t}`,
          `${name} pressed as ${id}, its channel ${carrier.id} cut before a tick and with no kick row: no length to hold`,
        );
        continue;
      }
      spans ??= [...channelSpans(u), ...tickEndedChannelSpans(u)];
      if (spans.some((s) => Math.abs(s.startMs - t) <= START_MATCH_MS))
        continue;
      ctx.violate(
        C,
        name,
        t,
        `${u.id}#${id}#${t}`,
        `${name} pressed as ${id}, its channel ${carrier.id} went up with it; the product holds no channel span of the press`,
      );
    }
  }
}
