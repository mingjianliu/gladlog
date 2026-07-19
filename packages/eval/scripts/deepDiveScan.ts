// 深挖鲁棒性扫描(确定性,大样本抓 bug):对一个或多个语料目录,把每个友方
// 死亡锚点跑完整 buildDeepDivePack + hasCoachableSignal,断言不变量、统计
// 分布、抓崩溃/退化/残留数字名/逐 spec 异常。不调模型。
import { readdirSync, readFileSync } from "fs";
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
} from "@gladlog/analysis";

const dirs = process.argv.slice(2);
if (dirs.length === 0)
  throw new Error("usage: deepDiveScan.ts <dir> [dir2 ...]");

let files: string[] = [];
for (const d of dirs)
  for (const f of readdirSync(d).filter((f) => f.endsWith(".txt")))
    files.push(join(d, f));
// 去重(不同段位语料可能有重叠 matchId=内容哈希文件名)
files = [...new Map(files.map((f) => [f.split("/").pop(), f])).values()];

let matches = 0;
let anchors = 0;
let packBuilt = 0;
let gated = 0;
let parseCrash = 0;
let packCrash = 0;
// bug 断言计数
const bugs = {
  missingRole: 0, // pack item facts 缺 role
  factsMismatch: 0, // pack.facts 键与 items 不一致
  digitInName: [] as string[], // 名字类 fact 值残留数字(裸数字审计会误杀)
  promptCrash: 0, // buildDeepDivePrompt 抛错
  degeneratePack: 0, // 过门但只有 1 条证据(可疑)
  emptyOwner: 0, // 无法确定 owner
};
const packSizes: number[] = [];
const bySpec = new Map<string, { anchors: number; gated: number }>();
// t/duration/hp 是合法数值字段(模型必走占位符);其余文本字段若含数字,
// 模型写字面量就会被裸数字审计误杀(realm 名是已修的一例,spell 名同类风险)。
const NUMERIC_FIELDS = new Set(["t", "duration", "hp"]);
const hasDigit = /\d/;

for (const path of files) {
  const items: GladMatch[] = [];
  try {
    const parser = new GladLogParser();
    parser.on("match", (m: GladMatch) => items.push(m));
    // shuffle 日志:每回合当作独立对局(否则整场被静默跳过 —— 覆盖缺口)。
    parser.on("shuffle", (sh: { rounds?: GladMatch[] }) => {
      for (const r of sh.rounds ?? []) items.push(r);
    });
    for (const line of readFileSync(path, "utf8").split("\n"))
      parser.push(line);
    parser.end();
  } catch {
    parseCrash++;
    continue;
  }
  for (const m of items) {
    let legacy;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      parseCrash++;
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
    if (!owner) {
      bugs.emptyOwner++;
      continue;
    }
    matches++;
    const spec = specToString(owner.spec);
    const sd = bySpec.get(spec) ?? { anchors: 0, gated: 0 };
    let cands;
    try {
      cands = extractCandidateFindings(legacy, owner.id);
    } catch {
      packCrash++;
      continue;
    }
    const deaths = cands.filter(
      (c) => c.type === "death" && c.facts.side === "friendly",
    );
    for (const d of deaths) {
      anchors++;
      sd.anchors++;
      const finding: Finding = {
        eventIds: [d.id],
        severity: "high",
        category: "survival",
        title: `${d.unitNames[0]?.split("-")[0]} 阵亡`,
        explanation: "x",
      };
      let pack;
      try {
        pack = buildDeepDivePack(legacy, finding, 0, cands, owner.name);
      } catch {
        packCrash++;
        continue;
      }
      if (!pack) continue;
      packBuilt++;
      packSizes.push(pack.items.length);

      // 不变量断言
      for (const it of pack.items) {
        if (it.facts.role === undefined) bugs.missingRole++;
        for (const [k, v] of Object.entries(it.facts)) {
          if (!NUMERIC_FIELDS.has(k) && hasDigit.test(v))
            bugs.digitInName.push(`${it.kind}.${k}=${v}`);
        }
      }
      // facts 键 ↔ items 一致
      const expected = new Set<string>();
      for (const it of pack.items)
        for (const k of Object.keys(it.facts)) expected.add(`${it.key}.${k}`);
      const got = new Set(Object.keys(pack.facts));
      if (expected.size !== got.size || [...expected].some((k) => !got.has(k)))
        bugs.factsMismatch++;

      const signal = hasCoachableSignal(pack.items);
      if (signal) {
        gated++;
        sd.gated++;
        if (pack.items.length <= 1) bugs.degeneratePack++;
        try {
          buildDeepDivePrompt([pack], [finding], spec, owner.name);
        } catch {
          bugs.promptCrash++;
        }
      }
    }
    bySpec.set(spec, sd);
  }
}

const mean = (a: number[]) =>
  a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : "0";
console.warn(
  `扫描 ${files.length} 文件 · ${matches} 场 · 友方死亡锚点 ${anchors}`,
);
console.warn(
  `构包 ${packBuilt} · 过门 ${gated}(${Math.round((100 * gated) / packBuilt)}%) · 每包 mean ${mean(packSizes)} 条`,
);
console.warn(
  `崩溃:parse ${parseCrash} · pack ${packCrash} · owner 缺失 ${bugs.emptyOwner}`,
);
console.warn("── bug 断言 ──");
console.warn(`  role 缺失:${bugs.missingRole}`);
console.warn(`  facts↔items 不一致:${bugs.factsMismatch}`);
console.warn(`  名字残留数字(裸数字审计误杀风险):${bugs.digitInName.length}`);
if (bugs.digitInName.length)
  console.warn(
    `    样例:${[...new Set(bugs.digitInName)].slice(0, 6).join(" · ")}`,
  );
console.warn(`  prompt 崩溃:${bugs.promptCrash}`);
console.warn(`  过门但退化包(≤1 条):${bugs.degeneratePack}`);
console.warn("── 逐 spec 过门率(挑样本≥8的)──");
for (const [spec, sd] of [...bySpec.entries()].sort(
  (a, b) => b[1].anchors - a[1].anchors,
))
  if (sd.anchors >= 8)
    console.warn(
      `  ${spec.padEnd(22)} 锚点 ${String(sd.anchors).padStart(3)} · 过门 ${Math.round((100 * sd.gated) / sd.anchors)}%`,
    );
