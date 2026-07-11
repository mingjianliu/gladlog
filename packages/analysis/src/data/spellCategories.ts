/**
 * PvP 法术分类最小数据集(spells.json 的合规替代——原文件为上游+自有混改,不带走)。
 * 来源:暴雪公开游戏事实(法术控制类型/持续时间为客观数值)。
 * 覆盖策略:主流竞技场 CC/定身/缴械/免疫集合;缺失条目 → 相应法术不入
 * ccSpellIds 等集合,分析优雅降级;覆盖率由 benchmark 跑批统计。
 * 子项目 5 数据管线建成后由生成产物替换。
 */
export interface ISpellCategoryEntry {
  type:
    | "cc"
    | "roots"
    | "immunities"
    | "buffs_offensive"
    | "buffs_defensive"
    | "buffs_other"
    | "debuffs_offensive"
    | "debuffs_defensive"
    | "debuffs_other"
    | "buffs_speed_boost"
    | "interrupts"
    | "disarms";
  duration?: number;
  priority?: boolean;
  nounitFrames?: boolean;
  nonameplates?: boolean;
}

const cc = (duration?: number): ISpellCategoryEntry => ({
  type: "cc",
  duration,
});
const root = (duration?: number): ISpellCategoryEntry => ({
  type: "roots",
  duration,
});

export const SPELL_CATEGORIES: Record<string, ISpellCategoryEntry> = {
  // ── CC(眩晕/变形/恐惧/致盲/禁锢等)──
  "118": cc(8), // Polymorph
  "28271": cc(8), // Polymorph (Turtle)
  "28272": cc(8), // Polymorph (Pig)
  "51514": cc(8), // Hex
  "5782": cc(6), // Fear
  "5484": cc(6), // Howl of Terror
  "6789": cc(3), // Mortal Coil (DR: Incapacitate)
  "30283": cc(3), // Shadowfury
  "710": cc(6), // Banish
  "6358": cc(6), // Seduction
  "115268": cc(6), // Mesmerize
  "89766": cc(4), // Axe Toss
  "8122": cc(6), // Psychic Scream
  "605": cc(6), // Mind Control
  "9484": cc(6), // Shackle Undead
  "64044": cc(4), // Psychic Horror
  "226943": cc(4), // Mind Bomb
  "2094": cc(6), // Blind
  "6770": cc(6), // Sap
  "1833": cc(4), // Cheap Shot
  "408": cc(6), // Kidney Shot
  "1776": cc(4), // Gouge
  "5211": cc(4), // Mighty Bash
  "99": cc(3), // Incapacitating Roar
  "33786": cc(6), // Cyclone
  "2637": cc(6), // Hibernate
  "853": cc(6), // Hammer of Justice
  "20066": cc(6), // Repentance
  "105421": cc(6), // Blinding Light
  "31661": cc(4), // Dragon's Breath
  "82691": cc(6), // Ring of Frost
  "119381": cc(3), // Leg Sweep
  "115078": cc(4), // Paralysis
  "211881": cc(4), // Fel Eruption
  "217832": cc(6), // Imprison
  "179057": cc(2), // Chaos Nova
  "221562": cc(5), // Asphyxiate
  "108194": cc(4), // Asphyxiate (Unholy)
  "207167": cc(5), // Blinding Sleet
  "3355": cc(8), // Freezing Trap
  "24394": cc(4), // Intimidation
  "117526": cc(3), // Binding Shot
  "213691": cc(4), // Scatter Shot
  "46968": cc(2), // Shockwave
  "107570": cc(4), // Storm Bolt
  "20549": cc(2), // War Stomp
  "118905": cc(3), // Static Charge (debuff)
  "192058": cc(3), // Capacitor Totem
  "19386": cc(6), // Wyvern Sting
  // ── 定身 ──
  "122": root(6), // Frost Nova
  "33395": root(6), // Freeze (Water Elemental)
  "339": root(8), // Entangling Roots
  "102359": root(8), // Mass Entanglement
  "64695": root(6), // Earthgrab Totem
  // ── 缴械 ──
  "236077": { type: "disarms", duration: 5 }, // Disarm (Warrior)
  "207777": { type: "disarms", duration: 5 }, // Dismantle
  "233759": { type: "disarms", duration: 5 }, // Grapple Weapon
  // ── 免疫 ──
  "642": { type: "immunities", duration: 8 }, // Divine Shield
  "45438": { type: "immunities", duration: 10 }, // Ice Block
  "186265": { type: "immunities", duration: 8 }, // Aspect of the Turtle
  "196555": { type: "immunities", duration: 5 }, // Netherwalk
  "31224": { type: "immunities", duration: 5 }, // Cloak of Shadows
  "1022": { type: "immunities", duration: 10 }, // Blessing of Protection
  // ── 进攻增益(spellDanger/isOffensiveSpell 消费)──
  "12472": { type: "buffs_offensive", duration: 25 }, // Icy Veins
  "19574": { type: "buffs_offensive", duration: 15 }, // Bestial Wrath
  "1719": { type: "buffs_offensive", duration: 16 }, // Recklessness
  "13750": { type: "buffs_offensive", duration: 20 }, // Adrenaline Rush
  "121471": { type: "buffs_offensive", duration: 20 }, // Shadow Blades
  "190319": { type: "buffs_offensive", duration: 10 }, // Combustion
  "365350": { type: "buffs_offensive", duration: 15 }, // Arcane Surge
  "107574": { type: "buffs_offensive", duration: 20 }, // Avatar
  "10060": { type: "buffs_offensive", duration: 20 }, // Power Infusion
  "375087": { type: "buffs_offensive", duration: 18 }, // Dragonrage
  "51271": { type: "buffs_offensive", duration: 12 }, // Pillar of Frost
  "31884": { type: "buffs_offensive", duration: 20 }, // Avenging Wrath
  "288613": { type: "buffs_offensive", duration: 15 }, // Trueshot
  // ── 打断 ──
  "1766": { type: "interrupts" },
  "2139": { type: "interrupts" },
  "6552": { type: "interrupts" },
  "47528": { type: "interrupts" },
  "57994": { type: "interrupts" },
  "96231": { type: "interrupts" },
  "106839": { type: "interrupts" },
  "116705": { type: "interrupts" },
  "147362": { type: "interrupts" },
  "187707": { type: "interrupts" },
  "183752": { type: "interrupts" },
  "119910": { type: "interrupts" },
  "132409": { type: "interrupts" },
  "351338": { type: "interrupts" },
  "15487": { type: "interrupts" },
  "78675": { type: "interrupts" },
  // ── 加速增益 ──
  "2983": { type: "buffs_speed_boost", duration: 8 }, // Sprint
  "1850": { type: "buffs_speed_boost", duration: 10 }, // Dash
  "116841": { type: "buffs_speed_boost", duration: 6 }, // Tiger's Lust
  // ── 进攻减益 ──
  "702": { type: "debuffs_offensive" }, // Curse of Weakness
  "1714": { type: "debuffs_offensive" }, // Curse of Tongues
  "12654": { type: "debuffs_offensive" }, // Ignite
};
