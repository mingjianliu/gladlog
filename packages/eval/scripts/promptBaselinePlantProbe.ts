/**
 * SPEC BASELINES 聚合行植入探针 —— GH #36 第 1 项 ②(a):
 * 「`Defensive timing: Optimal X% | … | Late Y% | …` 这行每场百分比,能撬动教练吗?」
 *
 * 逐施法的 Optimal/Late 判词并不进单轮 prompt(criticalMoments 已删,实测
 * 0/1127),标签唯一进 prompt 的通道是 SPEC BASELINES 这一行聚合数字。本探针把
 * 同一局跑三份:基线 / Late 抬到 45%(Optimal 等量下调)/ Late 压到 0%(Optimal
 * 等量上调),其余一字不改。
 *
 * 判据确定性、不靠判官:结构化 findings 里**减伤时机偏晚**类裁决(claim 命中
 * late/晚/迟/滞后/太晚/after the burst 且 verdict=bad)的条数,以及回答正文有没有
 * 直接复述那个百分比。三份之间的差就是这行的杠杆。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/promptBaselinePlantProbe.ts \
 *     --list <清单> --matches 40 --out <目录> [--concurrency 4] [--backend agy]
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
    "Usage: promptBaselinePlantProbe --list <files.txt> --out <dir> [--matches N] [--concurrency K]",
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

interface Target {
  id: string;
  prompt: string;
  lateUp: string;
  lateDown: string;
  baseLatePct: number;
}

const TIMING_RE =
  /Defensive timing: Optimal (\d+)% \| Early (\d+)% \| Late (\d+)% \| Reactive (\d+)% \| Unknown (\d+)%/;

function rewrite(line: string, lateTo: number): string {
  const m = line.match(TIMING_RE)!;
  const opt = Number(m[1]);
  const late = Number(m[3]);
  const delta = lateTo - late;
  const newOpt = Math.max(0, Math.min(100, opt - delta));
  return line.replace(
    TIMING_RE,
    `Defensive timing: Optimal ${newOpt}% | Early ${m[2]}% | Late ${lateTo}% | Reactive ${m[4]}% | Unknown ${m[5]}%`,
  );
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
      const idx = lines.findIndex((l) => TIMING_RE.test(l));
      if (idx < 0) continue;
      const baseLatePct = Number(lines[idx].match(TIMING_RE)![3]);
      const up = [...lines];
      up[idx] = rewrite(lines[idx], 45);
      const down = [...lines];
      down[idx] = rewrite(lines[idx], 0);
      out.push({
        id: `${f.split("/").pop()?.slice(0, 8)}-${out.length}`,
        prompt,
        lateUp: up.join("\n"),
        lateDown: down.join("\n"),
        baseLatePct,
      });
    }
  }
  return out;
}

const targets = collect(wantMatches);
console.log(
  `取到 ${targets.length} 局可植入(带 Defensive timing 行;基线 Late 中位 ${[...targets].sort((a, b) => a.baseLatePct - b.baseLatePct)[Math.floor(targets.length / 2)]?.baseLatePct}%)`,
);
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

const LATE_RE =
  /\b(too )?late\b|after the burst|滞后|太晚|偏晚|交晚|用晚|开晚|迟/i;
const DEF_RE = /defensive|减伤|保命|cooldown|CD|external|外部|防御|wall|墙/i;
function lateBad(fs: StructuredFinding[]): number {
  return fs.filter(
    (f) =>
      f.verdict === "bad" &&
      LATE_RE.test(f.claim) &&
      (f.topic === "defensive-timing" || DEF_RE.test(f.claim)),
  ).length;
}
function quotesPct(text: string, pct: number): boolean {
  return new RegExp(
    `Late[^\\n]{0,12}${pct}%|${pct}%[^\\n]{0,12}(late|晚)`,
    "i",
  ).test(text);
}

interface Res {
  id: string;
  baseLatePct: number;
  base: { lateBad: number; bad: number; n: number; quotes: boolean };
  up: { lateBad: number; bad: number; n: number; quotes: boolean };
  down: { lateBad: number; bad: number; n: number; quotes: boolean };
}
const results: Res[] = (() => {
  try {
    return JSON.parse(readFileSync(join(outDir!, "raw.json"), "utf8")) as Res[];
  } catch {
    return [];
  }
})();
if (results.length) console.log(`续跑:复用已有 ${results.length} 局结果`);
const doneIds = new Set(results.map((r) => r.id));
let done = 0;

function score(text: string, pct: number) {
  const fs = parseFindings(text);
  return {
    lateBad: lateBad(fs),
    bad: fs.filter((f) => f.verdict === "bad").length,
    n: fs.length,
    quotes: quotesPct(text, pct),
  };
}

async function runOne(t: Target) {
  if (doneIds.has(t.id)) {
    done++;
    return;
  }
  const [a, b, c] = await Promise.all([
    ask(t.prompt),
    ask(t.lateUp),
    ask(t.lateDown),
  ]);
  if ([a, b, c].some((x) => x.startsWith("__ERROR__"))) {
    done++;
    return;
  }
  results.push({
    id: t.id,
    baseLatePct: t.baseLatePct,
    base: score(a, t.baseLatePct),
    up: score(b, 45),
    down: score(c, 0),
  });
  done++;
  if (done % 5 === 0) console.log(`  ${done}/${targets.length}`);
  if (done % 5 === 0)
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
  `共 ${targets.length * 3} 次模型调用(已完成 ${doneIds.size} 局可跳过),后端 ${backend}${cliModel ? `/${cliModel}` : ""},并发 ${concurrency}`,
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
const sum = (k: "base" | "up" | "down", f: "lateBad" | "bad" | "n") =>
  results.reduce((s, r) => s + r[k][f], 0);
const cnt = (k: "base" | "up" | "down") =>
  results.filter((r) => r[k].quotes).length;
const with_ = (k: "base" | "up" | "down") =>
  results.filter((r) => r[k].lateBad > 0).length;
const pct = (a: number, b: number) =>
  b ? `${((100 * a) / b).toFixed(0)}%` : "-";
const lines = [
  `# SPEC BASELINES 聚合行植入探针(GH #36 第 1 项 ②a)`,
  ``,
  `同一局三份 prompt:基线 / Late→45%(Optimal 等量下调)/ Late→0%(Optimal 等量上调)。有效对局 ${n},基线 Late 中位 ${[...results].sort((a, b) => a.baseLatePct - b.baseLatePct)[Math.floor(n / 2)]?.baseLatePct ?? "?"}%。`,
  ``,
  `| 版本 | 「减伤偏晚」bad 裁决总数 | 至少一条的对局 | bad 裁决总数 | findings 总数 | 复述了那个百分比 |`,
  `|---|---:|---:|---:|---:|---:|`,
  `| 基线 | ${sum("base", "lateBad")} | ${with_("base")} (${pct(with_("base"), n)}) | ${sum("base", "bad")} | ${sum("base", "n")} | ${cnt("base")} (${pct(cnt("base"), n)}) |`,
  `| Late→45% | ${sum("up", "lateBad")} | ${with_("up")} (${pct(with_("up"), n)}) | ${sum("up", "bad")} | ${sum("up", "n")} | ${cnt("up")} (${pct(cnt("up"), n)}) |`,
  `| Late→0% | ${sum("down", "lateBad")} | ${with_("down")} (${pct(with_("down"), n)}) | ${sum("down", "bad")} | ${sum("down", "n")} | ${cnt("down")} (${pct(cnt("down"), n)}) |`,
  ``,
  `判据:claim 同时命中 late/晚/迟/滞后 与 defensive/减伤/CD/外部 且 verdict=bad。`,
  `配对差(同局):Late→45% 比基线多出「偏晚」裁决的对局 ${results.filter((r) => r.up.lateBad > r.base.lateBad).length},少的 ${results.filter((r) => r.up.lateBad < r.base.lateBad).length};Late→0% 少的 ${results.filter((r) => r.down.lateBad < r.base.lateBad).length},多的 ${results.filter((r) => r.down.lateBad > r.base.lateBad).length}。`,
];
writeFileSync(join(outDir, "report.md"), lines.join("\n") + "\n");
console.log(`\n${lines.join("\n")}`);
