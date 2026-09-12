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
 *   npx tsx packages/eval/scripts/candidateDiagnostics.ts [--n 400] [--json] [--owner logger|dps|healer|all]
 *
 * 读的是本机对局库(storeAccess 的 DEFAULT_MATCH_DIR),不写任何文件。
 *
 * `--owner`(GH #75,2026-09-12):默认 `logger` = 记录者视角(老口径,数字逐字节
 * 不变);`dps` / `healer` / `all` 按角色枚举友方单位,每个 (回合, owner) 算一个
 * 视角回合。本机库是一个治疗的日志,所以 `logger` ≈ `healer`,进攻侧类型
 * (burst-into-mitigation 在 candidateFindings.ts 里是 "DPS owner only")只有
 * `dps` 视角才可能触发 —— 「400 回合沉默」在 2026-09-12 之前全是治疗视角的沉默。
 *
 * **What this scan IS (GH #76, registered in docs/predicate-index.md):
 * observed candidate-MENU incidence for one sample and one owner mode.**
 * A type appearing in `rows` proves it fired; a type absent proves nothing —
 * absence in 400 logger perspectives is not non-liveness (burst-into-mitigation
 * was 0 under `logger` and 90 under `--owner dps` with no product change,
 * GH #75). It only calls `extractCandidateFindings`, so the two desktop-derived
 * mistake rows (missed-kick / missed-purge-kill-window) are invisible to it by
 * construction, and it never consults the desktop ignore set (that set is not
 * a runtime filter). Declared liveness lives in
 * `packages/analysis/src/data/candidateTypeRegistry.ts`; this scan is the
 * observational cross-check — "does what the table calls live actually fire" —
 * and `--owner all` is the widest candidate-menu control. History: four
 * code-reading counts of the live set came out 49 → 47 → 37 → 31, each missing
 * a retirement mechanism; this scan (16 types on 400 rounds, 2026-09-06) was
 * the only correct count, which is why consumers that need the OBSERVED set read
 * its `--json` output rather than a hand roster (first consumer: the coach-corpus
 * negative control, `tools/coach-corpus/negative_control.py --universe`, GH #74).
 *
 * Compatibility promise of the default mode: `rows` / `won` / `lost` / `span`
 * are unchanged from before `--owner` existed; the JSON gained `mode` /
 * `rounds` / `coverage` and the text header changed (2026-09-12).
 */
import {
  ensureAnalysisData,
  extractCandidateFindings,
  isHealerSpec,
} from "@gladlog/analysis";
import type { ICombatUnit } from "@gladlog/parser-compat";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
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
/**
 * Whose perspective the candidate builders run from (GH #75). `logger` is the
 * historical default — the logging player, else the first unit with a spec —
 * and keeps every earlier number byte-identical. `dps` / `healer` / `all`
 * enumerate FRIENDLY units by role and treat each (round, owner) pair as one
 * perspective-round; win/loss follows the round. The library is one healer's
 * logs, so `logger` ≈ `healer`, and offensive-side types (burst-into-mitigation
 * is "DPS owner only" in candidateFindings.ts) can only fire under `dps`.
 */
export type OwnerMode = "logger" | "dps" | "healer" | "all";

/** Per-perspective presence of the optional per-unit streams a non-owner may
 * lack — counted as "≥ 1 recorded event for this unit in this round". It says
 * the stream was recorded at all; it does NOT say a given predicate's inputs
 * were observable at the instants it samples (the converter turns missing
 * historical castStarts into [], so empty and unavailable look alike, and
 * cc-avoidable reads the ENEMY's cast starts, not the owner's). Use it as a
 * denominator caveat, never to dismiss a coverage explanation. Absence is
 * "unknown", never "zero" (2026-09-06 lesson). */
export interface PerspectiveCoverage {
  perspectives: number;
  withCastStarts: number;
  withPositions: number;
}

export async function scanCandidateIncidence(
  limit: number,
  mode: OwnerMode = "logger",
): Promise<{
  rows: Row[];
  won: number;
  lost: number;
  span: string;
  mode: OwnerMode;
  rounds: number;
  coverage: PerspectiveCoverage;
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
  let rounds = 0;
  const coverage: PerspectiveCoverage = {
    perspectives: 0,
    withCastStarts: 0,
    withPositions: 0,
  };

  for (const meta of indexRows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const result = (legacy as { result?: number }).result;
    if (result !== RESULT_WIN && result !== RESULT_LOSE) continue;

    let owners: ICombatUnit[];
    if (mode === "logger") {
      const units = Object.values(legacy.units).filter((u) => u.name && u.spec);
      const owner = units.find((u) => u.id === legacy.playerId) ?? units[0];
      owners = owner ? [owner] : [];
    } else {
      const { friends } = splitTeams(legacy);
      owners = friends.filter((u) =>
        mode === "all" ? true : isHealerSpec(u.spec) === (mode === "healer"),
      );
    }
    if (owners.length === 0) continue;

    let counted = false;
    const isWin = result === RESULT_WIN;
    for (const owner of owners) {
      let candidates: { type: string }[];
      try {
        candidates = extractCandidateFindings(legacy, owner.id);
      } catch {
        continue;
      }
      if (!counted) {
        counted = true;
        rounds++;
        const t = legacy.startTime;
        if (t) {
          if (t < minT) minT = t;
          if (t > maxT) maxT = t;
        }
      }
      if (isWin) won++;
      else lost++;
      coverage.perspectives++;
      if ((owner.castStartEvents?.length ?? 0) > 0) coverage.withCastStarts++;
      if ((owner.advancedActions?.length ?? 0) > 0) coverage.withPositions++;
      const bucket = isWin ? firedWon : firedLost;
      // 「触发」= 该视角回合至少出现一次;不看条数,避免被每类上限影响。
      for (const type of new Set(candidates.map((c) => c.type))) {
        bucket.set(type, (bucket.get(type) ?? 0) + 1);
      }
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
  return {
    rows,
    won,
    lost,
    span: `${iso(minT)} … ${iso(maxT)}`,
    mode,
    rounds,
    coverage,
  };
}

function ownerModeArg(): OwnerMode {
  const i = process.argv.indexOf("--owner");
  const v = i < 0 ? "logger" : process.argv[i + 1];
  if (v === "logger" || v === "dps" || v === "healer" || v === "all") return v;
  throw new Error(`--owner must be logger|dps|healer|all, got ${v}`);
}

async function main(): Promise<void> {
  const limit = argOf("--n", 400);
  const mode = ownerModeArg();
  const { rows, won, lost, span, rounds, coverage } =
    await scanCandidateIncidence(limit, mode);

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        { mode, rounds, coverage, won, lost, span, rows },
        null,
        1,
      ),
    );
    return;
  }

  console.log(
    `视角 ${mode}:${rounds} 回合 / ${won + lost} 视角回合(胜 ${won} / 负 ${lost});判别力 = 输的视角回合触发率 − 赢的视角回合触发率`,
  );
  console.log(
    `可选字段覆盖:castStartEvents ${coverage.withCastStarts}/${coverage.perspectives},advancedActions ${coverage.withPositions}/${coverage.perspectives}(缺 = 未知,不是零)`,
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
