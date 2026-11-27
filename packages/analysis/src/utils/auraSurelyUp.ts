import type { ICombatUnit } from "@gladlog/parser-compat";
import { LogEvent } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";

/** T308: how far past an aura's official end its life must show before
 * the log counts as saying it was still up (a row in the cap's own second
 * is the cap's) */
export const AURA_SURELY_UP_PAST_MS = 1000;

/**
 * T308 (user 2026-11-27): does the log show `auraId` (the caster's, on
 * `holder`) still up more than `AURA_SURELY_UP_PAST_MS` past `capMs` — the
 * official end of a life with no REMOVED — and before `untilMs`? Positive
 * evidence only: the aura's own REFRESH / APPLIED_DOSE / REMOVED_DOSE on the
 * holder by the caster, or the caster's damage / heal rows under the
 * aura's or the press's English name (Breath of Sindragosa's breath, Doom
 * Winds' strikes). A re-APPLIED of the aura with no REMOVED before it is a
 * lost end, not evidence. Shared with scan5/t308 `burstAuraPastSpan`.
 */
export function auraSurelyUpPastMs(
  caster: Pick<ICombatUnit, "id" | "damageOut" | "healOut">,
  holder: Pick<ICombatUnit, "id" | "auraEvents">,
  auraId: string,
  castSpellId: string,
  capMs: number,
  untilMs: number,
): boolean {
  const fromMs = capMs + AURA_SURELY_UP_PAST_MS;
  if (!(untilMs > fromMs)) return false;
  const rows = (holder.auraEvents ?? []).filter(
    (a) =>
      a.spellId === auraId &&
      a.srcUnitId === caster.id &&
      a.logLine.timestamp > capMs &&
      a.logLine.timestamp <= untilMs,
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
  return [...(caster.damageOut ?? []), ...(caster.healOut ?? [])].some((r) => {
    if (r.srcUnitId !== caster.id) return false;
    const t = r.logLine.timestamp;
    if (t <= fromMs || t > untilMs) return false;
    const { attackSpellId, attackSpellName } = r as {
      attackSpellId?: string;
      attackSpellName?: string;
    };
    const name = attackSpellId
      ? getEnglishSpellName(attackSpellId, attackSpellName ?? "")
      : getEnglishSpellName(r.spellId, r.spellName ?? "");
    return names.has(name);
  });
}
