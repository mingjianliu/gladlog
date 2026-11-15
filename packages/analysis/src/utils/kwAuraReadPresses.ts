import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { countsAsKillWindowDefensiveInHand } from "../data/abilityProfile";
import { AURA_ACTIVATION_PROVES_BUTTON_IDS } from "../data/auraActivation";
import { spellEffectData } from "../data/spellEffectData";
import { unitCooldownEntry } from "./cooldowns";

/**
 * The kill-window kit defensives whose press the log never writes as a
 * success (`AURA_ACTIVATION_PROVES_BUTTON_IDS`: Feign Death — T106, ruling
 * R40), with `unit`'s presses of each in round seconds: the ledger's
 * aura-read activations (`unitCooldownEntry`). The span state machine and
 * the kill target's defensive state read their presses here — scanning only
 * SUCCESS rows, they would see the button unpressed, in hand all round.
 */
export function kwAuraReadPressesS(
  unit: ICombatUnit,
  combat: AtomicArenaCombat,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const spellId of AURA_ACTIVATION_PROVES_BUTTON_IDS) {
    if (
      !countsAsKillWindowDefensiveInHand(spellId) ||
      !spellEffectData[spellId]
    )
      continue;
    const pressS = (unitCooldownEntry(unit, combat, spellId)?.casts ?? [])
      .map((c) => c.timeSeconds)
      .sort((a, b) => a - b);
    if (pressS.length > 0) out.set(spellId, pressS);
  }
  return out;
}
