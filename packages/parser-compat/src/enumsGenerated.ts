// GENERATED — do not hand-edit. Produced by
// packages/analysis/scripts/datagen/genCombatUnitEnums.ts from Blizzard DB2
// (ChrSpecialization / ChrClasses).
// build: 12.1.0.69587
//
// Both the specId and classId values are Blizzard game-data facts; see the
// generator's doc comment for the member naming rules.
// Regenerate: cd packages/analysis && npx tsx scripts/datagen/genCombatUnitEnums.ts

/** Specialization. Values are Blizzard specId strings (exactly the number that
 * appears in COMBATANT_INFO). */
export enum CombatUnitSpec {
  None = "0",
  Mage_Arcane = "62",
  Mage_Fire = "63",
  Mage_Frost = "64",
  Paladin_Holy = "65",
  Paladin_Protection = "66",
  Paladin_Retribution = "70",
  Warrior_Arms = "71",
  Warrior_Fury = "72",
  Warrior_Protection = "73",
  Druid_Balance = "102",
  Druid_Feral = "103",
  Druid_Guardian = "104",
  Druid_Restoration = "105",
  DeathKnight_Blood = "250",
  DeathKnight_Frost = "251",
  DeathKnight_Unholy = "252",
  Hunter_BeastMastery = "253",
  Hunter_Marksmanship = "254",
  Hunter_Survival = "255",
  Priest_Discipline = "256",
  Priest_Holy = "257",
  Priest_Shadow = "258",
  Rogue_Assassination = "259",
  Rogue_Outlaw = "260",
  Rogue_Subtlety = "261",
  Shaman_Elemental = "262",
  Shaman_Enhancement = "263",
  Shaman_Restoration = "264",
  Warlock_Affliction = "265",
  Warlock_Demonology = "266",
  Warlock_Destruction = "267",
  Monk_Brewmaster = "268",
  Monk_Windwalker = "269",
  Monk_Mistweaver = "270",
  DemonHunter_Havoc = "577",
  DemonHunter_Vengeance = "581",
  Evoker_Devastation = "1467",
  Evoker_Preservation = "1468",
  Evoker_Augmentation = "1473",
  DemonHunter_Devourer = "1480",
}

/** Class. Values are Blizzard's official ChrClasses.ID — identical to the
 * classId in the log, no conversion needed. */
export enum CombatUnitClass {
  None = 0,
  Warrior = 1,
  Paladin = 2,
  Hunter = 3,
  Rogue = 4,
  Priest = 5,
  DeathKnight = 6,
  Shaman = 7,
  Mage = 8,
  Warlock = 9,
  Monk = 10,
  Druid = 11,
  DemonHunter = 12,
  Evoker = 13,
}
