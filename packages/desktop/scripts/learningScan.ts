/**
 * On-library acceptance tool for the learning chain (CLAUDE.md verification
 * rule: a fix/feature must come with before/after numbers under the SAME
 * criterion). Reads the real library directly, backfills a temporary ledger →
 * scanPatterns, and prints: ledger match count / stable pattern count / per
 * pattern hit detail. It then re-derives each rule's stats in rules.json (if
 * present) from the ledger and exits 1 on any mismatch.
 *
 * Usage: npx tsx scripts/learningScan.ts [matchesDir] [learningDir]
 * Default matchesDir = ~/Library/Application Support/gladlog/matches (mac).
 */
import { normalizeFindingCategory } from "@gladlog/analysis/src/analysis/findingCategories";
import {
  measureGroup,
  scanPatterns,
} from "@gladlog/analysis/src/learning/patternScan";
import type {
  LedgerMatch,
  RulesDoc,
} from "@gladlog/analysis/src/learning/types";
import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { resolveActiveSlot, toSlottedDoc } from "../src/shared/analysisCache";

const matchesDir =
  process.argv[2] ??
  join(homedir(), "Library/Application Support/gladlog/matches");
const learningDir = process.argv[3] ?? join(matchesDir, "..", "learning");

// The three ways a match can stay out of the ledger are distinct and counted
// separately — a single silent `continue` would let "skipped due to a
// cache/meta parse problem" masquerade as "never analysed", and then the
// acceptance tool could not prove it missed nothing (caught in the 2026-07-26
// review).
let noAnalysis = 0; // no analysis-v2*.json cache for this match at all
let skippedBadMeta = 0; // cached, but meta.json lacks startTime or won't parse
let badDoc = 0; // cached, but analysis-v2*.json itself won't parse

const matches: LedgerMatch[] = [];
for (const dir of readdirSync(matchesDir).filter(
  (d) => !d.startsWith(".") && !d.startsWith("_"),
)) {
  const base = join(matchesDir, dir);
  const file = [
    "analysis-v2.zh.json",
    "analysis-v2.en.json",
    "analysis-v2.json",
  ].find((f) => existsSync(join(base, f)));
  if (!file) {
    noAnalysis++;
    continue;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(base, file), "utf-8"));
  } catch {
    badDoc++;
    continue;
  }
  // Keeps the original version-gate semantics (this script never checked
  // promptVersion anyway, matching learning.ts::runBackfill's backfill
  // criterion); only the read path changed, to the slotted read of the
  // lastSlotKey slot.
  const doc2 = toSlottedDoc<{
    findings?: Array<{ category: string; severity: string }>;
  }>(raw, "legacy:unknown");
  const slot = resolveActiveSlot(doc2);

  let meta: {
    id?: string;
    startTime?: number;
    result?: string;
    zoneId?: string;
    bracket?: string;
    teams?: Array<Array<{ specId: number }>>;
  };
  try {
    meta = JSON.parse(readFileSync(join(base, "meta.json"), "utf-8"));
  } catch {
    skippedBadMeta++;
    continue;
  }
  if (typeof meta.startTime !== "number") {
    skippedBadMeta++;
    continue;
  }

  matches.push({
    matchId: meta.id ?? dir,
    startTime: meta.startTime,
    win: String(meta.result ?? "")
      .toLowerCase()
      .startsWith("win"),
    zoneId: meta.zoneId,
    bracket: meta.bracket,
    enemySpecs: (meta.teams?.[1] ?? [])
      .map((t: { specId: number }) => t.specId)
      .filter((s: number) => s > 0),
    findings: (slot?.result?.findings ?? []).map((f) => ({
      category: normalizeFindingCategory(f.category),
      severity: f.severity,
      eventTypes: [],
    })),
  });
}

console.log(`台账(直读回填口径): ${matches.length} 场`);
console.log(
  `  无分析缓存: ${noAnalysis} 场  meta 坏/缺 startTime: ${skippedBadMeta} 场  分析缓存解析失败: ${badDoc} 场`,
);
if (skippedBadMeta + badDoc > 0) {
  console.error(
    `⚠ 有 ${skippedBadMeta + badDoc} 场存在分析缓存但被跳过(meta 坏/缺 startTime=${skippedBadMeta},缓存 JSON 解析失败=${badDoc})—— 这些场本该进台账,请检查是否是坏档而非"未分析"。`,
  );
}
const patterns = scanPatterns(matches);
console.log(`稳定模式: ${patterns.length} 个`);
for (const p of patterns)
  console.log(
    `  ${p.patternId}  hits=${p.hits}/${p.windowMatches}  trend=[${p.trend.join(",")}]  例=${p.exampleMatchIds.join(",")}`,
  );

// rules.json review: every rule's stats must match a recomputation from the
// ledger
const rulesPath = join(learningDir, "rules.json");
if (existsSync(rulesPath)) {
  const doc = JSON.parse(readFileSync(rulesPath, "utf-8")) as RulesDoc;
  let bad = 0;
  for (const r of doc.rules) {
    const g = measureGroup(matches, r.category, r.eventTypes, r.condition);
    if (g.hits !== r.stats.hits || g.windowMatches !== r.stats.windowMatches) {
      // Note: the app's rules.json is built on a ledger that carries live
      // eventTypes, whereas this direct-read backfill leaves eventTypes empty
      // — so type-level rules are allowed to differ, but category-level rules
      // must agree.
      if (r.eventTypes.length === 0) {
        console.error(
          `✗ ${r.ruleId}: rules.json hits=${r.stats.hits}/${r.stats.windowMatches},重算=${g.hits}/${g.windowMatches}`,
        );
        bad++;
      }
    }
  }
  console.log(
    bad === 0
      ? `rules.json 复核: ${doc.rules.length} 条全部与台账重算一致 ✓`
      : `rules.json 复核: ${bad} 条不一致 ✗`,
  );
  if (bad > 0) process.exit(1);
} else {
  console.log("rules.json 不存在(app 内尚未整合)—— 只报模式扫描结果");
}
