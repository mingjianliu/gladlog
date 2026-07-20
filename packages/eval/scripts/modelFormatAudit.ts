/* eslint-disable no-console */
/**
 * CLI: 模型输出**形态**审计(findings JSON 路径)。
 *
 * 起因:2026-07-20 现网 bug —— 模型把完全合规的内容包进 ```json 围栏,
 * 而 main/analysis.ts 旧写法 `JSON.parse(raw.trim())` 零容错,整份分析被判
 * bad-json 退成确定性展示。修法是共享谓词 parseModelJsonArray。
 *
 * 本脚本在**真实语料分布**上量化两件事:
 *   1) 各后端到底多大比例的响应带围栏/散文(= 修前的误杀率)
 *   2) 新谓词能救回多少(= 修后通过率),以及是否存在两者都吃不下的形态
 *
 * 与 pipelineFuzz 的分工:那个是纯确定性全管线体检(不调模型),
 * 这个专打「模型返回形态」这一层,必须真调后端。
 *
 * Usage:
 *   tsx packages/eval/scripts/modelFormatAudit.ts \
 *     --count 40 [--backend agy|claudeCli] [--concurrency 4] [--run <id>]
 */

import {
  buildFindingsPrompt,
  buildMatchContext,
  extractCandidateFindings,
  isHealerSpec,
  parseModelJsonArray,
  specToString,
} from "@gladlog/analysis";
import { GladLogParser } from "@gladlog/parser";
import { CombatUnitReaction, toLegacyMatch } from "@gladlog/parser-compat";
import fs from "fs-extra";
import path from "path";

import { resolveEvalHome } from "../src/evalHome";

/** 修前判据:旧 main/analysis.ts 的写法,一字不差。 */
function strictOk(raw: string): boolean {
  try {
    return Array.isArray(JSON.parse(raw.trim()));
  } catch {
    return false;
  }
}

function classify(raw: string): string {
  const t = raw.trim();
  if (!t) return "空响应";
  if (t.startsWith("```")) return "markdown 围栏";
  if (t.startsWith("{")) return "顶层对象";
  if (t.startsWith("[")) return t.endsWith("]") ? "数组语法错" : "截断";
  return "前置散文";
}

function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    count: 40,
    backend: "agy" as "agy" | "claudeCli",
    concurrency: 4,
    run: "",
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--count") o.count = Number(a[i + 1]);
    else if (a[i] === "--backend") o.backend = a[i + 1] as typeof o.backend;
    else if (a[i] === "--concurrency") o.concurrency = Number(a[i + 1]);
    else if (a[i] === "--run") o.run = a[i + 1];
  }
  return o;
}

/** 一条日志 → 第一个可分析的 combat 的 findings prompt(取不到返回 null)。 */
function promptFromLog(text: string): { prompt: string; nCand: number } | null {
  const parser = new GladLogParser();
  const arenas: any[] = [];
  parser.on("match", (m: any) => arenas.push(m));
  try {
    for (const line of text.split("\n")) parser.push(line);
    parser.end();
  } catch {
    return null;
  }
  for (const m of arenas) {
    try {
      const legacy = toLegacyMatch(m) as any;
      const players = (Object.values(legacy.units ?? {}) as any[]).filter(
        (u) => u.info,
      );
      const owner =
        players.find(
          (u) =>
            u.id === legacy.playerId &&
            u.reaction === CombatUnitReaction.Friendly,
        ) ??
        players.find(
          (u) =>
            isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
        );
      if (!owner) continue;
      const cands = extractCandidateFindings(legacy, owner.id);
      if (cands.length === 0) continue; // 无候选 → 产品里也不调模型
      const friends = players.filter((u) => u.reaction === owner.reaction);
      const enemies = players.filter((u) => u.reaction !== owner.reaction);
      const ctx = buildMatchContext(legacy, friends, enemies, {
        useTimelinePrompt: true,
        owner,
      });
      return {
        prompt: buildFindingsPrompt(cands, ctx, specToString(owner.spec)),
        nCand: cands.length,
      };
    } catch {
      /* 这场取不到就试下一场 */
    }
  }
  return null;
}

interface Row {
  matchId: string;
  nCand: number;
  promptChars: number;
  rawChars: number;
  strict: boolean;
  fixed: boolean;
  kind: string;
  head: string;
}

async function main() {
  const { count, backend, concurrency, run } = parseArgs();
  const evalHome = resolveEvalHome();
  const logDir = path.join(evalHome, "corpus", "fuzz-1000");
  const runId = run || `modelformat-${backend}`;
  const outDir = path.join(evalHome, "runs", runId);
  await fs.ensureDir(outDir);

  // 后端客户端从 desktop 主进程实现直接借用 —— 产品跑的就是这两个工厂,
  // 这里再写一份 spawn 就等于测了个影子实现。
  const { agyClientFactory, claudeCliClientFactory } =
    (await import("../../desktop/src/main/localAiBackends")) as typeof import("../../desktop/src/main/localAiBackends");
  const { buildCoachSystemPrompt } =
    (await import("../../desktop/src/main/ai")) as typeof import("../../desktop/src/main/ai");

  const client =
    backend === "agy"
      ? agyClientFactory({})
      : claudeCliClientFactory({ cmd: "claude" });
  const model = backend === "agy" ? "flash" : "claude-sonnet-5";

  const files = (await fs.readdir(logDir))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  // 先把 prompt 都构建好(纯 CPU),再并发打模型 —— 解析很重,别和网络混在一起
  const jobs: Array<{ matchId: string; prompt: string; nCand: number }> = [];
  for (const f of files) {
    if (jobs.length >= count) break;
    let text: string;
    try {
      text = await fs.readFile(path.join(logDir, f), "utf-8");
    } catch {
      continue;
    }
    const p = promptFromLog(text);
    if (p) jobs.push({ matchId: f.replace(".txt", ""), ...p });
    if (jobs.length % 10 === 0 && jobs.length)
      console.log(`prompt 构建 ${jobs.length}/${count}`);
  }
  console.log(`可分析场次 ${jobs.length}(扫了 ${files.length} 个日志)`);

  const rows: Row[] = [];
  let done = 0;
  async function runOne(j: (typeof jobs)[number]) {
    let raw = "";
    try {
      for await (const ev of client.stream({
        model,
        max_tokens: 4096,
        system: buildCoachSystemPrompt("zh"),
        messages: [{ role: "user", content: j.prompt }],
      })) {
        if (ev.delta) raw += ev.delta;
      }
    } catch (e) {
      raw = `<<STREAM ERROR>> ${(e as Error).message}`;
    }
    const strict = strictOk(raw);
    const fixed = parseModelJsonArray(raw) !== null;
    rows.push({
      matchId: j.matchId,
      nCand: j.nCand,
      promptChars: j.prompt.length,
      rawChars: raw.length,
      strict,
      fixed,
      kind: strict ? "OK" : classify(raw),
      head: raw.trim().slice(0, 100),
    });
    await fs.appendFile(
      path.join(outDir, "raw.jsonl"),
      JSON.stringify({ matchId: j.matchId, raw }) + "\n",
    );
    done++;
    if (done % 5 === 0) console.log(`  模型调用 ${done}/${jobs.length}`);
  }

  // 简单的并发池(agy 快,claudeCli 慢 —— 并发主要是给 agy 用的)
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const j = queue.shift();
        if (!j) return;
        await runOne(j);
      }
    }),
  );

  const nStrict = rows.filter((r) => r.strict).length;
  const nFixed = rows.filter((r) => r.fixed).length;
  const rescued = rows.filter((r) => !r.strict && r.fixed);
  const neither = rows.filter((r) => !r.strict && !r.fixed);
  const byKind: Record<string, number> = {};
  for (const r of rows)
    if (!r.strict) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

  const summary = {
    backend,
    model,
    n: rows.length,
    修前通过: nStrict,
    修后通过: nFixed,
    被谓词救回: rescued.length,
    两者都吃不下: neither.length,
    失败形态分布: byKind,
    误杀率修前: rows.length ? +(1 - nStrict / rows.length).toFixed(3) : 0,
  };
  await fs.writeJson(
    path.join(outDir, "summary.json"),
    { summary, rows },
    { spaces: 2 },
  );
  console.log("\n" + JSON.stringify(summary, null, 2));
  if (neither.length) {
    console.log("\n两者都吃不下的样本(需要看):");
    for (const r of neither.slice(0, 5))
      console.log(`  ${r.matchId} [${r.kind}] ${JSON.stringify(r.head)}`);
  }
  console.log(`\n产物: ${outDir}`);
}

void main();
