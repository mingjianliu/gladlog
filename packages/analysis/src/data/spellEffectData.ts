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
