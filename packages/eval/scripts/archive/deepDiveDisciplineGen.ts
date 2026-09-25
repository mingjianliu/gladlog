// Deep-dive discipline smoke (generation stage): pick N real death anchors
// from the DPS corpus, build the deep-dive evidence pack + prompt, write the
// prompt to a file for the responder to answer, and serialize the pack for the
// audit stage.
import {
  buildDeepDivePack,
  buildDeepDivePrompt,
  extractCandidateFindings,
  type Finding,
  isHealerSpec,
  specToString,
  ensureAnalysisData,
} from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { CombatUnitReaction, toLegacyMatch } from "@gladlog/parser-compat";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { resolveEvalHome } from "../../src/evalHome";

// Prompt builders read the background-loaded talent / spell-name tables
// (data/ensure.ts contract) — without this the first combats are degraded.
await ensureAnalysisData();

// Corpus directory resolved from $GLADLOG_EVAL_HOME (never a hardcoded
// absolute path); --corpus <dir> overrides it.
const argv = process.argv.slice(2);
const cIdx = argv.indexOf("--corpus");
const positional = argv.filter(
  (a, i) =>
    !a.startsWith("--") && !(cIdx >= 0 && (i === cIdx || i === cIdx + 1)),
);
const dir =
  cIdx >= 0 ? argv[cIdx + 1]! : join(resolveEvalHome(), "corpus", "public-dps");
const outDir = positional[0] ?? "/tmp/deepdive-smoke";
const WANT = Number(positional[1] ?? 6);
mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "prompts"), { recursive: true });

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".txt"))
  .sort();

let n = 0;
const index: Array<{ ord: number; match: string; spec: string }> = [];
for (const f of files) {
  if (n >= WANT) break;
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m: GladMatch) => items.push(m));
  for (const line of readFileSync(join(dir, f), "utf8").split("\n"))
    parser.push(line);
  parser.end();
  for (const m of items) {
    if (n >= WANT) break;
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
    const cands = extractCandidateFindings(legacy, owner.id);
    // Take the latest friendly death anchor (the most typical "endgame kill")
    const deathCand = cands
      .filter((c) => c.type === "death" && c.facts.side === "friendly")
      .sort((a, b) => b.t - a.t)[0];
    if (!deathCand) continue;
    const finding: Finding = {
      eventIds: [deathCand.id],
      severity: "high",
      category: "survival",
      title: `${deathCand.unitNames[0]?.split("-")[0]} 阵亡`,
      explanation: "队友阵亡于终局击杀窗口。",
    };
    const pack = buildDeepDivePack(legacy, finding, 0, cands);
    if (!pack) continue;
    const spec = specToString(owner.spec);
    const prompt = buildDeepDivePrompt([pack], [finding], spec);
    const ord = ++n;
    const tag = `${String(ord).padStart(2, "0")}`;
    writeFileSync(join(outDir, "prompts", `${tag}.txt`), prompt);
    writeFileSync(
      join(outDir, `${tag}.pack.json`),
      JSON.stringify({ pack, finding }, null, 1),
    );
    index.push({ ord, match: f.slice(0, 12), spec });
  }
}
writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 1));
console.warn(`生成 ${n} 个深挖 prompt → ${outDir}/prompts/`);
for (const e of index)
  console.warn(`  ${String(e.ord).padStart(2, "0")}  ${e.match}  ${e.spec}`);
