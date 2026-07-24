// 语料实证(常驻工具):DPS 公开语料跑 extractCandidateFindings,候选按
// 类型 × 比赛阶段(前/中/后 1/3)分布。改动候选提取/prompt 引导后跑一把
// 对比时段覆盖。2026-07-19 基线:death 88% 在后 1/3;death-setup 落地后
// 菜单 avg 5.7→6.3/场(38 条链条候选/60 场:healer-locked 25 / trinket-early 8 / defensive-early 5)。
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import { extractCandidateFindings, isHealerSpec } from "@gladlog/analysis";

// --manifest <file> 时改读清单里的日志(如 A3 覆盖清单 → 治疗视角语料);
// 默认仍是 DPS 公开语料目录。
const argv = process.argv.slice(2);
const mIdx = argv.indexOf("--manifest");
const dir = "/Users/mingjianliu/code/gladlog-eval-private/corpus/public-dps";
const files: string[] =
  mIdx >= 0
    ? readFileSync(argv[mIdx + 1]!, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : readdirSync(dir)
        .filter((f) => f.endsWith(".txt"))
        .map((f) => join(dir, f));

type Cell = { early: number; mid: number; late: number; whole: number };
const byType = new Map<string, Cell>();
const cell = (t: string): Cell => {
  let c = byType.get(t);
  if (!c) {
    c = { early: 0, mid: 0, late: 0, whole: 0 };
    byType.set(t, c);
  }
  return c;
};
let matches = 0;
let menuTotal = 0;
const perMatch: number[] = []; // 每场菜单条数(下尾诊断)
const phaseCover: number[] = []; // 每场覆盖的时段数(前/中/后有带时刻候选算 1)

for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m: GladMatch) => items.push(m));
  for (const line of readFileSync(f, "utf8").split("\n"))
    parser.push(line);
  parser.end();
  for (const m of items) {
    try {
      const legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
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
      const durS = (legacy.endTime - legacy.startTime) / 1000;
      const cands = extractCandidateFindings(legacy, owner.id);
      matches++;
      menuTotal += cands.length;
      perMatch.push(cands.length);
      const ph = new Set<string>();
      for (const c of cands) {
        if (c.facts.t === undefined) continue;
        const fr = c.t / Math.max(1, durS);
        ph.add(fr < 1 / 3 ? "e" : fr < 2 / 3 ? "m" : "l");
      }
      phaseCover.push(ph.size);
      for (const c of cands) {
        const key =
          c.type === "death-setup" ? `death-setup/${c.facts.kind}` : c.type;
        const cc = cell(key);
        if (c.facts.t === undefined) cc.whole++;
        else {
          const frac = c.t / Math.max(1, durS);
          if (frac < 1 / 3) cc.early++;
          else if (frac < 2 / 3) cc.mid++;
          else cc.late++;
        }
      }
    } catch {
      /* 跳过坏场 */
    }
  }
}

perMatch.sort((a, b) => a - b);
const q = (f: number) => perMatch[Math.floor(f * (perMatch.length - 1))];
console.warn(
  `matches=${matches} menuTotal=${menuTotal} avg=${(menuTotal / matches).toFixed(1)}/场`,
);
console.warn(
  `每场分布 min=${q(0)} p10=${q(0.1)} p25=${q(0.25)} p50=${q(0.5)} p90=${q(0.9)} max=${q(1)};` +
    ` ≤2条的场 ${perMatch.filter((n) => n <= 2).length}/${matches},` +
    ` ≤4条的场 ${perMatch.filter((n) => n <= 4).length}/${matches}`,
);
console.warn(
  `时段覆盖:三段全有 ${phaseCover.filter((n) => n === 3).length}/${matches},` +
    ` 两段 ${phaseCover.filter((n) => n === 2).length},只一段 ${phaseCover.filter((n) => n === 1).length}`,
);
console.warn("type".padEnd(22), "前1/3", "中1/3", "后1/3", "整场");
for (const [t, c] of [...byType.entries()].sort(
  (a, b) =>
    b[1].early +
    b[1].mid +
    b[1].late +
    b[1].whole -
    (a[1].early + a[1].mid + a[1].late + a[1].whole),
)) {
  console.warn(
    t.padEnd(22),
    String(c.early).padStart(4),
    String(c.mid).padStart(4),
    String(c.late).padStart(4),
    String(c.whole).padStart(4),
  );
}
