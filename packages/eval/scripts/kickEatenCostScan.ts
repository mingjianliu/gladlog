/**
 * kick-eaten 代价门体检:**这条在产指控里,有多少发生在「锁了也不疼」的时刻?**
 *
 * 由来(2026-09-06,Skill Capped 教练语料复核):
 * `docs/HANDOFF-2026-09-05-skillcapped-coach-corpus.md` §3.3·⑧ 从 2101 条职业教练
 * 判决里筛出 38 条「教练明说这一手做得对、而 gladlog 谓词会在这里开火」的标注负样本。
 * 其中 `kick-eaten` 8 条,理由高度一致且不是随机噪声 —— 全部是**代价为零**:
 * 「此时吃断无关紧要,因为大家都是满血」「锁的是火焰学派,无所谓」
 * 「去读变形吃了断完全可以接受,骗断比不敢读强」。
 *
 * 而 `kickEatenEvents`(candidateFindings.ts)对**每一次**被打断的硬读条都发射:
 * 只有 `postKick` 严重度排序(idle > acted > switched)和 `KICK_EATEN_CAP`,
 * **没有任何代价门**。`postKick=switched`(换学派打穿锁定)只是事后行为的代理,
 * 回答的是「你被锁之后干了什么」,不是教练问的「这次锁本身值不值得教」。
 *
 * 本脚本不新写判据(CLAUDE.md 共享谓词规则):代价用的就是 `cd-spent-idle` 已经在用的
 * `threatAssessment.ts` 单源谓词 —— `threatActiveAt(t)`,并且和那边一样先经
 * `toRenderSecond` 落到渲染格再查(同一瞬间必须同时决定事实与门)。
 *
 * **它只测「多少条落在无威胁瞬间」,不自动等于「多少条是误报」。** 教练那 8 条是
 * 映射标签,不是已证实的谓词发射(见 HANDOFF §3.3·⑧「已知的折扣」);本脚本给的是
 * 加门的**前数字**与被抑制样本的抽检清单,人工确认才是最后一步。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/kickEatenCostScan.ts [--n 400] [--samples 15] [--json]
 *
 * 读本机对局库(storeAccess 的 DEFAULT_MATCH_DIR),不写任何文件。
 */
import {
  ensureAnalysisData,
  extractCandidateFindings,
  matchThreatLevel,
  threatActiveAt,
  toRenderSecond,
} from "@gladlog/analysis";

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

interface Sample {
  matchId: string;
  t: number;
  interrupted: string;
  kick: string;
  postKick: string;
  matchThreat: string;
}

export async function collect(
  limit: number,
): Promise<{
  rounds: number;
  fired: number;
  noThreat: number;
  byPostKick: Map<string, { total: number; noThreat: number }>;
  byMatchThreat: Map<string, { total: number; noThreat: number }>;
  roundsWithAny: number;
  roundsAllNoThreat: number;
  roundsAllSwitched: number;
  roundsAnyIdleOrActed: number;
  samples: Sample[];
}> {
  await ensureAnalysisData();
  const indexRows = pickRows(loadIndex(DEFAULT_MATCH_DIR), {
    minDurationS: 60,
  }).slice(0, limit);

  let rounds = 0;
  let fired = 0;
  let noThreat = 0;
  let roundsWithAny = 0;
  let roundsAllNoThreat = 0;
  let roundsAllSwitched = 0;
  let roundsAnyIdleOrActed = 0;
  const byPostKick = new Map<string, { total: number; noThreat: number }>();
  const byMatchThreat = new Map<string, { total: number; noThreat: number }>();
  const samples: Sample[] = [];

  for (const meta of indexRows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { friends, enemies, owner } = splitTeams(legacy);
    if (!owner) continue;

    let candidates: Array<{ type: string; t: number; facts?: Record<string, string> }>;
    try {
      candidates = extractCandidateFindings(legacy, owner.id) as typeof candidates;
    } catch {
      continue;
    }
    rounds++;

    const kicks = candidates.filter((c) => c.type === "kick-eaten");
    if (kicks.length === 0) continue;
    roundsWithAny++;

    const mt = matchThreatLevel(enemies, friends, legacy);
    const mtBucket = byMatchThreat.get(mt) ?? { total: 0, noThreat: 0 };

    let noThreatHere = 0;
    for (const k of kicks) {
      // Same grid as cd-spent-idle: floor BEFORE probing (CLAUDE.md).
      const t = toRenderSecond(k.t);
      const active = threatActiveAt(t, enemies, friends, legacy);
      fired++;
      mtBucket.total++;
      // Bucket on the postKick CATEGORY, not the rendered string — the
      // "switched"/"acted" phrasings embed a variable delay ("first cast
      // 1.3s later"), so bucketing on the raw text gives every event its
      // own row. Categories mirror `PostKickBehavior` (analysis).
      const raw = k.facts?.postKick ?? "";
      const pk = raw.startsWith("no cast for")
        ? "idle"
        : raw.startsWith("kept playing through")
          ? "switched"
          : raw.startsWith("waited out")
            ? "acted"
            : "(none)";
      const pkBucket = byPostKick.get(pk) ?? { total: 0, noThreat: 0 };
      pkBucket.total++;
      if (!active) {
        noThreat++;
        noThreatHere++;
        mtBucket.noThreat++;
        pkBucket.noThreat++;
        if (samples.length < 400) {
          samples.push({
            matchId: meta.id,
            t,
            interrupted: k.facts?.interrupted ?? "?",
            kick: k.facts?.kick ?? "?",
            postKick: pk,
            matchThreat: mt,
          });
        }
      }
      byPostKick.set(pk, pkBucket);
    }
    byMatchThreat.set(mt, mtBucket);
    if (noThreatHere === kicks.length) roundsAllNoThreat++;
    // BACKLOG note: `switched` is the category the analysis' own doc comment
    // calls "几乎不用教" and the coach corpus twice explicitly praises
    // ("locked out of frost mid-Ray is exactly the time to re-apply
    // Polymorph"). A round whose kick-eaten entries are ALL `switched` spends
    // menu slots on the least coachable half of the axis.
    const cats = kicks.map((k) => {
      const raw = k.facts?.postKick ?? "";
      return raw.startsWith("no cast for")
        ? "idle"
        : raw.startsWith("kept playing through")
          ? "switched"
          : "acted";
    });
    if (cats.every((c) => c === "switched")) roundsAllSwitched++;
    else roundsAnyIdleOrActed++;
  }

  return {
    rounds,
    fired,
    noThreat,
    byPostKick,
    byMatchThreat,
    roundsWithAny,
    roundsAllNoThreat,
    roundsAllSwitched,
    roundsAnyIdleOrActed,
    samples,
  };
}

async function main(): Promise<void> {
  const n = argOf("--n", 400);
  const nSamples = argOf("--samples", 15);
  const r = await collect(n);
  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          ...r,
          byPostKick: Object.fromEntries(r.byPostKick),
          byMatchThreat: Object.fromEntries(r.byMatchThreat),
        },
        null,
        1,
      ),
    );
    return;
  }
  const pct = (a: number, b: number): string =>
    b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(1)}%`;
  console.log(`rounds scanned          ${r.rounds}`);
  console.log(`rounds firing kick-eaten ${r.roundsWithAny}`);
  console.log(`kick-eaten events       ${r.fired}`);
  console.log(
    `  at NO active threat   ${r.noThreat}  (${pct(r.noThreat, r.fired)})  <- the cost gate would suppress these`,
  );
  console.log(
    `rounds where ALL kick-eaten are no-threat  ${r.roundsAllNoThreat}  (${pct(r.roundsAllNoThreat, r.roundsWithAny)} of firing rounds)`,
  );
  console.log(
    `rounds whose kick-eaten are ALL "switched"    ${r.roundsAllSwitched}  (${pct(r.roundsAllSwitched, r.roundsWithAny)} of firing rounds)`,
  );
  console.log(
    `rounds with at least one idle/acted           ${r.roundsAnyIdleOrActed}  (${pct(r.roundsAnyIdleOrActed, r.roundsWithAny)})`,
  );
  console.log(`\nby postKick (the existing severity key):`);
  for (const [k, v] of [...r.byPostKick].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `  ${k.slice(0, 52).padEnd(54)} ${String(v.total).padStart(5)}  noThreat ${String(v.noThreat).padStart(5)} (${pct(v.noThreat, v.total)})`,
    );
  }
  console.log(`\nby match threat level:`);
  for (const [k, v] of [...r.byMatchThreat].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `  ${k.padEnd(10)} ${String(v.total).padStart(5)}  noThreat ${String(v.noThreat).padStart(5)} (${pct(v.noThreat, v.total)})`,
    );
  }
  console.log(`\nsamples the gate would suppress (manual spot-check these):`);
  for (const s of r.samples.slice(0, nSamples)) {
    console.log(
      `  ${s.matchId}  t=${s.t}s  ${s.interrupted} kicked by ${s.kick}  [${s.matchThreat}]  ${s.postKick}`,
    );
  }
}

if (process.argv[1]?.endsWith("kickEatenCostScan.ts")) {
  void main();
}
