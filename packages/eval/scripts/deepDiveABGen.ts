// 深挖 prompt 修改 A/B(生成):过信号门的真死亡锚点,同一 pack 出两版
// prompt —— before(v9:无 owner 锚定/无留白许可)vs after(v10:current
// buildDeepDivePrompt)。同 pack 只变指令 → 隔离 prompt 修改的价值贡献。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
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
  type DeepDivePack,
  type Finding,
} from "@gladlog/analysis";

const corpus = process.argv[2]!;
const outDir = process.argv[3] ?? "/tmp/deepdive-ab";
const WANT = Number(process.argv[4] ?? 8);
mkdirSync(join(outDir, "before"), { recursive: true });
mkdirSync(join(outDir, "after"), { recursive: true });
mkdirSync(join(outDir, "before-resp"), { recursive: true });
mkdirSync(join(outDir, "after-resp"), { recursive: true });

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// v9 before-prompt:current buildDeepDivePrompt 修改前的指令(无 owner 锚定/
// 无干净窗口留白/无"下结论别对冲"),pack 清单格式与 after 相同(隔离指令变量)。
function beforePrompt(
  packs: DeepDivePack[],
  findings: Finding[],
  specName: string,
): string {
  const sections = packs.map((p) => {
    const f = findings[p.findingIndex]!;
    const listing = p.items
      .map(
        (it) =>
          `  - key=${it.key} kind=${it.kind} facts={${Object.entries(it.facts)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")}}`,
      )
      .join("\n");
    return [
      `FINDING ${p.findingIndex}: [${f.severity}] ${f.title} — ${f.explanation}`,
      `EVIDENCE PACK ${p.findingIndex} (window ${fmt(p.anchorFrom)}s–${fmt(p.anchorTo)}s; the ONLY additional evidence you may reference):`,
      listing,
    ].join("\n");
  });
  return [
    `You are a World of Warcraft arena coach deepening findings from a ${specName}'s match review. For EACH finding below, write ONE short paragraph (3-5 sentences) that digs into the underlying play using ONLY its evidence pack.`,
    ``,
    ...sections,
    ``,
    `HARD RULES:`,
    `- Reference only pack items; list the keys you used in "citedKeys" (non-empty).`,
    `- Write NO digits in "deepDive". Every number must be a {{key.field}} placeholder from that finding's pack (e.g. {{p1.t}}, {{p2.duration}}). Words for counts ("twice", "briefly") are fine.`,
    `- Do NOT assert causation ("led to"/"caused"/"resulted in" a death/loss). Describe the sequence neutrally and coach what to do differently at these moments.`,
    ``,
    `Output ONLY a JSON array: [{ "findingIndex": number, "deepDive": string, "citedKeys": string[] }]`,
  ].join("\n");
}

const files = readdirSync(corpus)
  .filter((f) => f.endsWith(".txt"))
  .sort();
let n = 0;
const index: Array<{ ord: number; match: string; spec: string }> = [];
for (const file of files) {
  if (n >= WANT) break;
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m: GladMatch) => items.push(m));
  for (const line of readFileSync(join(corpus, file), "utf8").split("\n"))
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
    const death = cands
      .filter((c) => c.type === "death" && c.facts.side === "friendly")
      .sort((a, b) => b.t - a.t)[0];
    if (!death) continue;
    const finding: Finding = {
      eventIds: [death.id],
      severity: "high",
      category: "survival",
      title: `${death.unitNames[0]?.split("-")[0]} 阵亡`,
      explanation: "队友阵亡于终局击杀窗口。",
    };
    const pack = buildDeepDivePack(legacy, finding, 0, cands, owner.name);
    if (!pack || !hasCoachableSignal(pack.items)) continue; // 只取过门的
    const spec = specToString(owner.spec);
    const ord = ++n;
    const tag = String(ord).padStart(2, "0");
    writeFileSync(
      join(outDir, "before", `${tag}.txt`),
      beforePrompt([pack], [finding], spec),
    );
    writeFileSync(
      join(outDir, "after", `${tag}.txt`),
      buildDeepDivePrompt([pack], [finding], spec, owner.name),
    );
    writeFileSync(
      join(outDir, `${tag}.pack.json`),
      JSON.stringify({ pack, finding }, null, 1),
    );
    index.push({ ord, match: file.slice(0, 12), spec });
  }
}
writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 1));
console.warn(`生成 ${n} 组 before/after prompt → ${outDir}`);
for (const e of index)
  console.warn(`  ${String(e.ord).padStart(2, "0")}  ${e.match}  ${e.spec}`);
