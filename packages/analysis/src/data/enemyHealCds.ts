/**
 * An enemy healer's major throughput cooldowns, rendered as their own
 * `[ENEMY HEAL CD]` line (user ruling A26 = A, 2026-09-30; triage
 * enemy-def F-E8): Divine Hymn, Apotheosis, Serenity and friends produced no
 * line at all, while routing them through `[ENEMY CD]` would feed the
 * burst-window builder (measured: a0a48716 +40 / −23 context lines, four
 * [OFFENSIVE WINDOW] and two [BURST ANSWERED] lines rewritten). This set
 * never reaches `isEnemyCdWindowSpell` / `OFFENSIVE_CD_SPELL_IDS`.
 *
 * The team-wide heals (`TEAM_HEAL_CD_IDS`, the signed save roster) plus the
 * entry's single-target / throughput majors, and Avenging Crusader (user
 * ruling A27 = B: stays a defensive, renders on its own line, out of the
 * burst statistics). Cast ids, all observed in the corpus. Registered in
 * `curatedIdRegistry.ts`.
 *
 * Every entry heals, absorbs, empowers healing or is on the generated save
 * roster (`test/enemyHealCd.test.ts` holds the set to that). Time Spiral
 * 374968 was listed here until FT F01 and is none of those: a class talent
 * of every Evoker spec whose only effect is the per-class aura that lets an
 * ally press a movement ability again (375234 … 375258; official profile: no
 * heal, no absorb, no throughput role — `rejectedForReview` in
 * `healerSaveCdGenerated.json`). On the 605-file capture 55 of its 96
 * `[ENEMY HEAL CD]` lines were a Devastation Evoker's.
 */
import { TEAM_HEAL_CD_IDS } from "../utils/cooldowns";

export const ENEMY_HEAL_CD_IDS: ReadonlySet<string> = new Set<string>([
  ...TEAM_HEAL_CD_IDS,
  "200183", // Apotheosis — Holy Priest
  "2050", // Holy Word: Serenity — Holy Priest
  "215769", // Spirit of Redemption (Spirit of the Redeemer, PvP) — Holy Priest
  "370537", // Stasis — Preservation Evoker
  "216331", // Avenging Crusader — Holy Paladin (A27 = B)
  // Incarnation: Tree of Life — Restoration Druid (F11, 2026-10-11): the
  // spec's three-minute throughput major ("树肯定算,是大技能", ruling
  // 2026-09-14 in `CRISIS_PROTECTIVE_ANSWER_IDS`), on no roster — an enemy
  // druid's press was visible only as a `(passive)` part of the
  // [MINOR DISPELS] fold (605-file capture: 337 such lines, 0 press lines).
  // The line takes presses only: a shift back into the form is not one
  // (`isFormReshiftCast`).
  "33891",
  // fact2 C6 (2026-10-20): Ascendance — Restoration Shaman (DB2 15 s / 180 s;
  // HEALING_AMPLIFIER_SPELL_IDS already lists it). 280d1cbb: hard-cast at
  // 0:29.143, buff to 0:44.1, no enemy line at all — 114052 is in neither
  // `OFFENSIVE_CD_SPELL_IDS` (114050 / 114051 are) nor this set.
  "114052",
]);
