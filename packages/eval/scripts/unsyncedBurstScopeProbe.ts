/**
 * `unsynced-burst` 下架依据的**口径复查**(2026-09-07)。
 *
 * 背景:该类型 2026-08-29 下架(GH #50 (a),用户裁定「降级为上下文事实」),
 * 依据是技能梯度实验 —— 触发率 **62–66%(每个进攻冷却)**、分段梯度 +0.1,
 * 结论「它在描述常态」。同批已知机制:被指控队伍整轮从未控过敌方治疗的占
 * **0%**,平均只差 13–18s;可行性门只解释 9.5%。
 *
 * 复查的假设(来自 Skill Capped 教练语料,2026-09-07):`healer-lockdown` 簇里
 * 16 条映到本类型的判决**全是大招**——暗影之舞 / 化身 / 刃舞,其中一条明说
 * 「**大冷却**只有在治疗被控住之后才能交」。而 `unsyncedBurstEvents` 吃的是
 * `teamOffensiveCds` 的**每一次施放**(candidateFindings.ts:1618),正典进攻表里
 * 短冷却的也算。**若触发被短冷却主导,「描述常态」就可能是口径 artifact,
 * 缺口在选择与严重度而非概念** —— 与 kick-eaten 的 postKick 排序键量错东西同形。
 *
 * 本脚本只回答**便宜的第一步**:触发这条指控的施放,冷却时长分布是什么。
 * 它**不测梯度**,因此不足以给下架翻案 —— 真正的判据是按机会归一化的分段梯度
 * (CLAUDE.md 价值门第 4、5 条),要用 signalSkillGradient 那套重跑。
 * 分布若被短冷却主导 → 值得重跑;若本来就集中在大招 → 假设证伪,下架站得住。
 *
 * 开关按既定用法翻开(candidateTypeFlags.ts 注释:故意留成可变对象字面量,
 * 测试与 A/B harness 直接赋值)。**只在本进程内翻,不改产品默认。**
 *
 * 用法:
 *   npx tsx packages/eval/scripts/unsyncedBurstScopeProbe.ts [--n 400]
 */
import { ensureAnalysisData, extractCandidateFindings } from "@gladlog/analysis";
import { CANDIDATE_TYPE_FLAGS } from "@gladlog/analysis/src/data/candidateTypeFlags";
import spellEffects from "@gladlog/analysis/src/data/spellEffectGenerated.json";

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

const CD_TABLE = spellEffects as Record<string, { cooldownSeconds?: number }>;

/** Buckets chosen to straddle the line coaches actually draw. "大招" in the
 * corpus quotes = Shadow Dance (60) / Ascendance (180) / Blade Flurry — i.e.
 * the ones on a >=60s cycle. Nothing here is a product threshold. */
const BUCKETS: Array<[string, (cd: number) => boolean]> = [
  ["< 30s", (c) => c < 30],
  ["30–59s", (c) => c >= 30 && c < 60],
  ["60–119s", (c) => c >= 60 && c < 120],
  [">= 120s", (c) => c >= 120],
];

async function main(): Promise<void> {
  const limit = argOf("--n", 400);
  await ensureAnalysisData();
  // Local, in-process only — the shipped default stays false.
  CANDIDATE_TYPE_FLAGS.unsyncedBurst = true;

  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), { minDurationS: 60 }).slice(
    0,
    limit,
  );
  let rounds = 0;
  let firingRounds = 0;
  let events = 0;
  let unknownCd = 0;
  const byBucket = new Map<string, number>();
  const bySpell = new Map<string, { n: number; cd: number | null }>();

  for (const meta of rows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { owner } = splitTeams(legacy);
    if (!owner) continue;
    let cands;
    try {
      cands = extractCandidateFindings(legacy, owner.id) as Array<{
        type: string;
        spellId?: string;
        spell?: string;
      }>;
    } catch {
      continue;
    }
    rounds++;
    const ub = cands.filter((c) => c.type === "unsynced-burst");
    if (ub.length > 0) firingRounds++;
    for (const e of ub) {
      events++;
      const cd = e.spellId ? CD_TABLE[e.spellId]?.cooldownSeconds : undefined;
      const name = e.spell ?? e.spellId ?? "?";
      const cur = bySpell.get(name) ?? { n: 0, cd: cd ?? null };
      cur.n++;
      bySpell.set(name, cur);
      if (cd === undefined) {
        // Three-state: an id with no official cooldown is UNKNOWN, never
        // silently binned as short.
        unknownCd++;
        continue;
      }
      const b = BUCKETS.find(([, f]) => f(cd));
      if (b) byBucket.set(b[0], (byBucket.get(b[0]) ?? 0) + 1);
    }
  }

  const pct = (a: number, b: number) =>
    b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`;
  console.log(`rounds scanned            ${rounds}`);
  console.log(
    `rounds firing unsynced-burst ${firingRounds}  (${pct(firingRounds, rounds)})`,
  );
  console.log(`unsynced-burst events     ${events}`);
  console.log(
    `  official cooldown unknown ${unknownCd}  (${pct(unknownCd, events)})  <- excluded from the buckets below, never binned as short`,
  );
  const known = events - unknownCd;
  console.log(`\ncooldown of the cast that was accused (n=${known}):`);
  for (const [label] of BUCKETS) {
    const n = byBucket.get(label) ?? 0;
    console.log(`  ${label.padEnd(9)} ${String(n).padStart(5)}  ${pct(n, known)}`);
  }
  console.log(`\ntop accused abilities:`);
  for (const [name, v] of [...bySpell].sort((a, b) => b[1].n - a[1].n).slice(0, 15)) {
    console.log(
      `  ${name.slice(0, 30).padEnd(30)} ${String(v.n).padStart(5)}  cd=${v.cd ?? "?"}`,
    );
  }
}

void main();
