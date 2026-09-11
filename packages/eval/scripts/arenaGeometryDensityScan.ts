/**
 * GH #83 —— 竞技场几何「可重新校准吗」的可行性数:每张图有多少位置采样。
 *
 * 背景:arenaGeometry.ts 覆盖全部 16 张图(2026-09-11 已订正,不是 5 张),但各图
 * 的**校准质量**不一:纳格兰用 617k 采样的 void 分析重定位过柱子;卢恩德龙中央墓
 * 是 2D 模型表达不了的可行走高台;刀锋山/黑鸦堡/钩点没有任何校准记录。
 * void 分析法需要大量采样 —— 本脚本回答「本地归档够不够,还是得拉 Drive 上那
 * 68,153 场」。
 *
 * 读的是 $GLADLOG_EVAL_HOME/corpus/archive-gz 的 manifest(默认 2026-08-28 那份,
 * 18,134 行),逐场解析,按 zoneId 累计 advancedActions 采样数。只数,不校准。
 *
 * 用法: npx tsx packages/eval/scripts/arenaGeometryDensityScan.ts [--manifest <path>] [--every 10]
 *   --every N 只读每第 N 场(默认 10,约 1,800 场,几分钟);要全量传 1。
 */
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

import { parseLogCombats } from "../src/corpus/candidateMenu";

const EVAL_HOME = process.env.GLADLOG_EVAL_HOME ?? `${process.env.HOME}/code/gladlog-eval-private`;
const DEFAULT_MANIFEST = `${EVAL_HOME}/corpus/manifest-archive-2026-08-28-newseason.txt`;

function argStr(flag: string, dflt: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}
function argNum(flag: string, dflt: number): number {
  const v = Number(argStr(flag, String(dflt)));
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

const ZONE_NAME: Record<string, string> = {
  "572": "Ruins of Lordaeron", "617": "Dalaran Sewers", "980": "Tol'viron", "1134": "Tiger's Peak",
  "1504": "Black Rook Hold", "1505": "Nagrand", "1552": "Ashamane's Fall", "1672": "Blade's Edge",
  "1825": "Hook Point", "1911": "Mugambala", "2167": "Robodrome", "2373": "Empyrean Domain",
  "2509": "Maldraxxus", "2547": "Enigma Crucible", "2563": "Nokhudon", "2759": "Cage of Carnage",
};

function main(): void {
  const manifest = argStr("--manifest", DEFAULT_MANIFEST);
  const every = argNum("--every", 10);
  const files = readFileSync(manifest, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const picked = files.filter((_, i) => i % every === 0);
  console.log(`manifest ${manifest}\n  ${files.length} files, reading every ${every} -> ${picked.length}`);

  const byZone = new Map<string, { rounds: number; samples: number; unitsWithSamples: number; units: number }>();
  let parsed = 0, failed = 0;
  for (const f of picked) {
    let text: string;
    try { text = gunzipSync(readFileSync(f)).toString("utf8"); } catch { failed++; continue; }
    let combats;
    try { combats = parseLogCombats(text); } catch { failed++; continue; }
    for (const { legacy } of combats) {
      parsed++;
      const z = String((legacy as { startInfo?: { zoneId?: string } }).startInfo?.zoneId ?? "?");
      const row = byZone.get(z) ?? { rounds: 0, samples: 0, unitsWithSamples: 0, units: 0 };
      row.rounds++;
      for (const u of Object.values(legacy.units) as Array<{ advancedActions?: unknown[] }>) {
        row.units++;
        const n = u.advancedActions?.length ?? 0;
        row.samples += n;
        if (n > 0) row.unitsWithSamples++;
      }
      byZone.set(z, row);
    }
  }
  console.log(`parsed ${parsed} rounds, ${failed} files failed\n`);
  console.log(`${"zone".padEnd(5)} ${"arena".padEnd(20)} ${"rounds".padStart(6)} ${"pos samples".padStart(12)} ${"samples/round".padStart(13)}  ${"units w/ pos".padStart(12)}`);
  const rows = [...byZone].sort((a, b) => b[1].samples - a[1].samples);
  let total = 0;
  for (const [z, r] of rows) {
    total += r.samples;
    console.log(`${z.padEnd(5)} ${(ZONE_NAME[z] ?? "?").padEnd(20)} ${String(r.rounds).padStart(6)} ${String(r.samples).padStart(12)} ${(r.samples / Math.max(r.rounds, 1)).toFixed(0).padStart(13)}  ${pctStr(r.unitsWithSamples, r.units).padStart(12)}`);
  }
  console.log(`\ntotal position samples in this slice: ${total}  (scale by --every for the full manifest)`);
  console.log(`reference: Nagrand's recentring used 617k samples over a 790-log corpus; Tiger's Peak's rebuild 810k over 75 logs.`);
}
function pctStr(a: number, b: number): string { return b === 0 ? "n/a" : `${((a / b) * 100).toFixed(0)}%`; }
main();
