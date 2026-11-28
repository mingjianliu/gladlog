import type { ICombatUnit } from "@gladlog/parser-compat";
import { LogEvent } from "@gladlog/parser-compat";

import {
  castsOfEffectAura,
  castsOfTalentEffectAura,
  effectSpanIdsOfCast,
  sourcePressedAuraNear,
} from "../data/castEffectAuras";
import { getEnglishSpellName } from "../data/spellEffectData";
import { officialDurationS } from "./auraIntervals";
import { dropAuraRebroadcasts } from "./auraRebroadcast";
import { COPY_CAST_IDS } from "./castPress";
import { isVariantPress } from "./cooldowns";

/** T308: how far past an aura's official end its life must show before
 * the log counts as saying it was still up (a row in the cap's own second
 * is the cap's) */
export const AURA_SURELY_UP_PAST_MS = 1000;

/** T308: a damage / heal row this close before the caster's next press of
 * the spell can be that press's own effect (its rows can lead its aura and
 * its cast row — `EFFECT_START_BEFORE_S`, enemyCDs.ts) */
export const AURA_SURELY_UP_NEXT_PRESS_LEAD_MS = 500;

/** T308: a cast row of a button that grants the aura more than this after
 * a life's start is the caster's NEXT press (a press's own rows log within
 * `EFFECT_START_AFTER_S`, 2 s, of it) */
export const AURA_NEXT_PRESS_AFTER_MS = 2000;

/** T308: every button that puts `auraId` up — the aura's own id, its press,
 * the casts it is the effect of (Ascendance → Doom Winds, codex
 * 85-tk-L5-T308-1b #3 / 1c #1) and the talent casts that grant it. One set
 * for every reader of a life's next press. */
export function auraGrantingCastIds(
  auraId: string,
  pressId?: string,
): ReadonlySet<string> {
  return new Set([
    auraId,
    ...(pressId !== undefined ? [pressId] : []),
    ...castsOfEffectAura(auraId),
    ...castsOfTalentEffectAura(auraId),
  ]);
}

/** T308: the caster's next press of `auraId` after a life that started at
 * `startMs` — its first SUCCESS of a granting button
 * (`auraGrantingCastIds`), or of a spell with the aura's or the press's
 * English name, more than `AURA_NEXT_PRESS_AFTER_MS` after the start;
 * Infinity when none. The burst timeline, the burst ledger, the threat /
 * friendly-CD readers and scan5/t308 read it here. */
export function nextAuraPressMs(
  caster: Pick<ICombatUnit, "spellCastEvents">,
  auraId: string,
  pressId: string | undefined,
  startMs: number,
): number {
  const granting = auraGrantingCastIds(auraId, pressId);
  const names = new Set(
    [auraId, pressId]
      .filter((x): x is string => x !== undefined)
      .map((id) => getEnglishSpellName(id, ""))
      .filter((n) => n !== ""),
  );
  let next = Infinity;
  for (const c of caster.spellCastEvents ?? []) {
    const t = c.logLine.timestamp;
    if (
      c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS ||
      !c.spellId ||
      t <= startMs + AURA_NEXT_PRESS_AFTER_MS ||
      t >= next
    )
      continue;
    // a same-named id is a press only when it is one of its own — a
    // cooldown of its own and no copy (`isVariantPress`, `COPY_CAST_IDS`,
    // the ledger's press reading): Doom Winds' pulse 469270 is not (codex
    // 85-tk-L5-T308-1d #1, 42059a52 r1: the pulse at 11.0 s read as the
    // press after 9.0 s)
    if (
      granting.has(c.spellId) ||
      (names.has(getEnglishSpellName(c.spellId, c.spellName ?? "")) &&
        isVariantPress(c.spellId) &&
        !COPY_CAST_IDS.has(c.spellId))
    )
      next = t;
  }
  return next;
}

/** T308: the press's effect auras other than `auraId` — a row of one of
 * them is no evidence of this one (`auraSurelyUpPastMs`'s `otherAuraIds`) */
export function otherEffectAurasOf(
  pressId: string | undefined,
  auraId: string,
): ReadonlySet<string> {
  const ids = new Set(
    pressId !== undefined ? effectSpanIdsOfCast(pressId) : [],
  );
  ids.delete(auraId);
  return ids;
}

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
  caster: Pick<ICombatUnit, "id" | "damageOut" | "healOut"> &
    Partial<Pick<ICombatUnit, "spec" | "info" | "spellCastEvents">>,
  holder: Pick<ICombatUnit, "id" | "auraEvents">,
  auraId: string,
  castSpellId: string,
  capMs: number,
  untilMs: number,
  opts: {
    /** the caster's next press of the spell (Infinity when none) */
    nextPressMs?: number;
    /** the press's OTHER effect auras — each has a life of its own, and a
     * row of one of them says nothing of this one, whatever its name
     * (codex 85-tk-L5-T308-1b #1: Feral Frenzy's bleed 274838 ticking
     * past the caster's own 1 s 274837, both named "Feral Frenzy") */
    otherAuraIds?: ReadonlySet<string>;
  } = {},
): boolean {
  const nextPressMs = opts.nextPressMs ?? Infinity;
  const fromMs = capMs + AURA_SURELY_UP_PAST_MS;
  if (!(untilMs > fromMs)) return false;
  // a re-broadcast REMOVED + APPLIED pair is one aura, not a lost end
  // (`dropAuraRebroadcasts`, as the interval builder reads it)
  const own = dropAuraRebroadcasts(
    (holder.auraEvents ?? []).filter(
      (a) => a.spellId === auraId && a.srcUnitId === caster.id,
    ),
  );
  const rows = own.filter(
    (a) => a.logLine.timestamp > capMs && a.logLine.timestamp <= untilMs,
  );
  // a lost end: applied again with nothing closing the life before it —
  // unless it is the aura re-sent, as the interval builder reads one: no
  // press of it near, inside the official length of its last row (codex
  // 85-tk-L5-T308-1d #3: a re-sent APPLIED inside a REFRESHed life vetoed
  // the hits after it)
  const resent = (a: (typeof own)[number]): boolean => {
    const last = own
      .filter((o) => o.logLine.timestamp < a.logLine.timestamp)
      .pop();
    if (!last || last.logLine.event === LogEvent.SPELL_AURA_REMOVED)
      return false;
    const d = officialDurationS(
      auraId,
      caster as never,
      last.logLine.timestamp,
    );
    return (
      d !== null &&
      a.logLine.timestamp <= last.logLine.timestamp + d * 1000 &&
      !sourcePressedAuraNear(
        caster.spellCastEvents ?? [],
        auraId,
        a.logLine.timestamp,
      )
    );
  };
  if (
    rows.some(
      (a) => a.logLine.event === LogEvent.SPELL_AURA_APPLIED && !resent(a),
    )
  )
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
      return (
        !opts.otherAuraIds?.has(attackSpellId) &&
        names.has(getEnglishSpellName(attackSpellId, attackSpellName ?? ""))
      );
    if (r.logLine.event === LogEvent.SPELL_ABSORBED) return false;
    if (r.spellId && opts.otherAuraIds?.has(r.spellId)) return false;
    return names.has(getEnglishSpellName(r.spellId, r.spellName ?? ""));
  });
}

/**
 * T308: where a life shown still up runs to — `untilMs` (the round's end or
 * the caster's next press), cut at its holder's first death after the
 * life's start `startMs`: an aura does not outlive the unit it sits on
 * (codex 85-tk-L5-T308-1b #4: a Breath of Sindragosa ran on to the round's
 * end past its caster's death). A death before the official end leaves
 * nothing past it (1c #4).
 */
export function auraSurelyUpUntilMs(
  holder: Partial<Pick<ICombatUnit, "deathRecords">>,
  startMs: number,
  untilMs: number,
): number {
  let end = untilMs;
  for (const d of holder.deathRecords ?? []) {
    const t = d.timestamp;
    if (t > startMs && t < end) end = t;
  }
  return end;
}
