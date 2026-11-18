import { CombatUnitSpec } from "@gladlog/parser-compat";

import { HEALER_SPECS } from "./healerSpecs";
import { OFFENSIVE_RACIAL_WINDOW_IDS } from "./racialAbilities";

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
 * major rather than a burst? The spec-keyed table above, and any healer's
 * offensive racial window (`OFFENSIVE_RACIAL_WINDOW_IDS` — user ruling A16,
 * 2026-11-18, fact14 D3: an enemy Restoration Shaman's Blood Fury was printed
 * as an `[ENEMY CD]` and as the opener of a `[BURST ANSWERED]`; under it the
 * shaman cast heals and dealt no damage for 8 s). A racial is not that
 * healer's healing major either: it is in no `[ENEMY HEAL CD]` table, which
 * read `HEALER_HELD_OFFENSIVE_SPEC` alone. */
export function isHealerHeldOffensive(spellId: string, spec: unknown): boolean {
  const only = HEALER_HELD_OFFENSIVE_SPEC[spellId];
  if (only !== undefined) return String(spec) === String(only);
  return (
    OFFENSIVE_RACIAL_WINDOW_IDS.has(spellId) &&
    HEALER_SPECS.has(String(spec) as CombatUnitSpec)
  );
}
