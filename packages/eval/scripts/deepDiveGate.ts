// 可教信号门 before/after(确定性,无模型):220 场公开局,每个友方死亡锚点
// 修前(旧:有包就深挖)vs 修后(过 hasCoachableSignal 门)。量化跳过率 =
// 砍掉多少「干净窗口硬编套话」的调用。也是门槛松紧的定标数据。
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import {
  extractCandidateFindings,
  isHealerSpec,
  buildDeepDivePack,
  hasCoachableSignal,
  type Finding,
} from "@gladlog/analysis";

const dir = process.argv[2] ?? "";
if (!dir) throw new Error("usage: deepDiveGate.ts <corpusDir>");
const files = readdirSync(dir).filter((f) => f.endsWith(".txt"));

let matches = 0;
let deathAnchors = 0; // 友方死亡(潜在深挖目标)
let hadPackBefore = 0; // 修前:构出非空包(有窗口证据)
let passGateAfter = 0; // 修后:过信号门
const signalKinds = { defensiveEarlyLate: 0, trinketUnused: 0, dispelWaste: 0 };

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
    const deaths = cands.filter(
      (c) => c.type === "death" && c.facts.side === "friendly",
    );
    for (const d of deaths) {
      deathAnchors++;
      const finding: Finding = {
        eventIds: [d.id],
        severity: "high",
        category: "survival",
        title: "阵亡",
        explanation: "x",
      };
      // 门已移到调用方:buildDeepDivePack 只要窗口有证据就返回包(=修前 before);
      // 再套 hasCoachableSignal(=修后 after)。一路径同时得两个数。
      const pack = buildDeepDivePack(legacy, finding, 0, cands, owner.name);
      if (!pack) continue; // 窗口无任何证据 —— 两个口径都不深挖
      hadPackBefore++;
      if (hasCoachableSignal(pack.items)) {
        passGateAfter++;
        for (const it of pack.items) {
          if (it.facts.role !== "enemy") {
            if (
              it.kind === "defensive" &&
              (it.facts.timing === "Early" || it.facts.timing === "Late")
            )
              signalKinds.defensiveEarlyLate++;
            if (it.kind === "cc" && it.facts.trinket === "available_unused" && Number(it.facts.duration) >= 3)
              signalKinds.trinketUnused++;
          }
        }
      }
    }
  }
}

console.warn(`公开语料 ${matches} 场 · 友方死亡锚点 ${deathAnchors} 个`);
console.warn(
  `修前(有窗口证据就深挖):${hadPackBefore}/${deathAnchors} = ${Math.round((100 * hadPackBefore) / deathAnchors)}% 会调模型`,
);
console.warn(
  `修后(过可教信号门):${passGateAfter}/${hadPackBefore} 有包的里过门 = ${Math.round((100 * passGateAfter) / hadPackBefore)}%`,
);
console.warn(
  `→ 门砍掉的干净窗口(修前会深挖、修后跳过):${hadPackBefore - passGateAfter} 个 = 修前调用量的 ${Math.round((100 * (hadPackBefore - passGateAfter)) / hadPackBefore)}%`,
);
console.warn(
  `信号命中构成:防御Early/Late ${signalKinds.defensiveEarlyLate} · 饰品该交没交 ${signalKinds.trinketUnused}`,
);
