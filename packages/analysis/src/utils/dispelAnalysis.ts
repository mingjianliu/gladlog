import { CombatUnitSpec, ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  dispelVerdictOf,
  type DispelWorth,
  type HealerCell,
} from "../data/dispelVerdicts";
import { CHANNEL_PROXY_IDS, DRINK_AURA_IDS } from "../data/occupancyAuras";
import { racialName } from "../data/racialAbilities";
import { ROOT_SPELL_IDS } from "../data/rootSpells";
import {
  ARCANE_TORRENT_NAME,
  SHATTERING_THROW_CAST_ID,
  SHATTERING_THROW_CAST_S,
  SHATTERING_THROW_REMOVES,
  SHIV_REMOVES,
  SHIV_SPELL_ID,
} from "../data/scopedPurges";
import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import {
  effectiveCooldownSeconds,
  getEnglishSpellName,
  spellEffectData,
} from "../data/spellEffectData";
import spellIdListsData from "../data/spellIdLists";
import { buildCannotCastIntervals } from "./cannotCastIntervals";
import { charmedThrough } from "./charmedPlayer";
import {
  applyCdTalentModifiers,
  chargeStateAt,
  getPressureThreshold,
  isHealerSpec,
  isMeleeSpec,
  playerTalentIdSets,
  specToString,
} from "./cooldowns";
import {
  buildCcCategoryHistory,
  DR_CATEGORY_MAP,
  getDRCategory,
  getDRLevelAtTime,
  PATCH_121_GOLIVE_EPOCH_MS,
} from "./drAnalysis";
import {
  distanceBetween,
  getUnitPositionAtTime,
  getUnitRawPositionAtTime,
  hasLineOfSight,
} from "./losAnalysis";
import { DISPEL_MAX_RANGE_YARDS, LOS_SWEEP_GAP_MS } from "./positionSampling";
import { fmtTime } from "./renderGrid";
import { spellRangeForCaster, spellReachForCaster } from "./spellRange";
import { hasOffensivePurgeTalent } from "./talentBehaviors";
import {
  choiceSelectionResolved,
  getPlayerTalentedSpellIds,
  getSpecFreeOrEntrySpellIds,
  getSpecTalentTreeSpellIds,
  isLoadoutFullyResolved,
} from "./talents";
import { threatActiveAt } from "./threatAssessment";

export type DispelPriority = "Critical" | "High" | "Medium" | "Low";
import {
  buildCastMatchIndex,
  classifyDispel,
  type DispelKind,
} from "./dispelKind";

type SpellEntry = { type: string; priority?: boolean };
const SPELLS = spellsData as Record<string, SpellEntry>;
const BIG_DEFENSIVE_IDS = new Set<string>(
  spellIdListsData.bigDefensiveSpellIds as string[],
);
const EXTERNAL_DEFENSIVE_IDS = new Set<string>(
  spellIdListsData.externalDefensiveSpellIds as string[],
);

// Reaction floors: a dispellable debuff must sit on a friendly (cleanse) / a
// purgeable buff on an enemy (purge) for at least this long before "you
// missed it" is a fair claim. GH #34 batch 4 (2026-08-28), 300 matches /
// 1,127 rounds, apply→removed lifetimes of ids that are officially dispellable
// AND corpus-observed dispelled: DEBUFFS on friendlies (n=108,615) [0,1) 8,321
// · [1,2) 9,233 · [2,3) 8,525 · [3,5) 16,890 · [5,8) 18,176 · [8,12) 15,936 ·
// [12,20) 18,027 · ≥ 20 13,505 (p50 6.3 s) → ≥ 2 s 83.8 % · **≥ 3 s 76.0 %** ·
// ≥ 5 s 60.4 %. BUFFS on enemies (n=141,840) [0,1) 54,183 · [1,2) 9,250 ·
// [2,3) 10,340 · [3,5) 23,499 · [5,8) 12,714 · [8,12) 10,838 · [12,20) 11,241
// · ≥ 20 9,771 (p50 3.0 s) → ≥ 2 s 55.3 % · **≥ 3 s 48.0 %** · ≥ 5 s 31.4 %.
// The sub-second spike on the buff side (38 %) is procs/short auras the
// threshold is exactly meant to exclude; the debuff side has no break at 3 s.
// Both editorial (a human reaction-time bar), measured, not official.
const MISSED_CLEANSE_THRESHOLD_S = 3;
const MISSED_PURGE_THRESHOLD_S = 3;
// Pairs a dispel with the backlash aura it caused (±4 s). Log-latency window
// of the same kind as timelineHelpers' buff-expiry tolerances; not measured
// in GH #34 batch 4 (2026-08-28) — noted, editorial.
const PENALTY_WINDOW_MS = 4000;

// Seconds after CC application to measure incoming damage for post-CC pressure weighting
export const POST_CC_PRESSURE_WINDOW_S = 5;

// Spells that silence + damage the dispeller when removed.
// VT dispel-damage was removed in Legion; Flame Shock has no dispel penalty.
//
// 2026-08-18 (GH #23) — this table was ENTIRELY STALE for Unstable Affliction,
// the "curated list completeness" failure in its purest form: every id it
// carried was dead, and every id the corpus actually shows was missing.
// Measured over 300 matches / 1178 rounds:
//
//   id       applied to allies   dispelled   was listed
//   316099           0               0          yes      ← TWW leftover (row deleted 2026-08-21)
//   342938           0               0          yes      ← TWW leftover (row deleted 2026-08-21)
//   1259790       1153             519          NO       ← the live one
//
// The old comment said "confirmed present in BigDebuffs data for TWW" — and
// TWW is the previous expansion. The mechanic itself is alive and unchanged in
// 12.1 ("dealing Shadow damage to the dispeller and silences them for 4 sec"),
// so the exemption was silently doing nothing.
//
// 2026-08-21: the dead TWW rows 316099/342938 were DELETED on corpus evidence —
// S2 scan over 10,682 matches / 3.3M raw lines: 0 occurrences of either id
// (eval-private/reports/s2-health-2026-08-21). Only the live 1259790 remains.
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const DISPEL_PENALTY_SPELLS = new Map<string, string>([
  ["1259790", "Silences & damages the dispeller (Unstable Affliction)"],
  [
    "34914",
    "Horrifies the dispeller for 3 s (Vampiric Touch → Sin and Punishment)",
  ],
]);

// The backlash table (dispelled debuff → aura on the dispeller) lives in
// data/backlashCc.ts so ccTrinketAnalysis and the timeline read the same rows
// (GH #103); re-exported here for existing importers.
import { BACKLASH_CC_SPELL_IDS } from "../data/backlashCc";
export { BACKLASH_CC_SPELL_IDS };

// 12.1 Stellar Protection (1297521): baseline Balance passive (level 42) —
// dispelling the druid's Moonfire/Sunfire re-applies Stellar Flare to the
// cleansed ally, and dispelling Stellar Flare detonates it (damage + knock-up).
// Corpus proof (3v3-rall-any-102, 25 matches, 2026-08-13): 46/63
// Moonfire/Sunfire dispels re-applied Stellar Flare 202347 within 2s (the
// misses are non-Balance druid casters); the one observed Stellar Flare dispel
// detonated 202347 damage on the cleansed ally in the same 0.01s. All 565
// Stellar Flare occurrences in that corpus are id 202347 — the 1223418/1223420
// DB2 variants never appear in logs.
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const STELLAR_PROTECTION_PENALIZED_SPELLS = new Map<string, string>([
  ["164812", "Re-applies Stellar Flare on dispel (Stellar Protection)"], // Moonfire
  ["164815", "Re-applies Stellar Flare on dispel (Stellar Protection)"], // Sunfire
  ["202347", "Detonates on dispel — damage + knock-up (Stellar Protection)"], // Stellar Flare
]);

/**
 * Single dispel-penalty predicate for both the missed-cleanse exemption and
 * the actual-dispel annotation. The Stellar Protection tier is gated twice,
 * and both gates are predicates rather than data holes: era (the passive
 * shipped at 12.1 go-live — the 12.0 library must keep flagging these
 * debuffs) and caster spec (only Balance has the passive; Feral/Guardian/
 * Resto Moonfire stays freely dispellable).
 */
function getDispelPenalty(
  removedSpellId: string,
  casterMayBeBalanceDruid: boolean,
  epochMs: number,
): string | undefined {
  const base = DISPEL_PENALTY_SPELLS.get(removedSpellId);
  if (base !== undefined) return base;
  if (!casterMayBeBalanceDruid || epochMs < PATCH_121_GOLIVE_EPOCH_MS)
    return undefined;
  return STELLAR_PROTECTION_PENALIZED_SPELLS.get(removedSpellId);
}

/**
 * F-C13: the backlash debuffs (the one penalty predicate, `getDispelPenalty`)
 * of dispel type `dispelType` that enemies had on `target` at `atMs` — a
 * defensive dispel removes every same-type debuff, so these go with the CC.
 */
function coPresentBacklash(
  target: ICombatUnit,
  dispelType: string,
  atMs: number,
  enemyPlayerById: ReadonlyMap<string, ICombatUnit>,
): string[] {
  const up = new Map<string, { name: string; src: string }>();
  for (const a of target.auraEvents ?? []) {
    if (a.logLine.timestamp > atMs) continue;
    if (!a.spellId) continue;
    const key = `${a.spellId}|${a.srcUnitId}`;
    const ev = a.logLine.event;
    if (
      ev === LogEvent.SPELL_AURA_APPLIED ||
      ev === LogEvent.SPELL_AURA_REFRESH ||
      ev === LogEvent.SPELL_AURA_APPLIED_DOSE
    )
      up.set(key, { name: a.spellName, src: a.srcUnitId });
    else if (ev === LogEvent.SPELL_AURA_REMOVED) up.delete(key);
  }
  const names: string[] = [];
  for (const [key, a] of up) {
    const id = key.split("|")[0]!;
    const caster = enemyPlayerById.get(a.src);
    if (!caster) continue;
    if (getDispelType(id) !== dispelType) continue;
    const isBalance = caster.spec === CombatUnitSpec.Druid_Balance;
    if (!getDispelPenalty(id, isBalance, atMs)) continue;
    const name = getEnglishSpellName(id, a.name);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

const teamHasBalanceDruid = (team: readonly ICombatUnit[]): boolean =>
  team.some((u) => u.spec === CombatUnitSpec.Druid_Balance);

/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const DISPEL_COOLDOWNS_BY_SPELL = new Map<string, number>([
  ["374251", 60], // Cauterizing Flame (Preservation Evoker)
  ["475", 0], // Remove Curse (Mage)
  ["2782", 0], // Remove Corruption (Druid)
]);

/** What a cleanse press costs when the table above has no entry. */
export const DEFAULT_CLEANSE_CD_S = 8;

/**
 * How long the caster's cleanse is actually gone for, and how many presses
 * they had in hand — the single predicate behind the missed-cleanse
 * feasibility gate ("was their cleanse even up?").
 *
 * The PvP-talent layer is NOT a hand table here: it goes through the same
 * generated DB2 modifiers the cooldown ledger uses (`applyCdTalentModifiers`
 * -> `talentModifiers.json`), which since 2026-09-11 includes the PvP talent
 * pool. That table carries exactly the two cases this gate used to get wrong:
 *   - `4987 Cleanse <- 199330 Cleanse the Weak, reduce_cd -4` — a NEGATIVE
 *     reduction, i.e. +4s. Measured on 250 S2 archive logs, round-segmented:
 *     177 consecutive Cleanse pairs, 23 (13%) closer together than 12s, which
 *     is why this must stay talent-gated rather than applied flat (the talent
 *     itself is picked by ~11–20% of Holy Paladins).
 *   - `527 Purify <- 196439 Purification, extra_charge 1`. Same logs: 813
 *     consecutive Purify pairs, **155 (19%) closer than the single-charge
 *     8s**, 39 of them inside one second — that is the second charge. Calling
 *     the priest locked out while a charge was in hand SUPPRESSES real
 *     missed-cleanse findings.
 *
 * Class / hero talent rows need the dispeller's talent tree (`casterTalents`,
 * `playerTalentIdSets`): Interwoven Threads −10 % on Naturalize / Expunge /
 * Cauterizing Flame was dropped while only PvP talents were passed (talent
 * impact audit 2026-09-26). Omitted → PvP + spec rows only, as before. The
 * ids live in the generated table, not here — naming them again locally is
 * how the two copies drift.
 */
export function cleanseRecoveryOf(
  dispelSpellId: string,
  casterPvpTalentIds?: ReadonlySet<string>,
  /** the dispeller's spec — owns spec-passive rows (GH #106) */
  casterSpecId?: string,
  casterTalents?: {
    talentedSpellIds: Set<string> | null;
    talentRanks: ReadonlyMap<string, number> | null;
  },
): { cooldownSeconds: number; charges: number } {
  const base =
    DISPEL_COOLDOWNS_BY_SPELL.get(dispelSpellId) ?? DEFAULT_CLEANSE_CD_S;
  if (
    base === 0 ||
    (!casterPvpTalentIds?.size &&
      !casterSpecId &&
      !casterTalents?.talentedSpellIds)
  )
    return { cooldownSeconds: base, charges: 1 };
  return applyCdTalentModifiers(
    dispelSpellId,
    base,
    1,
    casterTalents?.talentedSpellIds ?? null,
    new Set(casterPvpTalentIds ?? []),
    { specId: casterSpecId, talentRanks: casterTalents?.talentRanks ?? null },
  );
}

// Static spec → dispel-type maps. These represent specs whose cleanse ability is treated as
// baseline (virtually always present in arena). A few cleanses are technically talent-gated
// in the class/spec tree but are skipped so universally that treating them as static avoids
// noise without meaningful accuracy loss:
//   - Paladin Cleanse Toxins (Poison/Disease): class tree node, skipped only by very niche builds
//   - Druid Remove Corruption (Poison/Curse): class tree node, universal in arena
//   - Resto Druid Nature's Cure / Resto Shaman Purify Spirit: spec tree, always taken in arena
// Shadow Priest Purify Disease is the only talent-gated cleanse handled dynamically
// (via canDefensiveCleanse) because it is a meaningful variance in typical Shadow builds.
const MAGIC_REMOVERS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Paladin_Holy,
  CombatUnitSpec.Priest_Discipline,
  CombatUnitSpec.Priest_Holy,
  CombatUnitSpec.Druid_Restoration, // Nature's Cure — spec tree, always talented in arena
  CombatUnitSpec.Shaman_Restoration, // Purify Spirit — spec tree, always talented in arena
  CombatUnitSpec.Monk_Mistweaver, // Detox (also removes Poison/Disease)
  CombatUnitSpec.Evoker_Preservation, // Naturalize
]);

// Poison: all Paladins (Cleanse Toxins), all Druids (Remove Corruption), all Monks (Detox)
const POISON_REMOVERS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Paladin_Holy,
  CombatUnitSpec.Paladin_Protection,
  CombatUnitSpec.Paladin_Retribution,
  CombatUnitSpec.Druid_Balance,
  CombatUnitSpec.Druid_Feral,
  CombatUnitSpec.Druid_Guardian,
  CombatUnitSpec.Druid_Restoration,
  CombatUnitSpec.Monk_Mistweaver,
  CombatUnitSpec.Monk_Windwalker,
  CombatUnitSpec.Monk_Brewmaster,
  CombatUnitSpec.Evoker_Preservation, // Naturalize / Expunge / Cauterizing Flame
  CombatUnitSpec.Evoker_Devastation, // Expunge / Cauterizing Flame
  CombatUnitSpec.Evoker_Augmentation, // Expunge / Cauterizing Flame
]);

// Curse: all Druids (Remove Corruption), all Mages (Remove Curse), Resto Shaman (Purify Spirit)
const CURSE_REMOVERS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Druid_Balance,
  CombatUnitSpec.Druid_Feral,
  CombatUnitSpec.Druid_Guardian,
  CombatUnitSpec.Druid_Restoration,
  CombatUnitSpec.Mage_Arcane,
  CombatUnitSpec.Mage_Fire,
  CombatUnitSpec.Mage_Frost,
  CombatUnitSpec.Shaman_Restoration,
  CombatUnitSpec.Evoker_Preservation, // Cauterizing Flame
  CombatUnitSpec.Evoker_Devastation, // Cauterizing Flame
  CombatUnitSpec.Evoker_Augmentation, // Cauterizing Flame
]);

// Disease: all Paladins (Cleanse Toxins), Holy/Disc Priest (Purify), all Monks (Detox)
// Shadow Priest (Purify Disease) is talent-gated and handled in canDefensiveCleanse, not here.
const DISEASE_REMOVERS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Paladin_Holy,
  CombatUnitSpec.Paladin_Protection,
  CombatUnitSpec.Paladin_Retribution,
  CombatUnitSpec.Priest_Discipline,
  CombatUnitSpec.Priest_Holy,
  CombatUnitSpec.Monk_Mistweaver,
  CombatUnitSpec.Monk_Windwalker,
  CombatUnitSpec.Monk_Brewmaster,
  CombatUnitSpec.Evoker_Preservation, // Cauterizing Flame
  CombatUnitSpec.Evoker_Devastation, // Cauterizing Flame
  CombatUnitSpec.Evoker_Augmentation, // Cauterizing Flame
]);

// Bleed: Evokers
const BLEED_REMOVERS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Evoker_Preservation, // Cauterizing Flame
  CombatUnitSpec.Evoker_Devastation, // Cauterizing Flame
  CombatUnitSpec.Evoker_Augmentation, // Cauterizing Flame
]);

// Specs capable of removing Magic buffs from enemies (offensive dispel / spellsteal / devour)
const OFFENSIVE_PURGERS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Priest_Discipline, // Dispel Magic (offensive target)
  CombatUnitSpec.Priest_Holy, // Dispel Magic (offensive target)
  CombatUnitSpec.Priest_Shadow, // Dispel Magic (offensive target)
  CombatUnitSpec.Shaman_Restoration, // Purge
  CombatUnitSpec.Shaman_Elemental, // Purge
  CombatUnitSpec.Shaman_Enhancement, // Purge
  CombatUnitSpec.Mage_Arcane, // Spellsteal
  CombatUnitSpec.Mage_Fire, // Spellsteal
  CombatUnitSpec.Mage_Frost, // Spellsteal
  CombatUnitSpec.DemonHunter_Havoc, // Consume Magic
  CombatUnitSpec.DemonHunter_Vengeance, // Consume Magic
  // Triage 2026-09-29 missed-cleanse F-P5: the Devourer DH (Consume Magic
  // 278326) and every Hunter spec (Tranquilizing Shot 19801) purge in the log
  // (8c5b6ec5, f94a7604, 1b930c17) and read "CANNOT offensive purge". Both
  // are talent-gated like DH (`PURGE_TALENT_GATE`).
  CombatUnitSpec.DemonHunter_Devourer, // Consume Magic
  CombatUnitSpec.Hunter_BeastMastery, // Tranquilizing Shot
  CombatUnitSpec.Hunter_Marksmanship, // Tranquilizing Shot
  CombatUnitSpec.Hunter_Survival, // Tranquilizing Shot
  CombatUnitSpec.Warlock_Affliction, // Devour Magic (Felhunter)
  CombatUnitSpec.Warlock_Demonology, // Devour Magic (Felhunter)
  CombatUnitSpec.Warlock_Destruction, // Devour Magic (Felhunter)
]);

/**
 * GH #83 (user ruling 2026-09-23, "戒律牧46码必须修 看天赋修 … 其他射程距离的
 * 也修"): the spell each spec removes each debuff type with, so the reach
 * gate of a missed-cleanse / missed-purge blame is THAT spell's range for
 * THIS dispeller (`spellRangeForCaster`: official DB2 range + the range
 * talents they hold) instead of one 40 yd for everybody. Official ranges:
 * Purify 40 (46 with Phantom Reach), Nature's Cure / Remove Corruption 40
 * (45 with Astral Influence), Naturalize 30, Expunge and Cauterizing Flame 25
 * (30 with Arcane Reach), Dispel Magic and Purge 30. The flat 40 blamed a
 * Preservation Evoker 26–40 yd away for a cleanse it could not reach, and a
 * purger 30–40 yd away for a purge. Every id observed in the corpus
 * (checked 2026-09-23); registered in `data/curatedIdRegistry.ts`. A spec
 * not listed keeps DISPEL_MAX_RANGE_YARDS — the Felhunter's Devour Magic in
 * particular, whose range runs from the pet, not the warlock.
 */
export const CLEANSE_SPELLS_BY_TYPE: Readonly<
  Record<DispelType, Readonly<Partial<Record<string, readonly string[]>>>>
> = {
  Magic: {
    [CombatUnitSpec.Paladin_Holy]: ["4987"], // Cleanse
    [CombatUnitSpec.Priest_Discipline]: ["527"], // Purify
    [CombatUnitSpec.Priest_Holy]: ["527"],
    [CombatUnitSpec.Druid_Restoration]: ["88423"], // Nature's Cure
    [CombatUnitSpec.Shaman_Restoration]: ["77130"], // Purify Spirit
    [CombatUnitSpec.Monk_Mistweaver]: ["115450"], // Detox
    [CombatUnitSpec.Evoker_Preservation]: ["360823"], // Naturalize
  },
  Poison: {
    [CombatUnitSpec.Paladin_Holy]: ["4987"],
    [CombatUnitSpec.Paladin_Protection]: ["213644"], // Cleanse Toxins
    [CombatUnitSpec.Paladin_Retribution]: ["213644"],
    [CombatUnitSpec.Druid_Restoration]: ["88423"],
    [CombatUnitSpec.Druid_Balance]: ["2782"], // Remove Corruption
    [CombatUnitSpec.Druid_Feral]: ["2782"],
    [CombatUnitSpec.Druid_Guardian]: ["2782"],
    [CombatUnitSpec.Monk_Mistweaver]: ["115450"],
    [CombatUnitSpec.Monk_Windwalker]: ["218164"], // Detox
    [CombatUnitSpec.Monk_Brewmaster]: ["218164"],
    // Naturalize / Expunge / Cauterizing Flame
    [CombatUnitSpec.Evoker_Preservation]: ["360823", "365585", "374251"],
    [CombatUnitSpec.Evoker_Devastation]: ["365585", "374251"],
    [CombatUnitSpec.Evoker_Augmentation]: ["365585", "374251"],
  },
  Curse: {
    [CombatUnitSpec.Druid_Restoration]: ["88423"],
    [CombatUnitSpec.Druid_Balance]: ["2782"],
    [CombatUnitSpec.Druid_Feral]: ["2782"],
    [CombatUnitSpec.Druid_Guardian]: ["2782"],
    [CombatUnitSpec.Mage_Arcane]: ["475"], // Remove Curse
    [CombatUnitSpec.Mage_Fire]: ["475"],
    [CombatUnitSpec.Mage_Frost]: ["475"],
    [CombatUnitSpec.Shaman_Restoration]: ["77130"],
    [CombatUnitSpec.Evoker_Preservation]: ["374251"], // Cauterizing Flame
    [CombatUnitSpec.Evoker_Devastation]: ["374251"],
    [CombatUnitSpec.Evoker_Augmentation]: ["374251"],
  },
  Disease: {
    [CombatUnitSpec.Paladin_Holy]: ["4987"],
    [CombatUnitSpec.Paladin_Protection]: ["213644"],
    [CombatUnitSpec.Paladin_Retribution]: ["213644"],
    [CombatUnitSpec.Priest_Discipline]: ["527"],
    [CombatUnitSpec.Priest_Holy]: ["527"],
    [CombatUnitSpec.Priest_Shadow]: ["213634"], // Purify Disease
    [CombatUnitSpec.Monk_Mistweaver]: ["115450"],
    [CombatUnitSpec.Monk_Windwalker]: ["218164"],
    [CombatUnitSpec.Monk_Brewmaster]: ["218164"],
    [CombatUnitSpec.Evoker_Preservation]: ["374251"],
    [CombatUnitSpec.Evoker_Devastation]: ["374251"],
    [CombatUnitSpec.Evoker_Augmentation]: ["374251"],
  },
  Bleed: {
    [CombatUnitSpec.Evoker_Preservation]: ["374251"],
    [CombatUnitSpec.Evoker_Devastation]: ["374251"],
    [CombatUnitSpec.Evoker_Augmentation]: ["374251"],
  },
};

/** Same rule for offensive purges (see CLEANSE_SPELLS_BY_TYPE). */
export const PURGE_SPELLS_BY_SPEC: Readonly<
  Partial<Record<string, readonly string[]>>
> = {
  [CombatUnitSpec.Priest_Discipline]: ["528"], // Dispel Magic
  [CombatUnitSpec.Priest_Holy]: ["528"],
  [CombatUnitSpec.Priest_Shadow]: ["528"],
  [CombatUnitSpec.Shaman_Restoration]: ["370"], // Purge
  [CombatUnitSpec.Shaman_Elemental]: ["370"],
  [CombatUnitSpec.Shaman_Enhancement]: ["370"],
  [CombatUnitSpec.Mage_Arcane]: ["30449"], // Spellsteal
  [CombatUnitSpec.Mage_Fire]: ["30449"],
  [CombatUnitSpec.Mage_Frost]: ["30449"],
  [CombatUnitSpec.DemonHunter_Havoc]: ["278326"], // Consume Magic
  [CombatUnitSpec.DemonHunter_Vengeance]: ["278326"],
  [CombatUnitSpec.DemonHunter_Devourer]: ["278326"], // F-P5
  [CombatUnitSpec.Hunter_BeastMastery]: ["19801"], // Tranquilizing Shot (F-P5)
  [CombatUnitSpec.Hunter_Marksmanship]: ["19801"],
  [CombatUnitSpec.Hunter_Survival]: ["19801"],
};

/** A dispeller's reach with the spells it would use: the longest of their
 * talent-applied ranges; DISPEL_MAX_RANGE_YARDS when the spec has no listed
 * spell or the table knows no range for it. */
export function dispelReachYards(
  unit: ICombatUnit,
  spellIds: readonly string[] | undefined,
): number {
  let best: number | null = null;
  for (const id of spellIds ?? []) {
    const r = spellRangeForCaster(unit, id);
    if (r !== null && (best === null || r > best)) best = r;
  }
  return best ?? DISPEL_MAX_RANGE_YARDS;
}

/**
 * The offensive-purge spell a purger presses (user ruling A19 = C,
 * 2026-09-30; triage missed-cleanse F-P5 / F-P7). Its DB2 cooldown decides
 * the "Critical only" gate (`isCdGatedPurger`) — this replaced the hand spec
 * list CD_GATED_PURGERS, which missed the 12 s Greater Purge and the Hunters.
 * Priest 528 / Mage 30449 / Shaman 370 have no cooldown; Shaman 378773 (when
 * talented or cast) 12 s, DH 278326 10 s, Warlock 19505 15 s, Evoker
 * (Scouring Flame → Fire Breath) 357208 30 s, Hunter 19801 10 s.
 */
export const PURGE_GATE_SPELL_BY_SPEC: Readonly<Partial<Record<string, string>>> = {
  [CombatUnitSpec.Priest_Discipline]: "528", // Dispel Magic
  [CombatUnitSpec.Priest_Holy]: "528",
  [CombatUnitSpec.Priest_Shadow]: "528",
  [CombatUnitSpec.Mage_Arcane]: "30449", // Spellsteal
  [CombatUnitSpec.Mage_Fire]: "30449",
  [CombatUnitSpec.Mage_Frost]: "30449",
  [CombatUnitSpec.Shaman_Restoration]: "370", // Purge (378773 when talented / cast)
  [CombatUnitSpec.Shaman_Elemental]: "370",
  [CombatUnitSpec.Shaman_Enhancement]: "370",
  [CombatUnitSpec.DemonHunter_Havoc]: "278326", // Consume Magic
  [CombatUnitSpec.DemonHunter_Vengeance]: "278326",
  [CombatUnitSpec.DemonHunter_Devourer]: "278326",
  [CombatUnitSpec.Warlock_Affliction]: "19505", // Devour Magic (Felhunter)
  [CombatUnitSpec.Warlock_Demonology]: "19505",
  [CombatUnitSpec.Warlock_Destruction]: "19505",
  [CombatUnitSpec.Evoker_Preservation]: "357208", // Scouring Flame → Fire Breath
  [CombatUnitSpec.Evoker_Devastation]: "357208",
  [CombatUnitSpec.Evoker_Augmentation]: "357208",
  [CombatUnitSpec.Hunter_BeastMastery]: "19801", // Tranquilizing Shot
  [CombatUnitSpec.Hunter_Marksmanship]: "19801",
  [CombatUnitSpec.Hunter_Survival]: "19801",
};
export function purgeSpellOf(unit: ICombatUnit): string | null {
  const base = PURGE_GATE_SPELL_BY_SPEC[unit.spec] ?? null;
  if (
    base === "370" &&
    (playerTalentIdSets(unit).talentedSpellIds?.has(GREATER_PURGE_SPELL_ID) ||
      unitCastSpellIds(unit).has(GREATER_PURGE_SPELL_ID))
  )
    return GREATER_PURGE_SPELL_ID;
  return base;
}
export const GREATER_PURGE_SPELL_ID = "378773";

/** The purger's purge cooldown and charges as it plays it: the DB2 value
 *  through the ledger's talent layer (`applyCdTalentModifiers`, the
 *  `cleanseRecoveryOf` shape). */
function purgeRecoveryOf(
  unit: ICombatUnit,
  spellId: string,
): { cooldownSeconds: number; charges: number } {
  const base = effectiveCooldownSeconds(spellId) ?? 0;
  if (!(base > 0)) return { cooldownSeconds: 0, charges: 1 };
  const t = playerTalentIdSets(unit);
  return applyCdTalentModifiers(
    spellId,
    base,
    1,
    t.talentedSpellIds,
    new Set((unit.info?.pvpTalents ?? []).map(String)),
    { specId: unit.spec, talentRanks: t.talentRanks },
  );
}

/** A19 = C: a purger whose purge spell has a cooldown only answers Critical
 *  buffs ("they can't spam purge every GCD"). */
export function isCdGatedPurger(unit: ICombatUnit): boolean {
  const sp = purgeSpellOf(unit);
  return sp !== null && purgeRecoveryOf(unit, sp).cooldownSeconds > 0;
}

/**
 * F-P7 (codex r2 09-30): when this purger's purge is next usable, from its
 * cooldown-consuming CASTS (a purge that removes nothing still spends it —
 * f94a7604 243.483), in match seconds; −∞ = ready at `atMs`. The ability set
 * is the purger's purge spell(s) plus any dispel spell it removed something
 * with; a Felhunter's casts count for its warlock. Charge-aware.
 */
export function purgeReadyAtSeconds(
  unit: ICombatUnit,
  extraSpellIds: ReadonlySet<string>,
  atMs: number,
  matchStartMs: number,
): number {
  // The purge abilities this unit HAS: its purge spell (Greater Purge
  // replaces Purge), else the spec's list. One of them that was never cast,
  // or has no cooldown, is ready — an unused Dispel Magic keeps a priest
  // ready whatever its Mass Dispel is doing (codex review of F-P7).
  const own = purgeSpellOf(unit);
  const listed = PURGE_SPELLS_BY_SPEC[unit.spec] ?? [];
  const available = new Set<string>(
    own !== null && !listed.includes(own) ? [own] : listed,
  );
  if (own !== null) available.add(own);
  return abilitiesReadyAtSeconds(
    unit,
    available,
    extraSpellIds,
    atMs,
    matchStartMs,
  );
}

/** `purgeReadyAtSeconds`'s ledger over an explicit ability set: `available`
 *  are abilities the unit holds (never pressed ⇒ ready), `extraSpellIds` ones
 *  it was only seen using. */
function abilitiesReadyAtSeconds(
  unit: ICombatUnit,
  available: ReadonlySet<string>,
  extraSpellIds: ReadonlySet<string>,
  atMs: number,
  matchStartMs: number,
): number {
  const ids = new Set<string>([...available, ...extraSpellIds]);
  const casts = [
    ...(unit.spellCastEvents ?? []),
    ...(unit.petSpellCastEvents ?? []),
  ].filter(
    (c) =>
      c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      !!c.spellId &&
      ids.has(c.spellId) &&
      c.logLine.timestamp < atMs,
  );
  const atS = (atMs - matchStartMs) / 1000;
  let back = -Infinity;
  for (const id of ids) {
    const times = casts
      .filter((c) => c.spellId === id)
      .map((c) => (c.logLine.timestamp - matchStartMs) / 1000);
    if (!times.length) {
      if (available.has(id)) return -Infinity; // held and never pressed
      continue; // a dispel spell it used elsewhere, no press on record
    }
    const { cooldownSeconds, charges } = purgeRecoveryOf(unit, id);
    if (!(cooldownSeconds > 0)) return -Infinity; // a free purge is always there
    const st = chargeStateAt(times, cooldownSeconds, charges, atS);
    if (st.charges > 0) return -Infinity;
    back =
      back === -Infinity ? st.nextRecharge : Math.min(back, st.nextRecharge);
  }
  return back;
}

/**
 * A removal that is not a spec's Magic purge (user ruling P-P5b = C,
 * 2026-10-01; evidence in `data/scopedPurges.ts`). It counts only inside its
 * own scope and never makes its holder a general purger (`canOffensivePurge`
 * stays the Magic-purge roster).
 */
export type ScopedPurgeScope = "immunity" | "enrage" | "magic";
export interface IScopedPurgeTool {
  /** the press — its cooldown and reach are the tool's */
  castSpellId: string;
  name: string;
  scope: ScopedPurgeScope;
  /** what it removes, as the prompt states it */
  note: string;
  /** its cast time — a buff must outlast the reaction bar PLUS this to be a
   *  miss (0 for an instant) */
  castSeconds: number;
}
const WARRIOR_SPECS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Warrior_Arms,
  CombatUnitSpec.Warrior_Fury,
  CombatUnitSpec.Warrior_Protection,
]);
const ROGUE_SPECS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Rogue_Assassination,
  CombatUnitSpec.Rogue_Outlaw,
  CombatUnitSpec.Rogue_Subtlety,
]);

/** How far the tool reaches from its holder: Shattering Throw's cast range,
 *  Arcane Torrent's radius around the caster (`spellReachForCaster`). */
export function scopedToolReachYards(
  unit: ICombatUnit,
  tool: Pick<IScopedPurgeTool, "castSpellId">,
): number {
  return spellReachForCaster(unit, tool.castSpellId) ?? DISPEL_MAX_RANGE_YARDS;
}

/**
 * The scoped removals `unit` holds this match:
 *  - a Warrior with Shattering Throw (a choice node: talented, or — whatever
 *    the loadout says — observed casting it) → immunity shields;
 *  - a Rogue (Shiv is every Rogue's) → enrage effects;
 *  - anyone OBSERVED casting Arcane Torrent this match who has no Magic purge
 *    of their own → one Magic buff, enemies within its radius (the log has no
 *    race field, so an unpressed racial is not asserted).
 */
export function scopedPurgeToolsOf(unit: ICombatUnit): IScopedPurgeTool[] {
  const tools: IScopedPurgeTool[] = [];
  const cast = unitCastSpellIds(unit);
  if (
    WARRIOR_SPECS.has(unit.spec) &&
    (cast.has(SHATTERING_THROW_CAST_ID) ||
      hasTalentedAbility(unit, SHATTERING_THROW_CAST_ID))
  )
    tools.push({
      castSpellId: SHATTERING_THROW_CAST_ID,
      name: getEnglishSpellName(SHATTERING_THROW_CAST_ID),
      scope: "immunity",
      note: `immunity shields only, ${SHATTERING_THROW_CAST_S}s cast`,
      castSeconds: SHATTERING_THROW_CAST_S,
    });
  if (ROGUE_SPECS.has(unit.spec))
    tools.push({
      castSpellId: SHIV_SPELL_ID,
      name: getEnglishSpellName(SHIV_SPELL_ID),
      scope: "enrage",
      note: "enrage effects only",
      castSeconds: 0,
    });
  if (!canOffensivePurge(unit)) {
    const torrent = [...cast].find(
      (id) => racialName(id) === ARCANE_TORRENT_NAME,
    );
    if (torrent !== undefined)
      tools.push({
        castSpellId: torrent,
        name: ARCANE_TORRENT_NAME,
        scope: "magic",
        note: `one Magic buff from enemies within ${scopedToolReachYards(unit, { castSpellId: torrent })} yd of the caster`,
        castSeconds: 0,
      });
  }
  return tools;
}

/** A Magic buff an offensive purge can take: officially Magic and not on the
 *  blocklist. One predicate for the missed-purge universe and the "magic"
 *  scope. */
export function isMagicPurgeTarget(spellId: string): boolean {
  return getDispelType(spellId) === "Magic" && !PURGE_BLOCKLIST.has(spellId);
}

/**
 * Is that aura inside this scoped tool's scope — what `purgerRosterScan`
 * accepts as the explanation of an OBSERVED removal. "magic" is the dispel
 * type alone (Arcane Torrent did strip Power Word: Fortitude); whether a
 * tool can carry a missed-purge window is `scopedToolAnswers`.
 */
export function scopedToolRemoves(
  tool: Pick<IScopedPurgeTool, "scope">,
  auraSpellId: string,
): boolean {
  switch (tool.scope) {
    case "immunity":
      return SHATTERING_THROW_REMOVES.has(auraSpellId);
    case "enrage":
      return SHIV_REMOVES.has(auraSpellId);
    case "magic":
      return getDispelType(auraSpellId) === "Magic";
  }
}

/**
 * Could a missed-purge window on that buff be this tool's. Only Shattering
 * Throw accuses (user ruling P-P5b-land, 2026-10-02): Arcane Torrent is
 * stated in the PURGE RESPONSIBILITY header and never produces a
 * [MISSED PURGE OPPORTUNITY] line — its caster cannot choose which buff it
 * strips; Shiv's enrage effects carry no purge priority.
 */
export function scopedToolAnswers(
  tool: Pick<IScopedPurgeTool, "scope">,
  auraSpellId: string,
): boolean {
  return tool.scope === "immunity" && scopedToolRemoves(tool, auraSpellId);
}

// Spell IDs that have Magic dispelType in the game DB but cannot actually be targeted
// by player offensive purge abilities in practice. Covers three categories:
//   1. Immunity shells — target is spell-immune while active, so purge cannot land
//   2. Passive/visual auras — registered as Magic but not dispel-targetable
//   3. Cross-team targeting issues — buff is on your ally, not an enemy
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const PURGE_BLOCKLIST = new Set<string>([
  // ── Immunity shells (target is spell-immune; purge cannot land) ──────────────────
  "642", // Divine Shield (Paladin) — full spell immunity while active
  "45438", // Ice Block (Mage) — full spell immunity while active
  "186265", // Aspect of the Turtle (Hunter) — full spell + attack immunity
  // ── Passive / visual auras — registered as Magic but not dispel-targetable ───────
  "188501", // Spectral Sight (DH) — passive/visual, not purgeable
  "132158", // Nature's Swiftness — instant-cast buff, expires before purge lands
  // ── 2026-08-21 双向完备性检查新增(12.1 语料 2114 回合,用户裁定;三条官方
  //    都标 Magic,零实驱由用户按机制归类,不是仅凭语料推断)──────────────────
  "6940", // Blessing of Sacrifice — 用户裁定:根本不可驱(1398 指控 / 0 实驱)
  "378441", // Time Stop (Evoker) — 用户裁定:根本不可驱;目标停滞期免疫(25/0)
  "378081", // Nature's Swiftness(萨满版)— 用户裁定:可驱但瞬发即耗、实战来
  //           不及 —— 与德版 132158 同理不同 id(21/0)
  // ── 常驻团队增益(2026-08-13 审计):官方可驱散,但驱了立刻免费重上 ──────────
  // 判据是官方时长 3600s(赛前团队增益)且全队通刷 —— 与 Earth Shield 这种需要
  // 逐个维持的定向增益不同,后者登记为 buffs_defensive 而不在此。
  "21562", // Power Word: Fortitude(162 段)
  "1459", // Arcane Intellect(117 段)
  "1126", // Mark of the Wild(82 段)
  "462854", // Skyfury(71 段)
  // ── Cross-team targeting issues ──────────────────────────────────────────────────
  "29166", // Innervate — targeted at an ally, not an enemy; removed by defensive cleanse
  "605", // Mind Control — debuff on your ally, removed via defensive cleanse not offensive purge
]);

// Single source of truth — DispelType is derived from this array so adding a new type here
// automatically widens the union without needing a second edit.
const ALL_DISPEL_TYPES = [
  "Magic",
  "Poison",
  "Curse",
  "Disease",
  "Bleed",
] as const;
type DispelType = (typeof ALL_DISPEL_TYPES)[number];

// DH Consume Magic is in the TWW talent tree — only available if the player took the node.
const CONSUME_MAGIC_SPELL_ID = "278326";
// Warlock Felhunter: Summon Felhunter is in the talent tree; Devour Magic is a pet ability (not player talent).
// We use the Summon Felhunter talent as a proxy, falling back to cast evidence.
const SUMMON_FELHUNTER_SPELL_ID = "30146";
// Shadow Priest: Purify Disease is in the talent tree (not baseline like Holy/Disc).
// 213634 is confirmed in talentIdMap.json as both the talent node spellId and the cast spell ID,
// so it works for both talentedIds.has() checks and cast-evidence fallback.
const PURIFY_DISEASE_SPELL_ID = "213634";

const WARLOCK_SPECS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Warlock_Affliction,
  CombatUnitSpec.Warlock_Demonology,
  CombatUnitSpec.Warlock_Destruction,
]);
const DH_SPECS = new Set<CombatUnitSpec>([
  CombatUnitSpec.DemonHunter_Havoc,
  CombatUnitSpec.DemonHunter_Vengeance,
  CombatUnitSpec.DemonHunter_Devourer,
]);
const HUNTER_SPECS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Hunter_BeastMastery,
  CombatUnitSpec.Hunter_Marksmanship,
  CombatUnitSpec.Hunter_Survival,
]);
const TRANQUILIZING_SHOT_SPELL_ID = "19801";

/** Returns the set of spell IDs the unit successfully cast during the match. */
function unitCastSpellIds(unit: ICombatUnit): Set<string> {
  return new Set<string>(
    unit.spellCastEvents
      .filter((e) => e.logLine.event === LogEvent.SPELL_CAST_SUCCESS)
      .map((e) => e.spellId)
      .filter((id): id is string => id !== null),
  );
}

/**
 * Extracts the BUFF/DEBUFF marker from an aura event's raw log line.
 * Combat-log parameter index 11 holds this for SPELL_AURA_APPLIED, SPELL_AURA_REMOVED,
 * and SPELL_AURA_BROKEN(_SPELL). Returns null when the marker is absent (older fixtures
 * or edge log lines) so callers can decide how to treat unknowns.
 */
function getAuraType(aura: {
  logLine: { parameters: (string | number)[] };
}): "BUFF" | "DEBUFF" | null {
  const raw = aura.logLine.parameters[11];
  if (raw === "BUFF" || raw === "DEBUFF") return raw;
  return null;
}

/**
 * Returns true if a talent-gated spell is confirmed available for the unit.
 * - Has talent data and took the talent → true
 * - Has talent data and didn't take it → false
 * - No talent data + has COMBATANT_INFO → fall back to cast evidence
 * - No COMBATANT_INFO at all → false (can't verify; avoid false positives)
 */
function hasTalentedAbility(unit: ICombatUnit, spellId: string): boolean {
  const specIdNum = parseInt(unit.spec, 10);
  const talentTreeIds = getSpecTalentTreeSpellIds(specIdNum);
  if (!talentTreeIds.has(spellId)) return false; // not a talent for this spec

  const talentedIds = unit.info?.talents
    ? getPlayerTalentedSpellIds(specIdNum, unit.info.talents)
    : null;
  if (talentedIds !== null) return talentedIds.has(spellId);

  // No parsed talent data — use cast evidence if COMBATANT_INFO was present
  if (unit.info !== undefined) return unitCastSpellIds(unit).has(spellId);

  return false; // no COMBATANT_INFO — can't verify
}

/**
 * Debuff types a spec removes ONLY through a talent (any one of the listed
 * talent spells). The spec sets above say what the spec's cleanse CAN reach;
 * this table says which of those types need a talent the player may have
 * skipped. Talent impact audit 2026-09-26 (pick rates from COMBATANT_INFO,
 * 09-13 scan): Improved Purify is taken by 8 % of Discipline and 15 % of
 * Holy priests, Cleanse Toxins by 6 % of Retribution paladins, Improved
 * Purify Spirit by 88 % of Restoration shamans, Remove Corruption by 78 % of
 * Balance druids, Remove Curse by 68 % of Arcane mages, Detox by 66 % of
 * Windwalkers — the sets used to assume all of them. A confirmed "did not
 * take it" removes the type; unknown talents keep it (never filter on
 * missing data). Registered in curatedIdRegistry.
 * @internal exported for data/curatedIdRegistry
 */
export const DISPEL_TYPE_TALENT_GATES: Readonly<
  Partial<
    Record<CombatUnitSpec, Partial<Record<DispelType, readonly string[]>>>
  >
> = {
  [CombatUnitSpec.Shaman_Restoration]: { Curse: ["383016"] }, // Improved Purify Spirit
  [CombatUnitSpec.Priest_Discipline]: { Disease: ["390632"] }, // Improved Purify
  [CombatUnitSpec.Priest_Holy]: { Disease: ["390632"] },
  [CombatUnitSpec.Monk_Mistweaver]: {
    Poison: ["388874"], // Improved Detox
    Disease: ["388874"],
  },
  [CombatUnitSpec.Monk_Windwalker]: { Poison: ["218164"], Disease: ["218164"] }, // Detox
  [CombatUnitSpec.Monk_Brewmaster]: { Poison: ["218164"], Disease: ["218164"] },
  [CombatUnitSpec.Paladin_Holy]: {
    Poison: ["393024"], // Improved Cleanse
    Disease: ["393024"],
  },
  [CombatUnitSpec.Paladin_Protection]: {
    Poison: ["213644"], // Cleanse Toxins
    Disease: ["213644"],
  },
  [CombatUnitSpec.Paladin_Retribution]: {
    Poison: ["213644"],
    Disease: ["213644"],
  },
  [CombatUnitSpec.Druid_Restoration]: {
    Curse: ["392378"], // Improved Nature's Cure
    Poison: ["392378"],
  },
  [CombatUnitSpec.Druid_Balance]: { Curse: ["2782"], Poison: ["2782"] }, // Remove Corruption
  [CombatUnitSpec.Druid_Feral]: { Curse: ["2782"], Poison: ["2782"] },
  [CombatUnitSpec.Druid_Guardian]: { Curse: ["2782"], Poison: ["2782"] },
  [CombatUnitSpec.Mage_Arcane]: { Curse: ["475"] }, // Remove Curse
  [CombatUnitSpec.Mage_Fire]: { Curse: ["475"] },
  [CombatUnitSpec.Mage_Frost]: { Curse: ["475"] },
  // Evoker: Naturalize (Preservation baseline) covers Poison; Expunge /
  // Cauterizing Flame are class talents
  [CombatUnitSpec.Evoker_Devastation]: {
    Poison: ["365585", "374251"],
    Curse: ["374251"],
    Disease: ["374251"],
    Bleed: ["374251"],
  },
  [CombatUnitSpec.Evoker_Augmentation]: {
    Poison: ["365585", "374251"],
    Curse: ["374251"],
    Disease: ["374251"],
    Bleed: ["374251"],
  },
  [CombatUnitSpec.Evoker_Preservation]: {
    Curse: ["374251"],
    Disease: ["374251"],
    Bleed: ["374251"],
  },
};

/** false only when the unit's talents are known and it holds none of the
 * gating talents for this type. */
function passesDispelTalentGate(
  unit: ICombatUnit,
  dispelType: DispelType,
): boolean {
  const gate = DISPEL_TYPE_TALENT_GATES[unit.spec]?.[dispelType];
  if (!gate) return true;
  // the same talent reads as hasTalentedAbility: a gate talent is judged
  // only when it is in the spec's tree and the loadout is parsed
  const specIdNum = parseInt(unit.spec, 10);
  const tree = getSpecTalentTreeSpellIds(specIdNum);
  const judged = gate.filter((t) => tree.has(t));
  if (judged.length < gate.length) return true;
  // a free / entry node is never listed in the loadout (Improved Nature's
  // Cure, Expunge are granted to every Restoration druid / Devastation and
  // Augmentation evoker) — held, not "skipped"
  const free = getSpecFreeOrEntrySpellIds(specIdNum);
  if (gate.some((t) => free.has(t))) return true;
  // the talentOwnership "unknown" guards (codex review 2026-09-26): an empty
  // loadout, a loadout with node ids this build cannot resolve, or an
  // unreadable choice selection proves nothing about the gate talent
  const talents = unit.info?.talents;
  if (!talents || talents.length === 0) return true;
  if (!isLoadoutFullyResolved(specIdNum, talents)) return true;
  if (gate.some((t) => !choiceSelectionResolved(specIdNum, talents, t)))
    return true;
  const talented = getPlayerTalentedSpellIds(specIdNum, talents);
  if (talented === null) return true;
  return judged.some((t) => talented.has(t));
}

/**
 * Returns true if the unit can defensively cleanse the given debuff type from an ally,
 * accounting for talent-gated abilities (e.g. Shadow Priest Purify Disease).
 *
 * Note: Warlock Imp Singe Magic (party magic cleanse) is not tracked — it is a pet
 * ability with no reliable signal in player cast events.
 */
export function canDefensiveCleanse(
  unit: ICombatUnit,
  dispelType: DispelType,
): boolean {
  if (!passesDispelTalentGate(unit, dispelType)) return false;
  switch (dispelType) {
    case "Magic":
      return MAGIC_REMOVERS.has(unit.spec);
    case "Poison":
      return POISON_REMOVERS.has(unit.spec);
    case "Curse":
      return CURSE_REMOVERS.has(unit.spec);
    case "Disease":
      if (DISEASE_REMOVERS.has(unit.spec)) return true;
      // Shadow Priest can talent into Purify Disease — not in DISEASE_REMOVERS by default
      if (unit.spec === CombatUnitSpec.Priest_Shadow)
        return hasTalentedAbility(unit, PURIFY_DISEASE_SPELL_ID);
      return false;
    case "Bleed":
      return BLEED_REMOVERS.has(unit.spec);
  }
}

/**
 * Could `unit` remove a `dispelType` effect from a teammate — by a defensive
 * cleanse normally, by an offensive purge (Magic only) when the teammate was
 * charmed (reliability round 2 W1d, `charmedPlayer.ts`). One predicate for
 * the dispel windows, the missed-cleanse menu and the timeline lines.
 */
/**
 * The dispel spell(s) `unit` would press for a `dispelType` debuff (triage
 * missed-cleanse F-C12): the spec's `CLEANSE_SPELLS_BY_TYPE` list, and where
 * it lists several, only those that are baseline for the spec or talented
 * (the `hasTalentedAbility` reading `passesDispelTalentGate` uses). English
 * names.
 */
export function removalSpellIdsFor(
  unit: ICombatUnit,
  dispelType: DispelType,
  targetCharmed = false,
): readonly string[] {
  // a charmed teammate is hostile: only the offensive purge reaches them
  // (`canRemoveFrom`'s W1d distinction; codex review of F-C12 — a Discipline
  // priest's spell there is Dispel Magic, not Purify)
  if (targetCharmed) return PURGE_SPELLS_BY_SPEC[unit.spec] ?? [];
  const ids = CLEANSE_SPELLS_BY_TYPE[dispelType]?.[unit.spec] ?? [];
  if (ids.length <= 1) return ids;
  const specIdNum = parseInt(unit.spec, 10);
  const tree = getSpecTalentTreeSpellIds(specIdNum);
  // a free / entry node is never listed in the loadout (Expunge for
  // Devastation / Augmentation) — held, as `passesDispelTalentGate` reads it
  const free = getSpecFreeOrEntrySpellIds(specIdNum);
  const f = ids.filter(
    (id) => !tree.has(id) || free.has(id) || hasTalentedAbility(unit, id),
  );
  return f.length ? f : ids;
}
export function cleanseSpellNamesFor(
  unit: ICombatUnit,
  dispelType: DispelType,
  targetCharmed = false,
): string[] {
  return removalSpellIdsFor(unit, dispelType, targetCharmed).map((id) =>
    getEnglishSpellName(id),
  );
}

export function canRemoveFrom(
  unit: ICombatUnit,
  dispelType: DispelType,
  targetCharmed: boolean | undefined,
  targetName?: string,
): boolean {
  // the charmed player is under enemy control: never their own dispeller
  // (509-1-3009: a Scouring-Flame Devastation Evoker "able to purge" the
  // Mind Control he was under)
  if (targetCharmed && unit.name === targetName) return false;
  return targetCharmed
    ? dispelType === "Magic" && canOffensivePurge(unit)
    : canDefensiveCleanse(unit, dispelType);
}

/**
 * Returns true if the unit can actually perform an offensive purge, accounting for
 * talent gating (DH Consume Magic) and pet requirements (Warlock Felhunter).
 */
export function canOffensivePurge(unit: ICombatUnit): boolean {
  // B139: some specs gain an offensive purge only from a PvP talent — Preservation Evoker has no baseline
  // offensive purge (Naturalize is a defensive ally-dispel), but Scouring Flame gives Fire Breath one.
  if (hasOffensivePurgeTalent(unit.info?.pvpTalents)) return true;
  if (!OFFENSIVE_PURGERS.has(unit.spec)) return false;

  const specIdNum = parseInt(unit.spec, 10);
  const talentTreeIds = getSpecTalentTreeSpellIds(specIdNum);
  const talentedIds = unit.info?.talents
    ? getPlayerTalentedSpellIds(specIdNum, unit.info.talents)
    : null;
  const hasCombatantInfo = unit.info !== undefined;
  // castSpellIds is computed lazily (only when talentedIds is null) to avoid iterating
  // potentially thousands of cast events on the hot path where COMBATANT_INFO is present.
  let castSpellIds: Set<string> | null = null;
  const getCastSpellIds = () => {
    if (castSpellIds === null) castSpellIds = unitCastSpellIds(unit);
    return castSpellIds;
  };

  // DH: Consume Magic is talent-gated; Hunters: Tranquilizing Shot (F-P5),
  // the same reading.
  const gateId = DH_SPECS.has(unit.spec)
    ? CONSUME_MAGIC_SPELL_ID
    : HUNTER_SPECS.has(unit.spec)
      ? TRANQUILIZING_SHOT_SPELL_ID
      : null;
  if (gateId !== null && talentTreeIds.has(gateId)) {
    if (talentedIds !== null && !talentedIds.has(gateId)) return false;
    if (
      talentedIds === null &&
      hasCombatantInfo &&
      !getCastSpellIds().has(gateId)
    )
      return false;
  }

  // Warlock: Devour Magic requires an active Felhunter pet.
  // Summon Felhunter (30146) is in the talent tree; if the player has talent data and didn't
  // take it, they likely have a different pet. Fall back to cast evidence for the summon.
  if (WARLOCK_SPECS.has(unit.spec)) {
    if (talentTreeIds.has(SUMMON_FELHUNTER_SPELL_ID)) {
      if (talentedIds !== null && !talentedIds.has(SUMMON_FELHUNTER_SPELL_ID)) {
        // Didn't take Summon Felhunter talent — check cast evidence as final fallback
        // (they may have summoned it before the match started, so cast may not appear)
        if (!getCastSpellIds().has(SUMMON_FELHUNTER_SPELL_ID)) return false;
      }
    }
  }

  return true;
}

/**
 * DISPEL_TYPE_FALLBACK tombstone (emptied 2026-07-25 on two lines of
 * evidence): it used to hold 8 hand-written "confirmed dispellable in
 * practice" entries (Blind / Paralysis / Quaking Palm / Freezing Trap 203337 /
 * Intimidating Shout ×3 / Incapacitating Roar). Audit result: all 8 were
 * (a) dispelType null in the official DB2 data, and (b) never once observed
 * being dispelled across the 1245-match corpus.
 * Freezing Trap's **real aura id 3355** is officially Magic and does have
 * corpus evidence.
 *
 * 2026-08-19 correction to a stale claim: this note used to call 203337 "a
 * dead id that never appears in aura events". Measured on the current corpus
 * that is FALSE — 203337 IS the aura a Diamond-Ice (203340) hunter's trap
 * lands (249 applications / 0 dispels vs 3355's 1,949 / 218; Detainment's
 * Imprison behaves identically: 221527 101/0 vs 217832's 574/67, zero mixed
 * rows). The 2026-07-25 DECISION stands for the right reason though: 203337
 * must not be in any dispellable-fallback because the talented variant is
 * officially dispelType=None and behaviorally never dispelled — the official
 * per-variant ids handle the user's "钻石寒冰/拘禁版不可驱" intel with no
 * caster-talent gate needed (pinned by dispelVerdicts.test.ts).
 *
 * Conclusion: the official dispelType is the complete predicate;
 * no hand-maintained layer remains. */
const DISPEL_TYPE_FALLBACK: Record<string, DispelType> = {};

/**
 * Returns the dispel type for a spell ID from game data, or null if the spell
 * cannot be dispelled.
 *
 * Exported 2026-08-18: this is THE "is this debuff removable, and by which
 * cleanse" predicate, and #20's layer-2 (priority/worth) work needs to ask the
 * same question from outside this module. Copying `spellEffectData[id]
 * ?.dispelType` at a second call site would silently drop whatever this
 * function grows next (it already carries the DISPEL_TYPE_FALLBACK tombstone,
 * empty since 2026-07-25) — exactly the shared-predicate failure CLAUDE.md is
 * about.
 */
export function getDispelType(spellId: string): DispelType | null {
  const type = spellEffectData[spellId]?.dispelType;
  if (
    type === "Magic" ||
    type === "Poison" ||
    type === "Curse" ||
    type === "Disease" ||
    type === "Bleed"
  )
    return type;
  // Fall back to our curated map for CC spells missing from spellEffects.json.
  return DISPEL_TYPE_FALLBACK[spellId] ?? null;
}

function buildTeamDispelTypes(friends: ICombatUnit[]): Set<DispelType> {
  const types = new Set<DispelType>();
  for (const unit of friends) {
    for (const type of ALL_DISPEL_TYPES) {
      if (canDefensiveCleanse(unit, type)) types.add(type);
    }
  }
  return types;
}

/** Returns which friendly units can remove each dispel type. */
function buildTeamDispelCapability(
  friends: ICombatUnit[],
): Map<DispelType, ICombatUnit[]> {
  const map = new Map<DispelType, ICombatUnit[]>();
  const add = (type: DispelType, unit: ICombatUnit) => {
    const list = map.get(type) ?? [];
    list.push(unit);
    map.set(type, list);
  };
  for (const unit of friends) {
    for (const type of ALL_DISPEL_TYPES) {
      if (canDefensiveCleanse(unit, type)) add(type, unit);
    }
  }
  return map;
}

export interface IDispelEvent {
  timeSeconds: number;
  dispelSpellId: string;
  dispelSpellName: string;
  removedSpellId: string;
  removedSpellName: string;
  sourceName: string;
  sourceSpec: string;
  targetName: string;
  targetSpec: string;
  priority: DispelPriority;
  hasDispelPenalty: boolean;
  penaltyDescription?: string;
  /** Damage taken by the dispeller in the 4s after the dispel (only set when hasDispelPenalty) */
  penaltyDamageTaken?: number;
  /** Damage taken by the dispeller in the 4s before the dispel — baseline context */
  penaltyDamageBaseline?: number;
  isSpellSteal: boolean;
  /** True when the dispel was performed by a pet/NPC merged into the player's actionOut (e.g. Warlock Felhunter Devour Magic, Imp Singe Magic). */
  isPetDispel: boolean;
  /** deliberate = a cast produced it; proc = passive trigger (Cleanse the
   * Weak …); rider = side effect of a movement/form action. One predicate,
   * utils/dispelKind.ts — the desktop counts and the prompt fold read this. */
  dispelKind: DispelKind;
  wasFatal?: boolean;
  fatalUnitName?: string;
  fatalUnitSpec?: string;
  backlashCcSpellId?: string;
}

export interface IMissedCleanseWindow {
  timeSeconds: number;
  durationSeconds: number;
  targetName: string;
  targetSpec: string;
  spellName: string;
  spellId: string;
  priority: DispelPriority;
  dispelType: DispelType; // always set; null case is filtered before pushing
  /** Damage the target took in the first POST_CC_PRESSURE_WINDOW_S seconds after CC was applied */
  postCcDamage: number;
  /** BACKLOG #39 (user ruling A, 2026-08-25): true when this window's a-priori
   * tier said Critical but the measured consequence was zero (no damage in the
   * pressure window, target survived) and it was therefore demoted to High.
   * Kept visible so scans can count "would-have-been Critical" directly. */
  consequenceDemoted?: boolean;
  /** True if the healer who could remove this dispelType had their cleanse on CD */
  cleanseWasOnCD: boolean;
  cdBurnedOn?: {
    spellName: string;
    priority: DispelPriority;
    secondsBefore: number;
  };
  /** Feasibility gate b+c (user-decided 2026-08-02): hard-CC/silence auras ∪
   * kick lockout. True when every dispeller capable of this cleanse had free
   * time < the reaction threshold (MISSED_CLEANSE_THRESHOLD_S) inside the
   * window — you can't cleanse while CC'd/locked out, so it isn't a miss. */
  dispellersLockedOut: boolean;
  /** The target was charmed (Mind Control, `charmedThrough`) for the
   * window: only a friendly offensive purge could remove anything on them
   * (`canRemoveFrom`). Absent on hand-built fixtures = false. */
  targetCharmed?: boolean;
  /** Triage missed-cleanse F-C13 (ruling A44 = A): English names of the
   * backlash debuffs (`getDispelPenalty`) of the same dispel type on the
   * target when the CC landed — a cleanse would have removed them too and
   * the dispeller would eat the penalty. A fact, never an exemption. */
  coRemovesBacklash?: string;
  /** F-C4 (A39 = B): the signed 08-19 cell, after DR and U6's zero-damage
   * demotion — replaces `priority` for both rendering and menu admission.
   * Absent for ids with no signed row (they keep the legacy tier). */
  worth?: DispelWorth | HealerCell;
  /** Feasibility gate a (tri-state): true = at least one dispeller was in
   * reach during the reaction window (≤40 yd and LoS not false); false =
   * position data exists and nobody was in reach; null = no position data, so
   * **do not change the verdict** (treating "no data" as infeasible would
   * swallow all coaching on non-advanced corpus logs). */
  losReachable: boolean | null;
  /** Value gate d: the target's DR category was fully fresh at the time, and
   * within DR_CHAIN_LOOKAHEAD_S after the window ended they ate another CC of
   * the same category — dispelling here likely trades into a full-duration
   * chain, so the annotation softens to a cautious suggestion, not a block. */
  drChainRisk: boolean;
  /** DISPEL-002 (2026-08-06, signal-expansion batch 1, design:
   * docs/superpowers/specs/2026-08-07-signal-expansion-batch1-design.md): set
   * ONLY on entries in `IDispelSummary.lateCleanseWindows` — a cleanse DID
   * eventually land on this CC, but the apply→dispel latency was long enough
   * to matter (>= MISSED_CLEANSE_THRESHOLD_S). Undefined on every entry of
   * `missedCleanseWindows` (the "never cleansed" array), which is unaffected
   * by this addition. */
  lateDispelSeconds?: number;
}

export interface ICCEfficiencyStat {
  targetName: string;
  targetSpec: string;
  /** Critical + High CC windows applied by enemies (that the team could have cleansed) */
  totalCCWindows: number;
  /** CC windows dispelled quickly (< threshold) or explicitly dispelled by a teammate */
  cleanseCount: number;
  /** CC windows that lasted > threshold without a friendly dispel */
  missedCount: number;
  /** CC windows that ended because of incoming damage (SPELL_AURA_BROKEN_SPELL), not dispelled */
  brokenCount: number;
  /** cleanseCount / (cleanseCount + missedCount), ignoring broken-by-damage windows */
  cleanseRate: number;
}

export interface IMissedPurgeWindow {
  timeSeconds: number;
  /** How long the buff sat uncontested; capped at match duration if never removed */
  durationSeconds: number;
  enemyName: string;
  enemySpec: string;
  spellName: string;
  spellId: string;
  priority: DispelPriority;
  /** True if all eligible purgers had their purge ability on CD at the start of the miss window */
  purgeWasOnCD: boolean;
  /** F-P7: when the team's purge came back (match seconds), only when it
   * was on cooldown at application. */
  purgeReadyAtSeconds?: number;
  /** What the purger last used their ability on before the miss (only set when purgeWasOnCD) */
  cdBurnedOn?: {
    spellName: string;
    priority: DispelPriority;
    secondsBefore: number;
  };
  /**
   * True if friendly team was under meaningful pressure during the miss window.
   * Uses role-aware getPressureThreshold (post B8 fix).
   */
  teamUnderPressure: boolean;
  /** True when the missed purge fell inside a friendly kill window (offensiveWindows intersection).
   *  Optional: only set when annotateMissedPurgesWithKillWindows has run. */
  duringKillWindow?: boolean;
  /** Feasibility gate b+c (same treatment as the cleanse side): every eligible
   * purger was hard-CC'd/kick-locked down to free time < the reaction
   * threshold. */
  purgersLockedOut: boolean;
  /** Feasibility gate a (tri-state, same semantics as the cleanse side). */
  losReachable: boolean | null;
  /**
   * P-P5b = C: friends whose SCOPED removal answers this buff (Shattering
   * Throw on an immunity shield) and who were
   * not locked out for the whole window — each with ITS OWN feasibility, read
   * off its tool's cooldown and reach. The window-level facts above stay the
   * general Magic purgers' whenever one carried the window; a window no
   * general purger carried lives in `scopedMissedPurgeWindows`, its
   * window-level facts the scoped holders'.
   */
  scopedPurgers?: IScopedPurgerFacts[];
  /** Set by `missedPurgesFor`: the removal the asked-about player holds for
   *  this buff when it is a scoped one. */
  viaScopedTool?: Pick<
    IScopedPurgeTool,
    "name" | "scope" | "note" | "castSeconds"
  >;
}

export interface IScopedPurgerFacts {
  purgerName: string;
  tool: Pick<IScopedPurgeTool, "name" | "scope" | "note" | "castSeconds">;
  /** when the tool came back, only when it was on cooldown at application */
  purgeReadyAtSeconds?: number;
  lockedOut: boolean;
  losReachable: boolean | null;
}

/**
 * The missed-purge windows `unit` itself could have answered, with the
 * feasibility facts that apply to IT (Value-Gate feasibility: "could the
 * player have done it"). A general purger keeps the team's windows exactly as
 * they are; a player who holds only a scoped removal gets the windows that
 * tool covers, judged on that tool's cooldown and reach.
 */
export function missedPurgesFor(
  unit: ICombatUnit,
  summary: Pick<
    IDispelSummary,
    "missedPurgeWindows" | "scopedMissedPurgeWindows"
  >,
): IMissedPurgeWindow[] {
  if (canOffensivePurge(unit)) return summary.missedPurgeWindows;
  return [
    ...summary.missedPurgeWindows,
    ...(summary.scopedMissedPurgeWindows ?? []),
  ]
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .flatMap((w) => {
      const mine = w.scopedPurgers?.find((p) => p.purgerName === unit.name);
      if (!mine) return [];
      const {
        purgeReadyAtSeconds: _teamReadyAt,
        cdBurnedOn: _teamBurn,
        ...rest
      } = w;
      return [
        {
          ...rest,
          purgeWasOnCD: mine.purgeReadyAtSeconds !== undefined,
          ...(mine.purgeReadyAtSeconds !== undefined
            ? { purgeReadyAtSeconds: mine.purgeReadyAtSeconds }
            : {}),
          purgersLockedOut: mine.lockedOut,
          losReachable: mine.losReachable,
          viaScopedTool: mine.tool,
        },
      ];
    });
}

/** Marks missed purges that fell inside a friendly kill window. Mutates in place;
 *  kept separate from reconstructDispelSummary so its signature (and all call sites) stay unchanged. */
export function annotateMissedPurgesWithKillWindows(
  missedPurgeWindows: IMissedPurgeWindow[],
  offensiveWindows: Array<{ fromSeconds: number; toSeconds: number }>,
): void {
  for (const miss of missedPurgeWindows) {
    miss.duringKillWindow = offensiveWindows.some(
      (w) =>
        miss.timeSeconds >= w.fromSeconds && miss.timeSeconds < w.toSeconds,
    );
  }
}

export interface IDispelSummary {
  /** Our team removed debuffs from our allies */
  allyCleanse: IDispelEvent[];
  /** Our team purged / spell-stole buffs from enemies */
  ourPurges: IDispelEvent[];
  /** Enemies stripped buffs from our team */
  hostilePurges: IDispelEvent[];
  missedCleanseWindows: IMissedCleanseWindow[];
  /** DISPEL-002 (2026-08-06, signal-expansion batch 1): windows where a
   * Critical/High CC WAS eventually cleansed, but late (>=
   * MISSED_CLEANSE_THRESHOLD_S apply→dispel latency). A separate array on
   * purpose — matchTimeline.ts's [UNCLEANSED DEBUFF] narration and the
   * desktop dispel dashboard's missed count both read `missedCleanseWindows`
   * verbatim and must keep treating it as "never cleansed"; folding late
   * dispels into that array would make them narrate a cleanse that did
   * happen as one that never did. Only candidateFindings.ts's
   * `missedCleanseEvents` consumes this field (concatenated with
   * `missedCleanseWindows` before the type/cap/sort pipeline). */
  lateCleanseWindows: IMissedCleanseWindow[];
  ccEfficiency: ICCEfficiencyStat[];
  /** Critical/High magic buffs on enemies that sat >3s while we had an offensive purger */
  missedPurgeWindows: IMissedPurgeWindow[];
  /**
   * P-P5b = C: windows NO general purger carried — only a scoped removal
   * (Shattering Throw on an immunity shield) could have answered. A separate
   * array on purpose, the `lateCleanseWindows` reasoning: every reader of
   * `missedPurgeWindows` (the desktop dispel dashboard and mistakes card, the
   * retired missed-purge candidate) keeps exactly the universe it had; only
   * the timeline's owner view (`missedPurgesFor`) reads this one. Optional so
   * hand-built summaries need not carry it.
   */
  scopedMissedPurgeWindows?: IMissedPurgeWindow[];
}

/**
 * Buffs whose purge value depends on the OWN team's composition rather than on
 * the buff itself (2026-08-13 user ruling): "Blessing of Freedom's priority
 * depends on the matchup — all-melee slugfest, it does not matter; put a hunter
 * or a mage on our side and the enemy's Freedom becomes high priority."
 *
 * Modelled as a gate rather than a fixed tier: the buff keeps its normal
 * priority when our side actually has a spec whose pressure comes from kiting
 * (snares/roots), and drops to Low — i.e. never a missed-purge finding — when
 * it does not. The spec list starts at the two the user named; extend it with
 * evidence, not impressions.
 */
const SNARE_DEPENDENT_SPECS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Hunter_BeastMastery,
  CombatUnitSpec.Hunter_Marksmanship,
  CombatUnitSpec.Hunter_Survival,
  CombatUnitSpec.Mage_Arcane,
  CombatUnitSpec.Mage_Fire,
  CombatUnitSpec.Mage_Frost,
]);
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const COMP_DEPENDENT_PURGE_TARGETS = new Set<string>([
  "1044", // Blessing of Freedom
]);

/** Does our own team contain a spec whose game plan needs the enemy slowed? */
function ownTeamNeedsSnares(ownTeam: readonly ICombatUnit[]): boolean {
  return ownTeam.some((u) => SNARE_DEPENDENT_SPECS.has(u.spec));
}

/** Exported for tests only: the comp-dependent gate is a ruling that must be
 * pinned directly, not inferred from a whole-summary assertion. */
export function purgePriorityForTest(
  spellId: string,
  ownTeam?: readonly ICombatUnit[],
): DispelPriority {
  return getPriority(spellId, ownTeam);
}

/**
 * BACKLOG #39 — user ruling A (2026-08-25): a Critical missed/late-cleanse
 * accusation must be backed by an actual consequence. The a-priori tier
 * (getPriority: dispellability × comp) answers "how bad COULD this be"; on the
 * paired video corpus 22 of 125 Critical windows (17.6%) measured ZERO
 * follow-up damage — one in five of the coach's sternest accusations was
 * about a moment that cost nothing. Ruling A: Critical requires
 * postCcDamage > 0 OR the target dying around the window; otherwise demote
 * one tier to High (the habit is still worth a mention — B's concern — it
 * just no longer leads).
 *
 * postCcDamage is the damageIn sum over POST_CC_PRESSURE_WINDOW_S (the same
 * field the corpus measurement used). Note it deliberately excludes absorbed
 * pressure for now — same basis as the 22/125 baseline; folding
 * incomingPressure in would change the ruling's evidence base and is a
 * separate call.
 */
export function consequenceGatedPriority(
  priority: DispelPriority,
  postCcDamage: number,
  targetDied: boolean,
): { priority: DispelPriority; consequenceDemoted: boolean } {
  if (priority === "Critical" && consequenceDemotes(postCcDamage, targetDied)) {
    return { priority: "High", consequenceDemoted: true };
  }
  return { priority, consequenceDemoted: false };
}

/** #39's consequence test, one predicate for the legacy tier and the signed
 *  cell: no damage after the CC landed and the target did not die. */
export function consequenceDemotes(
  postCcDamage: number,
  targetDied: boolean,
): boolean {
  return !(postCcDamage > 0) && !targetDied;
}

/**
 * The signed 08-19 cell a window renders and is admitted by (triage
 * missed-cleanse F-C4; user rulings 2026-09-30: A39 = B, U4 = B-all, U6).
 * A `must` cell renders one tier down (`worth`) when #39's consequence test
 * says nothing came of it — the legacy Critical → High rule carried onto the
 * signed tier. worth / situational never demote.
 */
export function consequenceGatedWorth(
  cell: DispelWorth | HealerCell,
  postCcDamage: number,
  targetDied: boolean,
): { worth: DispelWorth | HealerCell; demoted: boolean } {
  return cell === "must" && consequenceDemotes(postCcDamage, targetDied)
    ? { worth: "worth", demoted: true }
    : { worth: cell, demoted: false };
}

/** #39: did the CC'd target die during the CC or its pressure window (+ the
 * pressure window's own span past removal)? Death linkage keeps Critical even
 * at zero damage — a kill secured by the CC itself. */
function targetDiedAround(
  unit: { deathRecords?: Array<{ timestamp: number }> },
  applyTs: number,
  removalTs: number,
): boolean {
  const endMs = Math.max(removalTs, applyTs + POST_CC_PRESSURE_WINDOW_S * 1000);
  return (unit.deathRecords ?? []).some(
    (d) => d.timestamp >= applyTs && d.timestamp <= endMs,
  );
}

function getPriority(
  spellId: string,
  /** Our own team; only consulted for COMP_DEPENDENT_PURGE_TARGETS. Omitted by
   * the call sites that judge a purge that ALREADY happened (there the buff's
   * intrinsic tier is what matters, not whether we should have gone for it). */
  ownTeam?: readonly ICombatUnit[],
): DispelPriority {
  if (
    ownTeam !== undefined &&
    COMP_DEPENDENT_PURGE_TARGETS.has(spellId) &&
    !ownTeamNeedsSnares(ownTeam)
  )
    return "Low";

  // WoW-flagged major defensives take precedence
  if (BIG_DEFENSIVE_IDS.has(spellId) || EXTERNAL_DEFENSIVE_IDS.has(spellId))
    return "Critical";

  const spell = SPELLS[spellId];
  if (!spell) return "Low";

  switch (spell.type) {
    case "cc":
    case "immunities":
      return "Critical";
    case "roots":
    case "immunities_spells":
    case "buffs_offensive":
    case "debuffs_offensive":
    case "buffs_defensive":
      return "High";
    case "buffs_other":
      return "Medium";
    default:
      return "Low";
  }
}

/**
 * Returns true if the given CC windows (sorted by start) cover every millisecond of [start, end].
 */
function isWindowFullyCovered(
  ccWindows: Array<{ from: number; to: number }>,
  start: number,
  end: number,
): boolean {
  const relevant = ccWindows.filter((w) => w.from <= end && w.to >= start);
  if (relevant.length === 0) return false;
  relevant.sort((a, b) => a.from - b.from);
  let covered = start;
  for (const w of relevant) {
    if (w.from > covered) return false; // gap — purger was free
    covered = Math.max(covered, w.to);
    if (covered >= end) return true;
  }
  return covered >= end;
}

// `buildCannotCastIntervals` (cast-blocking auras ∪ kick lockouts) moved to
// utils/cannotCastIntervals.ts on 2026-09-02 so healingGaps.ts consumes the
// same predicate (BACKLOG #38 (e)); the gate b+c semantics are unchanged.

export interface IHardCastOccupancy {
  /** ms of [windowStart, windowEnd] spent inside the unit's own hard casts */
  occupiedMs: number;
  /** true when a counted cast STARTED before the window opened — the player
   * was already committed when the thing-to-react-to happened ("couldn't"),
   * as opposed to starting a cast after it ("chose otherwise"). */
  startedBeforeWindow: boolean;
  /** spellName of every counted cast, in order (duplicates preserved) */
  spellNames: string[];
}

/**
 * #34(b2) 2026-08-23: how much of [windowStartMs, windowEndMs] the unit spent
 * committed to its OWN hard casts. buildCannotCastIntervals above models
 * "the enemy kept you from acting" (CC + kick lockouts); this models the
 * complementary "you had already committed your GCD yourself" — the two must
 * stay disjoint, so a cast interval is cut at the earliest of:
 *   (a) its spell's next CAST_SUCCESS (the cast completed),
 *   (b) any next CAST_START (you cannot channel two bars at once),
 *   (c) the start of a cannot-cast interval (the cast broke; from that
 *       instant the time belongs to buildCannotCastIntervals, not here).
 * A start with none of these observed (cancel with no signal / log end) is
 * dropped rather than guessed — this quantity is a lower bound; instants
 * never emit CAST_START and are invisible to it by design.
 *
 * Returns null when the parse carries no castStartEvents field (old
 * archives): "unknown", never "was idle" — tri-state iron rule.
 *
 * If a feasibility gate on this quantity is ever adopted (#34(b2) question
 * ②), it MUST consume this export — do not restate the predicate.
 */
/** Longest bar a player can be committed to (empowers and long hardcasts
 * are ≤ ~5 s at base; 12 s leaves room for pushback and slow-cast effects). */
const HARD_CAST_MAX_MS = 12_000;

export function hardCastOccupancyWithin(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  windowStartMs: number,
  windowEndMs: number,
  failedCasts?: ReadonlyArray<{ spellId: string; ms: number }>,
): IHardCastOccupancy | null {
  const bars = hardCastBarsWithin(
    unit,
    enemyIds,
    windowStartMs,
    windowEndMs,
    failedCasts,
  );
  if (bars === null) return null;
  const out: IHardCastOccupancy = {
    occupiedMs: 0,
    startedBeforeWindow: false,
    spellNames: [],
  };
  for (const b of bars) {
    out.occupiedMs +=
      Math.min(b.to, windowEndMs) - Math.max(b.from, windowStartMs);
    if (b.from < windowStartMs) out.startedBeforeWindow = true;
    out.spellNames.push(b.spellName);
  }
  return out;
}

/** One counted bar of `hardCastBarsWithin` (overlapping the window). */
export interface IOccupancyInterval {
  from: number;
  to: number;
  spellId: string;
  /** English (F-C17: the log's localized name leaked into the facts) */
  spellName: string;
}

/** `hardCastOccupancyWithin`'s bars, each as an interval; null when the unit
 *  carries no cast-start stream. */
function hardCastBarsWithin(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  windowStartMs: number,
  windowEndMs: number,
  /** Reliability audit A5 (2026-09-25): the unit's own SPELL_CAST_FAILED
   * (absolute ms, from the raw stream). A same-spell failure after a bar
   * started, with no same-spell success before the next bar, is that bar
   * being cancelled (moved, juked, interrupted) — 7c598eeb r0: Holy Fire
   * started 5.99 and failed "interrupted" at 6.19, yet the bar was counted
   * as running through the 9.18–14.78 Mind Control window ("you were mid
   * hard cast", preCommitted=yes). Absent = the pre-A5 cuts only. */
  failedCasts?: ReadonlyArray<{ spellId: string; ms: number }>,
): IOccupancyInterval[] | null {
  const starts = unit.castStartEvents;
  if (!Array.isArray(starts)) return null;
  if (windowEndMs <= windowStartMs || starts.length === 0) return [];
  const cutters = buildCannotCastIntervals(unit, enemyIds)
    .map((iv) => iv.from)
    .sort((a, b) => a - b);
  const sorted = [...starts].sort((a, b) => a.timestamp - b.timestamp);
  const successes = unit.spellCastEvents ?? [];
  const out: IOccupancyInterval[] = [];
  // A success already paired with an earlier bar is not this bar's success
  // (codex review 2026-09-26: 585 starts 1/3/5 s, successes 3/5/7 s — bar 2
  // must pair with 5 s, not re-read bar 1's 3 s).
  // A success already paired with an earlier bar is not this bar's success
  // (codex review 2026-09-26: 585 starts 1/3/5 s, successes 3/5/7 s — bar 2
  // must pair with 5 s, not re-read bar 1's 3 s). Tracked by event identity
  // (two different spells' successes can share a ms) and consumed only once
  // the success is established as THIS bar's end (a cancelled bar must not
  // eat the next bar's success).
  const consumed = new Set<object>();
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i].timestamp;
    if (from >= windowEndMs) break;
    // Reliability round 2 W2c (9d89 / 21cc / 539f): (a) a CAST_SUCCESS at the
    // bar's own ms is an instant (zero-length bar) — it must not fall through
    // to the next bar / window end and count as a long commit; (b) the success
    // lookup is bounded — a bar cancelled without a FAILED line must not be
    // paired with the same spell's success a minute later.
    const succ = successes.find(
      (e) =>
        e.spellId === sorted[i].spellId &&
        e.timestamp >= from &&
        e.timestamp - from <= HARD_CAST_MAX_MS &&
        !consumed.has(e),
    );
    if (succ !== undefined && succ.timestamp === from) {
      consumed.add(succ);
      continue;
    }
    const cut = cutters.find((c) => c > from);
    const nextStart = sorted[i + 1]?.timestamp;
    // A5: the bar's own cancel — a same-spell failure before the next bar,
    // when the spell did not also succeed before the next bar (a failure
    // followed by the success is a mid-cast spam press, not a cancel).
    const completedBeforeNext =
      succ !== undefined &&
      (nextStart === undefined || succ.timestamp <= nextStart);
    const cancel = completedBeforeNext
      ? undefined
      : failedCasts?.find(
          (f) =>
            f.spellId === String(sorted[i].spellId) &&
            f.ms > from &&
            (nextStart === undefined || f.ms <= nextStart),
        )?.ms;
    const ends = [succ?.timestamp, nextStart, cut, cancel].filter(
      (x): x is number => typeof x === "number" && x > from,
    );
    if (ends.length === 0) continue;
    const end = Math.min(...ends);
    // The success completed this bar only if nothing ended the bar first.
    if (succ !== undefined && succ.timestamp === end) consumed.add(succ);
    // Whatever supplies the end, a bar cannot run longer than a bar can: an
    // abandoned start whose only end is the next start a minute later is
    // unsupported and dropped (the lower-bound rule above).
    if (end - from > HARD_CAST_MAX_MS) continue;
    const overlap = Math.min(end, windowEndMs) - Math.max(from, windowStartMs);
    if (overlap <= 0) continue;
    out.push({
      from,
      to: end,
      spellId: String(sorted[i].spellId),
      spellName: getEnglishSpellName(
        String(sorted[i].spellId),
        sorted[i].spellName,
      ),
    });
  }
  return out;
}

/** What occupied a unit, for the acceptance split (F-C11). */
export type OccupancyKind = "hardcast" | "proxy" | "drink";

export interface IOccupancy extends IHardCastOccupancy {
  kinds: OccupancyKind[];
}

/** The unit's own self-aura intervals for `ids` (APPLIED → REMOVED, open
 *  ones closed at `openEndMs`). */
function selfAuraIntervals(
  unit: ICombatUnit,
  ids: ReadonlySet<string>,
  openEndMs: number,
): IOccupancyInterval[] {
  const out: IOccupancyInterval[] = [];
  const open = new Map<string, { from: number; name: string }>();
  for (const a of unit.auraEvents ?? []) {
    if (!a.spellId || !ids.has(a.spellId) || a.srcUnitId !== unit.id) continue;
    const ev = a.logLine.event;
    if (ev === LogEvent.SPELL_AURA_APPLIED && !open.has(a.spellId))
      open.set(a.spellId, { from: a.logLine.timestamp, name: a.spellName });
    else if (ev === LogEvent.SPELL_AURA_REMOVED) {
      const o = open.get(a.spellId);
      if (!o) continue;
      open.delete(a.spellId);
      out.push({
        from: o.from,
        to: a.logLine.timestamp,
        spellId: a.spellId,
        spellName: getEnglishSpellName(a.spellId, o.name),
      });
    }
  }
  for (const [id, o] of open)
    out.push({
      from: o.from,
      to: openEndMs,
      spellId: id,
      spellName: getEnglishSpellName(id, o.name),
    });
  return out;
}

/**
 * The one "was this player busy" predicate (triage missed-cleanse F-C11,
 * user ruling A43 = B, 2026-09-30) — the owner's `ownerCasting*` and a
 * teammate dispeller's `dispellerCasting*` both read it. The union of:
 *  - `hardCastOccupancyWithin`'s bars;
 *  - a channel the log shows only as the caster's self-aura
 *    (`CHANNEL_PROXY_IDS`, Ultimate Penitence 421453);
 *  - drinking (`DRINK_AURA_IDS`).
 * (Channels of `CHANNELED_SPELL_IDS` paired with their self-aura are
 * missed-cleanse F-C10's half — the G6 parser/compat session.)
 * occupiedMs is the union's overlap with the window; startedBeforeWindow is
 * true when any counted interval began before it. null = no cast-start
 * stream and no aura (unknown, not idle).
 */
export function occupancyWithin(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  windowStartMs: number,
  windowEndMs: number,
  failedCasts?: ReadonlyArray<{ spellId: string; ms: number }>,
): IOccupancy | null {
  const bars = hardCastBarsWithin(
    unit,
    enemyIds,
    windowStartMs,
    windowEndMs,
    failedCasts,
  );
  if (bars === null && !Array.isArray(unit.auraEvents)) return null;
  const tagged: Array<IOccupancyInterval & { kind: OccupancyKind }> = [
    ...(bars ?? []).map((b) => ({ ...b, kind: "hardcast" as const })),
    ...selfAuraIntervals(unit, CHANNEL_PROXY_IDS, windowEndMs).map((b) => ({
      ...b,
      kind: "proxy" as const,
    })),
    ...selfAuraIntervals(unit, DRINK_AURA_IDS, windowEndMs).map((b) => ({
      ...b,
      kind: "drink" as const,
    })),
  ]
    .filter(
      (b) => b.to > windowStartMs && b.from < windowEndMs && b.to > b.from,
    )
    .sort((a, b) => a.from - b.from);
  const out: IOccupancy = {
    occupiedMs: 0,
    startedBeforeWindow: false,
    spellNames: [],
    kinds: [],
  };
  let curFrom = -Infinity;
  let curTo = -Infinity;
  for (const b of tagged) {
    const from = Math.max(b.from, windowStartMs);
    const to = Math.min(b.to, windowEndMs);
    if (from > curTo) {
      if (curTo > curFrom) out.occupiedMs += curTo - curFrom;
      curFrom = from;
      curTo = to;
    } else curTo = Math.max(curTo, to);
    if (b.from < windowStartMs) out.startedBeforeWindow = true;
    out.spellNames.push(b.spellName);
    if (!out.kinds.includes(b.kind)) out.kinds.push(b.kind);
  }
  if (curTo > curFrom) out.occupiedMs += curTo - curFrom;
  return out;
}

/**
 * Returns true if the unit was unable to cast (cast-blocking aura or kick
 * lockout — see buildCannotCastIntervals) for the ENTIRETY of
 * [windowStartMs, windowEndMs].
 */
function isPurgerFullyBlockedDuringWindow(
  purger: ICombatUnit,
  windowStartMs: number,
  windowEndMs: number,
  enemyIds: Set<string>,
): boolean {
  return isWindowFullyCovered(
    buildCannotCastIntervals(purger, enemyIds),
    windowStartMs,
    windowEndMs,
  );
}

/** Milliseconds within [start, end] covered by the union of the intervals. */
function coveredMsWithin(
  intervals: Array<{ from: number; to: number }>,
  start: number,
  end: number,
): number {
  const clipped = intervals
    .map((w) => ({ from: Math.max(w.from, start), to: Math.min(w.to, end) }))
    .filter((w) => w.to > w.from)
    .sort((a, b) => a.from - b.from);
  let covered = 0;
  let cursor = start;
  for (const w of clipped) {
    if (w.to <= cursor) continue;
    covered += w.to - Math.max(w.from, cursor);
    cursor = Math.max(cursor, w.to);
  }
  return covered;
}

/**
 * Feasibility gate b+c: over [startMs, endMs], the time during which ALL
 * dispellers are simultaneously unable to cast (the intersection of their
 * individual cannot-cast intervals) leaves less than freeThresholdMs of free
 * time. If any one dispeller is free at an instant, that instant does not
 * count — intersection semantics.
 */
function dispellersLockedOutForWindow(
  dispellers: ICombatUnit[],
  startMs: number,
  endMs: number,
  enemyIds: Set<string>,
  freeThresholdMs: number,
): boolean {
  if (dispellers.length === 0 || endMs <= startMs) return false;
  // The intersection is "everyone locked" millisecond by millisecond, which is
  // the window minus the time "at least one is free". Numerically: free time =
  // window length - intersection coverage. Build it as a per-unit union, then
  // intersect the unions.
  let intersection: Array<{ from: number; to: number }> | null = null;
  for (const d of dispellers) {
    const merged = mergeIntervals(buildCannotCastIntervals(d, enemyIds));
    intersection =
      intersection === null
        ? merged
        : intersectIntervalSets(intersection, merged);
    if (intersection.length === 0) return false; // someone was free throughout
  }
  const blockedMs = coveredMsWithin(intersection ?? [], startMs, endMs);
  const freeMs = endMs - startMs - blockedMs;
  return freeMs < freeThresholdMs;
}

/** The units still alive at `ms` (no death record at or before it). */
function aliveAt(units: ICombatUnit[], ms: number): ICombatUnit[] {
  return units.filter(
    (u) => !(u.deathRecords ?? []).some((d) => d.timestamp <= ms),
  );
}

function mergeIntervals(
  intervals: Array<{ from: number; to: number }>,
): Array<{ from: number; to: number }> {
  const sorted = [...intervals].sort((a, b) => a.from - b.from);
  const out: Array<{ from: number; to: number }> = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to);
    else out.push({ ...w });
  }
  return out;
}

function intersectIntervalSets(
  a: Array<{ from: number; to: number }>,
  b: Array<{ from: number; to: number }>,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const from = Math.max(a[i].from, b[j].from);
    const to = Math.min(a[i].to, b[j].to);
    if (to > from) out.push({ from, to });
    if (a[i].to < b[j].to) i++;
    else j++;
  }
  return out;
}

/**
 * Feasibility gate a (tri-state): sample the reaction window
 * [applyTs, applyTs+reactMs] on the whole-second grid. If at any second some
 * dispeller and the target both have a position, are within that
 * dispeller's `reachOf` (its dispel spell's range, talents included), and LoS is not false (no geometry → null → judge on
 * range alone) → true (reachable, the criticism stands). If the full sweep
 * yields samples but never a reachable pair → false (exempt). If no sample
 * pair exists at all → null (do not change the verdict; the tri-state rule —
 * see the losAnalysis / ccTrinketAnalysis precedents).
 */
export function anyDispellerReachable(
  dispellers: ICombatUnit[],
  target: ICombatUnit,
  applyTs: number,
  reactMs: number,
  zoneId: string | undefined,
  /** this dispeller's reach for the removal in question (GH #83) */
  reachOf: (dispeller: ICombatUnit) => number,
  /** the round's start (absolute ms) — the render grid is round-relative */
  matchStartMs: number,
): boolean | null {
  if (dispellers.length === 0) return null;
  const t0 = dispelReachSweepStartMs(applyTs, matchStartMs);
  let sawSamplePair = false;
  for (let t = t0; t <= applyTs + reactMs; t += 1000) {
    const targetPos = getUnitPositionAtTime(target, t, LOS_SWEEP_GAP_MS);
    if (!targetPos) continue;
    for (const d of dispellers) {
      const dPos = getUnitPositionAtTime(d, t, LOS_SWEEP_GAP_MS);
      if (!dPos) continue;
      sawSamplePair = true;
      if (distanceBetween(dPos, targetPos) > reachOf(d)) continue;
      // LoS is topological — it reads the nearest RAW samples, never the
      // interpolated point (`losAnalysis` contract; codex review of F-C9: an
      // interpolated position between two in-LoS samples can sit inside a
      // pillar and wrongly exempt the window). Distance keeps interpolating.
      // No raw sample in reach of this second = LoS not disproven.
      const dRaw = zoneId
        ? getUnitRawPositionAtTime(d, t, LOS_SWEEP_GAP_MS)
        : null;
      const targetRaw = zoneId
        ? getUnitRawPositionAtTime(target, t, LOS_SWEEP_GAP_MS)
        : null;
      const los =
        zoneId && dRaw && targetRaw
          ? hasLineOfSight(zoneId, dRaw, targetRaw)
          : null;
      if (los !== false) return true; // in range and LoS not disproven
    }
  }
  return sawSamplePair ? false : null;
}

/**
 * First instant of the reach sweep (user ruling A42 = A, 2026-09-30; triage
 * missed-cleanse F-C8): the round-relative whole second `start + k·1000`,
 * from ceil(applyRel) — never a sample before the CC landed. Flooring the
 * ABSOLUTE epoch ms put the grid at "second + the match's ms remainder" and
 * could sample before the debuff (95127ab4: 45.317 for a fear at 45.793).
 */
export function dispelReachSweepStartMs(
  applyTs: number,
  matchStartMs: number,
): number {
  return matchStartMs + Math.ceil((applyTs - matchStartMs) / 1000) * 1000;
}

/** Look-ahead window (seconds) for value gate d's re-CC check: only if the
 * target eats another CC of the same DR category within this long after the
 * missed-cleanse window ends does it count as evidence that "dispelling would
 * have traded into a chain" (an observed chain, not a guess). Corpus: 22.6% of
 * candidates hit (Dragon's Breath 46.7%). */
export const DR_CHAIN_LOOKAHEAD_S = 10;

/**
 * Value gate d: at applyTs the target's DR category for this CC was **fully
 * fresh** (getDRLevelAtTime is the single source; do not write a second copy
 * of the chain-level math), AND within DR_CHAIN_LOOKAHEAD_S after the window
 * ended the enemy applied another CC of the same category. When both hold,
 * dispelling this window could have traded into a full-duration chain, so the
 * coach should advise cautiously rather than blame.
 */
/**
 * DR level of THIS CC application (Full / 50% / Immune) — the 裁定册's
 * `afterDR` axis. Same single-source machinery as `computeDrChainRisk` right
 * below: buildCcCategoryHistory + getDRLevelAtTime, never a second copy of
 * the chain math. Root-category ids fall back to self-DR (`spell:<id>`)
 * because of #24's ruling, but every signed root row has `afterDR: null`, so
 * the gate never consults this for them.
 */
function drLevelAtApply(
  target: ICombatUnit,
  ccSpellId: string,
  applyTs: number,
  enemyIds: Set<string>,
  matchStartMs: number,
): "Full" | "50%" | "25%" | "Immune" {
  const category = getDRCategory(ccSpellId);
  const instances = buildCcCategoryHistory(
    target,
    category,
    enemyIds,
    matchStartMs,
  );
  return getDRLevelAtTime(
    instances,
    category,
    (applyTs - matchStartMs) / 1000,
    matchStartMs,
  );
}

export function computeDrChainRisk(
  target: ICombatUnit,
  ccSpellId: string,
  applyTs: number,
  windowEndTs: number,
  enemyIds: Set<string>,
  matchStartMs: number,
): boolean {
  // Triage missed-cleanse F-C16: an id no DR family claims (a curse) falls
  // back to `spell:<id>` self-DR, and a curse re-applied 0.08 s after its
  // dispel then read "DR was fresh and the enemy re-CC'd right after"
  // (9d899d10 Curse of Tongues). Only roots keep that self-DR (#24 ruling).
  // (`getDRCategory` never returns empty, so the old `!category` test was
  // dead.)
  if (!(ccSpellId in DR_CATEGORY_MAP) && !ROOT_SPELL_IDS.has(ccSpellId))
    return false;
  const category = getDRCategory(ccSpellId);

  // Single source for instance history: buildCcCategoryHistory (drAnalysis) —
  // it shares the same pairing logic ccBreakAnalysis uses for remaining-
  // duration math. Two separate copies would be a breeding ground for drift.
  const instances = buildCcCategoryHistory(
    target,
    category,
    enemyIds,
    matchStartMs,
  );
  const level = getDRLevelAtTime(
    instances,
    category,
    (applyTs - matchStartMs) / 1000,
    matchStartMs,
  );
  if (level !== "Full") return false;

  // Re-CC evidence: within the lookahead after the window ends, an enemy
  // applies another CC of the same category to the target (we look at the
  // apply event itself; a successful later pairing is not required).
  return target.auraEvents.some(
    (aura) =>
      aura.spellId !== null &&
      enemyIds.has(aura.srcUnitId) &&
      aura.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
      getDRCategory(aura.spellId) === category &&
      aura.timestamp > windowEndTs &&
      aura.timestamp <= windowEndTs + DR_CHAIN_LOOKAHEAD_S * 1000,
  );
}

export function getFatalDeath(
  unit: ICombatUnit,
  dispelTimestamp: number,
): { name: string; spec: string } | null {
  const fatalDeath = (unit.deathRecords ?? []).find(
    (d) =>
      d.timestamp >= dispelTimestamp && d.timestamp <= dispelTimestamp + 4000,
  );
  if (fatalDeath) {
    return { name: unit.name, spec: specToString(unit.spec) };
  }
  return null;
}

/**
 * Checks if a specific CC/debuff removal was due to a friendly dispel.
 *
 * NOTE: Short CC that is neither dispelled nor broken by damage counts as nothing.
 * Previously, any short CC was misclassified as a cleanse.
 */
export function wasRemovedByAllyDispel(
  allyCleanse: IDispelEvent[],
  spellId: string,
  targetName: string,
  removalSeconds: number,
): boolean {
  // B11: the original < 0.5s proximity window was too loose (mismatched distinct events).
  // SPELL_DISPEL and SPELL_AURA_REMOVED usually share the same millisecond, but ~5% of real
  // pairs have a 1ms skew, so a strict equality (< 0.001) false-flags those as missed cleanses.
  // A 50ms window tolerates log skew while still being far tighter than a distinct re-cast.
  // Match is further constrained by removedSpellId + targetName, so cross-debuff collisions
  // within 50ms are not a concern.
  // Reliability audit D1 (2026-09-25): a `rider` removal (a form shift, a
  // movement ability — dispelKind.ts) is not a cleanse. a9bc48b5 @2:51: Tree of
  // Life expiring broke Entangling Roots, logged as SPELL_DISPEL, and the prompt
  // said "[CLEANSE] … (Incarnation: Tree of Life)" and "cleansed 4 s late".
  // Procs (Cleanse the Weak) still count: the debuff really was stripped by a
  // dispel. Same predicate the desktop dispel dash already uses.
  return allyCleanse.some(
    (d) =>
      d.dispelKind !== "rider" &&
      d.removedSpellId === spellId &&
      d.targetName === targetName &&
      Math.abs(d.timeSeconds - removalSeconds) <= ALLY_DISPEL_MATCH_TOLERANCE_S,
  );
}

/** The 50 ms SPELL_DISPEL ↔ SPELL_AURA_REMOVED pairing tolerance (see B11
 * above), shared by both removal matchers. */
const ALLY_DISPEL_MATCH_TOLERANCE_S = 0.05;

/**
 * One cleanse press removing several debuffs logs one SPELL_DISPEL per
 * removal at the same instant — `allyCleanse` then holds that press several
 * times. A cooldown / charge replay must count PRESSES (triage
 * missed-cleanse F-B2, codex review: a two-charge Purify taking two debuffs
 * at t = 10 read as both charges spent). Removal times within the dispel
 * pairing tolerance of the previous kept one are the same press.
 */
export function distinctDispelPressSeconds(times: readonly number[]): number[] {
  const out: number[] = [];
  for (const t of [...times].sort((a, b) => a - b))
    if (!out.length || t - out[out.length - 1]! > ALLY_DISPEL_MATCH_TOLERANCE_S)
      out.push(t);
  return out;
}

/** Did the debuffed unit free ITSELF with a rider (its own form shift /
 * movement ability, or a form expiring) at this removal? User ruling
 * 2026-09-24 (reliability audit D1): 「自己变形解掉的，当然不算」 — such a
 * window is not a cleanse window at all. */
export function wasRemovedBySelfRider(
  allyCleanse: IDispelEvent[],
  spellId: string,
  targetName: string,
  removalSeconds: number,
): boolean {
  return allyCleanse.some(
    (d) =>
      d.dispelKind === "rider" &&
      d.sourceName === targetName &&
      d.removedSpellId === spellId &&
      d.targetName === targetName &&
      Math.abs(d.timeSeconds - removalSeconds) <= ALLY_DISPEL_MATCH_TOLERANCE_S,
  );
}

/**
 * Exemption-context suffix for the [UNCLEANSED DEBUFF] timeline line.
 * cleanseWasOnCD used to be rendered only on the single "worst" entry of the
 * DISPEL SUMMARY; the findings model reads mostly the timeline, where it saw a
 * missed cleanse with no exemption context and went on blaming the healer.
 * (Windows where every dispeller was CC'd throughout are skipped at the
 * source and never reach here — no annotation needed.)
 */
export function formatMissedCleanseExemption(
  w: Pick<
    IMissedCleanseWindow,
    | "cleanseWasOnCD"
    | "cdBurnedOn"
    | "dispellersLockedOut"
    | "losReachable"
    | "drChainRisk"
  >,
): string {
  let out = "";
  if (w.cleanseWasOnCD) {
    const burned = w.cdBurnedOn
      ? ` (used on ${w.cdBurnedOn.spellName} ${w.cdBurnedOn.secondsBefore.toFixed(1)}s before)`
      : "";
    out += ` | cleanse was ON CD${burned}`;
  }
  // Feasibility gates (2026-08-02): infeasible windows are still rendered (the
  // fact layer hides nothing), but carry explicit exemption context so the
  // model stops calling an impossible dispel a mistake.
  if (w.dispellersLockedOut)
    out +=
      " | dispellers were CC'd/locked out for most of this — not actionable";
  if (w.losReachable === false)
    out += " | no dispeller had range/line of sight — not actionable";
  if (w.drChainRisk)
    out +=
      " | target's DR was fresh and the enemy re-CC'd right after — a dispel here likely trades into a full-duration chain; advise cautiously, not as a mistake";
  return out;
}

/** Feasibility-exemption suffix for the [MISSED PURGE OPPORTUNITY] line (same
 *  treatment as the cleanse side). */
export function formatMissedPurgeExemption(
  w: Pick<
    IMissedPurgeWindow,
    | "purgersLockedOut"
    | "losReachable"
    | "purgeReadyAtSeconds"
    | "timeSeconds"
    | "durationSeconds"
    | "viaScopedTool"
  >,
): string {
  let out = "";
  // P-P5b = C: the owner's removal for this buff is a scoped one — name it,
  // the facts after it are that tool's cooldown and reach
  if (w.viaScopedTool)
    out += ` | your removal for it: ${w.viaScopedTool.name} (${w.viaScopedTool.note})`;
  if (w.purgersLockedOut)
    out += " | purgers were CC'd/locked out — not actionable";
  if (w.losReachable === false)
    out += " | no purger had range/line of sight — not actionable";
  // F-P7 (codex r2 09-30): say WHEN the purge came back — "on cooldown at
  // application" alone hides 9 s of a buff that was purgeable after.
  if (w.purgeReadyAtSeconds !== undefined) {
    const left = w.timeSeconds + w.durationSeconds - w.purgeReadyAtSeconds;
    out +=
      left < MISSED_PURGE_THRESHOLD_S + (w.viaScopedTool?.castSeconds ?? 0)
        ? ` | purge on cooldown for the whole buff (ready ${fmtTime(w.purgeReadyAtSeconds)}) — not actionable`
        : ` | purge on cooldown at application — ready at ${fmtTime(w.purgeReadyAtSeconds)} (${Math.round(left)}s of the buff left)`;
  }
  return out;
}

export function reconstructDispelSummary(
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  // zoneId lets feasibility gate a look up arena geometry (LoS); omit it and
  // the gate judges on range alone (still tri-state). The legacy match carries
  // it under startInfo (triage missed-cleanse F-C9: every caller passed the
  // legacy match, so LoS was never evaluated).
  combat: {
    startTime: number;
    endTime: number;
    zoneId?: string;
    startInfo?: { zoneId?: string };
  },
  // B45: friendly pet/guardian units whose dispels should be attributed to their owner player
  friendlyPets: ICombatUnit[] = [],
  // Coverage tail fix: dispels by enemy pets (Felhunter Devour Magic etc.)
  // previously landed in no bucket at all, leaving hostilePurges blind to pet
  // purges — completed symmetrically with friendlyPets.
  enemyPets: ICombatUnit[] = [],
): IDispelSummary {
  const zoneId = combat.zoneId ?? combat.startInfo?.zoneId;
  const friendlyIds = new Set(friends.map((u) => u.id));
  const enemyIds = new Set(enemies.map((u) => u.id));
  // B45: pets are also considered friendly sources; owner lookup is via ownerId
  const friendlyPetIds = new Set(friendlyPets.map((u) => u.id));
  const enemyPetIds = new Set(enemyPets.map((u) => u.id));
  // "dispeller / purger was locked out" reads the one cannot-cast predicate
  // with pets and totems as sources (a Felhunter's Spell Lock locks as hard
  // as a Kick; triage 2026-09-29 H23) — `enemyIds` stays players-only for its
  // other readers here (DR history, aura attribution).
  const cannotCastSrcIds = new Set([...enemyIds, ...enemyPetIds]);
  const friendlyPlayerById = new Map(friends.map((u) => [u.id, u]));
  const enemyPlayerById = new Map(enemies.map((u) => [u.id, u]));
  const teamDispelTypes = buildTeamDispelTypes(friends);
  const teamDispelCapability = buildTeamDispelCapability(friends);
  // Reliability round 2 W1d (2026-09-25): a charmed teammate (Mind Control)
  // is hostile for the duration — a friendly Cleanse cannot touch anything
  // on them; only an offensive purge can, and only Magic (a5a8d31b: "your
  // Cleanse was available" on a Mind-Controlled rogue, a team with no
  // purge). Everything else keeps the defensive-cleanse capability.
  const friendlyPurgers = friends.filter((f) => canOffensivePurge(f));
  const capableFor = (
    type: DispelType,
    target: ICombatUnit,
    fromMs: number,
    toMs: number,
  ): { units: ICombatUnit[]; charmed: boolean } =>
    // charmed for all but < MISSED_CLEANSE_THRESHOLD_S of the window — the
    // same reaction floor the dispellers-locked-out gate uses
    charmedThrough(target, fromMs, toMs, MISSED_CLEANSE_THRESHOLD_S * 1000)
      ? {
          units:
            type === "Magic"
              ? friendlyPurgers.filter((u) => u.id !== target.id)
              : [],
          charmed: true,
        }
      : { units: teamDispelCapability.get(type) ?? [], charmed: false };
  const unitMap = new Map<string, ICombatUnit>(
    [...friends, ...enemies, ...friendlyPets, ...enemyPets].map((u) => [
      u.id,
      u,
    ]),
  );

  const allyCleanse: IDispelEvent[] = [];
  const ourPurges: IDispelEvent[] = [];
  const hostilePurges: IDispelEvent[] = [];

  // Cast index keyed on the RAW source GUID of each cast (pets index their
  // own casts — see dispelKind.ts). Built once per call over every unit.
  const castIndex = buildCastMatchIndex(unitMap.values());

  for (const unit of [...friends, ...friendlyPets, ...enemies, ...enemyPets]) {
    const isPetUnit = friendlyPetIds.has(unit.id) || enemyPetIds.has(unit.id);
    // For pet units, attribute the dispel to the owner player (if known)
    const ownerPlayer = friendlyPetIds.has(unit.id)
      ? friendlyPlayerById.get(unit.ownerId)
      : enemyPetIds.has(unit.id)
        ? enemyPlayerById.get(unit.ownerId)
        : undefined;

    for (const action of unit.actionOut) {
      const isDispel = action.logLine.event === LogEvent.SPELL_DISPEL;
      const isSteal = action.logLine.event === LogEvent.SPELL_STOLEN;
      if (!isDispel && !isSteal) continue;
      // In the old parser CombatExtraSpellAction was a class; compat expresses
      // the same check via presence of the field
      if (action.extraSpellId === undefined) continue;

      const removedSpellId = action.extraSpellId;
      if (!removedSpellId) continue;

      const priority = getPriority(removedSpellId);
      const destUnit = unitMap.get(action.destUnitId);

      // Treat a pet owned by a friendly player as a friendly source
      // Pets passed via friendlyPets are always friendly — we already filtered them by reaction
      const srcFriendly =
        friendlyIds.has(unit.id) || friendlyPetIds.has(unit.id);
      const srcEnemy = enemyIds.has(unit.id) || enemyPetIds.has(unit.id);
      const destFriendly = friendlyIds.has(action.destUnitId);
      const destEnemy = enemyIds.has(action.destUnitId);

      // The removed debuff's caster sits on the opposite team of the unit it
      // was removed from (pet dests — neither set — get no Stellar attribution).
      const casterTeam = destFriendly ? enemies : destEnemy ? friends : [];
      const penaltyDesc = getDispelPenalty(
        removedSpellId,
        teamHasBalanceDruid(casterTeam),
        action.timestamp,
      );

      // B45: pet dispels are attributed to the owner player; source name shows the player
      // so Claude sees "[CLEANSE] Warlock dispelled X (pet)" rather than "[CLEANSE] Imp dispelled X"
      const sourceName = ownerPlayer ? ownerPlayer.name : unit.name;
      const sourceSpec = ownerPlayer
        ? specToString(ownerPlayer.spec)
        : specToString(unit.spec);

      const event: IDispelEvent = {
        timeSeconds: (action.timestamp - combat.startTime) / 1000,
        dispelSpellId: action.spellId ?? "",
        dispelSpellName: getEnglishSpellName(
          action.spellId ?? "",
          action.spellName,
        ),
        removedSpellId,
        removedSpellName: getEnglishSpellName(
          removedSpellId,
          action.extraSpellName,
        ),
        sourceName,
        sourceSpec,
        targetName: action.destUnitName,
        targetSpec: destUnit ? specToString(destUnit.spec) : "Unknown",
        priority,
        hasDispelPenalty: penaltyDesc !== undefined,
        penaltyDescription: penaltyDesc,
        isSpellSteal: isSteal,
        // B45: pet unit actions are always pet dispels; player actions only when srcUnit ≠ player
        isPetDispel: isPetUnit || action.srcUnitId !== unit.id,
        dispelKind: classifyDispel(castIndex, {
          srcUnitId: action.srcUnitId,
          spellId: action.spellId,
          spellName: action.spellName,
          timestamp: action.timestamp,
        }),
        wasFatal: false,
      };

      const targetUnitForPenalty = ownerPlayer ?? unit;

      if (penaltyDesc !== undefined) {
        const fatalDeath = getFatalDeath(
          targetUnitForPenalty,
          action.timestamp,
        );
        if (fatalDeath) {
          event.wasFatal = true;
          event.fatalUnitName = fatalDeath.name;
          event.fatalUnitSpec = fatalDeath.spec;
        }

        const backlashInfo = BACKLASH_CC_SPELL_IDS.get(removedSpellId);
        if (backlashInfo) {
          const match = (targetUnitForPenalty.auraEvents ?? []).find(
            (aura) =>
              aura.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
              aura.spellId === backlashInfo.backlashSpellId &&
              aura.timestamp >= action.timestamp &&
              aura.timestamp <= action.timestamp + 100,
          );
          if (match) {
            event.backlashCcSpellId = match.spellId ?? undefined;
          }
        }
      }

      if (srcFriendly && destFriendly) {
        // We cleansed a debuff off our ally
        if (penaltyDesc !== undefined) {
          // Measure backlash: damage to the dispeller in the window before and after
          const ts = action.timestamp;
          event.penaltyDamageTaken = targetUnitForPenalty.damageIn
            .filter(
              (d) =>
                d.logLine.timestamp >= ts &&
                d.logLine.timestamp <= ts + PENALTY_WINDOW_MS,
            )
            .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
          event.penaltyDamageBaseline = targetUnitForPenalty.damageIn
            .filter(
              (d) =>
                d.logLine.timestamp >= ts - PENALTY_WINDOW_MS &&
                d.logLine.timestamp < ts,
            )
            .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
        }
        allyCleanse.push(event);
      } else if (srcFriendly && destEnemy) {
        // We purged / spell-stole a buff off an enemy
        ourPurges.push(event);
      } else if (srcEnemy && destFriendly) {
        // Enemy stripped a buff off us
        hostilePurges.push(event);
      }
    }
  }

  allyCleanse.sort((a, b) => a.timeSeconds - b.timeSeconds);
  ourPurges.sort((a, b) => a.timeSeconds - b.timeSeconds);
  hostilePurges.sort((a, b) => a.timeSeconds - b.timeSeconds);

  // Missed cleanse detection: Critical/High CC on friendly by enemy lasting > threshold without dispel.
  // SPELL_AURA_BROKEN_SPELL = broke from incoming damage (not a missed cleanse, the CC ended by other means).
  const missedCleanseWindows: IMissedCleanseWindow[] = [];
  // DISPEL-002 (2026-08-06, signal-expansion batch 1): populated inside the
  // same loop below, in the `removedByDispel` branch — see IDispelSummary's
  // doc comment for why this is a separate array from missedCleanseWindows.
  const lateCleanseWindows: IMissedCleanseWindow[] = [];

  // Efficiency tracking: per friendly unit, count CC windows and cleansed/missed
  const efficiencyMap = new Map<
    string,
    {
      targetName: string;
      targetSpec: string;
      totalCCWindows: number;
      cleanseCount: number;
      missedCount: number;
      brokenCount: number;
    }
  >();

  for (const unit of friends) {
    // 裁定册的目标角色轴(治疗/近战/远程)—— 与裁定网页同一划分。
    const role: "healer" | "melee" | "ranged" = isHealerSpec(unit.spec)
      ? "healer"
      : isMeleeSpec(unit.spec)
        ? "melee"
        : "ranged";
    const appliedTimes = new Map<string, { ts: number; spellName: string }[]>();
    const removedTimes = new Map<
      string,
      { ts: number; brokenByDamage: boolean }[]
    >();

    for (const aura of unit.auraEvents) {
      const spellId = aura.spellId;
      if (!spellId) continue;

      // Only CC applied by enemies
      if (!enemyIds.has(aura.srcUnitId)) continue;

      // B11 fix: skip BUFF auras. When a friendly Mage spellsteals an enemy buff (e.g.
      // Blessing of Freedom 1044), the resulting SPELL_AURA_APPLIED on the Mage carries
      // the original enemy as srcUnit — but the aura is a BUFF on our side, not a debuff
      // the healer should cleanse. Without this filter the loop fabricates a missed
      // cleanse window for every spellsteal.
      const auraType = getAuraType(aura);
      if (auraType !== null && auraType !== "DEBUFF") continue;

      // ── 裁定册接线(2026-08-19 签字,GH #20 第 2 层)────────────────────
      // 签字行以裁定册为准,替代手工 Critical/High 优先级;未签字的 id 走
      // 旧门不变。此门在收集层生效,所以 skip/退出行连 lateCleanseWindows
      // 和 CC 效率统计也一并不进 —— 「不值得驱」的东西,驱晚了同样不构成
      // 批评。三类拦截:
      //   exitCandidate    点燃/风领主之击 —— 伤害类随「DoT 暂不收」退出
      //   skip             该角色格签了不驱(如 定身×远程、语言诅咒×近战)
      //   self-impossible  硬控×治疗自身 —— 被硬控的治疗不能施法,自驱
      //                    物理上不可能;这是运行时唯一驱散者豁免的静态
      //                    声明,两者相互印证
      const verdict = dispelVerdictOf(spellId);
      if (verdict !== null) {
        if (verdict.exitCandidate === true) continue;
        const roleCell =
          role === "healer"
            ? verdict.healer
            : role === "melee"
              ? verdict.melee
              : verdict.ranged;
        if (roleCell === "skip" || roleCell === "self-impossible") continue;
      } else {
        const priority = getPriority(spellId);
        if (priority !== "Critical" && priority !== "High") continue;
      }

      // The backlash exemption must be a predicate, not a side effect of a data
      // gap: dispelling UA/VT silences and damages the dispeller, so NOT
      // dispelling is the correct play and can never count as a missed cleanse.
      // Until 2026-08-18 the UA/VT rows simply happened to have no entry in
      // spellEffectData — one data refresh and this would have blown up.
      // Stellar Protection tier (12.1): here the aura's caster is known
      // precisely, so gate on that unit's spec rather than team composition.
      const casterIsBalance =
        enemyPlayerById.get(aura.srcUnitId)?.spec ===
        CombatUnitSpec.Druid_Balance;
      if (getDispelPenalty(spellId, casterIsBalance, aura.timestamp)) continue;

      // Skip spells that cannot be dispelled (DispelType=None in game data)
      const dispelType = getDispelType(spellId);
      if (!dispelType) continue;

      // Only flag if the team has someone capable of removing this debuff type
      if (!teamDispelTypes.has(dispelType)) continue;

      if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
        const bucket = appliedTimes.get(spellId) ?? [];
        appliedTimes.set(spellId, [
          ...bucket,
          {
            ts: aura.timestamp,
            spellName: getEnglishSpellName(spellId, aura.spellName),
          },
        ]);
      } else if (
        aura.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
        aura.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
        aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
      ) {
        const brokenByDamage =
          aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL;
        const bucket = removedTimes.get(spellId) ?? [];
        removedTimes.set(spellId, [
          ...bucket,
          { ts: aura.timestamp, brokenByDamage },
        ]);
      }
    }

    // Ensure efficiency entry exists for this unit
    const effKey = unit.id;
    if (!efficiencyMap.has(effKey)) {
      efficiencyMap.set(effKey, {
        targetName: unit.name,
        targetSpec: specToString(unit.spec),
        totalCCWindows: 0,
        cleanseCount: 0,
        missedCount: 0,
        brokenCount: 0,
      });
    }
    const eff = efficiencyMap.get(effKey);
    if (!eff) continue;

    for (const [spellId, applications] of appliedTimes) {
      const priority = getPriority(spellId);
      const removals = removedTimes.get(spellId) ?? [];

      for (const { ts: applyTs, spellName } of applications) {
        const removal = removals.find((r) => r.ts >= applyTs);
        if (!removal) continue;

        const durationSeconds = (removal.ts - applyTs) / 1000;

        // D1: freed by its own rider (form shift / form expiry) → not a
        // cleanse window at all (user ruling 2026-09-24).
        if (
          wasRemovedBySelfRider(
            allyCleanse,
            spellId,
            unit.name,
            (removal.ts - combat.startTime) / 1000,
          )
        )
          continue;
        // Was removed by a friendly dispel near that removal time?
        const removedByDispel = wasRemovedByAllyDispel(
          allyCleanse,
          spellId,
          unit.name,
          (removal.ts - combat.startTime) / 1000,
        );

        // CC broke from incoming damage — not a missed cleanse, but not a healer cleanse either
        if (removal.brokenByDamage) {
          eff.totalCCWindows++;
          eff.brokenCount++;
          continue;
        }

        if (removedByDispel) {
          eff.totalCCWindows++;
          eff.cleanseCount++;
          // DISPEL-002 upgrade (2026-08-06, signal-expansion batch 1,
          // design: docs/superpowers/specs/2026-08-07-signal-expansion-batch1-design.md):
          // a cleanse DID land here, but reaction latency is itself a
          // coaching signal distinct from "never cleansed" — a 200-match
          // empirical scan found 69 late (>=3s) dispels against 903 prompt
          // ones (7.1% of dispels that landed), too thin a slice to earn a
          // whole new candidate type, so it rides the missed-cleanse window
          // shape (via the sibling lateCleanseWindows array) with an added
          // lateDispelSeconds fact instead. Every gate below is trivially
          // decidable here — a dispel demonstrably connected, so nobody was
          // fully locked out and someone was in reach — stronger ground
          // truth than the "never cleansed" branch's geometric estimate.
          if (durationSeconds >= MISSED_CLEANSE_THRESHOLD_S) {
            // 裁定册递减门 + 时机门,与 missed 分支同判据(生效档位 skip →
            // 不进 lateCleanse;situational 且整窗威胁覆盖 → 同样不进 ——
            // 承压期驱一个 situational 的东西驱晚了,不构成批评)。放在
            // cleanseCount++ 之后:驱散确实发生了,效率统计照记,只有
            // 「批评窗口」被拦。
            const lateVerdict = dispelVerdictOf(spellId);
            let lateCell: DispelWorth | HealerCell | undefined;
            if (lateVerdict !== null) {
              let lateWorth: DispelWorth | HealerCell =
                role === "healer"
                  ? lateVerdict.healer
                  : role === "melee"
                    ? lateVerdict.melee
                    : lateVerdict.ranged;
              if (
                lateVerdict.afterDR !== null &&
                drLevelAtApply(
                  unit,
                  spellId,
                  applyTs,
                  enemyIds,
                  combat.startTime,
                ) !== "Full"
              ) {
                lateWorth = lateVerdict.afterDR;
              }
              if (lateWorth === "skip") continue;
              lateCell = lateWorth;
              {
                const fromS = Math.floor((applyTs - combat.startTime) / 1000);
                const toS = Math.floor((removal.ts - combat.startTime) / 1000);
                let hadCalmSecond = false;
                for (let t = fromS; t <= toS; t++) {
                  if (!threatActiveAt(t, enemies, friends, combat)) {
                    hadCalmSecond = true;
                    break;
                  }
                }
                if (!hadCalmSecond) continue;
              }
            }
            const windowDispelType = getDispelType(spellId) as DispelType;
            const windowEndMs = applyTs + POST_CC_PRESSURE_WINDOW_S * 1000;
            const postCcDamage = unit.damageIn
              .filter(
                (d) =>
                  d.logLine.timestamp >= applyTs &&
                  d.logLine.timestamp <= windowEndMs,
              )
              .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
            const lateDied = targetDiedAround(unit, applyTs, removal.ts);
            const lateGate = consequenceGatedPriority(
              priority,
              postCcDamage,
              lateDied,
            );
            const lateW =
              lateCell !== undefined
                ? consequenceGatedWorth(lateCell, postCcDamage, lateDied)
                : undefined;
            lateCleanseWindows.push({
              ...(lateW ? { worth: lateW.worth } : {}),
              timeSeconds: (applyTs - combat.startTime) / 1000,
              durationSeconds,
              targetName: unit.name,
              targetSpec: specToString(unit.spec),
              spellName,
              spellId,
              priority: lateGate.priority,
              consequenceDemoted:
                lateGate.consequenceDemoted || (lateW?.demoted ?? false),
              dispelType: windowDispelType,
              postCcDamage,
              cleanseWasOnCD: false,
              // Reliability round 2 W1a (2026-09-25): was hard-coded false —
              // "a dispel landed, so nobody was locked out" — which charged a
              // healer stunned until 0.1 s before his cleanse with 5 s of
              // latency (21cc, ad63). The same gate the missed windows use,
              // over the same alive-capable dispellers.
              targetCharmed: capableFor(
                windowDispelType,
                unit,
                applyTs,
                removal.ts,
              ).charmed,
              dispellersLockedOut: dispellersLockedOutForWindow(
                aliveAt(
                  capableFor(windowDispelType, unit, applyTs, removal.ts).units,
                  applyTs,
                ),
                applyTs,
                removal.ts,
                cannotCastSrcIds,
                MISSED_CLEANSE_THRESHOLD_S * 1000,
              ),
              losReachable: true,
              drChainRisk: computeDrChainRisk(
                unit,
                spellId,
                applyTs,
                removal.ts,
                enemyIds,
                combat.startTime,
              ),
              lateDispelSeconds: durationSeconds,
            });
          }
          continue;
        }

        // Only count as a window (missed opportunity) if it lasted long enough for a human to react
        if (durationSeconds >= MISSED_CLEANSE_THRESHOLD_S) {
          // 裁定册第 2+3 层(签字 2026-08-19):生效档位 = 已递减且行有
          // afterDR 时用 afterDR,否则用角色格(收集层已滤掉 skip /
          // self-impossible,此处角色格只会是 must/worth/situational)。
          //
          // 递减门(规则 ①「已递减的控制和 DoT 一档」):生效档位 skip →
          // 整窗不计,与 <3s 窗口同等待遇(完全退出效率统计 —— 不是 miss,
          // 也不该稀释 cleanse 比率)。
          //
          // 时机门(规则 ③,第 3 层):situational = 「看情况」,情况就是
          // 时机 ——「平稳期(对方输出不高)该驱;承压以后再驱已经晚了」。
          // 逐渲染秒(floor,与 fmtTime 同网格)采样 threatAssessment 的
          // `threatActiveAt`(与 cd-spent-idle 同一谓词,注入语义,绝不
          // 重写):窗口内存在平稳秒 → 有过该驱的时机,批评成立;整窗威胁
          // 覆盖 → 豁免。语料标定(n=300,接线前):situational 580 窗中
          // 362(62.4%)整窗覆盖。「关键爆发前」那半句适用于主动驱长 DoT,
          // DoT 按裁定不在候选,故此处只落地平稳期判据。
          //
          // 时机门覆盖全部三档(2026-08-19 二次裁定「worth/must也扩上时机门」)。
          // 首版只门 situational,标定发现三档威胁覆盖率几乎相同
          // (situational 62.4% / worth 68.8% / must 65.6%)—— 敌人本来就在
          // 爆发期上控;把这一发现摆给用户后,用户裁定「承压以后再驱已经
          // 晚了」适用于所有签字档位。未签字 id 不受此门(走旧优先级,无
          // 裁定依据不豁免)。
          const windowVerdict = dispelVerdictOf(spellId);
          let windowCell: DispelWorth | HealerCell | undefined;
          if (windowVerdict !== null) {
            let effectiveWorth: DispelWorth | HealerCell =
              role === "healer"
                ? windowVerdict.healer
                : role === "melee"
                  ? windowVerdict.melee
                  : windowVerdict.ranged;
            if (
              windowVerdict.afterDR !== null &&
              drLevelAtApply(
                unit,
                spellId,
                applyTs,
                enemyIds,
                combat.startTime,
              ) !== "Full"
            ) {
              effectiveWorth = windowVerdict.afterDR;
            }
            if (effectiveWorth === "skip") continue;
            windowCell = effectiveWorth;
            {
              const fromS = Math.floor((applyTs - combat.startTime) / 1000);
              const toS = Math.floor((removal.ts - combat.startTime) / 1000);
              let hadCalmSecond = false;
              for (let t = fromS; t <= toS; t++) {
                if (!threatActiveAt(t, enemies, friends, combat)) {
                  hadCalmSecond = true;
                  break;
                }
              }
              if (!hadCalmSecond) continue;
            }
          }
          eff.totalCCWindows++;

          // dispelType is non-null here (null case is filtered above)
          const windowDispelType = getDispelType(spellId) as DispelType;

          // Skip if every capable dispeller was themselves CC'd for the entire window —
          // you can't dispel while hard-CC'd.
          // Reliability round 2 W1a (2026-09-25): and a dispeller already dead
          // is not capable — 1e37 got "call for a dispel" naming a druid who
          // had died 13.7 s earlier. No one alive who could dispel → no window.
          const { units: teamCapable, charmed } = capableFor(
            windowDispelType,
            unit,
            applyTs,
            removal.ts,
          );
          const capableDispellers = aliveAt(teamCapable, applyTs);
          if (
            (charmed || teamCapable.length > 0) &&
            capableDispellers.length === 0
          )
            continue;
          const allDispellersBlocked =
            capableDispellers.length > 0 &&
            capableDispellers.every((dispeller) =>
              isPurgerFullyBlockedDuringWindow(
                dispeller,
                applyTs,
                removal.ts,
                cannotCastSrcIds,
              ),
            );
          if (allDispellersBlocked) {
            // Not a missed opportunity — no one could act
            continue;
          }

          eff.missedCount++;

          // Measure post-CC pressure: damage taken in first POST_CC_PRESSURE_WINDOW_S seconds
          const windowEndMs = applyTs + POST_CC_PRESSURE_WINDOW_S * 1000;
          const postCcDamage = unit.damageIn
            .filter(
              (d) =>
                d.logLine.timestamp >= applyTs &&
                d.logLine.timestamp <= windowEndMs,
            )
            .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);

          let cleanseWasOnCD = false;
          let cdBurnedOn:
            | {
                spellName: string;
                priority: DispelPriority;
                secondsBefore: number;
              }
            | undefined;

          if (capableDispellers.length > 0) {
            const activeDispellers = capableDispellers.filter(
              (d) =>
                !isPurgerFullyBlockedDuringWindow(
                  d,
                  applyTs,
                  removal.ts,
                  cannotCastSrcIds,
                ),
            );

            const activeDispellerNames = new Set(
              activeDispellers.map((u) => u.name),
            );
            const applyRelative = (applyTs - combat.startTime) / 1000;
            const pvpTalentsByName = new Map<string, ReadonlySet<string>>(
              activeDispellers.map((u) => [
                u.name,
                new Set((u.info?.pvpTalents ?? []).map(String)),
              ]),
            );
            const specByName = new Map(
              activeDispellers.map((u) => [u.name, u.spec as string]),
            );
            const talentsByName = new Map(
              activeDispellers.map((u) => [u.name, playerTalentIdSets(u)]),
            );
            // Look back dynamically based on the spell ID of each dispel event
            const recentCleanses = allyCleanse.filter((c) => {
              if (!activeDispellerNames.has(c.sourceName)) return false;
              if (c.timeSeconds >= applyRelative) return false;
              // A rider/proc dispel costs the caster nothing, so it can never be
              // the reason their cleanse was unavailable. `dispelKind` already
              // decides this (dispelKind.ts) — reuse it instead of a second list.
              // Measured: Cleanse the Weak's second-ally strip (199427, classified
              // `proc`, 484 events per 250 logs) used to count here as a burned
              // 8s cleanse cooldown and suppressed real missed-cleanse findings.
              if (c.dispelKind !== "deliberate") return false;
              const { cooldownSeconds } = cleanseRecoveryOf(
                c.dispelSpellId,
                pvpTalentsByName.get(c.sourceName),
                specByName.get(c.sourceName),
                talentsByName.get(c.sourceName),
              );
              if (cooldownSeconds === 0) return false;
              return c.timeSeconds + cooldownSeconds > applyRelative;
            });

            // Charges: one recent press does not lock out a two-charge cleanse
            // (Purification — 19% of consecutive Purify pairs are closer than
            // the single-charge cooldown). Count per dispeller, compare with
            // what that dispeller actually holds.
            const recentByName = new Map<string, number>();
            const chargesByName = new Map<string, number>();
            for (const c of recentCleanses) {
              recentByName.set(
                c.sourceName,
                (recentByName.get(c.sourceName) ?? 0) + 1,
              );
              const { charges } = cleanseRecoveryOf(
                c.dispelSpellId,
                pvpTalentsByName.get(c.sourceName),
                specByName.get(c.sourceName),
                talentsByName.get(c.sourceName),
              );
              chargesByName.set(
                c.sourceName,
                Math.max(chargesByName.get(c.sourceName) ?? 1, charges),
              );
            }
            const dispellersWhoUsedCD = new Set(
              [...recentByName]
                .filter(([name, n]) => n >= (chargesByName.get(name) ?? 1))
                .map(([name]) => name),
            );

            // If every active dispeller who wasn't CC'd had used their cleanse recently...
            if (
              activeDispellers.length > 0 &&
              activeDispellers.every((d) => dispellersWhoUsedCD.has(d.name))
            ) {
              cleanseWasOnCD = true;
              const lastCleanse = recentCleanses[recentCleanses.length - 1]; // allyCleanse is sorted by timeSeconds
              cdBurnedOn = {
                spellName: lastCleanse.removedSpellName,
                priority: lastCleanse.priority,
                secondsBefore: applyRelative - lastCleanse.timeSeconds,
              };
            }
          }

          const missDied = targetDiedAround(unit, applyTs, removal.ts);
          const missGate = consequenceGatedPriority(
            priority,
            postCcDamage,
            missDied,
          );
          const missW =
            windowCell !== undefined
              ? consequenceGatedWorth(windowCell, postCcDamage, missDied)
              : undefined;
          missedCleanseWindows.push({
            ...(missW ? { worth: missW.worth } : {}),
            timeSeconds: (applyTs - combat.startTime) / 1000,
            durationSeconds,
            targetName: unit.name,
            targetSpec: specToString(unit.spec),
            spellName,
            spellId,
            priority: missGate.priority,
            consequenceDemoted:
              missGate.consequenceDemoted || (missW?.demoted ?? false),
            dispelType: windowDispelType,
            postCcDamage,
            cleanseWasOnCD,
            cdBurnedOn,
            ...(() => {
              const co = coPresentBacklash(
                unit,
                windowDispelType,
                applyTs,
                enemyPlayerById,
              );
              return co.length ? { coRemovesBacklash: co.join("、") } : {};
            })(),
            // Feasibility / value gates (user-decided 2026-08-02; measured on
            // a 150-match corpus, together they hold back ~24% of the blame
            // candidates):
            targetCharmed: charmed,
            dispellersLockedOut: dispellersLockedOutForWindow(
              capableDispellers,
              applyTs,
              removal.ts,
              cannotCastSrcIds,
              MISSED_CLEANSE_THRESHOLD_S * 1000,
            ),
            losReachable: anyDispellerReachable(
              capableDispellers,
              unit,
              applyTs,
              MISSED_CLEANSE_THRESHOLD_S * 1000,
              zoneId,
              (d) =>
                dispelReachYards(
                  d,
                  CLEANSE_SPELLS_BY_TYPE[windowDispelType][d.spec],
                ),
              combat.startTime,
            ),
            drChainRisk: computeDrChainRisk(
              unit,
              spellId,
              applyTs,
              removal.ts,
              enemyIds,
              combat.startTime,
            ),
          });
        }
      }
    }
  }

  missedCleanseWindows.sort((a, b) => a.timeSeconds - b.timeSeconds);
  lateCleanseWindows.sort((a, b) => a.timeSeconds - b.timeSeconds);

  // Missed offensive purge detection: Critical/High magic buffs on enemies that sat >threshold
  // without being purged, when our team had the capability to purge.
  const missedPurgeWindows: IMissedPurgeWindow[] = [];
  const scopedMissedPurgeWindows: IMissedPurgeWindow[] = [];
  // (friendlyPurgers: declared once at the top of this function, W1d)
  // P-P5b = C: friends holding a scoped removal — each answers only what its
  // scope covers, and only Shattering Throw answers at all
  // (`scopedToolAnswers`).
  const scopedHolders = friends
    .map((unit) => ({ unit, tools: scopedPurgeToolsOf(unit) }))
    .filter((h) => h.tools.length > 0);
  /** the scoped tool this holder would answer `spellId` with; like any purge
   *  with a cooldown it answers Critical buffs only (A19 = C) */
  const scopedToolFor = (
    h: (typeof scopedHolders)[number],
    spellId: string,
    priority: DispelPriority,
  ): IScopedPurgeTool | undefined =>
    h.tools.find(
      (t) =>
        scopedToolAnswers(t, spellId) &&
        (priority === "Critical" ||
          !(purgeRecoveryOf(h.unit, t.castSpellId).cooldownSeconds > 0)),
    );

  if (friendlyPurgers.length > 0 || scopedHolders.length > 0) {
    for (const enemy of enemies) {
      const appliedTimes = new Map<
        string,
        { ts: number; spellName: string }[]
      >();
      const removedTimes = new Map<string, number[]>();

      for (const aura of enemy.auraEvents) {
        const spellId = aura.spellId;
        if (!spellId) continue;
        // Only consider buffs applied by the enemy's own side — skip debuffs our team placed on them
        if (!enemyIds.has(aura.srcUnitId)) continue;
        // Symmetric to the cleanse fix: only treat actual buffs on enemies as purge targets.
        // A debuff briefly hitting an enemy with an enemy as srcUnit (reflects, cross-team
        // weirdness) is not something our offensive purge should handle.
        const auraType = getAuraType(aura);
        if (auraType !== null && auraType !== "BUFF") continue;
        const priority = getPriority(spellId, friends);
        if (priority !== "Critical" && priority !== "High") continue;
        if (
          !(friendlyPurgers.length > 0 && isMagicPurgeTarget(spellId)) &&
          !scopedHolders.some((h) => scopedToolFor(h, spellId, priority))
        )
          continue;

        if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
          const bucket = appliedTimes.get(spellId) ?? [];
          appliedTimes.set(spellId, [
            ...bucket,
            {
              ts: aura.timestamp,
              spellName: getEnglishSpellName(spellId, aura.spellName),
            },
          ]);
        } else if (
          aura.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
          aura.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
          aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
        ) {
          const bucket = removedTimes.get(spellId) ?? [];
          removedTimes.set(spellId, [...bucket, aura.timestamp]);
        }
      }

      for (const [spellId, applications] of appliedTimes) {
        const priority = getPriority(spellId, friends);
        const removals = removedTimes.get(spellId) ?? [];

        for (const { ts: applyTs, spellName } of applications) {
          const removalTs = removals.find((r) => r >= applyTs);
          const durationSeconds =
            ((removalTs ?? combat.endTime) - applyTs) / 1000;

          if (durationSeconds < MISSED_PURGE_THRESHOLD_S) continue;

          // Was it actually purged by our team within this window?
          const applyRelative = (applyTs - combat.startTime) / 1000;
          // The window's end on the purge events' own clock: a purge shares
          // its timestamp with the removal it causes, and `applyRelative +
          // durationSeconds` is not that number in floating point (75.922 +
          // 6.933 = 82.85499999999999 < the purge's 82.855 — a Shattering
          // Throw that took Blessing of Protection off read "unpurged for
          // 7s", 17664ae3 round 1).
          const endRelative =
            ((removalTs ?? combat.endTime) - combat.startTime) / 1000;
          const purgedByUs = ourPurges.some(
            (p) =>
              p.removedSpellId === spellId &&
              p.targetName === enemy.name &&
              p.timeSeconds >= applyRelative &&
              p.timeSeconds <= endRelative,
          );

          if (!purgedByUs) {
            // Only flag if at least one purger was free during the window AND
            // the priority meets the bar for that purger's spec (CD-gated purgers
            // only get flagged for Critical misses — they can't spam purge every GCD).
            const windowEndMs = removalTs ?? combat.endTime;
            const generalPurgers = isMagicPurgeTarget(spellId)
              ? friendlyPurgers.filter(
                  (p) => priority === "Critical" || !isCdGatedPurger(p),
                )
              : [];
            const generalOpen =
              generalPurgers.length > 0 &&
              !generalPurgers.every((purger) =>
                isPurgerFullyBlockedDuringWindow(
                  purger,
                  applyTs,
                  windowEndMs,
                  cannotCastSrcIds,
                ),
              );
            // P-P5b = C: scoped holders whose tool covers this buff and who
            // were not locked out for the whole window
            const scoped = scopedHolders.flatMap((h) => {
              const tool = scopedToolFor(h, spellId, priority);
              return tool !== undefined &&
                // a cast-time removal needs the reaction bar plus its cast
                // (Shattering Throw: 1.5 s; fastest observed removal 2.3 s
                // after the shield, median 3.1 s)
                durationSeconds >=
                  MISSED_PURGE_THRESHOLD_S + tool.castSeconds &&
                !isPurgerFullyBlockedDuringWindow(
                  h.unit,
                  applyTs,
                  windowEndMs,
                  cannotCastSrcIds,
                )
                ? [{ unit: h.unit, tool }]
                : [];
            });
            const scopedToolOf = new Map(
              scoped.map((x) => [x.unit.id, x.tool]),
            );
            // the purgers the window-level facts speak for: the general Magic
            // purgers when one carried the window (unchanged by P-P5b), else
            // the scoped holders — and then the window goes to
            // `scopedMissedPurgeWindows`, not to the team's list
            const eligiblePurgers = generalOpen
              ? generalPurgers
              : scoped.map((x) => x.unit);
            const readyAtOf = (p: ICombatUnit): number => {
              const tool = generalOpen ? undefined : scopedToolOf.get(p.id);
              return tool !== undefined
                ? abilitiesReadyAtSeconds(
                    p,
                    new Set([tool.castSpellId]),
                    new Set(),
                    applyTs,
                    combat.startTime,
                  )
                : purgeReadyAtSeconds(
                    p,
                    new Set(
                      ourPurges
                        .filter((x) => x.sourceName === p.name)
                        .map((x) => x.dispelSpellId),
                    ),
                    applyTs,
                    combat.startTime,
                  );
            };
            const reachOf = (d: ICombatUnit): number => {
              const tool = generalOpen ? undefined : scopedToolOf.get(d.id);
              return tool !== undefined
                ? scopedToolReachYards(d, tool)
                : dispelReachYards(d, PURGE_SPELLS_BY_SPEC[d.spec]);
            };
            // "free for less than the reaction bar" — for a cast-time tool
            // the bar is the reaction time PLUS the cast (codex review of
            // P-P5b: a warrior stunned until 3.5 s before an Ice Block ended
            // could not have thrown it off)
            const freeBarMs = (tool?: IScopedPurgeTool): number =>
              (MISSED_PURGE_THRESHOLD_S + (tool?.castSeconds ?? 0)) * 1000;
            if (eligiblePurgers.length > 0) {
              // F-P7 (codex r1 / r2 09-30, ruling A19 = C): the team's purge
              // is back at the earliest eligible purger's readiness, read from
              // its cooldown-consuming casts — not a constant 8 s, not only
              // when every purger is CD-gated, not from removals only.
              const teamReadyAt = Math.min(...eligiblePurgers.map(readyAtOf));
              const purgeWasOnCD = teamReadyAt > applyRelative;
              let cdBurnedOn:
                | {
                    spellName: string;
                    priority: DispelPriority;
                    secondsBefore: number;
                  }
                | undefined;
              if (purgeWasOnCD) {
                const lastPurge = ourPurges
                  .filter(
                    (p) =>
                      eligiblePurgers.some((pu) => pu.name === p.sourceName) &&
                      p.timeSeconds < applyRelative,
                  )
                  .at(-1);
                if (lastPurge)
                  cdBurnedOn = {
                    spellName: lastPurge.removedSpellName,
                    priority: lastPurge.priority,
                    secondsBefore: applyRelative - lastPurge.timeSeconds,
                  };
              }

              // Healing pressure: was the friendly team taking significant damage at the moment of application?
              // We check a strict burst window (3s) instead of the entire unpurged duration so we don't falsely
              // excuse missed purges during long, unpressured periods.
              const pressureWindowEndMs = Math.min(
                applyTs + POST_CC_PRESSURE_WINDOW_S * 1000,
                removalTs ?? combat.endTime,
              );
              const teamUnderPressure = friends.some((f) => {
                const threshold = getPressureThreshold(f);
                const dmg = f.damageIn
                  .filter(
                    (d) =>
                      d.logLine.timestamp >= applyTs &&
                      d.logLine.timestamp <= pressureWindowEndMs,
                  )
                  .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
                return dmg >= threshold;
              });

              (generalOpen
                ? missedPurgeWindows
                : scopedMissedPurgeWindows
              ).push({
                timeSeconds: applyRelative,
                durationSeconds,
                enemyName: enemy.name,
                enemySpec: specToString(enemy.spec),
                spellName,
                spellId,
                priority,
                purgeWasOnCD,
                ...(purgeWasOnCD ? { purgeReadyAtSeconds: teamReadyAt } : {}),
                cdBurnedOn,
                teamUnderPressure,
                purgersLockedOut: generalOpen
                  ? dispellersLockedOutForWindow(
                      eligiblePurgers,
                      applyTs,
                      windowEndMs,
                      cannotCastSrcIds,
                      MISSED_PURGE_THRESHOLD_S * 1000,
                    )
                  : // scoped holders: each against its own tool's bar
                    scoped.every(({ unit, tool }) =>
                      dispellersLockedOutForWindow(
                        [unit],
                        applyTs,
                        windowEndMs,
                        cannotCastSrcIds,
                        freeBarMs(tool),
                      ),
                    ),
                losReachable: anyDispellerReachable(
                  eligiblePurgers,
                  enemy,
                  applyTs,
                  MISSED_PURGE_THRESHOLD_S * 1000,
                  zoneId,
                  reachOf,
                  combat.startTime,
                ),
                ...(scoped.length > 0
                  ? {
                      scopedPurgers: scoped.map(({ unit, tool }) => {
                        const readyAt = abilitiesReadyAtSeconds(
                          unit,
                          new Set([tool.castSpellId]),
                          new Set(),
                          applyTs,
                          combat.startTime,
                        );
                        return {
                          purgerName: unit.name,
                          tool: {
                            name: tool.name,
                            scope: tool.scope,
                            note: tool.note,
                            castSeconds: tool.castSeconds,
                          },
                          ...(readyAt > applyRelative
                            ? { purgeReadyAtSeconds: readyAt }
                            : {}),
                          lockedOut: dispellersLockedOutForWindow(
                            [unit],
                            applyTs,
                            windowEndMs,
                            cannotCastSrcIds,
                            freeBarMs(tool),
                          ),
                          losReachable: anyDispellerReachable(
                            [unit],
                            enemy,
                            applyTs,
                            MISSED_PURGE_THRESHOLD_S * 1000,
                            zoneId,
                            () => scopedToolReachYards(unit, tool),
                            combat.startTime,
                          ),
                        };
                      }),
                    }
                  : {}),
              });
            }
          }
        }
      }
    }

    missedPurgeWindows.sort((a, b) => a.timeSeconds - b.timeSeconds);
    scopedMissedPurgeWindows.sort((a, b) => a.timeSeconds - b.timeSeconds);
  }

  const ccEfficiency: ICCEfficiencyStat[] = [...efficiencyMap.values()]
    .filter((e) => e.totalCCWindows > 0)
    .map((e) => {
      const dispelableWindows = e.cleanseCount + e.missedCount;
      return {
        ...e,
        // Rate only counts windows where dispel was possible (excludes broken-by-damage)
        cleanseRate:
          dispelableWindows > 0 ? e.cleanseCount / dispelableWindows : 1,
      };
    })
    .sort((a, b) => b.totalCCWindows - a.totalCCWindows);

  return {
    allyCleanse,
    ourPurges,
    hostilePurges,
    missedCleanseWindows,
    lateCleanseWindows,
    ccEfficiency,
    missedPurgeWindows,
    scopedMissedPurgeWindows,
  };
}

/**
 * Itemized enemy in-team cleanses (found in the 2026-07-18 baseline triage):
 * the enemy healer removing your CC/dots from their own teammates. This whole
 * event class used to go unrendered (Purify missing in 42/176 matches) — it is
 * key coaching information ("your Hex got instantly cleansed") and was the main
 * gap in the coverage gate's sufficiency. Capped at 8 lines; the rest folds.
 */
export function formatEnemyDispelsForContext(
  enemySummary: IDispelSummary,
): string[] {
  const evs = enemySummary.allyCleanse;
  if (evs.length === 0) return [];
  const lines: string[] = [
    "ENEMY DISPELS (their team cleansing your CC/dots off themselves):",
  ];
  const shown = evs.slice(0, 8);
  for (const e of shown) {
    lines.push(
      `  ${fmtTime(e.timeSeconds)}  ${e.sourceSpec} ${e.dispelSpellName} removed ${e.removedSpellName} from ${e.targetSpec}`,
    );
  }
  if (evs.length > shown.length) {
    lines.push(`  [+${evs.length - shown.length} more enemy dispels folded]`);
  }
  return lines;
}

export function formatDispelContextForAI(summary: IDispelSummary): string[] {
  const lines: string[] = [];
  const { missedCleanseWindows, ccEfficiency, missedPurgeWindows } = summary;

  lines.push("DISPEL SUMMARY:");

  // Cleanse summary
  const totalCCWindows = ccEfficiency.reduce((s, e) => s + e.totalCCWindows, 0);
  const totalMissed = ccEfficiency.reduce((s, e) => s + e.missedCount, 0);
  const totalCleansed = ccEfficiency.reduce((s, e) => s + e.cleanseCount, 0);
  const totalBroken = ccEfficiency.reduce((s, e) => s + e.brokenCount, 0);

  if (totalCCWindows === 0) {
    lines.push("  No significant CC applied to your team.");
  } else {
    const brokenStr =
      totalBroken > 0 ? `, ${totalBroken} broken by damage` : "";
    lines.push(
      `  CC windows on your team: ${totalCCWindows} total — ${totalMissed} missed, ${totalCleansed} cleansed${brokenStr}`,
    );

    // Worst missed cleanse
    const significantMissed = missedCleanseWindows.filter(
      (w) =>
        w.priority === "Critical" ||
        (w.priority === "High" &&
          (w.durationSeconds > 5 || w.postCcDamage > 50_000)),
    );
    if (significantMissed.length > 0) {
      const worst = [...significantMissed].sort(
        (a, b) => b.durationSeconds - a.durationSeconds,
      )[0];
      const dmgStr =
        worst.postCcDamage > 0
          ? `, ${Math.round(worst.postCcDamage / 1000)}k dmg taken`
          : "";
      lines.push(
        `  Worst missed cleanse: ${worst.spellName} [${worst.priority}] on ${worst.targetSpec} at ${fmtTime(worst.timeSeconds)} (${Math.round(worst.durationSeconds)}s${dmgStr})`,
      );
      if (worst.cleanseWasOnCD && worst.cdBurnedOn) {
        lines.push(
          `    - Note: Cleanse was on cooldown (burned on ${worst.cdBurnedOn.spellName} [${worst.cdBurnedOn.priority} priority] ${worst.cdBurnedOn.secondsBefore.toFixed(1)}s before)`,
        );
      }
      const highDamageMisses = significantMissed.filter(
        (w) => w.postCcDamage > 100_000,
      );
      if (highDamageMisses.length > 0) {
        lines.push(
          `  High-damage missed cleanses: ${highDamageMisses.length} with >100k dmg taken during CC`,
        );
      }
    }
  }

  // Purge summary
  // NOTE: kept as the original Critical/High-only filter (pre-duringKillWindow escalation) so the
  // "worst" pick and its rendered line stay byte-identical to the pre-existing behavior for all
  // inputs — including in-window duration ties/wins that would otherwise silently swap which item
  // is reported as worst (e.g. a High 5s not-in-window miss vs. a Medium 20s in-window miss).
  const significantMissedPurges = missedPurgeWindows.filter(
    (w) => w.priority === "Critical" || w.priority === "High",
  );
  if (significantMissedPurges.length === 0) {
    lines.push("  Missed purge windows: None (Critical/High)");
  } else {
    const worst = [...significantMissedPurges].sort(
      (a, b) => b.durationSeconds - a.durationSeconds,
    )[0];
    const pressureStr = worst.teamUnderPressure ? " during pressure" : "";
    lines.push(
      `  Missed purge windows: ${significantMissedPurges.length} — worst: ${worst.spellName} on ${worst.enemySpec} (${Math.round(worst.durationSeconds)}s unpurged${pressureStr})`,
    );
  }

  // Kill-window misses are always surfaced, regardless of priority (a friendly kill can be blown by
  // a Medium-priority buff just as easily as a Critical one) — rendered as dedicated lines rather
  // than folded into the "worst" pick above so they can never be hidden by a longer non-window miss.
  const killWindowMisses = missedPurgeWindows.filter(
    (w) => w.duringKillWindow === true,
  );
  for (const miss of killWindowMisses) {
    lines.push(
      // Use fmtTime for the timestamp, consistent with every other timestamp in
      // the prompt — this used to render as bare seconds ("at 94s"), which both
      // broke the document's notation and read as a duration rather than an
      // absolute point in time.
      `  MISSED PURGE DURING FRIENDLY KILL WINDOW: ${miss.spellName} on ${miss.enemySpec} (${miss.enemyName}) at ${fmtTime(miss.timeSeconds)} (${Math.round(miss.durationSeconds)}s unpurged, priority ${miss.priority})`,
    );
  }

  return lines;
}
