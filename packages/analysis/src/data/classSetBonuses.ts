/**
 * Class set bonuses that change how long a tracked aura lasts (fact8 D15). A
 * set bonus is no talent: `COMBATANT_INFO`'s talent list never names it and the
 * talent inventory has no row for it, so the only reading is the gear the same
 * line lists. DB2: `ItemSetSpell` (set, spec, pieces → bonus spell), `ItemSet`
 * (the set's items), the bonus spell's `SpellEffect`.
 *
 * Feral 12.1 4pc 1296606 「Incarnation: Avatar of Ashamane lasts 10 sec
 * longer」, aura 107 with the class mask 343223 reads as covering 102543,
 * base 10000 ms × PvpMultiplier 0.5 = 5 s. Corpus, every 6th file of the wide
 * manifest: 75 lifetimes on holders of 4 pieces, 71 at 25 s, the other four
 * shorter (a run cut short), none longer; 20 + 5 = 25 reconciles. No control
 * group: nobody in the sample wore fewer.
 *
 * Havoc 12.1 4pc 1296612 (set 2056, spec 577; GH #197, fact11 D35–D38): 「Essence
 * Break now applies and benefits from the effects of Cycle of Hatred … and
 * has ${$s2/1000}.1 sec increased duration」. Effect 1 is aura 219 base 2000
 * on SpellLabel 6670, a label only 320338 (the Essence Break debuff) carries,
 * × PvpMultiplier 0.5 = 1 s: DB2's 4 s + 1 = the 5 s 87 % of 205 lifetimes
 * ran on the cover set (DB2 legs verified on 12.1.0.69587 / 69933 and
 * 12.1.5.70688; that the corpus's 5 s is this bonus is the inference — 75 of
 * 77 Havoc players in 73 logs wore 4 pieces). Its cooldown half is
 * `PER_PRESS_STACK_COOLDOWNS` (talentScriptedCooldowns.ts).
 *
 * Other 12.1 bonuses that move a duration or a cooldown are not priced here
 * yet: see GH #175.
 *
 * Registered in `curatedIdRegistry.ts`.
 */
export interface ISetBonusDurationRow {
  /** the bonus spell, for the record */
  bonusSpellId: string;
  itemSetId: string;
  pieces: number;
  addSeconds: number;
}

/** `ItemSet` row → its items */
export const CLASS_SET_ITEM_IDS: Readonly<Record<string, readonly string[]>> = {
  "2056": ["271535", "271536", "271537", "271538", "271540"],
  "2057": ["271526", "271527", "271528", "271529", "271531"],
};

/** aura id → the set bonuses that lengthen it */
export const SET_BONUS_DURATION_ROWS: Readonly<
  Record<string, readonly ISetBonusDurationRow[]>
> = {
  "102543": [
    { bonusSpellId: "1296606", itemSetId: "2057", pieces: 4, addSeconds: 5 },
  ],
  "320338": [
    { bonusSpellId: "1296612", itemSetId: "2056", pieces: 4, addSeconds: 1 },
  ],
};

interface IGearCarrier {
  info?: { equipment?: ReadonlyArray<{ id: string }> };
}

/** How many of the set's items the unit wears. */
export function setPiecesWorn(
  unit: IGearCarrier | undefined,
  itemSetId: string,
): number {
  const items = CLASS_SET_ITEM_IDS[itemSetId];
  if (!items) return 0;
  return (unit?.info?.equipment ?? []).filter((e) => items.includes(e.id))
    .length;
}

/** The seconds the caster's set bonuses add to this aura. */
export function setBonusDurationSeconds(
  auraId: string,
  caster: IGearCarrier | undefined,
): number {
  let add = 0;
  for (const r of SET_BONUS_DURATION_ROWS[auraId] ?? [])
    if (setPiecesWorn(caster, r.itemSetId) >= r.pieces) add += r.addSeconds;
  return add;
}
