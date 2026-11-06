import { CombatUnitSpec } from "@gladlog/parser-compat";

/**
 * An offensive-roster cooldown that, in one healer spec's hands, is that
 * healer's throughput major — an enemy's press of it is an `[ENEMY HEAL CD]`,
 * never an `[ENEMY CD]`, and it opens no enemy burst (window, answer, crisis
 * `enemyBurst`, threat).
 *
 * fact11 D16 (26b28640 2:02): an enemy Holy Paladin's Avenging Wrath 31884
 * opened a 2:02 [OFFENSIVE WINDOW] and was named the opener of a
 * [BURST ANSWERED]; in its 30 s the paladin hard-cast heals and dealt 26k
 * damage. The healer save roster carries it for Holy as a user-signed save
 * role (`healerSaveCdGenerated.json`, 2026-09-04), and the friendly side
 * already reads it so (`HEALER_TEAM_BURST_IDS`, user ruling B3iii
 * 2026-09-25: a healer's Avenging Wrath adds little to the team's damage).
 * A Retribution Paladin's press stays an offensive cooldown.
 *
 * A leaf module (no `utils/cooldowns` import): `cooldowns.ts` and
 * `offensiveAuraOccurrences.ts` read it, and `enemyHealCds.ts` — which
 * imports `cooldowns` — merges it into `ENEMY_HEAL_CD_IDS`. Registered in
 * `curatedIdRegistry.ts`.
 */
export const HEALER_HELD_OFFENSIVE_SPEC: Readonly<Record<string, string>> = {
  "31884": CombatUnitSpec.Paladin_Holy, // Avenging Wrath
};

/** Is this offensive-roster id, in this spec's hands, a healer's throughput
 * major rather than a burst? */
export function isHealerHeldOffensive(spellId: string, spec: unknown): boolean {
  const only = HEALER_HELD_OFFENSIVE_SPEC[spellId];
  return only !== undefined && String(spec) === String(only);
}
