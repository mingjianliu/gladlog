/**
 * Damage ids a unit takes as its OWN row (source = the unit itself) that
 * the enemy caused: the log names the unit, but the health it loses is an
 * enemy's hit moved onto it or the price of surviving one.
 *
 * No product reader consumes this list: it is read by scan5
 * `burstRatioOwnSideDamage` (packages/eval/scripts/scan5/t159.ts), which
 * keeps a unit's own damage apart from the enemy's pressure except for
 * these (user ruling 2026-11-28, pipeline T330: a unit's own damage is
 * listed apart, out of the total; Cauterize and Ultimate Sacrifice count as
 * the enemy's, as the B-report section 13 audit read them). It lives in the
 * analysis package so that `curatedIdRegistry.ts` can register it
 * (Curated-List Completeness Rule).
 */
export const ENEMY_CAUSED_SELF_DAMAGE_IDS: ReadonlyMap<string, string> =
  new Map([
    [
      "87023",
      "Cauterize (Fire Mage) — the burn after Cauterize 86949 ate a killing blow: SPELL_PERIODIC_DAMAGE from the mage on itself (374b434a: 86949 absorbs an enemy's Stampede, the mage's own 87023 ticks follow; window 374b434a r1 0:29–0:45, 2 of the scan's 126 in-total rows on the 605 at 3bf27b642)",
    ],
    [
      "199450",
      "Ultimate Sacrifice (Holy Paladin PvP talent) — the damage moved off the blessed ally lands as SPELL_PERIODIC_DAMAGE from the paladin on itself (b917c46c: the 199448 cast on an ally, then the paladin's own 199450 ticks one per second; window b917c46c r3 2:33–2:43, 3 of the scan's 126 in-total rows on the 605 at 3bf27b642)",
    ],
  ]);
