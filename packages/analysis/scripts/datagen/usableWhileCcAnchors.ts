// 用户签字:2026-08-14(逐条裁决,详见 task-2-report.md 附录);
// 2026-08-15 补签一批(挂账清理 Task E,恐惧维度语料裁决——22812 树皮术 feared
// null→true;33206/1022 feared 维持 false,矛盾语料记录在案,详见各自条目
// rationale 与 task-E-report.md 附录)。
/**
 * **2026-09-04 更正(BACKLOG #41 (8))**:本文件头「重要先验」段落把「No Client Fail While Stunned, Fleeing,
 * Confused」(SimC 属性表 244 / SPELL_ATTR7_NO_CLIENT_FAIL_WHILE_STUNNED_FLEEING_CONFUSED)当成真正的被控可用位,
 * 这是错的——按 TrinityCore 命名它只抑制客户端报错文案。真正的位是 163 / 378 / 177 / 178(见 genUsableWhileCc.ts 头)。
 * 依据这个先验签的三个锚点(642 / 45438 / 48792)已由用户 2026-09-04 改裁为 false,原记录保留在各条 rationale 里。
 *
 * 「被控(晕/恐惧/混乱)下能否主动施放」锚定清单 —— 技能事实地基 Task 2。
 * 状态:已用户签字批准(2026-08-14,逐条裁决记录见 task-2-report.md 附录;
 * 2026-08-15 就恐惧维度补签一批,见上方注记与 task-E-report.md 附录)。
 *
 * 目的:Task 3 用官方 SpellMisc/Spell.db2 位字段做全量位搜索时,需要一批
 * "已知真值"锚点来判定候选位是否就是"usable while stunned/feared/confused"
 * 三个位。
 *
 * 判断维度:三维度分别对应"该技能在玩家处于晕(Stun)/恐惧(Horror/Fear 类
 * 机制)/混乱(Disorient 类机制)状态下,能否被玩家主动吟唱/施放出去",不是
 * "该技能能否驱散/免疫这类控制"(两者不同 —— 例如角斗士的勋章既能在晕中
 * 被按下,也能驱散晕本身)。
 *
 * 出处方法论:2026-08-14 对每条锚点用 WebFetch 抓取 wowhead.com 对应
 * spell 页面的 "Flags" 栏(该栏是 wowhead 对 Blizzard Spell.db2 相关
 * AttributesEx 位的可读渲染,和 Task 3 要找的官方位是同一数据源的不同
 * 呈现形式,但不是该位本身,故仍属"较高置信度人工核对"而非"官方位实测")。
 * 两种关键旗标措辞:
 *   - "Can be used while stunned" / "Usable while feared" / "Usable while
 *     confused"(Medallion/Barkskin/Dispersion/Unending Resolve 都有),
 *     或 Pain Suppression 那种按机制分述的 "Allow While Stunned by
 *     Stun/Horror Mechanic"。
 *   - "No Client Fail While Stunned, Fleeing, Confused"(Divine Shield /
 *     Ice Block 都有)。
 *
 * **重要先验,2026-08-14 用户签字时改判**:草案曾把第二种旗标当成"只抑制
 * 报错文案、不代表真的能施放"的反例(依据是"晕中开不出寒冰屏障"的一般
 * PvP 印象),并据此把 642 圣盾术、45438 寒冰屏障都判为不可用。用户逐条
 * 核实后给出相反的一手证词:两者机制上**任何被控状态下都能按下**(45438
 * 用户原话「都可以用」;642 此前"晕中开不出"是误记,语音记录里"生存树"
 * 实指圣盾术)。两条独立证词汇合到同一旗标上,说明「No Client Fail While
 * Stunned, Fleeing, Confused」很可能就是真正的"被控可用"位,而不是无关
 * 的报错抑制位 —— 这是 Task 3 位搜索的重要先验,应优先验证这个旗标对应
 * 的官方位,不要因为草案曾经的误判而排除它。
 *
 * 用户同时给出的教练规范意见(642/45438 都属"代价太大、仅在别无选择时
 * 用,不推荐当常规挡控手段")是产品规范层面的判断,与"机制上能不能按下"
 * 是两回事 —— 已在各自 rationale 里分层注明,规范条目本身归 Task 6 签字
 * 册,不影响本文件的机制判定。
 *
 * 手写表出处:packages/analysis/src/utils/cooldowns.ts:127
 * USABLE_WHILE_CC_SPELL_IDS(6 条,原始意图见其上方注释:避免把"被控锁死
 * 而没用防御技能"误判为"该用没用"的假指控)。
 */

export interface UwcAnchor {
  spellId: string;
  /** 中文技能名,核对自 spellNamesZhGenerated.json / spellNames.json,仅供人工审阅用。 */
  name: string;
  /** 晕(Stun 机制)下能否主动施放;null=不作锚定。 */
  stunned: boolean | null;
  /** 恐惧(Horror/Fear 机制)下能否主动施放;null=不作锚定。 */
  feared: boolean | null;
  /** 混乱(Disorient 机制)下能否主动施放;null=不作锚定。 */
  confused: boolean | null;
  /** 一句话理由(含用户裁决注记)。 */
  rationale: string;
  /** 一条出处(手写表行号 / wowhead 抓取 / 用户裁决日期 / brief 语料实证)。 */
  source: string;
}

/** 用户批准记录 —— 逐条裁决详情见 task-2-report.md 附录。 */
export const approvedBy = "user (2026-08-14)";

/**
 * 13 条锚点,已用户逐条签字批准(2026-08-14)。Task 3 消费的最小契约是
 * `{ spellId, name, stunned, feared, confused, rationale }`(本文件多出的
 * `source` 字段是结构超集,不影响该契约的结构兼容性)。
 */
export const UWC_ANCHORS: UwcAnchor[] = [
  // ---- 现手写表 6 条(逐一核验/用户裁决)----
  {
    spellId: "33206",
    name: "痛苦压制",
    stunned: true,
    feared: false,
    confused: false,
    rationale:
      "手写表原有条目(戒律牧外置减伤)。草案曾据 wowhead flags 栏「Allow While Stunned By Horror Mechanic」把 feared 判 true,但用户 2026-08-14 裁决「只有昏迷可以用」,与游戏内 tooltip 一致 —— 按裁决改判 feared=false、confused=false。旗标读取疑似把 Horror 亚类(与恐惧机制部分重叠但不等价)误当成「恐惧可用」的证据,提示 wowhead Flags 栏的机制细分需更谨慎解读,留 Task 3 官方位验证。" +
      "**2026-08-15 语料矛盾在案(不改值)**:挂账清理 Task E 全库语料观测线(disorient 类,1028/1028 场)在 disorient 窗口内观测到 3 次痛苦压制施放成功" +
      "(3 个不同对局/玩家,100% Player 施放者,毫秒差 3167/4596/9150ms,前两条不贴边)——用户 2026-08-15 复签「痛压只能在晕里用」,**维持 feared=false**," +
      "语料矛盾记录在案不改判。首选嫌疑:(a)丢失 SPELL_AURA_REMOVED 型幻影窗口(恐惧被伤害打断而移除事件缺失,同 stun 观测线已证实的 422→247 一类机制," +
      "见 `packages/eval/src/explore/uwcObserved.ts` 模块头);(b)Horror 亚类授权(旗标读取疑似把「Allow While Stunned By Horror Mechanic」误当恐惧可用证据," +
      "见上方草案注)。两个嫌疑均待查,不构成推翻用户对自身职业技能证词的依据。详见 `$GLADLOG_EVAL_HOME/reports/uwc-feared-diff.md`。",
    source:
      "cooldowns.ts:128 + wowhead.com/spell=33206 Flags 栏(2026-08-14 抓取)+ 用户 2026-08-14 裁决(只有昏迷可用,与游戏内 tooltip 一致)+ " +
      "挂账清理 Task E 语料矛盾记录(2026-08-14 全量扫描,3 次中窗观测,uwc-feared-diff.md)+ 用户 2026-08-15 复签维持 false",
  },
  {
    spellId: "22812",
    name: "树皮术",
    stunned: true,
    feared: true,
    confused: null,
    rationale:
      "手写表原有条目(德鲁伊自我减伤)。用户 2026-08-14 表示只有昏迷可用(即 feared=false),但游戏内 tooltip 明写恐惧下可用,与 wowhead flags「Usable while feared」一致 —— 两方证据正面冲突,原判 null 留裁。" +
      "**2026-08-15 经语料裁决改判 true,用户签字**:挂账清理 Task E 全库语料观测线(disorient 类,1028/1028 场)在 disorient 窗口内观测到 35 次树皮术施放成功," +
      "其中 9 条(42-472ms)是 sub-500ms 疑似边界排队伪影已剔除、不计入证据,**26 条(539ms-5101ms)跨 6 个不同恐惧类 aura、跨数十场不同对局/玩家的中窗清白样本** —— " +
      "语料(26/35 中窗)+ 游戏内 tooltip + wowhead flags「Usable while feared」三线证据汇合,用户 2026-08-15 复核后批准改判 feared=true," +
      "推翻此前「用户意见 false」的记录。详见 `$GLADLOG_EVAL_HOME/reports/uwc-feared-diff.md` 与 task-E-report.md。confused 维度证据仍不足,维持 null。",
    source:
      "cooldowns.ts:129 + wowhead.com/spell=22812 Flags 栏(2026-08-14 抓取)+ 用户 2026-08-14 裁决(冲突,留裁)+ " +
      "挂账清理 Task E 语料观测线(2026-08-14 全量扫描,26/35 中窗清白样本,uwc-feared-diff.md)+ 用户 2026-08-15 复核签字(改判 true)",
  },
  {
    spellId: "47585",
    name: "消散",
    stunned: true,
    feared: null,
    confused: null,
    rationale:
      "手写表原有条目(暗牧自我减伤),与树皮术同一处理:用户 2026-08-14 表示只有昏迷可用(feared=false),但 wowhead flags「Usable while feared」与游戏内 tooltip 均指向 true —— 冲突不作锚定,留 Task 3 官方位 + Task 4 语料裁定。",
    source:
      "cooldowns.ts:130 + wowhead.com/spell=47585 Flags 栏(2026-08-14 抓取)+ 用户 2026-08-14 裁决(冲突,留裁)",
  },
  {
    spellId: "642",
    name: "圣盾术",
    stunned: false,
    feared: false,
    confused: false,
    rationale:
      "**2026-09-04 用户改裁:三维度全部 false。**命名位(SimC/TrinityCore:163 Allow While Stunned、378 by Stun Mechanic、177 Fleeing、178 Confused)一个都没有;它带的「No Client Fail While Stunned, Fleeing, Confused」(244)按 TrinityCore 命名只是抑制客户端报错文案,不授予任何可用性;1028 场语料晕中施放 1 次。08-14 的 true 锚点正是把位搜索逼向 10#13(遭遇战结束重置冷却)的原因。以下为 08-14 原记录:已裁:手写表収录机制上正确。用户 2026-08-14 澄清此前「圣盾晕中开不出」是误记(语音记录里「生存树」实指圣盾术,当时记录有误);用户核实后确认圣盾术机制上任何被控状态下都能按下,三维度改判 true。wowhead flags 栏的「No Client Fail While Stunned, Fleeing, Confused」与此吻合,应视为真正的被控可用位而非仅抑制报错文案(见文件头「重要先验」)。教练规范补充:5 分钟大招不该拿来当常规挡控手段,代价太大,仅在别无选择时使用——该规范判断归 Task 6 签字册,不影响本条的机制判定。",
    source:
      "手写表(cooldowns.ts:131,已裁机制収录正确)+ 用户 2026-08-14 澄清(此前「晕中开不出」为误记,真实意见是代价规范)+ wowhead.com/spell=642 Flags 栏(2026-08-14 抓取)",
  },
  {
    spellId: "55233",
    name: "吸血鬼之血",
    stunned: false,
    feared: false,
    confused: false,
    rationale:
      "用户 2026-08-14 裁决「都不行」—— 手写表(cooldowns.ts:132)収录系误収,三维度改判 false;与本次 wowhead flags 完整核对未见任何相关旗标的观察一致。待 Task 4 语料佐证后由 Task 5 处置手写表本身(移除该条)。",
    source:
      "用户 2026-08-14 裁决(都不行)+ cooldowns.ts:132(误収,待 Task 5 处置)+ wowhead.com/spell=55233 Flags 栏(2026-08-14 抓取,未见相关旗标)",
  },
  {
    spellId: "48792",
    name: "冰封之韧",
    stunned: false,
    feared: null,
    confused: null,
    rationale:
      "**2026-09-04 用户改裁:stunned=false**(命名位 163/378 全无;1028 场语料晕中施放 0 次)。以下为 08-14 原记录:用户 2026-08-14 裁决「昏迷的时候可以用,其他时候好像不行」—— stunned 按裁决改判 true;feared/confused 用户自己用「好像」表述,置信度不足,不作锚定(宁 null 勿猜)。",
    source: "用户 2026-08-14 裁决(昏迷可用,其余不确定)+ cooldowns.ts:133",
  },

  // ---- brief 指定锚点:角斗士的勋章(语料实证,三维度全中,用户未改判)----
  {
    spellId: "336126",
    name: "角斗士的勋章",
    stunned: true,
    feared: true,
    confused: true,
    rationale:
      "brief 指定锚点:勋章的设计用途就是在被控时按下来解控,2026-08-14 语料实证 5 次晕中施放;wowhead flags 栏三项旗标齐全「Can be used while stunned」「Usable while feared」「Usable while confused」,是本清单唯一三维度同时高置信度确认的条目,建议作为 Task 3 位搜索的主锚点。用户签字未改判。",
    source:
      "brief 2026-08-14 语料实证(5 次晕中施放)+ wowhead.com/spell=336126 Flags 栏(2026-08-14 抓取)",
  },

  // ---- brief 指定反例:圣光术 / 制裁之锤(用户未改判)----
  {
    spellId: "82326",
    name: "圣光术",
    stunned: false,
    feared: false,
    confused: false,
    rationale:
      "brief 指定反例:硬读条治疗技能,读条类技能在任一控制类型下都应被打断/无法开始吟唱,这是通用机制常识而非该技能专属位;wowhead flags 栏未见任何 usable/allow while 类旗标,与常识一致。用户签字未改判。",
    source:
      "brief 反例要求 + wowhead.com/spell=82326 Flags 栏(2026-08-14 抓取,未见相关旗标)",
  },
  {
    spellId: "853",
    name: "制裁之锤",
    stunned: false,
    feared: false,
    confused: false,
    rationale:
      "brief 指定反例:瞬发控制技能(晕别人用的,不是防御技能),未标记任何被控下可用旗标 —— 用于验证「瞬发」本身不是可用位的充分条件,必须专门授权。用户签字未改判。",
    source:
      "brief 反例要求 + wowhead.com/spell=853 Flags 栏(2026-08-14 抓取,未见相关旗标)",
  },

  // ---- 恐惧维度锚点:「不灭意志类」----
  {
    spellId: "104773",
    name: "不灭决心",
    stunned: true,
    feared: true,
    confused: null,
    rationale:
      "推测为 brief「不灭意志类」的实指(中文名「不灭决心」与「不灭意志」高度近似,术士版外置减伤,与 Pain Suppression/Barkskin/消散同属「外置减伤 CD 家族」);wowhead flags 栏明确「Can be used while stunned」+「Usable while feared」,confused 未见对应旗标。该解读经用户 2026-08-14 确认无误(对应 task-2-report.md「需要注意的四点」第 4 条),值不变。",
    source:
      "brief「不灭意志类」+ wowhead.com/spell=104773 Flags 栏(2026-08-14 抓取)+ 用户 2026-08-14 确认解读无误",
  },
  {
    spellId: "7744",
    name: "被遗忘者的意志",
    stunned: null,
    feared: true,
    confused: null,
    rationale:
      "**2026-09-04 注**:命名位 177 (Allow While Fleeing) 为否——解控类种族技能的可用性不走属性位;该锚点作为 genUsableWhileCc 的 ANCHOR_HAND_EXEMPTIONS 豁免,真值进 cooldowns.ts USABLE_WHILE_FEARED_GAP_IDS 手工层(curatedAbilityFacts 有签字记录)。「不灭意志类」第二条(种族技能,亡灵专属)。草案抓取 wowhead flags 只看到它授予的免疫光环效果(Fleeing/Asleep/Charmed/Turned 四种免疫),未见与勋章同款的「usable while feared」旗标,曾判 null;用户 2026-08-14 确认 feared=true(与技能设计意图/玩家共识一致:恐惧中可按下用来解控)。stunned/confused 证据仍不足,维持 null。",
    source:
      "玩家共识/技能设计意图 + wowhead.com/spell=7744 Flags 栏完整核对(2026-08-14 抓取,未见相关旗标)+ 用户 2026-08-14 裁决(feared=true)",
  },

  // ---- 与 642 同款「No Client Fail」旗标,用户证实同为可用位(cost-norm 分层,见 Task 6)----
  {
    spellId: "45438",
    name: "寒冰屏障",
    stunned: false,
    feared: false,
    confused: false,
    rationale:
      "**2026-09-04 用户改裁:三维度全部 false**(同 642:命名位全无,只有 244 报错抑制位;1028 场语料晕中施放 0 次)。以下为 08-14 原记录:用户 2026-08-14 裁决「都可以用」,从草案原判的反例翻转为正例(原判断依据的「晕中开不出」是一般 PvP 印象,被用户一手证词推翻)。寒冰屏障与圣盾术 flags 栏一模一样,都只有「No Client Fail While Stunned, Fleeing, Confused」;两条独立用户证词(642+45438)汇合到同一旗标上,说明它很可能就是真正的被控可用位,而不是仅抑制报错文案的无关位 —— 这是 Task 3 位搜索的重要先验(见文件头)。教练规范补充:代价太大,仅在别无选择时使用,不推荐作为常规挡控手段(用户 2026-08-14,归 Task 6 签字册)。",
    source:
      "用户 2026-08-14 裁决(都可以用;教练规范另记归 Task 6)+ wowhead.com/spell=45438 Flags 栏(与 642 同款「No Client Fail」旗标)",
  },

  // ---- 保护祝福(stunned 因用户「好像」表述降级为 null)----
  {
    spellId: "1022",
    name: "保护祝福",
    stunned: null,
    feared: false,
    confused: false,
    rationale:
      "用户 2026-08-14「好像物理昏迷的时候可以给自己」—— 用户自己用「好像」表述,置信度不足,stunned 由草案的 false 改判 null(不再当作反例);feared/confused 用户未提出异议,维持 false(wowhead flags 栏也未见任何相关旗标)。" +
      "**2026-08-15 语料矛盾在案(不改值)**:挂账清理 Task E 全库语料观测线(disorient 类,1028/1028 场)在 disorient 窗口内观测到 7 次保护祝福施放成功," +
      "其中 1 条(gapMs=0,cast 与 aura APPLIED 落在完全相同时间戳)是教科书级排队伪影已剔除、不计入证据,**6 条中窗清白样本**(毫秒差 1159-5219ms,分属多场/多玩家," +
      "100% Player 施放者,分布集中在窗口中段,不贴边)——用户 2026-08-15 复签「保护不能在恐惧里用」,**维持 feared=false**,语料矛盾记录在案不改判。" +
      "首选嫌疑:(a)丢失 SPELL_AURA_REMOVED 型幻影窗口(恐惧被伤害打断而移除事件缺失,同 stun 观测线已证实的 422→247 一类机制," +
      "见 `packages/eval/src/explore/uwcObserved.ts` 模块头);(b)Horror 亚类授权(同 33206 条的嫌疑,待查)。两个嫌疑均待查,不构成推翻用户对自身职业技能证词的依据。" +
      "详见 `$GLADLOG_EVAL_HOME/reports/uwc-feared-diff.md`。",
    source:
      "wowhead.com/spell=1022 Flags 栏(2026-08-14 抓取,未见任何 CC 相关旗标)+ 用户 2026-08-14 裁决(stunned 好像可用,置信度不足)+ " +
      "挂账清理 Task E 语料矛盾记录(2026-08-14 全量扫描,6 次中窗观测/1 次 gap=0 伪影已剔除,uwc-feared-diff.md)+ 用户 2026-08-15 复签维持 false",
  },
];
