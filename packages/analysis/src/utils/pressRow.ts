/**
 * "Is this SPELL_CAST_SUCCESS row a button the player pressed?" — the one
 * predicate for readers that name or list what a player pressed (pipeline
 * T12, fact12 D5 / D6 / D9). The log writes a cast row for several things
 * nobody pressed, and each was registered in its own table:
 *
 *  - a swing the game fires in place of the auto-attack
 *    (`AUTO_ATTACK_REPLACEMENT_IDS`, damagePress.ts — Crusading Strikes,
 *    one row per swing);
 *  - a passive proc (`isPassiveProcCast`, cooldowns.ts — Reclamation);
 *  - a copy, a companion or an impact row of another press
 *    (`isNoPressRow`, castPress.ts — Twin Flames beside Disintegrate,
 *    the triggered Sundering beside Lava Lash).
 *
 * Readers consulted different subsets: the kick-eaten follow-up and the
 * missed-cleanse `dispellerPressed` list knew only the passive procs,
 * ABILITIES INTO only the copies (1d26a991: "acted on another school 2.3 s
 * later (Crusading Strikes …)" ×3, `Twin Flame +1.5s`; 4cacc702: "(Sundering
 * …)" for the Lava Lash press). The forward check is scan5 `t12`.
 */
import { isNoPressRow } from "./castPress";
import { isPassiveProcCast, PRESS_EFFECT_LEAD_MS } from "./cooldowns";
import { AUTO_ATTACK_REPLACEMENT_IDS } from "./damagePress";

/** The row-level half: a cast row the game writes on its own whatever
 * surrounds it — an auto-attack replacement swing or a passive proc. */
export function isAutomaticCastRow(e: {
  spellId?: string;
  spellName?: string;
}): boolean {
  return (
    (!!e.spellId && AUTO_ATTACK_REPLACEMENT_IDS.has(e.spellId)) ||
    isPassiveProcCast(e)
  );
}

/** Is this cast row no press of the player's: an automatic row
 * (`isAutomaticCastRow`) or a row that rides on another press
 * (`isNoPressRow`)? `rows` are the unit's cast rows. */
export function isNoPlayerPressRow<
  T extends {
    spellId?: string;
    spellName?: string;
    destUnitId?: string;
    logLine: { timestamp: number; event?: string };
  },
>(e: T, rows: readonly T[]): boolean {
  return isAutomaticCastRow(e) || isNoPressRow(e, rows);
}

/** The global cooldown's floor under haste. */
export const GCD_FLOOR_MS = 750;

/** How late the caster's own row of a press on somebody else can come and
 * still be that press: inside the global cooldown's floor, less the log's
 * own jitter (`PRESS_EFFECT_LEAD_MS`). Power Infusion writes a row on its
 * target and a row on the priest — 1,435 pairs under 50 ms on the healers of
 * the 605 archives, 7 at 50–99 ms, 1 at 184 ms; no other non-heal spell
 * there has a pair of that shape (one row on the caster, one on another
 * unit) under 1.05 s. */
export const SAME_PRESS_SELF_ROW_MAX_GAP_MS =
  GCD_FLOOR_MS - PRESS_EFFECT_LEAD_MS;

/**
 * One row a press, for a reader that lists what was pressed and how often.
 * Of the rows of one spell, a row is the press before it written again when
 *  - it comes inside `PRESS_EFFECT_LEAD_MS` of the row before, or
 *  - it and that press's first row sit on two units, one of them the
 *    caster, inside `SAME_PRESS_SELF_ROW_MAX_GAP_MS` (Power Infusion's
 *    target row and self row: 648ca403 r3, 56 ms apart).
 * Time alone does not tell a press's second row from a second cast past
 * 50 ms: a Lightning Bolt finishing its bar and an instant one 617 ms later
 * (18703d63 r1), two Cyclones 342 ms apart on two targets (86b19ba2 r0) are
 * two casts (codex 85-tk-J-T88-2d). Unlike `filterRealPresses` it keeps two
 * presses a global cooldown apart (pipeline T88: "pressed Swipe ×3" read
 * "Swipe" through that reader, rows 1.00 s apart). Known rest: 50 pairs of
 * the 605's healers 50–699 ms apart that are neither shape stay two rows
 * (Fire Breath 20, a trinket 10, Lava Burst 5, Lightning Bolt 4, Chrono
 * Flames 4, …), five of them the real casts above. Input order is preserved.
 */
export function foldSamePressRows<
  T extends {
    spellId?: string;
    srcUnitId?: string;
    destUnitId?: string;
    logLine: { timestamp: number };
  },
>(events: readonly T[]): T[] {
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.logLine.timestamp - b.e.logLine.timestamp || a.i - b.i);
  const drop = new Set<number>();
  const prevRowMs = new Map<string, number>();
  const pressStart = new Map<string, T>();
  for (const { e, i } of sorted) {
    const id = String(e.spellId ?? "");
    const t = e.logLine.timestamp;
    const prev = prevRowMs.get(id);
    const start = pressStart.get(id);
    prevRowMs.set(id, t);
    const selfPair =
      start !== undefined &&
      t - start.logLine.timestamp < SAME_PRESS_SELF_ROW_MAX_GAP_MS &&
      !!e.srcUnitId &&
      start.destUnitId !== e.destUnitId &&
      (start.destUnitId === e.srcUnitId || e.destUnitId === e.srcUnitId);
    if ((prev !== undefined && t - prev < PRESS_EFFECT_LEAD_MS) || selfPair)
      drop.add(i);
    else pressStart.set(id, e);
  }
  return events.filter((_, i) => !drop.has(i));
}
