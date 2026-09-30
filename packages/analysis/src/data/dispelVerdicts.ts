/**
 * 防御驱散裁定册 —— 「这个 debuff 落在这种角色身上,值不值得花 GCD 驱」。
 *
 * GH #20 第 2 层。裁定矩阵(claude.ai/code/artifact/002e4626)由用户于
 * 2026-08-19 逐格签字,相对预填改动 27 格 —— 本表是签字结果的逐字转录,
 * 不是我的猜测。照 `mitigationVerdicts.ts` 的纪律:每行 `source` +
 * `approved`,键集与形状由 `test/dispelVerdicts.test.ts` 钉住。
 *
 * 结构裁定(签字页上方的三条,先于逐格值):
 * - **硬控行的 healer 格是 `self-impossible`**:被硬控的治疗不能施法,
 *   不可能自驱,而魔法驱散的第二驱散者只存在于双治疗阵容 —— 两轮用户
 *   指正(「治疗没法给自己驱散啊」)后定稿为结构性豁免位,永不产生指控。
 *   代码侧的运行时对应物是 dispelAnalysis 的唯一驱散者整窗豁免;本表的
 *   `self-impossible` 是它的静态声明。
 * - **定身/诅咒行的 healer 格保留**:定身与诅咒不禁施法,自驱真实可行。
 *   语料双时代实证:被冰霜新星定住的人 53–56% 的光环段内有成功施法,
 *   被制裁之锤晕住的只有 13–14%(底噪 = 晕中可用技能)。
 * - **`afterDR: null` = 无 DR 档位概念**:定身按 #24 裁定不算档位,
 *   诅咒/伤害类不是 CC。
 *
 * 与现行 `getPriority`(Critical/High 手工优先级)的关系:本表按角色与
 * 递减细分,是它的替代品;接线完成前两者并存,接线时以本表为准。
 */

/** 签字页的四档,原文:必驱 / 值得驱 / 看情况 / 不驱。 */
export type DispelWorth = "must" | "worth" | "situational" | "skip";

/** 硬控行的治疗格:自驱在物理上不可能,结构性豁免。 */
export type HealerCell = DispelWorth | "self-impossible";

export interface IDispelVerdict {
  /** 官方中文名,便于人核对。 */
  zh: string;
  healer: HealerCell;
  melee: DispelWorth;
  ranged: DispelWorth;
  /** 该控制已吃递减时的档位;null = 无 DR 档位概念。 */
  afterDR: DispelWorth | null;
  /** 签字裁定:整行退出 missed-cleanse 候选(伤害类随「DoT 暂不收」)。 */
  exitCandidate?: boolean;
  /**
   * 施法者带此 PvP 天赋时该 debuff **不可驱散**(用户情报 2026-08-19:
   * 「出了 pvp 天赋钢冰没法驱散,禁锢也是」)。官方数据把天赋版本编码为
   * 独立 id 且 dispelType=None(冰冻陷阱 203337、禁锢 221527)——
   * 若语料证实落在受害者身上的光环就是天赋 id,则官方路径已天然豁免,
   * 本字段仅存证;若光环仍用基础 id,消费方必须按施法者 pvpTalents 判
   * (与 Stellar Protection 的施法者专精门同形)。
   */
  undispellableWithCasterTalent?: string;
  note?: string;
  source: string;
  /** 必须是 `YYYY-MM-DD user`,由 CI 校验。 */
  approved: string;
}

export const DISPEL_VERDICTS_SIGNED_ON = "2026-08-19";

const SRC = "裁定矩阵签字 2026-08-19(artifact 002e4626);语料 n=300/1178 回合";
const OK = "2026-08-19 user";
/** 2026-09-30 补签(triage missed-cleanse F-C6,用户裁决 A41 = A,A41-签整份批准
 * 16 格):正向扫描找到的变形术 / 妖术变体照 118 / 51514,虚空触须按定身行,
 * 死亡印记按伤害类退出。草稿与证据在 eval-private
 * runs/triage-2026-09-29/issues/missed-cleanse-purge.md「A41 signed verdict cells」。 */
const SRC_A41 = "裁定矩阵补签 2026-09-30(A41 草稿)";
const OK_A41 = "2026-09-30 user";

export const DISPEL_VERDICTS: Record<string, IDispelVerdict> = {
  // ── 晕(Stun 递减)──────────────────────────────────────────────────────
  "853": {
    zh: "制裁之锤",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "situational",
    source: SRC,
    approved: OK,
  },
  "117526": {
    zh: "束缚射击",
    healer: "self-impossible",
    melee: "situational",
    ranged: "situational",
    afterDR: "skip",
    source: SRC,
    approved: OK,
  },
  "1234195": {
    zh: "虚空新星",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    note: "2026-08-19 由 root 重分类为 cc(双时代行为判定)",
    source: SRC,
    approved: OK,
  },
  "179057": {
    zh: "混乱新星",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    source: SRC,
    approved: OK,
  },
  "30283": {
    zh: "暗影之怒",
    healer: "self-impossible",
    melee: "situational",
    ranged: "situational",
    afterDR: "skip",
    source: SRC,
    approved: OK,
  },
  // ── 眩晕 / 变形(Incapacitate 递减)──────────────────────────────────────
  "3355": {
    zh: "冰冻陷阱",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    undispellableWithCasterTalent: "203340",
    note: "钻石寒冰(203340)版不可驱;官方以独立 id 203337(dispelType=None)编码,语料 249 次上身 0 次被驱、零混淆 —— 无需天赋门",
    source: SRC,
    approved: OK,
  },
  "118": {
    zh: "变形术",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "skip",
    source: SRC,
    approved: OK,
  },
  "28271": {
    zh: "变形术(龟)",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "skip",
    source: SRC,
    approved: OK,
  },
  "28272": {
    zh: "变形术(猪)",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "skip",
    source: SRC,
    approved: OK,
  },
  "6789": {
    zh: "死亡缠绕",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    source: SRC,
    approved: OK,
  },
  "51514": {
    zh: "妖术",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    note: "诅咒类,队伍能驱率 62%",
    source: SRC,
    approved: OK,
  },
  "217832": {
    zh: "禁锢",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    undispellableWithCasterTalent: "205596",
    note: "拘禁(205596)版不可驱;官方以独立 id 221527(dispelType=None)编码,语料 101 次上身 0 次被驱、零混淆 —— 无需天赋门",
    source: SRC,
    approved: OK,
  },
  "82691": {
    zh: "冰霜之环",
    healer: "self-impossible",
    melee: "situational",
    ranged: "skip",
    afterDR: "skip",
    source: SRC,
    approved: OK,
  },
  // ── 恐惧 / 迷惑(Disorient 递减)────────────────────────────────────────
  "8122": {
    zh: "心灵尖啸",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "situational",
    source: SRC,
    approved: OK,
  },
  "118699": {
    zh: "恐惧",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "situational",
    source: SRC,
    approved: OK,
  },
  "5484": {
    zh: "恐惧嚎叫",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "situational",
    source: SRC,
    approved: OK,
  },
  "360806": {
    zh: "睡眠行走",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "situational",
    source: SRC,
    approved: OK,
  },
  "105421": {
    zh: "盲目之光",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "situational",
    source: SRC,
    approved: OK,
  },
  "31661": {
    zh: "龙息术",
    healer: "self-impossible",
    melee: "situational",
    ranged: "situational",
    afterDR: "skip",
    source: SRC,
    approved: OK,
  },
  "605": {
    zh: "精神控制",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "worth",
    note: "唯一递减后仍值得驱的行 —— 半 DR 4 秒的队友打自己人照样致命",
    source: SRC,
    approved: OK,
  },
  // ── 2026-09-30 补签(A41-签):变形术 / 妖术变体(照 118 / 51514)──────────────
  "161354": {
    zh: "变形术(小猴)",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "391622": {
    zh: "变形术(鸭子)",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "61305": {
    zh: "变形术(黑猫)",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "161353": {
    zh: "变形术(北极熊宝宝)",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "460392": {
    zh: "变形术(苔绒羱)",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "61721": {
    zh: "变形术(兔子)",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "277792": {
    zh: "变形术(大黄蜂)",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "277787": {
    zh: "变形术(恐角龙)",
    healer: "self-impossible",
    melee: "must",
    ranged: "must",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "210873": {
    zh: "妖术(掠食龙)",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "211015": {
    zh: "妖术(蟑螂)",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "269352": {
    zh: "妖术(骸骨幼体)",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "277784": {
    zh: "妖术(混血柳魔)",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "277778": {
    zh: "妖术(赞达拉碎肉者)",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  "309328": {
    zh: "妖术(活体蜂蜜)",
    healer: "self-impossible",
    melee: "worth",
    ranged: "worth",
    afterDR: "skip",
    source: SRC_A41,
    approved: OK_A41,
  },
  // ── 定身(root,无 DR 档位,#24 裁定;不禁施法 → healer 格 = 自驱)──────
  "122": {
    zh: "冰霜新星",
    healer: "situational",
    melee: "worth",
    ranged: "skip",
    afterDR: null,
    source: SRC,
    approved: OK,
  },
  // 2026-08-30 追加(GH #24 尾巴):Landslide 是唯一官方可驱散(Magic)却没登记优先级的
  // 定身 —— 没登记 = 永远 Low = 漏驱永远看不见(登记制规则)。用户裁定「和冰霜新星同档」,
  // 三格照抄 122;不是 2026-08-19 签字页的一部分,source/approved 单列以免混淆。
  "355689": {
    zh: "山崩图腾(Landslide)",
    healer: "situational",
    melee: "worth",
    ranged: "skip",
    afterDR: null,
    source: "用户裁定 2026-08-30(GH #24):与冰霜新星同档;语料 ×59",
    approved: "2026-08-30 user",
  },
  "102359": {
    zh: "群体缠绕",
    healer: "situational",
    melee: "worth",
    ranged: "skip",
    afterDR: null,
    source: SRC,
    approved: OK,
  },
  "339": {
    zh: "纠缠根须",
    healer: "situational",
    melee: "worth",
    ranged: "skip",
    afterDR: null,
    source: SRC,
    approved: OK,
  },
  // 2026-09-30 补签(A41-签):虚空触须按定身行(照 122 / 355689 / 102359 / 339)
  "114404": {
    zh: "虚空触须",
    healer: "situational",
    melee: "worth",
    ranged: "skip",
    afterDR: null,
    source: SRC_A41,
    approved: OK_A41,
  },
  // ── 诅咒(非控制,不禁施法)────────────────────────────────────────────
  "1714": {
    zh: "语言诅咒",
    healer: "worth",
    melee: "skip",
    ranged: "situational",
    afterDR: null,
    note: "远程桶混着猎人(物理)—— 法系值得、猎人无所谓",
    source: SRC,
    approved: OK,
  },
  "702": {
    zh: "虚弱诅咒",
    healer: "skip",
    melee: "worth",
    ranged: "situational",
    afterDR: null,
    source: SRC,
    approved: OK,
  },
  // ── 签字退出候选(伤害类,随「DoT 暂不收」裁定)─────────────────────────
  "12654": {
    zh: "点燃",
    healer: "skip",
    melee: "skip",
    ranged: "skip",
    afterDR: null,
    exitCandidate: true,
    source: SRC,
    approved: OK,
  },
  "392983": {
    zh: "风领主之击",
    healer: "skip",
    melee: "skip",
    ranged: "skip",
    afterDR: null,
    exitCandidate: true,
    source: SRC,
    approved: OK,
  },
  // 2026-09-30 补签(A41-签):死亡印记本身伤害约 5.6k,驱掉它也驱不掉毒 —— 伤害类退出
  "360194": {
    zh: "死亡印记",
    healer: "skip",
    melee: "skip",
    ranged: "skip",
    afterDR: null,
    exitCandidate: true,
    source: SRC_A41,
    approved: OK_A41,
  },
};

export const DISPEL_VERDICT_IDS: ReadonlySet<string> = new Set(
  Object.keys(DISPEL_VERDICTS),
);

export function dispelVerdictOf(spellId: string): IDispelVerdict | null {
  return DISPEL_VERDICTS[spellId] ?? null;
}
