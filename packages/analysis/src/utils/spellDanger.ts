import { CombatUnitSpec } from "@gladlog/parser-compat";

import { classMetadata } from "../data/classSpells";
import { OVERRIDE_VARIANTS_GENERATED } from "../data/overrideVariantsGenerated";
import { OFFENSIVE_RACIAL_WINDOW_IDS } from "../data/racialAbilities";
import { spells } from "../data/spellTags";
import { SpellTag } from "../data/spellTypes";
import { TALENT_REPLACE_VARIANT_IDS } from "../data/talentReplaceVariants";

export enum SpellEffectType {
  DamageAmp = "DamageAmp",
  HealReduction = "HealReduction",
  Vulnerability = "Vulnerability",
  Execution = "Execution",
}

export const EFFECT_TYPE_WEIGHTS: Record<SpellEffectType, number> = {
  [SpellEffectType.DamageAmp]: 1.0,
  [SpellEffectType.HealReduction]: 1.5,
  [SpellEffectType.Vulnerability]: 1.2,
  [SpellEffectType.Execution]: 0.8,
};

/**
 * Effect type overrides for spells that are more dangerous than generic DamageAmp.
 * spells.json is the source of truth for *which* spells are offensive —
 * this table only needs entries for spells with non-DamageAmp effects.
 */
// 2026-08-21 S2 corpus scan (10,682 matches): removed Soul Rot 386997, Shadowy Duel 207736 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
// Same scan, WRONG ids replaced/deleted: 79140 Vendetta → Deathmark 360194/1248010;
// 315185 ("Mind Phase Transition In"), 314667 (no DB2 entry), 400986 ("Hellsteel
// Plating"), 343721 ("Final Reckoning") deleted; 323764 was Convoke the Spirits and
// 115080 an old Touch of Death id → both replaced by the live 322109.
export const SPELL_EFFECT_OVERRIDES: Record<string, SpellEffectType[]> = {
  // DamageAmp + HealReduction
  "360194": [SpellEffectType.DamageAmp, SpellEffectType.HealReduction], // Deathmark (Assassination Rogue)
  "1248010": [SpellEffectType.DamageAmp, SpellEffectType.HealReduction], // Deathmark (Assassination Rogue, 12.1 variant id)
  // HealReduction only
  "375901": [SpellEffectType.HealReduction], // Mindgames (Shadow Priest) — reverses heals into damage
  "198817": [SpellEffectType.HealReduction], // Sharpen Blade (Warrior)
  // Execution
  "322109": [SpellEffectType.Execution], // Touch of Death (Monk)
  "343527": [SpellEffectType.Execution], // Execution Sentence (Paladin) — 4 live ids 12.1
  "387113": [SpellEffectType.Execution], // Execution Sentence (Paladin) — 4 live ids 12.1
  "1234189": [SpellEffectType.Execution], // Execution Sentence (Paladin) — 4 live ids 12.1
  "1260251": [SpellEffectType.Execution], // Execution Sentence (Paladin) — 4 live ids 12.1
};

/**
 * Corpus-dead offensive-cooldown ids EXCLUDED from the canonical table below
 * (GH #60 tail, unification 2026-09-02). All nine came from the classMetadata
 * side of the former split and have **zero occurrences in the 10,682-match
 * 12.1 S2 archive** (`eval-private/corpus/observedSpellIds-S2-archive-
 * 2026-08-21.json`) — for one-button major cooldowns that would be pressed
 * every round by anyone who had them, zero occurrences over a whole season
 * is deadness, not rarity. Note DB2 still carries rows for all nine (a
 * `spellEffectGenerated` hit is NOT liveness — DB2 keeps rows for
 * unobtainable spells), so the corpus is the deciding evidence; 323764 is
 * additionally corroborated by `SPELL_EFFECT_OVERRIDES` above, which already
 * replaced it with the live 322109 in the 2026-08-21 S2 sweep. The
 * "when in doubt keep it" rule was applied — none of the nine was in doubt.
 */
export const OFFENSIVE_CD_DEAD_IDS: ReadonlySet<string> = new Set([
  "113860", // Dark Soul: Misery — gone in 12.x
  "137639", // Storm, Earth, and Fire — gone in 12.x
  "207289", // Unholy Assault
  "231895", // Crusade (Avenging Wrath, Retribution variant)
  "266779", // Coordinated Assault
  "275699", // Apocalypse
  "323764", // Convoke the Spirits — renumbered to 322109 (S2 sweep 2026-08-21)
  "359844", // Call of the Wild
  "391109", // Dark Ascension
]);

/**
 * **The ONE canonical "is this an offensive cooldown" table** (GH #60 coarse
 * spot 4, closed 2026-09-02 — this was `docs/predicate-index.md`'s open
 * "Not yet unified" divergence). Union of the two tables the repo used to
 * carry — the `SPELL_CATEGORIES` offensive types (41 ids, via `spellTags`,
 * mostly aura/buff ids) and `classMetadata`'s `SpellTag.Offensive` abilities
 * 41 ∪ 34 = 56 (overlap 19) − 9 dead = 47 on 2026-09-02; 48 since 2026-09-18 (Zenith 1249625 added
 * to classMetadata — the successor of the dead 137639 had never been listed);
 * 60 since the first `offensiveCdGapScan` run the same day (+11 casts and
 * the Voidform aura id 194249, the evidence sits beside each entry in classSpells.ts).
 *
 * Deliberately NOT added by that run, so nobody "completes" them later:
 *   - Divine Toll 375576 (Ret lift 2.03, coPressed 5 %): the table keys on the
 *     spell id with no spec gate, and Holy Paladins press the same id as a
 *     heal — it would open a fake "enemy burst" window on every enemy Holy
 *     Paladin. Since GH #184 part B (2026-11-05) the spec-aware table is
 *     `SPEC_GATED_OFFENSIVE_CD_IDS` below: Retribution's press is a burst.
 *   - Convoke the Spirits 391528: similarly, Restoration Druids press the same
 *     id as a major healing channel (Regrowth, Rejuvenation, Swiftmend, Wild
 *     Growth). Balance's and Feral's are bursts through the same table.
 *   - Meteor 153561 (lift 2.54): an instant nuke. Every consumer renders a
 *     table member as a WINDOW ("Meteor/Fire Mage (7 s left)" in [RES] —
 *     caught by the real-fixture test); a nuke that has already landed is
 *     not a window to defend through. Frostwyrm's Fury 279302 (2.65) was
 *     kept out on the same reasoning until the user ruling of 2026-11-04
 *     (fact10 D31) made it a member: its window is its 10 s slow 279303 on
 *     the enemies it hit (`castEffectAuraGenerated`).
 *   - Predator's Wake 1259431 (Devourer, lift 2.26) is no member of its
 *     own: it is the The Hunt 1246167 button under Demonsurge 1245496 (DB2
 *     SpellEffect aura 332, misc 1246167 → 1259431; both SpellCategories
 *     Category 2427, 90 s), its press triggers The Hunt's own effect aura
 *     1246168 (`castEffectAuraGenerated`), so it reaches every consumer
 *     through `offensiveEffectCdId` as a The Hunt press (F20 D23,
 *     2026-10-28). The removal recorded here before ("2 s, no identified
 *     effect aura") read neither row.
 *   - Gladiator's Badge 345228: an item, coPressed 47–98 % (it rides a class
 *     cooldown). The racial windows Blood Fury / Berserking / Ancestral Call
 *     ARE members since the user ruling of 2026-10-20 (`OFFENSIVE_RACIAL_WINDOW_IDS`:
 *     "racials count as offensive cooldowns"), read from their own table in
 *     racialAbilities.ts.
 *   - Reaper's Mark, Goremaw's Bite, Execution Sentence, Tip the Scales,
 *     Champion's Spear: coPressed 67–90 % or lift < 1.5 — the scan cannot
 *     separate them from the cooldown they are pressed with.
 *   - Fury's Berserk 1269349 (Rampaging Berserker 1269308, 8 s: 3,531
 *     applications / 91 player-rounds ≈ 39 each, lift 5.4, coPressed 0.20)
 *     and Subtlety's Shadow Dance aura 185422 (6 s, 1,115 applications,
 *     coPressed 0.99) — `offensiveEffectGapScan` 605 files, 2026-09-26. User
 *     ruling the same day (GH #119): 「应该不算 这些一般是跟着别的技能走的」 —
 *     frequent short effects that ride another cooldown are not bursts.
 * KNOWN SPLIT, not fixable by membership: Colossus Smash, Touch of the Magi
 * and Kingsbane put their aura on the TARGET. Cast-side consumers (enemy-CD
 * timeline, [RES]) see them; aura-on-caster consumers
 * (`hasOffensiveSpellActive` → `threatActiveAt`) cannot. Same fact, two
 * answers — recorded here rather than papered over.
 * FLAGged, kept: Soul Immolation 1241937 measures lift 0.62 (damage in its
 * window is LOWER than the rest of the round) — a hand entry calls it the
 * Devourer's main burst; one statistic is not a mechanism, so it stays until
 * someone explains it. Power Infusion / Summon Infernal 1.39, Darkglare 1.53
 * sit low because a DoT spec's payoff outlasts the measured window.
 *
 * Both former consumers now read THIS set: `isOffensiveSpell` (the enemy-CD
 * window builder `reconstructEnemyCDTimeline` and everything downstream of
 * it, including the burst-window engine's `isBurstWindowOffensiveCd`) and
 * `cooldowns.ts`'s `OFFENSIVE_SPELL_IDS` (aura evidence:
 * `hasOffensiveSpellActive` → `threatActiveAt` / panic-press), plus
 * `signalSkillGradientScan.ts`'s exposure counts. Registered in
 * `data/curatedIdRegistry.ts` (Curated-List Completeness Rule — registering
 * is part of adding the table; the union is derived from two tables that are
 * themselves registered, but the DEAD exclusion above is new hand curation
 * and the union is what consumers actually key on).
 */
export const OFFENSIVE_CD_SPELL_IDS: ReadonlySet<string> = new Set(
  [
    ...Object.keys(spells).filter(
      (id) =>
        spells[id].type === "buffs_offensive" ||
        spells[id].type === "debuffs_offensive",
    ),
    ...classMetadata.flatMap((cls) =>
      cls.abilities
        .filter((a) => a.tags.includes(SpellTag.Offensive))
        .map((a) => String(a.spellId)),
    ),
    ...OFFENSIVE_RACIAL_WINDOW_IDS,
    // Ultimate Penitence (Discipline, 240 s): its bolts are a kill cooldown as
    // well as the caster's absorb — user ruling 2026-10-20 (fact1215 retest
    // idx 69, 「我觉得都算」: an enemy Ultimate Penitence is an enemy offensive
    // cooldown; 465k + 422k of its bolts on two players, the [ENEMY DEF] line
    // its only record). The 6.5 s window is the channel's aura on the caster
    // (`buffDuration.ts`); the save half stays where it is (`[ENEMY DEF]`).
    "421453",
  ].filter((id) => !OFFENSIVE_CD_DEAD_IDS.has(id)),
);

/**
 * GH #184 part B (user ruling 2026-11-05): offensive cooldowns in ONE spec's
 * hands only — the id is a healer's major in another spec, so it cannot sit
 * in the id-keyed `OFFENSIVE_CD_SPELL_IDS` (the notes above). Divine Toll
 * 375576 is Retribution's (Holy's is `[ENEMY HEAL CD]`); Convoke the Spirits
 * 391528 is Balance's and Feral's (Restoration's is `[ENEMY HEAL CD]`,
 * Guardian's stays a press fact). Read through `isOffensiveCdFor` /
 * `offensiveEffectCdId(id, spec)`: a reader that knows the unit's spec sees
 * them, one that does not keeps the id-only answer. Registered in
 * `curatedIdRegistry.ts`.
 */
export const SPEC_GATED_OFFENSIVE_CD_IDS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  "375576": new Set([CombatUnitSpec.Paladin_Retribution]),
  "391528": new Set([CombatUnitSpec.Druid_Balance, CombatUnitSpec.Druid_Feral]),
};

/** Is `spellId` a spec-gated offensive cooldown in `spec`'s hands
 * (`SPEC_GATED_OFFENSIVE_CD_IDS`)? */
export function isSpecGatedOffensiveFor(
  spellId: string,
  spec: unknown,
): boolean {
  return (
    spec !== undefined &&
    spec !== null &&
    (SPEC_GATED_OFFENSIVE_CD_IDS[spellId]?.has(String(spec)) ?? false)
  );
}

/** Is `spellId` an offensive cooldown in `spec`'s hands — a member of the
 * id-keyed table, or a spec-gated one of this spec. The reader of
 * `OFFENSIVE_CD_SPELL_IDS` wherever the unit is known. */
export function isOffensiveCdFor(spellId: string, spec: unknown): boolean {
  return (
    OFFENSIVE_CD_SPELL_IDS.has(spellId) || isSpecGatedOffensiveFor(spellId, spec)
  );
}

/** The same question of a ledger row (`extractMajorCooldowns`), whose tag
 * already carries its unit's spec: a spec-gated row is Offensive only in
 * its spec's ledger. For a reader that holds the row, not the unit. */
export function isOffensiveLedgerCd(cd: {
  spellId: string | number;
  tag?: string;
}): boolean {
  const id = String(cd.spellId);
  return (
    OFFENSIVE_CD_SPELL_IDS.has(id) ||
    (id in SPEC_GATED_OFFENSIVE_CD_IDS && cd.tag === SpellTag.Offensive)
  );
}

/**
 * fact7 class 3 (F21, 2026-10-30; D7 D8 D16 D45 D75 D78): offensive buttons
 * whose PRESS is a fact and that open nothing. Each has an official cooldown
 * of 45 s or more (the shape floor of user ruling 2026-09-18) and a press the
 * prompt had no line for, the Curated-List forward check `listGapPress`
 * (`packages/eval/scripts/scan5/listGap.ts`): the ids come from the log. They
 * are NOT `OFFENSIVE_CD_SPELL_IDS` members: who opens a burst window is the
 * registration's call, on `offensiveCdGapScan`'s printed list (the
 * "deliberately NOT added" notes above stand), and `[ENEMY UTILITY]` says the
 * press "is not an offensive burst". So: a `SpellTag.Utility` roster row on
 * the friendly side (press line, loadout, [RES]), and on the enemy side an
 * `[ENEMY CD]` line through `offensiveFacts`, which no burst reader reads
 * (`isOffensivePressFactFor`). Weight 0: no window, no threat. The [RES]
 * `enemy:` column lists one only while an effect it has runs (the row's
 * `buffEndSeconds`). Registered in `curatedIdRegistry.ts`.
 */
export const OFFENSIVE_PRESS_FACT_IDS: ReadonlySet<string> = new Set([
  // Ravager 228920 and Execution Sentence 343527 left 2026-11-05 (GH #184,
  // user ruling: a button with a use condition — Touch of Death's execute
  // range — stays a fact; one without is a major offensive cooldown): roster
  // Offensive rows, so `OFFENSIVE_CD_SPELL_IDS` members.
  "385059", // Odyn's Fury — Fury, 45 s (D8, D45); lift 1.70, coPressed 0.50
  // Dark Harvest 1257052 left 2026-11-03 (fact9 D7, user ruling): a
  // roster Offensive row, so an `OFFENSIVE_CD_SPELL_IDS` member.
  "357210", // Deep Breath, 120 s recharge (D78)
  "433874", // Deep Breath, the Scalecommander override (D78)
  // a Protection's press (Retribution's is a burst, GH #184 part B —
  // `SPEC_GATED_OFFENSIVE_CD_IDS`; a Holy Paladin's is [ENEMY HEAL CD])
  "375576", // Divine Toll — 60 s (D75)
  // The same class in the notes above: live, printed nowhere.
  "153561", // Meteor — Fire, 45 s
  // Frostwyrm's Fury 279302 left 2026-11-04 (fact10 D31, user ruling): a
  // roster Offensive row, so an `OFFENSIVE_CD_SPELL_IDS` member.
  "439843", // Reaper's Mark — 45 s
  "426591", // Goremaw's Bite — Subtlety, 45 s
  "370553", // Tip the Scales — 120 s, a Preservation's is [ENEMY HEAL CD]
  // a Guardian's press (Balance's and Feral's are bursts, GH #184 part B; a
  // Restoration's is [ENEMY HEAL CD])
  "391528", // Convoke the Spirits — 120 s
  // In `SPELL_EFFECT_OVERRIDES` only, which keys a weight and prints nothing.
  "322109", // Touch of Death — 180 s
  "375901", // Mindgames — 45 s
]);

/**
 * GH #115: offensive-cooldown EFFECTS that some builds receive under another
 * spell id — activation id → the canonical cooldown in `OFFENSIVE_CD_SPELL_IDS`.
 *
 * Radiant Glory removes Avenging Wrath's button and grants it as an 8 s proc
 * (454351, no cooldown of its own in DB2) off Wake of Ashes. Measured with
 * `offensiveCdGapScan`'s method (08-28 manifest every 10th file: 1,814 files,
 * 3,450 rounds, all ratings): in 74.8 % of Retribution rounds, damage lift
 * p50 2.44 against the pressed 31884's 2.39 (24.4 % of rounds) and the
 * registered yardstick's 2.12, coPressed 0; consecutive procs ≥ 30.0 s apart
 * (Wake of Ashes' 30 s recharge, 605 files). Before this table every enemy
 * burst consumer was blind to it (825ca842: 11 procs, no window).
 *
 * EFFECT identity only — "this cooldown's effect became active". It is
 * deliberately NOT `SPELL_CANONICAL_IDS` (cooldowns.ts): that table makes an
 * event a PRESS of the cooldown (`isPressOfCooldown`), and a proc is not a
 * button (GH #106 step 2 keeps 31884 proc-only for such a unit). Consumers
 * price its danger from the canonical cooldown (`offensiveDangerWeight` — a
 * recurrence floor is not potency: at 30 s `cdTierWeight` is 0, codex astra
 * 2026-09-26) and keep the activation's own id, duration and the absence of
 * an "available again" time. Registered in `curatedIdRegistry.ts`.
 */
export const OFFENSIVE_EFFECT_ACTIVATION_IDS: ReadonlyMap<string, string> =
  new Map([
    ["454351", "31884"],
    // fact10 D31 (user ruling 2026-11-04, 「效果激活」): Chosen of Frostbrood
    // 1265639 puts 1265384 on the Frostwyrm's Fury button for 45 s after a
    // press (SpellEffect aura 332, misc 279302) — a free second frostwyrm,
    // damage and slow only, no stun, no SpellCooldowns row of its own. Its
    // effect is Frostwyrm's Fury's; it is no press of the 90 s cooldown and
    // never makes the button ready. 6a545d58 / 733ef717: every 1265384
    // follows a 279302 by 3–58 s.
    ["1265384", "279302"],
  ]);

/** The canonical offensive cooldown whose effect this cast / aura id is:
 * itself for a table member, its cooldown for a registered activation
 * (`OFFENSIVE_EFFECT_ACTIVATION_IDS`) or for a DB2 override variant of a
 * member (`OVERRIDE_VARIANTS_GENERATED` — the same button and cooldown under
 * another id, F20 D23: Predator's Wake 1259431 → The Hunt 1246167, Orbital
 * Strike's Celestial Alignment 383410 / Incarnation 390414) or of a talent's
 * button replacement (`TALENT_REPLACE_VARIANT_IDS`, fact9 D27: Frozen Orb
 * 198149), undefined otherwise. A variant is a PRESS of the cooldown (it is in
 * `SPELL_CANONICAL_IDS` too); an activation is not. */
export function offensiveEffectCdId(
  spellId: string,
  /** the caster's spec, for a spec-gated member (`SPEC_GATED_OFFENSIVE_CD_IDS`);
   * absent = the id-keyed table alone */
  spec?: unknown,
): string | undefined {
  if (isOffensiveCdFor(spellId, spec)) return spellId;
  const overridden =
    OVERRIDE_VARIANTS_GENERATED[spellId] ?? TALENT_REPLACE_VARIANT_IDS[spellId];
  if (overridden !== undefined && OFFENSIVE_CD_SPELL_IDS.has(overridden))
    return overridden;
  return OFFENSIVE_EFFECT_ACTIVATION_IDS.get(spellId);
}

/**
 * Is this cast / aura id an offensive cooldown's effect — a member of the
 * canonical table or a registered activation of one (GH #115). Every
 * membership consumer reads this, never the raw set, so an activation is
 * seen the same way everywhere. (The pre-2026-09-02 comment claimed "covers
 * all 120 tagged offensive spells" — that was wrong on both counts.)
 */
export function isOffensiveSpell(spellId: string, spec?: unknown): boolean {
  return offensiveEffectCdId(spellId, spec) !== undefined;
}

/**
 * Logarithmic CD tier weight.
 * 30s→0.0, 60s→0.69, 90s→1.10, 120s→1.39, 180s→1.79, 300s→2.30
 */
export function cdTierWeight(cooldownSeconds: number): number {
  if (cooldownSeconds < 30) return 0;
  return Math.log(cooldownSeconds / 30);
}

/**
 * Combined danger weight for a single spell cast.
 * Uses SPELL_EFFECT_OVERRIDES for non-DamageAmp effects; defaults to DamageAmp for
 * any spell tagged offensive in spells.json.
 */
export function spellDangerWeight(
  spellId: string,
  cooldownSeconds: number,
): number {
  const effects = SPELL_EFFECT_OVERRIDES[spellId] ?? [
    SpellEffectType.DamageAmp,
  ];
  const effectWeight = effects.reduce(
    (sum, e) => sum + EFFECT_TYPE_WEIGHTS[e],
    0,
  );
  return cdTierWeight(cooldownSeconds) * effectWeight;
}

/**
 * Danger weight of an offensive cast from its effect: the canonical
 * cooldown's weight (`spellDangerWeight` at that cooldown's
 * `effectiveCooldownSeconds`, passed in by the caller that owns the effect
 * table). An activation (`OFFENSIVE_EFFECT_ACTIVATION_IDS`) weighs what its
 * cooldown weighs; a plain member is unchanged.
 */
export function offensiveDangerWeight(
  spellId: string,
  cooldownOf: (id: string) => number,
): number {
  const cdId = offensiveEffectCdId(spellId) ?? spellId;
  return spellDangerWeight(cdId, cooldownOf(cdId));
}

/** Score label for display */
export function dangerLabel(
  score: number,
): "Low" | "Moderate" | "High" | "Critical" {
  if (score >= 7) return "Critical";
  if (score >= 4) return "High";
  if (score >= 2) return "Moderate";
  return "Low";
}
