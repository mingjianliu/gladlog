import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { countsAsKillWindowDefensiveInHand } from "../data/abilityProfile";
import { AURA_ACTIVATION_PROVES_BUTTON_IDS } from "../data/auraActivation";
import baselineDefensivesGenerated from "../data/baselineDefensivesGenerated.json";
import { classMetadata } from "../data/classSpells";
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

/** the aura-read kill-window defensives each spec owns without a talent:
 * DB2's baseline rows (`baselineDefensivesGenerated.json`, unfiltered —
 * `BASELINE_DEFENSIVE_BY_SPEC` drops the response-only Feign Death, which
 * the kit never names as held) */
const AURA_READ_BASELINE_BY_SPEC: ReadonlyMap<string, readonly string[]> =
  new Map(
    Object.entries(
      (
        baselineDefensivesGenerated as {
          bySpec: Record<string, Array<{ id: string }>>;
        }
      ).bySpec,
    ).map(([spec, rows]) => [
      spec,
      rows
        .map((r) => r.id)
        .filter((id) => AURA_ACTIVATION_PROVES_BUTTON_IDS.has(id)),
    ]),
  );

/**
 * The aura-read kill-window defensives `unit` owns at its spec's baseline
 * and never pressed by `roundEndS` (codex 85-tk-K-T106-1 #1, ruling R40):
 * in hand the whole round, as an unpressed kit defensive is — a hunter who
 * never feigned is never defenseless. Read by the span
 * (`computeOffensiveWindows`) and the kill target's defensive state
 * (`getDefensiveStateAtTime`), with the presses `kwAuraReadPressesS` reads.
 */
export function kwAuraReadUnpressedInHand(
  unit: ICombatUnit,
  combat: AtomicArenaCombat,
  roundEndS = Infinity,
): string[] {
  // the ledger's catalog: a unit of no known class owns nothing
  // (`extractMajorCooldowns` reads `classMetadata` the same way)
  if (!classMetadata.some((c) => c.unitClass === unit.class)) return [];
  const presses = kwAuraReadPressesS(unit, combat);
  return (AURA_READ_BASELINE_BY_SPEC.get(String(unit.spec)) ?? []).filter(
    (id) =>
      countsAsKillWindowDefensiveInHand(id) &&
      !!spellEffectData[id] &&
      !(presses.get(id) ?? []).some((t) => t <= roundEndS),
  );
}
