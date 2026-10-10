import { ICombatUnit } from "@gladlog/parser-compat";

import {
  CC_DURATION_TALENT_MODIFIERS,
  ccFullDurationSeconds,
  OPPRESSING_ROAR_LENGTHENED_MECHANICS,
  OPPRESSING_ROAR_PVP_CC_DURATION_MULT,
} from "../data/spellEffectData";
import { ccMechanicOf } from "./spellMechanics";
import { talentModifierOwnershipOf } from "./talentOwnership";

/**
 * Full (undiminished) PvP duration of a CC / root aura AS CAST BY THIS UNIT:
 * `ccFullDurationSeconds` (official DB2, overrides layered) times every
 * `CC_DURATION_TALENT_MODIFIERS` entry the caster is known to hold
 * (`talentModifierOwnershipOf` === "yes"; flat seconds before percentages; "unknown" never lengthens — a claim about a
 * longer CC must rest on evidence the player has the talent). Without a caster
 * it is the plain base duration.
 *
 * GH #44 tail (2026-09-02): the first entry is Resonant Voice → Intimidating
 * Shout 6 → 7.2 s. Consumer: ccBreakAnalysis (the "Xs of CC wasted" estimate
 * — a Warrior with the talent whose Intimidating Shout got broken at 6.5 s
 * used to be told the break wasted nothing).
 */
export function ccFullDurationForCaster(
  spellId: string,
  caster: Pick<ICombatUnit, "spec" | "info" | "spellCastEvents"> | undefined,
): number | undefined {
  const base = ccFullDurationSeconds(spellId);
  if (base === undefined || !caster) return base;
  let add = 0;
  let mult = 1;
  // talentModifierOwnershipOf, not talentOwnershipOf: a hero talent such as
  // Boneshaker is outside the Fury tree, and the plain predicate's baseline
  // step would call every Fury warrior a holder (GH #96 M3b run 1)
  for (const m of CC_DURATION_TALENT_MODIFIERS[spellId] ?? []) {
    const own = talentModifierOwnershipOf(caster, m.talentSpellId);
    if (m.includedInBase) {
      // the typical base already carries it: only a definite "no" shortens
      if (own === "no") add -= m.addSeconds ?? 0;
      continue;
    }
    if (own === "yes") {
      add += m.addSeconds ?? 0;
      mult *= 1 + (m.pct ?? 0) / 100;
    }
  }
  return (base + add) * mult;
}

/** Does Oppressing Roar on the target lengthen this CC — is the CC's DB2
 * mechanic on one of the Roar's aura-232 rows
 * (`OPPRESSING_ROAR_LENGTHENED_MECHANICS`)? A CC whose mechanic DB2 cannot
 * name is not lengthened: a claim about a longer CC rests on evidence, the
 * rule `ccFullDurationForCaster` applies to an unknown talent. */
export function oppressingRoarLengthens(spellId: string): boolean {
  const mech = ccMechanicOf(spellId);
  return mech !== undefined && OPPRESSING_ROAR_LENGTHENED_MECHANICS.has(mech);
}

/**
 * Full (undiminished) length of ONE application of a CC / root:
 * `ccFullDurationForCaster` × Oppressing Roar's +30 % when the debuff was on
 * the TARGET as the CC landed (`oppressingRoarOnAt`, ccBreakAnalysis.ts) and
 * the Roar covers the CC's mechanic. The caller applies the DR share
 * (`drDurationFactor`). This is what the game did at that application, read
 * from the log — the official number of the spell itself
 * (`ccFullDurationSeconds`, the kit lines, the `[DR: …]` tags) is untouched:
 * "羊本身永远是6秒 除非有龙给的加持续时间的debuff" (user ruling 2026-09-02).
 *
 * The one arithmetic for "how long was this application going to run":
 * `ccRemainingSeconds` (`[CC BROKEN]` / `[CC REMOVED]`), the incoming-CC
 * `expectedDurationSeconds` (`analyzePlayerCCAndTrinket` — the break binder's
 * "time left" and the "cut short of its official end" test) and the enemy
 * healer lock's `endedBy` (`enemyHealerCcWindows`). Until FT-T07 (D9,
 * 2026-10-10) only the first one applied the Roar, so a Terror of the Skies
 * landing under it read as outliving its own length.
 *
 * Evidence, FT-T07 (605 S2 files, `t07_cc_outlive.py`: applications with a
 * logged REMOVED and no REFRESH): Terror of the Skies 372245 (stun, DB2 3 s)
 * — of the 20 that ran past 3.3 s, 14 had the Roar on the target at the
 * landing; of the 194 at 2.9–3.1 s, none had. 3 × 1.3 = 3.9 s is the long
 * plateau (×16). One caster in one file (7b07c1dee3f0): 3.90 s on the target
 * carrying the Roar and 3.00 s on a totem without it from the same breath;
 * 3.00 s on all three targets in a later round, 8 s after the Roar ran out.
 * The 6 long ones with no Roar are unexplained (7951f46fcfb3: 3.91 s in a
 * round with no Roar cast at all) and stay flagged by the probe.
 */
export function ccFullDurationForApplication(
  spellId: string,
  caster: Pick<ICombatUnit, "spec" | "info" | "spellCastEvents"> | undefined,
  roarOnTargetAtApply: boolean,
): number | undefined {
  const full = ccFullDurationForCaster(spellId, caster);
  if (full === undefined) return undefined;
  return roarOnTargetAtApply && oppressingRoarLengthens(spellId)
    ? full * OPPRESSING_ROAR_PVP_CC_DURATION_MULT
    : full;
}
