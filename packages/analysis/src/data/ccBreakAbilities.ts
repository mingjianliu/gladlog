/**
 * Abilities whose press removes a loss-of-control effect from the player who
 * presses it — the "broke this CC" id set (triage 2026-09-29, enemy-def F-E21;
 * user ruling A′15, 2026-09-30: "按 DB2「能移除控制」的职业技能(如狂暴之怒
 * 384100)进 broke-this-CC id 集").
 *
 * Until this file the set was the break RACIALS alone
 * (`racialAbilities.BREAK_RACIAL_SPELL_IDS`), and two of those five could
 * never fire. It is consumed through `ccTrinketAnalysis.ts`'s one break binder
 * (`bindBreakToWindow`), on both sides: a friendly `[CC ON TEAM]` line's
 * "X broke this CC", an enemy's `[ENEMY TRINKET] … used X out of …` line and
 * the KILL ATTEMPTS `broke out (X)` cause.
 *
 * Evidence (Game-Behaviour Rule: the DB2 row, the mechanic it covers, a corpus
 * split) is the tier-C forward / reverse check of 2026-09-30 on the 605-file
 * S2 capture (eval-private runs/triage-2026-09-29/probes/tierc2/c19_e21.py):
 * a hard CC on X removed within 2 ms of X's own cast of S, more than 0.3 s
 * before its DB2 expiry. Re-run it when a season changes the ids.
 */
import {
  ccMechanicOf,
  explicitlyBreaksMechanic,
} from "../utils/spellMechanics";
import { BREAK_RACIAL_SPELL_IDS, racialName } from "./racialAbilities";

/** Class abilities with a DB2 mechanic-immunity aura (SpellEffect aura 77)
 * that the corpus shows ending a hard CC. Full immunities that also clear CC
 * (Divine Shield, Ice Block, Blessing of Protection) are NOT here: "a stun
 * ended by an immunity" is its own entry (enemy-def F-E20).
 *
 * WHICH control each one removes is not written here: it is read from that
 * aura through `breakRemovesCc` (Blink: stun and root; Berserker Shout /
 * Rage: fear, incapacitate, horror, sap; Lichborne: charm, fear, sleep,
 * horror; Icebound Fortitude: stun). A test pins that every id below has
 * such an aura. The counts are hard-CC breaks on the 605-file capture. */
export const CLASS_CC_BREAK_ABILITIES: Readonly<Record<string, string>> = {
  "1953": "Blink", // 568
  "384100": "Berserker Shout", // 266
  "18499": "Berserker Rage", // 45
  "49039": "Lichborne", // 119
  "48792": "Icebound Fortitude", // 106
};

/** Break racials the game never logs as a cast — only their buff goes up
 * (605 files: Stoneform 20594 and Fireblood 265221 have 0 SPELL_CAST_SUCCESS;
 * their buffs 65116 / 273104 are applied 66 / 79 times). Logged buff id → the
 * racial's cast id in `RACIAL_ABILITIES`. Keyed on the cast id these two were
 * dead entries: registered, named, and unable to fire. */
export const AURA_KEYED_BREAK_RACIALS: Readonly<Record<string, string>> = {
  "65116": "20594", // Stoneform
  "273104": "265221", // Fireblood
};

/** Every cast id that counts as a CC break when pressed: the break racials
 * and the class abilities above. */
export const CC_BREAK_CAST_IDS: ReadonlySet<string> = new Set([
  ...BREAK_RACIAL_SPELL_IDS,
  ...Object.keys(CLASS_CC_BREAK_ABILITIES),
]);

/** English name of a CC-break ability (racial or class), or null. */
export function ccBreakAbilityName(spellId: string): string | null {
  return racialName(spellId) ?? CLASS_CC_BREAK_ABILITIES[spellId] ?? null;
}

/**
 * Can pressing this break end a CC of that spell? The official answer: the
 * CC's mechanic (`ccMechanicOf`) is on the break's own mechanic-immunity
 * aura (`explicitlyBreaksMechanic`). Unknown is no — a CC whose mechanic DB2
 * cannot give, or a break with no such aura, is never bound:
 *  - Stoneform / Fireblood remove effects by DISPEL TYPE, which this data
 *    does not carry, and Escape Artist removes roots and snares only. Their
 *    presses still render and still lock the trinket; they name no CC.
 *  - Axe Toss 89766 is a stun whose DB2 category mechanic is 26 (interrupt),
 *    so Blink out of it is not named (2 of 235 bound presses on 101 of the
 *    605 S2 files — the only two the check removes;
 *    fix-KA/breakMechProbe.ts, 2026-10-02).
 * The timing test alone (`castEndedCcWindow`, 10 ms) cannot tell "Blink ended
 * the stun" from "the fear ran out and a queued Blink fired 4 ms later"; the
 * mechanic does. The PvP trinket is not asked: it removes every
 * loss-of-control effect.
 */
export function breakRemovesCc(
  breakSpellId: string,
  ccSpellId: string,
): boolean {
  const mech = ccMechanicOf(ccSpellId);
  return mech !== undefined && explicitlyBreaksMechanic(breakSpellId, mech);
}
