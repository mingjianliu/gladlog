/**
 * Minimal PvP spell category dataset (a compliant replacement for
 * spells.json -- the original was an upstream file mixed with our own edits,
 * so it is not carried over).
 * Source: publicly known Blizzard game facts (a spell's control type and
 * duration are objective values).
 * Coverage strategy: the mainstream arena CC / root / disarm / immunity sets;
 * a missing entry means that spell simply never enters ccSpellIds and the
 * like, so analysis degrades gracefully; coverage is measured by benchmark
 * batch runs.
 * To be replaced by generated output once subproject 5's data pipeline is
 * built.
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
  /**
   * Seconds. For `cc` / `roots` this is ONLY a fallback for ids DB2 leaves
   * blank (Kidney Shot, cast-side ids) — the full CC duration predicate is
   * `ccFullDurationSeconds` in spellEffectData.ts (official DB2 PvP duration),
   * and `test/ccFullDuration.test.ts` fails if a cc/root entry carries a hand
   * duration DB2 already covers (2026-09-02: 61 such numbers removed, 21 of
   * the 22 that disagreed with DB2 were wrong). For `interrupts` it would be
   * a hand override of the school-lockout length — `kickLockoutSeconds`
   * (spellEffectData.ts) reads the official DB2 PvP duration first, the
   * corpus-observed `KICK_LOCKOUT_OBSERVED` second, this field third, 3 s
   * last; no interrupt entry carries one today.
   * Every other type: none — the 70 informational buff / debuff / immunity /
   * disarm numbers were removed the same day (30 disagreed with DB2, zero
   * consumers read them); `test/ccFullDuration.test.ts` pins the field to the
   * four fallback ids.
   */
  duration?: number;
  priority?: boolean;
  nounitFrames?: boolean;
  nonameplates?: boolean;
}

/**
 * Aura-type-level "cast blocking" predicate (single-source) -- decides
 * whether an aura sitting on a unit prevents it from casting: hard CC ("cc")
 * and silence/interrupt auras ("interrupts", covering Silence / Solar Beam /
 * Spell Lock and other entries that land on the target as
 * SPELL_AURA_APPLIED; pure kicks such as Pummel produce no aura event and so
 * are inherently never misjudged through this predicate). Disarms
 * ("disarms") do not block casting and are not in the set.
 *
 * Consumers: the "dispeller was locked out" exemption in dispelAnalysis, and
 * the free-cast duration of a healing gap in healingGaps.
 * The gate predicate is the spec: both sites must import this predicate and
 * must not each copy the set.
 */
const CAST_BLOCKING_AURA_TYPES: ReadonlySet<ISpellCategoryEntry["type"]> =
  new Set(["cc", "interrupts"]);

export function isCastBlockingAuraType(type: string): boolean {
  return CAST_BLOCKING_AURA_TYPES.has(type as ISpellCategoryEntry["type"]);
}

// `kickLockoutSeconds` (kick -> school-lockout seconds) lives in
// spellEffectData.ts next to `ccFullDurationSeconds`: both answer from the
// official DB2 PvP duration first (2026-09-04), and spellEffectData already
// imports this file for the hand fallback, so defining it here would create an
// import cycle.

const cc = (duration?: number): ISpellCategoryEntry => ({
  type: "cc",
  duration,
});
const root = (duration?: number): ISpellCategoryEntry => ({
  type: "roots",
  duration,
});

// 2026-08-21 S2 corpus scan (10,682 matches): removed Mesmerize 115268, Psychic Horror 64044, Mind Bomb 226943, Repentance 20066, Fel Eruption 211881, Wyvern Sting 19386, Netherwalk 196555, Icy Veins 12472, Fel Barrage 258925, Soul Rot 386997, Coordinated Assault 360952 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const SPELL_CATEGORIES: Record<string, ISpellCategoryEntry> = {
  // -- CC (stun / polymorph / fear / blind / imprison etc.) --
  "118": cc(), // Polymorph
  "28271": cc(), // Polymorph (Turtle)
  "28272": cc(), // Polymorph (Pig)
  // Polymorph glyph variants: 8 further ids of the same spell that the 12.1 archive logs as their own aura ids — all in the observed
  // universe, all seen dispelled (dispelObservedGenerated: 161354 ×238, 460392 ×137, …), all in the official DR table
  // (drGapScan 2026-08-21 listed them among the 63 CC ids SPELL_CATEGORIES lacked). User ruling 2026-09-02 (GH #44):
  // "变形变体和变形一模一样" — registered exactly like 118 / 28271 / 28272 above. Duration: same-day ruling
  // "羊本身永远是6秒 除非有龙给的加持续时间的debuff" — the family (and every other CC/root id DB2 covers) no longer
  // carries a hand duration; `ccFullDurationSeconds` (spellEffectData.ts) reads the official 6 s, Oppressing Roar is
  // applied by the consumer.
  "61305": cc(), // Polymorph (glyph variant; DB2 SpellName carries no subtext)
  "61721": cc(), // Polymorph (glyph variant; DB2 SpellName carries no subtext)
  "161353": cc(), // Polymorph (glyph variant; DB2 SpellName carries no subtext)
  "161354": cc(), // Polymorph (glyph variant; DB2 SpellName carries no subtext)
  "277787": cc(), // Polymorph (glyph variant; DB2 SpellName carries no subtext)
  "277792": cc(), // Polymorph (glyph variant; DB2 SpellName carries no subtext)
  "391622": cc(), // Polymorph (glyph variant; DB2 SpellName carries no subtext)
  "460392": cc(), // Polymorph (glyph variant; DB2 SpellName carries no subtext)
  "51514": cc(), // Hex
  "5782": cc(6), // Fear
  "5484": cc(), // Howl of Terror
  "6789": cc(), // Mortal Coil (DR: Incapacitate)
  "30283": cc(), // Shadowfury
  "710": cc(), // Banish
  "6358": cc(), // Seduction
  "89766": cc(), // Axe Toss
  "8122": cc(), // Psychic Scream
  "605": cc(), // Mind Control
  "9484": cc(), // Shackle Undead
  "2094": cc(), // Blind
  "6770": cc(), // Sap
  "1833": cc(), // Cheap Shot
  "408": cc(5), // Kidney Shot — DB2 has no duration (combo-point scaled); S2 lifetime mode 5.0 s ×700 of 1635, p90 5.2 (2026-09-02)
  "1776": cc(), // Gouge
  "5211": cc(), // Mighty Bash
  "99": cc(), // Incapacitating Roar
  "33786": cc(), // Cyclone
  "2637": cc(), // Hibernate
  "853": cc(), // Hammer of Justice
  "105421": cc(), // Blinding Light
  "31661": cc(), // Dragon's Breath
  "82691": cc(), // Ring of Frost
  "119381": cc(), // Leg Sweep
  "115078": cc(), // Paralysis
  "217832": cc(), // Imprison
  "179057": cc(), // Chaos Nova
  "221562": cc(), // Asphyxiate
  "108194": cc(), // Asphyxiate (Unholy)
  "207167": cc(), // Blinding Sleet
  "3355": cc(), // Freezing Trap
  "24394": cc(), // Intimidation
  "117526": cc(), // Binding Shot
  "213691": cc(), // Scatter Shot — 3s since its 12.1 PvP-talent return (corpus 2026-08-13: expiry cluster 2.99–3.02s, 50%-DR cluster 1.50s, n=18)
  "46968": cc(2), // Shockwave
  "107570": cc(3), // Storm Bolt — cast id, DB2 blank; the stun aura 132169 is DB2 3 s = S2 lifetime mode 3.0 s ×727 (2026-09-02)
  // -- Cast-id / aura-id mismatch fill-ins (proven on the fuzz-1000
  // thousand-match corpus, 2026-07-19) --
  // The whitelist holds cast ids, but SPELL_AURA_APPLIED records aura ids --
  // the aura-side CC pipeline (ccWindows / DR / coverage manifest) was
  // entirely blind to these spells, and since the coverage gate and the
  // manifest share the same whitelist, this kind of rot can only be found by
  // mining the corpus.
  // Durations are measured from corpus applied->removed (p50-p90, DR
  // included).
  "132168": cc(), // Shockwave stun aura (4102 hits / 1000 matches; cast id 46968)
  "132169": cc(), // Storm Bolt stun aura (2895 hits; cast id 107570)
  "118699": cc(), // Fear aura (1830 hits; cast id 5782)
  "5246": cc(), // Intimidating Shout (2811 hits; previously absent entirely)
  "360806": cc(), // Sleep Walk (2035 hits; Evoker main CC, previously absent entirely)
  "163505": cc(), // Rake stealth stun (928 hits; present in the DR table, absent from cc)
  "372245": cc(), // Terror of the Skies -- Evoker Deep Breath talent stun (2481 hits, p50=3.0s; found by agy cross-review)
  "20549": cc(), // War Stomp
  "118905": cc(), // Static Charge (debuff)
  "192058": cc(), // Capacitor Totem
  "207685": cc(), // Sigil of Misery (disorient debuff aura id; duration is taken from measured log aura applied->removed. Found missing by the audit: DH fear was entirely outside CC coverage)
  // -- Roots --
  "122": root(), // Frost Nova
  "355689": root(), // Landslide (Shaman totem root; official Magic/6 s; ×59 in the dispel corpus). Was the one dispellable root with no entry → priority Low → a missed cleanse on it could never be reported (registry rule). User 2026-08-30 (GH #24 tail): "same tier as Frost Nova".
  "33395": root(), // Freeze (Water Elemental)
  "339": root(), // Entangling Roots
  "102359": root(), // Mass Entanglement
  "64695": root(), // Earthgrab Totem
  // Void Nova (Devourer DH). A STUN, not a root — reclassified 2026-08-19
  // after a user challenge (「治疗没法给自己驱散啊」) exposed 84 missed-cleanse
  // windows accusing a Void-Nova'd sole dispeller of not dispelling their own
  // stun. Three independent sources agree:
  //   - official DB2 DiminishType = stun (drCategoriesGenerated);
  //   - 12.1 guides: "Devourer's AoE stun tool, 3 sec";
  //   - corpus cast-during-aura discriminator, BOTH eras: afflicted units cast
  //     during 6.9% (12.0) / 7.0% (12.1) of aura segments — below the known-
  //     stun control Hammer of Justice (14.4%/13.0%, floor set by
  //     usable-while-stunned abilities) and nowhere near the known-root
  //     control Frost Nova (55.8%/53.2%).
  // The old entry read `root(3) // ... proven on corpus 2026-07-14` — what that
  // audit proved was "dispellable magic" (SPELL_DISPEL evidence); the "root"
  // half was never behaviorally verified and was wrong in both eras, so no era
  // gate is needed. The one word `roots` had three consequences: no DR stats
  // (ccSpellIds excluded it), priority High instead of Critical, and — the
  // accusation-shaped one — `isCastBlockingAuraType` false, so the
  // sole-dispeller exemption never fired for it.
  "1234195": cc(),
  // -- Disarms --
  "236077": { type: "disarms" }, // Disarm (Warrior)
  "207777": { type: "disarms" }, // Dismantle
  "233759": { type: "disarms" }, // Grapple Weapon
  // -- Immunities --
  "642": { type: "immunities" }, // Divine Shield
  "45438": { type: "immunities" }, // Ice Block
  "186265": { type: "immunities" }, // Aspect of the Turtle
  "31224": { type: "immunities" }, // Cloak of Shadows
  "1022": { type: "immunities" }, // Blessing of Protection
  // 2026-08-21(GH #17/D1 尾巴,免疫三表一致性测试上线时补):官方减伤表
  // pct=100 的七个免疫里唯独它不在本表 —— 法术护佑(魔法免疫,mask 0x7e),
  // duration 与官方表/override 一致取 10。
  "204018": { type: "immunities" }, // Blessing of Spellwarding
  // Added 2026-07-21: of the three Paladin blessings in the missed-cleanse
  // whitelist, only BoP had a category entry; Freedom/Sacrifice were missing
  // -> getPriority fell to Low -> not emitted once across the whole 1245-match
  // corpus. Their dispelType=Magic comes from DB2 mining (authoritative); only
  // the category label was missing.
  "1044": { type: "buffs_defensive" }, // Blessing of Freedom
  "6940": { type: "buffs_defensive" }, // Blessing of Sacrifice
  // Absorb shields (2026-08-12, user ruling: "they really are dispellable, and
  // their priority is moderate"). Both are officially Magic-dispellable, so an
  // offensive purger can strip them; durations come from the official table
  // (spellEffectGenerated), not typed in. buffs_defensive maps to purge
  // priority High — deliberately below the Critical tier that immunities and
  // hard CC occupy, which is what "moderate" means here. They were previously
  // invisible to the missed-purge analysis entirely: Ice Barrier had no
  // category at all (→ priority Low, never a candidate) and Power Word: Shield
  // was not even in the effect table (→ no dispel type, filtered out earlier).
  "17": { type: "buffs_defensive" }, // Power Word: Shield
  "11426": { type: "buffs_defensive" }, // Ice Barrier
  // ── 2026-08-13 可驱散增益补登(官方 DispelType × 120 场语料) ──────────────
  // 背景:能否驱散走官方数据,但**优先级**只认这张表和减伤白名单 —— 两处都没有
  // 就是 Low,永远进不了漏驱散分析。审计发现 72 个「官方可驱散却判 Low」的增益,
  // 下面登记的是其中「敌方交了它、你的击杀窗口就被实质拖住」的一档,统一 High
  // (与护盾同档,低于免疫/硬控的 Critical)。时长取官方表,括号内为语料出现段数
  // (共 342 段)。
  "342246": { type: "buffs_defensive" }, // Alter Time(法师,128 段)——回溯血量,不驱掉等于白打
  "1253593": { type: "buffs_defensive" }, // Void Shield(155 段)——吸收盾
  "406220": { type: "buffs_defensive" }, // Chi Cocoon(武僧,66 段)——吸收盾
  "1260681": { type: "buffs_defensive" }, // Chi Cocoon(另一 id,58 段)
  "457387": { type: "buffs_defensive" }, // Wind Barrier(71 段)——吸收盾
  // Earth Shield:用户裁定「没那么高」(2026-08-13)。官方可驱散(Magic)且需逐个
  // 维持,所以不进常驻团队增益的 blocklist;但它随手就能重上,驱掉的收益远不如
  // 护盾/爆发类,故归 buffs_other(→Medium)—— 登记在案、可被其他消费方看到,
  // 但不进「漏驱散」结论,避免灌爆话题。
  "974": { type: "buffs_other" }, // Earth Shield(萨满,77 段)
  "383648": { type: "buffs_other" }, // Earth Shield(另一 id,56 段)
  "41635": { type: "buffs_defensive" }, // Prayer of Mending(牧师,180 段)——弹射治疗
  "81700": { type: "buffs_offensive" }, // Archangel(戒律,140 段)——治疗量爆发
  "204361": { type: "buffs_offensive" }, // Bloodlust(69 段)——急速爆发
  // Decided 2026-07-22: missed cleanse only takes "discrete active
  // cooldowns", not permanent HoTs/shields (opening it up to permanent auras
  // measured 103 -> 892 rows, 59% of which was Rejuvenation-class noise --
  // see 2026-07-21-evidence-gap-survey §6.5).
  // The 7 entries below are the same class as Power Infusion; ids were
  // reverse-extracted from SPELL_AURA_APPLIED in the EN corpus and reviewed by
  // id against the full zh corpus (83-862 hits / 70 logs); dispelType=Magic
  // comes from DB2.
  // Durations are p50 of applied->removed in the EN corpus; Tip the Scales /
  // Nature's Swiftness have a p50 of only 0.4s (consumed immediately by the
  // next cast), and the 3s "not cleansed" threshold naturally filters out the
  // instantly consumed instances.
  "210256": { type: "buffs_defensive" }, // Blessing of Sanctuary (509 hits)
  "29166": { type: "buffs_defensive" }, // Innervate (183 hits)
  "212295": { type: "buffs_defensive" }, // Nether Ward (607 hits)
  "378441": { type: "buffs_defensive" }, // Time Stop (48 hits)
  "370553": { type: "buffs_defensive" }, // Tip the Scales (969 hits; p90=3.3s)
  "132158": { type: "buffs_defensive" }, // Nature's Swiftness (1257 hits; p90=2.9s)
  "378081": { type: "buffs_defensive" }, // Nature's Swiftness variant id (621 hits -- dual-id rot lesson, take both)
  "79206": { type: "buffs_defensive" }, // Spiritwalker's Grace (705 hits)
  // -- Offensive buffs (consumed by spellDanger / isOffensiveSpell) --
  "19574": { type: "buffs_offensive" }, // Bestial Wrath
  "1719": { type: "buffs_offensive" }, // Recklessness
  "13750": { type: "buffs_offensive" }, // Adrenaline Rush
  "121471": { type: "buffs_offensive" }, // Shadow Blades
  "190319": { type: "buffs_offensive" }, // Combustion
  "365350": { type: "buffs_offensive" }, // Arcane Surge
  "107574": { type: "buffs_offensive" }, // Avatar
  "10060": { type: "buffs_offensive" }, // Power Infusion
  "375087": { type: "buffs_offensive" }, // Dragonrage
  "51271": { type: "buffs_offensive" }, // Pillar of Frost
  "31884": { type: "buffs_offensive" }, // Avenging Wrath
  "288613": { type: "buffs_offensive" }, // Trueshot
  // Added by the 2026-07-14 full-corpus audit: 21% of the corpus had zero
  // [ENEMY CD] for the entire match -- the major burst cooldowns below had no
  // category, so isOffensiveSpell returned false and enemyCDs silently
  // dropped them (mostly DH / Rogue / Warlock / Elemental / Survival Hunter).
  "370965": { type: "debuffs_offensive" }, // The Hunt
  "185313": { type: "buffs_offensive" }, // Shadow Dance
  "360194": { type: "debuffs_offensive" }, // Deathmark
  "205180": { type: "buffs_offensive" }, // Summon Darkglare
  "191634": { type: "buffs_offensive" }, // Ascendance (Elemental)
  // 2026-07-17 per-spec sweep: for specs with a 100% none-tracked rate (Frost
  // Mage 210/210, Windwalker 129/129) and other high-gap specs, the actual
  // 12.x burst buttons were filled in from corpus SPELL_CAST_SUCCESS evidence.
  // Frost Mage in 12.x no longer casts Icy Veins (reworked into a passive);
  // the two below are the real pressure cooldowns.
  // Most of Retribution's gap is Radiant Glory passively triggering Avenging
  // Wrath (no cast event), which a cast-based tracker cannot follow -- that is
  // expected.
  "84714": { type: "debuffs_offensive" }, // Frozen Orb (Frost Mage, 60s)
  "205021": { type: "debuffs_offensive" }, // Ray of Frost (Frost Mage, 60s charge)
  "392983": { type: "debuffs_offensive" }, // Strike of the Windlord (Windwalker, 35s)
  "1233448": { type: "buffs_offensive" }, // Dark Transformation (Unholy DK 12.x variant id, 45s)
  "42650": { type: "buffs_offensive" }, // Army of the Dead (Unholy DK, 90s)
  "102560": { type: "buffs_offensive" }, // Incarnation: Chosen of Elune (Balance Druid, 180s)
  "194223": { type: "buffs_offensive" }, // Celestial Alignment (Balance Druid, 180s)
  "102543": { type: "buffs_offensive" }, // Incarnation: Avatar of Ashamane (Feral Druid, 180s)
  "106951": { type: "buffs_offensive" }, // Berserk (Feral Druid, 180s)
  "274837": { type: "debuffs_offensive" }, // Feral Frenzy (Feral Druid, 45s)
  "114051": { type: "buffs_offensive" }, // Ascendance (Enhancement, 180s)
  // Note on Enhancement's Doom Winds: activating it in 12.x produces no
  // standalone SPELL_CAST_SUCCESS (469270 is the per-attack proc cast, median
  // interval 1s), so a cast-based tracker cannot follow it -- the remaining
  // none-tracked share is expected.
  "466772": { type: "buffs_offensive" }, // Doom Winds buff id (aura only, for spellDanger)
  "1122": { type: "buffs_offensive" }, // Summon Infernal (Destruction, 120s; cast id, 111685 is the aura id)
  "6353": { type: "debuffs_offensive" }, // Soul Fire (Destruction, 45s nuke)
  "442726": { type: "buffs_offensive" }, // Malevolence (Destruction hero talent, 60s -- measured on corpus)
  "1261193": { type: "debuffs_offensive" }, // Boomstick (Survival Hunter 12.x, 60s charge)
  "1250646": { type: "debuffs_offensive" }, // Takedown (Survival Hunter 12.x, 90s)
  // Devourer Demon Hunter (new 12.1 spec) -- extracted from audit corpus
  // evidence (2026-07-14): cast frequency and event behaviour come from 123
  // real matches; durations are taken from the DB2 mining layer.
  "1241937": { type: "buffs_offensive" }, // Soul Immolation (main burst, 60s charge)
  "1246167": { type: "debuffs_offensive" }, // The Hunt (Devourer variant id)
  // -- Interrupts --
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
  // Added 2026-07-17 from corpus evidence (present in SPELL_INTERRUPT events
  // but previously absent from the list):
  "19647": { type: "interrupts" }, // Spell Lock (Warlock Felhunter, 476 hits in the corpus!)
  "93985": { type: "interrupts" }, // Skull Bash (Druid, 346 hits)
  "97547": { type: "interrupts" }, // Solar Beam interrupt component id (78675 is the cast id)
  "347008": { type: "interrupts" }, // Axe Toss variant (46 hits)
  "91807": { type: "interrupts" }, // Shambling Rush (DK ghoul, 25 hits)
  "217824": { type: "interrupts" }, // Shield of Virtue (Protection Paladin PvP talent)
  "31935": { type: "interrupts" }, // Avenger's Shield
  // -- Speed boosts --
  "2983": { type: "buffs_speed_boost" }, // Sprint
  "1850": { type: "buffs_speed_boost" }, // Dash
  "116841": { type: "buffs_speed_boost" }, // Tiger's Lust
  // -- Offensive debuffs --
  "702": { type: "debuffs_offensive" }, // Curse of Weakness
  "1714": { type: "debuffs_offensive" }, // Curse of Tongues
  "12654": { type: "debuffs_offensive" }, // Ignite
};
