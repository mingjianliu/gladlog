/**
 * `postKick="switched"` 语义体检:**它到底在说「打穿了锁定」,还是「按了个瞬发」?**
 *
 * 由来(2026-09-06):`kickEatenCostScan.ts` 量出 `switched` 占 `kick-eaten` 全部
 * 发射的 65.9%(174/264)、占触发回合的 59.3%(105/177)。`candidateFindings.ts`
 * 的 `POST_KICK_SEVERITY` 注释自陈它「几乎不用教」,Skill Capped 教练语料也两次
 * 明确表扬该行为。于是候选结论是「`switched` 不该发射」。
 *
 * **本脚本验证那条结论的唯一软肋。** 该注释的语料锚是「切换率跟专精能力上限走
 * (戒律 76–80% vs 神骑 8%)」。推论「switched ⇒ 不可教」跨专精成立的前提是:
 * 各专精的 `switched` 指的是同一件事。而 `ccTrinketAnalysis.ts:944-970` 的判据是
 * **被踢后 5s 内任何 `SPELL_CAST_SUCCESS`、学派掩码与被锁学派零重叠** ——
 * **它不要求硬读条**。按个瞬发位移(物理学派)同样被判 `switched`,并在 prompt 里
 * 渲染成 “kept playing through the lockout”。
 *
 * 判据(日志可观测,不新写规则):硬读条会发 `SPELL_CAST_START`,瞬发不发
 * (`parser-compat/src/types.ts` 的 `castStartEvents` 注释原话)。所以对每条
 * production 判为 `switched` 的事件,看**触发切换的那一发**有没有配对的
 * CAST_START。
 *
 * **不重写判据**:`interruptInstances`(含 `postKick`)直接取自 production 的
 * `analyzePlayerCCAndTrinket`;学派比较用 production 自己的 `spellSchoolMask`。
 * 本脚本只在 production 已判定的 `switched` 上做**诊断性归类**,不重新判定。
 *
 * **陷阱:`castStartEvents` 是 optional**,旧归档写作 `[]`。缺失 ≠ 瞬发,
 * 这类回合单独计入 `unknown` 并报覆盖率,绝不并进「瞬发」。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/postKickSwitchAudit.ts [--n 400] [--json]
 */
import { ensureAnalysisData, specToString } from "@gladlog/analysis";
import { spellSchoolMask } from "@gladlog/analysis/src/data/spellSchools";
import { analyzePlayerCCAndTrinket } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { LogEvent } from "@gladlog/parser-compat";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";

/** Same window production classifies in (`POST_KICK_WINDOW_S`). */
const WINDOW_S = 5;
/** How far before a SPELL_CAST_SUCCESS its own SPELL_CAST_START may sit.
 * Longest hard casts in PvP are ~3s; 6s is generous and only ever risks
 * calling an instant a hard cast (conservative for this audit's claim). */
const CAST_START_LOOKBACK_S = 6;

function argOf(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

interface SpecRow {
  switched: number;
  hard: number;
  /** Evoker empowered release — a HELD cast, not an instant. It emits
   * SPELL_EMPOWER_* rather than SPELL_CAST_START, so the CAST_START proxy
   * alone would miscall it "instant". Counted separately and reported with
   * `hard` so the headline cannot be inflated by this artifact. */
  empowered: number;
  instant: number;
  unknown: number;
  idle: number;
  acted: number;
}

export async function collect(limit: number): Promise<{
  rounds: number;
  roundsNoCastStarts: number;
  /** Coverage of the OPTIONAL `empowerEnds` field. A zero `empowered` count
   * means nothing unless this is non-zero — absence of the field is not
   * absence of empowered casts (same trap as `castStartEvents`). */
  roundsEmpowerFieldPresent: number;
  roundsEmpowerNonEmpty: number;
  bySpec: Map<string, SpecRow>;
  topSwitchSpells: Map<string, { hard: number; instant: number }>;
}> {
  await ensureAnalysisData();
  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), { minDurationS: 60 }).slice(
    0,
    limit,
  );
  const bySpec = new Map<string, SpecRow>();
  const topSwitchSpells = new Map<string, { hard: number; instant: number }>();
  let rounds = 0;
  let roundsNoCastStarts = 0;
  let roundsEmpowerFieldPresent = 0;
  let roundsEmpowerNonEmpty = 0;

  for (const meta of rows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { enemies, owner } = splitTeams(legacy);
    if (!owner) continue;
    rounds++;

    let summary;
    try {
      summary = analyzePlayerCCAndTrinket(owner, enemies, legacy, []);
    } catch {
      continue;
    }
    const insts = summary.interruptInstances;
    if (insts.length === 0) continue;

    const spec = specToString(owner.spec) || String(owner.spec ?? "Unknown");
    const row =
      bySpec.get(spec) ??
      { switched: 0, hard: 0, empowered: 0, instant: 0, unknown: 0, idle: 0, acted: 0 };

    const startMs = legacy.startTime;
    // castStartEvents is OPTIONAL — absent on old archives. Absence is
    // "unknown", never "instant".
    const rawStarts = (owner as { castStartEvents?: Array<{ spellId?: string; logLine: { timestamp: number } }> })
      .castStartEvents;
    const haveStarts = Array.isArray(rawStarts) && rawStarts.length > 0;
    if (!haveStarts) roundsNoCastStarts++;
    const starts = (rawStarts ?? []).map((e) => ({
      t: (e.logLine.timestamp - startMs) / 1000,
      spellId: e.spellId ?? "",
    }));

    const rawEmp = (
      owner as { empowerEnds?: Array<{ spellId?: string; logLine: { timestamp: number } }> }
    ).empowerEnds;
    if (rawEmp !== undefined) roundsEmpowerFieldPresent++;
    if (Array.isArray(rawEmp) && rawEmp.length > 0) roundsEmpowerNonEmpty++;
    const empowers = (rawEmp ?? []).map((e) => ({
      t: (e.logLine.timestamp - startMs) / 1000,
      spellId: e.spellId ?? "",
    }));

    const casts = owner.spellCastEvents
      .filter((e) => e.logLine.event === LogEvent.SPELL_CAST_SUCCESS)
      .map((e) => ({
        t: (e.logLine.timestamp - startMs) / 1000,
        spellId: e.spellId ?? "",
        spellName: e.spellName ?? e.spellId ?? "?",
      }))
      .sort((a, b) => a.t - b.t);

    for (const inst of insts) {
      if (inst.postKick === "idle") { row.idle++; continue; }
      if (inst.postKick === "acted") { row.acted++; continue; }
      row.switched++;
      // Which cast made production say "switched"? Production's own rule,
      // production's own mask function — re-asked here only to NAME the cast,
      // never to re-decide the label.
      const lockedMask = spellSchoolMask(inst.interruptedSpellId);
      const trigger = casts.find(
        (c) =>
          c.t > inst.atSeconds &&
          c.t <= inst.atSeconds + WINDOW_S &&
          lockedMask !== undefined &&
          spellSchoolMask(c.spellId) !== undefined &&
          (spellSchoolMask(c.spellId)! & lockedMask) === 0,
      );
      if (!trigger) { row.unknown++; continue; }
      if (!haveStarts) { row.unknown++; continue; }
      const isHard = starts.some(
        (s) =>
          s.spellId === trigger.spellId &&
          s.t <= trigger.t &&
          s.t >= trigger.t - CAST_START_LOOKBACK_S,
      );
      const isEmpowered =
        !isHard &&
        empowers.some(
          (e) =>
            e.spellId === trigger.spellId &&
            Math.abs(e.t - trigger.t) <= CAST_START_LOOKBACK_S,
        );
      if (isHard) row.hard++;
      else if (isEmpowered) row.empowered++;
      else row.instant++;
      const cur =
        topSwitchSpells.get(trigger.spellName) ?? { hard: 0, instant: 0 };
      if (isHard || isEmpowered) cur.hard++;
      else cur.instant++;
      topSwitchSpells.set(trigger.spellName, cur);
    }
    bySpec.set(spec, row);
  }
  return {
    rounds,
    roundsNoCastStarts,
    roundsEmpowerFieldPresent,
    roundsEmpowerNonEmpty,
    bySpec,
    topSwitchSpells,
  };
}

async function main(): Promise<void> {
  const r = await collect(argOf("--n", 400));
  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          rounds: r.rounds,
          roundsNoCastStarts: r.roundsNoCastStarts,
          roundsEmpowerFieldPresent: r.roundsEmpowerFieldPresent,
          roundsEmpowerNonEmpty: r.roundsEmpowerNonEmpty,
          bySpec: Object.fromEntries(r.bySpec),
          topSwitchSpells: Object.fromEntries(r.topSwitchSpells),
        },
        null,
        1,
      ),
    );
    return;
  }
  const pct = (a: number, b: number): string =>
    b === 0 ? "n/a" : `${((a / b) * 100).toFixed(0)}%`;
  console.log(`rounds scanned                 ${r.rounds}`);
  console.log(
    `rounds with NO castStartEvents  ${r.roundsNoCastStarts}  (these contribute only "unknown")`,
  );
  console.log(
    `empowerEnds field present       ${r.roundsEmpowerFieldPresent}/${r.rounds}   non-empty ${r.roundsEmpowerNonEmpty}`,
  );
  console.log(
    `  ^ a zero "empowered" count below is only meaningful if non-empty > 0.`,
  );
  console.log(
    `NOTE: parser-compat exposes NO channel events, so a channelled cast\n` +
      `      (Penance, Mana Tea, ...) is indistinguishable from an instant here.\n` +
      `      The "instant" bucket is therefore "no CAST_START and no empower" =\n` +
      `      instant OR channel, and is an UPPER bound on true instants.`,
  );

  let S = 0, H = 0, E = 0, I = 0, U = 0, ID = 0, AC = 0;
  for (const v of r.bySpec.values()) {
    S += v.switched; H += v.hard; E += v.empowered; I += v.instant;
    U += v.unknown; ID += v.idle; AC += v.acted;
  }
  const known = H + E + I;
  console.log(`\nTOTAL  idle ${ID}  acted ${AC}  switched ${S}`);
  console.log(
    `  of the ${S} switched: hard-cast ${H}, empowered(held) ${E}, instant-only ${I}, unknown ${U}`,
  );
  console.log(
    `  among the ${known} classifiable: **${pct(I, known)} were an INSTANT**; ${pct(H + E, known)} a real held/hard cast`,
  );

  console.log(`\nby owner spec (specs with >= 5 switched):`);
  console.log(
    `  ${"spec".padEnd(26)} ${"switched".padStart(8)} ${"held".padStart(5)} ${"inst".padStart(5)} ${"unk".padStart(4)}  instant%`,
  );
  for (const [spec, v] of [...r.bySpec].sort((a, b) => b[1].switched - a[1].switched)) {
    if (v.switched < 5) continue;
    console.log(
      `  ${spec.slice(0, 26).padEnd(26)} ${String(v.switched).padStart(8)} ${String(v.hard + v.empowered).padStart(5)} ${String(v.instant).padStart(5)} ${String(v.unknown).padStart(4)}  ${pct(v.instant, v.hard + v.empowered + v.instant)}`,
    );
  }

  console.log(`\ntop spells that triggered a "switched" verdict:`);
  for (const [name, v] of [...r.topSwitchSpells]
    .sort((a, b) => b[1].hard + b[1].instant - (a[1].hard + a[1].instant))
    .slice(0, 18)) {
    console.log(
      `  ${name.slice(0, 34).padEnd(34)} total ${String(v.hard + v.instant).padStart(4)}  hard ${String(v.hard).padStart(4)}  instant ${String(v.instant).padStart(4)}`,
    );
  }
}

if (process.argv[1]?.endsWith("postKickSwitchAudit.ts")) {
  void main();
}
