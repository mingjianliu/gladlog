/**
 * Blessing of Sanctuary's removals — which control a Sanctuary on its holder
 * took off, the one pairing the `[CC REMOVED]` line and KILL ATTEMPTS'
 * `broke out (Blessing of Sanctuary)` read (fact4 D11 / D40 / D41 / D43 /
 * D46, 2026-10-22).
 *
 * What it removes is official: DB2 210256 effect 0 is the removal (SCRIPT_
 * EFFECT, 77), and its four aura-232 rows (mechanic duration −60 %) name the
 * mechanics it acts on — misc 5 Fear, 9 Silence, 12 Stun, 24 Horror (the
 * tooltip's "Stun, Silence, Fear and Horror"). Corpus split (605 new-season
 * files, every 15th; DEBUFF REMOVED on the target ≤ 50 ms after a Sanctuary
 * on it; `runs/fact4-2026-10-22/fix/probes/sanctuarySplit.py`): 585 rows of
 * those four mechanics (Hammer of Justice 124, Psychic Scream 88,
 * Intimidation 85, Strangulate 29, Silence 16 …), and one each of Blind,
 * Polymorph, Imprison, Freezing Trap, Incapacitating Roar, Earthbind — the
 * coincidences the old "hard CC + roots" filter (`isControlSpell`) credited,
 * while it left out every silence (4fdfcb35 1:52: a Strangulate the ally's
 * Sanctuary removed read as having just run 2 s).
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { BREAK_RACIAL_SPELL_IDS } from "../data/racialAbilities";
import { pvpTrinketUses } from "./pvpTrinketUses";
import { ccMechanicOf } from "./spellMechanics";

export const BLESSING_OF_SANCTUARY_ID = "210256";
/** Same-instant pairing, the TRINKET_BREAK_AFTER_REMOVAL_MS scale. */
export const SANCTUARY_PAIR_MS = 50;
/** DB2 SpellMechanic ids Blessing of Sanctuary removes: Fear 5, Silence 9,
 *  Stun 12, Horror 24 (its aura-232 rows; see the module comment). */
export const SANCTUARY_REMOVED_MECHANICS: ReadonlySet<number> = new Set([
  5, 9, 12, 24,
]);

/** Is this control one a Blessing of Sanctuary removes (its DB2 mechanic)? */
export function sanctuaryRemovesControl(spellId: string): boolean {
  const mech = ccMechanicOf(spellId);
  return mech !== undefined && SANCTUARY_REMOVED_MECHANICS.has(mech);
}

/** One control a Sanctuary removed: the press, its target and the removed
 *  aura's REMOVED row. */
export interface ISanctuaryRemoval {
  /** the Sanctuary's SPELL_CAST_SUCCESS, epoch ms */
  castMs: number;
  paladin: ICombatUnit;
  target: ICombatUnit;
  /** the removed control's SPELL_AURA_REMOVED row on the target */
  removed: NonNullable<ICombatUnit["auraEvents"]>[number];
}

/**
 * Every control that left its target within `SANCTUARY_PAIR_MS` AFTER a
 * Blessing of Sanctuary landed on it, of a mechanic Sanctuary removes, with
 * no competing cause: a removal before the landing, or at an instant the
 * target itself pressed a PvP trinket / break racial, is not the Sanctuary's
 * (codex review of batch 13 — a trinket at 10.000 s credited to a Sanctuary
 * at 10.030 s).
 */
export function sanctuaryRemovalPairs(
  units: readonly ICombatUnit[],
): ISanctuaryRemoval[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: ISanctuaryRemoval[] = [];
  for (const pal of units) {
    for (const c of pal.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (c.spellId !== BLESSING_OF_SANCTUARY_ID) continue;
      const target = byId.get(c.destUnitId ?? "");
      if (!target) continue;
      const t = c.logLine.timestamp;
      for (const a of target.auraEvents ?? []) {
        if (a.logLine.event !== LogEvent.SPELL_AURA_REMOVED) continue;
        if (!a.spellId || !sanctuaryRemovesControl(a.spellId)) continue;
        const rm = a.logLine.timestamp;
        if (rm < t || rm - t > SANCTUARY_PAIR_MS) continue;
        const selfBreak =
          pvpTrinketUses(target).some(
            (u) => Math.abs(u.atMs - rm) <= SANCTUARY_PAIR_MS,
          ) ||
          (target.spellCastEvents ?? []).some(
            (s) =>
              s.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
              !!s.spellId &&
              BREAK_RACIAL_SPELL_IDS.has(s.spellId) &&
              Math.abs(s.logLine.timestamp - rm) <= SANCTUARY_PAIR_MS,
          );
        if (selfBreak) continue;
        out.push({ castMs: t, paladin: pal, target, removed: a });
      }
    }
  }
  return out.sort((a, b) => a.castMs - b.castMs);
}
