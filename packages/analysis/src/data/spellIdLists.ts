/**
 * Spell id lists (a compliance-safe replacement for spellIdLists.json — the
 * original file is upstream ND-period material and is not carried over).
 * Source: Blizzard's public game facts. Replaced by subproject 5's pipeline
 * output.
 */
// 2026-08-21 S2 corpus scan (10,682 matches): removed Netherwalk 196555 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
const spellIdLists = {
  // Major personal defensive walls (excluding external damage reduction)
  bigDefensiveSpellIds: [
    "642",
    "45438",
    "871",
    "48792",
    "104773",
    "115203",
    "186265",
    "31224",
    "61336",
    "122470",
    "108271",
    "363916",
    "31850",
    "86659",
    "22812",
    "118038",
    "184364",
    "19236",
    "47585",
    "498",
    // 2026-08-23 用户裁定「复苏烈焰是大技能,虽然不是减伤」。它是**结构性无施法行**
    // 的被动 proc(见 cooldowns.ts 的 AURA_ONLY_ACTIVATION_IDS),证据只存在于光环
    // 374349:归档 400 个文件里上身 347 次、周期治疗 3,145 次、出现在 52 个文件。
    // dispelType 为 null,所以进本表不会派生出驱散指控(本表成员会被
    // dispelAnalysis.getPriority 当 Critical,见上面 attributedMitigation 的警告)。
    "374348",
  ],
  // Mitigation that must be ATTRIBUTED when active on a unit but is not a
  // coachable cooldown: a stance the player holds, or a buff someone else
  // maintains on them. Kept out of bigDefensiveSpellIds (which reads as "a wall
  // this player could have pressed") and out of externalDefensiveSpellIds
  // (whose members become "an ally could have thrown you this" suggestions and
  // are pinned to deathOutcomeAnalysis's table by a drift test). Consumed only
  // by the mitigation whitelist — see counterfactual.ts WHITELIST_IDS and
  // datagen/genMitigation.
  attributedMitigationSpellIds: [
    // 2026-08-12 audit: mitigation the analysis was blind to because it was on
    // no whitelist at all. It lands HERE and not in bigDefensiveSpellIds on
    // purpose: that list is not merely the mitigation whitelist —
    // dispelAnalysis.getPriority treats every member as a "Critical" purge
    // target, so adding these there silently turned enemy Fade/Ice Barrier into
    // must-purge findings (caught by the uncoveredHighlights fixture test:
    // two new missed-purge anchors at 60.1s and 76.8s). Percentages are mined
    // from the official DB2 table, never typed in.
    "586", // Fade (Priest) — the talented version reduces damage taken
    "264735", // Survival of the Fittest (Hunter)
    "1966", // Feint (Rogue)
    "107574", // Avatar (Warrior) — offensive burst that ALSO mitigates
    "11426", // Ice Barrier (Mage) — absorb shield
    "5277", // Evasion (Rogue) — dodge, not percentage mitigation
    "974", // Earth Shield (Shaman) — maintained on an ally, reduces their damage taken
    "386208", // Defensive Stance (Warrior) — a held stance, not a cooldown
    // Absorb shields: they carry no percentage (all sit in NO_MITIGATION_IDS),
    // but the death audit must still see them — their contribution is the
    // damage the log says they actually ate (absorbShields.ts). Without a
    // whitelist entry the audit filters the aura out entirely and the coach
    // reports "no mitigation" at a death the player shielded through.
    "17", // Power Word: Shield (Priest)
    "421453", // Ultimate Penitence (Priest)
    "198589", // Blur(恶魔猎手)—— 25% 全学派个人墙,减伤挂在 buff 212800 上;2026-08-22 补登记(此前整个减伤体系不认识它:白名单、减伤表、无减伤表三处皆无)
    // Ancient of Lore 知识古树(奶德 PvP 天赋,12.1 回归)—— 30% 全学派个人墙,减伤行就在
    // cast id 自己身上(DB2@12.1.0.69404 `aura87 pts=-30 misc=127`,EffectIndex 2),生成层
    // 一进白名单就能挖到,不用手工 override。补丁说明写的是 20%,官方表与 wowhead tooltip
    // 都是 30%(BACKLOG #24-9 的裁决就是「别照补丁说明填数」);S2 归档已观测(对局
    // 7d74b373,2026-08-13)。talentMitigationGenerated.json 同样挖到 30%(via "self s3
    // (aura 87) = -30"),但那张表目前零消费者,产品用的减伤算术只读 MITIGATION_TABLE。
    "473909",
    "108416", // Dark Pact (Warlock)
  ],
  // 团队/外放减伤。**名字里的 "cast on a teammate" 描述的不是它的实际内容** ——
  // 集结呐喊 97462、黑暗 196718、清风 374227、灵魂链接图腾 98008 都不是指向队友的
  // 技能,它们和苦修一样躺在这张表里已久。真正的口径是「按下去会给队友减伤的大
  // CD」,消费者(external-unused;criticalMoments 已于 2026-09-05 删除)也一直是按这个
  // 口径用它的。2026-08-22 补登记光环大师时把这条说清楚,免得下一个人照字面理解。
  // 「能不能**指向**队友」是另一个事实,由 data/spellTargeting.ts 的官方 targeting
  // 回答(GH #28),别把两件事混在这张表上。
  externalDefensiveSpellIds: [
    "33206", // Pain Suppression
    "47788", // Guardian Spirit
    "102342", // Ironbark
    "6940", // Blessing of Sacrifice
    "1022", // Blessing of Protection
    "204018", // Blessing of Spellwarding
    "116849", // Life Cocoon
    "62618", // Power Word: Barrier
    "98008", // Spirit Link Totem
    "97462", // Rallying Cry
    "196718", // Darkness
    "51052", // Anti-Magic Zone
    "357170", // Time Dilation
    "374227", // Zephyr
    "31821", // Aura Mastery — 2026-08-22 用户裁定 20%、2026-09-04 改按官方 PvP 链路 24%(3 + 9 × 2.34)全团减伤(见 mitigationData.ts 该条注释的官方链路与语料实证);补登记到这里是因为减伤表有「无第三态」不变量:有减伤值的 id 必须已经是登记在册的防御技能
  ],
  // External or major personal defensives (the list above + the main personal
  // walls)
  externalOrBigDefensiveSpellIds: [
    "33206",
    "47788",
    "102342",
    "6940",
    "1022",
    "204018",
    "116849",
    "62618",
    "98008",
    "97462",
    "196718",
    "51052",
    "357170",
    "374227",
    "642",
    "45438",
    "871",
    "48792",
    "104773",
    "115203",
    "186265",
    "31224",
    "61336",
    "122470",
    "108271",
    "363916",
    "31850",
    "86659",
    "22812",
    "5277",
    "118038",
    "184364",
    "19236",
    "47585",
    "498",
    "64843",
    "740",
    "200183",
    "31821",
  ],
};
export default spellIdLists;
