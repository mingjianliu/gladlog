 
/**
 * CLI: 从 wowarenalogs 公开 API 抓取「记录者是 DPS」的对局原始日志,
 * 作为正式 DPS baseline 的语料(D2 剩余项:真 DPS 视角日志)。
 *
 * 数据源均为公开设计:GraphQL latestMatches(浏览页同款查询)+
 * 公开 GCS 桶按 matchId 下载原始 combat log 文本。串行 + 延时,礼貌抓取。
 *
 * Usage:
 *   tsx packages/eval/scripts/fetchPublicLogs.ts \
 *     --count 60 [--min-rating 1600] [--bracket 3v3] [--out <dir>]
 *
 * 产物:<out>/<matchId>.txt(逐场原始日志)+ <out>/manifest-recorder-dps.txt
 * (可直接喂 buildCorpus --manifest ... --owner recorder)。
 */

import { isHealerSpec } from "@gladlog/analysis";
import { CombatUnitSpec } from "@gladlog/parser-compat";
import fs from "fs-extra";
import path from "path";

import { resolveEvalHome } from "../src/evalHome";

const GRAPHQL_URL = "https://wowarenalogs.com/api/graphql";
const BUCKET_URL =
  "https://storage.googleapis.com/wowarenalogs-log-files-prod/";
const PAGE_SIZE = 50;
const POLITE_DELAY_MS = 300;

interface StubUnit {
  id: string;
  name: string;
  spec: string;
  reaction: number;
}
interface ArenaStub {
  __typename: string;
  id: string;
  playerId: string;
  hasAdvancedLogging: boolean;
  durationInSeconds: number;
  units: StubUnit[];
  startInfo?: { bracket?: string } | null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    count: 60,
    minRating: 0,
    bracket: "" as string,
    out: "",
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count") out.count = Number(args[i + 1]);
    else if (args[i] === "--min-rating") out.minRating = Number(args[i + 1]);
    else if (args[i] === "--bracket") out.bracket = args[i + 1];
    else if (args[i] === "--out") out.out = args[i + 1];
  }
  return out;
}

async function gqlLatestMatches(
  offset: number,
  minRating: number,
  bracket: string,
): Promise<{ combats: ArenaStub[]; queryLimitReached: boolean }> {
  const query = `query ($offset: Int, $minRating: Float, $bracket: String) {
    latestMatches(wowVersion: "retail", offset: $offset, count: ${PAGE_SIZE}, minRating: $minRating, bracket: $bracket) {
      combats {
        __typename
        ... on ArenaMatchDataStub {
          id playerId hasAdvancedLogging durationInSeconds
          startInfo { bracket }
          units { id name spec reaction }
        }
      }
      queryLimitReached
    }
  }`;
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: {
        offset,
        minRating: minRating > 0 ? minRating : null,
        bracket: bracket || null,
      },
    }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: {
      latestMatches?: { combats: ArenaStub[]; queryLimitReached: boolean };
    };
    errors?: unknown[];
  };
  if (!json.data?.latestMatches) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`,
    );
  }
  return json.data.latestMatches;
}

/** 记录者单位是玩家 DPS(非治疗、spec 已知)才收。 */
function recorderIsDps(stub: ArenaStub): boolean {
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
    const page = await gqlLatestMatches(offset, minRating, bracket);
    if (page.combats.length === 0) break;
    for (const stub of page.combats) {
      scanned++;
      if (kept.length >= count) break;
      if (stub.__typename !== "ArenaMatchDataStub") continue; // shuffle 轮次血量/段落语义不同,v1 只收 arena
      if (!stub.hasAdvancedLogging) continue; // 无坐标/HP 采样的场次对门规和回放都是残废
      if (seen.has(stub.id)) continue;
      if (!recorderIsDps(stub)) continue;
      seen.add(stub.id);

      const dest = path.join(outDir, `${stub.id}.txt`);
      if (!(await fs.pathExists(dest))) {
        const res = await fetch(`${BUCKET_URL}${stub.id}`);
        if (!res.ok) {
          console.warn(`  skip ${stub.id}: blob HTTP ${res.status}`);
          continue;
        }
        await fs.writeFile(dest, await res.text(), "utf-8");
        await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
      }
      kept.push(dest);
      const rec = stub.units.find((u) => u.id === stub.playerId);
      console.log(
        `  [${kept.length}/${count}] ${stub.id} recorder spec=${rec?.spec} ${stub.startInfo?.bracket ?? ""} ${stub.durationInSeconds}s`,
      );
    }
    if (page.queryLimitReached) {
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
