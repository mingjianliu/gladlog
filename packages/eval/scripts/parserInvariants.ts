/* eslint-disable no-console */
/**
 * A2 parser 不变量的全量语料扫描门(可验证性路线图)。
 *
 * 对 manifest 里每个日志:完整解析 → 对每场(含 shuffle 每轮)跑
 * checkParserInvariants,按断言码聚合。measure-then-lock:任何违规
 * 非零即退出码 1 —— 要么修 parser,要么把该断言从不变量降级并写明理由。
 *
 * Usage:
 *   npx tsx packages/eval/scripts/parserInvariants.ts --manifest <file>
 */

import fs from "fs-extra";

import {
  checkParserInvariants,
  GladLogParser,
  type GladMatchBase,
} from "@gladlog/parser";

function parseArgs(): { manifest: string } {
  const args = process.argv.slice(2);
  let manifest = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest") manifest = args[i + 1] ?? "";
  }
  if (!manifest) {
    console.error("Error: --manifest <file> is required");
    process.exit(1);
  }
  return { manifest };
}

async function main() {
  const { manifest } = parseArgs();
  const logPaths = (await fs.readFile(manifest, "utf-8"))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const byCode = new Map<string, { count: number; samples: string[] }>();
  let combats = 0;
  let violatingCombats = 0;

  const record = (label: string, m: GladMatchBase) => {
    combats++;
    const violations = checkParserInvariants(m);
    if (violations.length === 0) return;
    violatingCombats++;
    for (const v of violations) {
      const agg = byCode.get(v.code) ?? { count: 0, samples: [] };
      agg.count++;
      if (agg.samples.length < 5)
        agg.samples.push(`${label} ${v.unitId ?? ""}: ${v.detail}`);
      byCode.set(v.code, agg);
    }
  };

  for (const logPath of logPaths) {
    const content = await fs.readFile(logPath, "utf-8");
    const parser = new GladLogParser();
    parser.on("match", (m) => record(m.id, m));
    parser.on("shuffle", (s) => {
      for (const r of s.rounds) record(`${r.id}#r${r.sequenceNumber}`, r);
    });
    for (const line of content.split("\n")) parser.push(line);
    parser.end();
  }

  console.log(
    `A2 parser invariants — ${combats} combats from ${logPaths.length} logs`,
  );
  if (byCode.size === 0) {
    console.log("零违规:全部物性断言在全语料成立。");
    return;
  }
  console.log(`违规场次:${violatingCombats}/${combats}`);
  for (const [code, agg] of [...byCode.entries()].sort()) {
    console.log(`\n[${code}] ×${agg.count}`);
    for (const s of agg.samples) console.log(`  ${s}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
