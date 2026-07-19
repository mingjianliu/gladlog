// 逐 spec 信号分解(诊断过门率差异根因):每个 owner spec 的死亡包里,三类
// 可教信号各自出现率 + 「包里有没有防御事件」——区分「防御没被追踪/无 timing」
// (数据缺口)还是「防御被评 Optimal 所以不算信号」(真·打得好)。不调模型。
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import {
  extractCandidateFindings,
  isHealerSpec,
  buildDeepDivePack,
  hasCoachableSignal,
  specToString,
  type Finding,
  type PackItem,
} from "@gladlog/analysis";

const dirs = process.argv.slice(2);
let files: string[] = [];
for (const d of dirs)
  for (const f of readdirSync(d).filter((f) => f.endsWith(".txt")))
    files.push(join(d, f));
files = [...new Map(files.map((f) => [f.split("/").pop(), f])).values()];

interface SpecStat {
  anchors: number;
  pass: number;
  hasDefensive: number; // 包里有 ≥1 防御事件(不管 timing)
  defEarlyLate: number; // 信号 1:防御 Early/Late
  defOptimalOnly: number; // 有防御但全 Optimal/无标签(打得好,非缺口)
  ccUnused: number; // 信号 2:≥3s 硬控饰品该交没交
  dispelWaste: number; // 信号 3
  ownerIsVictim: number; // owner 本人死(vs 队友死)
}
const bySpec = new Map<string, SpecStat>();
const S = (spec: string) => {
  let v = bySpec.get(spec);
  if (!v) {
    v = {
      anchors: 0,
      pass: 0,
      hasDefensive: 0,
      defEarlyLate: 0,
      defOptimalOnly: 0,
      ccUnused: 0,
      dispelWaste: 0,
      ownerIsVictim: 0,
    };
    bySpec.set(spec, v);
  }
  return v;
};

const hasKind = (items: PackItem[], pred: (i: PackItem) => boolean) =>
  items.some(pred);

for (const path of files) {
  const items: GladMatch[] = [];
  try {
    const parser = new GladLogParser();
    parser.on("match", (m: GladMatch) => items.push(m));
    parser.on("shuffle", (sh: { rounds?: GladMatch[] }) => {
      for (const r of sh.rounds ?? []) items.push(r);
    });
    for (const line of readFileSync(path, "utf8").split("\n"))
      parser.push(line);
    parser.end();
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
      const st = S(spec);
      st.anchors++;
      if (d.unitNames[0] === owner.name) st.ownerIsVictim++;
      const finding: Finding = {
        eventIds: [d.id],
        severity: "high",
        category: "survival",
        title: "阵亡",
        explanation: "x",
      };
      let pack;
      try {
        pack = buildDeepDivePack(legacy, finding, 0, cands, owner.name);
      } catch {
        continue;
      }
      if (!pack) continue;
      const it = pack.items;
      if (hasCoachableSignal(it)) st.pass++;
      const defs = it.filter((i) => i.kind === "defensive");
      if (defs.length > 0) st.hasDefensive++;
      const early = defs.some(
        (i) => i.facts.timing === "Early" || i.facts.timing === "Late",
      );
      if (early) st.defEarlyLate++;
      else if (defs.length > 0) st.defOptimalOnly++; // 有防御但都不是失误时机
      if (
        hasKind(
          it,
          (i) =>
            i.kind === "cc" &&
            i.facts.trinket === "available_unused" &&
            Number(i.facts.duration) >= 3,
        )
      )
        st.ccUnused++;
      const enemyCd = it.some((i) => i.kind === "enemy-cd");
      if (
        enemyCd &&
        hasKind(it, (i) => i.kind === "dispel" && i.facts.priority === "Low")
      )
        st.dispelWaste++;
    }
  }
}

const pct = (a: number, b: number) =>
  b ? `${Math.round((100 * a) / b)}%` : "—";
const rows = [...bySpec.entries()]
  .filter(([, s]) => s.anchors >= 8)
  .sort((a, b) => a[1].pass / a[1].anchors - b[1].pass / b[1].anchors);
console.warn(
  "spec".padEnd(22) +
    " 锚点 过门  |有防御 防御失时 (仅Optimal) 饰品该交 驱散废 |owner死",
);
for (const [spec, s] of rows) {
  console.warn(
    spec.padEnd(22) +
      ` ${String(s.anchors).padStart(3)} ${pct(s.pass, s.anchors).padStart(4)}` +
      ` | ${pct(s.hasDefensive, s.anchors).padStart(4)} ${pct(s.defEarlyLate, s.anchors).padStart(5)}` +
      ` ${pct(s.defOptimalOnly, s.anchors).padStart(6)}` +
      ` ${pct(s.ccUnused, s.anchors).padStart(6)} ${pct(s.dispelWaste, s.anchors).padStart(5)}` +
      ` | ${pct(s.ownerIsVictim, s.anchors).padStart(4)}`,
  );
}
