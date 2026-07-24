/* eslint-disable no-console */
/**
 * A3 fixture-coverage corpus(可验证性路线图):从全量日志里策展一个
 * **最小覆盖集**,冻结为 golden 语料 —— 覆盖维度:
 *   - 每个治疗专精(己方或敌方出现即算);
 *   - 每种赛制(2v2 / 3v3 / Rated Solo Shuffle …);
 *   - 边角形态:含宠物、含 shuffle、含 unconscious(假死/濒死)、CRLF 行尾、
 *     无 advanced logging(若语料里存在)。
 * 产物:
 *   $GLADLOG_EVAL_HOME/corpus/manifest-coverage.txt(贪心最小日志集)
 *   $GLADLOG_EVAL_HOME/corpus/coverage-report.json(哪个日志盖了哪些维度)
 * 用法:
 *   npx tsx packages/eval/scripts/coverageCorpus.ts --manifest <full-manifest>
 * 校验模式(golden 防漂移;A2 不变量门也应对该 manifest 常跑):
 *   npx tsx packages/eval/scripts/coverageCorpus.ts --manifest <...> --check
 */

import fs from "fs-extra";
import path from "path";

import { isHealerSpec, specToString } from "@gladlog/analysis";
import type { CombatUnitSpec } from "@gladlog/parser-compat";
import { GladLogParser, type GladMatchBase } from "@gladlog/parser";

import { resolveEvalHome } from "../src/evalHome";

function parseArgs(): { manifest: string; check: boolean } {
  const args = process.argv.slice(2);
  let manifest = "";
  let check = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest") manifest = args[i + 1] ?? "";
    if (args[i] === "--check") check = true;
  }
  if (!manifest) {
    console.error("Error: --manifest <file> is required");
    process.exit(1);
  }
  return { manifest, check };
}

async function coverageOf(logPath: string): Promise<Set<string>> {
  const content = await fs.readFile(logPath, "utf-8");
  const facts = new Set<string>();
  if (content.includes("\r\n")) facts.add("edge:crlf");

  const scan = (m: GladMatchBase) => {
    facts.add(`bracket:${m.bracket}`);
    if (!m.hasAdvancedLogging) facts.add("edge:no-advanced");
    for (const u of Object.values(m.units)) {
      if (u.kind === "Pet" || u.kind === "Guardian") facts.add("edge:pets");
      if ((u.unconsciousEvents ?? []).length > 0) facts.add("edge:unconscious");
      // CombatUnitSpec 的枚举值就是字符串化的 specId('264' 等)
      const spec = String(u.specId) as CombatUnitSpec;
      if (u.info && isHealerSpec(spec)) {
        facts.add(`healer:${specToString(spec)}`);
      }
    }
  };
  const parser = new GladLogParser();
  parser.on("match", scan);
  parser.on("shuffle", (s) => {
    facts.add("edge:shuffle");
    s.rounds.forEach(scan);
  });
  for (const line of content.split("\n")) parser.push(line);
  parser.end();
  return facts;
}

async function main() {
  const { manifest, check } = parseArgs();
  const evalHome = resolveEvalHome();
  const outManifest = path.join(evalHome, "corpus", "manifest-coverage.txt");
  const outReport = path.join(evalHome, "corpus", "coverage-report.json");

  const logPaths = (await fs.readFile(manifest, "utf-8"))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  console.log(`Scanning ${logPaths.length} logs for coverage facts…`);
  const perLog = new Map<string, Set<string>>();
  for (const p of logPaths) perLog.set(p, await coverageOf(p));

  const universe = new Set<string>();
  for (const s of perLog.values()) for (const f of s) universe.add(f);

  if (check) {
    // golden 防漂移:现有 manifest-coverage 必须仍覆盖当前全集
    const chosen = (await fs.readFile(outManifest, "utf-8"))
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const covered = new Set<string>();
    for (const p of chosen)
      for (const f of perLog.get(p) ?? (await coverageOf(p))) covered.add(f);
    const missing = [...universe].filter((f) => !covered.has(f));
    if (missing.length > 0) {
      console.error(
        `覆盖集漂移:全量语料出现了 golden 集未覆盖的维度 → ${missing.join(", ")}\n重跑本脚本(无 --check)重新策展。`,
      );
      process.exit(1);
    }
    console.log(
      `覆盖集完好:${chosen.length} 个日志仍覆盖全部 ${universe.size} 个维度。`,
    );
    return;
  }

  // 贪心集合覆盖:每轮选新增覆盖最多的日志
  const remaining = new Set(universe);
  const chosen: string[] = [];
  while (remaining.size > 0) {
    let best: string | null = null;
    let bestGain = 0;
    for (const [p, facts] of perLog) {
      if (chosen.includes(p)) continue;
      const gain = [...facts].filter((f) => remaining.has(f)).length;
      if (gain > bestGain) {
        bestGain = gain;
        best = p;
      }
    }
    if (!best) break; // 不可覆盖的维度(不该发生:universe 来自 perLog)
    chosen.push(best);
    for (const f of perLog.get(best)!) remaining.delete(f);
  }

  await fs.writeFile(outManifest, chosen.join("\n") + "\n", "utf-8");
  await fs.writeJson(
    outReport,
    {
      generatedFrom: manifest,
      universe: [...universe].sort(),
      chosen: chosen.map((p) => ({
        log: p,
        covers: [...perLog.get(p)!].sort(),
      })),
    },
    { spaces: 1 },
  );

  console.log(
    `覆盖维度 ${universe.size} 个,最小集 ${chosen.length} 个日志(全量 ${logPaths.length})。`,
  );
  console.log(`维度全集:${[...universe].sort().join(", ")}`);
  console.log(`写入 ${outManifest} 与 ${outReport}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
