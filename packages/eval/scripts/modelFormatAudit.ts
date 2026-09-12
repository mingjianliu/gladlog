 
/**
 * CLI: audit of the model output's SHAPE (the findings JSON path).
 *
 * Origin: a production bug on 2026-07-20 — the model wrapped perfectly valid
 * content in a ```json fence, while the old code in main/analysis.ts,
 * `JSON.parse(raw.trim())`, had zero tolerance, so the entire analysis was
 * judged bad-json and fell back to the deterministic view. The fix is the
 * shared predicate parseModelJsonArray.
 *
 * This script quantifies two things against the REAL corpus distribution:
 *   1) what fraction of each backend's responses actually carry fences/prose
 *      (= the pre-fix false-kill rate)
 *   2) how many the new predicate rescues (= the post-fix pass rate), and
 *      whether any shape defeats both
 *
 * Division of labor with pipelineFuzz: that one is a purely deterministic
 * whole-pipeline checkup (it never calls a model); this one targets the
 * "shape of the model's reply" layer specifically, so it must really call the
 * backend.
 *
 * Usage:
 *   tsx packages/eval/scripts/modelFormatAudit.ts \
 *     --count 40 [--backend agy|claudeCli] [--concurrency 4] [--run <id>] \
 *     [--corpus <dir of raw .txt logs>]
 *
 * `--corpus` defaults to `$GLADLOG_EVAL_HOME/corpus/fuzz-1000`, which was
 * deleted from the eval repo's working tree in 2026-08; the run now fails fast
 * with instructions (`requireCorpusLogs`) instead of throwing ENOENT.
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

import {
  defaultFuzzCorpusDir,
  requireCorpusLogs,
} from "../src/corpus/requireCorpusLogs";
import { resolveEvalHome } from "../src/evalHome";

/** The pre-fix predicate: the old main/analysis.ts code, verbatim. */
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
    corpus: "",
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--count") o.count = Number(a[i + 1]);
    else if (a[i] === "--backend") o.backend = a[i + 1] as typeof o.backend;
    else if (a[i] === "--concurrency") o.concurrency = Number(a[i + 1]);
    else if (a[i] === "--run") o.run = a[i + 1];
    else if (a[i] === "--corpus") o.corpus = a[i + 1] ?? "";
  }
  return o;
}

/** One log → the findings prompt for the first analyzable combat (null when
 * none can be obtained). */
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
      // no candidates → the product would not call the model either
      if (cands.length === 0) continue;
      const friends = players.filter((u) => u.reaction === owner.reaction);
      const enemies = players.filter((u) => u.reaction !== owner.reaction);
      const ctx = buildMatchContext(legacy, friends, enemies, {
        owner,
      });
      return {
        prompt: buildFindingsPrompt(cands, ctx, specToString(owner.spec)),
        nCand: cands.length,
      };
    } catch {
      /* if this match yields nothing, try the next one */
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
  const { count, backend, concurrency, run, corpus } = parseArgs();
  const evalHome = resolveEvalHome();
  const logDir = corpus || defaultFuzzCorpusDir(evalHome);
  const runId = run || `modelformat-${backend}`;
  const outDir = path.join(evalHome, "runs", runId);
  await fs.ensureDir(outDir);

  // Borrow the backend clients straight from the desktop main-process
  // implementation — the product runs exactly these two factories, so writing
  // another spawn here would amount to testing a shadow implementation.
  const { agyClientFactory, claudeCliClientFactory } =
    (await import("../../desktop/src/main/localAiBackends")) as typeof import("../../desktop/src/main/localAiBackends");
  const { buildCoachSystemPrompt } =
    (await import("../../desktop/src/main/ai")) as typeof import("../../desktop/src/main/ai");
  const { AI_DEFAULT_MODEL } =
    (await import("../../desktop/src/shared/aiModels")) as typeof import("../../desktop/src/shared/aiModels");

  const client =
    backend === "agy"
      ? agyClientFactory({})
      : claudeCliClientFactory({ cmd: "claude" });
  const model = backend === "agy" ? "flash" : AI_DEFAULT_MODEL.claudeCli;

  const files = (await requireCorpusLogs(logDir, "modelFormatAudit.ts")).sort();

  // Build all the prompts first (pure CPU), then hit the model concurrently —
  // parsing is heavy, so don't interleave it with network work
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

  // Simple concurrency pool (agy is fast, claudeCli is slow — the concurrency
  // is mainly there for agy)
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
