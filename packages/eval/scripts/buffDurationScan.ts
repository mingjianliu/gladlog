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
 * 第三段 PATCH(2026-09-22,GH #65 第 4 项):`CORPUS_DURATION_PATCHES` 也是断言游戏
 * 行为的手工表,按 ROT 同一判据复现一遍;GAP 行同时打印补丁表的提名门(寿命众数
 * 占 ≥60% 且 n ≥100、只认变长、控制类保持官方值)和判定,`--dose-unclean` 把
 * SPELL_AURA_APPLIED_DOSE 也算脏段(09-07 批次排叠层伪影用的口径;默认关,
 * 保持与 durationTalentScan 相同的格语义)。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/buffDurationScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt [--every 60] \
 *     [--gap-min-cells 30] [--gap] [--dose-unclean] \
 *     [--detail <aura>[:<talentSpellId>],…]   # 专精 × 月份 × 持有 拆分,见 detail 注释
 */
import { ensureAnalysisData, specToString } from "@gladlog/analysis";
import {
  BUFF_DURATION_TALENT_MODIFIERS,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import { CORPUS_DURATION_PATCHES } from "@gladlog/analysis/src/data/spellEffectOverrides";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import { talentRankOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
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
    doseUnclean: false,
    detail: "",
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--archive-dir") out.archiveDir = a[++i] ?? "";
    else if (a[i] === "--gap") out.gap = true;
    else if (a[i] === "--gap-min-cells") out.gapMinCells = Number(a[++i]);
    else if (a[i] === "--dose-unclean") out.doseUnclean = true;
    else if (a[i] === "--detail") out.detail = a[++i] ?? "";
  }
  if (!out.manifest || !Number.isFinite(out.every) || out.every < 1) {
    console.error(
      "usage: buffDurationScan.ts --manifest <path> [--every N] [--archive-dir <dir>] [--gap] [--gap-min-cells N] [--dose-unclean]",
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
type Row = {
  spellId: string;
  observed: number;
  predicted: number;
  rank: number;
};
const rows: Row[] = [];
let cellCount = 0;
/**
 * Per-aura histogram of EVERY clean lifetime (0.5 s bins), not per cell — the
 * CORPUS_DURATION_PATCHES promotion bar (2026-09-07 batch, spellEffectOverrides.ts)
 * is "modal clean lifetime holds >= 60 % of >= 100 lifetimes", so the GAP half
 * prints exactly that number next to the cell count (GH #65 item 4, 2026-09-22).
 * Numbers only: ≤ 241 bins per aura, so a 63k-file scan cannot OOM on it.
 */
const lifetimes = new Map<string, Map<number, number>>();
const PATCHED = new Set(Object.keys(CORPUS_DURATION_PATCHES));
/**
 * `--detail <aura>[:<talentSpellId>],…` — the third evidence leg for a
 * nominated (talent → aura) pair, and the "why did this patch stop
 * reproducing" question: per aura, the observed-duration distribution split
 * by caster spec × log month × (holds the named talent, via talentRankOf).
 * A patch that drifts by MONTH is a mid-season hotfix; one that splits by
 * SPEC is a specBaseSeconds shape; one that splits by HOLDER is a modifier
 * entry, not a flat patch.
 */
const detail = new Map<string, string | undefined>();
for (const spec of args.detail.split(",").filter(Boolean)) {
  const [aura, talent] = spec.split(":");
  if (aura) detail.set(aura, talent || undefined);
}
const detailCells = new Map<string, Map<string, Map<number, number>>>();

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
        if (ev === LogEvent.SPELL_AURA_APPLIED)
          open.set(key, { t, clean: true });
        else if (ev === LogEvent.SPELL_AURA_REFRESH) {
          const o = open.get(key);
          if (o) o.clean = false;
        } else if (
          ev === LogEvent.SPELL_AURA_APPLIED_DOSE &&
          args.doseUnclean
        ) {
          // Stack-refresh artefact guard (the 09-07 batch's re-measure): a
          // stacking aura's lifetime is not its duration. Opt-in so the ROT
          // half keeps the cell semantics durationTalentScan shares.
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
          const lh = lifetimes.get(spellId) ?? new Map<number, number>();
          lh.set(d, (lh.get(d) ?? 0) + 1);
          lifetimes.set(spellId, lh);
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
      if (detail.has(spellId)) {
        const dTalent = detail.get(spellId);
        const holder = dTalent
          ? talentRankOf(caster as never, dTalent) > 0
            ? "holder"
            : "non-holder"
          : "-";
        const month = new Date(legacy.startTime).toISOString().slice(0, 7);
        const k = `${specToString(caster.spec as never)}|${month}|${holder}`;
        const byKey = detailCells.get(spellId) ?? new Map();
        const h = byKey.get(k) ?? new Map<number, number>();
        h.set(observed, (h.get(observed) ?? 0) + 1);
        byKey.set(k, h);
        detailCells.set(spellId, byKey);
      }
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
  const g = new Map<
    string,
    { observed: number; predicted: number; n: number }
  >();
  for (const r of list) {
    const k = `${r.observed}|${r.predicted}`;
    const cur = g.get(k) ?? {
      observed: r.observed,
      predicted: r.predicted,
      n: 0,
    };
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
    console.log(
      `  SKIP  ${spellId} ${name}: 样本不足 (${rows?.length ?? 0} 格)`,
    );
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
  // Rank breakdown of each disagreeing group (Game-Behaviour Rule 4: the
  // rank is READ, so a tier the table does not price shows up here as a
  // distinct rank rather than as unexplained rot — Recklessness 24 s is
  // Rampaging Berserker's tiered node, 2026-09-22).
  const rankOf = (g: { observed: number; predicted: number }) => {
    const h = new Map<number, number>();
    for (const r of rows)
      if (r.observed === g.observed && r.predicted === g.predicted)
        h.set(r.rank, (h.get(r.rank) ?? 0) + 1);
    return [...h]
      .sort((a, b) => b[1] - a[1])
      .map(([rk, n]) => `r${rk}:${n}`)
      .join(",");
  };
  console.log(
    `  ${verdict} ${spellId} ${name}: ${okN}/${tot} 格复现` +
      (bad.length
        ? ` — 不符: ${bad
            .map(
              (g) =>
                `观测${g.observed}s vs 谓词${g.predicted}s ×${g.n} [${rankOf(g)}]`,
            )
            .join("; ")}`
        : ""),
  );
}
console.log(`\nROT 结论: ${flags} 条登记项与语料不符`);

if (detail.size > 0) {
  console.log("\n=== DETAIL:按 专精 × 月份 × 持有 拆分的观测分布(格) ===");
  for (const [aura, byKey] of detailCells) {
    const talent = detail.get(aura);
    console.log(
      `  ${aura} ${spellEffectData[aura]?.name ?? ""}${talent ? ` (holder = talentRankOf ${talent} > 0)` : ""}`,
    );
    const lines = [...byKey]
      .map(([k, h]) => {
        const tot = [...h.values()].reduce((s, n) => s + n, 0);
        const top = [...h]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([v, n]) => `${v}s×${n}`)
          .join(" ");
        return { k, tot, top };
      })
      .sort((a, b) => b.tot - a.tot);
    for (const l of lines) {
      console.log(
        `    ${l.k.padEnd(44)} n=${String(l.tot).padStart(4)}  ${l.top}`,
      );
    }
  }
}

/** All clean lifetimes of one aura: total, modal value, modal share. */
function lifetimeMode(spellId: string) {
  const h = lifetimes.get(spellId);
  if (!h) return null;
  let total = 0;
  let best = -1;
  let bestN = 0;
  for (const [v, n] of h) {
    total += n;
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  return { total, mode: best, share: total ? bestN / total : 0 };
}

// The corpus patches are hand assertions about the game too (Game-Behaviour
// Rule 8): a patched value that no longer reproduces is ROT exactly like a
// registered modifier. Same verdict rule as the ROT block above.
console.log("\n=== PATCH:CORPUS_DURATION_PATCHES 能否复现观测 ===");
let patchFlags = 0;
for (const spellId of [...PATCHED].sort()) {
  const rows = bySpell.get(spellId);
  const name = spellEffectData[spellId]?.name ?? spellId;
  if (!rows || rows.length < 5) {
    console.log(
      `  SKIP  ${spellId} ${name}: 样本不足 (${rows?.length ?? 0} 格)`,
    );
    continue;
  }
  const groups = group(rows);
  const bad = groups.filter(
    (g) => Math.abs(g.observed - g.predicted) > 0.6 && g.n >= 5,
  );
  const tot = rows.length;
  const okN = tot - bad.reduce((s, g) => s + g.n, 0);
  const lm = lifetimeMode(spellId);
  if (bad.length > 0) patchFlags++;
  console.log(
    `  ${bad.length === 0 ? "OK   " : "FLAG "} ${spellId} ${name}: ${okN}/${tot} 格复现` +
      (lm
        ? `,寿命 n=${lm.total} 众数 ${lm.mode}s 占 ${(100 * lm.share).toFixed(0)}%`
        : "") +
      (bad.length
        ? ` — 不符: ${bad
            .map((g) => `观测${g.observed}s vs 谓词${g.predicted}s ×${g.n}`)
            .join("; ")}`
        : ""),
  );
}
console.log(`\nPATCH 结论: ${patchFlags} 条补丁与语料不符`);

if (args.gap) {
  console.log("\n=== GAP:未登记但观测与谓词不符的光环 ===");
  console.log(
    "  门 = 补丁表的提名门(2026-09-07):寿命众数占 ≥60% 且 n ≥100,且只认变长;控制类保持官方值。",
  );
  const rowsOut: string[] = [];
  let qualifying = 0;
  for (const [spellId, rows] of bySpell) {
    if (REGISTERED.has(spellId) || PATCHED.has(spellId)) continue;
    const groups = group(rows);
    const top = groups[0];
    if (!top || top.n < args.gapMinCells) continue;
    if (Math.abs(top.observed - top.predicted) <= 0.6) continue;
    const lm = lifetimeMode(spellId);
    const longer = top.observed > top.predicted;
    // Control keeps its official number (user ruling, ccFullDurationSeconds);
    // ccSpellIds is the CC-typed subset of SPELL_CATEGORIES, not the whole
    // table (Prayer of Mending is in the table and is not control).
    const isCc = ccSpellIds.has(spellId);
    const overBar = !!lm && lm.share >= 0.6 && lm.total >= 100;
    const verdict = isCc
      ? "CC-官方值"
      : !longer
        ? "变短-要机制"
        : overBar
          ? "候选"
          : "证据不足";
    if (verdict === "候选") qualifying++;
    rowsOut.push(
      `  ${verdict.padEnd(8)} ${spellId} ${spellEffectData[spellId]?.name ?? ""}: 观测 ${top.observed}s ×${top.n} 格 vs 谓词 ${top.predicted}s` +
        (lm
          ? `;寿命 n=${lm.total} 众数 ${lm.mode}s 占 ${(100 * lm.share).toFixed(0)}%`
          : ""),
    );
  }
  rowsOut.sort();
  console.log(rowsOut.join("\n") || "  (无)");
  console.log(
    `\nGAP 结论: ${rowsOut.length} 个光环待定夺,其中 ${qualifying} 个过提名门(掩码那一半需人工核 SpellClassOptions;补丁前还要数施放次数)`,
  );
}
