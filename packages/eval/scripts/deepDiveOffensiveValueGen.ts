// 进攻深挖价值 A/B(生成器)。before = 非死亡 finding 不深挖(现状,席位全给死亡);
// after = 进攻深挖上线。价值问题 = 新产的进攻深挖是好教练还是填充?两桶同 v12 prompt:
//   offensive:非死亡候选过 hasOffensiveCoachableSignal(按类型分层采样,保证四类都有)。
//   survival(对照锚):死亡候选过 hasCoachableSignal —— 证明 judge 尺子正常 + 进攻不劣于生存。
// judge 盲评后揭盲比均值。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import {
  extractCandidateFindings,
  isHealerSpec,
  buildDeepDivePack,
  buildOffensiveDeepDivePack,
  buildDeepDivePrompt,
  hasCoachableSignal,
  hasOffensiveCoachableSignal,
  specToString,
  type Finding,
} from "@gladlog/analysis";

const OFFENSIVE = new Set([
  "unconverted-burst",
  "burst-into-immunity",
  "off-target-in-window",
  "dr-clipped-cc",
]);

const dirs = process.argv[2]!.split(",");
const outDir = process.argv[3] ?? "/tmp/deepdive-offensive-value";
const WANT_EACH = Number(process.argv[4] ?? 24);
mkdirSync(join(outDir, "prompts"), { recursive: true });

interface Cell {
  bucket: "offensive" | "survival";
  subtype: string;
  spec: string;
  match: string;
}
// offensive 按类型分桶(分层采样),survival 一桶。
const offByType = new Map<string, Array<{ prompt: string; cell: Cell }>>();
const survival: Array<{ prompt: string; cell: Cell }> = [];

let files: string[] = [];
for (const d of dirs)
  for (const f of readdirSync(d).filter((f) => f.endsWith(".txt")))
    files.push(join(d, f));
files = [...new Map(files.map((f) => [f.split("/").pop(), f])).values()].sort();

const mkFinding = (
  id: string,
  sev: Finding["severity"],
  cat: string,
): Finding => ({
  eventIds: [id],
  severity: sev,
  category: cat,
  title: cat,
  explanation: cat === "survival" ? "队友阵亡于击杀窗口。" : "进攻窗口未收掉。",
});

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
    const short = path.split("/").pop()!.slice(0, 12);
    let cs;
    try {
      cs = extractCandidateFindings(legacy, owner.id);
    } catch {
      continue;
    }
    // offensive
    for (const c of cs.filter((c) => OFFENSIVE.has(c.type))) {
      const bucket = offByType.get(c.type) ?? [];
      if (bucket.length >= WANT_EACH) continue;
      let pack;
      try {
        pack = buildOffensiveDeepDivePack(
          legacy,
          mkFinding(c.id, "high", "offense"),
          0,
          cs,
          owner.name,
        );
      } catch {
        continue;
      }
      if (!pack || !hasOffensiveCoachableSignal(pack.items)) continue;
      bucket.push({
        prompt: buildDeepDivePrompt(
          [pack],
          [mkFinding(c.id, "high", "offense")],
          spec,
          owner.name,
        ),
        cell: { bucket: "offensive", subtype: c.type, spec, match: short },
      });
      offByType.set(c.type, bucket);
    }
    // survival(对照锚)
    if (survival.length < WANT_EACH)
      for (const d of cs.filter(
        (c) => c.type === "death" && c.facts.side === "friendly",
      )) {
        if (survival.length >= WANT_EACH) break;
        let pack;
        try {
          pack = buildDeepDivePack(
            legacy,
            mkFinding(d.id, "high", "survival"),
            0,
            cs,
            owner.name,
          );
        } catch {
          continue;
        }
        if (!pack || !hasCoachableSignal(pack.items)) continue;
        survival.push({
          prompt: buildDeepDivePrompt(
            [pack],
            [mkFinding(d.id, "high", "survival")],
            spec,
            owner.name,
          ),
          cell: { bucket: "survival", subtype: "death", spec, match: short },
        });
      }
  }
}

// offensive 分层:四类各取 min(bucket, ceil(WANT_EACH/类数)),再补齐到 WANT_EACH。
const perType = Math.ceil(WANT_EACH / OFFENSIVE.size);
const offensive: Array<{ prompt: string; cell: Cell }> = [];
for (const [, bucket] of offByType) offensive.push(...bucket.slice(0, perType));
// 若不足 WANT_EACH,从剩余里补(off-target 通常最多)
if (offensive.length < WANT_EACH)
  for (const [, bucket] of offByType)
    for (const e of bucket.slice(perType)) {
      if (offensive.length >= WANT_EACH) break;
      offensive.push(e);
    }

const all = [...offensive, ...survival];
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [all[i], all[j]] = [all[j]!, all[i]!];
}
const key: Array<{ ord: number } & Cell> = [];
all.forEach((e, i) => {
  const ord = i + 1;
  writeFileSync(
    join(outDir, "prompts", `${String(ord).padStart(2, "0")}.txt`),
    e.prompt,
  );
  key.push({ ord, ...e.cell });
});
writeFileSync(join(outDir, "key.json"), JSON.stringify(key, null, 1));

const byType = new Map<string, number>();
for (const e of offensive)
  byType.set(e.cell.subtype, (byType.get(e.cell.subtype) ?? 0) + 1);
console.warn(
  `offensive ${offensive.length} · survival ${survival.length} · 混合 ${all.length} → ${outDir}/prompts`,
);
console.warn(
  `offensive 分层: ${[...byType.entries()].map(([k, v]) => `${k}=${v}`).join(" · ")}`,
);
