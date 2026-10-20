/**
 * 跨模型对照:把多个消融 run 的 raw.json 并成一张表。
 *
 * 回答的是单模型答不了的问题:「哪些行有用」是**模型特性**还是 **prompt 的性质**?
 * 判据是各模型对共同类型的效应(Jaccard 相对噪声底之差)的 Spearman 秩相关 ——
 * 排序一致 ⇒ 结论可据以动 prompt;不一致 ⇒ 「三后端发同一份 prompt」的产品前提有问题。
 *
 * 用法:npx tsx packages/eval/scripts/promptProbeCompare.ts <name=dir> [<name=dir> …]
 *   例:… haiku=$OUT/haiku-clean sonnet=$OUT/sonnet-clean agy=$OUT/agy-clean
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  aggregateProbeRows,
  type ProbeRow,
  type RunAgg,
  spearman,
} from "../src/explore/promptProbeAggregate";

const specs = process.argv.slice(2).map((s) => {
  const i = s.indexOf("=");
  if (i < 0) {
    console.error(`参数要写成 name=dir:${s}`);
    process.exit(1);
  }
  return { name: s.slice(0, i), dir: s.slice(i + 1) };
});
if (specs.length === 0) {
  console.error("Usage: promptProbeCompare <name=dir> [<name=dir> …]");
  process.exit(1);
}

const runs = new Map<string, RunAgg>();
for (const { name, dir } of specs) {
  const rows = JSON.parse(
    readFileSync(join(dir, "raw.json"), "utf8"),
  ) as ProbeRow[];
  runs.set(name, aggregateProbeRows(rows));
}

const names = [...runs.keys()];
console.log(`# 跨模型消融对照\n`);
console.log(`| run | 有效样本 | 噪声底 | SD | n(对) |`);
console.log(`|---|---:|---:|---:|---:|`);
for (const [n, r] of runs)
  console.log(
    `| ${n} | ${r.validSamples} | ${r.floorMean.toFixed(3)} | ${r.floorSd.toFixed(3)} | ${r.floorN} |`,
  );

// 汇总每类型各模型的效应(Jaccard − 该 run 噪声底)
const allTypes = new Set<string>();
for (const r of runs.values())
  for (const t of r.perType.keys()) allTypes.add(t);
console.log(`\n| 行类型 | ${names.map((n) => `${n} Δ (z)`).join(" | ")} |`);
console.log(`|---|${names.map(() => "---:").join("|")}|`);
const effectOf = (r: RunAgg, t: string) => {
  const a = r.perType.get(t);
  return a === undefined ? null : a.meanJaccard - r.floorMean;
};
const rowsOut = [...allTypes].map((t) => ({
  t,
  min: Math.min(...names.map((n) => effectOf(runs.get(n)!, t) ?? Infinity)),
}));
for (const { t } of rowsOut.sort((a, b) => a.min - b.min)) {
  const cells = names.map((n) => {
    const r = runs.get(n)!;
    const a = r.perType.get(t);
    if (!a) return "—";
    const sig = a.z <= -2 ? " **显著**" : a.z <= -1 ? " (弱)" : "";
    return `${(a.meanJaccard - r.floorMean).toFixed(3)} (${a.z.toFixed(1)})${sig}`;
  });
  console.log(`| ${t} | ${cells.join(" | ")} |`);
}

if (names.length >= 2) {
  console.log(`\n## 模型间秩相关(效应排序一致性)\n`);
  console.log(`| 模型对 | Spearman ρ | 共同类型数 |`);
  console.log(`|---|---:|---:|`);
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const ea = new Map<string, number>();
      const eb = new Map<string, number>();
      for (const t of allTypes) {
        const va = effectOf(runs.get(names[i])!, t);
        const vb = effectOf(runs.get(names[j])!, t);
        if (va !== null) ea.set(t, va);
        if (vb !== null) eb.set(t, vb);
      }
      const { rho, n } = spearman(ea, eb);
      console.log(
        `| ${names[i]} vs ${names[j]} | ${Number.isNaN(rho) ? "—" : rho.toFixed(2)} | ${n} |`,
      );
    }
}
