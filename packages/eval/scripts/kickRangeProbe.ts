/**
 * kick-eaten 位置事实的**可行性探针**(go/no-go),不是产品代码。
 *
 * 由来(2026-09-06,§五 第 2 项实测):`kick-eaten` 的图例写 "Coach fake-casting /
 * juking the kick",而 21 条教练目标句里这一类的 9 条中有 **6 条在教站位与打断
 * 距离**(「站在敌人头上读条」「往右挪就出了 DK 的踢技距离」「三个人都能打断」)。
 * 现有事实(被断法术 / 踢技 / 来源 / 锁定时长 / postKick)里没有位置。
 *
 * 本脚本只回答动工前必须先答的两个问题,**不产出任何产品判据**:
 *   Q1 位置取得到吗 —— 在**读条开始**那一刻(决策时刻,不是被打断那一刻)
 *      能不能同时拿到自己和打断者的位置?取不到就整条路不通。
 *   Q2 各踢技的实际射程是多少 —— 用打断发生瞬间的实测距离分布反推,
 *      与官方 DB2 `SpellRange` 对照(生成器目前**不发射**该字段,见下)。
 *
 * 为什么要 Q2:`KICK_LOCKOUT_OBSERVED`(语料观测生成)有锁定时长但没有射程,
 * `spellEffectGenerated.json` 也没有 range 字段。按用户 2026-09-04 的裁定
 * 「官方 DB2 优先、语料实测做验证门」,正路是给 genSpellEffects 加 SpellRange
 * 再用本脚本的分布验收 —— 那是 update-wow-data 管线的改动,**尚未做**。
 *
 * 三态纪律:`advancedActions` 稀疏(待机/潜行的单位不产生采样),
 * `getUnitPositionAtTime` 传 maxGapMs 后会返回 null 而不是编一个内插点。
 * 取不到就计入 unknown,**绝不当作「离得远」**。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/kickRangeProbe.ts [--n 400] [--gap 1500]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { analyzePlayerCCAndTrinket } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  distanceBetween,
  getUnitPositionAtTime,
} from "@gladlog/analysis/src/utils/losAnalysis";
import { INTERP_MAX_GAP_MS } from "@gladlog/analysis/src/utils/positionSampling";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";

function argOf(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

function pct(a: number, b: number): string {
  return b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`;
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

async function main(): Promise<void> {
  const limit = argOf("--n", 400);
  const gap = argOf("--gap", INTERP_MAX_GAP_MS);
  await ensureAnalysisData();
  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), { minDurationS: 60 }).slice(
    0,
    limit,
  );

  let kicks = 0;
  let haveCastStart = 0;
  let bothPosAtCastStart = 0;
  let bothPosAtKick = 0;
  const byKick = new Map<string, number[]>();

  for (const meta of rows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { enemies, owner } = splitTeams(legacy);
    if (!owner) continue;
    let summary;
    try {
      summary = analyzePlayerCCAndTrinket(owner, enemies, legacy, []);
    } catch {
      continue;
    }
    const startMs = legacy.startTime;
    const casterStarts = (
      owner as { castStartEvents?: Array<{ spellId?: string; logLine: { timestamp: number } }> }
    ).castStartEvents ?? [];

    for (const inst of summary.interruptInstances) {
      kicks++;
      const src = enemies.find((e) => e.name === inst.sourceName);
      if (!src) continue;
      const kickMs = startMs + inst.atSeconds * 1000;

      // Decision instant = the cast bar the kick landed on. Match by the
      // interrupted spell id, latest start at or before the interrupt.
      const cs = casterStarts
        .filter(
          (e) =>
            e.spellId === inst.interruptedSpellId &&
            e.logLine.timestamp <= kickMs &&
            kickMs - e.logLine.timestamp <= 8000,
        )
        .sort((a, b) => b.logLine.timestamp - a.logLine.timestamp)[0];
      if (cs) haveCastStart++;

      const oAtKick = getUnitPositionAtTime(owner, kickMs, gap);
      const sAtKick = getUnitPositionAtTime(src, kickMs, gap);
      if (oAtKick && sAtKick) {
        bothPosAtKick++;
        const d = distanceBetween(oAtKick, sAtKick);
        const key = `${inst.kickSpellName} (${inst.kickSpellId})`;
        byKick.set(key, [...(byKick.get(key) ?? []), d]);
      }
      if (cs) {
        const t = cs.logLine.timestamp;
        if (getUnitPositionAtTime(owner, t, gap) && getUnitPositionAtTime(src, t, gap))
          bothPosAtCastStart++;
      }
    }
  }

  console.log(`rounds scanned                 ${rows.length}`);
  console.log(`interrupt instances            ${kicks}`);
  console.log(
    `  matched to a SPELL_CAST_START ${haveCastStart}  (${pct(haveCastStart, kicks)})  <- Q1: the decision instant`,
  );
  console.log(
    `  both positions @ cast start   ${bothPosAtCastStart}  (${pct(bothPosAtCastStart, kicks)})`,
  );
  console.log(
    `  both positions @ kick instant ${bothPosAtKick}  (${pct(bothPosAtKick, kicks)})`,
  );
  console.log(`  (maxGapMs=${gap}; a null position is UNKNOWN, never "far away")`);

  console.log(
    `\nQ2 — observed distance at the interrupt instant, per kick (yards):`,
  );
  console.log(
    `  ${"kick".padEnd(30)} ${"n".padStart(5)} ${"p50".padStart(6)} ${"p90".padStart(6)} ${"p99".padStart(6)}`,
  );
  for (const [k, ds] of [...byKick].sort((a, b) => b[1].length - a[1].length)) {
    if (ds.length < 10) continue;
    // No "looks like melee/ranged" column on purpose: the first draft had one
    // and it mislabelled Kick (p99 9.1) and Rebuke (p99 11.6) — both 5 yd
    // melee — because a fixed threshold cannot absorb interpolation error.
    // Read the percentiles against the OFFICIAL range; do not classify here.
    console.log(
      `  ${k.slice(0, 30).padEnd(30)} ${String(ds.length).padStart(5)} ${quantile(ds, 0.5).toFixed(1).padStart(6)} ${quantile(ds, 0.9).toFixed(1).padStart(6)} ${quantile(ds, 0.99).toFixed(1).padStart(6)}`,
    );
  }
}

void main();
