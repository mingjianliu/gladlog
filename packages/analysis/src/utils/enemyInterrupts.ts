import {
  CombatUnitClass,
  CombatUnitSpec,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { spellEffectData } from "../data/spellEffectData";
import { specToString } from "./cooldowns";

/**
 * B128: each combatant's baseline interrupt (kick / lockout). Interrupts are class-wide except where a
 * spec check is needed (Hunter, Priest, Monk). A Priest interrupt exists only for Shadow; a Monk
 * interrupt exists only for Brewmaster/Windwalker (Mistweaver has none). Used to decide, at
 * an owner channel, whether any enemy had a kick available — the model's most-requested addition
 * ("was this a lockout reaction / would this have been kicked").
 */
interface InterruptDef {
  spellId: string;
  name: string;
}

const CLASS_INTERRUPTS: Partial<Record<CombatUnitClass, InterruptDef>> = {
  [CombatUnitClass.Warrior]: { spellId: "6552", name: "Pummel" },
  [CombatUnitClass.Shaman]: { spellId: "57994", name: "Wind Shear" },
  [CombatUnitClass.Paladin]: { spellId: "96231", name: "Rebuke" },
  [CombatUnitClass.Warlock]: { spellId: "19647", name: "Spell Lock" },
  [CombatUnitClass.Rogue]: { spellId: "1766", name: "Kick" },
  [CombatUnitClass.Mage]: { spellId: "2139", name: "Counterspell" },
  [CombatUnitClass.Druid]: { spellId: "106839", name: "Skull Bash" },
  [CombatUnitClass.DeathKnight]: { spellId: "47528", name: "Mind Freeze" },
  [CombatUnitClass.DemonHunter]: { spellId: "183752", name: "Disrupt" },
  [CombatUnitClass.Monk]: { spellId: "116705", name: "Spear Hand Strike" },
  [CombatUnitClass.Evoker]: { spellId: "351338", name: "Quell" },
};

/** Returns the interrupt this unit has, or null (e.g. Disc/Holy Priest, non-combat classes). */
function interruptForUnit(unit: ICombatUnit): InterruptDef | null {
  // Hunter: Survival uses Muzzle (melee), other specs use Counter Shot (ranged).
  if (unit.class === CombatUnitClass.Hunter) {
    return unit.spec === CombatUnitSpec.Hunter_Survival
      ? { spellId: "187707", name: "Muzzle" }
      : { spellId: "147362", name: "Counter Shot" };
  }
  // Priest: only Shadow has an interrupt (Silence); Disc/Holy have none.
  if (unit.class === CombatUnitClass.Priest) {
    return unit.spec === CombatUnitSpec.Priest_Shadow
      ? { spellId: "15487", name: "Silence" }
      : null;
  }
  // Monk: Brewmaster/Windwalker have Spear Hand Strike; Mistweaver has no interrupt.
  if (unit.class === CombatUnitClass.Monk) {
    return unit.spec === CombatUnitSpec.Monk_Mistweaver
      ? null
      : (CLASS_INTERRUPTS[unit.class] ?? null);
  }
  return CLASS_INTERRUPTS[unit.class] ?? null;
}

export interface IEnemyInterruptState {
  enemyName: string;
  spec: string;
  spellName: string;
  /** Seconds until the interrupt is available again; 0 = ready now. */
  cdRemainingSeconds: number;
}

/**
 * B128: for each enemy that has an interrupt, its ready/on-cooldown state at atMs. An interrupt is on
 * cooldown when the enemy cast it within its cooldown window; otherwise it is ready (including when it
 * was never cast). This lets the timeline show whether an owner channel could have been kicked.
 */
export function computeEnemyInterruptAvailability(
  enemies: ICombatUnit[],
  atMs: number,
): IEnemyInterruptState[] {
  const result: IEnemyInterruptState[] = [];
  for (const enemy of enemies) {
    const def = interruptForUnit(enemy);
    if (!def) continue;
    const cooldownSeconds = spellEffectData[def.spellId]?.cooldownSeconds ?? 15;

    // Most recent successful cast of this interrupt at or before atMs.
    let lastCastMs = -Infinity;
    const allCasts = [
      ...enemy.spellCastEvents,
      ...(enemy.petSpellCastEvents ?? []),
    ];
    for (const e of allCasts) {
      if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (e.spellId !== def.spellId) continue;
      const ts = e.logLine.timestamp;
      if (ts <= atMs && ts > lastCastMs) lastCastMs = ts;
    }

    const cdRemainingSeconds =
      lastCastMs === -Infinity
        ? 0
        : Math.max(0, Math.round(cooldownSeconds - (atMs - lastCastMs) / 1000));
    result.push({
      enemyName: enemy.name,
      spec: specToString(enemy.spec),
      spellName: def.name,
      cdRemainingSeconds,
    });
  }
  return result;
}
