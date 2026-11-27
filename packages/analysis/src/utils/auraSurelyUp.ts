import type { ICombatUnit } from "@gladlog/parser-compat";
import { LogEvent } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";
import { dropAuraRebroadcasts } from "./auraRebroadcast";

/** T308: how far past an aura's official end its life must show before
 * the log counts as saying it was still up (a row in the cap's own second
 * is the cap's) */
export const AURA_SURELY_UP_PAST_MS = 1000;

/** T308: a damage / heal row this close before the caster's next press of
 * the spell can be that press's own effect (its rows can lead its aura and
 * its cast row — `EFFECT_START_BEFORE_S`, enemyCDs.ts) */
export const AURA_SURELY_UP_NEXT_PRESS_LEAD_MS = 500;

/**
 * T308 (user 2026-11-27): does the log show `auraId` (the caster's, on
 * `holder`) still up more than `AURA_SURELY_UP_PAST_MS` past `capMs` — the
 * official end of a life with no REMOVED — and before `untilMs` (the round's
 * end, or the caster's next press `nextPressMs`)? Positive evidence only:
 * - the aura's own REFRESH / APPLIED_DOSE / REMOVED_DOSE on the holder by the
 *   caster, up to `untilMs` (a REFRESH by the next press says the aura was
 *   still up for it to refresh — an ended one is APPLIED);
 * - the caster's own damage / heal rows under the aura's or the press's
 *   English name, before `nextPressMs − AURA_SURELY_UP_NEXT_PRESS_LEAD_MS`
 *   (codex 85-tk-L5-T308-1 #1), and ON the holder when the holder is not the
 *   caster — a target's debuff is read off its own hits, not another copy's
 *   (#2: Temporal Wound on a pet); an absorbed melee swing names the
 *   victim's shield, not an ability of the attacker, and is no row of it (#8).
 * A re-APPLIED of the aura (re-broadcast pairs dropped, as the interval
 * builder does — #7) is a lost end, not evidence. Shared with scan5/t308
 * `burstAuraPastSpan`.
 */
export function auraSurelyUpPastMs(
  caster: Pick<ICombatUnit, "id" | "damageOut" | "healOut">,
  holder: Pick<ICombatUnit, "id" | "auraEvents">,
  auraId: string,
  castSpellId: string,
  capMs: number,
  untilMs: number,
  nextPressMs: number = Infinity,
): boolean {
  const fromMs = capMs + AURA_SURELY_UP_PAST_MS;
  if (!(untilMs > fromMs)) return false;
  // a re-broadcast REMOVED + APPLIED pair is one aura, not a lost end
  // (`dropAuraRebroadcasts`, as the interval builder reads it)
  const rows = dropAuraRebroadcasts(
    (holder.auraEvents ?? []).filter(
      (a) => a.spellId === auraId && a.srcUnitId === caster.id,
    ),
  ).filter(
    (a) => a.logLine.timestamp > capMs && a.logLine.timestamp <= untilMs,
  );
  // a lost end: applied again with nothing closing the life before it
  if (rows.some((a) => a.logLine.event === LogEvent.SPELL_AURA_APPLIED))
    return false;
  if (
    rows.some(
      (a) =>
        a.logLine.timestamp > fromMs &&
        (a.logLine.event === LogEvent.SPELL_AURA_REFRESH ||
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED_DOSE ||
          a.logLine.event === LogEvent.SPELL_AURA_REMOVED_DOSE),
    )
  )
    return true;
  const names = new Set([
    getEnglishSpellName(auraId, ""),
    getEnglishSpellName(castSpellId, ""),
  ]);
  names.delete("");
  const rowsUntilMs = Math.min(
    untilMs + 1,
    nextPressMs - AURA_SURELY_UP_NEXT_PRESS_LEAD_MS,
  );
  return [...(caster.damageOut ?? []), ...(caster.healOut ?? [])].some((r) => {
    if (r.srcUnitId !== caster.id) return false;
    if (holder.id !== caster.id && r.destUnitId !== holder.id) return false;
    const t = r.logLine.timestamp;
    if (t <= fromMs || t >= rowsUntilMs) return false;
    const { attackSpellId, attackSpellName } = r as {
      attackSpellId?: string;
      attackSpellName?: string;
    };
    if (attackSpellId)
      return names.has(
        getEnglishSpellName(attackSpellId, attackSpellName ?? ""),
      );
    if (r.logLine.event === LogEvent.SPELL_ABSORBED) return false;
    return names.has(getEnglishSpellName(r.spellId, r.spellName ?? ""));
  });
}
