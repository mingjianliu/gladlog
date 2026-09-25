// Deep-dive yield quantification (model-independent): over the public DPS
// corpus, build a deep-dive evidence pack for every timed first-round candidate
// (a potential finding anchor), and measure "how many pieces of deeper evidence
// not present in the first-round menu can be deterministically dug up around a
// single anchor" plus the type distribution. Answers: can multi-round follow-up
// dig deeper at the mechanical level.
import {
  buildDeepDivePack,
  extractCandidateFindings,
  type Finding,
  isHealerSpec,
  ensureAnalysisData,
} from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { CombatUnitReaction, toLegacyMatch } from "@gladlog/parser-compat";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { resolveEvalHome } from "../../src/evalHome";

// Prompt builders read the background-loaded talent / spell-name tables
// (data/ensure.ts contract) — without this the first combats are degraded.
await ensureAnalysisData();

// Corpus directory resolved from $GLADLOG_EVAL_HOME (never a hardcoded
// absolute path); --corpus <dir> overrides it.
const cIdx = process.argv.indexOf("--corpus");
const dir =
  cIdx >= 0
    ? process.argv[cIdx + 1]!
    : join(resolveEvalHome(), "corpus", "public-dps");
const files = readdirSync(dir).filter((f) => f.endsWith(".txt"));

let matches = 0;
let anchors = 0; // number of timed first-round candidates (potential deep-dive anchors)
let anchorsWithPack = 0; // number of anchors that yield a non-empty evidence pack
const packSizes: number[] = [];
const kindCounts = new Map<string, number>();
// Look at high-severity anchors (death / death-setup) separately: the deep-dive
// mechanism mainly serves them
let deathAnchors = 0;
let deathAnchorsWithPack = 0;
const deathPackSizes: number[] = [];

for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m: GladMatch) => items.push(m));
  for (const line of readFileSync(join(dir, f), "utf8").split("\n"))
    parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
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
    if (!owner) continue;
    matches++;
    const cands = extractCandidateFindings(legacy, owner.id);
    for (const c of cands) {
      if (c.facts.t === undefined || !(c.t > 0)) continue; // whole-match observations have no anchor
      anchors++;
      const isDeath = c.type === "death" || c.type === "death-setup";
      if (isDeath) deathAnchors++;
      // Wrap the candidate as a single-event finding and feed it to the
      // deep-dive pack builder (the same path the renderer triggers)
      const finding: Finding = {
        eventIds: [c.id],
        severity: isDeath ? "high" : "med",
        category: c.type,
        title: c.type,
        explanation: "x",
      };
      const pack = buildDeepDivePack(legacy, finding, 0, cands);
      if (!pack) continue;
      anchorsWithPack++;
      packSizes.push(pack.items.length);
      for (const it of pack.items)
        kindCounts.set(it.kind, (kindCounts.get(it.kind) ?? 0) + 1);
      if (isDeath) {
        deathAnchorsWithPack++;
        deathPackSizes.push(pack.items.length);
      }
    }
  }
}

const mean = (a: number[]) =>
  a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : "0";
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
};
const pctGE = (a: number[], n: number) =>
  a.length
    ? `${Math.round((100 * a.filter((x) => x >= n).length) / a.length)}%`
    : "0%";

console.warn(`语料 ${matches} 场 · 带时刻锚点 ${anchors} 个`);
console.warn(
  `深挖构包成功率:${anchorsWithPack}/${anchors} = ${Math.round((100 * anchorsWithPack) / anchors)}%`,
);
console.warn(
  `每锚点证据包条目:mean ${mean(packSizes)} · median ${median(packSizes)} · ≥5 条占 ${pctGE(packSizes, 5)} · ≥8 条占 ${pctGE(packSizes, 8)}`,
);
console.warn(
  `其中死亡类锚点(深挖主服务对象):${deathAnchorsWithPack}/${deathAnchors} 有包 · mean ${mean(deathPackSizes)} 条 · median ${median(deathPackSizes)}`,
);
console.warn("证据包类型分布(全部锚点合计):");
for (const [k, n] of [...kindCounts.entries()].sort((a, b) => b[1] - a[1]))
  console.warn(`  ${k.padEnd(10)} ${n}`);
