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
  // ── 施法/光环双 id 错位补全(fuzz-1000 千场语料实证 2026-07-19)──
  // 白名单收的是施法 id,但 SPELL_AURA_APPLIED 记的是光环 id ——
  // aura 侧 CC 管线(ccWindows/DR/覆盖 manifest)对这些法术整体失明,
  // 且覆盖门与 manifest 共享同一白名单,此类腐烂只能靠语料挖矿发现。
  // 时长为语料 applied→removed 实测(p50–p90,含 DR 影响)。
  "132168": cc(2), // Shockwave 眩晕光环(4102 次/1000 场;施法 id 46968)
  "132169": cc(4), // Storm Bolt 眩晕光环(2895 次;施法 id 107570)
  "118699": cc(6), // Fear 光环(1830 次;施法 id 5782)
  "5246": cc(6), // Intimidating Shout(2811 次;此前完全缺席)
  "360806": cc(6), // Sleep Walk(2035 次;Evoker 主 CC,此前完全缺席)
  "163505": cc(4), // Rake 潜行眩晕(928 次;DR 表已有、cc 表缺席)
  "372245": cc(3), // Terror of the Skies — Evoker Deep Breath 天赋眩晕(2481 次,p50=3.0s;agy 交叉复核发现)
  "20549": cc(2), // War Stomp
  "118905": cc(3), // Static Charge (debuff)
  "192058": cc(3), // Capacitor Totem
  "19386": cc(6), // Wyvern Sting
  "207685": cc(), // Sigil of Misery(disorient debuff aura id;时长以日志 aura applied→removed 实测为准。审计发现缺失:DH 恐惧完全未入 CC 覆盖)
  // ── 定身 ──
  "122": root(6), // Frost Nova
  "33395": root(6), // Freeze (Water Elemental)
  "339": root(8), // Entangling Roots
  "102359": root(8), // Mass Entanglement
  "64695": root(6), // Earthgrab Totem
  "1234195": root(3), // Void Nova (Devourer DH — AoE 伤害+可驱散魔法定身,语料实证 2026-07-14)
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
  // 2026-07-21 补:漏驱散白名单里的圣骑士三祝福,只有 BoP 有分类条目,
  // Freedom/Sacrifice 缺 → getPriority 落 Low → 全语料 1245 场一次都没发出来。
  // 两者的 dispelType=Magic 来自 DB2 挖掘(权威),缺的只是分类标签。
  "1044": { type: "buffs_defensive", duration: 8 }, // Blessing of Freedom
  "6940": { type: "buffs_defensive", duration: 12 }, // Blessing of Sacrifice
  // 2026-07-22 拍板补:漏驱散只收「离散主动 CD」、不收常驻 HoT/护盾(放开常驻类
  // 实测 103 → 892 行,59% 是回春类噪声——见 2026-07-21-evidence-gap-survey §6.5)。
  // 下列 7 条与 Power Infusion 同类;id 从 EN 语料 SPELL_AURA_APPLIED 反向提取、
  // 中文全量语料按 id 复核(83–862 次/70 日志),dispelType=Magic 来自 DB2。
  // 时长为 EN 语料 applied→removed p50;Tip the Scales / Nature's Swiftness p50
  // 仅 0.4s(被下一次施法立即消费),3s 未净化门槛天然滤掉即时消费的实例。
  "210256": { type: "buffs_defensive", duration: 5 }, // Blessing of Sanctuary(509 次)
  "29166": { type: "buffs_defensive", duration: 8 }, // Innervate(183 次)
  "212295": { type: "buffs_defensive", duration: 3 }, // Nether Ward(607 次)
  "378441": { type: "buffs_defensive", duration: 4 }, // Time Stop(48 次)
  "370553": { type: "buffs_defensive", duration: 3 }, // Tip the Scales(969 次;p90=3.3s)
  "132158": { type: "buffs_defensive", duration: 3 }, // Nature's Swiftness(1257 次;p90=2.9s)
  "378081": { type: "buffs_defensive", duration: 3 }, // Nature's Swiftness 变体 id(621 次——双 id 腐烂教训,两个都收)
  "79206": { type: "buffs_defensive", duration: 16 }, // Spiritwalker's Grace(705 次)
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
  // 2026-07-14 全量审计补:21% 语料整场零 [ENEMY CD]——下列主爆发 CD 此前缺分类,
  // isOffensiveSpell 返回 false 被 enemyCDs 静默丢弃(DH/贼/术/元素/生存猎为主)。
  "370965": { type: "debuffs_offensive", duration: 6 }, // The Hunt
  "258925": { type: "buffs_offensive", duration: 3 }, // Fel Barrage
  "185313": { type: "buffs_offensive", duration: 8 }, // Shadow Dance
  "360194": { type: "debuffs_offensive", duration: 16 }, // Deathmark
  "205180": { type: "buffs_offensive", duration: 20 }, // Summon Darkglare
  "386997": { type: "debuffs_offensive", duration: 8 }, // Soul Rot
  "191634": { type: "buffs_offensive", duration: 15 }, // Ascendance (Elemental)
  "360952": { type: "buffs_offensive", duration: 20 }, // Coordinated Assault
  // 2026-07-17 专精级排查:none-tracked 率 100% 的专精(冰法 210/210、踏风 129/129)
  // 及高缺口专精,按语料 SPELL_CAST_SUCCESS 实证补齐 12.x 实际爆发按钮。
  // 冰法 12.x 已无 Icy Veins 施放(重做为被动),实际压力 CD 是下面两个;
  // 惩戒的缺口大半是 Radiant Glory 被动触发复仇之怒(无施放事件),cast 型追踪器无解,属预期。
  "84714": { type: "debuffs_offensive", duration: 15 }, // Frozen Orb(冰法,60s)
  "205021": { type: "debuffs_offensive", duration: 4 }, // Ray of Frost(冰法,60s 充能)
  "392983": { type: "debuffs_offensive", duration: 6 }, // Strike of the Windlord(踏风,35s)
  "1233448": { type: "buffs_offensive", duration: 15 }, // Dark Transformation(邪DK 12.x 变体 id,45s)
  "42650": { type: "buffs_offensive", duration: 30 }, // Army of the Dead(邪DK,90s)
  "102560": { type: "buffs_offensive", duration: 30 }, // Incarnation: Chosen of Elune(鸟德,180s)
  "194223": { type: "buffs_offensive", duration: 20 }, // Celestial Alignment(鸟德,180s)
  "102543": { type: "buffs_offensive", duration: 20 }, // Incarnation: Avatar of Ashamane(野德,180s)
  "106951": { type: "buffs_offensive", duration: 20 }, // Berserk(野德,180s)
  "274837": { type: "debuffs_offensive", duration: 6 }, // Feral Frenzy(野德,45s)
  "114051": { type: "buffs_offensive", duration: 15 }, // Ascendance(增强,180s)
  // 增强 Doom Winds 注:12.x 激活不产生独立 SPELL_CAST_SUCCESS(469270 是逐次攻击的
  // proc 施放,间隔中位数 1s),cast 型追踪器无法跟踪——余下 none-tracked 属预期。
  "466772": { type: "buffs_offensive", duration: 8 }, // Doom Winds buff id(仅 aura,供 spellDanger)
  "1122": { type: "buffs_offensive", duration: 30 }, // Summon Infernal(毁灭,120s;施放 id,111685 是 aura id)
  "6353": { type: "debuffs_offensive", duration: 0 }, // Soul Fire(毁灭,45s 重击)
  "442726": { type: "buffs_offensive", duration: 20 }, // Malevolence(毁灭英雄天赋,60s——语料实测)
  "1261193": { type: "debuffs_offensive", duration: 0 }, // Boomstick(生存猎 12.x,60s 充能)
  "1250646": { type: "debuffs_offensive", duration: 0 }, // Takedown(生存猎 12.x,90s)
  // Devourer Demon Hunter (12.1 新专精)——审计语料实证提取(2026-07-14):
  // 施放频率/事件行为来自 123 场真实对局;时长取挖掘层 DB2 数值。
  "1241937": { type: "buffs_offensive", duration: 5 }, // Soul Immolation(主爆发,60s 充能)
  "1246167": { type: "debuffs_offensive", duration: 2 }, // The Hunt(Devourer 变体 id)
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
  // 2026-07-17 语料实证补(SPELL_INTERRUPT 事件里出现但此前不在名单):
  "19647": { type: "interrupts" }, // Spell Lock(术士地狱犬,语料 476 次!)
  "93985": { type: "interrupts" }, // Skull Bash(德鲁伊,346 次)
  "97547": { type: "interrupts" }, // Solar Beam 打断分量 id(78675 是施放 id)
  "347008": { type: "interrupts" }, // Axe Toss 变体(46 次)
  "91807": { type: "interrupts" }, // Shambling Rush(DK 食尸鬼,25 次)
  "217824": { type: "interrupts" }, // Shield of Virtue(防骑 PvP 天赋)
  "31935": { type: "interrupts" }, // Avenger's Shield
  // ── 加速增益 ──
  "2983": { type: "buffs_speed_boost", duration: 8 }, // Sprint
  "1850": { type: "buffs_speed_boost", duration: 10 }, // Dash
  "116841": { type: "buffs_speed_boost", duration: 6 }, // Tiger's Lust
  // ── 进攻减益 ──
  "702": { type: "debuffs_offensive" }, // Curse of Weakness
  "1714": { type: "debuffs_offensive" }, // Curse of Tongues
  "12654": { type: "debuffs_offensive" }, // Ignite
};
