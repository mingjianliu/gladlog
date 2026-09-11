/**
 * GH #67 · S3「队内递减类别归属」的价值门探针(2026-09-11)。不是产品判据。
 *
 * 由来:`dr-tracking` 簇里有一小组判决(语料全量命中 6 条)讲的是同一件事 ——
 * **你花掉了队友赖以取胜的那个递减类别**:
 *
 *   「和猎人组队时永远别昏迷治疗,那个类别是猎人用扫射和冰冻陷阱占的」
 *   「满血时对治疗开凿击,上了昏迷递减,夺走了猎人下陷阱的能力」
 *   「和法师组队时别用压制咆哮铺旋风,改用晕,好让变形术递减留着」
 *   「那个递减的价值属于自己队的治疗」
 *
 * 6 条里 5 条是**昏迷(Incapacitate)类别**,且带后果归因(「削弱自己队的取胜条件」)。
 *
 * **它和退役的 `dr-clipped-cc` 是不同的问题。** 那个只问「这一下有没有被削」,
 * 不问**是谁削的**;S3 的全部内容就在「是谁」上 —— 自己削自己是节奏问题,
 * 削掉队友的取胜手段是团队资源分配问题,gladlog 对后者没有任何概念。
 *
 * 判据(不新写):`analyzeOutgoingCCChains` 已经按敌人给出带
 * `casterName` / `casterSpec` / `drInfo{category,level}` 的出控链。同一类别里
 * 前一发是 A、后一发是 B 且后者 level ≠ Full,即 **B 被 A 削**;A === B 记为自削,
 * 作为对照 —— 没有这个对照,跨人削的绝对数说明不了任何事。
 *
 * **不足以支持上线。** 这是价值门要的「先看真实语料上长什么样」那一步:
 * 跨人削占比多少、集中在哪个类别、是不是只在特定阵容里出现。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/drTeammateClashProbe.ts [--n 300] [--examples 10]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  analyzeOutgoingCCChains,
  drResetMsAt,
} from "@gladlog/analysis/src/utils/drAnalysis";

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

interface Clash {
  matchId: string;
  target: string;
  category: string;
  byWhom: string;
  bySpec: string;
  bySpell: string;
  victim: string;
  victimSpec: string;
  victimSpell: string;
  level: string;
  gapS: number;
}

async function main(): Promise<void> {
  const limit = argOf("--n", 300);
  const nEx = argOf("--examples", 10);
  await ensureAnalysisData();
  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), { minDurationS: 60 }).slice(
    0,
    limit,
  );

  let rounds = 0;
  let apps = 0;
  let diminished = 0;
  let selfClash = 0;
  // Attribution guard: "the previous application in this category" is only
  // the CAUSE of the diminishment if it falls inside the DR reset window.
  // Beyond it the DR has reset and something else explains the level — a
  // 131.8 s gap showed up in the first run and would have been reported as a
  // teammate clash. Window comes from production (16 s pre-12.1 / 20 s from
  // 12.1), never a local constant.
  let outsideWindow = 0;
  const clashes: Clash[] = [];
  const byCategory = new Map<string, { cross: number; self: number }>();

  for (const meta of rows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { friends, enemies } = splitTeams(legacy);
    if (friends.length === 0 || enemies.length === 0) continue;
    let chains;
    try {
      chains = analyzeOutgoingCCChains(friends, enemies, legacy as never);
    } catch {
      continue;
    }
    rounds++;

    for (const chain of chains) {
      // Per DR category, walk applications in time order; the previous
      // application in the SAME category is what diminished this one.
      const byCat = new Map<string, typeof chain.applications>();
      for (const a of chain.applications) {
        const c = a.drInfo?.category;
        if (!c) continue;
        byCat.set(c, [...(byCat.get(c) ?? []), a]);
      }
      for (const [cat, list] of byCat) {
        const ordered = [...list].sort((x, y) => x.atSeconds - y.atSeconds);
        for (let i = 0; i < ordered.length; i++) {
          const a = ordered[i]!;
          apps++;
          if (a.drInfo.level === "Full") continue;
          diminished++;
          const prev = ordered[i - 1];
          if (!prev) continue;
          const resetS = drResetMsAt(legacy.startTime) / 1000;
          // Chain semantics: the reset clock runs from the previous CC's END.
          if (a.atSeconds - (prev.atSeconds + prev.durationSeconds) > resetS) {
            outsideWindow++;
            continue;
          } // diminished with no prior team application:
          // the enemy team or a pet put it on DR — not a teammate clash.
          const bucket = byCategory.get(cat) ?? { cross: 0, self: 0 };
          if (prev.casterName === a.casterName) {
            selfClash++;
            bucket.self++;
          } else {
            bucket.cross++;
            clashes.push({
              matchId: meta.id,
              target: chain.targetName,
              category: cat,
              byWhom: prev.casterName,
              bySpec: prev.casterSpec,
              bySpell: prev.spellName,
              victim: a.casterName,
              victimSpec: a.casterSpec,
              victimSpell: a.spellName,
              level: a.drInfo.level,
              gapS: Math.round((a.atSeconds - prev.atSeconds) * 10) / 10,
            });
          }
          byCategory.set(cat, bucket);
        }
      }
    }
  }

  const pct = (a: number, b: number) =>
    b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`;
  console.log(`rounds scanned                 ${rounds}`);
  console.log(`team CC applications           ${apps}`);
  console.log(`  landed diminished            ${diminished}  (${pct(diminished, apps)})`);
  console.log(
    `    diminished by a TEAMMATE     ${clashes.length}  (${pct(clashes.length, diminished)} of diminished, ${(clashes.length / Math.max(rounds, 1)).toFixed(2)}/round)`,
  );
  console.log(
    `    diminished by the SAME caster ${selfClash}  (${pct(selfClash, diminished)})  <- control: this is a cadence problem, not a team-resource one`,
  );
  console.log(
    `    prior application OUTSIDE the DR reset window ${outsideWindow}  (${pct(outsideWindow, diminished)})  <- NOT attributable to it; excluded from both counts above`,
  );

  console.log(`\nby DR category:`);
  for (const [c, v] of [...byCategory].sort(
    (a, b) => b[1].cross + b[1].self - (a[1].cross + a[1].self),
  )) {
    console.log(
      `  ${c.slice(0, 22).padEnd(22)} cross ${String(v.cross).padStart(5)}  self ${String(v.self).padStart(5)}  cross-share ${pct(v.cross, v.cross + v.self)}`,
    );
  }

  console.log(`\nexamples (a teammate's CC diminished by another teammate's):`);
  for (const c of clashes.slice(0, nEx)) {
    console.log(
      `  ${c.matchId}  ${c.category} on ${c.target}: ${c.bySpec} ${c.bySpell} -> ${c.gapS}s later ${c.victimSpec} ${c.victimSpell} landed ${c.level}`,
    );
  }
}

void main();
