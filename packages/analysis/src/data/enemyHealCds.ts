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
 *
 * Holy Word: Serenity 2050 was listed here from the F-E8 triage (PV215) until
 * fact9 D14 (2026-11-03, user ruling): the user signed it `not_save_role`
 * (2026-09-04, GH #63 — a core rotational Holy Word heal, about one press per
 * 13 s), and the A26 ruling signed only the tag, not this membership. On the
 * 117-archive cover set it was 1,896 of the 5,302 `[ENEMY HEAL CD]` lines.
 * `test/enemyHealCd.test.ts` keeps every `not_save_role` id out.
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";

import { TEAM_HEAL_CD_IDS } from "../utils/cooldowns";
import {
  isSpecGatedOffensiveFor,
  OFFENSIVE_PRESS_FACT_IDS,
} from "../utils/spellDanger";
import { HEALER_HELD_OFFENSIVE_SPEC } from "./healerHeldOffensive";

export const ENEMY_HEAL_CD_IDS: ReadonlySet<string> = new Set<string>([
  ...TEAM_HEAL_CD_IDS,
  "200183", // Apotheosis — Holy Priest
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
  // fact7 class 3 (D51 / D55): Vampiric Embrace — Shadow Priest, 120 s, 12 s.
  // No healer's, and no burst: 7acbefeb 0:14, 276,526 effective healing
  // across three enemies off the priest's own damage, no line at all. DB2's
  // healing sits on the triggered 15290, so the official profile reads
  // nothing and the roster never named it.
  "15286",
  // fact11 D16: an offensive-roster id that is a healer's throughput major
  // in that spec's hands (`HEALER_HELD_OFFENSIVE_SPEC`: Holy Paladin
  // Avenging Wrath) — gated to the spec below; the burst readers skip it
  // for that spec (`isHealerHeldOffensive`)
  ...Object.keys(HEALER_HELD_OFFENSIVE_SPEC),
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
  "15286": CombatUnitSpec.Priest_Shadow,
  ...HEALER_HELD_OFFENSIVE_SPEC,
};

/**
 * Roster ids deliberately rendered by another enemy line, not
 * [ENEMY HEAL CD] — the forward check's documented exclusions.
 */
export const ENEMY_HEAL_CD_ROSTER_ELSEWHERE: Readonly<Record<string, string>> =
  {
    "421453": "Ultimate Penitence — an [ENEMY CD] carrying its self-save (absorb)",
    "19236": "Desperate Prayer — an [ENEMY DEF] self-save (self-heal)",
    // fact8 D37 (a39539f2 1:19): the user's 2026-09-24 ruling is a save for
    // herself; it also printed as a throughput cooldown, one press two kinds
    "22842": "Frenzied Regeneration — an [ENEMY DEF] self-save (self-heal)",
  };

/** Is this press an enemy healer's healing major — the set, and its spec
 * gate where it has one. */
export function isEnemyHealCdFor(spellId: string, spec: unknown): boolean {
  if (!ENEMY_HEAL_CD_IDS.has(spellId)) return false;
  const only = ENEMY_HEAL_CD_SPEC[spellId];
  return only === undefined || String(spec) === String(only);
}

/** Is this enemy press an offensive press fact (`OFFENSIVE_PRESS_FACT_IDS`)
 * in this spec's hands: an `[ENEMY HEAL CD]` of the spec keeps its own line
 * (Divine Toll: Holy, not Retribution). */
export function isOffensivePressFactFor(
  spellId: string,
  spec: unknown,
): boolean {
  return (
    OFFENSIVE_PRESS_FACT_IDS.has(spellId) &&
    !isEnemyHealCdFor(spellId, spec) &&
    // GH #184 part B: a Retribution's Divine Toll, a Feral's or Balance's
    // Convoke is an offensive cooldown, not a fact line
    !isSpecGatedOffensiveFor(spellId, spec)
  );
}
