// 走位信号(修 3)价值 eval —— 生成器。修 3 的「before」是沉默:被救回的窗口
// 过去过不了信号门、不产深挖。故价值问题 = 新产的走位深挖是好教练还是填充?
// 设计:同语料两桶,同 v11 after-prompt,judge 盲评后揭盲比均值。
//   桶 A(recovered):过门 且 仅靠走位过门(去掉走位则资源信号不成立)。
//   桶 B(resource):靠资源信号过门(对照锚,证明 judge 尺子正常 + 走位不劣于资源)。
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
  type Finding,
  type PackItem,
} from "@gladlog/analysis";

const dirs = process.argv[2]!.split(",");
const outDir = process.argv[3] ?? "/tmp/deepdive-pos-value";
const WANT_EACH = Number(process.argv[4] ?? 18);
mkdirSync(join(outDir, "prompts"), { recursive: true });

// 资源信号(与 hasCoachableSignal 同判据,但不含 position)—— 用来判「仅靠走位」。
const resourceSignal = (it: PackItem[]) => {
  const enemyCd = it.some((i) => i.kind === "enemy-cd");
  return it.some((i) => {
    const f = i.facts;
    if (f.role === "enemy") return false;
    if (i.kind === "defensive" && (f.timing === "Early" || f.timing === "Late"))
      return true;
    if (
      i.kind === "cc" &&
      f.trinket === "available_unused" &&
      Number(f.duration) >= 3
    )
      return true;
    if (i.kind === "dispel" && f.priority === "Low" && enemyCd) return true;
    return false;
  });
};

let files: string[] = [];
for (const d of dirs)
  for (const f of readdirSync(d).filter((f) => f.endsWith(".txt")))
    files.push(join(d, f));
files = [...new Map(files.map((f) => [f.split("/").pop(), f])).values()].sort();

interface Cell {
  bucket: "recovered" | "resource";
  spec: string;
  match: string;
}
const recovered: Array<{ prompt: string; cell: Cell }> = [];
const resource: Array<{ prompt: string; cell: Cell }> = [];

for (const path of files) {
  const items: GladMatch[] = [];
  try {
    const p = new GladLogParser();
    p.on("match", (m: GladMatch) => items.push(m));
    p.on("shuffle", (sh: { rounds?: GladMatch[] }) => {
      for (const r of sh.rounds ?? []) items.push(r);
    });
    for (const line of readFileSync(path, "utf8").split("\n")) p.push(line);
    p.end();
  } catch {
    continue;
  }
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
    const spec = specToString(owner.spec);
    let cands;
    try {
      cands = extractCandidateFindings(legacy, owner.id);
    } catch {
      continue;
    }
    for (const d of cands.filter(
      (c) => c.type === "death" && c.facts.side === "friendly",
    )) {
      const finding: Finding = {
        eventIds: [d.id],
        severity: "high",
        category: "survival",
        title: `${d.unitNames[0]?.split("-")[0]} 阵亡`,
        explanation: "队友阵亡于击杀窗口。",
      };
      let pack;
      try {
        pack = buildDeepDivePack(legacy, finding, 0, cands, owner.name);
      } catch {
        continue;
      }
      if (!pack || !hasCoachableSignal(pack.items)) continue;
      const hasPos = pack.items.some((i) => i.kind === "position");
      const hasRes = resourceSignal(pack.items);
      const prompt = buildDeepDivePrompt([pack], [finding], spec, owner.name);
      const cellBase = { spec, match: path.split("/").pop()!.slice(0, 12) };
      if (hasPos && !hasRes && recovered.length < WANT_EACH)
        recovered.push({ prompt, cell: { bucket: "recovered", ...cellBase } });
      else if (hasRes && !hasPos && resource.length < WANT_EACH)
        resource.push({ prompt, cell: { bucket: "resource", ...cellBase } });
    }
    if (recovered.length >= WANT_EACH && resource.length >= WANT_EACH) break;
  }
  if (recovered.length >= WANT_EACH && resource.length >= WANT_EACH) break;
}

// 混合 + 洗牌(judge 盲评):ord 与 bucket 的映射只落在 key.json,prompt 无桶标记。
const all = [...recovered, ...resource];
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [all[i], all[j]] = [all[j]!, all[i]!];
}
const key: Array<{ ord: number } & Cell> = [];
all.forEach((e, i) => {
  const ord = i + 1;
  const tag = String(ord).padStart(2, "0");
  writeFileSync(join(outDir, "prompts", `${tag}.txt`), e.prompt);
  key.push({ ord, ...e.cell });
});
writeFileSync(join(outDir, "key.json"), JSON.stringify(key, null, 1));
console.warn(
  `recovered ${recovered.length} · resource ${resource.length} · 混合 ${all.length} → ${outDir}/prompts`,
);
console.warn(
  `桶分布(揭盲用 key.json):recovered=${recovered.length}  resource=${resource.length}`,
);
