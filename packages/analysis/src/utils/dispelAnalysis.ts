import { buffFullDurationForCaster } from "./buffDuration";
import { CombatUnitSpec, ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { dispelVerdictOf } from "../data/dispelVerdicts";
import {
  SPELL_CATEGORIES as spellsData,
} from "../data/spellCategories";
import { getEnglishSpellName, spellEffectData } from "../data/spellEffectData";
import spellIdListsData from "../data/spellIdLists";
import { buildCannotCastIntervals } from "./cannotCastIntervals";
import {
  getPressureThreshold,
  isHealerSpec,
  isMeleeSpec,
  specToString,
} from "./cooldowns";
import {
  buildCcCategoryHistory,
  getDRCategory,
  getDRLevelAtTime,
  PATCH_121_GOLIVE_EPOCH_MS,
} from "./drAnalysis";
import {
  distanceBetween,
  getUnitPositionAtTime,
  hasLineOfSight,
} from "./losAnalysis";
import { DISPEL_MAX_RANGE_YARDS, LOS_SWEEP_GAP_MS } from "./positionSampling";
import { fmtTime } from "./renderGrid";
import { hasOffensivePurgeTalent } from "./talentBehaviors";
import {
  getPlayerTalentedSpellIds,
  getSpecTalentTreeSpellIds,
} from "./talents";
import { threatActiveAt } from "./threatAssessment";

export type DispelPriority = "Critical" | "High" | "Medium" | "Low";
import { DISPEL_FEATURE_FLAGS } from "../data/dispelFeatureFlags";
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
const POST_CC_PRESSURE_WINDOW_S = 5;

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
  ["34914", "Horrifies the dispeller (Vampiric Touch)"],
]);

// The aura the dispeller eats. 196364 is corpus-established, not assumed:
// of 528 UA dispels, 406 (76.9%) put 196364 on the DISPELLER within 3s, and
// wowhead confirms 196364 = Unstable Affliction, Shadow, `Apply Aura: Silence`,
// 4s — matching the tooltip exactly. The pre-12.1 rows (316099/342938 →
// 196363, which resolves to "Eye Beam" in our own name table) were deleted
// 2026-08-21: S2 corpus scan, 0 occurrences of any of the three ids in 10,682
// matches (eval-private/reports/s2-health-2026-08-21).
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const BACKLASH_CC_SPELL_IDS = new Map<
  string,
  { backlashSpellId: string }
>([
  ["34914", { backlashSpellId: "34914" }],
  ["1259790", { backlashSpellId: "196364" }],
]);

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

const teamHasBalanceDruid = (team: readonly ICombatUnit[]): boolean =>
  team.some((u) => u.spec === CombatUnitSpec.Druid_Balance);

/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const DISPEL_COOLDOWNS_BY_SPELL = new Map<string, number>([
  ["374251", 60], // Cauterizing Flame (Preservation Evoker)
  ["475", 0], // Remove Curse (Mage)
  ["2782", 0], // Remove Corruption (Druid)
]);

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
  CombatUnitSpec.Warlock_Affliction, // Devour Magic (Felhunter)
  CombatUnitSpec.Warlock_Demonology, // Devour Magic (Felhunter)
  CombatUnitSpec.Warlock_Destruction, // Devour Magic (Felhunter)
]);

// Purge specs whose purge ability has a meaningful cooldown (>= 8s).
// For these, only flag Critical priority missed purges — they can't freely spam purge
// every GCD so holding the ability for a better target is often correct.
const CD_GATED_PURGERS = new Set<CombatUnitSpec>([
  CombatUnitSpec.Evoker_Preservation, // Naturalize: 10s CD
  CombatUnitSpec.Evoker_Devastation, // Naturalize: 10s CD
  CombatUnitSpec.Evoker_Augmentation, // Naturalize: 10s CD
  CombatUnitSpec.Warlock_Affliction, // Devour Magic: ~8s CD
  CombatUnitSpec.Warlock_Demonology,
  CombatUnitSpec.Warlock_Destruction,
  CombatUnitSpec.DemonHunter_Havoc, // Consume Magic: 8s CD
  CombatUnitSpec.DemonHunter_Vengeance,
]);

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
]);

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

  // DH: Consume Magic is talent-gated.
  if (DH_SPECS.has(unit.spec) && talentTreeIds.has(CONSUME_MAGIC_SPELL_ID)) {
    if (talentedIds !== null && !talentedIds.has(CONSUME_MAGIC_SPELL_ID))
      return false;
    if (
      talentedIds === null &&
      hasCombatantInfo &&
      !getCastSpellIds().has(CONSUME_MAGIC_SPELL_ID)
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
  /** How long the buff was expected to last per spellEffectData; undefined if no duration data */
  expectedBuffDurationSeconds?: number;
  enemyName: string;
  enemySpec: string;
  spellName: string;
  spellId: string;
  priority: DispelPriority;
  /** True if all eligible purgers had their purge ability on CD at the start of the miss window */
  purgeWasOnCD: boolean;
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
  if (priority === "Critical" && postCcDamage <= 0 && !targetDied) {
    return { priority: "High", consequenceDemoted: true };
  }
  return { priority, consequenceDemoted: false };
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
export function hardCastOccupancyWithin(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  windowStartMs: number,
  windowEndMs: number,
): IHardCastOccupancy | null {
  const starts = unit.castStartEvents;
  if (!Array.isArray(starts)) return null;
  const none: IHardCastOccupancy = {
    occupiedMs: 0,
    startedBeforeWindow: false,
    spellNames: [],
  };
  if (windowEndMs <= windowStartMs || starts.length === 0) return none;
  const cutters = buildCannotCastIntervals(unit, enemyIds)
    .map((iv) => iv.from)
    .sort((a, b) => a - b);
  const sorted = [...starts].sort((a, b) => a.timestamp - b.timestamp);
  const successes = unit.spellCastEvents ?? [];
  const out: IHardCastOccupancy = { ...none, spellNames: [] };
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i].timestamp;
    if (from >= windowEndMs) break;
    const succ = successes.find(
      (e) => e.spellId === sorted[i].spellId && e.timestamp >= from,
    );
    const cut = cutters.find((c) => c > from);
    const ends = [succ?.timestamp, sorted[i + 1]?.timestamp, cut].filter(
      (x): x is number => typeof x === "number" && x > from,
    );
    if (ends.length === 0) continue;
    const overlap =
      Math.min(Math.min(...ends), windowEndMs) - Math.max(from, windowStartMs);
    if (overlap <= 0) continue;
    out.occupiedMs += overlap;
    if (from < windowStartMs) out.startedBeforeWindow = true;
    out.spellNames.push(sorted[i].spellName);
  }
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
 * dispeller and the target both have a position, are within
 * DISPEL_MAX_RANGE_YARDS, and LoS is not false (no geometry → null → judge on
 * range alone) → true (reachable, the criticism stands). If the full sweep
 * yields samples but never a reachable pair → false (exempt). If no sample
 * pair exists at all → null (do not change the verdict; the tri-state rule —
 * see the losAnalysis / ccTrinketAnalysis precedents).
 */
function anyDispellerReachable(
  dispellers: ICombatUnit[],
  target: ICombatUnit,
  applyTs: number,
  reactMs: number,
  zoneId: string | undefined,
): boolean | null {
  if (dispellers.length === 0) return null;
  // Anchored to the render grid: sweep on whole seconds (fmtTime floors to the
  // second and gates recompute on the rendered grid — same family as
  // healerExposureAnalysis's G5 semantics).
  const t0 = Math.floor(applyTs / 1000) * 1000;
  let sawSamplePair = false;
  for (let t = t0; t <= applyTs + reactMs; t += 1000) {
    const targetPos = getUnitPositionAtTime(target, t, LOS_SWEEP_GAP_MS);
    if (!targetPos) continue;
    for (const d of dispellers) {
      const dPos = getUnitPositionAtTime(d, t, LOS_SWEEP_GAP_MS);
      if (!dPos) continue;
      sawSamplePair = true;
      if (distanceBetween(dPos, targetPos) > DISPEL_MAX_RANGE_YARDS) continue;
      const los = zoneId ? hasLineOfSight(zoneId, dPos, targetPos) : null;
      if (los !== false) return true; // in range and LoS not disproven
    }
  }
  return sawSamplePair ? false : null;
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

function computeDrChainRisk(
  target: ICombatUnit,
  ccSpellId: string,
  applyTs: number,
  windowEndTs: number,
  enemyIds: Set<string>,
  matchStartMs: number,
): boolean {
  const category = getDRCategory(ccSpellId);
  if (!category) return false;

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
  const MATCH_TOLERANCE_SECONDS = 0.05;
  return allyCleanse.some(
    (d) =>
      d.removedSpellId === spellId &&
      d.targetName === targetName &&
      Math.abs(d.timeSeconds - removalSeconds) <= MATCH_TOLERANCE_SECONDS,
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
  w: Pick<IMissedPurgeWindow, "purgersLockedOut" | "losReachable">,
): string {
  let out = "";
  if (w.purgersLockedOut)
    out += " | purgers were CC'd/locked out — not actionable";
  if (w.losReachable === false)
    out += " | no purger had range/line of sight — not actionable";
  return out;
}

export function reconstructDispelSummary(
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  // zoneId lets feasibility gate a look up arena geometry (LoS); omit it and
  // the gate judges on range alone (still tri-state).
  combat: { startTime: number; endTime: number; zoneId?: string },
  // B45: friendly pet/guardian units whose dispels should be attributed to their owner player
  friendlyPets: ICombatUnit[] = [],
  // Coverage tail fix: dispels by enemy pets (Felhunter Devour Magic etc.)
  // previously landed in no bucket at all, leaving hostilePurges blind to pet
  // purges — completed symmetrically with friendlyPets.
  enemyPets: ICombatUnit[] = [],
): IDispelSummary {
  const friendlyIds = new Set(friends.map((u) => u.id));
  const enemyIds = new Set(enemies.map((u) => u.id));
  // B45: pets are also considered friendly sources; owner lookup is via ownerId
  const friendlyPetIds = new Set(friendlyPets.map((u) => u.id));
  const enemyPetIds = new Set(enemyPets.map((u) => u.id));
  const friendlyPlayerById = new Map(friends.map((u) => [u.id, u]));
  const enemyPlayerById = new Map(enemies.map((u) => [u.id, u]));
  const teamDispelTypes = buildTeamDispelTypes(friends);
  const teamDispelCapability = buildTeamDispelCapability(friends);
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
        if (DISPEL_FEATURE_FLAGS.F18_FATAL_DISPEL) {
          const fatalDeath = getFatalDeath(
            targetUnitForPenalty,
            action.timestamp,
          );
          if (fatalDeath) {
            event.wasFatal = true;
            event.fatalUnitName = fatalDeath.name;
            event.fatalUnitSpec = fatalDeath.spec;
          }
        }

        if (DISPEL_FEATURE_FLAGS.F124_ENHANCED_CC_ANNOTATIONS) {
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
            if (lateVerdict !== null) {
              let lateWorth: string =
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
            const lateGate = consequenceGatedPriority(
              priority,
              postCcDamage,
              targetDiedAround(unit, applyTs, removal.ts),
            );
            lateCleanseWindows.push({
              timeSeconds: (applyTs - combat.startTime) / 1000,
              durationSeconds,
              targetName: unit.name,
              targetSpec: specToString(unit.spec),
              spellName,
              spellId,
              priority: lateGate.priority,
              consequenceDemoted: lateGate.consequenceDemoted,
              dispelType: windowDispelType,
              postCcDamage,
              cleanseWasOnCD: false,
              dispellersLockedOut: false,
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
          if (windowVerdict !== null) {
            let effectiveWorth: string =
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
          const capableDispellers =
            teamDispelCapability.get(windowDispelType) ?? [];
          const allDispellersBlocked =
            capableDispellers.length > 0 &&
            capableDispellers.every((dispeller) =>
              isPurgerFullyBlockedDuringWindow(
                dispeller,
                applyTs,
                removal.ts,
                enemyIds,
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
                  enemyIds,
                ),
            );

            const activeDispellerNames = new Set(
              activeDispellers.map((u) => u.name),
            );
            const applyRelative = (applyTs - combat.startTime) / 1000;
            // Look back dynamically based on the spell ID of each dispel event
            const recentCleanses = allyCleanse.filter((c) => {
              if (!activeDispellerNames.has(c.sourceName)) return false;
              if (c.timeSeconds >= applyRelative) return false;
              const cd = DISPEL_FEATURE_FLAGS.F131_F132_CLEANSE_COOLDOWNS
                ? (DISPEL_COOLDOWNS_BY_SPELL.get(c.dispelSpellId) ?? 8)
                : 8;
              if (cd === 0) return false;
              return c.timeSeconds + cd > applyRelative;
            });

            const dispellersWhoUsedCD = new Set(
              recentCleanses.map((c) => c.sourceName),
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

          const missGate = consequenceGatedPriority(
            priority,
            postCcDamage,
            targetDiedAround(unit, applyTs, removal.ts),
          );
          missedCleanseWindows.push({
            timeSeconds: (applyTs - combat.startTime) / 1000,
            durationSeconds,
            targetName: unit.name,
            targetSpec: specToString(unit.spec),
            spellName,
            spellId,
            priority: missGate.priority,
            consequenceDemoted: missGate.consequenceDemoted,
            dispelType: windowDispelType,
            postCcDamage,
            cleanseWasOnCD,
            cdBurnedOn,
            // Feasibility / value gates (user-decided 2026-08-02; measured on
            // a 150-match corpus, together they hold back ~24% of the blame
            // candidates):
            dispellersLockedOut: dispellersLockedOutForWindow(
              capableDispellers,
              applyTs,
              removal.ts,
              enemyIds,
              MISSED_CLEANSE_THRESHOLD_S * 1000,
            ),
            losReachable: anyDispellerReachable(
              capableDispellers,
              unit,
              applyTs,
              MISSED_CLEANSE_THRESHOLD_S * 1000,
              combat.zoneId,
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
  const friendlyPurgers = friends.filter((f) => canOffensivePurge(f));

  if (friendlyPurgers.length > 0) {
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
        if (getDispelType(spellId) !== "Magic") continue;
        if (PURGE_BLOCKLIST.has(spellId)) continue;
        const priority = getPriority(spellId, friends);
        if (priority !== "Critical" && priority !== "High") continue;

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
          const purgedByUs = ourPurges.some(
            (p) =>
              p.removedSpellId === spellId &&
              p.targetName === enemy.name &&
              p.timeSeconds >= applyRelative &&
              p.timeSeconds <= applyRelative + durationSeconds,
          );

          if (!purgedByUs) {
            // Only flag if at least one purger was free during the window AND
            // the priority meets the bar for that purger's spec (CD-gated purgers
            // only get flagged for Critical misses — they can't spam purge every GCD).
            const windowEndMs = removalTs ?? combat.endTime;
            const eligiblePurgers = friendlyPurgers.filter(
              (p) => priority === "Critical" || !CD_GATED_PURGERS.has(p.spec),
            );
            const allPurgersBlocked =
              eligiblePurgers.length === 0 ||
              eligiblePurgers.every((purger) =>
                isPurgerFullyBlockedDuringWindow(
                  purger,
                  applyTs,
                  windowEndMs,
                  enemyIds,
                ),
              );
            if (!allPurgersBlocked) {
              // Expected buff duration from spell data
              // 单一谓词(2026-09-06):这里按 spellId 聚合,拿不到施法者,
              // 所以传 undefined —— 与直读 spellEffectData 同值,但覆盖层和
              // 以后的时长订正会自动到达。
              const expectedBuffDurationSeconds = buffFullDurationForCaster(
                spellId,
                undefined,
              );

              // Purge CD state: look back at ourPurges for each eligible purger.
              // Only meaningful for CD-gated purgers (Evoker 10s, DH/Warlock/Priest 8s).
              // Free-purge specs (Shaman, Mage) never have their CD "burned" — skip them.
              const cdGatedEligible = eligiblePurgers.filter((p) =>
                CD_GATED_PURGERS.has(p.spec),
              );
              let purgeWasOnCD = false;
              let cdBurnedOn:
                | {
                    spellName: string;
                    priority: DispelPriority;
                    secondsBefore: number;
                  }
                | undefined;
              if (
                cdGatedEligible.length > 0 &&
                eligiblePurgers.every((p) => CD_GATED_PURGERS.has(p.spec))
              ) {
                // Only meaningful when ALL eligible purgers are CD-gated
                const purgeCD = 8; // seconds — conservative; Evoker is 10s
                const recentPurges = ourPurges.filter(
                  (p) =>
                    cdGatedEligible.some((pu) => pu.name === p.sourceName) &&
                    p.timeSeconds < applyRelative &&
                    p.timeSeconds >= applyRelative - purgeCD,
                );
                const purgersWhoUsedCD = new Set(
                  recentPurges.map((p) => p.sourceName),
                );
                if (
                  cdGatedEligible.every((p) => purgersWhoUsedCD.has(p.name))
                ) {
                  purgeWasOnCD = true;
                  const lastPurge = recentPurges[recentPurges.length - 1];
                  cdBurnedOn = {
                    spellName: lastPurge.removedSpellName,
                    priority: lastPurge.priority,
                    secondsBefore: applyRelative - lastPurge.timeSeconds,
                  };
                }
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

              missedPurgeWindows.push({
                timeSeconds: applyRelative,
                durationSeconds,
                expectedBuffDurationSeconds,
                enemyName: enemy.name,
                enemySpec: specToString(enemy.spec),
                spellName,
                spellId,
                priority,
                purgeWasOnCD,
                cdBurnedOn,
                teamUnderPressure,
                purgersLockedOut: dispellersLockedOutForWindow(
                  eligiblePurgers,
                  applyTs,
                  windowEndMs,
                  enemyIds,
                  MISSED_PURGE_THRESHOLD_S * 1000,
                ),
                losReachable: anyDispellerReachable(
                  eligiblePurgers,
                  enemy,
                  applyTs,
                  MISSED_PURGE_THRESHOLD_S * 1000,
                  combat.zoneId,
                ),
              });
            }
          }
        }
      }
    }

    missedPurgeWindows.sort((a, b) => a.timeSeconds - b.timeSeconds);
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
      if (
        DISPEL_FEATURE_FLAGS.F131_F132_CLEANSE_COOLDOWNS &&
        worst.cleanseWasOnCD &&
        worst.cdBurnedOn
      ) {
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
