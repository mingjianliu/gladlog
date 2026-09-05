/**
 * Prompt 逐行效果探针 —— 「我们发给 LLM 的每一行,它到底怎么用?」
 *
 * 为什么不用判官打分:accuracy 的成对噪声底 SD≈1.3(|Δ|<0.4 测不出)、sufficiency
 * 对植入缺陷只有 20% 检出率(docs/HANDOFF-2026-07-20-judge-variance.md)。两维都
 * 不具备 A/B 裁决力。本探针测的是**确定性的行为改变**:同一局、同一个模型,只改
 * prompt 的一类行,看输出引用的时刻集合变不变。变了 = 在用,不变 = token 开销。
 *
 * 三种探法(2026-08-23 单局验证全部有效,本脚本把它们批量化):
 *   · `ablate`   —— 整类删掉,比较引用集合的 Jaccard;
 *   · `plant`    —— 把某一行的**结论词**反转(如「掉了 39pp」改成「healed through」),
 *                   看模型是否照单全收。单局实测:模型不但收下,还编出 prompt 里
 *                   没有的因果,且完全没察觉与同一局 `[STATE]` 行的矛盾;
 *   · `baseline` —— 只跑基线,给上面两种做对照。
 *
 * 单局验证时最强的一个证据:同一局只改一行 `[DMG SPIKE]`,模型对同一次防御的裁决
 * 在「你打得完美」和「纯粹的恐慌交、浪费了」之间翻转。所以 prompt 里每一句带判断
 * 的话都是我们在替模型下结论 —— 是杠杆,也是风险。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/promptAblationProbe.ts \
 *     --list <归档文件清单> --matches 100 --out <目录> [--types "[DMG SPIKE],[STATE]"] \
 *     [--concurrency 4] [--mode ablate|baseline]
 *
 * **清单要钉快照**:归档目录会随下载增长(2026-08-23 一次会话里从 10,676 涨到
 * 18,134),不钉的话前后两次跑的不是同一批数据。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import {
  buildMatchContext,
  ensureAnalysisData,
  isHealerSpec,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { parseLogCombats } from "../src/corpus/candidateMenu";
import { Breaker, callCli, type CliBackend } from "../src/explore/cliDriver";
import {
  ABLATABLE,
  ablateLineType,
  citedMoments,
  classifyPromptLine,
  findingKeys,
  jaccard,
  parseFindings,
  STRUCTURED_SUFFIX,
} from "../src/explore/promptLineTypes";
import {
  buildResponderMessages,
  callDeepseek,
} from "../src/family/deepseekDriver";

function arg(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const listPath = arg("--list");
const outDir = arg("--out");
if (!listPath || !outDir) {
  console.error(
    "Usage: promptAblationProbe --list <files.txt> --out <dir> [--matches N] [--types a,b] [--concurrency K] [--mode ablate|baseline]",
  );
  process.exit(1);
}
const wantMatches = Number(arg("--matches", "100"));
const concurrency = Number(arg("--concurrency", "4"));
const mode = arg("--mode", "ablate")!;
/**
 * 基线重复次数 —— **对照组,不是可选项**。
 *
 * 2026-08-23 首次冒烟(3 局 × 27 类)所有类型的 Jaccard 都挤在 0.275–0.450 的窄带里,
 * 而当时**没有对照**:模型对同一个 prompt 跑两次本来就会引用不同的时刻,所以那张表
 * 里有多少是消融效应、有多少是采样噪声,完全无法区分。没有 baseline-vs-baseline 的
 * 噪声底,这个探针测出来的任何数字都不可读。
 *
 * 判读规则:一个类型的 Jaccard 只有**明显低于**噪声底(基线自比)才算「模型在用它」。
 */
const baselineRepeats = Number(arg("--repeats", "3"));
/**
 * 采样温度 —— 默认 **0**,与生产(不传 temperature)**故意不同**。
 *
 * 理由见 deepseekDriver 里 `temperature` 的注释:默认温度下基线自比的 Jaccard 只有
 * 0.407 ± 0.057,连删掉 `[STATE]` 这种量级的消融都测不出来。本探针要回答的是因果
 * 问题(「这一行有没有被用」),必须先把采样噪声压下去。
 *
 * **报告里必须写明**:结论是「温度 0 下这一行会改变输出」,是生产相关性的下界,
 * 不等于生产温度下的行为。传 `--temperature default` 可以还原生产口径。
 */
/**
 * 后端:`agy`(默认,单次 14s)/ `claude`(115s,做跨模型交叉验证)/ `deepseek`。
 * 三者的实测耗时见 `src/explore/cliDriver.ts` 的文件头。
 */
const backend = arg("--backend", "agy")!;
const cliModel = arg("--model");
const breaker = new Breaker(Number(arg("--breaker", "8")));
const tempArg = arg("--temperature", "0")!;
const temperature = tempArg === "default" ? undefined : Number(tempArg);
const typeFilter = arg("--types")
  ?.split(",")
  .map((s) => s.trim());

mkdirSync(outDir, { recursive: true });
await ensureAnalysisData();

/** 取 N 局真实对局的真实 prompt。 */
function collectPrompts(limit: number): Array<{ id: string; prompt: string }> {
  const files = readFileSync(listPath!, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  const out: Array<{ id: string; prompt: string; augmented?: string }> = [];
  for (const f of files) {
    if (out.length >= limit) break;
    let text = "";
    try {
      text = gunzipSync(readFileSync(f)).toString("utf8");
    } catch {
      continue;
    }
    let combats: ReturnType<typeof parseLogCombats> = [];
    try {
      combats = parseLogCombats(text);
    } catch {
      continue;
    }
    for (const c of combats) {
      if (out.length >= limit) break;
      const players = (Object.values(c.legacy.units) as never[]).filter(
        (u: never) => (u as { info?: unknown }).info,
      ) as Array<{ reaction: number; spec: never; name: string }>;
      const friends = players.filter(
        (u) => u.reaction === CombatUnitReaction.Friendly,
      );
      const enemies = players.filter(
        (u) => u.reaction !== CombatUnitReaction.Friendly,
      );
      const owner = friends.find((u) => isHealerSpec(u.spec));
      const dur = (c.legacy.endTime - c.legacy.startTime) / 1000;
      if (!owner || dur < 120) continue;
      let prompt = "";
      let augmented = "";
      try {
        prompt = buildMatchContext(
          c.legacy as never,
          friends as never,
          enemies as never,
          { owner } as never,
        );
        // augment mode (GH #51, 2026-09-05): the same prompt with the
        // critical-moments block appended; compared against the baseline
        // exactly like an ablation, sign reversed.
        if (mode === "augment")
          augmented = buildMatchContext(
            c.legacy as never,
            friends as never,
            enemies as never,
            { owner, criticalMomentsBlock: true } as never,
          );
      } catch {
        continue;
      }
      if (!prompt.includes("[STATE]")) continue;
      if (mode === "augment" && augmented === prompt) continue; // no moments → nothing to test
      out.push({
        id: `${f.split("/").pop()?.slice(0, 8)}-${out.length}`,
        prompt,
        augmented,
      });
    }
  }
  return out;
}

const matches = collectPrompts(wantMatches);
console.log(`取到 ${matches.length} 局(要 ${wantMatches})`);
if (matches.length === 0) process.exit(1);

/** 本批要消融的类型:出现在至少一半对局里、且可消融。 */
const typeCounts = new Map<string, number>();
for (const m of matches) {
  const seen = new Set(m.prompt.split("\n").map(classifyPromptLine));
  for (const k of seen) typeCounts.set(k, (typeCounts.get(k) ?? 0) + 1);
}
const types =
  mode === "augment"
    ? ["+critical_moments"]
    : typeFilter ??
  [...typeCounts.entries()]
    .filter(([k, n]) => ABLATABLE(k) && n >= matches.length / 2)
    .map(([k]) => k);
console.log(`消融类型 ${types.length} 个:${types.join(" ")}`);

interface Row {
  match: string;
  variant: string;
  answer: string;
  moments: string[];
  /** 结构化结论的可比键(topic:verdict)。 */
  topics: string[];
  chars: number;
}
const rows: Row[] = [];
let done = 0;
let total = 0; // 待跑数,pending 算出来后赋值

async function runOne(
  match: { id: string; prompt: string; augmented?: string },
  variant: string,
) {
  const text =
    variant === "baseline"
      ? match.prompt
      : variant === "+critical_moments"
        ? match.augmented!
        : ablateLineType(match.prompt, variant);
  let answer = "";
  try {
    const msgs = buildResponderMessages(text);
    msgs[msgs.length - 1] = {
      ...msgs[msgs.length - 1],
      content: msgs[msgs.length - 1].content + STRUCTURED_SUFFIX,
    };
    if (backend === "deepseek") {
      // 3072 会把末尾那段 JSON 切断 —— 实测 10% 的样本因此解析不出结论,而空集合
      // 会让 Jaccard 剧烈跳动。留足余量。
      answer = await callDeepseek(msgs, { maxTokens: 6144, temperature });
    } else {
      // CLI 后端没有 system/user 之分,把两段拼成一份 prompt
      answer = await callCli(
        backend as CliBackend,
        msgs.map((m) => m.content).join("\n\n"),
        { model: cliModel },
      );
    }
    breaker.ok();
  } catch (e) {
    answer = `__ERROR__ ${(e as Error).message}`;
    // 熔断:连续失败到上限就抛,让整个批次立刻停 —— 2026-08-23 的空转事故
    breaker.fail(e);
  }
  rows.push({
    match: match.id,
    variant,
    answer,
    moments: [...citedMoments(answer)],
    topics: [...findingKeys(parseFindings(answer))],
    chars: answer.length,
  });
  done++;
  if (done % 10 === 0) console.log(`  ${done}/${total}`);
  // 每 25 次增量落盘 —— 中止/崩溃都不至于丢掉整批
  if (done % 25 === 0)
    writeFileSync(join(outDir!, "raw.json"), JSON.stringify(rows));
}

/** 简单并发池 —— 别把并发开大:2026-08-18 有过并行语料扫描把机器冻死的先例。 */
async function pool<T>(items: T[], k: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(k, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    }),
  );
}

/**
 * 断点续跑:同一个 --out 目录里已有的样本直接复用。
 *
 * 2026-08-23 一天里有三批被中止(DeepSeek 余额、agy 额度、claude 限流),每次都要
 * 从零重跑。这类批量任务的默认假设应该是「会被打断」,而不是「一次跑完」。
 */
const prior: Row[] = (() => {
  try {
    const all = JSON.parse(
      readFileSync(join(outDir!, "raw.json"), "utf8"),
    ) as Row[];
    // 错误行不算「已完成」—— 否则被限流/额度打断那一批的失败格子永远不会补跑
    // (2026-08-24 实测:haiku 续跑把 30 个 __ERROR__ 格子当成跑过的,2% 数据永久丢失)。
    return all.filter((r) => !r.answer.startsWith("__ERROR__"));
  } catch {
    return [];
  }
})();
if (prior.length) {
  rows.push(...prior);
  console.log(`续跑:复用已有 ${prior.length} 个样本`);
}
const seen = new Set(prior.map((r) => `${r.match}\u0000${r.variant}`));

const jobs: Array<{ m: (typeof matches)[number]; v: string }> = [];
for (const m of matches) {
  for (let i = 0; i < baselineRepeats; i++)
    jobs.push({ m, v: `baseline#${i}` });
  if (mode !== "baseline") for (const t of types) jobs.push({ m, v: t });
}
const pending = jobs.filter((j) => !seen.has(`${j.m.id}\u0000${j.v}`));
console.log(
  `共 ${jobs.length} 个格子,待跑 ${pending.length} 次模型调用,并发 ${concurrency}`,
);
/**
 * 熔断中止时**必须把已跑完的样本落盘**。
 *
 * 2026-08-23:agy 额度耗尽,熔断器正确地在连续 8 次失败后中止 —— 但异常直接穿出
 * `pool`,`writeFileSync` 那几行没执行到,**已经跑完的 560 次调用全部丢失**。
 * 熔断解决的是「不要空转」,不解决「不要丢数据」,这是两件事。
 */
total = pending.length;
let aborted: string | null = null;
try {
  await pool(pending, concurrency, (j) => runOne(j.m, j.v));
} catch (e) {
  aborted = (e as Error).message;
  console.error(
    `\n⚠ 中止:${aborted}\n已完成 ${rows.length} 次调用,结果照常落盘。`,
  );
}

writeFileSync(join(outDir!, "raw.json"), JSON.stringify(rows));

// —— 汇总:每个类型被删掉后,输出引用的时刻集合和基线差多少 ——
const byMatch = new Map<string, Map<string, Row>>();
for (const r of rows) {
  if (!byMatch.has(r.match)) byMatch.set(r.match, new Map());
  byMatch.get(r.match)!.set(r.variant, r);
}
interface Agg {
  n: number;
  jaccardSum: number;
  lostSum: number;
  charDeltaSum: number;
}
const agg = new Map<string, Agg>();
/** 对照组:同一个 prompt 的两次基线之间的 Jaccard —— 这就是噪声底。 */
const controlJ: number[] = [];
const ok = (r: Row | undefined) =>
  r !== undefined && !r.answer.startsWith("__ERROR__");
for (const [, variants] of byMatch) {
  const bases = [...variants.entries()]
    .filter(([v, r]) => v.startsWith("baseline") && ok(r))
    .map(([, r]) => r);
  if (bases.length === 0) continue;
  for (let i = 0; i < bases.length; i++)
    for (let j = i + 1; j < bases.length; j++)
      controlJ.push(
        jaccard(new Set(bases[i].topics), new Set(bases[j].topics)),
      );
  for (const [v, r] of variants) {
    if (v.startsWith("baseline") || !ok(r)) continue;
    const rm = new Set(r.topics);
    // 与**每一个**基线比再取平均,免得刚好撞上某一次离群的基线
    let js = 0;
    let ls = 0;
    let cs = 0;
    for (const b of bases) {
      const bm = new Set(b.topics);
      js += jaccard(bm, rm);
      ls += [...bm].filter((x) => !rm.has(x)).length / Math.max(1, bm.size);
      cs += (r.chars - b.chars) / Math.max(1, b.chars);
    }
    const a = agg.get(v) ?? {
      n: 0,
      jaccardSum: 0,
      lostSum: 0,
      charDeltaSum: 0,
    };
    a.n++;
    a.jaccardSum += js / bases.length;
    a.lostSum += ls / bases.length;
    a.charDeltaSum += cs / bases.length;
    agg.set(v, a);
  }
}
const mean = (a: number[]) =>
  a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sdev = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const floorMean = mean(controlJ);
const floorSd = sdev(controlJ);
const lines: string[] = [
  `# Prompt 逐行效果探针`,
  ``,
  ...(aborted
    ? [
        `> ⚠ **本批被中止**:${aborted}`,
        `> 已完成 ${rows.length}/${jobs.length} 次调用,下表基于已完成的部分。`,
        ``,
      ]
    : []),
  `- 对局 ${matches.length} 局 · 模型调用 ${jobs.length} 次 · 模式 ${mode} · 后端 ${backend}${cliModel ? `/${cliModel}` : ""}${backend === "deepseek" ? ` · temperature ${temperature ?? "(生产默认)"}` : ""}`,
  `- 判据:删掉某一类行之后,模型输出**结构化结论集合**(topic:verdict)与基线的 Jaccard。低 = 输出被改变 = 这类行在被使用。`,
  ``,
  `## 噪声底(对照组:同一 prompt 的两次基线互比)`,
  ``,
  `**Jaccard = ${floorMean.toFixed(3)} ± ${floorSd.toFixed(3)}**(SD;n=${controlJ.length} 对,SE=${(floorSd / Math.sqrt(Math.max(1, controlJ.length))).toFixed(3)})。`,
  `模型对同一份 prompt 跑两次本来就会引用不同的时刻,所以**只有明显低于 ${(floorMean - floorSd).toFixed(3)}`,
  `(噪声底 −1SD)的类型才谈得上「模型在用它」**;落在噪声带里的类型,这个探针说明不了任何事。`,
  ``,
  `## 逐类型`,
  ``,
  `| 删掉的行类型 | n | 结论集合 Jaccard | 与噪声底的差 | z | 基线结论丢失率 | 输出长度变化 |`,
  `|---|---:|---:|---:|---:|---:|---:|`,
];
const floorSe = floorSd / Math.sqrt(Math.max(1, controlJ.length));
for (const [v, a] of [...agg.entries()].sort(
  (x, y) => x[1].jaccardSum / x[1].n - y[1].jaccardSum / y[1].n,
))
  lines.push(
    ((): string => {
      const m = a.jaccardSum / a.n;
      const d = m - floorMean;
      // 配对比较:差值除以两侧标准误的合成
      const se = Math.sqrt(floorSe ** 2 + (floorSd / Math.sqrt(a.n)) ** 2);
      const z = se > 0 ? d / se : 0;
      const sig = z <= -2 ? " **显著**" : z <= -1 ? " (弱)" : "";
      return `| ${v} | ${a.n} | ${m.toFixed(3)} | ${(d >= 0 ? "+" : "") + d.toFixed(3)} | ${z.toFixed(1)}${sig} | ${((100 * a.lostSum) / a.n).toFixed(1)}% | ${((100 * a.charDeltaSum) / a.n).toFixed(1)}% |`;
    })(),
  );
writeFileSync(join(outDir, "report.md"), lines.join("\n") + "\n");
console.log(`\n${lines.join("\n")}`);
console.log(`\n写入 ${outDir}`);
