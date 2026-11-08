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
import { isPassiveProcCast } from "./cooldowns";
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
