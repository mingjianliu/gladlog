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
 * Fury 12.1 2pc 1296645 (set 2067 「Jade Warlord's Dominion」, spec 72, 2
 * pieces; GH #175 row 1): 「在鲁莽期间，怒击使鲁莽的持续时间延长
 * ${$s2/1000}秒，最多延长${($s2/1000)*$s3}秒」. Effects 1 and 2 are aura 4
 * (dummy, scripted) base 2000 and 3, PvpMultiplier 1: +2 s per press, at most
 * 3 presses = 6 s (12.1.0.69587 and 12.1.5.70783 alike). Effect 0 (aura 108,
 * Raging Blow damage) carries mask[1] 8192, which on the warrior class set
 * covers exactly the two hits of Raging Blow (85384 / 96103) and of Crushing
 * Blow (335098 / 335100) — Crushing Blow is Raging Blow under Recklessness,
 * so both presses (85288, 335097) qualify. A press counts only when one of
 * its hits landed (`landedOnly`): the one holder lifetime at a flat 18 s
 * with a press inside had a single Crushing Blow its target refused IMMUNE
 * (605 file 352b7bd2, round 4, 0:20). Corpus, the 29 files of the 605
 * manifest with a Recklessness, clean (no REFRESH) lifetimes not cut by a
 * death or the round's end, logged vs `buffFullDurationForCaster` at the
 * application: 2-piece holders 32 of 48 exact (27 extended, 5 with no landed
 * press; 5 of 48 at the flat 18 s before), 8 at that plus 5 s multiples,
 * 2 longer by other amounts (27 s: a +5 s that let one more press in; one
 * 42 s run), 6 shorter; holders of 0–1 pieces
 * 111 of 187 at the flat 18 s either way and none on a 2 s step above it
 * (26 at 18 + 5 s multiples, 50 shorter). The 5 s multiples are the
 * Enduring Rage residual noted on 1719 in `BUFF_DURATION_TALENT_MODIFIERS`.
 * The extension is a per-press
 * walk, `SET_BONUS_PER_EVENT_DURATIONS`, read by `buffFullDurationForCaster`
 * the same way it reads the talents' `TOOLTIP_PER_EVENT_DURATIONS`.
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
  "2067": ["271454", "271455", "271456", "271457", "271459"],
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

/** A set bonus whose extension is earned press by press while the aura is up
 * (the set-bonus twin of `ITooltipPerPressDuration`). */
export interface ISetBonusPerPressDuration {
  event: "press";
  /** the bonus spell, for the record */
  bonusSpellId: string;
  itemSetId: string;
  pieces: number;
  /** the bonus belongs to one spec (`ItemSetSpell.ChrSpecID`) */
  specs: readonly string[];
  addSecondsPerEvent: number;
  capSeconds: number;
  qualifyingSpellIds: ReadonlySet<string>;
  /** a press counts only when one of its hits lands on its target
   * (`pressLandedOn`) — a press the target refused extends nothing */
  landedOnly: boolean;
}

/** aura id → the set bonus that extends it press by press */
export const SET_BONUS_PER_EVENT_DURATIONS: Readonly<
  Record<string, ISetBonusPerPressDuration>
> = {
  "1719": {
    event: "press",
    bonusSpellId: "1296645",
    itemSetId: "2067",
    pieces: 2,
    specs: ["72"],
    addSecondsPerEvent: 2,
    capSeconds: 6,
    // Raging Blow, Crushing Blow
    qualifyingSpellIds: new Set(["85288", "335097"]),
    landedOnly: true,
  },
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

/** The caster's per-press set bonus on this aura, when it wears enough of the
 * set in the bonus's spec. */
export function setBonusPerEventFor(
  auraId: string,
  caster: (IGearCarrier & { spec?: string }) | undefined,
): ISetBonusPerPressDuration | undefined {
  const r = SET_BONUS_PER_EVENT_DURATIONS[auraId];
  if (!r || !caster?.spec || !r.specs.includes(caster.spec)) return undefined;
  return setPiecesWorn(caster, r.itemSetId) >= r.pieces ? r : undefined;
}
