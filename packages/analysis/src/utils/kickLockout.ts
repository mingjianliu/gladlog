/**
 * kickLockout.ts — how long a kick locked THIS victim out (triage
 * 2026-09-29 kick-eaten F-K8, user ruling A23, 2026-09-30).
 *
 * `kickLockoutSeconds(kick)` is the kick's lockout and knows nothing of the
 * victim. Some victims shorten it for some interrupted spells: Storm Conduit
 * (Shaman PvP talent 1217092) puts aura 1223529 on its holder — DB2 effect
 * aura 232 MOD_MECHANIC_DURATION, misc 26 (interrupt), base −40, PvpMultiplier
 * 1 — which makes the lockout of an interrupted Lightning Bolt / Chain
 * Lightning ×0.6 (Wind Shear 2.0 → 1.2 s). The holder is read from the
 * victim's COMBATANT_INFO PvP talents (Game-Behaviour Rule 4: never inferred
 * from the arithmetic).
 *
 * **FLAG, kept open (A23):** the corpus bound is stricter than DB2 — 21 of 21
 * Storm Conduit holders interrupted on LB / CL made their first locked-school
 * cast at 0.344–0.350 of the table lockout (`probes/a23/A23-EVIDENCE.md`;
 * `kickLockoutScan.ts` splits it out so the deviation is re-runnable). The
 * user took the DB2 value, not the measured one; the deviation stays in this
 * note until its mechanism is found, never suppressed.
 *
 * Readers: the kick instance's `lockoutDurationSeconds` (kick-eaten `lockout=`,
 * `kickPressure`, `postKick`, `[RES] cc:[kick]`), the cannot-cast intervals
 * (`cannotCastIntervals.ts`: msw / kick-priority / cd-hoarded feasibility) and
 * `[CONSEQ]` (`observedConsequences.ts`) — the four consumers of the signed
 * row. The table is registered in `curatedIdRegistry.ts`.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { kickLockoutSeconds } from "../data/spellEffectData";
import { playerTalentIdSets } from "./cooldowns";

export interface KickLockoutVictimModifier {
  /** the victim's talent (PvP talent spell id, as COMBATANT_INFO lists it) */
  talentId: string;
  /** the interrupted spells it applies to */
  interruptedSpellIds: ReadonlySet<string>;
  /** lockout × this */
  multiplier: number;
}

export const KICK_LOCKOUT_VICTIM_MODIFIERS: readonly KickLockoutVictimModifier[] =
  [
    {
      talentId: "1217092", // Storm Conduit → aura 1223529 (aura 232, misc 26, −40)
      interruptedSpellIds: new Set([
        "188196", // Lightning Bolt
        "188443", // Chain Lightning
      ]),
      multiplier: 0.6, // DB2; corpus ≤ 0.35 — FLAG, see the header
    },
  ];

/** The lockout `kickSpellId` puts on `victim` for interrupting
 * `interruptedSpellId`: `kickLockoutSeconds` × every modifier the victim
 * holds for that spell. Without a victim or an interrupted spell it is the
 * kick's own lockout. */
export function kickLockoutSecondsFor(
  kickSpellId: string,
  victim: ICombatUnit | undefined,
  interruptedSpellId: string | undefined,
): number {
  const base = kickLockoutSeconds(kickSpellId);
  if (!victim || !interruptedSpellId) return base;
  let held: Set<string>;
  try {
    held = playerTalentIdSets(victim).pvpTalentIds;
  } catch {
    return base;
  }
  let lock = base;
  for (const m of KICK_LOCKOUT_VICTIM_MODIFIERS)
    if (held.has(m.talentId) && m.interruptedSpellIds.has(interruptedSpellId))
      lock *= m.multiplier;
  return lock;
}
