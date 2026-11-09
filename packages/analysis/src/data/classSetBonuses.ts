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
 * GH #175 rows 2–17 (pipeline T35; DB2 12.1.5.70783, ItemSetSpell for the
 * set / spec / pieces, SpellEffect for the value, PvP value = base ×
 * PvpMultiplier). Corpus legs: the 605 files whose players wear the set,
 * split by the pieces COMBATANT_INFO lists (`cooldownRecastScan --no-gear`:
 * presses the worn model and the unworn one each call impossible;
 * `buffDurationScan --per-app`: logged lifetimes vs the worn / unworn
 * length).
 *  - Shadow 2pc 1296579 → Tentacle Slam 1227280 cooldown −3 s (aura 453 on
 *    ChargeCategory 1907, base −3000, PvpMultiplier 1): 15 → 12 s. Holders
 *    of 2+ pieces: 67 of 134 re-presses impossible at 15 s, 0 at 12 s;
 *    0–1 pieces: 0 of 815 at 15 s.
 *  - Marksmanship 2pc 1296633 → Explosive Shot 212431 +0.5 s (aura 107
 *    misc 1, mask covers 212431, base 1000 × 0.5): 2-piece holders 117 of
 *    118 lifetimes exact at 4.5 s, none at the unworn 4 s; 0–1 pieces 674
 *    exact at their static length (`SET_BONUS_DURATION_ROWS`).
 *  - Protection 4pc 1296648 → Ravager 228920 cooldown −15 s (aura 453 on
 *    ChargeCategory 2073, base −30000 × 0.5): 90 → 75 s. No 605 file
 *    carries a Protection 4-piece Ravager: DB2 and the category only.
 *  - Augmentation 2pc 1296637 → Upheaval 396286 cooldown −5 s (aura 107
 *    misc 11, mask covers 396286, base −10000 × 0.5): 40 → 35 s. No 2-piece
 *    Augmentation in 605 (5 unworn Upheaval records): DB2 and mask only.
 *  - Devastation 4pc 1296640 → Causality's give-back +0.05 s per trigger
 *    (aura 219 misc 3 / 12 on SpellLabel 6673, which only Causality 375777
 *    carries; base −100 ms × 0.5), the `setBonus` of the two
 *    `EVENT_COOLDOWN_REDUCTIONS` rows. One 4-piece holder in 605 (one
 *    round): its Fire Breath / Eternity Surge `back` moves 1 s earlier, no
 *    press contradicts either reading. DB2 and label, corpus thin.
 *  - Feral 4pc 1296606 on Berserk 106951 (GH #175 row 17): the same mask
 *    covers 106951; no 4-piece Feral pressed Berserk in 605 (5 unworn
 *    lifetimes, all at 15 s). The Incarnation row above is the corpus leg.
 * Not priced, no product reader reads the target's cooldown or duration:
 * Discipline 2pc (Penance → Mind Blast), Marksmanship 4pc (Aimed Shot /
 * Rapid Fire), Survival 4pc (Mongoose Fury), Frost DK 4pc (Freezing
 * Tempest, label 6668), Vengeance 2pc (Sigil of Flame), Restoration Druid
 * 4pc (Genesis, label 6767), Guardian 4pc (Thrash extends Berserk /
 * Incarnation 0.25 s, up to 2.5 s), Mistweaver 4pc (a Rising / Rushing
 * Wind Kick reset proc), Enhancement 4pc (Fire Nova → Crash Lightning).
 *
 * Registered in `curatedIdRegistry.ts`.
 */
export interface ISetBonusDurationRow {
  /** the bonus spell, for the record */
  bonusSpellId: string;
  itemSetId: string;
  pieces: number;
  /** the bonus belongs to one spec (`ItemSetSpell.ChrSpecID`): a class set
   * is shared by the class's specs, each with its own bonuses */
  specs: readonly string[];
  addSeconds: number;
}

/** `ItemSet` row → its items: the thirteen 12.1 class sets (ItemSet
 * 12.1.5.70783, ids 2055–2067), one per class (Demon Hunter's 2056 shared by
 * its three specs). */
export const CLASS_SET_ITEM_IDS: Readonly<Record<string, readonly string[]>> = {
  "2055": ["271472", "271473", "271474", "271475", "271477"], // Death Knight
  "2056": ["271535", "271536", "271537", "271538", "271540"], // Demon Hunter
  "2057": ["271526", "271527", "271528", "271529", "271531"], // Druid
  "2058": ["271499", "271500", "271501", "271502", "271504"], // Evoker
  "2059": ["271490", "271491", "271492", "271493", "271495"], // Hunter
  "2060": ["271562", "271563", "271564", "271565", "271567"], // Mage
  "2061": ["271517", "271518", "271519", "271520", "271522"], // Monk
  "2062": ["271463", "271464", "271465", "271466", "271468"], // Paladin
  "2063": ["271553", "271554", "271555", "271556", "271558"], // Priest
  "2064": ["271508", "271509", "271510", "271511", "271513"], // Rogue
  "2065": ["271481", "271482", "271483", "271484", "271486"], // Shaman
  "2066": ["271544", "271545", "271546", "271547", "271549"], // Warlock
  "2067": ["271454", "271455", "271456", "271457", "271459"], // Warrior
};

/** aura id → the set bonuses that lengthen it */
export const SET_BONUS_DURATION_ROWS: Readonly<
  Record<string, readonly ISetBonusDurationRow[]>
> = {
  "102543": [
    {
      bonusSpellId: "1296606",
      itemSetId: "2057",
      pieces: 4,
      specs: ["103"],
      addSeconds: 5,
    },
  ],
  // the same Feral 4pc on Berserk, the Incarnation-less button (GH #175 row 17)
  "106951": [
    {
      bonusSpellId: "1296606",
      itemSetId: "2057",
      pieces: 4,
      specs: ["103"],
      addSeconds: 5,
    },
  ],
  "320338": [
    {
      bonusSpellId: "1296612",
      itemSetId: "2056",
      pieces: 4,
      specs: ["577"],
      addSeconds: 1,
    },
  ],
  // Marksmanship 2pc on Explosive Shot (GH #175 row 7)
  "212431": [
    {
      bonusSpellId: "1296633",
      itemSetId: "2059",
      pieces: 2,
      specs: ["254"],
      addSeconds: 0.5,
    },
  ],
};

/** A set bonus that takes flat seconds off a spell's cooldown (or its
 * charges' recharge) — the set-bonus twin of a `reduce_cd` talent row. */
export interface ISetBonusCooldownRow {
  /** the bonus spell, for the record */
  bonusSpellId: string;
  itemSetId: string;
  pieces: number;
  specs: readonly string[];
  reduceSeconds: number;
}

/** spell id → the set bonuses that shorten its cooldown. Read by
 * `applyCdTalentModifiers` (cooldowns.ts) for every reader of a unit's
 * cooldown (`unitCooldownOf`, the ledger). */
export const SET_BONUS_COOLDOWN_ROWS: Readonly<
  Record<string, readonly ISetBonusCooldownRow[]>
> = {
  // Protection 4pc on Ravager (GH #175 row 2)
  "228920": [
    {
      bonusSpellId: "1296648",
      itemSetId: "2067",
      pieces: 4,
      specs: ["73"],
      reduceSeconds: 15,
    },
  ],
  // Augmentation 2pc on Upheaval (GH #175 row 3)
  "396286": [
    {
      bonusSpellId: "1296637",
      itemSetId: "2058",
      pieces: 2,
      specs: ["1473"],
      reduceSeconds: 5,
    },
  ],
  // Shadow 2pc on Tentacle Slam (GH #175 row 4)
  "1227280": [
    {
      bonusSpellId: "1296579",
      itemSetId: "2063",
      pieces: 2,
      specs: ["258"],
      reduceSeconds: 3,
    },
  ],
};

/** A set bonus that adds seconds to every trigger of a scripted cooldown
 * reduction (`IEventCooldownReduction.setBonus`, talentScriptedCooldowns.ts). */
export interface ISetBonusEventCredit {
  bonusSpellId: string;
  itemSetId: string;
  pieces: number;
  specs: readonly string[];
  addSeconds: number;
}

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

export interface IGearCarrier {
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

/** Every class set the unit wears a piece of → how many pieces (corpus
 * splits by holder: `buffDurationScan --per-app`, `cooldownRecastScan`). */
export function classSetPiecesOf(
  unit: IGearCarrier | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const setId of Object.keys(CLASS_SET_ITEM_IDS)) {
    const n = setPiecesWorn(unit, setId);
    if (n > 0) out[setId] = n;
  }
  return out;
}

/** The one gate of every set-bonus row: the holder's spec is the bonus's,
 * and it wears at least the bonus's pieces of the set (`piecesOf`: from the
 * gear, `setPiecesWorn`, or from a snapshot of it, `classSetPiecesOf`). */
export function setBonusHeld(
  r: { itemSetId: string; pieces: number; specs: readonly string[] },
  specId: string | undefined,
  piecesOf: (itemSetId: string) => number,
): boolean {
  if (!specId || !r.specs.includes(String(specId))) return false;
  return piecesOf(r.itemSetId) >= r.pieces;
}

/** The unit wears enough of the bonus's set, in the bonus's spec. */
export function wearsSetBonus(
  unit: (IGearCarrier & { spec?: string }) | undefined,
  r: { itemSetId: string; pieces: number; specs: readonly string[] },
): boolean {
  return setBonusHeld(r, unit?.spec, (id) => setPiecesWorn(unit, id));
}

/** The flat seconds a holder's set bonuses take off `spellId`
 * (`SET_BONUS_COOLDOWN_ROWS`) — read by the cooldown model
 * (`applyCdTalentModifiers`, off the `classSetPieces` snapshot) and by the
 * gear reading below, one gate. */
export function setBonusCooldownReduction(
  spellId: string,
  specId: string | undefined,
  piecesOf: (itemSetId: string) => number,
): number {
  let reduce = 0;
  for (const r of SET_BONUS_COOLDOWN_ROWS[spellId] ?? [])
    if (setBonusHeld(r, specId, piecesOf)) reduce += r.reduceSeconds;
  return reduce;
}

/** The seconds the caster's set bonuses add to this aura. */
export function setBonusDurationSeconds(
  auraId: string,
  caster: (IGearCarrier & { spec?: string }) | undefined,
): number {
  let add = 0;
  for (const r of SET_BONUS_DURATION_ROWS[auraId] ?? [])
    if (wearsSetBonus(caster, r)) add += r.addSeconds;
  return add;
}

/** The seconds the unit's set bonuses take off this spell's cooldown. */
export function setBonusCooldownReductionSeconds(
  spellId: string,
  unit: (IGearCarrier & { spec?: string }) | undefined,
): number {
  return setBonusCooldownReduction(spellId, unit?.spec, (id) =>
    setPiecesWorn(unit, id),
  );
}

/** The caster's per-press set bonus on this aura, when it wears enough of the
 * set in the bonus's spec. */
export function setBonusPerEventFor(
  auraId: string,
  caster: (IGearCarrier & { spec?: string }) | undefined,
): ISetBonusPerPressDuration | undefined {
  const r = SET_BONUS_PER_EVENT_DURATIONS[auraId];
  return r && wearsSetBonus(caster, r) ? r : undefined;
}
