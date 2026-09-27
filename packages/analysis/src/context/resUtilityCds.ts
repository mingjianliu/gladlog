/**
 * The log owner's interrupt (own or pet) and Death Grip as [RES] entries.
 *
 * User ruling 2026-09-26 (reliability round 3 N14 / W1g, "进"): the owner's
 * kick belongs on the [RES] line. It never entered the major-cooldown ledger
 * (Counterspell / Spell Lock 24 s, Disrupt 15 s sit under MIN_CD_SECONDS), so
 * f4eb's Felhunter Spell Lock — ready for the last 45 s while the Disc
 * Priest hard-cast the kill — and f4da's Counterspell (0 presses in the round)
 * were invisible. These entries are built for [RES] ONLY: the ledger's other
 * consumers ("never pressed", loadout [UNUSED], baselines) do not see them.
 *
 * Ownership is the official interrupt kit (`interruptForUnit`: baseline,
 * taken talent, or an observed pet cast); Death Grip is Death Knight class
 * baseline (DB2 SkillLineAbility 25595: skill line 796, AcquireMethod 2).
 * A kit talent the log cannot confirm (no talent list) is left out — the
 * evidence rule, not tree availability.
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { effectiveCooldownSeconds } from "../data/spellEffectData";
import type { IMajorCooldownInfo } from "../utils/cooldowns";
import {
  interruptCooldownSeconds,
  interruptForUnit,
} from "../utils/enemyInterrupts";

export const DEATH_GRIP_ID = "49576";
const DEATH_KNIGHT_CLASS_ID = 6;

function castsOf(
  unit: ICombatUnit,
  spellId: string,
  matchStartMs: number,
): Array<{ timeSeconds: number }> {
  return [...unit.spellCastEvents, ...(unit.petSpellCastEvents ?? [])]
    .filter(
      (e) =>
        e.spellId === spellId &&
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    )
    .map((e) => ({ timeSeconds: (e.logLine.timestamp - matchStartMs) / 1000 }))
    .sort((a, b) => a.timeSeconds - b.timeSeconds);
}

function entry(
  spellId: string,
  spellName: string,
  cooldownSeconds: number,
  casts: Array<{ timeSeconds: number }>,
): IMajorCooldownInfo {
  return {
    spellId,
    spellName,
    tag: "Utility",
    cooldownSeconds,
    maxChargesDetected: 1,
    casts,
    availableWindows: [],
    neverUsed: casts.length === 0,
  } as unknown as IMajorCooldownInfo;
}

export function ownerResUtilityCds(
  owner: ICombatUnit,
  matchStartMs: number,
): IMajorCooldownInfo[] {
  const out: IMajorCooldownInfo[] = [];
  const kick = interruptForUnit(owner);
  if (
    kick &&
    (kick.confirmed || castsOf(owner, kick.spellId, matchStartMs).length > 0)
  ) {
    const cd = interruptCooldownSeconds(kick.spellId);
    if (cd !== undefined)
      out.push(
        entry(
          kick.spellId,
          kick.name,
          cd,
          castsOf(owner, kick.spellId, matchStartMs),
        ),
      );
  }
  if (Number(owner.class) === DEATH_KNIGHT_CLASS_ID) {
    // the shared cooldown predicate (charge recharge, not charge spacing —
    // agy review of batch 14)
    const cd = effectiveCooldownSeconds(DEATH_GRIP_ID);
    if (cd !== undefined)
      out.push(
        entry(
          DEATH_GRIP_ID,
          "Death Grip",
          cd,
          castsOf(owner, DEATH_GRIP_ID, matchStartMs),
        ),
      );
  }
  return out;
}
