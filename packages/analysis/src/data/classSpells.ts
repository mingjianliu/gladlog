/**
 * Per-class catalog of major abilities (a compliant replacement for the old
 * parser's classMetadata — that file was a mix of upstream and our own edits and
 * was not carried over).
 * Source: publicly known Blizzard game facts (which class an ability belongs to,
 * and the set of major cooldowns).
 * Coverage policy: each class's major defensive / offensive / control cooldowns;
 * a missing entry simply means that ability is not considered by major-cooldown
 * detection — graceful degradation. Coverage is measured by batch benchmark runs
 * and will be replaced by the subproject-5 pipeline's output.
 */
import { CombatUnitClass } from "@gladlog/parser-compat";
import { SpellTag } from "./spellTypes";

interface IClassAbility {
  spellId: string;
  name: string;
  tags: SpellTag[];
}
interface IClassSpellMetadata {
  unitClass: CombatUnitClass;
  abilities: IClassAbility[];
}

const D = SpellTag.Defensive;
const O = SpellTag.Offensive;
const C = SpellTag.Control;
const a = (
  spellId: string,
  name: string,
  ...tags: SpellTag[]
): IClassAbility => ({ spellId, name, tags });

// 2026-08-21 S2 corpus scan (10,682 matches): removed Repentance 20066, Wyvern Sting 19386, Psychic Horror 64044, Mind Bomb 226943 (no DB2 entry), Icy Veins 12472, Dark Soul: Instability 113858, Dampen Harm 122278, Diffuse Magic 122783, Netherwalk 196555, Fel Eruption 211881 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const classMetadata: IClassSpellMetadata[] = [
  {
    unitClass: CombatUnitClass.Warrior,
    abilities: [
      // offensiveCdGapScan 2026-09-18 (S2 every-20th, 5,464 rounds; lift =
      // own dps in the cast window / rest of the round; registered yardstick
      // p25 1.76 · p50 2.05; corrected run) — user delegated the ruling ("你自己决定吧").
      a("446035", "Bladestorm", O), // live id: 93 % of Arms rounds, lift 2.45 (227847 above: 5 %)
      a("167105", "Colossus Smash", O), // 45 s, lift 2.05, n 1,935
      a("871", "Shield Wall", D),
      a("118038", "Die by the Sword", D),
      a("184364", "Enraged Regeneration", D),
      a("97462", "Rallying Cry", D),
      a("1719", "Recklessness", O),
      a("107574", "Avatar", O),
      a("227847", "Bladestorm", O),
      a("46968", "Shockwave", C),
      a("107570", "Storm Bolt", C),
      a("5246", "Intimidating Shout", C), // W1g 2026-09-25: control kit a player cast in the corpus (DB2 control mechanic, ≥ 30 s cooldown) that no roster listed
      a("236077", "Disarm", C),
    ],
  },
  {
    unitClass: CombatUnitClass.Paladin,
    abilities: [
      a("642", "Divine Shield", D),
      a("31850", "Ardent Defender", D),
      a("86659", "Guardian of Ancient Kings", D),
      a("1022", "Blessing of Protection", D),
      a("204018", "Blessing of Spellwarding", D),
      a("6940", "Blessing of Sacrifice", D),
      a("498", "Divine Protection", D),
      a("403876", "Divine Protection", D), // W1g 2026-09-26: a defensive players press that the ledger never admitted (ledgerGapScan, 605 archive files: Retribution's id, 372 rounds)
      a("471195", "Lay on Hands", D), // W1g 2026-09-26: a defensive players press that the ledger never admitted (ledgerGapScan, 605 archive files: 244 rounds; 633 is its pre-12.x alias)
      a("216331", "Avenging Crusader", D),
      a("31821", "Aura Mastery", D),
      a("31884", "Avenging Wrath", O),
      a("231895", "Crusade", O),
      a("853", "Hammer of Justice", C),
      a("115750", "Blinding Light", C), // W1g 2026-09-25: cast id (was the aura id, which is never cast — the ledger's cast-evidence gate never admitted it)
    ],
  },
  {
    unitClass: CombatUnitClass.Hunter,
    abilities: [
      // offensiveCdGapScan 2026-09-18 (S2 every-20th, 5,464 rounds; lift =
      // own dps in the cast window / rest of the round; registered yardstick
      // p25 1.76 · p50 2.05; corrected run) — user delegated the ruling ("你自己决定吧").
      a("260243", "Volley", O), // 45 s, lift 2.23, coPressed 9 %
      a("186265", "Aspect of the Turtle", D),
      a("109304", "Exhilaration", D),
      a("264735", "Survival of the Fittest", D), // W1g 2026-09-26: a defensive players press that the ledger never admitted (ledgerGapScan, 605 archive files: 457 rounds)
      a("19574", "Bestial Wrath", O),
      a("288613", "Trueshot", O),
      a("266779", "Coordinated Assault", O),
      a("359844", "Call of the Wild", O),
      a("187650", "Freezing Trap", C), // W1g 2026-09-25: cast id (was the aura id, which is never cast — the ledger's cast-evidence gate never admitted it)
      a("19577", "Intimidation", C), // W1g 2026-09-25: cast id (was the aura id, which is never cast — the ledger's cast-evidence gate never admitted it)
      a("474421", "Intimidation", C), // W1g: the 12.x id, 300 casts on 303 files next to 19577's 556
      a("109248", "Binding Shot", C), // W1g 2026-09-25: cast id (was the aura id, which is never cast — the ledger's cast-evidence gate never admitted it)
      a("213691", "Scatter Shot", C),
      a("407028", "Sticky Tar Bomb", C), // W1g 2026-09-25: control kit a player cast in the corpus (DB2 control mechanic, ≥ 30 s cooldown) that no roster listed
    ],
  },
  {
    unitClass: CombatUnitClass.Rogue,
    abilities: [
      // offensiveCdGapScan 2026-09-18 (S2 every-20th, 5,464 rounds; lift =
      // own dps in the cast window / rest of the round; registered yardstick
      // p25 1.76 · p50 2.05; corrected run) — user delegated the ruling ("你自己决定吧").
      a("385627", "Kingsbane", O), // lift 2.28, n 1,605
      a("31224", "Cloak of Shadows", D),
      a("5277", "Evasion", D),
      a("1966", "Feint", D),
      a("13750", "Adrenaline Rush", O),
      a("121471", "Shadow Blades", O),
      a("360194", "Deathmark", O),
      a("2094", "Blind", C),
      a("6770", "Sap", C),
      a("408", "Kidney Shot", C),
      a("1833", "Cheap Shot", C),
      a("1776", "Gouge", C),
      a("207777", "Dismantle", C), // W1g 2026-09-25: control kit a player cast in the corpus (DB2 control mechanic, ≥ 30 s cooldown) that no roster listed
    ],
  },
  {
    unitClass: CombatUnitClass.Priest,
    abilities: [
      // offensiveCdGapScan 2026-09-18 (S2 every-20th, 5,464 rounds; lift =
      // own dps in the cast window / rest of the round; registered yardstick
      // p25 1.76 · p50 2.05; corrected run) — user delegated the ruling ("你自己决定吧").
      a("228260", "Voidform", O), // 100 % of Shadow rounds, lift 1.66 — the live successor of the dead Dark Ascension 391109
      a("33206", "Pain Suppression", D),
      a("47788", "Guardian Spirit", D),
      a("62618", "Power Word: Barrier", D),
      a("19236", "Desperate Prayer", D),
      a("47585", "Dispersion", D),
      a("64843", "Divine Hymn", D),
      a("200183", "Apotheosis", D),
      a("10060", "Power Infusion", O),
      a("391109", "Dark Ascension", O),
      a("8122", "Psychic Scream", C),
      a("605", "Mind Control", C),
      a("9484", "Shackle Undead", C),
      a("1234195", "Void Nova", C), // W1g 2026-09-25: control kit a player cast in the corpus (DB2 control mechanic, ≥ 30 s cooldown) that no roster listed
    ],
  },
  {
    unitClass: CombatUnitClass.DeathKnight,
    abilities: [
      // offensiveCdGapScan 2026-09-18 (S2 every-20th, 5,464 rounds; lift =
      // own dps in the cast window / rest of the round; registered yardstick
      // p25 1.76 · p50 2.05; corrected run) — user delegated the ruling ("你自己决定吧").
      a("1249658", "Breath of Sindragosa", O), // lift 2.90 (coPressed 89 % with Pillar — part of the same go)
      a("48792", "Icebound Fortitude", D),
      a("55233", "Vampiric Blood", D),
      a("48707", "Anti-Magic Shell", D),
      a("410358", "Anti-Magic Shell", D), // W1g 2026-09-26: a defensive players press that the ledger never admitted (ledgerGapScan, 605 archive files: Spellwarden's ally-cast id, 224 rounds)
      a("51052", "Anti-Magic Zone", D),
      a("51271", "Pillar of Frost", O),
      a("47568", "Empower Rune Weapon", O),
      a("275699", "Apocalypse", O),
      a("207289", "Unholy Assault", O),
      a("221562", "Asphyxiate", C),
      a("207167", "Blinding Sleet", C),
      a("389794", "Snowdrift", C), // W1g 2026-09-25: control kit a player cast in the corpus (DB2 control mechanic, ≥ 30 s cooldown) that no roster listed
    ],
  },
  {
    unitClass: CombatUnitClass.Shaman,
    abilities: [
      // offensiveCdGapScan 2026-09-18 (S2 every-20th, 5,464 rounds; lift =
      // own dps in the cast window / rest of the round; registered yardstick
      // p25 1.76 · p50 2.05; corrected run) — user delegated the ruling ("你自己决定吧").
      a("384352", "Doom Winds", O), // talent choice (15 % of Enhancement rounds), lift 2.54
      a("108271", "Astral Shift", D),
      a("98008", "Spirit Link Totem", D),
      a("114050", "Ascendance", O),
      a("114051", "Ascendance", O),
      a("51514", "Hex", C),
      a("305483", "Lightning Lasso", C), // W1g 2026-09-25: control kit a player cast in the corpus (DB2 control mechanic, ≥ 30 s cooldown) that no roster listed
      a("192058", "Capacitor Totem", C), // W1g 2026-09-25: cast id (was the aura id, which is never cast — the ledger's cast-evidence gate never admitted it)
    ],
  },
  {
    unitClass: CombatUnitClass.Mage,
    abilities: [
      // offensiveCdGapScan 2026-09-18 (S2 every-20th, 5,464 rounds; lift =
      // own dps in the cast window / rest of the round; registered yardstick
      // p25 1.76 · p50 2.05; corrected run) — user delegated the ruling ("你自己决定吧").
      a("321507", "Touch of the Magi", O), // 45 s, lift 1.76
      a("45438", "Ice Block", D),
      a("11426", "Ice Barrier", D),
      a("110959", "Greater Invisibility", D), // W1g 2026-09-26: a defensive players press that the ledger never admitted (ledgerGapScan, 605 archive files: 407 rounds)
      a("342245", "Alter Time", D), // W1g 2026-09-26: a defensive players press that the ledger never admitted (ledgerGapScan, 605 archive files: 397 rounds)
      a("190319", "Combustion", O),
      a("365350", "Arcane Surge", O),
      a("118", "Polymorph", C),
      a("31661", "Dragon's Breath", C),
      a("113724", "Ring of Frost", C), // W1g 2026-09-25: cast id (was the aura id, which is never cast — the ledger's cast-evidence gate never admitted it)
    ],
  },
  {
    unitClass: CombatUnitClass.Warlock,
    abilities: [
      // offensiveCdGapScan 2026-09-18 (S2 every-20th, 5,464 rounds; lift =
      // own dps in the cast window / rest of the round; registered yardstick
      // p25 1.76 · p50 2.05; corrected run) — user delegated the ruling ("你自己决定吧").
      a("1276452", "Grimoire: Imp Lord", O), // lift 1.52, coPressed 18 %
      a("104773", "Unending Resolve", D),
      a("108416", "Dark Pact", D),
      a("205180", "Summon Darkglare", O),
      a("265187", "Summon Demonic Tyrant", O),
      a("5782", "Fear", C),
      a("30283", "Shadowfury", C),
      a("6789", "Mortal Coil", C),
      a("5484", "Howl of Terror", C),
      a("710", "Banish", C),
      a("6358", "Seduction", C),
      a("89766", "Axe Toss", C),
    ],
  },
  {
    unitClass: CombatUnitClass.Monk,
    abilities: [
      a("115203", "Fortifying Brew", D),
      a("119996", "Transcendence: Transfer", D), // W1g 2026-09-26: a defensive players press that the ledger never admitted (ledgerGapScan, 605 archive files: 108 rounds; an escape, see CD_ROLE_TAGS)
      a("122470", "Touch of Karma", D),
      a("116849", "Life Cocoon", D),
      a("123904", "Invoke Xuen, the White Tiger", O),
      // 12.x Windwalker burst — took Storm, Earth, and Fire's slot (137639 is
      // in OFFENSIVE_CD_DEAD_IDS and the successor was never listed). Cast id
      // = aura id: S2 archive every-60th × 300 files, 303 SPELL_CAST_SUCCESS /
      // 306 SPELL_AURA_APPLIED on 1249625, 0 events on 137639. DB2: 15 s,
      // 2 charges, 90 s recharge.
      a("1249625", "Zenith", O),
      a("119381", "Leg Sweep", C),
      a("115078", "Paralysis", C),
      a("233759", "Grapple Weapon", C), // W1g 2026-09-25: control kit a player cast in the corpus (DB2 control mechanic, ≥ 30 s cooldown) that no roster listed
      a("198898", "Song of Chi-Ji", C),
    ],
  },
  {
    unitClass: CombatUnitClass.Druid,
    abilities: [
      // offensiveCdGapScan 2026-09-18 (S2 every-20th, 5,464 rounds; lift =
      // own dps in the cast window / rest of the round; registered yardstick
      // p25 1.76 · p50 2.05; corrected run) — user delegated the ruling ("你自己决定吧").
      a("205636", "Force of Nature", O), // lift 2.14
      a("202770", "Fury of Elune", O), // talent choice (15 %), lift 2.16
      a("22812", "Barkskin", D),
      a("61336", "Survival Instincts", D),
      a("102342", "Ironbark", D),
      a("740", "Tranquility", D),
      a("106951", "Berserk", O),
      a("102560", "Incarnation: Chosen of Elune", O),
      a("194223", "Celestial Alignment", O),
      // Convoke the Spirits 391528 deliberately excluded: no spec gate in
      // OFFENSIVE_CD_SPELL_IDS, and Restoration Druids cast the same id as
      // a healing channel (same reason as Divine Toll 375576).
      a("33786", "Cyclone", C),
      a("99", "Incapacitating Roar", C),
      a("5211", "Mighty Bash", C),
      a("2637", "Hibernate", C),
      a("22570", "Maim", C), // W1g 2026-09-25: control kit a player cast in the corpus (DB2 control mechanic, ≥ 30 s cooldown) that no roster listed
      a("209749", "Faerie Swarm", C),
    ],
  },
  {
    unitClass: CombatUnitClass.DemonHunter,
    abilities: [
      // offensiveCdGapScan 2026-09-18 (S2 every-20th, 5,464 rounds; lift =
      // own dps in the cast window / rest of the round; registered yardstick
      // p25 1.76 · p50 2.05; corrected run) — user delegated the ruling ("你自己决定吧").
      a("198589", "Blur", D),
      a("187827", "Metamorphosis", D),
      a("191427", "Metamorphosis", O),
      a("370965", "The Hunt", O),
      a("179057", "Chaos Nova", C),
      a("217832", "Imprison", C),
      a("207684", "Sigil of Misery", C), // W1g 2026-09-25: control kit a player cast in the corpus (DB2 control mechanic, ≥ 30 s cooldown) that no roster listed
      a("205630", "Illidan's Grasp", C),
    ],
  },
  {
    unitClass: CombatUnitClass.Evoker,
    abilities: [
      a("363916", "Obsidian Scales", D),
      a("374348", "Renewing Blaze", D),
      a("357170", "Time Dilation", D),
      a("374227", "Zephyr", D),
      a("375087", "Dragonrage", O),
      a("360806", "Sleep Walk", C),
    ],
  },
];
