/**
 * 逐职业主要技能目录(旧 parser classMetadata 的合规替代——原文件为上游+自有混改,不带走)。
 * 来源:暴雪公开游戏事实(技能归属职业/主 CD 集合)。
 * 覆盖策略:各职业主防御/主进攻/主控制 CD;缺失条目 → 该技能不入主 CD 检测,优雅降级;
 * 覆盖率由 benchmark 跑批统计,子项目 5 管线产物替换。
 */
import { CombatUnitClass } from "@gladlog/parser-compat";
import { SpellTag } from "./spellTypes";

export interface IClassAbility {
  spellId: string;
  name: string;
  tags: SpellTag[];
}
export interface IClassSpellMetadata {
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

export const classMetadata: IClassSpellMetadata[] = [
  {
    unitClass: CombatUnitClass.Warrior,
    abilities: [
      a("871", "Shield Wall", D),
      a("118038", "Die by the Sword", D),
      a("184364", "Enraged Regeneration", D),
      a("97462", "Rallying Cry", D),
      a("1719", "Recklessness", O),
      a("107574", "Avatar", O),
      a("227847", "Bladestorm", O),
      a("46968", "Shockwave", C),
      a("107570", "Storm Bolt", C),
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
      a("31884", "Avenging Wrath", O),
      a("231895", "Crusade", O),
      a("853", "Hammer of Justice", C),
      a("20066", "Repentance", C),
      a("105421", "Blinding Light", C),
    ],
  },
  {
    unitClass: CombatUnitClass.Hunter,
    abilities: [
      a("186265", "Aspect of the Turtle", D),
      a("109304", "Exhilaration", D),
      a("19574", "Bestial Wrath", O),
      a("288613", "Trueshot", O),
      a("266779", "Coordinated Assault", O),
      a("359844", "Call of the Wild", O),
      a("3355", "Freezing Trap", C),
      a("24394", "Intimidation", C),
      a("117526", "Binding Shot", C),
      a("213691", "Scatter Shot", C),
      a("19386", "Wyvern Sting", C),
    ],
  },
  {
    unitClass: CombatUnitClass.Rogue,
    abilities: [
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
    ],
  },
  {
    unitClass: CombatUnitClass.Priest,
    abilities: [
      a("33206", "Pain Suppression", D),
      a("47788", "Guardian Spirit", D),
      a("62618", "Power Word: Barrier", D),
      a("19236", "Desperate Prayer", D),
      a("47585", "Dispersion", D),
      a("10060", "Power Infusion", O),
      a("391109", "Dark Ascension", O),
      a("8122", "Psychic Scream", C),
      a("605", "Mind Control", C),
      a("64044", "Psychic Horror", C),
      a("226943", "Mind Bomb", C),
      a("9484", "Shackle Undead", C),
    ],
  },
  {
    unitClass: CombatUnitClass.DeathKnight,
    abilities: [
      a("48792", "Icebound Fortitude", D),
      a("55233", "Vampiric Blood", D),
      a("48707", "Anti-Magic Shell", D),
      a("51052", "Anti-Magic Zone", D),
      a("51271", "Pillar of Frost", O),
      a("275699", "Apocalypse", O),
      a("207289", "Unholy Assault", O),
      a("221562", "Asphyxiate", C),
      a("108194", "Asphyxiate", C),
      a("207167", "Blinding Sleet", C),
    ],
  },
  {
    unitClass: CombatUnitClass.Shaman,
    abilities: [
      a("108271", "Astral Shift", D),
      a("98008", "Spirit Link Totem", D),
      a("114050", "Ascendance", O),
      a("114051", "Ascendance", O),
      a("51514", "Hex", C),
      a("118905", "Static Charge", C),
    ],
  },
  {
    unitClass: CombatUnitClass.Mage,
    abilities: [
      a("45438", "Ice Block", D),
      a("11426", "Ice Barrier", D),
      a("12472", "Icy Veins", O),
      a("190319", "Combustion", O),
      a("365350", "Arcane Surge", O),
      a("118", "Polymorph", C),
      a("31661", "Dragon's Breath", C),
      a("82691", "Ring of Frost", C),
    ],
  },
  {
    unitClass: CombatUnitClass.Warlock,
    abilities: [
      a("104773", "Unending Resolve", D),
      a("108416", "Dark Pact", D),
      a("205180", "Summon Darkglare", O),
      a("265187", "Summon Demonic Tyrant", O),
      a("113860", "Dark Soul: Misery", O),
      a("113858", "Dark Soul: Instability", O),
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
      a("122470", "Touch of Karma", D),
      a("116849", "Life Cocoon", D),
      a("122278", "Dampen Harm", D),
      a("122783", "Diffuse Magic", D),
      a("137639", "Storm, Earth, and Fire", O),
      a("123904", "Invoke Xuen, the White Tiger", O),
      a("119381", "Leg Sweep", C),
      a("115078", "Paralysis", C),
    ],
  },
  {
    unitClass: CombatUnitClass.Druid,
    abilities: [
      a("22812", "Barkskin", D),
      a("61336", "Survival Instincts", D),
      a("102342", "Ironbark", D),
      a("740", "Tranquility", D),
      a("106951", "Berserk", O),
      a("102560", "Incarnation: Chosen of Elune", O),
      a("194223", "Celestial Alignment", O),
      a("323764", "Convoke the Spirits", O),
      a("33786", "Cyclone", C),
      a("99", "Incapacitating Roar", C),
      a("5211", "Mighty Bash", C),
      a("2637", "Hibernate", C),
    ],
  },
  {
    unitClass: CombatUnitClass.DemonHunter,
    abilities: [
      a("198589", "Blur", D),
      a("196555", "Netherwalk", D),
      a("187827", "Metamorphosis", D),
      a("191427", "Metamorphosis", O),
      a("370965", "The Hunt", O),
      a("179057", "Chaos Nova", C),
      a("211881", "Fel Eruption", C),
      a("217832", "Imprison", C),
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
