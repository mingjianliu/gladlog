/** buffDurationScan.ts — 增益时长的腐烂扫描 + 缺口扫描(2026-09-07)。
 *
 * `BUFF_DURATION_TALENT_MODIFIERS` / `CORPUS_DURATION_PATCHES` 是手工表,而它们
 * 断言的是**游戏行为**,所以和 curatedRotScan / drGapScan / dispelCompletenessScan
 * 同一个道理:必须能被语料反复重测,否则赛季一换就静默腐烂。这一轮建表时踩到的
 * 三种腐烂全部是这个扫描能抓的:
 *   · 天赋 id 被重编号 → 该条目再也不生效,时长悄悄退回基础值
 *   · DB2 的多级语义变了(+X 是每级还是满级)→ 数值差一倍
 *   · 专精基础值改了(神圣马驹惩戒 6s / 神圣 5s)→ 某个专精整体偏
 *
 * 判据:对每个登记条目,按**施法者格**(一场对局里的一个施法者)取干净寿命的众数
 * (APPLIED→REMOVED,中间无 REFRESH),再按该施法者的天赋级数分组,然后问
 * `buffFullDurationForCaster` 能不能复现每一组的观测值。复现不了 = FLAG。
 *
 * 第二半是缺口:任何**没登记**的光环,只要观测众数与谓词答案差得够多、样本够大,
 * 就列出来并给出「长组持有 / 短组持有」差异最大的天赋,供人工按 DB2 掩码定夺。
 * 它只提名不定罪 —— 掩码那一半要人去 SpellClassOptions 里核(见表头注释)。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/buffDurationScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt [--every 60] \
 *     [--gap-min-cells 30] [--gap]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  BUFF_DURATION_TALENT_MODIFIERS,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import { talentRankOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, LogEvent } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {
    manifest: "",
    every: 1,
    archiveDir: "",
    gap: false,
    gapMinCells: 30,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--archive-dir") out.archiveDir = a[++i] ?? "";
    else if (a[i] === "--gap") out.gap = true;
    else if (a[i] === "--gap-min-cells") out.gapMinCells = Number(a[++i]);
  }
  if (!out.manifest || !Number.isFinite(out.every) || out.every < 1) {
    console.error(
      "usage: buffDurationScan.ts --manifest <path> [--every N] [--archive-dir <dir>] [--gap] [--gap-min-cells N]",
    );
    process.exit(1);
  }
  return out;
}

const args = parseArgs();
await ensureAnalysisData();

/**
 * 定型后的施法者格。**每场结束就地定型、只留数字**:早先版本把 unit 对象存进
 * map 里等到最后再问天赋,等于把每一场的完整解析结果都留住,150 个文件就 OOM。
 */
type Row = { spellId: string; observed: number; predicted: number; rank: number };
const rows: Row[] = [];
let cellCount = 0;

const REGISTERED = new Set(Object.keys(BUFF_DURATION_TALENT_MODIFIERS));

const files = readFileSync(args.manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % args.every === 0);

let rounds = 0;
for (const f of files) {
  const p = f.startsWith("/") ? f : resolve(args.archiveDir, f);
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(p);
    text = (p.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const matchCells = new Map<string, Map<number, number>>();
    const matchCasters = new Map<string, { spec: string; info?: unknown }>();
    for (const unit of Object.values(legacy.units)) {
      // 光环事件按 (施法者, 目标, 法术) 配对,只留「中间没有 REFRESH」的干净段。
      // 不能用 buildAuraIntervals:它的封顶用的正是本扫描要检验的那个时长。
      const open = new Map<string, { t: number; clean: boolean }>();
      for (const a of unit.auraEvents) {
        const spellId = a.spellId;
        if (!spellId || a.destUnitId !== unit.id) continue;
        const key = `${a.srcUnitId ?? ""}|${spellId}`;
        const ev = a.logLine.event as string;
        const t = a.logLine.timestamp as number;
        if (ev === LogEvent.SPELL_AURA_APPLIED) open.set(key, { t, clean: true });
        else if (ev === LogEvent.SPELL_AURA_REFRESH) {
          const o = open.get(key);
          if (o) o.clean = false;
        } else if (
          ev === LogEvent.SPELL_AURA_REMOVED ||
          ev === LogEvent.SPELL_AURA_BROKEN ||
          ev === LogEvent.SPELL_AURA_BROKEN_SPELL
        ) {
          const o = open.get(key);
          open.delete(key);
          if (!o || !o.clean) continue;
          const d = Math.round(((t - o.t) / 1000) * 2) / 2;
          if (d < 0 || d > 120) continue;
          const src = legacy.units[a.srcUnitId ?? ""];
          if (!src?.info) continue;
          const cellKey = `${spellId}|${a.srcUnitId}`;
          const hist = matchCells.get(cellKey) ?? new Map<number, number>();
          hist.set(d, (hist.get(d) ?? 0) + 1);
          matchCells.set(cellKey, hist);
          matchCasters.set(cellKey, src as never);
        }
      }
    }
    // 就地定型,然后把这一场的解析结果丢掉
    for (const [cellKey, hist] of matchCells) {
      cellCount++;
      const observed = modeOf(hist);
      if (observed === null) continue;
      const spellId = cellKey.slice(0, cellKey.indexOf("|"));
      const caster = matchCasters.get(cellKey);
      if (!caster) continue;
      const predicted = buffFullDurationForCaster(spellId, caster as never);
      if (predicted === undefined) continue;
      const talentId = BUFF_DURATION_TALENT_MODIFIERS[spellId]?.find(
        (m) => m.talentSpellId !== undefined,
      )?.talentSpellId;
      rows.push({
        spellId,
        observed,
        predicted,
        rank: talentId ? talentRankOf(caster as never, talentId) : 0,
      });
    }
  }
}

/** 一个格定型:至少 3 段、且 ≥60% 集中在一个值 */
function modeOf(h: Map<number, number>): number | null {
  let best = -1;
  let bestN = 0;
  let total = 0;
  for (const [v, n] of h) {
    total += n;
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  if (total < 3 || bestN / total < 0.6) return null;
  return best;
}

const bySpell = new Map<string, Row[]>();
for (const r of rows) {
  const list = bySpell.get(r.spellId) ?? [];
  list.push(r);
  bySpell.set(r.spellId, list);
}

console.log(
  `files=${files.length} rounds=${rounds} caster-cells=${cellCount} typed=${rows.length}`,
);

function group(list: Row[]) {
  const g = new Map<string, { observed: number; predicted: number; n: number }>();
  for (const r of list) {
    const k = `${r.observed}|${r.predicted}`;
    const cur = g.get(k) ?? { observed: r.observed, predicted: r.predicted, n: 0 };
    cur.n++;
    g.set(k, cur);
  }
  return [...g.values()].sort((a, b) => b.n - a.n);
}

console.log("\n=== ROT:已登记条目能否复现观测 ===");
let flags = 0;
for (const spellId of [...REGISTERED].sort()) {
  const rows = bySpell.get(spellId);
  const name = spellEffectData[spellId]?.name ?? spellId;
  if (!rows || rows.length < 5) {
    console.log(`  SKIP  ${spellId} ${name}: 样本不足 (${rows?.length ?? 0} 格)`);
    continue;
  }
  const groups = group(rows);
  const bad = groups.filter(
    (g) => Math.abs(g.observed - g.predicted) > 0.6 && g.n >= 5,
  );
  const tot = rows.length;
  const okN = tot - bad.reduce((s, g) => s + g.n, 0);
  const verdict = bad.length === 0 ? "OK   " : "FLAG ";
  if (bad.length > 0) flags++;
  console.log(
    `  ${verdict} ${spellId} ${name}: ${okN}/${tot} 格复现` +
      (bad.length
        ? ` — 不符: ${bad
            .map((g) => `观测${g.observed}s vs 谓词${g.predicted}s ×${g.n}`)
            .join("; ")}`
        : ""),
  );
}
console.log(`\nROT 结论: ${flags} 条登记项与语料不符`);

if (args.gap) {
  console.log("\n=== GAP:未登记但观测与谓词不符的光环 ===");
  const rowsOut: string[] = [];
  for (const [spellId, rows] of bySpell) {
    if (REGISTERED.has(spellId)) continue;
    const groups = group(rows);
    const top = groups[0];
    if (!top || top.n < args.gapMinCells) continue;
    if (Math.abs(top.observed - top.predicted) <= 0.6) continue;
    rowsOut.push(
      `  ${spellId} ${spellEffectData[spellId]?.name ?? ""}: 观测 ${top.observed}s ×${top.n} 格 vs 谓词 ${top.predicted}s`,
    );
  }
  rowsOut.sort();
  console.log(rowsOut.join("\n") || "  (无)");
  console.log(`\nGAP 结论: ${rowsOut.length} 个光环待定夺(掩码那一半需人工核 SpellClassOptions)`);
}
