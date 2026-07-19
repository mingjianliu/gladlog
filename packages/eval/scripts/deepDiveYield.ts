// 深挖轮产出量化(模型无关):DPS 公开语料,对每个带时刻的初轮候选(潜在
// finding 锚点)构建深挖证据包,量化「围绕一个锚点能确定性挖出多少条初轮
// 菜单没有的更深证据」+ 类型分布。回答:多轮追问在机制层能否挖出更深东西。
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import {
  extractCandidateFindings,
  isHealerSpec,
  buildDeepDivePack,
  type Finding,
} from "@gladlog/analysis";

const dir = "/Users/mingjianliu/code/gladlog-eval-private/corpus/public-dps";
const files = readdirSync(dir).filter((f) => f.endsWith(".txt"));

let matches = 0;
let anchors = 0; // 带时刻的初轮候选数(潜在深挖锚点)
let anchorsWithPack = 0; // 能构出非空证据包的锚点数
const packSizes: number[] = [];
const kindCounts = new Map<string, number>();
// 高严重度锚点(death / death-setup)专门看一下:深挖机制主要服务它们
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
      if (c.facts.t === undefined || !(c.t > 0)) continue; // 整场观察无锚点
      anchors++;
      const isDeath = c.type === "death" || c.type === "death-setup";
      if (isDeath) deathAnchors++;
      // 把候选包装成单事件 finding 喂深挖构包器(与 renderer 触发路径同)
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
