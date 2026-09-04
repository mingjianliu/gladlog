/**
 * 减伤裁定册 —— 「对面交了这个,你还该不该继续打」。
 *
 * 为什么需要它:官方 `MITIGATION_TABLE` 的 `pct` 度量的是「平砍减伤有多少」,
 * 而教练要回答的是「这波击杀还打不打得动」。2026-08-17 的全表问卷证明这两件事
 * 不是一回事 —— 裁定人在**同一个百分比档内给出了相反的裁定**(30% 档三个「无条件」
 * 三个「看情况」;10% 档一个「无条件」一个「从不」),任何单一 pct 阈值最好也
 * 只能对上 30 条里的 23 条(77%)。分歧方向一致:被判「无条件」的那些都带着
 * 百分比之外的额外机制(免死 / 招架 / 附带自愈 / 分摊+抬血)。
 *
 * 所以裁定本身就是事实,只能由人给,不能从 pct 推导。本表照
 * `curatedAbilityFacts.ts` 的纪律:每条带 `source` 与 `approved: "YYYY-MM-DD user"`,
 * 格式不合 CI 直接红(见 `test/mitigationVerdicts.test.ts`)。
 *
 * 与 `MITIGATION_TABLE` 的分工:那张表回答「减伤多少」(官方 DB2,用于伤害算术),
 * 本表回答「该不该继续打」(人工签字,用于教练判断)。两张表的键集必须一致 ——
 * 一致性测试会在有人给 `MITIGATION_TABLE` 加条目却忘了裁定时变红。这是审计
 * (docs/coaching-grounding-audit.md)指出的「九张手工表只有一张有漏项检测」
 * 的直接补救。
 */
import { MITIGATION_TABLE } from "./mitigationData";

export type MitigationVerdict =
  /** 打进去就是白打 —— 与击杀是否成立无关,无条件产出「浪费」。 */
  | "unconditional"
  /** 只有在击杀不成立时才算该转火;击杀成立时顶着它打本来就是正确操作。 */
  | "kill-live-gated"
  /** 不构成真实阻碍,永不产出「浪费」判断(但仍留在减伤表里供伤害算术)。 */
  | "never"
  /** 语料里没出现过、裁定人未遇到过 —— 记成有据可查的空缺,不猜,不出面。 */
  | "unresolved";

export interface IMitigationVerdict {
  /** 官方中文名(取自 spellNamesZhGenerated),便于人核对。 */
  zh: string;
  /** 签字当时 MITIGATION_TABLE 里的官方数值,仅供对照 —— 判据不从它推导。 */
  officialPct: number;
  verdict: MitigationVerdict;
  /** 裁定人给出的、超出 pct 的额外理由(仅在有话说时存在)。 */
  note?: string;
  source: string;
  /** 必须是 `YYYY-MM-DD user`,由 CI 校验。 */
  approved: string;
}

/**
 * 「这波击杀还成立吗」的血线 —— 低于它算成立。
 *
 * **这是本仓库第一个接到「结果」而不是「发生率」上的阈值。** 依据是 2026-08-17
 * 在本机 300 回合 / 900 个敌方单位上实测的击杀转化率(触线后 10s 内死亡):
 *
 * ```
 *   ≤50%  6.3%    ≤35% 16.6%    ≤25% 33.5%    ≤20% 44.4%    ≤15% 52.1%
 * ```
 *
 * 另一口径(每个敌方单位取该回合最低血线,看最终死没死)显示同一方向且更陡:
 * 被打到 25–35% 的 104 个单位**无一死亡**。而当时 `deepDive.ts` 的
 * `OFFENSIVE_HP_THRESHOLD = 35` 对应的转化率只有 16.6%。
 *
 * 抑制不进这条判据:按抑制 0–20 / 20–40 / ≥40 三档分组后曲线基本重合
 * (≤20% 一行分别是 44.4 / 46.6 / 41.7),因为阈值条件在「已经被打到这个血线」
 * 这个观测值上,抑制的作用已经体现在里面了,再乘一次是重复计数。
 *
 * 「敌方治疗被控」同样不进判据:分组后杀窗内奶被控过的转化率反而更低
 * (≤25% 时 23.8% vs 46.3%),疑为选择偏差(硬打不动才去控奶)。它不是
 * 可用的正向预测因子。
 *
 * **限制(2026-08-17 记):上面这些数字全部测自 12.1 之前的语料。** 本机 1028 场
 * 库最早 2026-04-21、最新 2026-08-11,12.1 上线(PATCH_121_GOLIVE_EPOCH_MS,
 * 2026-08-11)之后 0 场。12.1 改动了治疗与减伤生态,击杀转化率曲线有可能随之
 * 移动 —— 等库里攒够 12.1 后的对局,应当重跑一次再确认这个 20。
 *
 * 改这个值需要重跑上面那个测量,不能只改常量 —— 判据即规范。
 */
export const KILL_LIVE_HP_PCT = 20;

/** 裁定人签字日期(全表同一次问卷)。 */
export const MITIGATION_VERDICTS_SIGNED_ON = "2026-08-17";

// 2026-08-21 S2 corpus scan (10,682 matches): removed Netherwalk 196555 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const MITIGATION_VERDICTS: Record<string, IMitigationVerdict> = {
  "31821": {
    zh: "光环大师",
    officialPct: 20,
    verdict: "never",
    source:
      "两条裁定同日(2026-08-22):减伤值「光掌是大技能,20% 全团」,进攻侧「一般可以继续打」。" +
      "**同日更正**:这条最初写的理由是「同为团队 20% 的真言术:障也判 never,按形态对齐」——" +
      "误读。62618 那条的 never 出自「裁定人裁定该技能已不存在」,是存在性判断,不是形态判断。" +
      "本册每条的 source 其实只是把该档定义复述一遍,没有逐技能的理由记录,因此**没有可供推导的" +
      "分档规则**(30% 一档里 unconditional 与 kill-live-gated 各半,50% 也是)。这条 never 的" +
      "唯一依据就是裁定人当天那句「一般可以继续打」。若原意是「一般可以但也有例外」,那就是 " +
      "kill-live-gated:never 永不产出「打进减伤」的浪费判断,kill-live-gated 只在当时本来也打不死时产出。",
    approved: "2026-08-22 user",
  },
  "1022": {
    zh: "保护祝福",
    officialPct: 100,
    verdict: "unconditional",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "642": {
    zh: "圣盾术",
    officialPct: 100,
    verdict: "unconditional",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "45438": {
    zh: "寒冰屏障",
    officialPct: 100,
    verdict: "unconditional",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "31224": {
    zh: "暗影斗篷",
    officialPct: 100,
    verdict: "unconditional",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "186265": {
    zh: "灵龟守护",
    officialPct: 100,
    verdict: "unconditional",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "204018": {
    zh: "破咒祝福",
    officialPct: 100,
    verdict: "unconditional",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "47585": {
    zh: "消散",
    officialPct: 75,
    verdict: "unconditional",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "357170": {
    zh: "时间膨胀",
    officialPct: 50,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火",
    approved: "2026-08-17 user",
  },
  "61336": {
    zh: "生存本能",
    officialPct: 50,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火",
    approved: "2026-08-17 user",
  },
  "86659": {
    zh: "远古列王守卫",
    officialPct: 50,
    verdict: "unconditional",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "108271": {
    zh: "星界转移",
    officialPct: 40,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火",
    approved: "2026-08-17 user",
  },
  "33206": {
    zh: "痛苦压制",
    officialPct: 40,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火",
    approved: "2026-08-17 user",
  },
  "871": {
    zh: "盾墙",
    officialPct: 40,
    verdict: "kill-live-gated",
    note: "2026-08-17 首轮问卷时记 unresolved(语料 0/400 —— 防护战在竞技场基本不出现,是取样问题不是技能问题;裁定人未遇到过,不猜)。2026-08-22 补裁:「低血量可以考虑继续打,不然收手」—— 逐字就是 kill-live-gated 的定义(击杀成立时顶着 40% 打是对的,不成立时才算该转火)。取样问题依旧:本机语料仍然量不到它,这条裁定靠的是裁定人的游戏判断,不是语料证据。",
    source:
      "2026-08-22 用户补裁(原文「盾墙低血量可以考虑继续打 不然收手」);首轮见 2026-08-17 减伤裁定问卷 artifact 63e64c88",
    approved: "2026-08-22 user",
  },
  "196718": {
    zh: "黑暗",
    officialPct: 40,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火",
    approved: "2026-08-17 user",
  },
  "264735": {
    zh: "优胜劣汰",
    officialPct: 25,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火。officialPct 30 → 25:2026-09-04 用户裁定「PvP 值为官方值」(−30 × PvpMultiplier 0.8333,BACKLOG #41),档位不变",
    approved: "2026-08-17 user",
  },
  "48792": {
    zh: "冰封之韧",
    officialPct: 30,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火",
    approved: "2026-08-17 user",
  },
  "118038": {
    zh: "剑在人在",
    officialPct: 30,
    verdict: "unconditional",
    note: "招架型,对近战近乎免疫,远高于记录的 30%",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "31850": {
    zh: "炽热防御者",
    officialPct: 45,
    verdict: "unconditional",
    note: "免死机制,远高于记录的 45%(2026-09-04 起按 PvP 值:−30 × 1.5;签字时记录为 30)",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "184364": {
    zh: "狂怒回复",
    officialPct: 30,
    verdict: "unconditional",
    note: "30% 外加大量自愈",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "363916": {
    zh: "黑曜鳞片",
    officialPct: 30,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火",
    approved: "2026-08-17 user",
  },
  "104773": {
    zh: "不灭决心",
    officialPct: 25,
    verdict: "unconditional",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "498": {
    zh: "圣佑术",
    officialPct: 35,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火。officialPct 20 → 35:2026-09-04 用户裁定「PvP 值为官方值」(DB2 aura87 −20 × PvpMultiplier 1.75,BACKLOG #41),档位不变",
    approved: "2026-08-17 user",
  },
  "115203": {
    zh: "壮胆酒",
    officialPct: 20,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火",
    approved: "2026-08-17 user",
  },
  "22812": {
    zh: "树皮术",
    officialPct: 20,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火",
    approved: "2026-08-17 user",
  },
  "62618": {
    zh: "真言术:障",
    officialPct: 40,
    verdict: "never",
    note: "原裁定(2026-08-17):**该技能在 12.1 已不存在**,故判 never;当时自陈「本机语料对此无发言权 —— 整个 1028 场库最新一场是 2026-08-11,12.1 上线后 0 场,库里那 2 次施放是 07-06/07-07 的版本前残留」,并附带主张『81782 在语料里 0 次,该 20% 从未被验证,清理 MITIGATION_TABLE 时应一并移除』。\n\n**2026-08-22:前提被证伪,退回待裁。** 证据是四天后(08-21)落地的 S2 归档 —— 12.1 开服首周 10,682 场 / 17,586 回合真实对局(`corpus/manifest-archive-2026-08-21.txt`),其观测集 5,303 个 id 里 **62618 与 81782 都在**。也就是说这技能在 12.1 活着,连它的减伤光环都观测得到,两条主张同时不成立。本机库仍然说不上话(按 PATCH_121_GOLIVE_EPOCH_MS 切开:12.1 前 376 场里施放 13 次、光环 69 次;12.1 后只有 24 场,施放 0 次 —— 样本太小,不能当证据用,原裁定说的「版本前残留」这一点本身是对的)。\n\n既然 never 建立在已被推翻的前提上,就不能继续挂着冒充实质裁定,退回 unresolved 等重裁(两档对消费方行为一致:offensiveWasteAnalysis 对 never 与 unresolved 都不出面,所以这次退回**不改变任何产品行为**)。重裁问题:对面奶交了真言术:障(团队 20%),该继续打还是转火?\n\n**2026-08-22 裁定人回应**:「障存在,我看错了,只不过正常人都不会点他。」—— 存在性主张正式撤回(原 2026-08-17 判词的前提作废),同时给出实战注记:这天赋很少有人点。语料佐证该注记:12.1 归档随机 600 场里 **20 场出现过(3.3%)**,本机库 12.1 后 24 场 0 次。**档位本人未裁**,所以保持 unresolved —— 现在这个 unresolved 的含义已经和 2026-08-17 那次不同:不再是「技能不存在」,而是「技能存在但罕见,该不该顶着打没裁过」。**2026-08-22 补裁定案**:「加,但不是大减伤」—— 20% 这个量级不构成真实阻碍,取 never(永不产出「打进减伤」的浪费判断);减伤值 20% 本身照常参与伤害算术,不动。至此这条的三段历史齐了:判 never(前提=技能不存在,错)→ 退回 unresolved(前提被证伪)→ 重新判 never(理由换成「不是大减伤」,前提正确)。",
    source:
      "2026-08-22 用户补裁(原文「加 但是不是大减伤」);2026-08-17 首轮判词的前提(技能不存在)已由用户本人 2026-08-22 撤回",
    approved: "2026-08-22 user",
  },
  "198589": {
    zh: "疾影术",
    officialPct: 25,
    verdict: "never",
    note: "2026-08-22 补登记。用户确认「的确是减伤,而且是大技能」;**数值不用人给** —— 官方 DB2 里减伤挂在它的 buff 212800 上(`aura87 pts=-25 misc=127`,25% 全学派),与真言术:障→81782、反魔法领域→145629、灵魂链接图腾→325174 同形态;198589 与 212800 在 S2 归档(12.1 首周 10,682 场)里都观测得到。\n\n**档位本人未裁,保持 unresolved。** 可参照的同形态先例是同日那条盾墙(40% 个人墙 →「低血量可以考虑继续打,不然收手」= kill-live-gated);25% 比它更弱,按同一逻辑应落在 kill-live-gated 或 never,不该比 40% 的盾墙更严(unconditional)。但这是我的推导不是签字,所以留空缺等一个词。\n\n**2026-08-23 补裁定案:「无」** —— 取 never(不构成真实阻碍,永不产出「打进减伤」的浪费判断);减伤值 25% 本身照常参与伤害算术。这与同一位裁定人的另两条一致:光掌(团队 20%)「一般可以继续打」→ never,而盾墙(个人 40%)「低血量可以考虑继续打,不然收手」→ kill-live-gated —— 25% 的个人墙落在两者之间偏轻的一侧。若「无」的本意是「不裁」而不是「不构成阻碍」,改回 unresolved 即可,一个词。",
    source:
      "官方 DB2 SpellEffect(212800 的 aura87 = -25/127)+ 用户 2026-08-22 确认它是减伤且是大技能;档位由用户 2026-08-23 补裁「无」→ never",
    approved: "2026-08-23 user",
  },
  "102342": {
    zh: "铁木树皮",
    officialPct: 20,
    verdict: "unconditional",
    note: "外置;裁定人判定其实际强度高于同档自用技能",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "51052": {
    zh: "反魔法领域",
    officialPct: 30,
    verdict: "kill-live-gated",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;只有击杀不成立时才算该转火。officialPct 15 → 30:2026-09-04 用户裁定「PvP 值为官方值」(DR 光环 145629 aura87 −15 × PvpMultiplier 2,BACKLOG #41),档位不变",
    approved: "2026-08-17 user",
  },
  "386208": {
    zh: "防御姿态",
    officialPct: 15,
    verdict: "never",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;不构成真实阻碍,永不产出「浪费」判断",
    approved: "2026-08-17 user",
  },
  "586": {
    zh: "渐隐术",
    officialPct: 10,
    verdict: "never",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;不构成真实阻碍,永不产出「浪费」判断",
    approved: "2026-08-17 user",
  },
  "98008": {
    zh: "灵魂链接图腾",
    officialPct: 10,
    verdict: "unconditional",
    note: "裁定人指出:机制是分摊伤害+抬血量,官方表记的 10% 不度量它的实际强度",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;打进去就是白打,与击杀是否成立无关",
    approved: "2026-08-17 user",
  },
  "107574": {
    zh: "天神下凡",
    officialPct: 3,
    verdict: "never",
    note: "进攻大招,3% 减伤是副作用",
    source:
      "2026-08-17 减伤裁定问卷(32 条全表),artifact 63e64c88;不构成真实阻碍,永不产出「浪费」判断",
    approved: "2026-08-17 user",
  },
  "473909": {
    zh: "知识古树",
    officialPct: 30,
    verdict: "unresolved",
    note: "2026-09-01 补登记(BACKLOG #24-9 / GH #44)。2026-08-13 补丁说明审读时用户裁定「等 S2 语料 + DB2 复核后再进 mitigationData,不要只照补丁说明的文字填数」—— 这次照做,结果数值和补丁说明不一样:补丁说明写 20%,官方 DB2@12.1.0.69404 里 473909 自己第 2 行就是 `aura87 pts=-30 misc=127`(30% 全学派),wowhead tooltip 同为 30%(12s,1.5min CD);S2 归档已观测(对局 7d74b373)。数值走生成层(attributedMitigationSpellIds 白名单 → genMitigation),不是手工 override。\n\n**档位本人未裁,保持 unresolved。** 同形态先例:盾墙 40% 个人墙 → kill-live-gated;疾影术 25% 个人墙 → never;真言术:障 团队 20% → never。30% 落在 25% 与 40% 之间,且附带完全免控 + 换形(不能被打断已开的形态,但 1.5s 施法可被打断)—— 是比疾影术更硬的墙,但这是我的推导不是签字,留空缺等一个词:unconditional / kill-live-gated / never。",
    source:
      "官方 DB2 SpellEffect@12.1.0.69404(473909 自身 aura87 = -30/127)+ wowhead tooltip 30% + S2 归档观测;登记本身依 2026-08-13 用户裁定(DB2 复核后进表);档位未裁",
    approved: "2026-08-13 user",
  },
};

/** 键集一致性:每个官方减伤条目都必须有裁定(测试里断言,这里只导出便于复用)。 */
export const MITIGATION_VERDICT_IDS: ReadonlySet<string> = new Set(
  Object.keys(MITIGATION_VERDICTS),
);

/** 未裁定 / 从不出面的条目不参与任何「浪费」判断。 */
export function mitigationVerdictOf(spellId: string): MitigationVerdict | null {
  return MITIGATION_VERDICTS[spellId]?.verdict ?? null;
}

/** 防止 MITIGATION_TABLE 被 tree-shake 掉导致一致性测试假绿。 */
export const MITIGATION_TABLE_KEY_COUNT = Object.keys(MITIGATION_TABLE).length;
