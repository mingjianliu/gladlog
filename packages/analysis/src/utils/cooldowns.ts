import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitPowerType,
  CombatUnitSpec,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { classMetadata } from "../data/classSpells";
import { SpellTag } from "../data/spellTypes";

import { getEnglishSpellName, spellEffectData } from "../data/spellEffectData";
import spellIdListsData from "../data/spellIdLists";
import { binarySearchClosest } from "./binarySearch";
import { DISCOVERY_TAG_RULES } from "../data/discoveryRules";
import { CD_TALENT_MODIFIERS } from "./talentModifiers";
import {
  getPlayerTalentedSpellInfo,
  getSpecTalentTreeSpellInfo,
} from "./talents";

export const MAJOR_DEFENSIVE_IDS = new Set<string>(
  (spellIdListsData as unknown as { externalOrBigDefensiveSpellIds?: string[] })
    .externalOrBigDefensiveSpellIds ?? [],
);

// H11: defensives that can be cast on a teammate (not just self). Used to avoid suggesting
// self-only tools (e.g. Barkskin) as "cheaper" alternatives when the annotated cast was an
// external thrown on an ally — a self-only tool can't help that ally.
const EXTERNAL_DEFENSIVE_IDS = new Set<string>(
  spellIdListsData.externalDefensiveSpellIds as string[],
);

/**
 * B112/B127: true when a big personal defensive is SELF-ONLY (cannot be cast on an ally) — e.g.
 * Divine Shield, Ice Block, Obsidian Scales, Barkskin. Such a cast logs whatever unit the caster was
 * targeting at the time (often an enemy, or an ally being healed) as its "target", so the timeline
 * must render it as (self) with the caster's own HP — never "→ <enemy>"/"→ <ally>" with that unit's
 * HP. Defined as a major/big defensive that is NOT in the ally-castable external set; this is
 * deliberately conservative (only known big defensives) so an external missing from the list is never
 * mis-rendered as self.
 */
export function isSelfOnlyDefensive(spellId: string): boolean {
  return (
    MAJOR_DEFENSIVE_IDS.has(spellId) && !EXTERNAL_DEFENSIVE_IDS.has(spellId)
  );
}

/** True if this defensive can be cast on an ALLY (an external). A Defensive-tagged CD that is NOT
 *  ally-castable cannot save a teammate — used to drop self-only red-herrings from teammate-death traces. */
export function isAllyCastableDefensive(spellId: string): boolean {
  return EXTERNAL_DEFENSIVE_IDS.has(spellId);
}

/**
 * B113/B130: role tags for throughput / mana / mobility / modifier cooldowns that reach the timeline
 * (often via the B38 [YOU] [CD] promotion) without a survival/defensive context. Absent a role, the
 * model invents mechanics — e.g. calling Restoral (a mana+heal CD) a "stun break", or equating a cheap
 * modifier (Tip the Scales) with a 90–240s emergency CD. Each tag is a short, factual role descriptor
 * appended to the CD's timeline line so the model reasons about what the CD actually does. Keep these
 * conservative and correct — a wrong role is worse than none.
 */
export const CD_ROLE_TAGS: Record<string, string> = {
  // Mistweaver Monk (B113)
  "388615": "mana+heal CD", // Restoral — restores team mana and heals; NOT a defensive/CC
  "325197": "healing CD", // Invoke Chi-Ji, the Red Crane — healing throughput
  "116680": "heal amplifier", // Thunder Focus Tea — empowers the next heal; not a defensive
  // Preservation Evoker (B130)
  "357170": "ally heal-over-time", // Time Dilation — delayed healing on an ally; throughput
  "370553": "cast-time modifier", // Tip the Scales — makes next Empower instant; cheap modifier
  "358267": "mobility", // Hover — cast while moving; not a defensive
};

/** Returns a role descriptor for a throughput/modifier CD, or undefined if none is tagged. */
export function cdRoleTag(spellId: string): string | undefined {
  return CD_ROLE_TAGS[spellId];
}

/**
 * B136: team-wide healing throughput CDs. These have no single target, so the timeline would
 * otherwise render the CASTER's own HP (usually ~100%), making the model read the cast as
 * "premature". For these the relevant context is the lowest-HP ally at cast time, not the healer.
 */
export const TEAM_HEAL_CD_IDS = new Set<string>([
  "64843", // Divine Hymn — Holy Priest
  "115310", // Revival — Mistweaver Monk
  "363534", // Rewind — Preservation Evoker
  "359816", // Dream Flight — Preservation Evoker
  "388615", // Restoral — Mistweaver Monk
  "325197", // Invoke Chi-Ji, the Red Crane — Mistweaver Monk
  "740", // Tranquility — Restoration Druid
  "108280", // Healing Tide Totem — Restoration Shaman
]);

/** True for team-wide healing CDs whose timeline context should be the lowest ally, not the caster. */
export function isTeamHealCD(spellId: string): boolean {
  return TEAM_HEAL_CD_IDS.has(spellId);
}

const ADDITIONAL_OVERLAP_DEFENSIVE_IDS = new Set<string>([
  "108416", // Dark Pact (Warlock)
  "5277", // Evasion (Rogue)
  "122783", // Diffuse Magic (Monk)
  "122278", // Dampen Harm (Monk)
  "184662", // Shield of Vengeance (Paladin)
  "145629", // Anti-Magic Zone (DK)
  "62618", // Power Word: Barrier (Priest)
  "374348", // Renewing Blaze (Evoker)
  "201633", // Earthen Wall Totem (Shaman)
  "98008", // Spirit Link Totem (Shaman)
  "196555", // Netherwalk (DH)
  "47536", // Rapture (Priest)
]);

const ALL_MAJOR_DEFENSIVE_IDS = new Set<string>([
  ...MAJOR_DEFENSIVE_IDS,
  ...ADDITIONAL_OVERLAP_DEFENSIVE_IDS,
]);

/**
 * Spell IDs that can be cast while the player is stunned or otherwise CC'd.
 * Used to avoid blaming players for "unused" defensives when they were locked out.
 */
export const USABLE_WHILE_CC_SPELL_IDS = new Set<string>([
  "33206", // Pain Suppression
  "22812", // Barkskin
  "47585", // Dispersion
  "642", // Divine Shield
  "55233", // Vampiric Blood
  "48792", // Icebound Fortitude
]);

/**
 * Forbearance: Paladin's Divine Shield / Lay on Hands / Blessing of Protection / Blessing of Spellwarding
 * share a 30s lockout. A defensive that reads "available" by its own cooldown is UNCASTABLE on the paladin
 * if they self-applied Forbearance within the last 30s — so it must not be listed as "unused"/"available"
 * at a death (false accusation). Forbearance is not reliably logged as an aura, so detect it from the
 * applying cast: Divine Shield always self-applies; the ally-castable ones self-apply only when cast on self.
 */
export const FORBEARANCE_SECONDS = 30;
export const FORBEARANCE_GATED_IDS = new Set<string>([
  "642",
  "633",
  "1022",
  "204018",
]); // DivineShield, LayOnHands, BoP, Spellwarding
export function selfForbearanceActiveAt(
  unit: ICombatUnit,
  allUnits: ICombatUnit[],
  atSeconds: number,
  matchStartMs: number,
): boolean {
  for (const u of allUnits) {
    for (const cast of u.spellCastEvents ?? []) {
      if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (!cast.spellId || !FORBEARANCE_GATED_IDS.has(cast.spellId)) continue;
      const castSec = (cast.timestamp - matchStartMs) / 1000;
      if (castSec > atSeconds || atSeconds - castSec > FORBEARANCE_SECONDS)
        continue;
      if (cast.spellId === "642") {
        if (u.id === unit.id) return true;
      } else {
        if (cast.destUnitId === unit.id) return true;
      }
    }
  }
  return false;
}

// All spells tagged 'Offensive' in classMetadata — used to detect active enemy burst windows
const OFFENSIVE_SPELL_IDS = new Set<string>(
  classMetadata.flatMap((cls) =>
    cls.abilities
      .filter((a) => a.tags.includes(SpellTag.Offensive))
      .map((a) => a.spellId),
  ),
);

/** Only track cooldowns at or above this threshold */
const MIN_CD_SECONDS = 30;

/**
 * Passive proc spells that emit SPELL_CAST_SUCCESS but are not intentional player casts.
 * Filtering these removes noise from the [YOU] [CAST] timeline.
 */
export const PASSIVE_SPELL_BLOCKLIST = new Set([
  "Reclamation",
  "Infusion of Light",
  "Ysera's Gift",
  "Nature's Vigor",
  "Resounding Voice",
  "Eminence",
  "Awakening",
  "Divine Purpose",
]);

/**
 * Spec-exclusive spells: if a spell ID appears here, it is only valid for the listed specs.
 * Any other spec that shares the same class will have this spell filtered out.
 * Covers all tagged (Offensive/Defensive/Control) spells in classMetadata that are
 * listed under a spec-specific comment block.
 */
const SPEC_EXCLUSIVE_SPELLS: Record<string, CombatUnitSpec[]> = {
  // Druid
  "102560": [CombatUnitSpec.Druid_Balance], // Incarnation: Chosen of Elune
  "194223": [CombatUnitSpec.Druid_Balance], // Celestial Alignment
  "102543": [CombatUnitSpec.Druid_Feral], // Incarnation: King of the Jungle
  "106839": [CombatUnitSpec.Druid_Feral], // Skull Bash
  "106951": [CombatUnitSpec.Druid_Feral], // Berserk
  "102558": [CombatUnitSpec.Druid_Guardian], // Incarnation: Guardian of Ursoc
  "18562": [CombatUnitSpec.Druid_Restoration], // Swiftmend
  "33891": [CombatUnitSpec.Druid_Restoration], // Incarnation: Tree of Life
  "102342": [CombatUnitSpec.Druid_Restoration], // Ironbark
  "236696": [CombatUnitSpec.Druid_Restoration], // Thorns
  "740": [CombatUnitSpec.Druid_Restoration], // Tranquility
  // Monk
  "115203": [CombatUnitSpec.Monk_BrewMaster], // Fortifying Brew
  "122470": [CombatUnitSpec.Monk_Windwalker], // Touch of Karma
  "123904": [CombatUnitSpec.Monk_Windwalker], // Invoke Xuen, the White Tiger
  "137639": [CombatUnitSpec.Monk_Windwalker], // Storm, Earth, and Fire
  "201318": [CombatUnitSpec.Monk_Windwalker], // Fortifying Elixir
  "116849": [CombatUnitSpec.Monk_Mistweaver], // Life Cocoon
  // Paladin
  "498": [CombatUnitSpec.Paladin_Holy], // Divine Protection
  "6940": [CombatUnitSpec.Paladin_Holy], // Blessing of Sacrifice
  "199448": [CombatUnitSpec.Paladin_Holy], // Blessing of Sacrifice
  "210294": [CombatUnitSpec.Paladin_Holy], // Divine Favor
  "31821": [CombatUnitSpec.Paladin_Holy], // Aura Mastery
  "216331": [CombatUnitSpec.Paladin_Holy], // Avenging Crusader
  "86659": [CombatUnitSpec.Paladin_Protection], // Guardian of Ancient Kings
  "337851": [CombatUnitSpec.Paladin_Protection], // Guardian of Ancient Kings
  "337852": [CombatUnitSpec.Paladin_Protection], // Reign of Ancient Kings
  "228049": [CombatUnitSpec.Paladin_Protection], // Guardian of the Forgotten Queen
  "31850": [CombatUnitSpec.Paladin_Protection], // Ardent Defender
  // Priest
  "33206": [CombatUnitSpec.Priest_Discipline], // Pain Suppression
  "47536": [CombatUnitSpec.Priest_Discipline], // Rapture
  "62618": [CombatUnitSpec.Priest_Discipline], // Power Word: Barrier
  "81782": [CombatUnitSpec.Priest_Discipline], // Power Word: Barrier
  "197871": [CombatUnitSpec.Priest_Discipline], // Dark Archangel
  "19236": [CombatUnitSpec.Priest_Holy], // Desperate Prayer
  "196762": [CombatUnitSpec.Priest_Holy], // Inner Focus
  "200183": [CombatUnitSpec.Priest_Holy], // Apotheosis
  "47788": [CombatUnitSpec.Priest_Holy], // Guardian Spirit
  "64843": [CombatUnitSpec.Priest_Holy], // Divine Hymn
  "47585": [CombatUnitSpec.Priest_Shadow], // Dispersion
  "64044": [CombatUnitSpec.Priest_Shadow], // Psychic Horror
  // Warlock
  "113860": [CombatUnitSpec.Warlock_Affliction], // Dark Soul: Misery
  "113858": [CombatUnitSpec.Warlock_Destruction], // Dark Soul: Instability
  // Rogue
  "5277": [CombatUnitSpec.Rogue_Assassination], // Evasion
  "36554": [CombatUnitSpec.Rogue_Assassination], // Shadowstep
  "79140": [CombatUnitSpec.Rogue_Assassination], // Vendetta/Deathmark
  "1776": [CombatUnitSpec.Rogue_Outlaw], // Gouge
  "2094": [CombatUnitSpec.Rogue_Outlaw], // Blind
  "13750": [CombatUnitSpec.Rogue_Outlaw], // Adrenaline Rush
  "51690": [CombatUnitSpec.Rogue_Outlaw], // Killing Spree
  "121471": [CombatUnitSpec.Rogue_Subtlety], // Shadow Blades
  "185313": [CombatUnitSpec.Rogue_Subtlety], // Shadow Dance
  "185422": [CombatUnitSpec.Rogue_Subtlety], // Shadow Dance
  "207736": [CombatUnitSpec.Rogue_Subtlety], // Shadowy Duel
  "212182": [CombatUnitSpec.Rogue_Subtlety], // Smoke Bomb
  "213981": [CombatUnitSpec.Rogue_Subtlety], // Cold Blood
  // Shaman
  "191634": [CombatUnitSpec.Shaman_Elemental], // Stormkeeper
  "58875": [CombatUnitSpec.Shaman_Enhancement], // Spirit Walk
  "98008": [CombatUnitSpec.Shaman_Restoration], // Spirit Link Totem
  "204293": [CombatUnitSpec.Shaman_Restoration], // Spirit Link
  "204336": [
    CombatUnitSpec.Shaman_Elemental,
    CombatUnitSpec.Shaman_Enhancement,
    CombatUnitSpec.Shaman_Restoration,
  ], // Grounding Totem
  // Mage
  "12042": [CombatUnitSpec.Mage_Arcane], // Arcane Power
  "205025": [CombatUnitSpec.Mage_Arcane], // Presence of Mind
  "190319": [CombatUnitSpec.Mage_Fire], // Combustion
  "12472": [CombatUnitSpec.Mage_Frost], // Icy Veins
  // Hunter
  "19574": [CombatUnitSpec.Hunter_BeastMastery], // Bestial Wrath
  "19386": [CombatUnitSpec.Hunter_BeastMastery], // Wyvern Sting
  "24394": [CombatUnitSpec.Hunter_BeastMastery], // Intimidation
  "19577": [CombatUnitSpec.Hunter_BeastMastery], // Intimidation
  "213691": [CombatUnitSpec.Hunter_Marksmanship], // Scatter Shot
  // Demon Hunter
  "211881": [CombatUnitSpec.DemonHunter_Havoc], // Fel Eruption
  "207684": [CombatUnitSpec.DemonHunter_Vengeance], // Sigil of Misery
  // Death Knight
  "55233": [CombatUnitSpec.DeathKnight_Blood], // Vampiric Blood
  "49028": [CombatUnitSpec.DeathKnight_Blood], // Dancing Rune Weapon
  "108199": [CombatUnitSpec.DeathKnight_Blood], // Gorefiend's Grasp
  "221562": [CombatUnitSpec.DeathKnight_Blood], // Asphyxiate (Blood)
  "51271": [CombatUnitSpec.DeathKnight_Frost], // Pillar of Frost
  "47568": [CombatUnitSpec.DeathKnight_Frost], // Empower Rune Weapon
  "279302": [CombatUnitSpec.DeathKnight_Frost], // Frostwyrm's Fury
  "196770": [CombatUnitSpec.DeathKnight_Frost], // Remorseless Winter
  "152279": [CombatUnitSpec.DeathKnight_Frost], // Breath of Sindragosa
  "42650": [CombatUnitSpec.DeathKnight_Unholy], // Army of the Dead
  "49206": [CombatUnitSpec.DeathKnight_Unholy], // Summon Gargoyle
  "220143": [CombatUnitSpec.DeathKnight_Unholy], // Apocalypse
  "108194": [CombatUnitSpec.DeathKnight_Unholy], // Asphyxiate (Unholy)
  // Evoker
  "375087": [CombatUnitSpec.Evoker_Devastation], // Dragonrage
  "363916": [
    CombatUnitSpec.Evoker_Devastation,
    CombatUnitSpec.Evoker_Preservation,
    CombatUnitSpec.Evoker_Augmentation,
  ], // Obsidian Scales
  "359816": [CombatUnitSpec.Evoker_Preservation], // Dream Flight
  "363534": [CombatUnitSpec.Evoker_Preservation], // Rewind
  "370960": [CombatUnitSpec.Evoker_Preservation], // Emerald Communion
  "370537": [CombatUnitSpec.Evoker_Preservation], // Stasis
  "370665": [CombatUnitSpec.Evoker_Preservation], // Rescue
  "403631": [CombatUnitSpec.Evoker_Augmentation], // Breath of Eons
  "404977": [CombatUnitSpec.Evoker_Augmentation], // Time Skip
  "360828": [CombatUnitSpec.Evoker_Augmentation], // Blistering Scales
};

/** Ignore available windows shorter than this (e.g. just before match ends) */
const GRACE_SECONDS = 3;

export type DefensiveTimingLabel =
  "Optimal" | "Early" | "Late" | "Reactive" | "Unknown";

export interface ICooldownCast {
  timeSeconds: number;
  /** Timing classification relative to enemy burst activity. Only set for Defensive/External CDs. */
  timingLabel?: DefensiveTimingLabel;
  /** One-line reason for the timing label */
  timingContext?: string;
  /** HP% of the target unit at cast time, 0–100, when available from advanced logging */
  targetHpPct?: number;
  /** Name of the unit the spell was cast on (from destUnitName), when available */
  targetName?: string;
}

/**
 * Shared HP sampling radius for prompt-rendered HP claims (B4 residual fix,
 * 2026-07-14 audit). Every renderer that prints an HP% for a specific instant
 * ([STATE] baseline ticks, [DMG SPIKE] endpoints, death HP-trajectory
 * checkpoints, burst most-pressured readings) must sample within this radius
 * of the claimed instant, or print nothing — otherwise two lines about the
 * same second can disagree and force the model to guess which is real.
 */
export const HP_SAMPLE_RADIUS_MS = 3_000;

/*
 * 曾经这里还有一个 HP_SAMPLE_RADIUS_CRITICAL_MS = 1500(关键窗口收窄半径)
 * 和取值谓词 hpSampleRadiusMs()。2026-07-20 已整套删除,理由记在这里,免得
 * 有人凭「关键时刻该用更新鲜的读数」的直觉再加回来:
 *
 * 1. **它没修好它声称要修的问题。** 当初以为「同秒两行 HP 打架」源于两侧半径
 *    不同,于是把半径收敛成共享谓词 —— 实测 26/50 → 26/50,一个数都没动。
 *    因为 getUnitHpAtTimestamp 是先取最近样本、再用半径决定接受与否:改半径
 *    只能把值变成 null,**永远不会改变取到的数值**。真根因是查询时刻不在同一
 *    网格(见 toRenderSecond),对齐时刻后才归零。
 * 2. **它与既有机制冗余。** 「密集 tick 重复取样」早就由 STATE 的发射门解决了
 *    (HP 变化 ≥10% 或状态改变才出行),那是行级去重,不需要靠丢数据实现。
 * 3. **它主动损失覆盖,且损失在最要紧的地方。** 实测 24/50 场里,±1.5s 把
 *    单位整个从 [STATE] 行删掉,而关键窗口正是模型最需要完整队伍血线的时刻。
 *    被删掉的恰恰是 advancedActions 稀疏的单位 —— 也就是没在挨打的人,他们
 *    的 HP 本来就平稳,±3s 的读数对他们完全准确。
 *
 * 结论:全程统一用 HP_SAMPLE_RADIUS_MS。要提升新鲜度请改发射门或采样源,
 * 不要再引入第二个半径。
 */

/**
 * Returns the HP% (0–100) of `unit` at the given timestamp by finding the nearest
 * advancedAction where advancedActorId === unit.id. Returns null when no data exists.
 */
export function getUnitHpAtTimestamp(
  unit: ICombatUnit,
  timestampMs: number,
  maxDtMs = 10_000,
): number | null {
  const closestAction = binarySearchClosest(
    unit.advancedActions,
    timestampMs,
    (a) => a.logLine.timestamp,
  );

  if (!closestAction) {
    return null;
  }

  if (closestAction.advancedActorId !== unit.id) {
    return null;
  }

  if (closestAction.advancedActorMaxHp <= 0) {
    return null;
  }

  const dt = Math.abs(closestAction.logLine.timestamp - timestampMs);
  if (dt > maxDtMs) {
    return null;
  }

  return Math.round(
    (closestAction.advancedActorCurrentHp / closestAction.advancedActorMaxHp) *
      100,
  );
}

/**
 * Returns the power state (current/max) of `unit` for a specific power type
 * (defaults to Mana) at the given timestamp by finding the nearest advancedAction.
 * Returns null when no data exists.
 */
export function getUnitManaAtTimestamp(
  unit: ICombatUnit,
  timestampMs: number,
  maxDtMs = 10_000,
): { current: number; max: number } | null {
  const closestAction = binarySearchClosest(
    unit.advancedActions,
    timestampMs,
    (a) => a.logLine.timestamp,
  );

  if (!closestAction) {
    return null;
  }

  if (closestAction.advancedActorId !== unit.id) {
    return null;
  }

  const manaPower = closestAction.advancedActorPowers.find(
    (p) => p.type === CombatUnitPowerType.Mana,
  );
  if (!manaPower) {
    return null;
  }

  const dt = Math.abs(closestAction.logLine.timestamp - timestampMs);
  if (dt > maxDtMs) {
    return null;
  }

  return { current: manaPower.current, max: manaPower.max };
}

/**
 * Computes overall healing metrics (HPS and Overheal %) for a unit across a given duration.
 */
export function computeOverallHealingMetrics(
  unit: ICombatUnit,
  matchStartMs: number,
  matchEndMs: number,
): { hps: number; overhealPct: number } {
  const durationSeconds = (matchEndMs - matchStartMs) / 1000;
  if (durationSeconds <= 0) return { hps: 0, overhealPct: 0 };

  let totalAmount = 0;
  let totalEffective = 0;
  for (const h of unit.healOut) {
    if (
      h.logLine.timestamp >= matchStartMs &&
      h.logLine.timestamp <= matchEndMs
    ) {
      totalAmount += h.amount;
      totalEffective += h.effectiveAmount;
    }
  }

  const hps = totalEffective / durationSeconds;
  const overhealPct =
    totalAmount > 0
      ? Math.round(((totalAmount - totalEffective) / totalAmount) * 100)
      : 0;
  return { hps, overhealPct };
}

export interface IAvailableWindow {
  fromSeconds: number;
  toSeconds: number;
  durationSeconds: number;
}

export interface IMajorCooldownInfo {
  spellId: string;
  spellName: string;
  tag: string;
  cooldownSeconds: number;
  /** Observed maximum charge count. >1 when casts occur faster than a single charge allows (e.g. double Pain Suppression via PvP talent). */
  maxChargesDetected: number;
  casts: ICooldownCast[];
  /** Periods when the CD was available but the player did not use it */
  availableWindows: IAvailableWindow[];
  neverUsed: boolean;
  /** True when the spell is also tagged Offensive (a throughput/burst CD such as Power
   * Infusion), i.e. not a pure survival defensive. Used to keep throughput CDs out of
   * "cheaper defensive available" suggestions. Optional for back-compat with hand-built
   * fixtures; production always sets it. */
  isThroughput?: boolean;
}

/**
 * For a given unit, return all class-tagged major cooldowns (>= 30s) with
 * cast times and idle availability windows derived from the combat log.
 */
export function extractMajorCooldowns(
  unit: ICombatUnit,
  combat: AtomicArenaCombat,
): IMajorCooldownInfo[] {
  const matchStartMs = combat.startTime;
  const matchEndMs = combat.endTime;
  const matchDurationSeconds = (matchEndMs - matchStartMs) / 1000;

  const classData = classMetadata.find((c) => c.unitClass === unit.class);
  if (!classData) return [];

  if (unit.class === CombatUnitClass.Priest) {
    const hasUP1 = classData.abilities.some((a) => a.spellId === "421116");
    if (!hasUP1) {
      classData.abilities.push({
        spellId: "421116",
        name: "Ultimate Penitence",
        tags: [SpellTag.Defensive],
      });
    }
    const hasUP2 = classData.abilities.some((a) => a.spellId === "421453");
    if (!hasUP2) {
      classData.abilities.push({
        spellId: "421453",
        name: "Ultimate Penitence",
        tags: [SpellTag.Defensive],
      });
    }
  }

  const specIdNum = parseInt(unit.spec, 10);
  const specTalentTreeSpellInfo = getSpecTalentTreeSpellInfo(specIdNum);
  const specTalentTreeSpellIds = new Set(specTalentTreeSpellInfo.keys());
  const talentedSpellInfo = unit.info?.talents
    ? getPlayerTalentedSpellInfo(specIdNum, unit.info.talents)
    : null;
  const talentedSpellIds = talentedSpellInfo
    ? new Set(talentedSpellInfo.keys())
    : null;
  // PvP talents selected by this player (spell IDs). Available when COMBATANT_INFO is present.
  const pvpTalentIds = new Set<string>(unit.info?.pvpTalents ?? []);
  const hasCombatantInfo = unit.info !== undefined;
  // Build a fast lookup of all spell IDs the player actually cast this match.
  const castSpellIds = new Set<string>(
    unit.spellCastEvents
      .filter((e) => e.logLine.event === LogEvent.SPELL_CAST_SUCCESS)
      .map((e) => e.spellId)
      .filter((id): id is string => id !== null),
  );

  // Keep only tagged spells with cooldown data >= MIN_CD_SECONDS that belong to the owner's spec
  const seen = new Set<string>();
  const majorSpells = classData.abilities.filter((spell) => {
    if (seen.has(spell.spellId)) return false;
    if (spell.tags.length === 0) return false;
    const effectData = spellEffectData[spell.spellId];
    if (!effectData) return false;
    const cd =
      effectData.cooldownSeconds ??
      effectData.charges?.chargeCooldownSeconds ??
      0;
    if (cd < MIN_CD_SECONDS) return false;
    const allowedSpecs = SPEC_EXCLUSIVE_SPELLS[spell.spellId];
    if (allowedSpecs && !allowedSpecs.includes(unit.spec)) return false;

    const isInTalentTree = specTalentTreeSpellIds.has(spell.spellId);

    if (isInTalentTree) {
      // Regular/hero talent — filter out if the player didn't take it.
      if (talentedSpellIds !== null && !talentedSpellIds.has(spell.spellId)) {
        return false;
      }
      // If talent data failed to parse (talentedSpellIds null) but COMBATANT_INFO is present,
      // require cast evidence to avoid including talents the player didn't actually take.
      if (
        talentedSpellIds === null &&
        hasCombatantInfo &&
        !castSpellIds.has(spell.spellId)
      ) {
        return false;
      }
    } else if (hasCombatantInfo) {
      // Not in the regular talent tree — could be a PvP talent or a true baseline ability.
      // Accept if: (a) the player selected it as a PvP talent, OR (b) they actually cast it
      // this match (proof they have it regardless of talent source).
      // This filters out PvP talents the player didn't pick while keeping baseline abilities
      // that were used. Baseline abilities that were never used and aren't PvP talents will be
      // silently excluded — acceptable trade-off to avoid false "never used X" reports.
      if (
        !pvpTalentIds.has(spell.spellId) &&
        !castSpellIds.has(spell.spellId)
      ) {
        return false;
      }
    }

    seen.add(spell.spellId);
    return true;
  });

  // --- Dynamic Discovery ---
  // Add any active talent spell with CD >= 30s that wasn't already in the static list.
  if (talentedSpellInfo) {
    for (const [spellId, info] of talentedSpellInfo.entries()) {
      if (seen.has(spellId)) continue;
      // Only discover buttons (active nodes). Passives are handled via CD_TALENT_MODIFIERS.
      if (info.type !== "active") continue;

      const effectData = spellEffectData[spellId];
      if (!effectData) continue;

      const cd =
        effectData.cooldownSeconds ??
        effectData.charges?.chargeCooldownSeconds ??
        0;
      if (cd >= MIN_CD_SECONDS) {
        // Intelligent tagging based on name pattern rules
        const name = effectData.name.toLowerCase();
        const tags: SpellTag[] = [];

        for (const rule of DISCOVERY_TAG_RULES) {
          if (rule.pattern.test(name)) {
            tags.push(...rule.tags);
          }
        }

        // If we found a tag, it's a "Major CD" for analysis purposes.
        if (tags.length > 0) {
          majorSpells.push({ spellId, name: effectData.name, tags });
          seen.add(spellId);
        }
      }
    }
  }

  return majorSpells.flatMap((spell) => {
    const effectData = spellEffectData[spell.spellId];
    if (!effectData) return [];

    let cooldownSeconds =
      effectData.cooldownSeconds ??
      effectData.charges?.chargeCooldownSeconds ??
      0;
    let baselineCharges = effectData.charges?.charges ?? 1;

    // Apply talent-based modifications if the player's talents are known
    const modifiers = CD_TALENT_MODIFIERS[spell.spellId];
    if (modifiers && (talentedSpellIds || pvpTalentIds.size > 0)) {
      for (const mod of modifiers) {
        if (
          talentedSpellIds?.has(mod.talentSpellId) ||
          pvpTalentIds.has(mod.talentSpellId)
        ) {
          if (mod.effect === "extra_charge") {
            baselineCharges += mod.value;
          } else if (mod.effect === "reduce_cd") {
            cooldownSeconds -= mod.value;
          }
        }
      }
    }

    const castEvents = unit.spellCastEvents.filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        (e.spellId === spell.spellId ||
          // Variant cast ids (form-specific Stampeding Roar, talent-modified
          // Blessing of Sacrifice / Oppressing Roar, …) log a different id
          // with the same English name. Exact-id matching stamped 15/1245
          // prompts' real casts [UNUSED] and emitted bogus "available all
          // match" windows (invariant sweep I1, 2026-07-16).
          (!!e.spellId && getEnglishSpellName(e.spellId, "") === spell.name)),
    );

    const isDefOrExternal =
      spell.tags.includes(SpellTag.Defensive) ||
      (spell.tags as string[]).includes("External");
    const isControl = spell.tags.includes(SpellTag.Control);

    const rawCasts: ICooldownCast[] = castEvents
      .filter((e) => !e.spellName || !PASSIVE_SPELL_BLOCKLIST.has(e.spellName))
      .map((e) => {
        const timeSeconds = (e.logLine.timestamp - matchStartMs) / 1000;
        const cast: ICooldownCast = { timeSeconds };
        if (
          (isDefOrExternal || isControl) &&
          e.destUnitId &&
          e.destUnitName &&
          e.destUnitName !== "nil"
        ) {
          cast.targetName = e.destUnitName;
          const targetUnit = combat.units[e.destUnitId];
          if (targetUnit) {
            // 这个值最终渲染在 `[CD] … → 目标 (N% HP)` 里,与同秒 [STATE] 并列。
            // 曾用原始日志毫秒 + 独立的 2s 半径采样(第三条 HP 路径),于是同一
            // 显示秒下两个 HP 打架(C 类)。归到渲染网格 + 共享半径常量。
            const hp = getUnitHpAtTimestamp(
              targetUnit,
              matchStartMs + toRenderSecond(timeSeconds) * 1000,
              HP_SAMPLE_RADIUS_MS,
            );
            if (hp !== null) cast.targetHpPct = hp;
          }
        }
        return cast;
      })
      .sort((a, b) => a.timeSeconds - b.timeSeconds);

    const casts: ICooldownCast[] = [];
    for (const c of rawCasts) {
      const last = casts[casts.length - 1];
      if (!last || c.timeSeconds - last.timeSeconds > 2) {
        casts.push(c);
      }
    }

    const availableWindows: IAvailableWindow[] = [];

    const pushWindow = (from: number, to: number) => {
      const duration = to - from;
      if (duration > GRACE_SECONDS) {
        availableWindows.push({
          fromSeconds: from,
          toSeconds: to,
          durationSeconds: duration,
        });
      }
    };

    if (casts.length === 0) {
      // Never used — available the entire match
      pushWindow(0, matchDurationSeconds);
    } else {
      // Window before first cast
      if (casts[0].timeSeconds > GRACE_SECONDS) {
        pushWindow(0, casts[0].timeSeconds);
      }
      // Windows between casts (and from last cast to match end)
      for (let i = 0; i < casts.length; i++) {
        const cdReadyAt = casts[i].timeSeconds + cooldownSeconds;
        const nextCastAt =
          i + 1 < casts.length
            ? casts[i + 1].timeSeconds
            : matchDurationSeconds;
        if (cdReadyAt < matchDurationSeconds - GRACE_SECONDS) {
          pushWindow(cdReadyAt, nextCastAt);
        }
      }
    }

    // Detect observed charge count: if any two consecutive casts are closer than the CD,
    // the player must have had at least 2 charges (e.g. double Pain Suppression via PvP talent).
    let maxChargesDetected = Math.max(1, baselineCharges);
    for (let i = 1; i < casts.length; i++) {
      if (casts[i].timeSeconds - casts[i - 1].timeSeconds < cooldownSeconds) {
        maxChargesDetected = Math.max(maxChargesDetected, 2);
      }
    }

    return [
      {
        spellId: spell.spellId,
        spellName: spell.name,
        tag: spell.tags[0] as string,
        cooldownSeconds,
        maxChargesDetected,
        casts,
        availableWindows,
        neverUsed: casts.length === 0,
        isThroughput: spell.tags.includes(SpellTag.Offensive),
      },
    ];
  });
}

/**
 * B138: spells that carry a Defensive tag but are NOT damage-mitigation/heal substitutes — mobility,
 * dispels, single-spell reflects, and utility. Suggesting one as a "cheaper alternative" to a major
 * survival CD is misleading (e.g. "you could have used Spirit Walk / Cauterizing Flame instead of
 * Emerald Communion"): they neither reduce damage taken nor heal, so they can't cover the same need.
 */
const NON_SUBSTITUTE_DEFENSIVE_IDS = new Set<string>([
  "374251", // Cauterizing Flame (Evoker) — dispel
  "370665", // Rescue (Evoker) — mobility / reposition
  "58875", // Spirit Walk (Shaman) — mobility / snare break
  "106898", // Stampeding Roar (Druid) — group mobility
  "77761", // Stampeding Roar (Bear form variant)
  "77764", // Stampeding Roar (Cat form variant)
  "370537", // Stasis (Evoker) — spell storage utility
  "204336", // Grounding Totem (Shaman) — single-spell reflect
  "8178", // Grounding Totem (older id)
  "79206", // Spiritwalker's Grace (Shaman) — cast-while-moving utility
]);

/**
 * Self throughput-EMPOWER CDs that are tagged 'Defensive' in classMetadata but are NOT survival responses —
 * they empower the caster's own throughput (e.g. Apotheosis empowers Holy Words to pump team healing). There
 * is no "cheaper" substitute for the empower and a self-heal cannot replace it, so they must never receive a
 * `cheaper available:` note. Follow-up to B138/B142 (surfaced by the 2026-07-02 meta-eval).
 */
export const THROUGHPUT_EMPOWER_DEFENSIVE_IDS = new Set<string>([
  "200183", // Apotheosis (Holy Priest) — empowers Holy Words; not a survival cooldown
]);

/**
 * F166 / review C2: given a defensive cast `cd`, return the names of strictly-cheaper
 * (shorter-cooldown) defensive tools that were available at `atSeconds`.
 *
 * Throughput cooldowns (Offensive-tagged, e.g. Power Infusion) are excluded — a healer
 * burning a survival CD did not have a "cheaper" alternative in a burst/throughput CD,
 * and suggesting one is misleading. The cast itself and tools on cooldown are excluded.
 * B138: mobility/dispel/utility "defensives" (NON_SUBSTITUTE_DEFENSIVE_IDS) are also excluded —
 * they can't substitute for a damage-mitigation/heal cooldown.
 */
export function findCheaperDefensiveAlternatives(
  cd: IMajorCooldownInfo,
  ownerCDs: IMajorCooldownInfo[],
  atSeconds: number,
  opts: { castTargetIsTeammate?: boolean } = {},
): string[] {
  return ownerCDs
    .filter(
      (other) =>
        other.spellId !== cd.spellId &&
        (other.tag === "Defensive" || other.tag === "External") &&
        !other.isThroughput &&
        !NON_SUBSTITUTE_DEFENSIVE_IDS.has(other.spellId) &&
        other.cooldownSeconds < cd.cooldownSeconds &&
        other.availableWindows.some(
          (w) => atSeconds >= w.fromSeconds && atSeconds <= w.toSeconds,
        ) &&
        // H11: a self-only tool can't help a teammate — only suggest it when the cast that's
        // being annotated targeted the owner themself.
        (!opts.castTargetIsTeammate ||
          EXTERNAL_DEFENSIVE_IDS.has(other.spellId)),
    )
    .map((other) => other.spellName);
}

// Minimal shape of IEnemyCDTimeline needed for timing classification.
// Defined locally to avoid a circular import (enemyCDs.ts already imports from cooldowns.ts).
interface IBurstWindow {
  fromSeconds: number;
  toSeconds: number;
}
interface ISingleEnemyCDCast {
  spellName: string;
  castTimeSeconds: number;
  buffEndSeconds: number;
}
export interface IEnemyCDTimelineForTiming {
  alignedBurstWindows: IBurstWindow[];
  players: Array<{ offensiveCDs: ISingleEnemyCDCast[] }>;
}

/** How many seconds before a burst window a defensive can be cast and still be "Early/pre-wall" */
const PRE_WALL_SECONDS = 5;
/** How many seconds after a burst window ends before a defensive is classified "Late" */
const LATE_WINDOW_SECONDS = 8;
/** Damage curve window for fallback classification */
const TIMING_DAMAGE_WINDOW_S = 3;
/** Ratio threshold: if damage before cast is this much higher than after, classify as Reactive */
const REACTIVE_RATIO = 1.75;

// SpellTag.External was removed from the enum — use the string literal so this compiles
// under any tsconfig target. No spells currently carry the 'External' tag, but the set
// is kept for future-proofing (externals like Pain Suppression are tagged Defensive).
export const DEFENSIVE_TAGS = new Set<string>([SpellTag.Defensive, "External"]);

/**
 * Annotates each cast on Defensive/External cooldowns with a timing label:
 *   Optimal — cast during an aligned burst window
 *   Early   — cast within PRE_WALL_SECONDS before a burst window (pre-wall, may be intentional)
 *   Late    — cast within LATE_WINDOW_SECONDS after a burst window ended
 *   Reactive — no nearby burst window, but damage curve shows the spike already peaked at cast time
 *   Unknown — no burst signal and no clear damage curve pattern
 *
 * Offensive CDs are left unlabelled (timingLabel stays undefined).
 * Mutates the cast objects in-place and returns the same array.
 */
export function annotateDefensiveTimings(
  cooldowns: IMajorCooldownInfo[],
  unit: ICombatUnit,
  combat: AtomicArenaCombat,
  enemyCDTimeline: IEnemyCDTimelineForTiming,
): IMajorCooldownInfo[] {
  const matchStartMs = combat.startTime;

  const allSingleCDs = enemyCDTimeline.players.flatMap((p) => p.offensiveCDs);

  for (const cd of cooldowns) {
    if (!DEFENSIVE_TAGS.has(cd.tag)) continue;

    for (const cast of cd.casts) {
      const t = cast.timeSeconds;

      // ── 1. Aligned burst window ────────────────────────────────────────────
      let bestAligned: { label: DefensiveTimingLabel; context: string } | null =
        null;
      for (const w of enemyCDTimeline.alignedBurstWindows) {
        if (t >= w.fromSeconds && t <= w.toSeconds) {
          bestAligned = {
            label: "Optimal",
            context: `cast during burst window ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)}`,
          };
          break; // Optimal is the highest tier, stop searching
        }
        if (t >= w.fromSeconds - PRE_WALL_SECONDS && t < w.fromSeconds) {
          if (!bestAligned || bestAligned.label === "Late") {
            bestAligned = {
              label: "Early",
              context: `cast ${(w.fromSeconds - t).toFixed(1)}s before burst window at ${fmtTime(w.fromSeconds)} — possible pre-wall`,
            };
          }
        }
        if (t > w.toSeconds && t <= w.toSeconds + LATE_WINDOW_SECONDS) {
          if (!bestAligned) {
            bestAligned = {
              label: "Late",
              context: `cast ${(t - w.toSeconds).toFixed(1)}s after burst window ended at ${fmtTime(w.toSeconds)}`,
            };
          }
        }
      }

      if (bestAligned) {
        cast.timingLabel = bestAligned.label;
        cast.timingContext = bestAligned.context;
        continue;
      }

      // ── 2. Single-enemy offensive CD active during cast ────────────────────
      let bestSingle: { label: DefensiveTimingLabel; context: string } | null =
        null;
      for (const ec of allSingleCDs) {
        if (t >= ec.castTimeSeconds && t <= ec.buffEndSeconds) {
          bestSingle = {
            label: "Optimal",
            context: `cast during enemy ${ec.spellName} active ${fmtTime(ec.castTimeSeconds)}–${fmtTime(ec.buffEndSeconds)}`,
          };
          break; // Optimal stops search
        }
        if (
          t >= ec.castTimeSeconds - PRE_WALL_SECONDS &&
          t < ec.castTimeSeconds
        ) {
          if (!bestSingle || bestSingle.label === "Late") {
            bestSingle = {
              label: "Early",
              context: `cast ${(ec.castTimeSeconds - t).toFixed(1)}s before enemy ${ec.spellName} at ${fmtTime(ec.castTimeSeconds)} — possible pre-wall`,
            };
          }
        }
        if (
          t > ec.buffEndSeconds &&
          t <= ec.buffEndSeconds + LATE_WINDOW_SECONDS
        ) {
          if (!bestSingle) {
            bestSingle = {
              label: "Late",
              context: `cast ${(t - ec.buffEndSeconds).toFixed(1)}s after enemy ${ec.spellName} expired at ${fmtTime(ec.buffEndSeconds)}`,
            };
          }
        }
      }

      if (bestSingle) {
        cast.timingLabel = bestSingle.label;
        cast.timingContext = bestSingle.context;
        continue;
      }

      // ── 3. Damage curve fallback ───────────────────────────────────────────
      // NOTE: `unit.damageIn` refers to damage taken by the caster. For External CDs
      // (e.g. Blessing of Sacrifice on an ally), this will check the Paladin's damage,
      // not the friendly target's damage. (Target resolution is tracked in overlaps, not here).
      const castMs = matchStartMs + t * 1000;
      const dmgBefore = unit.damageIn
        .filter(
          (d) =>
            d.logLine.timestamp >= castMs - TIMING_DAMAGE_WINDOW_S * 1000 &&
            d.logLine.timestamp < castMs,
        )
        .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
      const dmgAfter = unit.damageIn
        .filter(
          (d) =>
            d.logLine.timestamp >= castMs &&
            d.logLine.timestamp < castMs + TIMING_DAMAGE_WINDOW_S * 1000,
        )
        .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);

      if (
        dmgBefore > 50_000 &&
        dmgAfter > 0 &&
        dmgBefore > dmgAfter * REACTIVE_RATIO
      ) {
        cast.timingLabel = "Reactive";
        cast.timingContext = `damage spike appeared to peak before cast (${Math.round(dmgBefore / 1000)}k in 3s before vs ${Math.round(dmgAfter / 1000)}k after)`;
      } else {
        cast.timingLabel = "Unknown";
        cast.timingContext =
          "no enemy burst window or damage curve signal nearby";
      }
    }
  }

  return cooldowns;
}

/** Compute per-player incoming damage bucketed into 15-second intervals. */
export interface IDamageBucket {
  fromSeconds: number;
  toSeconds: number;
  totalDamage: number;
  targetName: string;
  targetSpec: string;
}

export function computePressureWindows(
  friendlyPlayers: ICombatUnit[],
  combat: AtomicArenaCombat,
  windowSeconds = 10,
  topN = 5,
): IDamageBucket[] {
  const matchStartMs = combat.startTime;
  const allSpikes: IDamageBucket[] = [];

  for (const player of friendlyPlayers) {
    const damageEvents = player.damageIn
      .map((a) => ({
        timeSec: (a.logLine.timestamp - matchStartMs) / 1000,
        amount: Math.abs(a.effectiveAmount),
      }))
      .sort((a, b) => a.timeSec - b.timeSec);

    // Two-pointer sliding window: O(n) — j only advances, windowDamage is updated incrementally
    let j = 0;
    let windowDamage = 0;
    for (let i = 0; i < damageEvents.length; i++) {
      while (
        j < damageEvents.length &&
        damageEvents[j].timeSec <= damageEvents[i].timeSec + windowSeconds
      ) {
        windowDamage += damageEvents[j].amount;
        j++;
      }
      allSpikes.push({
        fromSeconds: damageEvents[i].timeSec,
        toSeconds: damageEvents[i].timeSec + windowSeconds,
        totalDamage: windowDamage,
        targetName: player.name,
        targetSpec: specToString(player.spec),
      });
      // Remove the event at i as the left edge advances
      windowDamage -= damageEvents[i].amount;
    }
  }

  // Sort and deduplicate: keep only non-overlapping top-N spikes per target
  allSpikes.sort((a, b) => b.totalDamage - a.totalDamage);
  const distinctSpikes: IDamageBucket[] = [];
  for (const spike of allSpikes) {
    const overlaps = distinctSpikes.some(
      (s) =>
        s.targetName === spike.targetName &&
        Math.min(s.toSeconds, spike.toSeconds) -
          Math.max(s.fromSeconds, spike.fromSeconds) >
          0,
    );
    if (!overlaps) {
      distinctSpikes.push(spike);
      if (distinctSpikes.length >= topN) break;
    }
  }

  return distinctSpikes;
}

// ---------------------------------------------------------------------------
// Spec name helpers
// ---------------------------------------------------------------------------

export function specToString(spec: CombatUnitSpec): string {
  const map: Partial<Record<CombatUnitSpec, string>> = {
    [CombatUnitSpec.DeathKnight_Blood]: "Blood Death Knight",
    [CombatUnitSpec.DeathKnight_Frost]: "Frost Death Knight",
    [CombatUnitSpec.DeathKnight_Unholy]: "Unholy Death Knight",
    [CombatUnitSpec.DemonHunter_Havoc]: "Havoc Demon Hunter",
    [CombatUnitSpec.DemonHunter_Vengeance]: "Vengeance Demon Hunter",
    [CombatUnitSpec.DemonHunter_Devourer]: "Devourer Demon Hunter",
    [CombatUnitSpec.Druid_Balance]: "Balance Druid",
    [CombatUnitSpec.Druid_Feral]: "Feral Druid",
    [CombatUnitSpec.Druid_Guardian]: "Guardian Druid",
    [CombatUnitSpec.Druid_Restoration]: "Restoration Druid",
    [CombatUnitSpec.Hunter_BeastMastery]: "Beast Mastery Hunter",
    [CombatUnitSpec.Hunter_Marksmanship]: "Marksmanship Hunter",
    [CombatUnitSpec.Hunter_Survival]: "Survival Hunter",
    [CombatUnitSpec.Mage_Arcane]: "Arcane Mage",
    [CombatUnitSpec.Mage_Fire]: "Fire Mage",
    [CombatUnitSpec.Mage_Frost]: "Frost Mage",
    [CombatUnitSpec.Monk_BrewMaster]: "Brewmaster Monk",
    [CombatUnitSpec.Monk_Windwalker]: "Windwalker Monk",
    [CombatUnitSpec.Monk_Mistweaver]: "Mistweaver Monk",
    [CombatUnitSpec.Paladin_Holy]: "Holy Paladin",
    [CombatUnitSpec.Paladin_Protection]: "Protection Paladin",
    [CombatUnitSpec.Paladin_Retribution]: "Retribution Paladin",
    [CombatUnitSpec.Priest_Discipline]: "Discipline Priest",
    [CombatUnitSpec.Priest_Holy]: "Holy Priest",
    [CombatUnitSpec.Priest_Shadow]: "Shadow Priest",
    [CombatUnitSpec.Rogue_Assassination]: "Assassination Rogue",
    [CombatUnitSpec.Rogue_Outlaw]: "Outlaw Rogue",
    [CombatUnitSpec.Rogue_Subtlety]: "Subtlety Rogue",
    [CombatUnitSpec.Shaman_Elemental]: "Elemental Shaman",
    [CombatUnitSpec.Shaman_Enhancement]: "Enhancement Shaman",
    [CombatUnitSpec.Shaman_Restoration]: "Restoration Shaman",
    [CombatUnitSpec.Warlock_Affliction]: "Affliction Warlock",
    [CombatUnitSpec.Warlock_Demonology]: "Demonology Warlock",
    [CombatUnitSpec.Warlock_Destruction]: "Destruction Warlock",
    [CombatUnitSpec.Warrior_Arms]: "Arms Warrior",
    [CombatUnitSpec.Warrior_Fury]: "Fury Warrior",
    [CombatUnitSpec.Warrior_Protection]: "Protection Warrior",
    [CombatUnitSpec.Evoker_Devastation]: "Devastation Evoker",
    [CombatUnitSpec.Evoker_Preservation]: "Preservation Evoker",
    [CombatUnitSpec.Evoker_Augmentation]: "Augmentation Evoker",
  };
  return map[spec] ?? "Unknown";
}

const HEALER_SPECS = new Set([
  CombatUnitSpec.Druid_Restoration,
  CombatUnitSpec.Monk_Mistweaver,
  CombatUnitSpec.Paladin_Holy,
  CombatUnitSpec.Priest_Discipline,
  CombatUnitSpec.Priest_Holy,
  CombatUnitSpec.Shaman_Restoration,
  CombatUnitSpec.Evoker_Preservation,
]);

export function isHealerSpec(spec: CombatUnitSpec): boolean {
  return HEALER_SPECS.has(spec);
}

// All specs that fight primarily at melee range, including tanks (rare in arena but present).
// Used for enemy comp classification — anything not in this set and not a healer = ranged/caster.
const MELEE_SPECS = new Set([
  CombatUnitSpec.DeathKnight_Blood,
  CombatUnitSpec.DeathKnight_Frost,
  CombatUnitSpec.DeathKnight_Unholy,
  CombatUnitSpec.DemonHunter_Havoc,
  CombatUnitSpec.DemonHunter_Vengeance,
  CombatUnitSpec.Druid_Feral,
  CombatUnitSpec.Druid_Guardian,
  CombatUnitSpec.Hunter_BeastMastery,
  CombatUnitSpec.Hunter_Survival,
  CombatUnitSpec.Monk_BrewMaster,
  CombatUnitSpec.Monk_Windwalker,
  CombatUnitSpec.Paladin_Protection,
  CombatUnitSpec.Paladin_Retribution,
  CombatUnitSpec.Rogue_Assassination,
  CombatUnitSpec.Rogue_Outlaw,
  CombatUnitSpec.Rogue_Subtlety,
  CombatUnitSpec.Shaman_Enhancement,
  CombatUnitSpec.Warrior_Arms,
  CombatUnitSpec.Warrior_Fury,
  CombatUnitSpec.Warrior_Protection,
]);

export function isMeleeSpec(spec: CombatUnitSpec): boolean {
  return MELEE_SPECS.has(spec);
}

/**
 * Returns the key used for this spec in benchmarks.json (e.g. "DeathKnight Frost").
 */
export function specToBenchmarkKey(spec: CombatUnitSpec): string {
  const key = Object.keys(CombatUnitSpec).find(
    (k) => CombatUnitSpec[k as keyof typeof CombatUnitSpec] === spec,
  );
  return key?.replace("_", " ") ?? "Unknown";
}

/** Format seconds as m:ss string */
export function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * 把任意时刻归到 **prompt 的渲染网格**(整数秒)—— 与 fmtTime 同一取整规则。
 *
 * **任何要连同时间戳一起渲染的采样,都必须先过这个函数再取值。**
 *
 * 2026-07-20 实证(A 类,26/50 场):`[STATE]` 按整数秒 tick 采样,而
 * `[DMG SPIKE]` 用 `pw.fromSeconds`(小数秒)采样,两者却都经 fmtTime 渲染成
 * **同一个显示秒** —— 于是同一行时间戳下两个 HP 数字互相矛盾(中位数 7pp,
 * 最大 25pp)。注意:这不是采样半径问题 —— getUnitHpAtTimestamp 是「先取最近
 * 样本、再用半径决定接受与否」,改半径只会让值变成 null,**永远不会改变数值**。
 * 唯一能让两侧一致的办法,是让它们查询同一个时刻。
 *
 * 见 CLAUDE.md「门规谓词即规范」:分析内部的小数秒必须先 floor 到渲染网格,
 * 再做任何会被渲染或被门规复算的判定。
 */
export function toRenderSecond(seconds: number): number {
  return Math.floor(seconds);
}

/**
 * 一个时间窗在 prompt 上**显示出来的**宽度(秒)。
 *
 * 窗口普遍渲染成 `fmtTime(from)–fmtTime(to) (Ns)`。若 N 直接取原始
 * `toSeconds - fromSeconds` 再 round,读者按显示的起止相减会得到另一个数
 * (如 `0:10–0:20 (9s)`)—— 2026-07-20 eval 的 E/G 类「窗口时长口径不明」。
 * 宽度必须由**显示的端点**导出,渲染物才自洽。
 */
export function renderedWindowSeconds(
  fromSeconds: number,
  toSeconds: number,
): number {
  return Math.max(0, toRenderSecond(toSeconds) - toRenderSecond(fromSeconds));
}

// ---------------------------------------------------------------------------
// Friendly CD overlap detection
// ---------------------------------------------------------------------------

export interface IOverlapCast {
  spec: string;
  playerName: string;
  spellName: string;
  tag: string;
  castTimeSeconds: number;
}

export interface IFriendlyCDOverlapGroup {
  /** Earliest cast time in the group */
  timeSeconds: number;
  casts: IOverlapCast[];
  /** True if the overlap occurred inside or within 5s of a top pressure window */
  duringPressureSpike: boolean;
}

/**
 * Find groups of defensive cooldowns used by friendly players within `overlapWindowSeconds`
 * of each other. Groups with only one cast are excluded (no overlap).
 */
export function detectFriendlyCDOverlaps(
  friendlyPlayers: ICombatUnit[],
  combat: AtomicArenaCombat,
  pressureWindows: IDamageBucket[],
  overlapWindowSeconds = 3,
): IFriendlyCDOverlapGroup[] {
  // Collect all defensive casts across friendly players
  const allCasts: IOverlapCast[] = [];
  for (const player of friendlyPlayers) {
    const cds = extractMajorCooldowns(player, combat);
    for (const cd of cds) {
      if (cd.tag !== "Defensive") continue;
      for (const cast of cd.casts) {
        allCasts.push({
          spec: specToString(player.spec),
          playerName: player.name,
          spellName: cd.spellName,
          tag: cd.tag,
          castTimeSeconds: cast.timeSeconds,
        });
      }
    }
  }

  allCasts.sort((a, b) => a.castTimeSeconds - b.castTimeSeconds);

  // Group casts that fall within overlapWindowSeconds of the group's anchor (first cast)
  const groups: IFriendlyCDOverlapGroup[] = [];
  let i = 0;
  while (i < allCasts.length) {
    const anchor = allCasts[i].castTimeSeconds;
    const group: IOverlapCast[] = [];
    let j = i;
    while (
      j < allCasts.length &&
      allCasts[j].castTimeSeconds - anchor <= overlapWindowSeconds
    ) {
      group.push(allCasts[j]);
      j++;
    }
    if (group.length >= 2) {
      const duringPressureSpike = pressureWindows.some(
        (w) => anchor >= w.fromSeconds - 5 && anchor <= w.toSeconds + 5,
      );
      groups.push({ timeSeconds: anchor, casts: group, duringPressureSpike });
    }
    i = j === i ? i + 1 : j;
  }

  return groups;
}

export function formatFriendlyCDOverlapsForContext(
  groups: IFriendlyCDOverlapGroup[],
): string[] {
  const lines: string[] = [];
  lines.push(
    "FRIENDLY DEFENSIVE CD OVERLAPS (multiple defensives within 3s of each other):",
  );

  if (groups.length === 0) {
    lines.push("  No overlapping defensive cooldowns detected.");
    return lines;
  }

  for (const group of groups) {
    const spike = group.duringPressureSpike ? " [DURING PRESSURE SPIKE]" : "";
    lines.push(`  At ${fmtTime(group.timeSeconds)}${spike}:`);
    for (const c of group.casts) {
      lines.push(`    - ${c.spec} (${c.playerName}) used ${c.spellName}`);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Panic trading / major defensive overlap detection
// ---------------------------------------------------------------------------

/** Minimum seconds two defensive buffs must coexist on the same target to count as a true overlap */
const MIN_SIMULTANEOUS_SECONDS = 2;
/**
 * Assumed minimum duration (seconds) for any major defensive. Used as a proxy for overlap
 * detection when aura events can't be matched reliably (spell cast ID ≠ aura buff ID in WoW logs).
 * Most majors last 8–12s; 8s is conservative enough to avoid false positives.
 */
const OVERLAP_ASSUME_DURATION_S = 8;

export interface IOverlappedDefensive {
  /** Timestamp of the first cast */
  timeSeconds: number;
  /** Timestamp of the second cast */
  secondCastTimeSeconds: number;
  targetUnitId: string;
  targetName: string;
  firstCasterSpec: string;
  firstCasterName: string;
  firstSpellName: string;
  firstSpellId: string;
  secondCasterSpec: string;
  secondCasterName: string;
  secondSpellName: string;
  secondSpellId: string;
  /** How long both buffs were simultaneously active on the target */
  simultaneousSeconds: number;
}

/**
 * Detects when two different friendly players cast major defensives (from
 * `BIG_DEFENSIVE_IDS` | `EXTERNAL_DEFENSIVE_IDS`) whose actual buff durations
 * overlapped on the same target for >= MIN_SIMULTANEOUS_SECONDS.
 * Same-player double-casts are ignored.
 */
export function detectOverlappedDefensives(
  friends: ICombatUnit[],
  combat: { startTime: number },
): IOverlappedDefensive[] {
  const friendlyIds = new Set(friends.map((u) => u.id));
  const unitMap = new Map(friends.map((u) => [u.id, u]));

  const casts: Array<{
    timeSeconds: number;
    castMs: number;
    casterUnitId: string;
    casterName: string;
    casterSpec: string;
    spellId: string;
    spellName: string;
    targetUnitId: string;
    targetName: string;
  }> = [];

  for (const unit of friends) {
    // SPELL_CAST_SUCCESS events are in spellCastEvents, not actionOut
    for (const action of unit.spellCastEvents) {
      if (action.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const spellId = action.spellId;
      if (!spellId || !ALL_MAJOR_DEFENSIVE_IDS.has(spellId)) continue;

      let targetId = action.destUnitId;
      let targetName = action.destUnitName;
      if (!targetId || targetId === "0000000000000000") {
        targetId = unit.id;
        targetName = unit.name;
      }

      if (!friendlyIds.has(targetId)) continue;

      casts.push({
        timeSeconds: (action.timestamp - combat.startTime) / 1000,
        castMs: action.timestamp,
        casterUnitId: unit.id,
        casterName: unit.name,
        casterSpec: specToString(unit.spec),
        spellId,
        spellName: getEnglishSpellName(spellId, action.spellName),
        targetUnitId: targetId,
        targetName: targetName,
      });
    }
  }

  casts.sort((a, b) => a.timeSeconds - b.timeSeconds);

  const overlaps: IOverlappedDefensive[] = [];

  for (let i = 0; i < casts.length; i++) {
    const first = casts[i];
    const targetUnit = unitMap.get(first.targetUnitId);
    if (!targetUnit) continue;

    for (let j = i + 1; j < casts.length; j++) {
      const second = casts[j];
      const gapSeconds = second.timeSeconds - first.timeSeconds;
      const firstDuration =
        spellEffectData[first.spellId]?.durationSeconds ||
        OVERLAP_ASSUME_DURATION_S;
      const maxGap = firstDuration - MIN_SIMULTANEOUS_SECONDS;
      if (gapSeconds > maxGap) break;
      if (first.targetUnitId !== second.targetUnitId) continue;
      if (first.casterUnitId === second.casterUnitId) continue;

      const simultaneousSeconds = firstDuration - gapSeconds;

      overlaps.push({
        timeSeconds: first.timeSeconds,
        secondCastTimeSeconds: second.timeSeconds,
        targetUnitId: first.targetUnitId,
        targetName: first.targetName,
        firstCasterSpec: first.casterSpec,
        firstCasterName: first.casterName,
        firstSpellName: first.spellName,
        firstSpellId: first.spellId,
        secondCasterSpec: second.casterSpec,
        secondCasterName: second.casterName,
        secondSpellName: second.spellName,
        secondSpellId: second.spellId,
        simultaneousSeconds,
      });
    }
  }

  return overlaps;
}

export function formatOverlappedDefensivesForContext(
  overlaps: IOverlappedDefensive[],
): string[] {
  if (overlaps.length === 0) return [];
  const lines: string[] = [];
  // 段头中性化:'PANIC TRADING' 属加载性标签(2026-07-11 校准 labelBias 锚点命中)
  lines.push(
    "DEFENSIVE OVERLAPS (two buffs simultaneously active on the same target):",
  );

  for (const o of overlaps) {
    const sim = o.simultaneousSeconds.toFixed(1);
    lines.push(
      `  ⚠ Major Overlap: [${o.firstCasterSpec}] used ${o.firstSpellName} on ${o.targetName} (at ${fmtTime(o.timeSeconds)}), then [${o.secondCasterSpec}] used ${o.secondSpellName} (at ${fmtTime(o.secondCastTimeSeconds)}) — both active simultaneously for ${sim}s.`,
    );
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Panic press detection (defensive cast with no enemy offensive threat active)
// ---------------------------------------------------------------------------

/** Fraction of the target's max HP that constitutes meaningful pressure in a window */
const PANIC_PRESS_PRESSURE_PCT = 0.15;

// Tank specs — relevant for role-based pressure threshold fallback.
// Tanks have substantially higher HP pools than DPS/healers.
const TANK_SPECS = new Set([
  CombatUnitSpec.DeathKnight_Blood,
  CombatUnitSpec.DemonHunter_Vengeance,
  CombatUnitSpec.Druid_Guardian,
  CombatUnitSpec.Monk_BrewMaster,
  CombatUnitSpec.Paladin_Protection,
  CombatUnitSpec.Warrior_Protection,
]);

// Role-based damage thresholds used when advancedActions data is absent (no advanced logging).
// ⚠️  PATCH-VOLATILE: These values are calibrated from benchmark data collected via
//     packages/tools/src/collectBenchmarks.ts against 2400+ MMR 3v3 matches.
//     Blizzard tuning (ilvl increases, class buffs, HP pool changes) can shift these
//     significantly between patches. Re-run collectBenchmarks after each major patch.
//
// Methodology: pressure window = 3s pre + 4s post cast = 7s total.
//   Threshold = ~P75–P85 of the 7s damage-taken distribution at 2400+ MMR.
//   A window below threshold with no enemy offensive CD → flagged as panic.
//
// Last calibrated: 2026-07-03 (past-week corpus 2026-06-28→07-03, 5160 matches, 3v3 + Rated Solo
// Shuffle, per-spec floors 2700/2400 — see benchmark_data.json meta). Positioning rule (same as the
// 2026-04-08 calibration): healer threshold ≈ 0.86 × the LOWEST-pressure healer spec's 7s-scaled P90
// (10s-window P90 × 0.7), so the most chip-resistant spec's genuinely pressured presses are never
// flagged panic. Benchmark source: packages/tools/benchmarks/benchmark_data.json
//
//   Healer: lowest 7s-P90 is Discipline 84k (10s P90 120k, n=204@2700) → 0.86 × 84k ≈ 70k.
//           Damage inflation vs April roughly doubled healer pressure (HPriest P90 58k→129k/10s).
//   DPS:    distributions moved only ~+9% (p75 210k→228k); 60k stays below every real DPS spec's
//           7s-P50 (min: Havoc 73k; Augmentation 41k excluded — support spec, 2400-floor sample).
//   Tank:   first real sample (Prot Paladin n=54@2400): 7s-scaled P50 116k / P75 281k → 200k
//           (between P50 and P75; replaces the old HP-pool guess of 135k).
//
// Two empirical facts from the 2026-07-03 recalibration audit (packages/tools/src/auditPanic.ts,
// 1151 games / 5210 healer defensive casts):
//   1. The threshold is applied to the 3s-pre and 4s-post windows SEPARATELY (see detectPanicDefensives),
//      not to the 7s sum — so it means "significant pressure within either sub-window".
//   2. Within [35k, 70k] the healer threshold is empirically INERT on the corpus: flag sets are
//      identical (29 flags, 0.6% of casts) because the enemy-offensive-CD gates (#1/#2) already
//      exclude nearly every mid-pressure press. The threshold only guards the tails; precision of
//      panic detection comes from the CD gates, not this constant.
const PANIC_PRESS_DAMAGE_THRESHOLD_TANK = 200_000;
const PANIC_PRESS_DAMAGE_THRESHOLD_DPS = 60_000;
const PANIC_PRESS_DAMAGE_THRESHOLD_HEALER = 70_000; // was 35k (Apr-2026); re-anchored to Disc 7s-P90 84k
const PANIC_PRESS_PRE_CAST_WINDOW_MS = 3_000;
const PANIC_PRESS_POST_CAST_WINDOW_MS = 4_000;
/** If an enemy offensive CD starts within this window after the cast, it was a valid pre-wall */
const ENEMY_BURST_POST_CAST_WINDOW_MS = 2_000;

export interface IPanicDefensive {
  timeSeconds: number;
  casterSpec: string;
  casterName: string;
  spellName: string;
  spellId: string;
  targetName: string;
  targetSpec: string;
}

/**
 * Returns true if the given unit has an Offensive-tagged spell active at `timestampMs`,
 * optionally filtered to only auras sourced from `requiredSourceIds`.
 * - Pass `null` for `requiredSourceIds` to allow any source (used for enemy self-buffs).
 * - Pass the `enemyIds` set to restrict to enemy-sourced auras (used for debuffs on friendlies).
 */
function hasOffensiveSpellActive(
  unit: ICombatUnit,
  timestampMs: number,
  requiredSourceIds: Set<string> | null,
): boolean {
  const applied = new Map<string, number[]>();
  const removed = new Map<string, number[]>();

  for (const aura of unit.auraEvents) {
    const spellId = aura.spellId;
    if (!spellId || !OFFENSIVE_SPELL_IDS.has(spellId)) continue;
    if (requiredSourceIds !== null && !requiredSourceIds.has(aura.srcUnitId))
      continue;

    if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      const b = applied.get(spellId) ?? [];
      applied.set(spellId, [...b, aura.timestamp]);
    } else if (
      aura.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
    ) {
      const b = removed.get(spellId) ?? [];
      removed.set(spellId, [...b, aura.timestamp]);
    }
  }

  for (const [spellId, applications] of Array.from(applied)) {
    const removals = removed.get(spellId) ?? [];
    for (const applyTs of applications) {
      if (applyTs > timestampMs) continue;
      const removeTs = removals.find((r) => r > applyTs);
      if (removeTs === undefined || removeTs > timestampMs) return true;
    }
  }
  return false;
}

/**
 * Derive the pressure threshold for a unit from its recorded max HP (15% of max HP).
 * When no advanced HP data is available, falls back to a role-based estimate derived
 * from typical arena HP pools at Gladiator ilvl rather than a flat value.
 */
export function getPressureThreshold(unit: ICombatUnit): number {
  if (unit.advancedActions.length > 0) {
    const maxHp = Math.max(
      ...unit.advancedActions.map((a) => a.advancedActorMaxHp),
    );
    if (maxHp > 0) return maxHp * PANIC_PRESS_PRESSURE_PCT;
  }
  // Role-based fallback: tanks absorb far more damage than the flat 250k implied
  if (TANK_SPECS.has(unit.spec)) return PANIC_PRESS_DAMAGE_THRESHOLD_TANK;
  if (HEALER_SPECS.has(unit.spec)) return PANIC_PRESS_DAMAGE_THRESHOLD_HEALER;
  return PANIC_PRESS_DAMAGE_THRESHOLD_DPS;
}

/**
 * Returns true if an enemy offensive CD was activated within `windowMs` AFTER `castMs`.
 * Checks both enemy self-buffs (e.g. Combustion applied to the enemy) and offensive
 * debuffs applied to the target (e.g. Deathmark placed on the friendly target).
 * A match here means the defensive was a valid pre-wall, not a panic press.
 */
function offensiveThreatStartedAfter(
  target: ICombatUnit,
  enemies: ICombatUnit[],
  enemyIds: Set<string>,
  castMs: number,
  windowMs: number,
): boolean {
  const windowEnd = castMs + windowMs;

  for (const enemy of enemies) {
    for (const aura of enemy.auraEvents) {
      if (aura.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
      if (!aura.spellId || !OFFENSIVE_SPELL_IDS.has(aura.spellId)) continue;
      if (aura.timestamp > castMs && aura.timestamp <= windowEnd) return true;
    }
  }

  for (const aura of target.auraEvents) {
    if (aura.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
    if (!aura.spellId || !OFFENSIVE_SPELL_IDS.has(aura.spellId)) continue;
    if (!enemyIds.has(aura.srcUnitId)) continue;
    if (aura.timestamp > castMs && aura.timestamp <= windowEnd) return true;
  }

  return false;
}

/**
 * Detects major defensive casts where there is no sign of active enemy threat:
 * 1. No enemy has an Offensive-tagged self-buff active (e.g. Combustion, Recklessness)
 * 2. The defensive target has no Offensive-tagged debuff from an enemy (e.g. Deathmark, Colossus Smash)
 * 3. The target took < threshold damage in the 3 seconds immediately before the cast
 * 4. The target took < threshold damage in the 4 seconds immediately after the cast (pre-wall check)
 * 5. No enemy offensive CD was activated within 2 seconds after the cast (pre-wall check)
 *
 * All conditions must be true to flag a panic press.
 */
export function detectPanicDefensives(
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: { startTime: number },
): IPanicDefensive[] {
  const friendlyIds = new Set(friends.map((u) => u.id));
  const enemyIds = new Set(enemies.map((u) => u.id));
  const unitMap = new Map(friends.map((u) => [u.id, u]));
  const results: IPanicDefensive[] = [];

  for (const unit of friends) {
    // SPELL_CAST_SUCCESS events are in spellCastEvents, not actionOut
    for (const action of unit.spellCastEvents) {
      if (action.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const spellId = action.spellId;
      if (!spellId || !MAJOR_DEFENSIVE_IDS.has(spellId)) continue;
      if (!friendlyIds.has(action.destUnitId)) continue;

      const castMs = action.timestamp;
      const castTimeSeconds = (castMs - combat.startTime) / 1000;
      const targetUnit = unitMap.get(action.destUnitId);

      // 1. Enemy self-buffs: Combustion, Recklessness, etc.
      if (enemies.some((e) => hasOffensiveSpellActive(e, castMs, null)))
        continue;

      // 2. Offensive debuffs on the target from enemies: Deathmark, Colossus Smash, etc.
      if (targetUnit && hasOffensiveSpellActive(targetUnit, castMs, enemyIds))
        continue;

      // 3. Local pressure: raw damage to target in the 3s before this cast
      const pressureThreshold = targetUnit
        ? getPressureThreshold(targetUnit)
        : PANIC_PRESS_DAMAGE_THRESHOLD_DPS;
      const preCastDamage = (targetUnit?.damageIn ?? [])
        .filter(
          (d) =>
            d.logLine.timestamp >= castMs - PANIC_PRESS_PRE_CAST_WINDOW_MS &&
            d.logLine.timestamp < castMs,
        )
        .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
      if (preCastDamage >= pressureThreshold) continue;

      // 3. Post-cast pressure: if the target took significant damage in the 4s after, it was a pre-wall
      const postCastDamage = (targetUnit?.damageIn ?? [])
        .filter(
          (d) =>
            d.logLine.timestamp > castMs &&
            d.logLine.timestamp <= castMs + PANIC_PRESS_POST_CAST_WINDOW_MS,
        )
        .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
      if (postCastDamage >= pressureThreshold) continue;

      // 4. Enemy burst started within 2s after the cast — valid pre-wall, not a panic
      if (
        targetUnit &&
        offensiveThreatStartedAfter(
          targetUnit,
          enemies,
          enemyIds,
          castMs,
          ENEMY_BURST_POST_CAST_WINDOW_MS,
        )
      )
        continue;

      results.push({
        timeSeconds: castTimeSeconds,
        casterSpec: specToString(unit.spec),
        casterName: unit.name,
        spellName: getEnglishSpellName(spellId, action.spellName),
        spellId,
        targetName: action.destUnitName,
        targetSpec: targetUnit ? specToString(targetUnit.spec) : "Unknown",
      });
    }
  }

  results.sort((a, b) => a.timeSeconds - b.timeSeconds);
  return results;
}

export function formatPanicDefensivesForContext(
  panics: IPanicDefensive[],
): string[] {
  if (panics.length === 0) return [];
  const lines: string[] = [];
  lines.push(
    "QUESTIONABLE CD TIMING (major defensive used with no enemy offensive threat and target not under pressure):",
  );

  for (const p of panics) {
    lines.push(
      `  ⚠ Panic Press at ${fmtTime(p.timeSeconds)}: [${p.casterSpec}] used ${p.spellName} on ${p.targetName} [${p.targetSpec}] — no enemy offensive CDs or debuffs active, <250k incoming damage in prior 3s.`,
    );
  }

  return lines;
}
