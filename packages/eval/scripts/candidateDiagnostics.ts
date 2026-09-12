/**
 * 候选类型体检:触发率 + 判别力。
 *
 * 回答的问题:**这个候选类型在指认错误,还是在描述正常打法?**
 *
 * 项目此前所有标定只测三类东西 —— 发生率、模型行为(采纳率/审计通过率/filler)、
 * 确定性(跨后端一致度),没有一项碰过正确性(见 docs/coaching-grounding-audit.md §B)。
 * 本脚本补的是一个便宜的筛子:把候选触发与回合胜负关联起来。
 *
 * **它只能证伪,不能证实。** 胜负是团队结果,相关不等于因果:更强的对手会同时
 * 导致更多受控和更多失败;以队友死亡为前提的类型(death-setup / external-unused /
 * death-unused-defensive)的高判别力是循环论证,不是信号。但反过来成立 ——
 * **一个在你赢的回合里照样触发的「错误」,不太可能是它害你输的**。
 *
 * 2026-08-17 首跑结论(n=400 回合 / 228 胜 172 负):cd-hoarded +25.4pp、
 * kick-eaten +10.9、cd-waste +10.1 有真实区分力;cc-locked 触发率 87% 而判别力
 * 仅 +2.6pp;missed-sync-window 触发 74% 而判别力 **−4.4pp(赢时触发更多)**。
 *
 * **注意语料时代**:结论只对库里实际覆盖的版本有效。2026-08-17 首跑时本机
 * 1028 场库全部为 12.1 之前(最新 2026-08-11,12.1 上线后 0 场),12.1 改了
 * 治疗与减伤生态,跨版本读这些数字要当心。脚本会打印所用样本的时间范围。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/candidateDiagnostics.ts [--n 400] [--json]
 *
 * 读的是本机对局库(storeAccess 的 DEFAULT_MATCH_DIR),不写任何文件。
 *
 * **This scan is also the authoritative answer to "is candidate type X live?"**
 * (GH #76, registered in docs/predicate-index.md). A type can be dead five
 * different ways — `CANDIDATE_TYPE_FLAGS` false, emitter kept but no longer
 * called from the assembly, emitter deleted, `BRACKET_TYPE_ALLOWLIST`, or the
 * desktop's `IGNORED_CANDIDATE_TYPES` — and none of those places lists the
 * other four. Four independent code-reading counts of "how many types are
 * live" came out 49 → 47 → 37 → 31, each missing a different mechanism; the
 * observed set from `scanCandidateIncidence` (16 types on 400 rounds,
 * 2026-09-06) was the only correct one. Consumers that need the live set read
 * this scan's `--json` output, never a hand roster: the coach-corpus negative
 * control (`tools/coach-corpus/negative_control.py --universe <file>`, GH #74)
 * is the first.
 */
import {
  ensureAnalysisData,
  extractCandidateFindings,
} from "@gladlog/analysis";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
} from "../src/explore/storeAccess";

/** `CombatResult`(packages/parser-compat/src/enums.ts):其余值(未知/平局)丢弃。 */
const RESULT_LOSE = 2;
const RESULT_WIN = 3;

/** 触发率高于此值、判别力低于 DISCRIMINATION_PP 的类型会被标出来复核。 */
const HIGH_INCIDENCE_PCT = 50;
const DISCRIMINATION_PP = 3;
/** 不是指控、不参与复核标记的类型(`death` 是中性事实,见 candidateFindings 的注释)。 */
const NOT_AN_ACCUSATION: ReadonlySet<string> = new Set(["death"]);

export interface IncidenceRow {
  type: string;
  wonRounds: number;
  lostRounds: number;
  incidencePct: number;
  deltaPp: number;
}
type Row = IncidenceRow;

function argOf(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

/**
 * Observed candidate incidence over the first `limit` library rounds (≥ 60 s,
 * decided win/loss). A type appears in `rows` iff it fired at least once —
 * that presence IS the "live" predicate the index row points at.
 */
export async function scanCandidateIncidence(limit: number): Promise<{
  rows: Row[];
  won: number;
  lost: number;
  span: string;
}> {
  await ensureAnalysisData();
  const indexRows = pickRows(loadIndex(DEFAULT_MATCH_DIR), {
    minDurationS: 60,
  }).slice(0, limit);

  let minT = Number.POSITIVE_INFINITY;
  let maxT = 0;
  const firedWon = new Map<string, number>();
  const firedLost = new Map<string, number>();
  let won = 0;
  let lost = 0;

  for (const meta of indexRows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const result = (legacy as { result?: number }).result;
    if (result !== RESULT_WIN && result !== RESULT_LOSE) continue;

    const units = Object.values(legacy.units).filter((u) => u.name && u.spec);
    const owner = units.find((u) => u.id === legacy.playerId) ?? units[0];
    if (!owner) continue;

    let candidates: { type: string }[];
    try {
      candidates = extractCandidateFindings(legacy, owner.id);
    } catch {
      continue;
    }

    const t = legacy.startTime;
    if (t) {
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    const isWin = result === RESULT_WIN;
    if (isWin) won++;
    else lost++;
    const bucket = isWin ? firedWon : firedLost;
    // 「触发」= 该回合至少出现一次;不看条数,避免被每类上限影响。
    for (const type of new Set(candidates.map((c) => c.type))) {
      bucket.set(type, (bucket.get(type) ?? 0) + 1);
    }
  }

  const types = [...new Set([...firedWon.keys(), ...firedLost.keys()])];
  const rows: Row[] = types.map((type) => {
    const w = firedWon.get(type) ?? 0;
    const l = firedLost.get(type) ?? 0;
    const winPct = won ? (w / won) * 100 : 0;
    const lossPct = lost ? (l / lost) * 100 : 0;
    return {
      type,
      wonRounds: w,
      lostRounds: l,
      incidencePct: won + lost ? ((w + l) / (won + lost)) * 100 : 0,
      deltaPp: lossPct - winPct,
    };
  });
  rows.sort((a, b) => b.deltaPp - a.deltaPp);
  const iso = (t: number) =>
    Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 10) : "?";
  return { rows, won, lost, span: `${iso(minT)} … ${iso(maxT)}` };
}

async function main(): Promise<void> {
  const limit = argOf("--n", 400);
  const { rows, won, lost, span } = await scanCandidateIncidence(limit);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ won, lost, span, rows }, null, 1));
    return;
  }

  console.log(
    `回合 ${won + lost}(胜 ${won} / 负 ${lost});判别力 = 输的回合触发率 − 赢的回合触发率`,
  );
  console.log(`样本时间范围 ${span}\n`);
  console.log(
    `${"候选类型".padEnd(26)}${"触发率".padStart(8)}${"判别力".padStart(10)}`,
  );
  console.log("-".repeat(46));
  for (const r of rows) {
    const flag =
      !NOT_AN_ACCUSATION.has(r.type) &&
      r.incidencePct >= HIGH_INCIDENCE_PCT &&
      r.deltaPp < DISCRIMINATION_PP
        ? "  ← 高频低判别力,复核"
        : "";
    console.log(
      `${r.type.padEnd(26)}${r.incidencePct.toFixed(1).padStart(7)}%${(r.deltaPp >= 0 ? "+" : "") + r.deltaPp.toFixed(1).padStart(8)}pp${flag}`,
    );
  }
  console.log(
    `\n注意:以队友死亡为前提的类型(death-setup / external-unused /\n` +
      `death-unused-defensive)判别力高是循环论证,不能当信号读。\n` +
      `本表只能证伪不能证实 —— 详见本文件头部注释与 docs/coaching-grounding-audit.md §C。`,
  );
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
) {
  void main();
}
