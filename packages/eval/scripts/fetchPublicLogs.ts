 
/**
 * CLI: 从 wowarenalogs 公开 API 抓取「记录者是 DPS」的对局原始日志,
 * 作为 DPS baseline 语料(D2 落地;2026-07-16 首批 60 场)。
 *
 * 客户端走 @gladlog/corpus-tools 的共享 feedClient(与 pro 对比语料同一
 * 端点/重试/分页 —— 工具版谓词单源);数据源均为公开设计,串行 + 延时。
 *
 * Usage:
 *   tsx packages/eval/scripts/fetchPublicLogs.ts \
 *     --count 60 [--bracket 3v3 --min-rating 1600] [--out <dir>]
 *   (minRating 是服务端复合索引变量,必须与 --bracket 同传)
 *
 * 产物:<out>/<matchId>.txt(逐场原始日志)+ <out>/manifest-recorder-dps.txt
 * (可直接喂 buildCorpus --manifest ... --owner recorder)。
 */

import { isHealerSpec } from "@gladlog/analysis";
import {
  type DetailedMatchStub,
  downloadLogText,
  fetchDetailedStubs,
} from "@gladlog/corpus-tools";
import { CombatUnitSpec } from "@gladlog/parser-compat";
import fs from "fs-extra";
import path from "path";

import { resolveEvalHome } from "../src/evalHome";

const PAGE_SIZE = 50;
const POLITE_DELAY_MS = 300;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { count: 60, minRating: 0, bracket: "" as string, out: "" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count") out.count = Number(args[i + 1]);
    else if (args[i] === "--min-rating") out.minRating = Number(args[i + 1]);
    else if (args[i] === "--bracket") out.bracket = args[i + 1];
    else if (args[i] === "--out") out.out = args[i + 1];
  }
  return out;
}

/** 记录者单位是玩家 DPS(非治疗、spec 已知)才收。 */
function recorderIsDps(stub: DetailedMatchStub): boolean {
  const rec = stub.units.find((u) => u.id === stub.playerId);
  if (!rec) return false;
  if (!rec.spec || rec.spec === "0") return false;
  return !isHealerSpec(rec.spec as CombatUnitSpec);
}

async function main() {
  const { count, minRating, bracket, out } = parseArgs();
  const evalHome = resolveEvalHome();
  const outDir = out || path.join(evalHome, "corpus", "public-dps");
  await fs.ensureDir(outDir);

  console.log(`Fetching up to ${count} DPS-recorder arena logs → ${outDir}`);
  const kept: string[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let scanned = 0;

  while (kept.length < count) {
    const { stubs, queryLimitReached } = await fetchDetailedStubs({
      bracket: bracket || undefined,
      minRating: minRating > 0 ? minRating : undefined,
      offset,
      count: PAGE_SIZE,
    });
    if (stubs.length === 0) break;
    for (const stub of stubs) {
      scanned++;
      if (kept.length >= count) break;
      if (stub.typename !== "ArenaMatchDataStub") continue; // shuffle 轮次段落语义不同,v1 只收 arena
      if (!stub.hasAdvancedLogging) continue; // 无坐标/HP 的场次对门规和回放都是残废
      if (seen.has(stub.id)) continue;
      if (!recorderIsDps(stub)) continue;
      seen.add(stub.id);

      const dest = path.join(outDir, `${stub.id}.txt`);
      if (!(await fs.pathExists(dest))) {
        try {
          const text = await downloadLogText({
            id: stub.id,
            bracket: stub.bracket,
            rating: minRating,
            logObjectUrl: stub.logObjectUrl,
          });
          await fs.writeFile(dest, text, "utf-8");
        } catch (err) {
          console.warn(`  skip ${stub.id}: ${err}`);
          continue;
        }
        await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
      }
      kept.push(dest);
      const rec = stub.units.find((u) => u.id === stub.playerId);
      console.log(
        `  [${kept.length}/${count}] ${stub.id} recorder spec=${rec?.spec} ${stub.bracket} ${stub.durationInSeconds}s`,
      );
    }
    if (queryLimitReached) {
      console.warn("  queryLimitReached — stopping pagination");
      break;
    }
    offset += PAGE_SIZE;
    await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
  }

  const manifest = path.join(outDir, "manifest-recorder-dps.txt");
  await fs.writeFile(manifest, kept.join("\n") + "\n", "utf-8");
  console.log(
    `\n✓ kept ${kept.length}/${scanned} scanned; manifest: ${manifest}`,
  );
}

void main();
