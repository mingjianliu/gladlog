/**
 * 植入缺陷探针 —— 「prompt 里那半句结论词,模型会不会照单全收?」
 *
 * 2026-08-23 单局验证发现的形状:同一局、同一份 `[STATE]`,只把一行 `[DMG SPIKE]`
 * 的结论词从「48% -> 9% HP」改成「+0%/s — healed through」,模型对同一次防御的裁决
 * 就从「**你打得完美**,在最关键的时刻用了它」翻转成「这是**纯粹的恐慌交**……浪费了」,
 * 而且**完全没察觉这与同一份 prompt 里 `[STATE]` 行写着的 9% 血矛盾** —— 它还补出了
 * 「你的 Riptide 保着他」这个 prompt 里根本没有的因果。
 *
 * 这个脚本把它批量化:单局是存在性证明,要变成结论需要发生率。
 *
 * 与消融探针(`promptAblationProbe.ts`)的分工:
 *   · 消融回答「这一行**有没有**被用」;
 *   · 植入回答「这一行里的**判断词**有多大权重」—— 即模型是自己从数字推,还是直接
 *     采信我们写的结论。后者若成立,prompt 里每一句带判断的话都是杠杆,也是风险。
 *
 * 判据是**确定性的**,不靠判官打分(accuracy 噪声底 SD≈1.3,没有裁决力):
 * 看被植入的那个时刻在模型结论里的**极性**(good/bad)有没有翻,以及模型有没有
 * 显式指出矛盾。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/promptPlantProbe.ts \
 *     --list <清单> --matches 100 --out <目录> [--concurrency 4]
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
  parseFindings,
  STRUCTURED_SUFFIX,
  type StructuredFinding,
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
    "Usage: promptPlantProbe --list <files.txt> --out <dir> [--matches N] [--concurrency K]",
  );
  process.exit(1);
}
const wantMatches = Number(arg("--matches", "100"));
const concurrency = Number(arg("--concurrency", "4"));
/** 后端选择与消融探针同一套(实测耗时与坑见 `src/explore/cliDriver.ts`)。 */
const backend = arg("--backend", "agy")!;
const cliModel = arg("--model");
const breaker = new Breaker(Number(arg("--breaker", "10")));
mkdirSync(outDir, { recursive: true });
await ensureAnalysisData();

/** 被植入的那一行:掉血最狠的 `[DMG SPIKE]`,把结论反转成「扛住了」。 */
interface Target {
  id: string;
  prompt: string;
  planted: string;
  atSeconds: number;
  dropPp: number;
}

function collect(limit: number): Target[] {
  const files = readFileSync(listPath!, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  const out: Target[] = [];
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
      if (!owner || (c.legacy.endTime - c.legacy.startTime) / 1000 < 120)
        continue;
      let prompt = "";
      try {
        prompt = buildMatchContext(
          c.legacy as never,
          friends as never,
          enemies as never,
          { owner } as never,
        );
      } catch {
        continue;
      }
      const lines = prompt.split("\n");
      // 掉血最狠的一条 spike 行
      let best = -1;
      let bestDrop = 0;
      lines.forEach((l, i) => {
        if (!l.includes("[DMG SPIKE]") || !/^\s*\d+:\d\d/.test(l)) return;
        const m = l.match(/\((\d+)%\s*->\s*(\d+)%\s*HP/);
        if (!m) return;
        const d = Number(m[1]) - Number(m[2]);
        if (d > bestDrop) {
          bestDrop = d;
          best = i;
        }
      });
      // 至少要掉 20pp 才值得植入 —— 太小的翻转本来就没有裁决意义
      if (best < 0 || bestDrop < 20) continue;
      const orig = lines[best];
      const m = orig.match(/\((\d+)%\s*->\s*(\d+)%\s*HP,\s*[-+]?\d+%\/s\)/);
      if (!m) continue;
      const from = Number(m[1]);
      const planted = [...lines];
      planted[best] = orig.replace(
        m[0],
        `(${from}% -> ${Math.min(100, from + 3)}% HP, +0%/s — healed through)`,
      );
      const ts = orig.trim().match(/^(\d+):(\d\d)/);
      out.push({
        id: `${f.split("/").pop()?.slice(0, 8)}-${out.length}`,
        prompt,
        planted: planted.join("\n"),
        atSeconds: ts ? Number(ts[1]) * 60 + Number(ts[2]) : -1,
        dropPp: bestDrop,
      });
    }
  }
  return out;
}

const targets = collect(wantMatches);
console.log(`取到 ${targets.length} 局可植入(掉血 ≥20pp 的 spike 行)`);
if (targets.length === 0) process.exit(1);

async function ask(text: string): Promise<string> {
  const msgs = buildResponderMessages(text);
  msgs[msgs.length - 1] = {
    ...msgs[msgs.length - 1],
    content: msgs[msgs.length - 1].content + STRUCTURED_SUFFIX,
  };
  try {
    const out =
      backend === "deepseek"
        ? await callDeepseek(msgs, { maxTokens: 6144, temperature: 0 })
        : await callCli(
            backend as CliBackend,
            msgs.map((m) => m.content).join("\n\n"),
            { model: cliModel },
          );
    breaker.ok();
    return out;
  } catch (e) {
    breaker.fail(e);
    return `__ERROR__ ${(e as Error).message}`;
  }
}

/** 结论里落在 [t-15s, t+15s] 的那些条,取它们的极性。 */
function verdictNear(fs: StructuredFinding[], atSeconds: number): string[] {
  const out: string[] = [];
  for (const f of fs) {
    const m = String(f.t ?? "").match(/(\d+):(\d\d)/);
    if (!m) continue;
    const s = Number(m[1]) * 60 + Number(m[2]);
    if (Math.abs(s - atSeconds) <= 15) out.push(f.verdict);
  }
  return out;
}

interface Res {
  id: string;
  dropPp: number;
  atSeconds: number;
  baseBad: number;
  plantBad: number;
  baseMentions: number;
  plantMentions: number;
  noticedContradiction: boolean;
}
const results: Res[] = (() => {
  // 断点续跑:同 --out 目录已有的结果直接复用(同消融探针,批量任务默认会被打断)
  try {
    return JSON.parse(readFileSync(join(outDir!, "raw.json"), "utf8")) as Res[];
  } catch {
    return [];
  }
})();
if (results.length) console.log(`续跑:复用已有 ${results.length} 局结果`);
const doneIds = new Set(results.map((r) => r.id));
let done = 0;

async function runOne(t: Target) {
  if (doneIds.has(t.id)) {
    done++;
    return;
  }
  const [a, b] = await Promise.all([ask(t.prompt), ask(t.planted)]);
  if (a.startsWith("__ERROR__") || b.startsWith("__ERROR__")) {
    done++;
    return;
  }
  const fa = parseFindings(a);
  const fb = parseFindings(b);
  const va = verdictNear(fa, t.atSeconds);
  const vb = verdictNear(fb, t.atSeconds);
  // 模型有没有显式指出「这一行和 STATE 矛盾」
  const noticed = /矛盾|inconsistent|contradict|不一致|与 \[STATE\]/i.test(b);
  results.push({
    id: t.id,
    dropPp: t.dropPp,
    atSeconds: t.atSeconds,
    baseBad: va.filter((x) => x === "bad").length,
    plantBad: vb.filter((x) => x === "bad").length,
    baseMentions: va.length,
    plantMentions: vb.length,
    noticedContradiction: noticed,
  });
  done++;
  if (done % 10 === 0) console.log(`  ${done}/${targets.length}`);
  if (done % 10 === 0)
    writeFileSync(join(outDir!, "raw.json"), JSON.stringify(results));
}

async function pool<T>(items: T[], k: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(k, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}
console.log(
  `共 ${targets.length * 2} 次模型调用(已完成 ${doneIds.size} 局可跳过),后端 ${backend}${cliModel ? `/${cliModel}` : ""},并发 ${concurrency}`,
);
try {
  await pool(targets, concurrency, runOne);
} catch (e) {
  console.error(
    `\n⚠ 中止:${(e as Error).message}\n已完成 ${results.length} 局,照常落盘出报告。`,
  );
}

writeFileSync(join(outDir, "raw.json"), JSON.stringify(results));
const n = results.length;
const mentionedBase = results.filter((r) => r.baseMentions > 0).length;
const stillMentioned = results.filter(
  (r) => r.baseMentions > 0 && r.plantMentions > 0,
).length;
const flipped = results.filter((r) => r.baseBad > 0 && r.plantBad === 0).length;
const noticed = results.filter((r) => r.noticedContradiction).length;
const lines = [
  `# 植入缺陷探针:结论词的权重`,
  ``,
  `把每局掉血最狠的那条 \`[DMG SPIKE]\`(掉幅 ≥20pp,中位 ${
    [...results].sort((a, b) => a.dropPp - b.dropPp)[Math.floor(n / 2)]
      ?.dropPp ?? "?"
  }pp)的结论词反转成「healed through」,其余一字不改。`,
  ``,
  `| 指标 | 值 |`,
  `|---|---:|`,
  `| 有效对局 | ${n} |`,
  `| 基线里模型会讨论那个时刻 | ${mentionedBase} (${((100 * mentionedBase) / n).toFixed(0)}%) |`,
  `| 植入后仍然讨论 | ${stillMentioned} (${mentionedBase ? ((100 * stillMentioned) / mentionedBase).toFixed(0) : "-"}% 的基线讨论过的) |`,
  `| **极性被翻转**(基线判 bad → 植入后不再判 bad) | **${flipped} (${mentionedBase ? ((100 * flipped) / mentionedBase).toFixed(0) : "-"}%)** |`,
  `| 模型显式指出与 \`[STATE]\` 矛盾 | ${noticed} (${((100 * noticed) / n).toFixed(0)}%) |`,
  ``,
  `注:植入的那一行与同一份 prompt 里的 \`[STATE]\` 行**直接矛盾**(STATE 白纸黑字写着`,
  `窗口结束时的真实血量)。「显式指出矛盾」那一行的比例,就是模型交叉校验 prompt`,
  `内部一致性的能力上界。`,
];
writeFileSync(join(outDir, "report.md"), lines.join("\n") + "\n");
console.log(`\n${lines.join("\n")}`);
