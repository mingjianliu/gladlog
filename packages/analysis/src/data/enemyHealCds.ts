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
import { CombatUnitSpec } from "@gladlog/parser-compat";

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
  // fact5 D21 (F18, 2026-10-24): Convoke the Spirits — Restoration Druid
  // only (`ENEMY_HEAL_CD_SPEC`): the healer's save role the user signed
  // 2026-09-04 (curatedAbilityFacts 391528). A Feral / Balance druid presses
  // the same id as damage, and classSpells keeps it off the offensive roster
  // for that reason. d2be9b1b r0 2:15.85: an enemy Resto's Convoke just
  // before the friendly death printed no line at all.
  "391528",
  // The healer save-cooldown roster (`healerSaveCdGenerated.json`, the
  // user-signed save / throughput roles of 2026-09-04) named healing majors
  // that no enemy line printed — the forward check of the Curated-List rule
  // (test/enemyHealCdRosterForward.test.ts), fact5 codex audit 2026-10-25:
  // 6 of 15 rounds. Each is gated to the healer spec the roster lists
  // (`ENEMY_HEAL_CD_SPEC`): the same id pressed by a DPS spec is no healer's.
  "472433", // Evangelism — Discipline Priest (04a1bde9: 5 casts, no line)
  "370553", // Tip the Scales — Preservation Evoker
  "132158", // Nature's Swiftness — Restoration Druid
  "378081", // Nature's Swiftness — Restoration Shaman
  "375576", // Divine Toll — Holy Paladin
  "443028", // Celestial Conduit — Mistweaver Monk
  "22842", // Frenzied Regeneration — Restoration Druid (signed 2026-09-24)
]);

/** Ids that are a healing major only for one spec — the press of another
 * spec is not an [ENEMY HEAL CD] (Convoke: Restoration, not Feral/Balance). */
const ENEMY_HEAL_CD_SPEC: Readonly<Record<string, string>> = {
  "391528": CombatUnitSpec.Druid_Restoration,
  "472433": CombatUnitSpec.Priest_Discipline,
  "370553": CombatUnitSpec.Evoker_Preservation,
  "132158": CombatUnitSpec.Druid_Restoration,
  "378081": CombatUnitSpec.Shaman_Restoration,
  "375576": CombatUnitSpec.Paladin_Holy,
  "443028": CombatUnitSpec.Monk_Mistweaver,
  "22842": CombatUnitSpec.Druid_Restoration,
};

/**
 * Roster ids deliberately rendered by another enemy line, not
 * [ENEMY HEAL CD] — the forward check's documented exclusions.
 */
export const ENEMY_HEAL_CD_ROSTER_ELSEWHERE: Readonly<Record<string, string>> =
  {
    "31884": "Avenging Wrath — an [ENEMY CD] (the offensive roster)",
    "421453": "Ultimate Penitence — an [ENEMY DEF] self-save (absorb)",
    "19236": "Desperate Prayer — an [ENEMY DEF] self-save (self-heal)",
  };

/** Is this press an enemy healer's healing major — the set, and its spec
 * gate where it has one. */
export function isEnemyHealCdFor(spellId: string, spec: unknown): boolean {
  if (!ENEMY_HEAL_CD_IDS.has(spellId)) return false;
  const only = ENEMY_HEAL_CD_SPEC[spellId];
  return only === undefined || String(spec) === String(only);
}
