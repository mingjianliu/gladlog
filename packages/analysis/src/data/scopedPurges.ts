/**
 * Offensive removals that are NOT a spec's Magic purge (user ruling P-P5b = C,
 * 2026-10-01, triage missed-cleanse F-P5 forward check): each counts only
 * within its own scope — it never makes its holder a general purger.
 *
 * Evidence (raw SPELL_DISPEL / SPELL_STOLEN lines of the S2 archive, every
 * 6th file of manifest-archive-2026-08-28-newseason; the every-30 slice in
 * brackets — `fix-T145/p5b/scope_scan.py` in the eval-private triage run):
 *
 *  - Shattering Throw: the press is 64382 (1.5 s cast as measured, 180 s,
 *    25 yd — a choice node against Wrecking Throw), the removal logs under
 *    64380. 138
 *    removals by 94 players [28]: Ice Block ×70, Divine Shield ×36, Blessing of
 *    Protection ×26, Time Stop ×3, Blessing of Spellwarding ×2, Divine Shield
 *    228050 ×1 — nothing else. DB2 agrees: all six carry SpellMechanic 29 (the
 *    immune shield); Aspect of the Turtle does not and is never removed. The
 *    scope is the intersection — mechanic 29 AND observed removed — so a
 *    mechanic-29 aura nobody was seen throwing off (Ice Cold 414658, Ice Wall
 *    353703) is not asserted.
 *  - Shiv 5938 (every Rogue; 30 s, 5 yd): 140 removals by 54 players [40] —
 *    Enrage ×87, Berserker Shout ×31 + ×2, Berserker Roar ×18, Berserker Rage
 *    ×2: enrage effects only. None of them has a purge priority, so the scope
 *    explains the removals without adding a missed-purge line; it is not
 *    stated in the header either (ruling P-P5b-land).
 *  - Arcane Torrent (the Blood Elf racial, one spell id per class — the nine
 *    `RACIAL_ABILITIES` rows of that name; 120 s, 8 yd around the caster): 535 removals by 169
 *    players [102 by 31], every one a Magic buff off an enemy. The log has no
 *    race field, so it counts only for a player observed casting it this match
 *    (`racialPassive` precedent). Its caster cannot choose the buff — what it
 *    strips is mostly Renew ×88, Power Word: Fortitude ×62, Arcane Intellect
 *    ×30 — so the scope explains its removals and is stated in the header,
 *    but it never produces a missed-purge line (ruling P-P5b-land,
 *    2026-10-02).
 *
 * Disentanglement Effect 233674 (2,476 removals, every one a DEBUFF off the
 * remover's own side) and a healer's defensive cleanse landing on an enemy
 * unit (a Mind-Controlled enemy) remove debuffs of their own dispel types —
 * they are cleanses, not purges, and give their holder no purge scope
 * (`purgerRosterScan` classifies them).
 */

/** Shattering Throw: the cast the cooldown and reach belong to. */
export const SHATTERING_THROW_CAST_ID = "64382";
/**
 * Shattering Throw's cast time as played: SPELL_CAST_START → SUCCESS over the
 * same every-6 slice, n = 170, p10 1.495 / median 1.504 / p90 1.517 s
 * (`fix-T145/p5b/cast_time_scan.py`). The removal landed 2.3 s after the
 * shield at the fastest, 3.1 s at the median (n = 132).
 */
export const SHATTERING_THROW_CAST_S = 1.5;
/** Shattering Throw: the id its SPELL_DISPEL lines carry. */
export const SHATTERING_THROW_DISPEL_ID = "64380";
/** Auras Shattering Throw was observed removing (each also SpellMechanic 29). */
export const SHATTERING_THROW_REMOVES: ReadonlySet<string> = new Set([
  "45438", // Ice Block
  "642", // Divine Shield
  "1022", // Blessing of Protection
  "378441", // Time Stop
  "204018", // Blessing of Spellwarding
  "228050", // Divine Shield (a second id of the same name, ×1)
]);
/** SpellMechanic 29 — the immune shield Shattering Throw dispels. */
export const IMMUNE_SHIELD_MECHANIC = 29;

export const SHIV_SPELL_ID = "5938";
/** Enrage effects Shiv was observed removing. */
export const SHIV_REMOVES: ReadonlySet<string> = new Set([
  "184362", // Enrage
  "384100", // Berserker Shout
  "384102", // Berserker Shout (the group aura)
  "1219209", // Berserker Roar
  "18499", // Berserker Rage
]);

/** The racial's name in `RACIAL_ABILITIES` — one id per class, nine in all,
 *  every one observed; `racialName(id) === ARCANE_TORRENT_NAME` is the test. */
export const ARCANE_TORRENT_NAME = "Arcane Torrent";

/** Disentanglement's removal id: a cleanse of its caster's own side, listed
 *  so `purgerRosterScan` can name it instead of calling it a roster gap. */
export const DISENTANGLEMENT_EFFECT_ID = "233674";
