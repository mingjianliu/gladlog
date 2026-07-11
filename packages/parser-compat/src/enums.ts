export enum LogEvent {
  ZONE_CHANGE = 'ZONE_CHANGE',
  ARENA_MATCH_START = 'ARENA_MATCH_START',
  ARENA_MATCH_END = 'ARENA_MATCH_END',
  COMBATANT_INFO = 'COMBATANT_INFO',
  SWING_MISSED = 'SWING_MISSED',
  RANGE_MISSED = 'RANGE_MISSED',
  SPELL_MISSED = 'SPELL_MISSED',
  SPELL_PERIODIC_MISSED = 'SPELL_PERIODIC_MISSED',
  DAMAGE_SHIELD_MISSED = 'DAMAGE_SHIELD_MISSED',
  SPELL_CAST_SUCCESS = 'SPELL_CAST_SUCCESS',
  SPELL_CAST_START = 'SPELL_CAST_START',
  SPELL_CAST_FAILED = 'SPELL_CAST_FAILED',
  SPELL_AURA_APPLIED = 'SPELL_AURA_APPLIED',
  SPELL_AURA_REMOVED = 'SPELL_AURA_REMOVED',
  SPELL_STOLEN = 'SPELL_STOLEN',
  SPELL_INTERRUPT = 'SPELL_INTERRUPT',
  SPELL_DISPEL = 'SPELL_DISPEL',
  SPELL_DISPEL_FAILED = 'SPELL_DISPEL_FAILED',
  SPELL_EXTRA_ATTACKS = 'SPELL_EXTRA_ATTACKS',
  SPELL_AURA_APPLIED_DOSE = 'SPELL_AURA_APPLIED_DOSE',
  SPELL_AURA_REMOVED_DOSE = 'SPELL_AURA_REMOVED_DOSE',
  SPELL_AURA_REFRESH = 'SPELL_AURA_REFRESH',
  SPELL_AURA_BROKEN = 'SPELL_AURA_BROKEN',
  SPELL_AURA_BROKEN_SPELL = 'SPELL_AURA_BROKEN_SPELL',
  SWING_DAMAGE = 'SWING_DAMAGE',
  SWING_DAMAGE_LANDED = 'SWING_DAMAGE_LANDED',
  ENVIRONMENTAL_DAMAGE = 'ENVIRONMENTAL_DAMAGE',
  RANGE_DAMAGE = 'RANGE_DAMAGE',
  SPELL_DAMAGE = 'SPELL_DAMAGE',
  SPELL_PERIODIC_DAMAGE = 'SPELL_PERIODIC_DAMAGE',
  DAMAGE_SHIELD = 'DAMAGE_SHIELD',
  SPELL_SUMMON = 'SPELL_SUMMON',
  SPELL_DRAIN = 'SPELL_DRAIN',
  SPELL_PERIODIC_DRAIN = 'SPELL_PERIODIC_DRAIN',
  SPELL_LEECH = 'SPELL_LEECH',
  SPELL_PERIODIC_LEECH = 'SPELL_PERIODIC_LEECH',
  SPELL_HEAL = 'SPELL_HEAL',
  SPELL_PERIODIC_HEAL = 'SPELL_PERIODIC_HEAL',
  SPELL_ENERGIZE = 'SPELL_ENERGIZE',
  SPELL_PERIODIC_ENERGIZE = 'SPELL_PERIODIC_ENERGIZE',
  SPELL_ABSORBED = 'SPELL_ABSORBED',
  DAMAGE_SPLIT = 'DAMAGE_SPLIT',
  UNIT_DIED = 'UNIT_DIED',
  PARTY_KILL = 'PARTY_KILL',
  SWING_DAMAGE_SUPPORT = 'SWING_DAMAGE_SUPPORT',
  RANGE_DAMAGE_SUPPORT = 'RANGE_DAMAGE_SUPPORT',
  SPELL_DAMAGE_SUPPORT = 'SPELL_DAMAGE_SUPPORT',
  SPELL_HEAL_SUPPORT = 'SPELL_HEAL_SUPPORT',
  SPELL_PERIODIC_DAMAGE_SUPPORT = 'SPELL_PERIODIC_DAMAGE_SUPPORT',
  SPELL_PERIODIC_HEAL_SUPPORT = 'SPELL_PERIODIC_HEAL_SUPPORT',
  SWING_DAMAGE_LANDED_SUPPORT = 'SWING_DAMAGE_LANDED_SUPPORT'
}

export enum CombatUnitSpec {
  None = '0',
  DeathKnight_Blood = '250',
  DeathKnight_Frost = '251',
  DeathKnight_Unholy = '252',
  DemonHunter_Havoc = '577',
  DemonHunter_Vengeance = '581',
  DemonHunter_Devourer = '1480',
  Druid_Balance = '102',
  Druid_Feral = '103',
  Druid_Guardian = '104',
  Druid_Restoration = '105',
  Hunter_BeastMastery = '253',
  Hunter_Marksmanship = '254',
  Hunter_Survival = '255',
  Mage_Arcane = '62',
  Mage_Fire = '63',
  Mage_Frost = '64',
  Monk_BrewMaster = '268',
  Monk_Windwalker = '269',
  Monk_Mistweaver = '270',
  Paladin_Holy = '65',
  Paladin_Protection = '66',
  Paladin_Retribution = '70',
  Priest_Discipline = '256',
  Priest_Holy = '257',
  Priest_Shadow = '258',
  Rogue_Assassination = '259',
  Rogue_Outlaw = '260',
  Rogue_Subtlety = '261',
  Shaman_Elemental = '262',
  Shaman_Enhancement = '263',
  Shaman_Restoration = '264',
  Warlock_Affliction = '265',
  Warlock_Demonology = '266',
  Warlock_Destruction = '267',
  Warrior_Arms = '71',
  Warrior_Fury = '72',
  Warrior_Protection = '73',
  Evoker_Devastation = '1467',
  Evoker_Preservation = '1468',
  Evoker_Augmentation = '1473'
}

export enum CombatUnitClass {
  None = 0,
  Warrior = 1,
  Hunter = 2,
  Shaman = 3,
  Paladin = 4,
  Warlock = 5,
  Priest = 6,
  Rogue = 7,
  Mage = 8,
  Druid = 9,
  DeathKnight = 10,
  DemonHunter = 11,
  Monk = 12,
  Evoker = 13
}

export enum CombatUnitReaction {
  Neutral = 0,
  Friendly = 1,
  Hostile = 2
}

export enum CombatUnitType {
  None = 0,
  Player = 1,
  NPC = 2,
  Pet = 3,
  Guardian = 4,
  Object = 5
}

export enum CombatResult {
  Unknown = 0,
  DrawGame = 1,
  Lose = 2,
  Win = 3
}

export enum CombatUnitPowerType {
  HealthCost = -2,
  None = -1,
  Mana = 0,
  Rage = 1,
  Focus = 2,
  Energy = 3,
  ComboPoints = 4,
  Runes = 5,
  RunicPower = 6,
  SoulShards = 7,
  LunarPower = 8,
  HolyPower = 9,
  Alternate = 10,
  Maelstrom = 11,
  Chi = 12,
  Insanity = 13,
  Obsolete = 14,
  Obsolete2 = 15,
  ArcaneCharges = 16,
  Fury = 17,
  Pain = 18,
  NumPowerTypes = 19
}


// ── 单位旗标解码(暴雪 combat log flags 公开掩码;供旧 utils 使用)──
const TYPE_PLAYER = 0x0400;
const TYPE_NPC = 0x0800;
const TYPE_PET = 0x1000;
const TYPE_GUARDIAN = 0x2000;
const TYPE_OBJECT = 0x4000;
const REACTION_FRIENDLY = 0x0010;
const REACTION_HOSTILE = 0x0040;

export function getUnitType(flags: number): CombatUnitType {
  if (flags & TYPE_PLAYER) return CombatUnitType.Player;
  if (flags & TYPE_PET) return CombatUnitType.Pet;
  if (flags & TYPE_GUARDIAN) return CombatUnitType.Guardian;
  if (flags & TYPE_NPC) return CombatUnitType.NPC;
  if (flags & TYPE_OBJECT) return CombatUnitType.Object;
  return CombatUnitType.None;
}

export function getUnitReaction(flags: number): CombatUnitReaction {
  if (flags & REACTION_FRIENDLY) return CombatUnitReaction.Friendly;
  if (flags & REACTION_HOSTILE) return CombatUnitReaction.Hostile;
  return CombatUnitReaction.Neutral;
}
