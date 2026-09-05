/**
 * 非官方技能事实签字册(B2,2026-08-14 起正式制度)。
 *
 * 背景:2026-08-14 全量规范审计(58 条断言,~17% 规范层错误率)发现错误母题集中在
 * 「无官方字段背书、靠模型/文档先验断言的技能事实」——2 例天赋效果张冠李戴(破蛹化蝶的
 * 复苏之茧减 CD 效果被安到静心织魂头上)、3 例「被控状态下能按什么」机制误判。B1(见
 * `usableWhileCcGenerated.ts`/`cooldowns.ts`)把「能按什么」尽量官方化;本文件收官方数据
 * 覆盖不到、必须靠人工裁决的剩余事实面。
 *
 * 签字流程:
 * 1. 凡无官方 DB2 字段背书的技能/天赋事实断言(效果因果、代价规范、机制限制……)要写进
 *    分析/深挖消费方前,先在此登记一条 `ICuratedAbilityFact`。
 * 2. 新增条目必须附 `source`(官方 tooltip / wowhead 链接 / 审计报告 / 用户裁决记录)与
 *    `approved`(格式 "YYYY-MM-DD user"——裁决当天由用户在会话里逐条「批」,不是自封)。
 * 3. `CURATED_ABILITY_FACTS` 的每一条被 `test/curatedFacts.test.ts` 强制检查:没有
 *    `approved` 字段、或格式不是 `/^\d{4}-\d{2}-\d{2} user$/` → CI 红。这是 CLAUDE.md
 *    「修复要给前后数字」纪律在登记侧的配套——没有签字戳的断言不许悄悄进正册。
 * 4. `PROPOSED_FACTS` 是待签暂存区:研究已完成、来源已附,但尚未获用户批准的条目放这里
 *    (类型故意去掉 `approved` 字段,不许伪造日期占位)。它**不受**上面的 CI 强制测试
 *    覆盖,只是暂存;获批后把条目连同补上的 `approved` 戳迁入 `CURATED_ABILITY_FACTS`,
 *    并**从这里删除**——晋升即移除,`PROPOSED_FACTS` 任一时刻只应装着"还没批"的条目,
 *    不装"已经批过、留个副本"的条目(否则两处各存一份,后续任一处漏更新就是悄悄分叉)。
 *    任何消费方都不应该直接 import `PROPOSED_FACTS`(见下方边界测试)。
 *
 * 先例:`packages/analysis/src/utils/mitigationData.ts` 的 MITIGATION_OVERRIDES(每条带
 * 来源 + 用户拍板日期)、`talentBehaviors.ts`「仅收录经验证的天赋」纪律。
 *
 * `usable_while_feared_gap`(kind,2026-08-15 新增,挂账清理 Task E):`usable_while_cc_gap`
 * 是「官方 468 集(stunned 维度)的覆盖缺口」——它的语义与 cooldowns.ts 的
 * `USABLE_WHILE_CC_GAP_IDS` 双向交叉检查绑定(见 test/curatedFacts.test.ts)。feared 维度
 * **没有**官方生成表(`usableWhileCcGenerated.ts` 自己的注释:「feared: NOT emitted」),
 * 也**没有**消费方读取这个事实(shim 只吃 stunned)——所以不能复用 `usable_while_cc_gap`,
 * 那会错误地把 feared 事实绑上一个只该管 stunned 维度的双向 wiring 检查。这是一个新的、
 * 独立的 kind:**只记录真值,不接线**。任何未来给 feared 维度加消费方的工作,应该新写
 * 一个对应的双向一致性测试(同 usable_while_cc_gap 的先例),而不是默认这个 kind 已经被
 * 谁读取了。
 */

/**
 * `throughput_role`(kind,2026-08-22 新增,GH #29 阶段 1 用户裁定):某个挂着
 * `SpellTag.Defensive` 的大 CD **实际上是产出型**——它不给自己减伤,收益落在你
 * 治疗/输出的对象身上。这是三值 tag 表达不了、官方 DB2 也给不出的一维:官方没有
 * 「这是产出 CD」字段,只有十几种含义各异的 modifier 光环(107/108 的语义还藏在
 * SpellModOp 码里,并集只覆盖 64.7% —— 详见 GH #29 第四节的实测)。所以它必须走
 * 签字册,而不是再开一张手工表。
 *
 * 接线是**双向绑定**的:`cooldowns.ts` 的 `THROUGHPUT_EMPOWER_DEFENSIVE_IDS`
 * 直接由本册这个 kind 派生(不再各写一份),`test/curatedFacts.test.ts` 双向钉住。
 * 消费方是 `canHelpAnotherUnit`(GH #28):这些 CD 官方目标是施法者自己,但按下去
 * 确实帮到被你治疗的队友,所以不能被「自保技能救不了队友」那道门滤掉。
 */
export interface ICuratedAbilityFact {
  id: string; // spellId 或 talent spellId
  claim: string; // 一句中文事实断言
  kind:
    | "talent_effect"
    | "usable_while_cc_gap"
    | "usable_while_cc_conditional"
    | "usable_while_feared_gap"
    | "mechanic"
    | "cost_norm"
    | "throughput_role"
    | "save_role"
    | "not_save_role";
  /** conditional 类:授权 PvP 天赋 spellId(2026-08-14 用户设计:被控可用可为天赋条件性) */
  requiresTalent?: string;
  source: string; // 出处(官方 tooltip/wowhead 链接/裁决记录)
  approved: string; // "YYYY-MM-DD user" —— 无此字段的条目测试红
}

export const CURATED_ABILITY_FACTS: ICuratedAbilityFact[] = [
  // ── save_role / not_save_role (2026-09-04, GH #63) ──────────────────────
  // `save_role`: a healer cooldown whose OFFICIAL ability profile is silent
  // (it empowers the next cast, or casts another spell) but which the corpus
  // measured as a save tool under the user-ruled door — Δ protection to the
  // lowest friendly in the 5 s after the press ≥ 10 pp of max HP, or death-
  // within-10 s contrast vs control ≥ 5 pp, n ≥ 100 (saveCdImpactScan.ts,
  // eval-private/reports/healer-save-cd-2026-09-04/impact-report.md).
  // `not_save_role`: clears the door but the user ruled it out of the SAVE
  // roster (core rotational heals; Lightsmith armaments). Consumed ONLY by
  // healerSaveCdScan.ts emit-table (the roster generator); the generated
  // healerSaveCdGenerated.json is what the product reads.
  {
    id: "375576",
    claim: "圣洁鸣钟(Divine Toll,奶骑):对 5 个目标施放圣光震击,是救人级的大治疗;官方画像只看到「施放另一个法术」。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63);语料 n=878,Δ +13 pp,10 秒阵亡 4.6% vs 对照 7.2%",
    approved: "2026-09-04 user",
  },
  {
    id: "31884",
    claim: "复仇之怒(Avenging Wrath):奶骑手里是治疗 +20% 的放大器,放大出来的量在按下后 5 秒内到达。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63);语料 n=456,Δ +21 pp,阵亡 3.1% vs 5.8%",
    approved: "2026-09-04 user",
  },
  {
    id: "132158",
    claim: "自然迅捷(Nature's Swiftness,奶德):下一个治疗瞬发;语料 Δ 只有 +2、阵亡 7.7% vs 7.9%,踩线,用户裁定进名单。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63,原话「自然迅捷和福音还行」);语料 n=678",
    approved: "2026-09-04 user",
  },
  {
    id: "378081",
    claim: "自然迅捷(Nature's Swiftness,奶萨):下一个治疗瞬发,放大量落在窗口内。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63);语料 n=1055,Δ +20 pp,阵亡 2.6% vs 7.0%",
    approved: "2026-09-04 user",
  },
  {
    id: "472433",
    claim: "福音(Evangelism,戒律):延长救赎并群体回血;语料 Δ +9、阵亡 5.9% vs 8.1% 踩线,用户裁定进名单。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63,原话「自然迅捷和福音还行」);语料 n=1251",
    approved: "2026-09-04 user",
  },
  {
    id: "370537",
    claim: "静滞(Stasis,奶龙):存下三个法术一起释放,产出在按下后 5 秒内到达。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63);语料 n=286,Δ +18 pp,阵亡 3.5% vs 11.1%",
    approved: "2026-09-04 user",
  },
  {
    id: "370553",
    claim: "天平倾斜(Tip the Scales,奶龙):下一个蓄力法术满蓄瞬发。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63);语料 n=283,Δ +20 pp,阵亡 3.9% vs 9.7%",
    approved: "2026-09-04 user",
  },
  {
    id: "391528",
    claim: "万灵之召(Convoke the Spirits,奶德):治疗爆发引导。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63);语料 n=181,Δ +11 pp,阵亡 8.3% vs 7.6%",
    approved: "2026-09-04 user",
  },
  {
    id: "31821",
    claim: "光环掌握(Aura Mastery,奶骑):全队 20% 减伤外放;语料 Δ 9.9 / 阵亡差 4.2pp 差门一线,减伤类在 5 秒窗被低估,用户裁定进名单。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63,「1 做」);语料 n=901,阵亡 2.8% vs 7.0%",
    approved: "2026-09-04 user",
  },
  {
    id: "6940",
    claim: "牺牲祝福(Blessing of Sacrifice,奶骑):转伤外放;语料 Δ 9.8 / 阵亡差 3.9pp 差门一线,用户裁定进名单。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63,「1 做」);语料 n=961,阵亡 1.8% vs 5.7%",
    approved: "2026-09-04 user",
  },
  {
    id: "115310",
    claim: "还阳术(Revival,织雾):团队群疗 + 驱散;12.1 首周语料 n=36 不够门槛,Δ +29,用户裁定先进名单,赛季语料变多后复核。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63,「你说的那三个也加进去」)",
    approved: "2026-09-04 user",
  },
  {
    id: "443028",
    claim: "天神之道(Celestial Conduit,织雾 Conduit):引导群疗;语料 n=45 不够门槛,Δ +26,用户裁定先进名单。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63,「你说的那三个也加进去」)",
    approved: "2026-09-04 user",
  },
  {
    id: "473909",
    claim: "知识古树(Ancient of Lore,奶德):语料 n=99 差一个样本,Δ +8.5,用户裁定先进名单。",
    kind: "save_role",
    source: "用户裁定 2026-09-04(GH #63,「你说的那三个也加进去」)",
    approved: "2026-09-04 user",
  },
  {
    id: "443454",
    claim: "先祖迅捷(Ancestral Swiftness,奶萨 Farseer):12.x 是 30 秒冷却,按「30 秒核心治疗不算救人牌」的裁决拿掉;Δ +22 过门,可翻。",
    kind: "not_save_role",
    source: "用户裁定 2026-09-04(GH #63,「2 也做吧」)",
    approved: "2026-09-04 user",
  },
  {
    id: "116680",
    claim: "雷霆焦茶(Thunder Focus Tea,织雾):30 秒冷却的核心治疗强化,用户裁定不算救人牌(「有点多了」)。",
    kind: "not_save_role",
    source: "用户裁定 2026-09-04(GH #63);语料 n=1162,Δ +18 pp —— 过门但排除",
    approved: "2026-09-04 user",
  },
  {
    id: "355936",
    claim: "梦境吐息(Dream Breath,奶龙):30 秒冷却的核心治疗,用户裁定不算救人牌。",
    kind: "not_save_role",
    source: "用户裁定 2026-09-04(GH #63);语料 n=1324,Δ +19 pp —— 过门但排除",
    approved: "2026-09-04 user",
  },
  {
    id: "2050",
    claim: "圣言术:宁(Holy Word: Serenity,神牧):核心治疗,用户裁定不算救人牌。",
    kind: "not_save_role",
    source: "用户裁定 2026-09-04(GH #63);语料 n=18088,Δ +38 pp —— 过门但排除",
    approved: "2026-09-04 user",
  },
  {
    id: "34861",
    claim: "圣言术:洁(Holy Word: Sanctify,神牧):与圣言术:宁同族的核心治疗,按同一裁决排除;未单独点名,可翻。",
    kind: "not_save_role",
    source: "同 2050 的 2026-09-04 裁决推及;语料 n=937,Δ +23 pp",
    approved: "2026-09-04 user",
  },
  {
    id: "432459",
    claim: "圣洁壁垒(Holy Bulwark,奶骑 Lightsmith):用户裁定不进(「其他不行」)。",
    kind: "not_save_role",
    source: "用户裁定 2026-09-04(GH #63);语料 n=1140,Δ +6 pp,阵亡 3.4% vs 6.5% —— 未过门",
    approved: "2026-09-04 user",
  },
  {
    id: "432472",
    claim: "神圣武器(Sacred Weapon,奶骑 Lightsmith):用户裁定不进。",
    kind: "not_save_role",
    source: "用户裁定 2026-09-04(GH #63);语料 n=1019,Δ +7 pp,阵亡 5.0% vs 5.9% —— 未过门",
    approved: "2026-09-04 user",
  },
  {
    id: "200183",
    claim:
      "神圣显灵(Apotheosis,神牧):是治疗大技能,不是保命技能——它强化的是你的" +
      "圣言术产出,自己的血条不因此变厚。队友垂危时按它是成立的应对。",
    kind: "throughput_role",
    source:
      "用户裁定 2026-08-22(会话内原话:「第一个是治疗大技能」);官方 SpellEffect " +
      "只有 aura108 spell modifier,无 aura87/69/39 与任何治疗效果行,佐证它不是减伤",
    approved: "2026-08-22 user",
  },
  {
    id: "216331",
    claim:
      "复仇十字军(Avenging Crusader):随专精而定——奶骑(神圣)身上它是主要治疗、" +
      "附带一点伤害,按产出 CD 记;它同样不给自己减伤。",
    kind: "throughput_role",
    source:
      "用户裁定 2026-08-22(会话内原话:「第二个取决于专精 奶骑就是主要治疗加一点" +
      "伤害」);官方 SpellEffect 只有 aura344/129,无减伤/吸收/免疫行",
    approved: "2026-08-22 user",
  },
  {
    id: "202424",
    claim:
      "破蛹化蝶(Metamorphosis,秘法师天赋):使复苏之茧(Life Cocoon, 116849)冷却缩短 45 秒",
    kind: "talent_effect",
    source:
      "官方天赋数据 talentModifiers.json(116849 → [{talentSpellId: 202424, effect: reduce_cd, value: 45}]) " +
      "+ 规范审计报告 2026-08-14(纠正此前把该效果错安到静心织魂头上的张冠李戴)",
    approved: "2026-08-14 user",
  },
  {
    id: "353313",
    claim:
      "静心织魂(Peaceweaver,秘法师天赋):不修正复苏之茧(116849)冷却——此前审计曾误将破蛹化蝶的减 CD 效果安到它头上",
    kind: "talent_effect",
    source:
      "官方天赋数据 talentModifiers.json(116849 的 reduce_cd 修正条目里只有 202424 一条,不含 353313)" +
      "+ 规范审计报告 2026-08-14",
    approved: "2026-08-14 user",
  },
  {
    id: "642",
    claim:
      "圣盾术(Divine Shield):机制上任何被控状态可施放,但代价过高,不得被推荐为常规挡控手段(仅致死威胁下的最后手段)",
    kind: "cost_norm",
    source:
      "用户裁决 2026-08-14(见 task-4-report.md §4:与官方 usable-while-stunned 位判定不冲突,教练规范层单独裁决)",
    approved: "2026-08-14 user",
  },
  {
    id: "45438",
    claim:
      "寒冰屏障(Ice Block):同圣盾——机制可用、代价禁止常规使用,仅别无选择时",
    kind: "cost_norm",
    source: "用户补充裁决 2026-08-14",
    approved: "2026-08-14 user",
  },
  {
    id: "55233",
    claim:
      "吸血鬼之血(Vampiric Blood):任何被控状态下均不可施放(旧手写表误收,已从 USABLE_WHILE_CC shim 清除)",
    kind: "mechanic",
    source:
      "用户裁决 2026-08-14(“都不行”)+ 语料 1028 场 0 次晕中施放成功佐证(task-4-report.md §4)" +
      "+ 官方 usable-while-stunned 468 集不含此 id(task-5-report.md)",
    approved: "2026-08-14 user",
  },
  {
    id: "119996",
    claim:
      "转世:转移(Transcendence: Transfer):基线在被控(晕)状态下不可施放;携带秘法师 " +
      "PvP 天赋「明心 / Eminence」(353584,秘法师专精池 spec 270)时可在晕中施放,且非晕中" +
      "施放额外减 15 秒冷却",
    kind: "usable_while_cc_conditional",
    requiresTalent: "353584",
    source:
      "wowhead spell=119996 Flags 栏「Allow While Stunned by Stun Mechanic」+「Allow While " +
      "Stunned By Horror Mechanic」(2026-08-14 WebFetch 逐条核实,与 task-4-report.md §3.1 " +
      "同一证据;该报告把此位判定为官方 468 集的覆盖缺口而非规则本身有误)+ Icy Veins " +
      "《Mistweaver Monk PvP Talents and Builds》(2026-08-14 抓取)原文「Eminence allows you " +
      "to use Transcendence: Transfer while stunned」+ Blizzard 9.1.0 (2021-06-29) 补丁说明" +
      "原文「Transcendence: Transfer can now be cast if you are stunned. Cooldown reduced by " +
      "15 sec if you are not.」+ `pvpTalentPoolGenerated.ts`(build 12.1.0.69273)spec 270 " +
      "(Mistweaver)天赋池含 353584,确认该天赋在当前 build 仍存在。2026-08-14 用户批准晋升。",
    approved: "2026-08-14 user",
  },
  {
    id: "498",
    claim:
      "圣佑术(Divine Protection,圣骑士):被控(晕)状态下可无条件施放——wowhead 位标志" +
      "「Allow While Stunned by Stun Mechanic」直接标在本技能上,属官方 468 集 ≤2 位并集" +
      "搜索的覆盖缺口而非规则本身有误",
    kind: "usable_while_cc_gap",
    source:
      "wowhead spell=498 Flags 栏「Allow While Stunned by Stun Mechanic」" +
      "(2026-08-14 WebFetch 核实)+ 语料 341 次晕中施放成功(与 403876 合计 748 次," +
      "task-4-report.md §3.1)+ 用户本职业确认(2026-08-14,PAUSE 2 裁决)。" +
      "Shim 总数:470 → 471(与 51490 同批并入)。",
    approved: "2026-08-14 user",
  },
  {
    id: "403876",
    claim:
      "圣佑术(Divine Protection,圣骑士,天赋克隆 id):同 498——被控(晕)状态下可无条件" +
      "施放,官方 468 集覆盖缺口",
    kind: "usable_while_cc_gap",
    source:
      "wowhead spell=403876 Flags 栏「Allow While Stunned by Stun Mechanic」" +
      "(2026-08-14 WebFetch 核实)+ 语料 407 次晕中施放成功(与 498 合计 748 次," +
      "task-4-report.md §3.1)+ 用户本职业确认(2026-08-14,PAUSE 2 裁决)。",
    approved: "2026-08-14 user",
  },
  {
    id: "51490",
    claim:
      "雷霆风暴(Thunderstorm):被控(晕)状态下可无条件施放——基线法术自带的位,不依赖任何 " +
      "PvP 天赋(搜遍萨满全三专精 PvP 天赋池与攻略站均未找到 gating 天赋,负结果查证)",
    kind: "usable_while_cc_gap",
    source:
      "wowhead spell=51490 Flags 栏「Allow While Stunned by Stun Mechanic」直接标在基础技能上" +
      "(2026-08-14 WebFetch 核实;与 498/403876 同款证据形态——散位族未被官方 468 集的" +
      "≤2 位并集采纳组合收录,属覆盖缺口而非规则本身有误)+ 语料 321 次晕中施放成功" +
      "(task-4-report.md §3.1)+ 授权天赋负结果查证(`pvpTalentPoolGenerated.ts` spec " +
      "262/263/264 萨满三专精 PvP 天赋池逐条核对、Icy Veins《Elemental Shaman PvP Talents " +
      "and Builds》全文均无 gating 天赋线索,该效果实为 WotLK 3.1.0(2009-04-14)起的基线" +
      "改动)。2026-08-14 用户批准以无条件缺口层形式入册。",
    approved: "2026-08-14 user",
  },
  {
    id: "7744",
    claim:
      "被遗忘者的意志(Will of the Forsaken,亡灵种族技能):恐惧中可施放(解控用途)——" +
      "但 SpellMisc 命名位 177「Allow While Fleeing」为否,解控类种族技能的可用性不走属性位," +
      "所以进 cooldowns.ts USABLE_WHILE_FEARED_GAP_IDS 手工层,并作为 genUsableWhileCc 锚点门的豁免",
    kind: "usable_while_feared_gap",
    source:
      "用户 2026-08-14 裁决 feared=true(usableWhileCcAnchors.ts 7744 条,玩家共识/技能设计意图)+ " +
      "2026-09-04 命名位核对(SimC sc_spell_info.cpp 177 / TrinityCore SPELL_ATTR5_ALLOW_WHILE_FLEEING:未置位)。",
    approved: "2026-08-14 user",
  },
  {
    id: "22812",
    claim: "树皮术(Barkskin,德鲁伊)可在恐惧类硬控(disorient 类 CC)中施放",
    kind: "usable_while_feared_gap",
    source:
      "三线证据汇合:(1)语料——挂账清理 Task E 全库语料观测线(disorient 类,1028/1028 场)" +
      "在 disorient 窗口内观测到 35 次树皮术施放成功,其中 9 条(42-472ms)是 sub-500ms 疑似" +
      "边界排队伪影已剔除,**26 条(539ms-5101ms)跨 6 个不同恐惧类 aura、跨数十场不同对局/" +
      "玩家的中窗清白样本**构成支持证据(uwc-feared-diff.md,task-E-report.md §4);" +
      "(2)游戏内 tooltip——树皮术 tooltip 明写恐惧下可用;" +
      "(3)wowhead.com/spell=22812 Flags 栏「Usable while feared」(2026-08-14 WebFetch 抓取)。" +
      "三线证据一致,推翻用户 2026-08-14 最初的「只有昏迷可用」回忆(usableWhileCcAnchors.ts" +
      "该条注记有完整改判过程)。**无消费方**——feared 维度没有官方生成表" +
      "(`usableWhileCcGenerated.ts`:「feared: NOT emitted」)、shim 只吃 stunned 维度," +
      "本条目只记录真值,不接线到任何消费方。",
    approved: "2026-08-15 user",
  },
];

/**
 * 待签暂存区(见文件头 §4)。当前为空——2026-08-14 唯二曾在此暂存过的候选(119996 转世:
 * 转移 / 51490 雷霆风暴,均为 Task 6 的研究产出)已获用户批准,按「晋升即移除」纪律迁入
 * `CURATED_ABILITY_FACTS`(见上方对应条目及其 source 里的完整证据链),不在此重复留档。
 */
export const PROPOSED_FACTS: Array<Omit<ICuratedAbilityFact, "approved">> = [];
// 2026-08-22:光环大师 31821 那条待签项已结案 —— 用户裁定 20% 全团,值写进
// mitigationData.ts 的 MITIGATION_OVERRIDES(减伤数值归那张表管),进攻侧裁定
// 记为 unresolved 空缺。按本文件纪律「晋升即移除」,这里不留副本。

/**
 * Cost-norm guard-note phrase (#25, 2026-08-14 挂账清理 Task D). Follows the
 * 「候选门会被富上下文绕过 → 同谓词守护注」precedent set by the dispel
 * capability gates in candidateFindings.ts (ownerCanDispel/eligibleDispellers):
 * a fact carries the guard, the prompt explains the field. Here the guard is
 * "this spell is mechanically usable but its cost is too high to be coached as
 * a routine defensive" (圣盾术/寒冰屏障 today). The short phrase is derived
 * ONCE here — candidateFindings.ts's defensive-suggestion facts (e.g.
 * death-unused-defensive's `walls`, cd-waste) call this instead of each
 * re-deriving wording from `claim` independently, so the phrase itself stays
 * single-source (CLAUDE.md 门规谓词即规范, extended to UI/prompt wording).
 * `CURATED_ABILITY_FACTS` is this book's first consumer — a deliberate
 * import, not a boundary violation (only `PROPOSED_FACTS` is fenced, see the
 * import-boundary test in test/curatedFacts.test.ts).
 */
const COST_NORM_SHORT_PHRASE =
  "大技能:机制可用,但代价过高,不得推荐为常规挡控手段,仅致死威胁下的最后手段";

export function costNormPhrase(spellId: string): string | null {
  const hit = CURATED_ABILITY_FACTS.find(
    (f) => f.kind === "cost_norm" && f.id === spellId,
  );
  return hit ? COST_NORM_SHORT_PHRASE : null;
}
