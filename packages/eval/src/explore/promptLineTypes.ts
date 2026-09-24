/**
 * Prompt 行类型的单源定义 —— 消融探针(`scripts/promptAblationProbe.ts`)与行类型
 * 普查共用同一套分类,免得「测的是哪一类」在两处各写一遍。
 *
 * 为什么需要它:2026-08-23 的探针发现,模型对某一行的依赖**无法从行的体量推断**
 * —— `[DMG SPIKE]` 只占 2.0% 的字符,却能把「这次防御交得完美」翻转成「纯粹的
 * 恐慌交、浪费了」;而模型自述 3 条结论里只有 1 条用到它。所以「哪些行有用」只能
 * 逐类实测,而实测的前提是分类本身稳定可复现。
 */

/**
 * 把一行 prompt 归到一个类型。带方括号标签的按标签分;其余按形状分到几个兜底类。
 *
 * 注意 `KILL ATTEMPTS` 一类**没有方括号**(输出是 `KILL ATTEMPTS — team kill
 * attempts…`),2026-08-23 我们正是因为按方括号 grep 而误判它「0% 的回合出现」,
 * 实际是 100%。段落标题那一类就是为它存在的。
 */
export function classifyPromptLine(line: string): string {
  const tag = line.match(/\[([A-Z][A-Z /]+)\]/);
  if (tag) return `[${tag[1]}]`;
  const t = line.trim();
  if (!t) return "(blank)";
  if (/^<\/?[a-z_]+/.test(t)) return "(xml)";
  if (/^[A-Z][A-Z ]+ —/.test(t) || /^[A-Z][A-Z ]+:/.test(t))
    return "(section-header)";
  if (/^\d+:\d\d/.test(t)) return "(timestamped-untagged)";
  return "(prose)";
}

/**
 * GH #99 item 5 的探针键:`[RES]` 行里**冷却台账没有变化**的那些
 * (`rdy:Δ` 后面没有任何技能名、`cd:—`)。
 *
 * 为什么要单独成键:这类行占全部 `[RES]` 行的 32.9%(2026-09-16 实测,309 份
 * prompt;本机 82 份复现 954/3033 = 31.5%),但**「没变化」只对 rdy/cd 成立** ——
 * 96.4% 仍带 `focus:`、36.6% 带实时 `cc:`。整类删 `[RES]` 测的是另一个问题;
 * 要回答「这些行值不值得占 1.9% 的 prompt 字符」,只能单独消融这一子集。
 */
import { isNoChangeResLine } from "@gladlog/analysis";

const RES_NO_CHANGE_KEY = "[RES:no-change]";
/**
 * GH #91 消融键:只删 `[ENEMY DEF]` 外置行上的 `| during it: …` 尾段(行本身保留)、
 * 图例里解释它的四行、候选事实块里的 `duringExternal=…`。删整行会把外置减伤这个
 * 事实一起删掉,测出来的就不是「这段标注有没有用」。
 */
const DURING_EXTERNAL_KEY = "[ENEMY DEF:during-it]";
const DURING_LEGEND = [
  "`| during it:",
  "friendly who had hit that unit in the 3 s before the external",
  "their damage on enemy players, seconds with damage",
  "how much of it was in the wall's school",
  "whether they could act.",
];
function ablateDuringExternal(promptText: string): string {
  return promptText
    .split("\n")
    .filter(
      (l) =>
        !(l.startsWith("    ") && DURING_LEGEND.some((k) => l.includes(k))),
    )
    .map((l) =>
      l.includes("[ENEMY DEF]")
        ? l.replace(/ \| during it: .*$/, "")
        : l.replace(/, duringExternal=[^,}]*/, ""),
    )
    .join("\n");
}
// Shared with the renderer's pruning predicate (resLedgerPrune.ts): one
// definition of "no-change row" on both sides.
export { isNoChangeResLine } from "@gladlog/analysis";

/**
 * 消融时把某一类整体从 prompt 里删掉。
 *
 * `(section-header)` / `(xml)` / `(prose)` 这三类**不提供**消融:删掉它们会破坏
 * prompt 的结构或指令本身,测出来的差异无法归因到「这类事实有没有用」。
 */
export const ABLATABLE = (key: string): boolean =>
  key.startsWith("[") || key === "(timestamped-untagged)";

export function ablateLineType(promptText: string, key: string): string {
  if (key === DURING_EXTERNAL_KEY) return ablateDuringExternal(promptText);
  const drop =
    key === RES_NO_CHANGE_KEY
      ? isNoChangeResLine
      : (l: string) => classifyPromptLine(l) === key;
  return promptText
    .split("\n")
    .filter((l) => !drop(l))
    .join("\n");
}

/** 从一段模型输出里抽出它引用到的所有时刻(`M:SS`),用于比较消融前后引用集合。 */
export function citedMoments(answer: string): Set<string> {
  const out = new Set<string>();
  for (const m of answer.matchAll(/\b(\d{1,2}):([0-5]\d)\b/g))
    out.add(`${Number(m[1])}:${m[2]}`);
  return out;
}

/** Jaccard 相似度;两边都空时按 1(都没引用任何时刻 = 没有差异)。 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * 结构化结论的固定主题枚举。
 *
 * 为什么必须固定:自由散文里「模型引用了哪些时刻」这个指标的噪声底实测
 * **Jaccard 0.407(生产温度)/ 0.494(温度 0)** —— 同一份 prompt 跑两次就差这么多,
 * 而删掉占 16.5% 字符的整个 `[STATE]` 类才把它压到 0.401。信号比噪声还小,这个尺子
 * 没法用。固定枚举把「这一局模型认为哪几类问题存在」变成可比集合,才谈得上比较。
 */
const FINDING_TOPICS = [
  "defensive-timing",
  "cc-usage",
  "dispel",
  "positioning",
  "kill-window",
  "healing-throughput",
  "cooldown-waste",
  "peel",
  "mana",
  "other",
] as const;
export type FindingTopic = (typeof FINDING_TOPICS)[number];

export interface StructuredFinding {
  t: string;
  topic: FindingTopic;
  verdict: "good" | "bad";
  claim: string;
}

/** 追加在 responder 消息后面的结构化要求。**这是对生产口径的偏离**,报告须写明。 */
export const STRUCTURED_SUFFIX = `

---

除了上面的分析,请在回答的**最后**单独附一段 JSON,不要有任何其他文字包裹:

\`\`\`json
{"findings":[{"t":"M:SS","topic":"<从下面枚举里选一个>","verdict":"good|bad","claim":"一句话"}]}
\`\`\`

topic 只能取:${FINDING_TOPICS.join(" / ")}
每条结论一项,最多 8 项。t 用 prompt 里出现过的时刻。`;

/**
 * 从模型回答里抽出结构化结论;抽不到返回空数组(截断/无 JSON 都不抛错)。
 *
 * 实现是「从最后一个 `"findings"` 关键字回溯到它所属的 `{`,再做括号配平扫描」,
 * 而**不是**懒惰正则 —— 首版用懒惰正则从文本里**第一个** `{` 开始匹配,正文里任何
 * 别的花括号对象(配置示例、代码片段)都会让抽取跨过垃圾文本,JSON.parse 必败
 * (单测「正文里出现别的花括号对象」钉住这个回归)。
 */
export function parseFindings(answer: string): StructuredFinding[] {
  let idx = answer.lastIndexOf('"findings"');
  while (idx >= 0) {
    const open = answer.lastIndexOf("{", idx);
    if (open < 0) break;
    const block = extractBalancedObject(answer, open);
    if (block) {
      try {
        const o = JSON.parse(block) as { findings?: StructuredFinding[] };
        if (Array.isArray(o.findings))
          return o.findings.filter((f) => f && f.topic);
      } catch {
        /* 这一处配平了但仍不是合法 JSON —— 试更早的出现 */
      }
    }
    idx = answer.lastIndexOf('"findings"', idx - 1);
  }
  return [];
}

/** 从 `start` 处的 `{` 起做括号配平(字符串与转义感知);配不平(截断)返回 null。 */
function extractBalancedObject(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 结论集合的可比键:**只用主题**。
 *
 * 时刻不进键 —— 同一件事模型可能标在相邻几秒,那不该算差异。
 * 极性(good/bad)也不进键:实测同一份 prompt 的两次基线里,同一个主题的极性会翻,
 * 把它算进去等于把模型的措辞抖动计成「结论变了」。要看极性变化请单独统计。
 */
export function findingKeys(fs: StructuredFinding[]): Set<string> {
  return new Set(fs.map((f) => f.topic));
}
