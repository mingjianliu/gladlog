// Deep-dive robustness scan (deterministic, large-sample bug hunting): over one
// or more corpus directories, run the full buildDeepDivePack +
// hasCoachableSignal for every friendly death anchor, asserting invariants,
// tallying distributions, and catching crashes / degenerate packs / digits left
// in name fields / per-spec anomalies. No model calls.
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import {
  extractCandidateFindings,
  isHealerSpec,
  buildDeepDivePack,
  buildDeepDivePrompt,
  hasCoachableSignal,
  specToString,
  type Finding,
  ensureAnalysisData,
} from "@gladlog/analysis";

// Prompt builders read the background-loaded talent / spell-name tables
// (data/ensure.ts contract) — without this the first combats are degraded.
await ensureAnalysisData();

const dirs = process.argv.slice(2);
if (dirs.length === 0)
  throw new Error("usage: deepDiveScan.ts <dir> [dir2 ...]");

let files: string[] = [];
for (const d of dirs)
  for (const f of readdirSync(d).filter((f) => f.endsWith(".txt")))
    files.push(join(d, f));
// Dedupe (corpora from different rating brackets can overlap; the file name is
// matchId = content hash)
files = [...new Map(files.map((f) => [f.split("/").pop(), f])).values()];

let matches = 0;
let anchors = 0;
let packBuilt = 0;
let gated = 0;
let parseCrash = 0;
let packCrash = 0;
// Bug assertion counters
const bugs = {
  missingRole: 0, // pack item facts missing role
  factsMismatch: 0, // pack.facts keys inconsistent with items
  digitInName: [] as string[], // digits left in name-type fact values (the bare-number audit would kill them)
  promptCrash: 0, // buildDeepDivePrompt threw
  degeneratePack: 0, // passed the gate but has only 1 piece of evidence (suspicious)
  emptyOwner: 0, // owner could not be determined
};
const packSizes: number[] = [];
const bySpec = new Map<string, { anchors: number; gated: number }>();
// t/duration/hp are legitimate numeric fields (the model must go through
// placeholders); if any other text field contains digits and the model writes
// the literal, the bare-number audit kills it (realm names were one such case,
// already fixed; spell names carry the same risk).
const NUMERIC_FIELDS = new Set(["t", "duration", "hp", "dist", "hpMin"]);
const hasDigit = /\d/;

for (const path of files) {
  const items: GladMatch[] = [];
  try {
    const parser = new GladLogParser();
    parser.on("match", (m: GladMatch) => items.push(m));
    // Shuffle logs: treat each round as an independent match (otherwise the
    // whole match is silently skipped -- a coverage gap).
    parser.on("shuffle", (sh) => {
      for (const r of sh.rounds) items.push(r as never);
    });
    for (const line of readFileSync(path, "utf8").split("\n"))
      parser.push(line);
    parser.end();
  } catch {
    parseCrash++;
    continue;
  }
  for (const m of items) {
    let legacy;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      parseCrash++;
      continue;
    }
    const players = Object.values(legacy.units).filter((u) => u.info);
    const owner =
      players.find(
        (u) =>
          u.id === legacy.playerId &&
          u.reaction === CombatUnitReaction.Friendly,
      ) ??
      players.find(
        (u) =>
          isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
      );
    if (!owner) {
      bugs.emptyOwner++;
      continue;
    }
    matches++;
    const spec = specToString(owner.spec);
    const sd = bySpec.get(spec) ?? { anchors: 0, gated: 0 };
    let cands;
    try {
      cands = extractCandidateFindings(legacy, owner.id);
    } catch {
      packCrash++;
      continue;
    }
    const deaths = cands.filter(
      (c) => c.type === "death" && c.facts.side === "friendly",
    );
    for (const d of deaths) {
      anchors++;
      sd.anchors++;
      const finding: Finding = {
        eventIds: [d.id],
        severity: "high",
        category: "survival",
        title: `${d.unitNames[0]?.split("-")[0]} 阵亡`,
        explanation: "x",
      };
      let pack;
      try {
        pack = buildDeepDivePack(legacy, finding, 0, cands, owner.name);
      } catch {
        packCrash++;
        continue;
      }
      if (!pack) continue;
      packBuilt++;
      packSizes.push(pack.items.length);

      // Invariant assertions
      for (const it of pack.items) {
        if (it.facts.role === undefined) bugs.missingRole++;
        for (const [k, v] of Object.entries(it.facts)) {
          if (!NUMERIC_FIELDS.has(k) && hasDigit.test(v))
            bugs.digitInName.push(`${it.kind}.${k}=${v}`);
        }
      }
      // facts keys <-> items consistency
      const expected = new Set<string>();
      for (const it of pack.items)
        for (const k of Object.keys(it.facts)) expected.add(`${it.key}.${k}`);
      const got = new Set(Object.keys(pack.facts));
      if (expected.size !== got.size || [...expected].some((k) => !got.has(k)))
        bugs.factsMismatch++;

      const signal = hasCoachableSignal(pack.items);
      if (signal) {
        gated++;
        sd.gated++;
        if (pack.items.length <= 1) bugs.degeneratePack++;
        try {
          buildDeepDivePrompt([pack], [finding], spec, owner.name);
        } catch {
          bugs.promptCrash++;
        }
      }
    }
    bySpec.set(spec, sd);
  }
}

const mean = (a: number[]) =>
  a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : "0";
console.warn(
  `扫描 ${files.length} 文件 · ${matches} 场 · 友方死亡锚点 ${anchors}`,
);
console.warn(
  `构包 ${packBuilt} · 过门 ${gated}(${Math.round((100 * gated) / packBuilt)}%) · 每包 mean ${mean(packSizes)} 条`,
);
console.warn(
  `崩溃:parse ${parseCrash} · pack ${packCrash} · owner 缺失 ${bugs.emptyOwner}`,
);
console.warn("── bug 断言 ──");
console.warn(`  role 缺失:${bugs.missingRole}`);
console.warn(`  facts↔items 不一致:${bugs.factsMismatch}`);
console.warn(`  名字残留数字(裸数字审计误杀风险):${bugs.digitInName.length}`);
if (bugs.digitInName.length)
  console.warn(
    `    样例:${[...new Set(bugs.digitInName)].slice(0, 6).join(" · ")}`,
  );
console.warn(`  prompt 崩溃:${bugs.promptCrash}`);
console.warn(`  过门但退化包(≤1 条):${bugs.degeneratePack}`);
console.warn("── 逐 spec 过门率(挑样本≥8的)──");
for (const [spec, sd] of [...bySpec.entries()].sort(
  (a, b) => b[1].anchors - a[1].anchors,
))
  if (sd.anchors >= 8)
    console.warn(
      `  ${spec.padEnd(22)} 锚点 ${String(sd.anchors).padStart(3)} · 过门 ${Math.round((100 * sd.gated) / sd.anchors)}%`,
    );
