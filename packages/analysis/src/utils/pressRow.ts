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

/**
 * One row a press, for a reader that lists what was pressed and how often:
 * of the rows of one spell closer than `PRESS_EFFECT_LEAD_MS` to the row
 * before — the bound main reads one press's own rows by — only the first
 * stays (Power Infusion: a row on its target and a row on the priest).
 * Unlike `filterRealPresses` it keeps two presses a global cooldown apart
 * (pipeline T88: "pressed Swipe ×3" read "Swipe" through that reader, rows
 * 1.00 s apart). The healers of the 605 archives hold 4,563 same-spell row
 * pairs under 1.05 s once `isNoPlayerPressRow` has dropped its rows: 663 at
 * 0–5 ms, 1,257 at 6–49 ms, 132 at 50–499 ms, 564 at 500–899 ms and 1,947
 * at 900–1,049 ms (Smite, Chain Heal, cat Swipe at 1.0 s). Input order is
 * preserved.
 */
export function foldSamePressRows<
  T extends { spellId?: string; logLine: { timestamp: number } },
>(events: readonly T[]): T[] {
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.logLine.timestamp - b.e.logLine.timestamp || a.i - b.i);
  const drop = new Set<number>();
  const prevBySpell = new Map<string, number>();
  for (const { e, i } of sorted) {
    const id = String(e.spellId ?? "");
    const t = e.logLine.timestamp;
    const prev = prevBySpell.get(id);
    prevBySpell.set(id, t);
    if (prev !== undefined && t - prev < PRESS_EFFECT_LEAD_MS) drop.add(i);
  }
  return events.filter((_, i) => !drop.has(i));
}
