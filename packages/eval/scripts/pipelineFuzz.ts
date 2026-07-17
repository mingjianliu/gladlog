/* eslint-disable no-console */
/**
 * CLI: 千场野生对局全管线体检(fuzz/audit)。
 *
 * 抓取刻意不过滤:混合 3v3/2v2/Shuffle、不限评分、含无高级日志场次 ——
 * 回退路径与冷门数据形状正是要测的对象。每场跑:
 *   parse → toLegacy(+shuffle rounds) → 多 owner buildMatchContext(timeline)
 *   → healer/dps metrics → candidateFindings
 * 逐阶段 try/catch;不变量:prompt 非空、无 NaN、时长/时间戳理智、CJK 泄漏。
 * 产物:$GLADLOG_EVAL_HOME/runs/<runId>/fuzz-findings.jsonl + 汇总。
 *
 * Usage: tsx packages/eval/scripts/pipelineFuzz.ts --count 1000 [--run <id>] [--skip-harvest]
 */

import {
  buildMatchContext,
  computeDpsMetrics,
  computeHealerMetrics,
  extractCandidateFindings,
  isHealerSpec,
} from "@gladlog/analysis";
import { downloadLogText, fetchDetailedStubs } from "@gladlog/corpus-tools";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import fs from "fs-extra";
import path from "path";

import { resolveEvalHome } from "../src/evalHome";

const CJK = /[一-鿿぀-ヿ가-힯]/;

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { count: 1000, run: "", skipHarvest: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--count") out.count = Number(a[i + 1]);
    else if (a[i] === "--run") out.run = a[i + 1];
    else if (a[i] === "--skip-harvest") out.skipHarvest = true;
  }
  return out;
}

interface Finding {
  matchId: string;
  stage: string;
  kind: "exception" | "invariant";
  detail: string;
}

async function harvest(dir: string, count: number): Promise<void> {
  await fs.ensureDir(dir);
  const have = new Set(
    (await fs.readdir(dir)).filter((f) => f.endsWith(".txt")),
  );
  if (have.size >= count) {
    console.log(`harvest: already have ${have.size} logs`);
    return;
  }
  // 混合来源轮询:3 个 bracket + 无过滤;不筛 recorder 角色/高级日志
  const queries = [
    { bracket: "3v3" },
    { bracket: "2v2" },
    { bracket: "Rated Solo Shuffle" },
    {},
  ] as Array<{ bracket?: string }>;
  const offsets = new Map<string, number>();
  let kept = have.size;
  let qi = 0;
  while (kept < count) {
    const q = queries[qi % queries.length];
    qi++;
    const key = q.bracket ?? "*";
    const offset = offsets.get(key) ?? 0;
    const { stubs, queryLimitReached } = await fetchDetailedStubs({
      bracket: q.bracket,
      offset,
      count: 50,
    });
    offsets.set(key, offset + 50);
    if (stubs.length === 0 || queryLimitReached) continue;
    for (const stub of stubs) {
      if (kept >= count) break;
      const name = `${stub.id}.txt`;
      if (have.has(name)) continue;
      try {
        const text = await downloadLogText({
          id: stub.id,
          bracket: stub.bracket,
          rating: 0,
          logObjectUrl: stub.logObjectUrl,
        });
        await fs.writeFile(path.join(dir, name), text, "utf-8");
        have.add(name);
        kept++;
        if (kept % 100 === 0) console.log(`harvest: ${kept}/${count}`);
      } catch (e) {
        console.warn(`  skip ${stub.id}: ${String(e).slice(0, 80)}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  console.log(`harvest done: ${kept} logs`);
}

/** 每场审计:多 owner prompt 构建 + 指标 + findings + 不变量。 */
function auditCombat(
  combat: any,
  matchId: string,
  push: (f: Finding) => void,
): void {
  let players: any[] = [];
  const stage = (s: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      push({
        matchId,
        stage: s,
        kind: "exception",
        detail: String((e as Error)?.stack ?? e).slice(0, 400),
      });
    }
  };

  players = (Object.values(combat.units ?? {}) as any[]).filter((u) => u.info);
  if (players.length === 0) {
    push({
      matchId,
      stage: "roster",
      kind: "invariant",
      detail: "no players with info",
    });
    return;
  }
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction !== CombatUnitReaction.Friendly,
  );
  if (friends.length === 0 || enemies.length === 0) {
    push({
      matchId,
      stage: "roster",
      kind: "invariant",
      detail: `one-sided roster f=${friends.length} e=${enemies.length}`,
    });
    return;
  }
  const durS = (combat.endTime - combat.startTime) / 1000;
  if (!(durS > 0 && durS < 3600))
    push({
      matchId,
      stage: "meta",
      kind: "invariant",
      detail: `bad duration ${durS}s`,
    });

  // owner 集:记录者 + 一个治疗 + 一个非治疗(去重,≤3,覆盖两类视角)
  const recorder = friends.find((u) => u.id === combat.playerId);
  const healer = friends.find((u) => isHealerSpec(u.spec));
  const dps = friends.find((u) => !isHealerSpec(u.spec));
  const owners = [...new Set([recorder, healer, dps].filter(Boolean))] as any[];

  for (const owner of owners) {
    const tag = isHealerSpec(owner.spec) ? "healer" : "dps";
    stage(`context:${tag}`, () => {
      const prompt = buildMatchContext(combat, friends, enemies, {
        useTimelinePrompt: true,
        owner,
      });
      if (prompt.length < 500)
        push({
          matchId,
          stage: `context:${tag}`,
          kind: "invariant",
          detail: `prompt too short (${prompt.length})`,
        });
      // CJK 泄漏:玩家名可含非 ASCII(CN/TW realm),按行报并附片段人工分类
      for (const line of prompt.split("\n")) {
        if (CJK.test(line)) {
          push({
            matchId,
            stage: `cjk:${tag}`,
            kind: "invariant",
            detail: line.trim().slice(0, 160),
          });
          break; // 每场每 owner 最多报一行,避免刷屏
        }
      }
    });
    stage(`metrics:${tag}`, () => {
      const m = isHealerSpec(owner.spec)
        ? computeHealerMetrics(combat, owner.name)
        : computeDpsMetrics(combat, owner.name);
      for (const [k, v] of Object.entries(m)) {
        if (typeof v === "number" && !Number.isFinite(v))
          push({
            matchId,
            stage: `metrics:${tag}`,
            kind: "invariant",
            detail: `${k} = ${v}`,
          });
      }
    });
    stage(`findings:${tag}`, () => {
      const evs = extractCandidateFindings(combat, owner.id);
      for (const e of evs) {
        if (!Number.isFinite(e.t) || e.t < 0)
          push({
            matchId,
            stage: `findings:${tag}`,
            kind: "invariant",
            detail: `event ${e.id} bad t=${e.t}`,
          });
      }
    });
  }
}

async function main() {
  const { count, run, skipHarvest } = parseArgs();
  const evalHome = resolveEvalHome();
  const logDir = path.join(evalHome, "corpus", "fuzz-1000");
  const runId = run || "fuzz-1000";
  const outDir = path.join(evalHome, "runs", runId);
  await fs.ensureDir(outDir);

  if (!skipHarvest) await harvest(logDir, count);

  const files = (await fs.readdir(logDir))
    .filter((f) => f.endsWith(".txt"))
    .sort();
  const findings: Finding[] = [];
  const counters = {
    files: 0,
    parseFail: 0,
    matches: 0,
    rounds: 0,
    combatsAudited: 0,
  };

  for (const f of files) {
    counters.files++;
    const matchId = f.replace(".txt", "");
    let text: string;
    try {
      text = await fs.readFile(path.join(logDir, f), "utf-8");
    } catch {
      continue;
    }
    const parser = new GladLogParser();
    const arenas: any[] = [];
    const shuffles: any[] = [];
    parser.on("match", (m: any) => arenas.push(m));
    parser.on("shuffle", (s: any) => shuffles.push(s));
    try {
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch (e) {
      counters.parseFail++;
      findings.push({
        matchId,
        stage: "parse",
        kind: "exception",
        detail: String((e as Error)?.stack ?? e).slice(0, 400),
      });
      continue;
    }
    if (arenas.length + shuffles.length === 0) {
      findings.push({
        matchId,
        stage: "parse",
        kind: "invariant",
        detail: "log produced 0 matches/shuffles",
      });
      continue;
    }
    for (const m of arenas) {
      counters.matches++;
      try {
        const legacy = toLegacyMatch(m);
        counters.combatsAudited++;
        auditCombat(legacy, matchId, (x) => findings.push(x));
      } catch (e) {
        findings.push({
          matchId,
          stage: "toLegacyMatch",
          kind: "exception",
          detail: String((e as Error)?.stack ?? e).slice(0, 400),
        });
      }
    }
    for (const sh of shuffles) {
      try {
        const legacy = toLegacyShuffle(sh);
        for (const round of legacy.rounds ?? []) {
          counters.rounds++;
          counters.combatsAudited++;
          auditCombat(round, `${matchId}#r`, (x) => findings.push(x));
        }
      } catch (e) {
        findings.push({
          matchId,
          stage: "toLegacyShuffle",
          kind: "exception",
          detail: String((e as Error)?.stack ?? e).slice(0, 400),
        });
      }
    }
    if (counters.files % 100 === 0)
      console.log(
        `audit: ${counters.files}/${files.length} files, ${findings.length} findings`,
      );
  }

  await fs.writeFile(
    path.join(outDir, "fuzz-findings.jsonl"),
    findings.map((x) => JSON.stringify(x)).join("\n") + "\n",
    "utf-8",
  );

  // 汇总:按 stage|kind|detail 首 80 字聚类
  const byKey = new Map<string, { n: number; sample: Finding }>();
  for (const x of findings) {
    const key = `${x.stage}|${x.kind}|${x.detail.slice(0, 80)}`;
    const e = byKey.get(key);
    if (e) e.n++;
    else byKey.set(key, { n: 1, sample: x });
  }
  console.log("\n===== SUMMARY =====");
  console.log(JSON.stringify(counters));
  console.log(`findings: ${findings.length} (${byKey.size} distinct)`);
  const sorted = [...byKey.values()].sort((a, b) => b.n - a.n);
  for (const { n, sample } of sorted.slice(0, 40)) {
    console.log(
      `  x${n}  [${sample.stage}/${sample.kind}] ${sample.detail.slice(0, 140)} (e.g. ${sample.matchId})`,
    );
  }
}

void main();
