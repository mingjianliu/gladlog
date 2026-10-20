/** discriminationScan.ts — 候选类型触发率×胜负判别力扫描(常驻,2026-08-20
 * 从 zz-tmp 转正 —— grounding-audit §F.3 与 GH #14 治理规矩的执行工具)。
 *
 * 复现 grounding-audit §C 的口径:对每个 healer-owner 回合调生产的
 * extractCandidateFindings,按 legacy.result(Lose=2/Win=3)分组,输出
 * 逐类「至少触发一次」的回合比例与胜负差(pp)。>50% 触发的类型按 #14
 * 规矩必须另有机会归一化判别力证据 —— 本工具只测发生率口径,**只能证伪
 * 不能证实**(§F.3 原文),不要单独用它砍类型。
 *
 * 数据源(可组合):
 *   --store [dir]        自有对局库(缺省 DEFAULT_MATCH_DIR),loadIndex 遍历
 *   --since <ISO|epochMs> 只取 startTime ≥ 该时刻的场次(时代门,如 12.1
 *                         go-live;PATCH_121_GOLIVE_EPOCH_MS = 2026-08-11T22Z)
 *   --last <n>           只取库尾部 n 场(§C 传统口径 n=300)
 *   --downloads <dir...> wowarenalogs 下载目录(GladLogParser 现场解析;
 *                         用 manifest.startTime 做同一个 --since 时代门;
 *                         胜负 = winningTeamId vs owner teamId)
 *
 * 用法示例:
 *   npx tsx packages/eval/scripts/discriminationScan.ts --store --last 300
 *   npx tsx packages/eval/scripts/discriminationScan.ts --store --since 2026-08-11T22:00:00Z \
 *     --downloads $GLADLOG_EVAL_HOME/downloads/RatedSoloShuffle-r2100-recorder-*
 * (单进程;全库扫描一次只跑一个 —— 32GB 机器扛不住并行。)
 */
import { existsSync, readdirSync,readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ensureAnalysisData,
  extractCandidateFindings,
  isHealerSpec,
} from "@gladlog/analysis";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  splitTeams,
} from "../src/explore/storeAccess";

const LOSE = 2;
const WIN = 3;

const argv = process.argv.slice(2);
function flagValues(flag: string): string[] {
  const i = argv.indexOf(flag);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j]!.startsWith("--"); j++)
    out.push(argv[j]!);
  return out;
}
const useStore = argv.includes("--store");
const storeDir = flagValues("--store")[0] ?? DEFAULT_MATCH_DIR;
const sinceArg = flagValues("--since")[0];
const sinceMs = sinceArg
  ? /^\d+$/.test(sinceArg)
    ? Number(sinceArg)
    : Date.parse(sinceArg)
  : 0;
const lastN = Number(flagValues("--last")[0] ?? 0);
const downloadDirs = flagValues("--downloads");
if (!useStore && downloadDirs.length === 0) {
  console.error(
    "usage: discriminationScan --store [dir] | --downloads <dir...> [--since t] [--last n]",
  );
  process.exit(1);
}

await ensureAnalysisData();

interface Tally {
  rounds: number;
  triggered: Map<string, number>;
}
const mk = (): Tally => ({ rounds: 0, triggered: new Map() });
const tallies = { win: mk(), loss: mk() };
let otherRounds = 0;
let matches = 0;

function tallyRound(legacy: any, owner: any, isWin: boolean | null): void {
  if (isWin === null) {
    otherRounds++;
    return;
  }
  const t = isWin ? tallies.win : tallies.loss;
  t.rounds++;
  try {
    const seen = new Set(
      extractCandidateFindings(legacy, owner.id).map((c) => c.type),
    );
    for (const ty of seen) t.triggered.set(ty, (t.triggered.get(ty) ?? 0) + 1);
  } catch {
    /* 候选不可算,回合仍计入分母 */
  }
}

if (useStore) {
  let rows = loadIndex(storeDir);
  if (sinceMs > 0)
    rows = rows.filter((r: any) => (r.startTime ?? 0) >= sinceMs);
  if (lastN > 0) rows = rows.slice(-lastN);
  for (const row of rows) {
    const roundInfos: any[] = [];
    try {
      const first = loadLegacyRound(storeDir, row.id, 0);
      if (first.kind === "shuffle") {
        roundInfos.push(first.legacy);
        for (let i = 1; i < 12; i++) {
          try {
            roundInfos.push(loadLegacyRound(storeDir, row.id, i).legacy);
          } catch {
            break;
          }
        }
      } else {
        roundInfos.push(first.legacy);
      }
    } catch {
      continue;
    }
    matches++;
    for (const legacy of roundInfos) {
      const { friends, enemies } = splitTeams(legacy);
      const owner = friends.find((u) => isHealerSpec(u.spec));
      if (!owner || enemies.length === 0) continue;
      const isWin =
        legacy.result === WIN ? true : legacy.result === LOSE ? false : null;
      tallyRound(legacy, owner, isWin);
    }
  }
}

for (const dir of downloadDirs) {
  const eraById = new Map<string, number>();
  const manifestPath = join(dir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      for (const m of JSON.parse(readFileSync(manifestPath, "utf8")))
        eraById.set(m.fileName ?? `${m.id}.txt`, m.startTime ?? 0);
    } catch {
      /* manifest 坏 → 无时代门 */
    }
  }
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".txt")) continue;
    if (sinceMs > 0 && (eraById.get(f) ?? 0) < sinceMs) continue;
    let text: string;
    try {
      text = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => {
        for (const round of toLegacyShuffle(sh).rounds ?? [])
          combats.push(round);
      });
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    matches++;
    for (const legacy of combats) {
      const units: any[] = Object.values(legacy.units ?? {});
      const players = units.filter((u) => u.info);
      const owner = players.find(
        (u) =>
          isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
      );
      if (!owner) continue;
      const winningTeamId = legacy.winningTeamId;
      const ownerTeamId = owner.info?.teamId;
      const isWin =
        winningTeamId != null && ownerTeamId != null
          ? String(winningTeamId) === String(ownerTeamId)
          : null;
      tallyRound(legacy, owner, isWin);
    }
  }
}

const w = tallies.win;
const l = tallies.loss;
console.log(
  `matches=${matches} healer-owner rounds: win=${w.rounds} loss=${l.rounds} other=${otherRounds}` +
    (sinceMs > 0 ? ` since=${new Date(sinceMs).toISOString()}` : ""),
);
const allTypes = new Set([...w.triggered.keys(), ...l.triggered.keys()]);
const rows2 = [...allTypes].map((ty) => {
  const wp = w.rounds > 0 ? (100 * (w.triggered.get(ty) ?? 0)) / w.rounds : 0;
  const lp = l.rounds > 0 ? (100 * (l.triggered.get(ty) ?? 0)) / l.rounds : 0;
  return { ty, wp, lp, d: lp - wp };
});
rows2.sort((a, b) => b.d - a.d);
console.log(`type | win% | loss% | diff(pp)`);
for (const r of rows2)
  console.log(
    `${r.ty} | ${r.wp.toFixed(1)} | ${r.lp.toFixed(1)} | ${r.d >= 0 ? "+" : ""}${r.d.toFixed(1)}`,
  );
