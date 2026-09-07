import { KICK_LOCKOUT_OBSERVED } from "./kickLockoutObservedGenerated";
import { SPELL_CATEGORIES } from "./spellCategories";
import { SPELL_EFFECTS_GENERATED } from "./spellEffectGenerated";
import { SPELL_EFFECT_OVERRIDES } from "./spellEffectOverrides";

/*
 Interface and export for data mined from the WOW spells db itself
*/

export interface IMinedSpell {
  spellId: string;
  name: string;
  cooldownSeconds?: number;
  charges?: {
    charges?: number;
    chargeCooldownSeconds?: number;
  };
  durationSeconds?: number;
  /** Dispel type from SpellCategories.db2. null or undefined means the aura cannot be dispelled. */
  dispelType?: "Magic" | "Curse" | "Disease" | "Poison" | "Bleed" | null;
}

// Two layers: a generated base layer (raw DB2 values) plus a curated override
// layer that takes precedence (hand-calibrated values such as PvP adjustments
// always win).
//
// dispelType exception (2026-08-19, caught by 12.1 live logs — Ice Block
// mass-dispelled 30× in 147 matches while getDispelType said "not
// dispellable"): the override layer calibrates cooldown/duration/charges by
// hand, but NO `e()` entry ever sets dispelType — it is official-only data.
// A whole-object spread therefore silently DELETED the generated dispelType
// for every overridden id (7 ids: Divine Shield / Silence / Ice Block /
// Counter Shot / Blessing of Spellwarding / Apocalypse = Magic, Deathmark =
// Bleed). This is the SAME shadowing bug the DISPEL_TYPES patch loop in
// spellEffectOverrides.ts fixed for itself on 2026-07-25 — that fix never
// reached the main table. Field-restore dispelType only: the calibration
// fields (cd/duration/charges) stay override-authoritative as written, since
// their silence is itself a hand-modeling choice (e.g. generated
// charges 2×30s for Empower Rune Weapon contradicts the calibrated 120s —
// restoring charges wholesale would mix the two models).
export const spellEffectData = (() => {
  const merged = {
    ...SPELL_EFFECTS_GENERATED,
    ...SPELL_EFFECT_OVERRIDES,
  } as Record<string, IMinedSpell>;
  for (const id of Object.keys(SPELL_EFFECT_OVERRIDES)) {
    const gen = (SPELL_EFFECTS_GENERATED as Record<string, IMinedSpell>)[id];
    if (gen?.dispelType != null && merged[id]!.dispelType === undefined)
      merged[id] = { ...merged[id]!, dispelType: gen.dispelType };
  }
  return merged;
})();

// ── CC full duration: one predicate ─────────────────────────────────────────
/**
 * Oppressing Roar (Evoker), the one effect that lengthens CC in arena: aura
 * 232 "mechanic duration mod" on every enemy within 30 yd for 10 s — DB2
 * SpellEffect@12.1.0.69404 EffectBasePointsF 50 × PvpMultiplier 0.6 = **+30 %
 * in PvP** while the debuff sits on the holder. User ruling 2026-09-02:
 * "羊本身永远是6秒 除非有龙给的加持续时间的debuff".
 */
export const OPPRESSING_ROAR_SPELL_ID = "372048";
export const OPPRESSING_ROAR_PVP_CC_DURATION_MULT = 1.3;

/**
 * Full, undiminished PvP duration of a CC / root aura in seconds — the fact the
 * "Xs of CC wasted" estimate in ccBreakAnalysis rests on. Reads the official
 * DB2 duration (`durationSeconds`: PvPDurationIndex when the spell has one,
 * spellEffectOverrides layered on top) and falls back to the hand
 * `SPELL_CATEGORIES[id].duration` only for ids DB2 leaves blank
 * (combo-point-scaled Kidney Shot, cast-side ids that never appear as auras).
 *
 * 2026-09-02 S2 corpus check (605 archive files, APPLIED→REMOVED lifetime mode
 * per id): of the 22 hard-CC / root ids where the hand table and DB2
 * disagreed, 21 sided with DB2 (Polymorph family 8→6, Hex 8→6, Freezing Trap
 * 8→6, Entangling Roots 8→6, Hammer of Justice 6→5, Cyclone 6→5, Blind 6→5,
 * Blinding Light 6→4, Leg Sweep 3→4, Freeze 6→8, Imprison 6→3, …); the one
 * that did not — Binding Shot 117526, DB2 2 s vs observed 3.0 s ×1084 — is
 * corrected in `CORPUS_DURATION_PATCHES` (spellEffectOverrides.ts) so this
 * accessor still has a single source. The hand durations that DB2 covers were
 * removed from SPELL_CATEGORIES the same day (pinned by
 * `test/ccFullDuration.test.ts`), so the fallback cannot silently disagree.
 */
export function ccFullDurationSeconds(spellId: string): number | undefined {
  return (
    spellEffectData[spellId]?.durationSeconds ??
    SPELL_CATEGORIES[spellId]?.duration
  );
}

// ── Kick school lockout: one predicate ──────────────────────────────────────
/**
 * Kick -> school-lockout seconds. SPELL_INTERRUPT has only an event and no
 * aura, so the length is a lookup; the interruptInstances in
 * ccTrinketAnalysis and the cannot-cast intervals (dispel "locked out" gate,
 * healing-gap free time) share this one copy.
 *
 * Source order — official first, corpus as the verification gate (user ruling
 * 2026-09-04):
 *   1. DB2 `durationSeconds` of the kick spell itself — `genSpellEffects`
 *      prefers `SpellMisc.PvPDurationIndex`, and for kicks that IS the PvP
 *      lockout (Kick 1766: PvE index 32 = 6 s, PvP index 27 = 3 s). GH #62
 *      (2026-09-02) had concluded "DB2 has no lockout field" and built the
 *      corpus scan instead; the field was there all along, the generated
 *      table already carried Kick = 3.
 *   2. corpus-observed `KICK_LOCKOUT_OBSERVED` (kickLockoutScan.ts), kept as
 *      the fallback for a kick DB2 leaves blank;
 *   3. a hand `interrupts` duration in SPELL_CATEGORIES;
 *   4. 3 s.
 *
 * Verification (2026-09-04, S2 archive every-30th = 605 files, 5,322
 * interrupt→recast pairs): official vs the observed p25 agreed within 0.5 s
 * for all 14 kicks with n ≥ 100 (max |Δ| 0.45 s, Quell); the two visible
 * disagreements were scan artifacts on the bin MODE, not the lockout —
 * Counterspell mode 6 vs official 5 (p25 = 5.04 s: a quarter of victims
 * recast before 6 s, impossible under a 6 s lockout) and Axe Toss 3.5 vs 3
 * (n = 40). `test/kickLockout.test.ts` pins |official − p25| ≤ 0.5 s for
 * every observed kick with n ≥ 100 so a DB2 refresh that breaks the
 * agreement turns CI red instead of silently changing exemptions.
 * Direction of the change: Counterspell 6 → 5 s = one second less cannot-cast
 * exemption for its victims.
 *
 * Why the official value is read field-by-field and not through the merged
 * `spellEffectData`: the override layer lists most kicks for their COOLDOWN
 * (`e("1766", "Kick", 15)`), and the whole-object spread in the merge then
 * replaces the generated entry — deleting its `durationSeconds`, the same
 * shadowing that ate `dispelType` on 2026-08-19. An override that sets a kick
 * duration explicitly still wins (that is how a DB2 error would be patched);
 * an override that is silent on duration falls through to the generated
 * official value instead of to the corpus table.
 */
export function kickLockoutOfficialSeconds(
  kickSpellId: string,
): number | undefined {
  return (
    (SPELL_EFFECT_OVERRIDES as Record<string, IMinedSpell>)[kickSpellId]
      ?.durationSeconds ??
    (SPELL_EFFECTS_GENERATED as Record<string, IMinedSpell>)[kickSpellId]
      ?.durationSeconds
  );
}

export function kickLockoutSeconds(kickSpellId: string): number {
  return (
    kickLockoutOfficialSeconds(kickSpellId) ??
    KICK_LOCKOUT_OBSERVED[kickSpellId]?.lockoutSeconds ??
    SPELL_CATEGORIES[kickSpellId]?.duration ??
    3
  );
}

/**
 * Talent-conditional CC duration modifiers: applied on top of
 * `ccFullDurationSeconds` when the CASTER holds the talent
 * (`utils/ccDuration.ts` → `ccFullDurationForCaster`, ownership via
 * `talentOwnershipOf`). Hand-keyed — registered in curatedIdRegistry. Every
 * entry needs both halves of the evidence: the DB2 modifier row (aura 108
 * SPELLMOD_DURATION on the spell's class mask) AND the corpus split (casters
 * whose aura lived the extended length vs the base length, by talent).
 *
 * 2026-09-02 (GH #44 tail, ccLifetimeScan FLAG): Intimidating Shout peaked at
 * 7 s against DB2's 6 s. DB2: Resonant Voice 1243660 (Warrior class tree, node
 * 108685, all three specs) carries aura 108 +20 % duration on the shout mask.
 * S2 605-file corpus: 79 % of casters whose Intimidating Shout lived ~7 s held
 * the talent, 0 % of those at ~6 s. The two other DB2 rows on the same mask —
 * Thundering Roar 322093 (+100 %) and Warchanter 266143 (+50 %) — are not in
 * the 12.1 talent trees and never separated any caster group, so they are not
 * registered. Chaos Nova / Void Nova (the other two FLAGs) showed NO separating
 * talent and no DB2 row — left on the DB2 value, recorded in BACKLOG.
 */
export const CC_DURATION_TALENT_MODIFIERS: Record<
  string,
  ReadonlyArray<{ talentSpellId: string; pct: number; note: string }>
> = {
  "5246": [
    {
      talentSpellId: "1243660",
      pct: 20,
      note: "Resonant Voice — DB2 aura 108 +20 % on the Warrior shout mask; S2 corpus 79 % of ~7 s casters vs 0 % of ~6 s casters",
    },
  ],
};

/**
 * Talent-conditional duration modifiers for NON-CC buffs — the buff/CD twin of
 * `CC_DURATION_TALENT_MODIFIERS`, applied by `utils/buffDuration.ts` →
 * `buffFullDurationForCaster`. Same evidence bar as the CC table: every entry
 * needs the DB2 modifier row (aura 107 SPELL_AURA_ADD_FLAT_MODIFIER or 108
 * ADD_PCT_MODIFIER with EffectMiscValue_0 = 1 = SPELLMOD_DURATION) AND a
 * corpus split of casters at the extended vs the base lifetime — plus, here,
 * the two must RECONCILE ARITHMETICALLY (base + modifier === the observed
 * plateau). Values are PER RANK: the DB2 row carries one rank's worth, so
 * `talentRankOf` multiplies it.
 *
 * Why it exists (2026-09-06): `spellEffectGenerated.json` stores the DB2 base
 * (PvP-duration-aware) duration and nothing consumed a talent layer, so
 * `extractOwnerCDBuffExpiry` computed `cast + base` for buffs the game runs
 * longer. Measured on the local 227-file / 23 GB log archive by pairing each
 * SPELL_AURA_APPLIED with its SPELL_AURA_REMOVED (refresh in between = the
 * sample is discarded), then taking each (match, caster) cell's modal
 * lifetime: the official value was essentially ABSENT from the corpus —
 * Barkskin's 8 s appeared in 2 of 280 caster-cells, Guardian Spirit's 10 s in
 * 1 of 142. A per-player split alone cannot see a talent this popular (there
 * is no control group), which is why the DB2 half of the evidence is what
 * identified the cause; a flat correction would have been wrong.
 *
 * Entries below reconcile exactly. DB2 rows read from the locally cached
 * SpellEffect 12.1.0.69404.
 *
 * THE MASK CHECK IS NOT OPTIONAL. A first pass that only required "a talent
 * with a SPELLMOD_DURATION row, held by ~all of the long group, whose value
 * makes the arithmetic work" produced 23 candidates and most were nonsense —
 * Tiger's Fury attributed to Improved Barkskin, Argus Domination to Demon
 * Skin — because a talent held by ~100 % of a class carries no discriminating
 * power and a free-floating base value can absorb any modifier. Constraining
 * the base to the table's own value cut it to 12; requiring
 * `SpellClassOptions.SpellClassMask` (fetched at the same build) to actually
 * cover the target spell cut it to 10, killing exactly the two the reviewer
 * had flagged by eye (Improved Garrote ← Razor Wire, and Way of the Crane
 * ← Thunder Focus Tea — a BASELINE ability every Mistweaver has, so its
 * "100 % of the long group holds it" meant nothing). The four pre-existing
 * entries were run through the same mask check as a negative control and all
 * four pass.
 *
 * Note the two shapes of `untalentedBaseSeconds` vs what `spellEffectData`
 * answers with no caster: for Barkskin / Guardian Spirit / Time Dilation the
 * table value is the TALENTED one (see above), while for every entry added on
 * 2026-09-06 the table value IS the untalented base, so those change nothing
 * for a caster-less caller. None of the ten is in `classMetadata`, so none
 * reaches `extractOwnerCDBuffExpiry` today: they are exact facts waiting for
 * their consumers to become caster-aware, not a live output change.
 *
 * TWO SEARCH GAPS, both found by a user question on 2026-09-07 ("did you
 * actually read all the talents?") — the sweep above answers "which talent
 * LENGTHENS this spell", and that question is too narrow twice over:
 *
 *  1. A talent can PRODUCE the spell instead of lengthening it. Ascendance
 *     114052 was written off as "6 s observed vs DB2 15 s, a base-value
 *     problem" until the cast/application ratio was checked: 18 casts against
 *     1,684 applications. It is a Deeply Rooted Elements proc, and the proc
 *     carries its own duration — a mechanism no SPELLMOD_DURATION scan can
 *     see. `replaceSeconds` exists for this shape. Standing check before
 *     calling a duration mismatch unexplained: COUNT THE CASTS.
 *  2. Requiring the short group to NOT hold the talent silently discards
 *     every universally-taken talent. That filter is what hid Hover ←
 *     Extended Flight (6 + 4 = 10) and Recklessness ← Rampaging Berserker
 *     (DB2 12 × 1.5 = 18 — the hand override's 16 was ALSO wrong, so the
 *     arithmetic was being run against the wrong base). Ask DB2 first —
 *     "which modifiers' class masks can legally reach this spell" is a
 *     complete, small list — and use the corpus to choose among them, not to
 *     nominate them.
 *
 * That second query also closed Avenging Wrath's Holy half: 31884 is covered
 * by TWO +25 % rows (the talent 53376 and the spec passive 171648), so Holy
 * runs 20 × 1.5 = 30 s (42/42 caster-cells) while Retribution gets Divine
 * Wrath's +4 s (24 s, 72/74). It is still unregistered only because 171648 is
 * not in any talent tree, so `talentOwnershipOf` would answer "yes" for a
 * Retribution paladin too and double-count — the entry needs spec gating this
 * table does not have yet.
 *
 * NOT registered, evidence incomplete (do not add without closing the gap):
 *  · Shadow Blades 121471 (18 s in 65 of 75 cells) — NO talent with a
 *    SPELLMOD_DURATION row separates the groups at all (best +3 pp).
 *  · Survival of the Fittest 264735 for MARKSMANSHIP only — 108 caster-cells
 *    at 3.0 s that hold Lone Survivor 99 % and are plainly unaffected by it,
 *    against 6 s for the other two specs. Registered for BM/Survival, left
 *    alone for MM: the spec's own base is what disagrees, not a talent.
 *  · Rallying Cry 97463's second tier — 29 caster-cells at 15.5 s that hold
 *    Battlefield Commander like the 13 s group does; no second modifier
 *    reaches the spell. Priced at 13 s, which is still nearer than 10.
 *  · Improved Garrote 392401 (6 → 12 s) and Way of the Crane 451084
 *    (10 → 5 s) — the arithmetic worked (Razor Wire +6000 ms; Thunder Focus
 *    Tea −50 %) and both talents were held by ~100 % of the group, but
 *    neither modifier's class mask covers the spell. Rejected BY the mask
 *    check, kept here as the worked example of why it exists.
 *  · The other 76 of the 88 durations that disagree with the corpus: no
 *    talent with a SPELLMOD_DURATION row reconciles them at all (Rip,
 *    Rejuvenation, Hover, Divine Steed, Avenging Crusader, Recklessness …).
 *    Whatever moves those is not a talent duration modifier, so they are not
 *    this table's problem — do not force them in.
 */
export const BUFF_DURATION_TALENT_MODIFIERS: Record<
  string,
  ReadonlyArray<{
    talentSpellId: string;
    /**
     * Restrict this modifier to these specs (`CombatUnitSpec` values). Needed
     * whenever a spell is shared by specs that modify it differently:
     * Avenging Wrath is Sanctified Wrath ×1.5 for Holy and Divine Wrath +4 s
     * for Retribution, and without the gate the Holy entry short-circuits a
     * Retribution caster on its rank-0 path before Divine Wrath is reached.
     * Omit when the modifier applies wherever the talent can be taken.
     */
    specs?: readonly string[];
    /**
     * The buff's duration with NONE of these talents — the DB2 value, which is
     * NOT always what `spellEffectData[id].durationSeconds` answers. That
     * accessor has no caster and therefore cannot know the rank, so for these
     * ids it deliberately keeps the value a TYPICAL caster gets (Barkskin 12,
     * not 8: ~100 % of the corpus's 280 caster-cells hold Improved Barkskin,
     * so the base would be wrong far more often than the talented value is).
     * The talent layer must start from this number instead, or it would add
     * the talent a second time. Pinned by `test/buffDuration.test.ts`.
     */
    untalentedBaseSeconds: number;
    /**
     * Absolute duration when the caster holds the talent — for the case where
     * the talent does not LENGTHEN the spell but PRODUCES it: a proc whose
     * trigger carries its own duration, so the spell's own DB2 duration
     * describes only the (rare) hard-cast version. Mutually exclusive with
     * `addSeconds`/`pct`; the aura-107/108 evidence rule does not apply to
     * these entries, which need the proc evidence instead (cast count vs
     * application count, and the trigger's own DB2 value).
     */
    replaceSeconds?: number;
    /** Seconds added per rank (DB2 aura 107, EffectBasePointsF in ms). */
    addSeconds?: number;
    /** Percent added per rank (DB2 aura 108). Applied AFTER `addSeconds`. */
    pct?: number;
    note: string;
  }>
> = {
  "22812": [
    {
      talentSpellId: "327993",
      untalentedBaseSeconds: 8,
      addSeconds: 4,
      note: "Improved Barkskin — DB2 aura 107 +4000 ms, Druid class tree (all 4 specs), maxRanks 1; corpus 12.0 s in 278 caster-cells (Resto 104 / Feral 91 / Balance 83) holding it 100 % vs 0 % of the 2 cells at 8.0 s; 8 + 4 = 12",
    },
  ],
  "47788": [
    {
      talentSpellId: "440738",
      untalentedBaseSeconds: 10,
      addSeconds: 2,
      note: "Foreseen Circumstances — DB2 aura 107 +2000 ms, Priest HERO tree (Discipline + Holy), maxRanks 1; corpus 12.0 s in 141 caster-cells (Holy 138 / Disc 3) holding it 99 % vs 0 % of the 1 cell at 10.0 s; 10 + 2 = 12",
    },
  ],
  "184364": [
    {
      talentSpellId: "383468",
      untalentedBaseSeconds: 8,
      addSeconds: 3,
      note: "Invigorating Fury — DB2 aura 107 +3000 ms, Fury spec tree, maxRanks 1; corpus 11.0 s in 27 caster-cells holding it 100 % vs 0 % of the 14 cells at 8.0 s; 8 + 3 = 11",
    },
  ],
  "114052": [
    {
      talentSpellId: "378270",
      untalentedBaseSeconds: 15,
      replaceSeconds: 6,
      note: "Deeply Rooted Elements — NOT a duration modifier: the Restoration Shaman capstone PROCS Ascendance, and the proc carries its own length, so the spell's DB2 15 s (SpellMisc DurationIndex 8, no PvP variant) describes only the hard cast. Corpus: 1,684 aura applications against 18 casts of 114052, i.e. ~99 % are procs; 1,614 of 1,667 proc lifetimes are exactly 6.0 s; 162 of 162 caster-cells hold the talent. DRE's own DB2 effects carry dummy base points 6000 / 11.6 / 6 / 7 — the 6 is Restoration's (Enhancement 114051 is a normal cast, 672 casts vs 695 applications, 15.0 s, and stays on the base value).",
    },
  ],
  "31884": [
    {
      talentSpellId: "53376",
      specs: ["65"], // Paladin_Holy
      untalentedBaseSeconds: 20,
      pct: 50,
      note: "Sanctified Wrath — DB2 puts +25 % on the talent itself (53376) AND +25 % on the spec passive 171648, BOTH masks covering Avenging Wrath, so the talent is worth +50 % here; corpus agrees exactly: 42 of 42 caster-cells at 30.0 s hold it and 0 of the 4 at 20.0 s do (20 × 1.5 = 30)",
    },
    {
      talentSpellId: "406872",
      specs: ["70"], // Paladin_Retribution
      untalentedBaseSeconds: 20,
      addSeconds: 4,
      note: "Divine Wrath — DB2 aura 107 +4000 ms per rank, Paladin/Retribution (maxRanks 2), mask covers the spell; corpus 72 of 74 caster-cells at 24.0 s hold it at rank 1 vs 0 % of the Holy 30 s group; 20 + 4 = 24",
    },
  ],
  "216331": [
    {
      talentSpellId: "53376",
      specs: ["65"], // Paladin_Holy
      untalentedBaseSeconds: 15,
      pct: 50,
      note: "Sanctified Wrath — corpus is unambiguous and matches Avenging Wrath's ×1.5 exactly: 102 of 102 caster-cells at 22.5 s hold it, the 15 s group 2 of 5 (15 × 1.5 = 22.5). DB2 only accounts for HALF of it here — 216331's class mask is 0/0/0/64 and the second +25 % row (171648) carries 0/256/0/0, so only the talent's own +25 % legally reaches it. Registered on corpus evidence with DB2 partially disagreeing, the same standing as CORPUS_DURATION_PATCHES' Binding Shot 2 → 3 s; if a future build's mask data lines up, fold it back to two +25 % rows.",
    },
  ],
  "358267": [
    {
      talentSpellId: "375517",
      untalentedBaseSeconds: 6,
      addSeconds: 4,
      note: "Extended Flight — DB2 aura 107 +4000 ms per rank, Evoker class tree (maxRanks 2), mask covers the spell; corpus 219 caster-cells at 10.0 s hold it 100 % (6 + 4 = 10, i.e. everyone buys one rank) with no untalented control group at all — the same shape as Improved Barkskin. Open: 6 Augmentation cells sit at 10.5 s.",
    },
  ],
  "1719": [
    {
      talentSpellId: "1269310",
      specs: ["72"],
      untalentedBaseSeconds: 12,
      pct: 50,
      note: "Rampaging Berserker — DB2 aura 108 +50 %, Warrior/Fury spec tree (maxRanks 1), mask covers the spell; corpus 31 of 31 caster-cells at 18.0 s hold it; 12 × 1.5 = 18. NOTE the base: DB2 says 12 while the hand override said 16, which is neither the base nor the talented value — running the arithmetic against that override is what made this look unexplainable for two rounds. The override now carries the talented 18.",
    },
  ],
  "264735": [
    {
      talentSpellId: "388039",
      specs: ["253", "255"],
      untalentedBaseSeconds: 6,
      addSeconds: 2,
      note: "Lone Survivor — DB2 aura 107 +2000 ms, Hunter class tree (maxRanks 1), mask covers the spell; corpus 254 caster-cells at 8.0 s hold it 100 % vs 29 at 6.0 s holding it 0 % (6 + 2 = 8). Spec-gated because Marksmanship is a THIRD group entirely: 108 cells at 3.0 s that hold the talent 99 % and are unaffected by it — that spec's own duration is unexplained and stays on the table value.",
    },
  ],
  "97463": [
    {
      talentSpellId: "424742",
      untalentedBaseSeconds: 10,
      addSeconds: 3,
      note: "Battlefield Commander — DB2 aura 107 +3000 ms, Warrior class tree (maxRanks 1), mask covers the spell; corpus 221 caster-cells at 13.0 s hold it 100 % vs 8 at 10.0 s holding it 12 % (10 + 3 = 13). Open: 29 further cells sit at 15.5 s while also holding it (mostly Fury) — unexplained, and they are priced at 13 s here, still closer than the table's 10.",
    },
  ],
  "357170": [
    {
      talentSpellId: "376240",
      untalentedBaseSeconds: 8,
      pct: 15,
      note: "Timeless Magic — DB2 aura 108 +15 % PER RANK, Preservation spec tree, maxRanks 2; corpus shows all three tiers of Time Dilation: 8.0 s × 7 cells (0 ranks, talent held by 0 %), 9.0 s × 5 (rank 1 → 8 × 1.15 = 9.2), 10.5 s × 143 (rank 2 → 8 × 1.30 = 10.4, talent held by 100 %)",
    },
  ],
  "589": [
    {
      talentSpellId: "390689",
      untalentedBaseSeconds: 16,
      addSeconds: 2,
      note: "Pain and Suffering — DB2 aura 107 +2000 ms, Priest/Discipline[spec] (maxRanks 2), mask covers the spell; 61 caster-cells at 20.0 s hold it 93 %, 34 at 16.0 s hold it 0 %; 16 + 2 × 2 = 20",
    },
  ],
  "262115": [
    {
      talentSpellId: "383154",
      untalentedBaseSeconds: 6,
      pct: 33,
      note: "Bloodletting — DB2 aura 108 +33 %, Warrior/Arms[spec] (maxRanks 1), mask covers the spell; 245 caster-cells at 8.0 s hold it 100 %, 63 at 6.0 s hold it 0 %; 6 × (1 + 33% × 1) = 8",
    },
  ],
  "2983": [
    {
      talentSpellId: "423683",
      untalentedBaseSeconds: 8,
      addSeconds: 4,
      note: "Featherfoot — DB2 aura 107 +4000 ms, Rogue/Assassination[class],Rogue/Outlaw[class],Rogue/Subtlety[class] (maxRanks 1), mask covers the spell; 154 caster-cells at 12.0 s hold it 100 %, 15 at 8.0 s hold it 0 %; 8 + 4 × 1 = 12",
    },
  ],
  "215769": [
    {
      talentSpellId: "196707",
      untalentedBaseSeconds: 6,
      pct: 50,
      note: "Afterlife — DB2 aura 108 +50 %, Priest/Holy[spec] (maxRanks 1), mask covers the spell; 132 caster-cells at 9.0 s hold it 98 %, 2 at 6.0 s hold it 0 %; 6 × (1 + 50% × 1) = 9",
    },
  ],
  "49039": [
    {
      talentSpellId: "389682",
      untalentedBaseSeconds: 10,
      addSeconds: 2,
      note: "Unholy Endurance — DB2 aura 107 +2000 ms, Death Knight/Blood[class],Death Knight/Frost[class],Death Knight/Unholy[class] (maxRanks 1), mask covers the spell; 108 caster-cells at 12.0 s hold it 100 %, 1 at 10.0 s hold it 0 %; 10 + 2 × 1 = 12",
    },
  ],
  "217200": [
    {
      talentSpellId: "424557",
      untalentedBaseSeconds: 12,
      addSeconds: 2,
      note: "Savagery — DB2 aura 107 +2000 ms, Hunter/Beast Mastery[spec] (maxRanks 1), mask covers the spell; 114 caster-cells at 14.0 s hold it 99 %, 2 at 12.0 s hold it 0 %; 12 + 2 × 1 = 14",
    },
  ],
  "5217": [
    {
      talentSpellId: "202021",
      untalentedBaseSeconds: 10,
      addSeconds: 5,
      note: "Predator — DB2 aura 107 +5000 ms, Druid/Feral[spec] (maxRanks 1), mask covers the spell; 96 caster-cells at 15.0 s hold it 100 % (no control group in the corpus); 10 + 5 × 1 = 15",
    },
  ],
  "1250646": [
    {
      talentSpellId: "1253830",
      untalentedBaseSeconds: 8,
      addSeconds: 2,
      note: "Can't Miss, Won't Miss — DB2 aura 107 +2000 ms, Hunter/Marksmanship[hero],Hunter/Survival[hero] (maxRanks 1), mask covers the spell; 65 caster-cells at 10.0 s hold it 100 %, 13 at 8.0 s hold it 15 %; 8 + 2 × 1 = 10",
    },
  ],
  "155777": [
    {
      talentSpellId: "231040",
      untalentedBaseSeconds: 12,
      addSeconds: 3,
      note: "Lingering Healing — DB2 aura 107 +3000 ms, Druid/Balance[class],Druid/Feral[class],Druid/Guardian[class],Druid/Restoration[class] (maxRanks 1), mask covers the spell; 14 caster-cells at 15.0 s hold it 100 %, 2 at 14.0 s hold it 0 %; 12 + 3 × 1 = 15",
    },
  ],
  "367364": [
    {
      talentSpellId: "376240",
      untalentedBaseSeconds: 12,
      pct: 15,
      note: "Timeless Magic — DB2 aura 108 +15 %, Evoker/Preservation[spec] (maxRanks 2), mask covers the spell; 8 caster-cells at 15.5 s hold it 100 %, 4 at 17.5 s hold it 0 %; 12 × (1 + 15% × 2) = 15.5",
    },
  ],
};

// Loaded in the background rather than via a top-level await: TLA would make
// the entire module graph (including the renderer's first paint) serialize
// behind the 12MB table finishing its load — and the first screen (the match
// list) never looks up spell names at all. Evaluating this module kicks off
// the load and returns immediately; until it completes, getEnglishSpellName
// falls back down the fallback chain.
// The prompt path may NOT degrade: you must await ensureSpellNames() before
// building a prompt (the aggregate entry point is in data/ensure.ts).
let spellNamesMap: Record<string, string> = {};
let spellNamesLoaded = false;
const spellNamesLoad = import("./spellNames.json").then((m) => {
  spellNamesMap = (m.default ?? m) as unknown as Record<string, string>;
  spellNamesLoaded = true;
});

export const ensureSpellNames = (): Promise<void> => spellNamesLoad;

/** Whether spellNames has finished loading in the background (the gate for
 * spellNameLookup to build its index; do NOT test emptiness with Object.keys —
 * that counts 410k keys every single time). */
export const spellNamesReady = (): boolean => spellNamesLoaded;
export function getSpellNamesSnapshot(): Record<string, string> {
  return spellNamesMap;
}

export function getEnglishSpellName(
  spellId: string,
  fallback?: string | null,
): string {
  return (
    spellNamesMap[spellId] ??
    spellEffectData[spellId]?.name ??
    fallback ??
    spellId
  );
}
