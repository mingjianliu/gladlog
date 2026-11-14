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

/** The global cooldown's floor under haste: no player presses one spell
 * twice inside it. */
export const GCD_FLOOR_MS = 750;

/** Rows of one spell closer than this to a press's first row are that press
 * written again, not a second press: the global cooldown's floor less the
 * log's own jitter (`PRESS_EFFECT_LEAD_MS`). Measured on the healers of the
 * 605 archives, same-spell row pairs of non-heal presses once
 * `isNoPlayerPressRow` has dropped its rows: 1,462 at 0–49 ms (Power
 * Infusion's target row and self row, 1,435), 58 at 50–699 ms — Power
 * Infusion's self row up to 184 ms late (8), Fire Breath's rows 400–649 ms
 * apart (20), a trinket's (10), Lava Burst's copies (5) — and from 700 ms on
 * the presses a global cooldown apart (15 at 700–749 ms, 54 at 750–799 ms,
 * 876 more up to 1.05 s: Void Blast, Smite, cat Swipe at 1.0 s). */
export const SAME_PRESS_ROWS_MAX_GAP_MS = GCD_FLOOR_MS - PRESS_EFFECT_LEAD_MS;

/**
 * One row a press, for a reader that lists what was pressed and how often:
 * of the rows of one spell closer than `SAME_PRESS_ROWS_MAX_GAP_MS` to the
 * first row of a press, only that first row stays (Power Infusion: a row on
 * its target and a row on the priest, 1 ms apart as a rule, 56 ms and
 * 184 ms in the logs read). Unlike `filterRealPresses` it keeps two presses
 * a global cooldown apart (pipeline T88: "pressed Swipe ×3" read "Swipe"
 * through that reader, rows 1.00 s apart). Input order is preserved.
 */
export function foldSamePressRows<
  T extends { spellId?: string; logLine: { timestamp: number } },
>(events: readonly T[]): T[] {
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.logLine.timestamp - b.e.logLine.timestamp || a.i - b.i);
  const drop = new Set<number>();
  // the first row of the spell's current press: a row is measured against
  // it, not against the row before, so a press 1 s after another stays one
  // however late the first press's last row came
  const pressStartBySpell = new Map<string, number>();
  for (const { e, i } of sorted) {
    const id = String(e.spellId ?? "");
    const t = e.logLine.timestamp;
    const start = pressStartBySpell.get(id);
    if (start !== undefined && t - start < SAME_PRESS_ROWS_MAX_GAP_MS)
      drop.add(i);
    else pressStartBySpell.set(id, t);
  }
  return events.filter((_, i) => !drop.has(i));
}
