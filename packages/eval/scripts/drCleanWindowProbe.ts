/**
 * GH #67 · S2「递减到期了你没利用」的**价值门探针**(2026-09-11)。不是产品判据。
 *
 * 由来:`dr-tracking` 簇 69 条教练判决读下来是三种形状,退役的 `dr-clipped-cc`
 * 只覆盖其中 S1(把控制打进递减,28 条 / 41%)。第二大块 S2(23 条 / 33%)方向
 * 相反、且**零覆盖** —— 不是「你打进了递减」,是「目标是干净的,你让窗口烂掉了」:
 *
 *   「敌人从 :56 一直到 :28 都不在递减上,将近两整个递减周期被白白扔掉」
 *   「别让敌人脱离递减超过五秒」
 *   「敌人一脱离晕递减,你就该已经知道下一波怎么开,两秒内落地」
 *
 * 本脚本量的就是那句话:**某敌人对某 DR 类别处于 `Full`(干净)、我方该类别硬控
 * 有可用、却一直没有落控的连续时长。** 教练给的量化锚是 ~5s 和一次 28s。
 *
 * 不重写判据(CLAUDE.md 共享谓词规则):DR 状态取 production 的
 * `buildCcCategoryHistory` + `getDRLevelAtTime`(含 12.1 的 20s 重置窗切换),
 * 类别成员取 `drCategoryIds`,冷却可用性取 `cdAvailableAt` —— 与
 * `unsyncedBurstEvents` 的可行性门同一个函数、同一种用法。
 *
 * **可行性门(价值门第 3 条)已内建**:窗口只在「我方确实有该类别硬控可用」时
 * 才计数。没有控制可用的干净窗口不是学生的错,不计 —— 这正是 cc-avoidable 加门
 * (−68%)和 unsyncedBurst 的 teamCcReadyAt 的同一条纪律。
 *
 * **它不足以支持上线任何东西。** 这是价值门要的「真实对局输出例子」那一步:
 * 先看这个量在真语料上长什么样、有没有区分度,再谈形态。已知风险:S2 与
 * flag-false 的 `cc-held`(「自己的控制大招可用却攥着」)形状接近,动工前必须
 * 先证明它不是那个的换皮 —— GH #50 的下架理由照样适用。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/drCleanWindowProbe.ts [--n 300] [--min 5] [--examples 8]
 */
import {
  cdAvailableAt,
  ensureAnalysisData,
  extractMajorCooldowns,
  isHealerSpec,
} from "@gladlog/analysis";
import {
  buildCcCategoryHistory,
  drCategoryIds,
  getDRLevelAtTime,
  STUN_DR_CATEGORY,
} from "@gladlog/analysis/src/utils/drAnalysis";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";

/** Sampling step for the clean/dirty sweep. 1 s matches the prompt's render
 * grid (`fmtTime` floors to whole seconds), so a window measured here can be
 * cited without re-anchoring. */
const STEP_S = 1;

function argOf(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

interface Window {
  matchId: string;
  enemy: string;
  isHealer: boolean;
  fromS: number;
  toS: number;
  durS: number;
  readyCds: string[];
}

async function main(): Promise<void> {
  const limit = argOf("--n", 300);
  const minS = argOf("--min", 5);
  const nEx = argOf("--examples", 8);
  await ensureAnalysisData();
  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), { minDurationS: 60 }).slice(
    0,
    limit,
  );

  const stunIds = drCategoryIds(STUN_DR_CATEGORY);
  const all: Window[] = [];
  let rounds = 0;
  let roundsWithAnyStunCd = 0;

  for (const meta of rows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { friends, enemies, owner } = splitTeams(legacy);
    if (!owner || enemies.length === 0) continue;
    rounds++;

    // Team's own stun-category majors — same construction unsyncedBurstEvents
    // uses for its feasibility gate, narrowed to this DR category.
    const teamStunCds: Array<{ cd: ReturnType<typeof extractMajorCooldowns>[number]; who: string }> = [];
    for (const f of friends) {
      try {
        for (const cd of extractMajorCooldowns(f, legacy))
          if (stunIds.has(cd.spellId)) teamStunCds.push({ cd, who: f.name ?? "?" });
      } catch {
        /* this friend's ledger not computable → their CC absent, not assumed ready */
      }
    }
    if (teamStunCds.length === 0) continue;
    roundsWithAnyStunCd++;

    const friendIds = new Set(friends.map((f) => f.id));
    const durS = Math.max(0, (legacy.endTime - legacy.startTime) / 1000);

    for (const e of enemies) {
      const hist = buildCcCategoryHistory(
        e,
        STUN_DR_CATEGORY,
        friendIds,
        legacy.startTime,
      );
      let openFrom: number | null = null;
      let openCds: string[] = [];
      for (let t = 0; t <= durS; t += STEP_S) {
        const clean =
          getDRLevelAtTime(hist, STUN_DR_CATEGORY, t, legacy.startTime) === "Full";
        const ready = teamStunCds
          .filter(({ cd }) => cdAvailableAt(cd, t))
          .map(({ cd, who }) => `${who}:${cd.spellName}`);
        const open = clean && ready.length > 0;
        if (open && openFrom === null) {
          openFrom = t;
          openCds = ready;
        } else if (!open && openFrom !== null) {
          const d = t - openFrom;
          if (d >= minS)
            all.push({
              matchId: meta.id,
              enemy: e.name ?? "?",
              isHealer: isHealerSpec(e.spec),
              fromS: openFrom,
              toS: t,
              durS: d,
              readyCds: openCds,
            });
          openFrom = null;
        }
      }
      if (openFrom !== null && durS - openFrom >= minS)
        all.push({
          matchId: meta.id,
          enemy: e.name ?? "?",
          isHealer: isHealerSpec(e.spec),
          fromS: openFrom,
          toS: durS,
          durS: durS - openFrom,
          readyCds: openCds,
        });
    }
  }

  const q = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length === 0 ? NaN : s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  };
  const ds = all.map((w) => w.durS);
  // How much of this is "nobody was ever going to CC this enemy at all"? A
  // window that opens at t=0 means the target had not been stunned once
  // before it — for the third enemy in a 3v3 that is ordinary, not a missed
  // window. Reported because the headline count is meaningless without it.
  const fromZero = all.filter((w) => w.fromS === 0).length;
  const neverStunned = all.filter((w) => w.fromS === 0 && w.toS >= 60).length;
  console.log(`rounds scanned                       ${rounds}`);
  console.log(`  with any stun-category team CD     ${roundsWithAnyStunCd}`);
  console.log(
    `clean-and-armed windows >= ${minS}s          ${all.length}  (${(all.length / Math.max(roundsWithAnyStunCd, 1)).toFixed(1)} per such round)`,
  );
  console.log(
    `  of which the window OPENS AT t=0 (target never stunned before it) ${fromZero}  (${((fromZero / Math.max(all.length, 1)) * 100).toFixed(0)}%)`,
  );
  console.log(
    `    ...and runs >= 60s (target essentially never a CC target)      ${neverStunned}  (${((neverStunned / Math.max(all.length, 1)) * 100).toFixed(0)}%)`,
  );
  if (ds.length) {
    console.log(
      `  duration p50 ${q(ds, 0.5).toFixed(0)}s · p90 ${q(ds, 0.9).toFixed(0)}s · max ${Math.max(...ds).toFixed(0)}s`,
    );
    const h = all.filter((w) => w.isHealer);
    console.log(
      `  on the enemy HEALER: ${h.length} (${((h.length / all.length) * 100).toFixed(0)}%), p50 ${q(h.map((w) => w.durS), 0.5).toFixed(0)}s`,
    );
  }
  console.log(
    `\ncoach anchors for reference: "never let an enemy sit off DR for more than about five seconds";\none cited stretch ran :56 -> :28 (28 s).`,
  );
  console.log(`\nlongest windows (the real-match examples this probe exists to produce):`);
  for (const w of [...all].sort((a, b) => b.durS - a.durS).slice(0, nEx)) {
    console.log(
      `  ${w.matchId}  ${w.enemy}${w.isHealer ? " (healer)" : ""}  ${w.fromS}s–${w.toS}s = ${w.durS}s clean, armed with ${w.readyCds.slice(0, 3).join(", ")}`,
    );
  }
}

void main();
