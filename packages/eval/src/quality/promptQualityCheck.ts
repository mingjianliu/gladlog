/* eslint-disable no-console */
/**
 * promptQualityCheck.ts
 *
 * Deterministic prompt-quality checks against the ground-truth coverage
 * manifests written by buildHealerPromptCorpus.ts. This replaces the LLM judge
 * for the mechanically checkable half of the rubric:
 *
 *   - sufficiency (coverage): every friendly death, and the bulk of CC /
 *     interrupt / dispel / trinket events present in the raw log, must be
 *     visible in the prompt text. The judge cannot see what the builder
 *     dropped — this check can, because the manifest is built from raw parser
 *     events, not from the prompt builder.
 *   - noise: measured duplicate-line ratios and known spam patterns.
 *   - labelBias: severity-lexicon hits with line numbers.
 *
 * It reports MEASURED METRICS only — never 1–5 rubric scores (see the Eval
 * Integrity section of AGENTS.md). The LLM judge stays responsible for the
 * dimensions that need judgment (outcomeAlignment, focusCalibration, …) and
 * reads this tool's output instead of guessing sufficiency/noise on its own.
 *
 * Usage:
 *   npm run -w @wowarenalogs/tools start:promptQualityCheck
 *   BASE_DIR=packages/tools/local-batch/healer-eval/ab-test/treatment \
 *     npm run -w @wowarenalogs/tools start:promptQualityCheck
 *   STRICT=1 …   # exit 1 if any friendly death is missing from its prompt
 *
 * Expects under BASE_DIR: prompts/, manifests/, index.json.
 */

import fs from "fs-extra";
import path from "path";

import { CoverageManifest } from "./coverageManifest";

const DEATH_KEYWORDS = /death|died|dies|killed|\[DEATH\]/i;
const RES_READY_SPAM = /\[RES\] rdy:/;
const BIAS_LEXICON = [
  "[CRITICAL]",
  "[SPIKE]",
  "disastrous",
  "catastrophic",
  "critical failure",
  "fatal mistake",
  "terrible",
  "inexcusable",
  "panicked",
  "huge mistake",
];

export interface IndexEntry {
  ordinal: number;
  file: string;
  matchId: string;
  spec: string;
  result: string;
}

interface CoverageResult {
  present: number;
  total: number;
  missing: string[];
}

export interface MatchQuality {
  ordinal: number;
  matchId: string;
  spec: string;
  coverage: {
    friendlyDeaths: CoverageResult;
    ccSpells: CoverageResult;
    interruptSpells: CoverageResult;
    dispels: CoverageResult;
    trinketCasts: CoverageResult;
  };
  noise: {
    totalLines: number;
    approxTokens: number;
    exactDuplicateRatio: number;
    templateDuplicateRatio: number;
    resReadySpamLines: number;
  };
  labelBias: {
    hits: { term: string; count: number; sampleLines: number[] }[];
    totalHits: number;
  };
  hardFailures: string[];
}

interface NamedEvent {
  spellId: string | null;
  spellName: string | null;
  spellNameEn: string | null;
}

/** An event counts as covered if EITHER its logged (localized) name or its
 * canonical English name appears in the prompt — non-EN logs carry localized
 * names while the builder renders English from static data. */
export function checkSpells(
  promptText: string,
  events: NamedEvent[],
): CoverageResult {
  const distinct = new Map<string, string[]>();
  for (const e of events) {
    const candidates = [e.spellName, e.spellNameEn].filter(
      (n): n is string => !!n && n.length > 0,
    );
    if (candidates.length === 0) continue;
    distinct.set(e.spellId ?? candidates[0], candidates);
  }
  const missing: string[] = [];
  for (const [, candidates] of distinct) {
    if (!candidates.some((name) => promptText.includes(name))) {
      missing.push(candidates[candidates.length - 1]);
    }
  }
  return {
    present: distinct.size - missing.length,
    total: distinct.size,
    missing,
  };
}

/** Prompts never print the trinket spell name ("Gladiator's Medallion") — uses
 * are rendered as annotations like "trinketed", "trinket broke this CC", or a
 * "[TRINKET]" marker (status lines like "trinket: ON CD" are not uses). Count
 * use-annotation lines against the manifest's cast count. */
const TRINKET_USE =
  /trinketed|trinket broke|\[(ENEMY )?TRINKET\]|trinket:\s*used/i;

export function checkTrinkets(
  promptLines: string[],
  manifest: CoverageManifest,
): CoverageResult {
  const total = manifest.counts.trinketCasts;
  const mentions = promptLines.filter((l) => TRINKET_USE.test(l)).length;
  const present = Math.min(mentions, total);
  const missing =
    total > present
      ? [`${total - present} of ${total} trinket casts have no use annotation`]
      : [];
  return { present, total, missing };
}

export function checkFriendlyDeaths(
  promptLines: string[],
  manifest: CoverageManifest,
): CoverageResult {
  const friendlyDeaths = manifest.deaths.filter(
    (d) => d.reaction === "friendly",
  );
  const specByName = new Map(manifest.players.map((p) => [p.name, p.spec]));
  const missing: string[] = [];
  for (const death of friendlyDeaths) {
    // Prompts may reference the dead unit by short name ("Looß" from
    // "Looß-Tichondrius-US") or by unit-id + spec label ("1 (Discipline
    // Priest — friendly)") — accept either on a death-keyword line.
    const shortName = death.unitName.split("-")[0];
    const spec = specByName.get(death.unitName);
    const mentioned = promptLines.some(
      (line) =>
        DEATH_KEYWORDS.test(line) &&
        (line.includes(shortName) || (!!spec && line.includes(spec))),
    );
    if (!mentioned) missing.push(`${death.unitName} @ ${death.tRelSec}s`);
  }
  return {
    present: friendlyDeaths.length - missing.length,
    total: friendlyDeaths.length,
    missing,
  };
}

/**
 * 一行里的百分位记号,如 `Marksmanship Hunter (n=87): p50 214k | p90 65k`。
 * 数字后可带单位后缀(k/m/s/%),同一行的记号必须同单位才比较。
 */
const PERCENTILE_TOKEN = /\bp(\d{1,2})\s+(-?\d+(?:\.\d+)?)(k|m|s|%)?/gi;

/**
 * 硬不变量:同一行里的百分位序列必须**单调不减**(p50 ≤ p75 ≤ p90 ≤ p95)。
 *
 * 2026-07-20 的 50 场 eval 里 11 场读到倒置基线(`p50 214k | p90 65k`),根因是
 * benchmarks 样本池混入 NaN 后 `sort((a,b)=>a-b)` 静默留下乱序数组。那类 bug
 * 产出的仍是「看起来正常的数字」,只有顺序不对 —— 模型和人都极难发现,但这条
 * 确定性检查一抓一个准,且不依赖任何模型判断。
 *
 * 按「门规谓词即规范」:这里**重新解析渲染后的 prompt 文本**,而不是去读分析
 * 内部的对象。判据锚定在模型真正读到的那串字符上。
 */
export function checkPercentileMonotonicity(lines: string[]): string[] {
  const violations: string[] = [];
  lines.forEach((line, i) => {
    const byUnit = new Map<string, { pct: number; value: number }[]>();
    for (const m of line.matchAll(PERCENTILE_TOKEN)) {
      const unit = (m[3] ?? "").toLowerCase();
      if (!byUnit.has(unit)) byUnit.set(unit, []);
      byUnit.get(unit)!.push({ pct: Number(m[1]), value: Number(m[2]) });
    }
    for (const [unit, tokens] of byUnit) {
      if (tokens.length < 2) continue;
      const seq = [...tokens].sort((a, b) => a.pct - b.pct);
      for (let k = 1; k < seq.length; k++) {
        if (seq[k].value < seq[k - 1].value) {
          violations.push(
            `line ${i + 1}: p${seq[k - 1].pct} ${seq[k - 1].value}${unit} > p${seq[k].pct} ${seq[k].value}${unit} — 百分位倒置: ${line.trim()}`,
          );
          break;
        }
      }
    }
  });
  return violations;
}

// "0:27  [DMG SPIKE]   2(SHunter) (Survival Hunter): 0.88M in 10s (…) (79% -> 29% HP, …)"
const SPIKE_HP =
  /^(\d+):(\d+)\s+\[DMG SPIKE\]\s+(\S+)\s+\([^)]*\):.*?\((\d+)%\s*->\s*(\d+)%\s*HP/;
// "0:15  [YOU] [CD]   Holy Word: Chastise → 6(RPaladin) (68% HP)" —— C 类的行内嵌 HP
const INLINE_HP = /^(\d+):(\d+)\s+.*?→\s*(\S+)\s*\((\d+)%\s*HP/;
// "0:21  [STATE]   friends 1(HPriest):99 2(SHunter):76 / enemies 4(AWarrior):90"
const STATE_LINE = /^(\d+):(\d+)\s+\[STATE\]\s+(.*)$/;
/** 允许的良性采样抖动(百分点)。超过这个值即视为两条渲染路径打架。 */
const HP_AGREEMENT_TOLERANCE_PP = 3;

/**
 * 硬不变量:同一渲染秒、同一单位,`[DMG SPIKE]` 声称的 HP 必须与 `[STATE]` 一致。
 *
 * 2026-07-20 实证:修前 26/50 场共 33 处矛盾(中位 7pp,最大 25pp),根因是
 * STATE 按整数秒采样而 DMG SPIKE 按小数秒采样,却渲染成同一个显示秒。
 * 注意曾走过的弯路:按「统一采样半径」修实测一个数都没动 —— 半径只控制
 * 接受/拒绝,不改变取到的样本。判据必须锚定在**渲染文本**上,才能测出真效果。
 */
export function checkSameSecondHpConsistency(lines: string[]): string[] {
  const stateAt = new Map<number, Map<string, number>>();
  for (const line of lines) {
    const m = line.match(STATE_LINE);
    if (!m) continue;
    const units = new Map<string, number>();
    for (const u of m[3].matchAll(/(\S+?):(\d+)\b/g))
      units.set(u[1], Number(u[2]));
    stateAt.set(Number(m[1]) * 60 + Number(m[2]), units);
  }

  const violations: string[] = [];
  lines.forEach((line, i) => {
    // [DMG SPIKE] 的 "X% -> Y% HP"(A 类)与行内嵌 "→ 目标 (X% HP)"(C 类)
    // 是同一条不变量的两种渲染形态,共用一套判据。
    const isSpike = line.includes("[DMG SPIKE]");
    const m = isSpike ? line.match(SPIKE_HP) : line.match(INLINE_HP);
    if (!m) return;
    const t = Number(m[1]) * 60 + Number(m[2]);
    const stateHp = stateAt.get(t)?.get(m[3]);
    if (stateHp === undefined) return;
    const claimed = Number(m[4]);
    const delta = Math.abs(stateHp - claimed);
    if (delta > HP_AGREEMENT_TOLERANCE_PP) {
      violations.push(
        `line ${i + 1}: ${m[1]}:${m[2]} ${m[3]} — ${isSpike ? "[DMG SPIKE]" : "行内嵌"} 报 ${claimed}% 而同秒 [STATE] 报 ${stateHp}%(Δ${delta}pp)`,
      );
    }
  });
  return violations;
}

// "2:57–3:15 (19s)" —— 窗口起止 + 标注时长
const WINDOW_SPAN = /(\d+):(\d+)–(\d+):(\d+)\s*\((\d+)s\)/g;

/**
 * 硬不变量:窗口标注的时长必须等于显示的起止之差。
 *
 * 2026-07-20 eval 的 E/G 类「窗口时长口径不明」:`2:57–3:15 (19s)` —— 读者按
 * 显示的时间戳相减得 18s,标注却是 19s(标注取自未取整的原始值)。渲染物
 * 必须自洽,否则同一记号可被读成两个数。
 */
export function checkWindowSpanConsistency(lines: string[]): string[] {
  const violations: string[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(WINDOW_SPAN)) {
      const from = Number(m[1]) * 60 + Number(m[2]);
      const to = Number(m[3]) * 60 + Number(m[4]);
      const labelled = Number(m[5]);
      if (to - from !== labelled) {
        violations.push(
          `line ${i + 1}: ${m[1]}:${m[2]}–${m[3]}:${m[4]} 相减为 ${to - from}s,却标注 (${labelled}s)`,
        );
      }
    }
  });
  return violations;
}

export function duplicateRatio(
  lines: string[],
  normalize: (line: string) => string,
): number {
  const nonEmpty = lines.map(normalize).filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const line of nonEmpty) counts.set(line, (counts.get(line) ?? 0) + 1);
  let duplicated = 0;
  for (const count of counts.values()) if (count > 1) duplicated += count - 1;
  return Math.round((duplicated / nonEmpty.length) * 1000) / 1000;
}

export function checkMatch(
  entry: IndexEntry,
  promptText: string,
  manifest: CoverageManifest,
): MatchQuality {
  const lines = promptText.split("\n");

  const friendlyDeaths = checkFriendlyDeaths(lines, manifest);
  const coverage = {
    friendlyDeaths,
    ccSpells: checkSpells(promptText, manifest.ccApplied),
    interruptSpells: checkSpells(promptText, manifest.interrupts),
    dispels: checkSpells(promptText, manifest.dispels),
    trinketCasts: checkTrinkets(lines, manifest),
  };

  const labelHits = BIAS_LEXICON.map((term) => {
    const needle = term.toLowerCase();
    const sampleLines: number[] = [];
    let count = 0;
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(needle)) {
        count++;
        if (sampleLines.length < 5) sampleLines.push(i + 1);
      }
    });
    return { term, count, sampleLines };
  }).filter((h) => h.count > 0);

  const hardFailures: string[] = [];
  if (friendlyDeaths.missing.length > 0) {
    hardFailures.push(
      `friendly death(s) absent from prompt: ${friendlyDeaths.missing.join(", ")}`,
    );
  }
  hardFailures.push(...checkPercentileMonotonicity(lines));
  hardFailures.push(...checkSameSecondHpConsistency(lines));
  hardFailures.push(...checkWindowSpanConsistency(lines));

  return {
    ordinal: entry.ordinal,
    matchId: entry.matchId,
    spec: entry.spec,
    coverage,
    noise: {
      totalLines: lines.length,
      approxTokens: Math.round(promptText.length / 4),
      exactDuplicateRatio: duplicateRatio(lines, (l) => l),
      templateDuplicateRatio: duplicateRatio(lines, (l) =>
        l.replace(/\d+(\.\d+)?/g, "#"),
      ),
      resReadySpamLines: lines.filter((l) => RES_READY_SPAM.test(l)).length,
    },
    labelBias: {
      hits: labelHits,
      totalHits: labelHits.reduce((sum, h) => sum + h.count, 0),
    },
    hardFailures,
  };
}

function coveragePct(r: CoverageResult): string {
  if (r.total === 0) return "  n/a";
  return `${String(Math.round((r.present / r.total) * 100)).padStart(4)}%`;
}

export async function main(): Promise<void> {
  const baseDir = process.env.BASE_DIR ?? "";
  const strict = process.env.STRICT === "1";

  if (!baseDir) {
    console.error(
      "BASE_DIR environment variable is not set. Please set BASE_DIR or use --run with GLADLOG_EVAL_HOME.",
    );
    process.exit(1);
  }

  const indexFile = path.join(baseDir, "index.json");
  if (!(await fs.pathExists(indexFile))) {
    console.error(`No index.json under ${baseDir} — build a corpus first.`);
    process.exit(1);
  }
  const entries = (await fs.readJson(indexFile)) as IndexEntry[];
  const manifestsDir = path.join(baseDir, "manifests");
  if (!(await fs.pathExists(manifestsDir))) {
    console.error(
      `No manifests/ under ${baseDir}. Rebuild the corpus (the builder now writes manifests/NNN.json).`,
    );
    process.exit(1);
  }

  const results: MatchQuality[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const ordinalStr = String(entry.ordinal).padStart(3, "0");
    const promptPath = path.join(baseDir, entry.file);
    const manifestPath = path.join(manifestsDir, `${ordinalStr}.json`);
    if (
      !(await fs.pathExists(promptPath)) ||
      !(await fs.pathExists(manifestPath))
    ) {
      console.warn(`  ${ordinalStr}: prompt or manifest missing, skipping`);
      skipped++;
      continue;
    }
    const promptText = await fs.readFile(promptPath, "utf8");
    const manifest = (await fs.readJson(manifestPath)) as CoverageManifest;
    results.push(checkMatch(entry, promptText, manifest));
  }

  const reportPath = path.join(baseDir, "quality-report.json");
  await fs.writeJson(
    reportPath,
    {
      generatedAt: new Date().toISOString(),
      baseDir,
      skipped,
      results,
    },
    {
      spaces: 2,
    },
  );

  console.log(
    `\nPrompt quality check — ${results.length} match(es), ${skipped} skipped`,
  );
  console.log(
    "ord  deaths   cc    kicks  disp  trink  dupEx  dupTmpl  resSpam  biasHits",
  );
  for (const r of results) {
    console.log(
      [
        String(r.ordinal).padStart(3, "0"),
        coveragePct(r.coverage.friendlyDeaths),
        coveragePct(r.coverage.ccSpells),
        coveragePct(r.coverage.interruptSpells),
        coveragePct(r.coverage.dispels),
        coveragePct(r.coverage.trinketCasts),
        r.noise.exactDuplicateRatio.toFixed(3).padStart(6),
        r.noise.templateDuplicateRatio.toFixed(3).padStart(7),
        String(r.noise.resReadySpamLines).padStart(7),
        String(r.labelBias.totalHits).padStart(8),
      ].join("  "),
    );
  }

  const failures = results.filter((r) => r.hardFailures.length > 0);
  if (failures.length > 0) {
    console.log(`\nHARD FAILURES (${failures.length} match(es)):`);
    for (const f of failures) {
      for (const msg of f.hardFailures)
        console.log(
          `  ${String(f.ordinal).padStart(3, "0")} ${f.matchId}: ${msg}`,
        );
    }
  } else {
    console.log("\nNo hard failures (all friendly deaths present in prompts).");
  }
  console.log(`\nFull report: ${reportPath}`);

  if (strict && failures.length > 0) process.exit(1);
}
