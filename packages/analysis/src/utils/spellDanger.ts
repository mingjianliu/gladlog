import { classMetadata } from '../data/classSpells';
import { spells } from '../data/spellTags';
import { SpellTag } from '../data/spellTypes';

export enum SpellEffectType {
  DamageAmp = 'DamageAmp',
  HealReduction = 'HealReduction',
  Vulnerability = 'Vulnerability',
  Execution = 'Execution',
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
  '360194': [SpellEffectType.DamageAmp, SpellEffectType.HealReduction], // Deathmark (Assassination Rogue)
  '1248010': [SpellEffectType.DamageAmp, SpellEffectType.HealReduction], // Deathmark (Assassination Rogue, 12.1 variant id)
  // HealReduction only
  '375901': [SpellEffectType.HealReduction], // Mindgames (Shadow Priest) — reverses heals into damage
  '198817': [SpellEffectType.HealReduction], // Sharpen Blade (Warrior)
  // Execution
  '322109': [SpellEffectType.Execution], // Touch of Death (Monk)
  '343527': [SpellEffectType.Execution], // Execution Sentence (Paladin) — 4 live ids 12.1
  '387113': [SpellEffectType.Execution], // Execution Sentence (Paladin) — 4 live ids 12.1
  '1234189': [SpellEffectType.Execution], // Execution Sentence (Paladin) — 4 live ids 12.1
  '1260251': [SpellEffectType.Execution], // Execution Sentence (Paladin) — 4 live ids 12.1
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
  '113860', // Dark Soul: Misery — gone in 12.x
  '137639', // Storm, Earth, and Fire — gone in 12.x
  '207289', // Unholy Assault
  '231895', // Crusade (Avenging Wrath, Retribution variant)
  '266779', // Coordinated Assault
  '275699', // Apocalypse
  '323764', // Convoke the Spirits — renumbered to 322109 (S2 sweep 2026-08-21)
  '359844', // Call of the Wild
  '391109', // Dark Ascension
]);

/**
 * **The ONE canonical "is this an offensive cooldown" table** (GH #60 coarse
 * spot 4, closed 2026-09-02 — this was `docs/predicate-index.md`'s open
 * "Not yet unified" divergence). Union of the two tables the repo used to
 * carry — the `SPELL_CATEGORIES` offensive types (41 ids, via `spellTags`,
 * mostly aura/buff ids) and `classMetadata`'s `SpellTag.Offensive` abilities
 * (34 ids, cast ids) — minus `OFFENSIVE_CD_DEAD_IDS`: 41 ∪ 34 = 56 (overlap
 * 19) − 9 dead = 47 on 2026-09-02; 48 since 2026-09-18 (Zenith 1249625 added
 * to classMetadata — the successor of the dead 137639 had never been listed);
 * 60 since the first `offensiveCdGapScan` run the same day (+12, the evidence
 * sits beside each entry in classSpells.ts).
 *
 * Deliberately NOT added by that run, so nobody "completes" them later:
 *   - Divine Toll 375576 (Ret lift 2.03, coPressed 5 %): the table keys on the
 *     spell id with no spec gate, and Holy Paladins press the same id as a
 *     heal — it would open a fake "enemy burst" window on every enemy Holy
 *     Paladin. Needs a spec-aware table first.
 *   - Meteor 153561 (lift 2.54), Frostwyrm's Fury 279302 (2.65): instant
 *     nukes. Every consumer renders a table member as a WINDOW ("Meteor/Fire
 *     Mage (7 s left)" in [RES] — caught by the real-fixture test); a nuke
 *     that has already landed is not a window to defend through.
 *   - Gladiator's Badge 345228 / Blood Fury / Berserking: item and racials,
 *     coPressed 47–98 % (they ride a class cooldown); racials have their own
 *     table.
 *   - Reaper's Mark, Goremaw's Bite, Execution Sentence, Tip the Scales,
 *     Champion's Spear: coPressed 67–90 % or lift < 1.5 — the scan cannot
 *     separate them from the cooldown they are pressed with.
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
        spells[id].type === 'buffs_offensive' ||
        spells[id].type === 'debuffs_offensive',
    ),
    ...classMetadata.flatMap((cls) =>
      cls.abilities
        .filter((a) => a.tags.includes(SpellTag.Offensive))
        .map((a) => String(a.spellId)),
    ),
  ].filter((id) => !OFFENSIVE_CD_DEAD_IDS.has(id)),
);

/**
 * Returns true if the canonical offensive-cooldown table holds this spell.
 * (The pre-2026-09-02 comment claimed "covers all 120 tagged offensive
 * spells" — that was wrong on both counts; the real membership is
 * `OFFENSIVE_CD_SPELL_IDS`, 60 ids.)
 */
export function isOffensiveSpell(spellId: string): boolean {
  return OFFENSIVE_CD_SPELL_IDS.has(spellId);
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
export function spellDangerWeight(spellId: string, cooldownSeconds: number): number {
  const effects = SPELL_EFFECT_OVERRIDES[spellId] ?? [SpellEffectType.DamageAmp];
  const effectWeight = effects.reduce((sum, e) => sum + EFFECT_TYPE_WEIGHTS[e], 0);
  return cdTierWeight(cooldownSeconds) * effectWeight;
}

/** Score label for display */
export function dangerLabel(score: number): 'Low' | 'Moderate' | 'High' | 'Critical' {
  if (score >= 7) return 'Critical';
  if (score >= 4) return 'High';
  if (score >= 2) return 'Moderate';
  return 'Low';
}
