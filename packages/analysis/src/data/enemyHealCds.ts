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
 */
import { TEAM_HEAL_CD_IDS } from "../utils/cooldowns";

export const ENEMY_HEAL_CD_IDS: ReadonlySet<string> = new Set<string>([
  ...TEAM_HEAL_CD_IDS,
  "200183", // Apotheosis — Holy Priest
  "2050", // Holy Word: Serenity — Holy Priest
  "215769", // Spirit of Redemption (Spirit of the Redeemer, PvP) — Holy Priest
  "374968", // Time Spiral — Preservation Evoker
  "370537", // Stasis — Preservation Evoker
  "216331", // Avenging Crusader — Holy Paladin (A27 = B)
]);
