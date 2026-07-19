// 深挖纪律 smoke(生成阶段):从 DPS 语料挑 N 个真实死亡锚点,构建深挖
// 证据包 + prompt,prompt 写文件供 responder 回答,pack 序列化留给审计阶段。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import {
  extractCandidateFindings,
  isHealerSpec,
  buildDeepDivePack,
  buildDeepDivePrompt,
  specToString,
  type Finding,
} from "@gladlog/analysis";

const dir = "/Users/mingjianliu/code/gladlog-eval-private/corpus/public-dps";
const outDir = process.argv[2] ?? "/tmp/deepdive-smoke";
const WANT = Number(process.argv[3] ?? 6);
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
    // 取最靠后的友方死亡锚点(最典型的「终局击杀」)
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
