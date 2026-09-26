/**
 * 治疗裁定册 —— 「爆发已经打在脸上,按这个技能算不算一个答案」。
 *
 * 为什么需要它:系统里**没有「加血大技能」这个归类**。2026-08-23 的普查(用户提问
 * 「我们没有给加血大技能有归类吗」直接触发)把「挂 Defensive 牌子 + 官方数据说它治疗」
 * 的技能全列出来,一共 12 个,而它们的归类是三套东西交叉推出来的:
 *
 *   1. `SpellTag` 三个值 —— 加血只能挂 Defensive,和盾墙同一个牌子;
 *   2. 减伤体系三态 —— 在减伤表 / 登记为无减伤 / 什么都没有。「登记为无减伤」是目前
 *      最接近「这是加血不是挡伤」的表达,但它只是个否定句,不说它是什么;
 *   3. 手工名单 —— `bigDefensiveSpellIds` / `externalDefensiveSpellIds` /
 *      `TEAM_HEAL_CD_IDS` / `THROUGHPUT_EMPOWER_DEFENSIVE_IDS`。
 *
 * 后果是实测出来的:**意气风发 109304、恶魔变形 187827、吸血鬼之血 55233 三套归类
 * 一个都没落上** —— 官方数据明确说它们治疗,而系统对它们只知道「有个 Defensive 牌子」。
 * 它们和盾墙的区别、和绝望祷言的相同之处,今天都表达不出来。
 *
 * ## 这一册回答的是哪一维
 *
 * 「够不够得着队友」已经官方化了(`spellTargeting.ts` 的 `reachesAlly`),
 * 「是不是一堵墙」也有了(`abilityProfile.ts` 的 `isSurvivalWall`)。**缺的是治疗
 * 本身的分档**:一个 25% 的瞬发自愈和一个只在有人治你时才生效的受治疗增益,在
 * 「爆发窗口」这个语境里价值完全不同,而现在两者都只是「Defensive」。
 *
 * 和减伤裁定册(`mitigationVerdicts.ts`)完全同构:官方数据给**量**(治多少、
 * 增益多少 %),人给**判断**(这算不算一个答案)。2026-08-17 那次减伤问卷已经证明
 * 这两件事不能互相推导 —— 同一个百分比档内出现过相反的裁定。
 *
 * ## 签字纪律(照 `curatedAbilityFacts.ts`)
 *
 * `HEALING_VERDICTS` 只装**签过字**的条目,每条带 `source` 与
 * `approved: "YYYY-MM-DD user"`,格式不合 CI 直接红。研究做完但没批的放
 * `PROPOSED_HEALING_VERDICTS`(类型故意去掉 `approved`,不许伪造日期占位);
 * 获批后连同补上的签字戳迁入正册,并**从暂存区删除** —— 晋升即移除。
 *
 * ## 现状:12 条已于 2026-08-23 全部签字,但**仍未接线**
 *
 * 建册当天全表提交裁定并全部签字(10 burst-answer / 2 needs-healer / 0 unresolved),
 * `PROPOSED_HEALING_VERDICTS` 随之清空。**但本册目前仍无任何消费方** —— 接线会改变
 * 教练实际说出来的话,按 CLAUDE.md「修复要给前后数字」的纪律,每处判据都要单独量了
 * 再改,不能因为册子签完了就顺手全换。
 *
 * 接线计划里的三处**已经量过了,结论是暂不接线**(2026-08-23,S2 归档 120 文件、
 * 治疗 396 轮 + DPS 405 轮各跑一遍):
 *
 * | 判据 | 条数 | 引用到 `needs-healer` 的 |
 * |---|---|---|
 * | `cd-waste` | 111 / 118 | **0** / **0** |
 * | `death-unused-defensive` | 26 / 30 | **0** / **0** |
 * | 低压力免责注 | 206 / 31 轮 | **0** / **0** |
 * | `[DEATH] Unused` prompt 行 | 68 / 69 | **0** / **0** |
 *
 * 两条 `needs-healer`(吸血鬼之血、恶魔变形)在 801 个回合里**一次都没被这三处引用过**
 * —— 它们是坦克专精的技能,竞技场语料里血 DK / 复仇 DH 本来就少。换句话说,现在接线
 * 是一次**零变化的改动**,按「修复要给前后数字」的纪律那不叫修复。等语料里真出现
 * 相关专精、或者有判据要问「没人治你的时候这个技能还算不算答案」时再接。
 *
 * (`cd-waste` 引用的技能里 38/49 条落在本册,全部是 `burst-answer`;剩下的是官方
 * 口径的墙,以及神圣显灵 6 次 —— 「签字产出强化算不算防御」那条还没裁,见 GH #30。)
 *
 * ## 完备域的已知盲区:治疗行挂在别的 id 上
 *
 * `healingVerdictDomain()` 在 **cast id** 上问 `abilityProfile`。有些能力的治疗效果
 * 官方只挂在它的**光环 id** 上,于是它们进不了本册的完备域 —— 已知的一例是复苏烈焰
 * 374348:cast id 官方只有一条 `aura4 pts=100` 的 dummy,而光环 374349 在归档 400 个
 * 文件里有 3,145 条 `SPELL_PERIODIC_HEAL`。
 *
 * 它**故意没有**被拉进本册:用户 2026-08-23 裁定它是**被动技能**
 * (`PROC_ONLY_ACTIVATION_IDS`),而本册四档的问句是「**按**这个技能算不算一个答案」,
 * 对一个没有按键的能力没有意义。它的描述由另外三处承担:`bigDefensiveSpellIds`
 * (大技能)+ `NO_MITIGATION_IDS`(无百分比减伤)+ `PROC_ONLY_ACTIVATION_IDS`(无按键)。
 *
 * 真要扩域(把 `AURA_ONLY_ACTIVATION_IDS` 的光环 id 也查一遍),先想清楚被动能力在
 * 四档里怎么摆 —— 别为了让完备性测试好看而给一个按不了的技能编一个档位。
 *
 * 两条使用限制,写在这里免得消费方想当然:
 *   · **作茧缚命 116849 的档带条件** —— 裁定人明确的是抑制 <50% 的情形;
 *   · **档内不表达强弱** —— 意气风发被裁定人形容为「不是特别厉害,可以挡一些低爆发」,
 *     和圣盾术同为 burst-answer。要区分「挡得住多大的爆发」需要新的一维,
 *     不是把它降档。
 */
import { classMetadata } from "./classSpells";
import { SPELL_NAMES_ZH_GENERATED } from "./spellNamesZh";
import { SpellTag } from "./spellTypes";
import { abilityProfile } from "./abilityProfile";

export type HealingVerdict =
  /** 爆发打在脸上时按下去能改变这一波的结果(免疫/大额瞬发/免死/吸收顶住)。 */
  | "burst-answer"
  /** 只对持续掉血有用;爆发窗口里按了也白按,该按的是别的东西。 */
  | "sustain-only"
  /** 它本身不产生生存,只是**放大别人的治疗** —— 没人治你的时候按它等于没按。 */
  | "needs-healer"
  /** 未裁定 —— 记成有据可查的空缺,不猜,不出面。 */
  | "unresolved";

/** 官方数据快照,仅供人核对;裁定**不从它推导**(见文件头)。 */
export interface IHealingOfficialFacts {
  /** 治疗施法者自己(Effect 10/136 或 aura 8/20)。 */
  healsSelf: boolean;
  /** 治疗别人。 */
  healsOthers: boolean;
  /** 提高**受到**的治疗量 %(aura118/259)。 */
  healingReceivedPct?: number;
  /** `isSurvivalWall` 说它是不是墙(减伤/吸收/免疫三者有其一)。 */
  isWall: boolean;
}

export interface IHealingVerdict {
  /** 官方中文名(取自 spellNamesZhGenerated),便于人核对。 */
  zh: string;
  official: IHealingOfficialFacts;
  verdict: HealingVerdict;
  /** 裁定人给出的、官方数据之外的理由(仅在有话说时存在)。 */
  note?: string;
  source: string;
  /** 必须是 `YYYY-MM-DD user`,由 CI 校验。 */
  approved: string;
}

/**
 * 已签字的裁定。
 *
 * **当前为空** —— 2026-08-23 建册当天,12 条全部在下方暂存区等签字。空表在扫描里
 * 和「100% 健康」长得一样,所以 `curatedIdRegistry` 登记的是两张表的并集(见那边
 * 的注册项),完备性由 `test/healingVerdicts.test.ts` 的键集断言兜住:任何一个
 * 「Defensive 牌子 + 官方说它治疗」的技能,必须出现在正册或暂存区之一。
 */
const SRC =
  "2026-08-23 建册普查:取 classMetadata 里 Defensive-tagged 且 abilityProfile 官方数据说它治疗的全部技能(12 条)";

export const HEALING_VERDICTS: Record<string, IHealingVerdict> = {
  // ── 官方口径已是墙 ──────────────────────────────────────────────────────
  "642": {
    zh: "圣盾术",
    official: { healsSelf: true, healsOthers: false, isWall: true },
    verdict: "burst-answer",
    source: SRC + ";全学派免疫 127、官方 100% 减伤,裁定人「其他的我同意」",
    approved: "2026-08-23 user",
  },
  "45438": {
    zh: "寒冰屏障",
    official: { healsSelf: true, healsOthers: false, isWall: true },
    verdict: "burst-answer",
    source: SRC + ";全学派免疫 127、官方 100% 减伤,裁定人「其他的我同意」",
    approved: "2026-08-23 user",
  },
  "47585": {
    zh: "消散",
    official: { healsSelf: true, healsOthers: false, isWall: true },
    verdict: "burst-answer",
    note: "裁定人原话:「消散是大技能,基本等于无敌」—— 比官方那个 75% 更强的判断,所以这一档不是从 pct 推出来的。",
    source: SRC + ";裁定人逐条口述",
    approved: "2026-08-23 user",
  },
  "108416": {
    zh: "黑暗契约",
    official: { healsSelf: true, healsOthers: false, isWall: true },
    verdict: "burst-answer",
    source: SRC + ";吸收盾 + 自愈,裁定人「其他的我同意」",
    approved: "2026-08-23 user",
  },
  "116849": {
    zh: "作茧缚命",
    official: {
      healsSelf: false,
      healsOthers: false,
      healingReceivedPct: 50,
      isWall: true,
    },
    verdict: "burst-answer",
    note: "裁定人原话:「作茧缚命也是,在低于 50% 抑制的情况也约等于无敌」。**这一档带条件**:裁定人明确的是抑制 <50% 的情形,高抑制下没裁过。真要在高抑制局面上消费这一档,得回头再问 —— 别把它当无条件结论用(先例:黑暗 196718 的 positional 条件)。",
    source: SRC + ";裁定人逐条口述",
    approved: "2026-08-23 user",
  },
  "740": {
    zh: "宁静",
    official: { healsSelf: false, healsOthers: true, isWall: true },
    verdict: "burst-answer",
    note: "团队引导治疗,要站桩读条 —— 提议时把「读不完」列为可推翻条件,裁定人未采纳,判 burst-answer。",
    source: SRC + ";裁定人「其他的我同意」",
    approved: "2026-08-23 user",
  },
  "64843": {
    zh: "神圣赞美诗",
    official: {
      healsSelf: false,
      healsOthers: true,
      healingReceivedPct: 4,
      isWall: false,
    },
    verdict: "burst-answer",
    note: "与宁静同形态(团队引导),两条同档。",
    source: SRC + ";裁定人「其他的我同意」",
    approved: "2026-08-23 user",
  },

  // ── 官方口径不是墙:治疗就是全部机制 ──────────────────────────────────
  "19236": {
    zh: "绝望祷言",
    official: { healsSelf: true, healsOthers: false, isWall: false },
    verdict: "burst-answer",
    note: "裁定人原话:「绝望祷言可以是 burst answer」。与同日另一条裁定「算防御,但仅限于自己挨打」是**两维**:那条管「算不算防御」(救不了队友,GH #28 的门),这条管「扛不扛得住爆发」。两条并存不矛盾。",
    source: SRC + ";裁定人逐条口述",
    approved: "2026-08-23 user",
  },
  "109304": {
    zh: "意气风发",
    official: { healsSelf: true, healsOthers: false, isWall: false },
    verdict: "burst-answer",
    note: "裁定人原话:「算是 burst-answer,不是特别厉害但是可以挡一些低爆发」。**档内强度偏低** —— 四档表达不了强弱,消费方若要区分「挡得住多大的爆发」,需要的是新的一维,不是把这条降档。",
    source: SRC + ";裁定人逐条口述",
    approved: "2026-08-23 user",
  },
  "187827": {
    zh: "恶魔变形",
    official: { healsSelf: true, healsOthers: false, isWall: false },
    verdict: "needs-healer",
    note: "裁定人 2026-08-23 改判:先按提议留 unresolved,同日追加一句「恶魔变形还是 need healer」。**注意官方数据在这条上不全** —— 只挖到「治疗自己」,它实际还给最大生命/护甲/闪避;这一档因此完全出自裁定人的游戏知识,不能从官方字段复算。补齐官方数据后值得回头复核一次。",
    source: SRC + ";裁定人逐条口述(同日由 unresolved 改判)",
    approved: "2026-08-23 user",
  },

  // ── 受治疗增益 ──────────────────────────────────────────────────────────
  "47788": {
    zh: "守护之魂",
    official: {
      healsSelf: false,
      healsOthers: false,
      healingReceivedPct: 60,
      isWall: false,
    },
    verdict: "burst-answer",
    note: "官方只给了受治疗 +60%,**免死那一半没有任何官方行** —— 而那一半才是它成为爆发答案的理由。这一档因此**不能**从官方数据复算出来,是纯人工裁定。",
    source: SRC + ";裁定人「其他的我同意」",
    approved: "2026-08-23 user",
  },
  "55233": {
    zh: "吸血鬼之血",
    official: {
      healsSelf: false,
      healsOthers: false,
      healingReceivedPct: 30,
      isWall: false,
    },
    verdict: "needs-healer",
    note: "裁定人原话:「感觉不是太厉害,还是 needs healer 吧」。本册唯一一条 needs-healer:没人治你的时候按它等于没按。",
    source: SRC + ";裁定人逐条口述",
    approved: "2026-08-23 user",
  },
};

/** 待签暂存区。获批后迁入 `HEALING_VERDICTS` 并从这里删除(晋升即移除)。 */
export interface IProposedHealingVerdict extends Omit<
  IHealingVerdict,
  "approved" | "verdict"
> {
  /** 提议的档位 —— **提议,不是裁定**,消费方一律不许读暂存区。 */
  proposed: HealingVerdict;
  /** 什么情况下这个提议会被推翻(写给裁定人看的,不是自我保护)。 */
  wouldFlipIf: string;
}

/**
 * 2026-08-23 建册当天 12 条全部提交裁定,同日全部签字迁入正册,按「晋升即移除」
 * 纪律不在此留副本。2026-09-26 可靠性第二轮 W1g 把圣疗术 471195 加进冷却账本
 * (Defensive + 官方说它治疗 → 进本册完备域),待签。
 */
export const PROPOSED_HEALING_VERDICTS: Record<
  string,
  IProposedHealingVerdict
> = {
  "471195": {
    zh: "圣疗术",
    official: { healsSelf: true, healsOthers: true, isWall: false },
    proposed: "burst-answer",
    note: "瞬发把目标治满(可对自己也可对队友),10 分钟冷却、上自律 —— 形态与守护之魂同类:爆发打在脸上时按下去就能改变这一波。",
    wouldFlipIf:
      "裁定人认为「治满但不带任何减伤」只顶得住当下这一口,接下来的爆发照样打穿 → 改判 sustain-only;或认为它是一局一次的保底、不该拿来要求在某个爆发里交 → unresolved。",
    source:
      "2026-09-26 可靠性第二轮 W1g:ledgerGapScan(605 场)发现 471195 被按 244 回合却不在账本里,加入 classMetadata 后进入完备域",
  },
};

/** 这一册的完备域:挂 Defensive 牌子 **且** 官方数据说它治疗的技能。 */
export function healingVerdictDomain(): string[] {
  const ids = new Set<string>();
  for (const cls of classMetadata) {
    for (const a of cls.abilities) {
      if (!a.tags.includes(SpellTag.Defensive)) continue;
      const p = abilityProfile(a.spellId);
      if (!p.healsSelf && !p.healsOthers && p.healingReceivedPct === undefined)
        continue;
      ids.add(a.spellId);
    }
  }
  return [...ids];
}

/** 已签字的裁定;未签或不在册一律返回 `undefined` —— 调用方不许把「查不到」
 *  当成任何一档(这正是本册要消灭的那种「不知道就当没有」)。 */
export function healingVerdictOf(spellId: string): HealingVerdict | undefined {
  return HEALING_VERDICTS[spellId]?.verdict;
}

/** 人核对用:官方中文名。 */
export function healingVerdictZh(spellId: string): string | undefined {
  return (
    HEALING_VERDICTS[spellId]?.zh ??
    PROPOSED_HEALING_VERDICTS[spellId]?.zh ??
    SPELL_NAMES_ZH_GENERATED[spellId]
  );
}
