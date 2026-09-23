/**
 * GH #66 · B1 徽章纪律价值门探针 (Value-Gate Probe).
 *
 * 测量归档与本机库中:
 * 「治疗被硬控 ≥3 秒 + 徽章就绪 + 对面进攻 CD 在手」的发生率,
 * 以及交徽章 vs 坐控 (没交) 的 10s 友方阵亡率与掉血对比。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/trinketDisciplineProbe.ts [--n 300] [--examples 10]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { analyzePlayerCCAndTrinket } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  cdAvailableAt,
  extractMajorCooldowns,
  getUnitHpAtTimestamp,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis/src/utils/cooldowns";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import type { ICombatUnit } from "@gladlog/parser-compat";

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

const pct = (a: number, b: number) =>
  b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`;

interface TrinketSample {
  matchId: string;
  healerName: string;
  healerSpec: string;
  ccSpell: string;
  durationS: number;
  atS: number;
  action: "used" | "held" | "on_cd";
  enemyOffReadyCount: number;
  enemyOffSpells: string[];
  lowestFriendlyHpAtStart: number | null;
  friendlyDiedIn10s: boolean;
  friendlyDiedDuringCc: boolean;
  healerDiedIn10s: boolean;
  lowestFriendlyHpIn10s: number | null;
}

async function main(): Promise<void> {
  const limit = argOf("--n", 100000);
  const nEx = argOf("--examples", 10);
  await ensureAnalysisData();

  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), { minDurationS: 60 }).slice(
    0,
    limit,
  );

  let scannedRounds = 0;
  let healerRounds = 0;
  const samples: TrinketSample[] = [];

  for (const meta of rows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { friends, enemies } = splitTeams(legacy);
    if (friends.length === 0 || enemies.length === 0) continue;
    scannedRounds++;

    // Evaluate both sides from healer's perspective if present
    const sides: [ICombatUnit[], ICombatUnit[]][] = [
      [friends, enemies],
      [enemies, friends],
    ];

    for (const [teamFriends, teamEnemies] of sides) {
      const healers = teamFriends.filter((u) => isHealerSpec(u.spec));
      if (healers.length === 0) continue;
      healerRounds++;

      // Enemy offensive cooldowns in this match
      const enemyMajorCds = teamEnemies
        .flatMap((e) => extractMajorCooldowns(e, legacy))
        .filter((cd) => OFFENSIVE_CD_SPELL_IDS.has(cd.spellId));

      for (const healer of healers) {
        let ccAnalysis;
        try {
          ccAnalysis = analyzePlayerCCAndTrinket(healer, teamEnemies, legacy);
        } catch {
          continue;
        }

        for (const cc of ccAnalysis.ccInstances) {
          // Hard CC >= 3.0 seconds
          if (cc.durationSeconds < 3.0) continue;

          let action: "used" | "held" | "on_cd";
          if (cc.trinketState === "used" || cc.trinketState === "racial_break") {
            action = "used";
          } else if (cc.trinketState === "available_unused") {
            action = "held";
          } else if (cc.trinketState === "on_cooldown") {
            action = "on_cd";
          } else {
            continue; // passive trinket or unknown
          }

          const startMs = legacy.startTime + cc.atSeconds * 1000;
          const endMs = startMs + 10_000;
          const ccEndMs = startMs + cc.durationSeconds * 1000;

          // Which enemy offensive CDs were ready at CC start
          const readyOff = enemyMajorCds.filter((cd) =>
            cdAvailableAt(cd, cc.atSeconds),
          );
          const enemyOffReadyCount = readyOff.length;
          const enemyOffSpells = readyOff.map((cd) => cd.spellName);

          // Outcomes: friendly deaths
          const friendlyDiedIn10s = teamFriends.some((f) =>
            (f.deathRecords ?? []).some(
              (d) => d.timestamp >= startMs && d.timestamp <= endMs,
            ),
          );
          const friendlyDiedDuringCc = teamFriends.some((f) =>
            (f.deathRecords ?? []).some(
              (d) => d.timestamp >= startMs && d.timestamp <= ccEndMs,
            ),
          );
          const healerDiedIn10s = (healer.deathRecords ?? []).some(
            (d) => d.timestamp >= startMs && d.timestamp <= endMs,
          );

          // Lowest friendly HP at CC start
          let lowestFriendlyHpAtStart: number | null = null;
          for (const f of teamFriends) {
            const hp = getUnitHpAtTimestamp(f, startMs, 2000);
            if (hp != null) {
              lowestFriendlyHpAtStart =
                lowestFriendlyHpAtStart == null
                  ? hp
                  : Math.min(lowestFriendlyHpAtStart, hp);
            }
          }

          // Lowest friendly HP within 10s (sample every 1s)
          let lowestFriendlyHpIn10s: number | null = lowestFriendlyHpAtStart;
          for (let step = 1; step <= 10; step++) {
            const tMs = startMs + step * 1000;
            for (const f of teamFriends) {
              const hp = getUnitHpAtTimestamp(f, tMs, 1000);
              if (hp != null) {
                lowestFriendlyHpIn10s =
                  lowestFriendlyHpIn10s == null
                    ? hp
                    : Math.min(lowestFriendlyHpIn10s, hp);
              }
            }
          }

          samples.push({
            matchId: meta.id,
            healerName: healer.name,
            healerSpec: specToString(healer.spec),
            ccSpell: cc.spellName,
            durationS: Math.round(cc.durationSeconds * 10) / 10,
            atS: Math.round(cc.atSeconds * 10) / 10,
            action,
            enemyOffReadyCount,
            enemyOffSpells,
            lowestFriendlyHpAtStart,
            friendlyDiedIn10s,
            friendlyDiedDuringCc,
            healerDiedIn10s,
            lowestFriendlyHpIn10s,
          });
        }
      }
    }
  }

  console.log(`=======================================================`);
  console.log(`GH #66 · B1 徽章纪律测量报告 (Trinket Discipline Probe)`);
  console.log(`=======================================================`);
  console.log(`扫描对局数:          ${scannedRounds}`);
  console.log(`有效治疗视角数:      ${healerRounds}`);
  console.log(`治疗被硬控 ≥3s 样本: ${samples.length}`);

  // Summary by Action
  console.log(`\n--- 1. 全体样本动作分布 ---`);
  for (const act of ["used", "held", "on_cd"] as const) {
    const subset = samples.filter((s) => s.action === act);
    const deaths10 = subset.filter((s) => s.friendlyDiedIn10s).length;
    const deathsCc = subset.filter((s) => s.friendlyDiedDuringCc).length;
    console.log(
      `  [${act.toUpperCase().padEnd(7)}] 样本数: ${String(subset.length).padStart(4)} (${pct(subset.length, samples.length)}) | 10s 内友方阵亡率: ${pct(deaths10, subset.length).padStart(6)} | 控期友方阵亡率: ${pct(deathsCc, subset.length).padStart(6)}`,
    );
  }

  // Focus: When Enemy has Offensive CDs Ready (The proposed accusation gate)
  const withEnemyOff = samples.filter((s) => s.enemyOffReadyCount > 0);
  const withoutEnemyOff = samples.filter((s) => s.enemyOffReadyCount === 0);

  console.log(`\n--- 2. 核心门槛对照: 敌方有进攻 CD 在手 (n=${withEnemyOff.length}) vs 无 (n=${withoutEnemyOff.length}) ---`);
  console.log(`A. 当敌方【有】进攻 CD 在手:`);
  for (const act of ["used", "held", "on_cd"] as const) {
    const subset = withEnemyOff.filter((s) => s.action === act);
    const deaths10 = subset.filter((s) => s.friendlyDiedIn10s).length;
    const deathsCc = subset.filter((s) => s.friendlyDiedDuringCc).length;
    console.log(
      `   ${act.toUpperCase().padEnd(7)}: ${String(subset.length).padStart(4)} 条 | 10s 友方阵亡: ${String(deaths10).padStart(3)} (${pct(deaths10, subset.length).padStart(5)}) | 控期阵亡: ${String(deathsCc).padStart(3)} (${pct(deathsCc, subset.length).padStart(5)})`,
    );
  }

  console.log(`\nB. 当敌方【无】进攻 CD 在手 (对照组):`);
  for (const act of ["used", "held", "on_cd"] as const) {
    const subset = withoutEnemyOff.filter((s) => s.action === act);
    const deaths10 = subset.filter((s) => s.friendlyDiedIn10s).length;
    const deathsCc = subset.filter((s) => s.friendlyDiedDuringCc).length;
    console.log(
      `   ${act.toUpperCase().padEnd(7)}: ${String(subset.length).padStart(4)} 条 | 10s 友方阵亡: ${String(deaths10).padStart(3)} (${pct(deaths10, subset.length).padStart(5)}) | 控期阵亡: ${String(deathsCc).padStart(3)} (${pct(deathsCc, subset.length).padStart(5)})`,
    );
  }

  // Cross-Stratification: Enemy Off CD Ready AND Team HP < 50%
  console.log(`\n--- 3. 极危细分: 敌方有进攻 CD + 己方最低血量 < 50% ---`);
  const dangerSubset = withEnemyOff.filter(
    (s) => s.lowestFriendlyHpAtStart != null && s.lowestFriendlyHpAtStart < 50,
  );
  console.log(`样本总数: ${dangerSubset.length}`);
  for (const act of ["used", "held", "on_cd"] as const) {
    const sub = dangerSubset.filter((s) => s.action === act);
    const deaths10 = sub.filter((s) => s.friendlyDiedIn10s).length;
    const deathsCc = sub.filter((s) => s.friendlyDiedDuringCc).length;
    console.log(
      `   ${act.toUpperCase().padEnd(7)}: ${String(sub.length).padStart(3)} 条 | 10s 友方阵亡: ${String(deaths10).padStart(2)} (${pct(deaths10, sub.length).padStart(5)}) | 控期阵亡: ${String(deathsCc).padStart(2)} (${pct(deathsCc, sub.length).padStart(5)})`,
    );
  }

  // Examples: The candidate cases where coach would accuse "held trinket with enemy burst ready"
  console.log(`\n--- 4. 真实比赛案例 (Held Trinket while Enemy Off CD Ready) ---`);
  const heldWithOff = withEnemyOff.filter((s) => s.action === "held");
  for (const s of heldWithOff.slice(0, nEx)) {
    console.log(
      `  [${s.matchId}] ${s.healerSpec} ${s.healerName} @ ${s.atS}s ate ${s.ccSpell} (${s.durationS}s) | 敌方就绪大招: [${s.enemyOffSpells.join(", ")}] | 己方开局血: ${s.lowestFriendlyHpAtStart ?? "?"}% -> 10s最低: ${s.lowestFriendlyHpIn10s ?? "?"}% | 10s阵亡: ${s.friendlyDiedIn10s ? "YES ⚠" : "no"}`,
    );
  }
}

void main();
