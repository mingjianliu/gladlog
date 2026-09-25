// Offensive deep-dive robustness scan (deterministic): runs
// buildOffensiveDeepDivePack + hasOffensiveCoachableSignal over every non-death
// candidate, asserts the invariants, reports the per-type gate pass rate, and
// catches crashes / leftover digits. No model calls.
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import {
  extractCandidateFindings,
  isHealerSpec,
  buildOffensiveDeepDivePack,
  hasOffensiveCoachableSignal,
  type Finding,
  ensureAnalysisData,
} from "@gladlog/analysis";

// Prompt builders read the background-loaded talent / spell-name tables
// (data/ensure.ts contract) — without this the first combats are degraded.
await ensureAnalysisData();

const OFFENSIVE = new Set([
  "unconverted-burst",
  "burst-into-immunity",
  "off-target-in-window",
  "dr-clipped-cc",
]);
// t/hp/onTargetPct/dr/overlap are legitimate numeric fields (the model refers
// to them via placeholders); a digit in any other text field risks being killed
// by the bare-number audit (realm names are already shortened via sn(), and
// spell names carry the same risk).
const NUMERIC_FIELDS = new Set(["t", "hp", "onTargetPct", "dr", "overlap"]);
const hasDigit = /\d/;

const dirs = process.argv.slice(2);
if (dirs.length === 0)
  throw new Error("usage: deepDiveOffensiveScan.ts <dir> [dir2 ...]");
let files: string[] = [];
for (const d of dirs)
  for (const f of readdirSync(d).filter((f) => f.endsWith(".txt")))
    files.push(join(d, f));
files = [...new Map(files.map((f) => [f.split("/").pop(), f])).values()];

let cands = 0,
  packBuilt = 0,
  gated = 0,
  packCrash = 0;
const bugs = {
  missingRole: 0,
  factsMismatch: 0,
  digitInName: [] as string[],
  outOfWindow: 0,
};
const byType = new Map<string, { c: number; gated: number }>();
const packSizes: number[] = [];

for (const path of files) {
  const items: GladMatch[] = [];
  try {
    const p = new GladLogParser();
    p.on("match", (m: GladMatch) => items.push(m));
    p.on("shuffle", (sh) => {
      for (const r of sh.rounds) items.push(r as never);
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
    let cs;
    try {
      cs = extractCandidateFindings(legacy, owner.id);
    } catch {
      continue;
    }
    for (const c of cs.filter((c) => OFFENSIVE.has(c.type))) {
      cands++;
      const st = byType.get(c.type) ?? { c: 0, gated: 0 };
      st.c++;
      const finding: Finding = {
        eventIds: [c.id],
        severity: "high",
        category: "offense",
        title: `${c.type}`,
        explanation: "x",
      };
      let pack;
      try {
        pack = buildOffensiveDeepDivePack(legacy, finding, 0, cs, owner.name);
      } catch {
        packCrash++;
        byType.set(c.type, st);
        continue;
      }
      if (pack) {
        packBuilt++;
        packSizes.push(pack.items.length);
        for (const it of pack.items) {
          if (it.facts.role === undefined) bugs.missingRole++;
          if (it.t < pack.anchorFrom || it.t > pack.anchorTo)
            bugs.outOfWindow++;
          for (const [k, v] of Object.entries(it.facts))
            if (!NUMERIC_FIELDS.has(k) && hasDigit.test(v))
              bugs.digitInName.push(`${it.kind}.${k}=${v}`);
        }
        const expected = new Set<string>();
        for (const it of pack.items)
          for (const k of Object.keys(it.facts)) expected.add(`${it.key}.${k}`);
        if (expected.size !== Object.keys(pack.facts).length)
          bugs.factsMismatch++;
        if (hasOffensiveCoachableSignal(pack.items)) {
          gated++;
          st.gated++;
        }
      }
      byType.set(c.type, st);
    }
  }
}
const mean = (a: number[]) =>
  a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : "0";
console.warn(
  `非死亡候选 ${cands} · 构包 ${packBuilt} · 过门 ${gated}(${packBuilt ? Math.round((100 * gated) / packBuilt) : 0}%) · 每包 mean ${mean(packSizes)} 条`,
);
console.warn(`崩溃:pack ${packCrash}`);
console.warn(
  `role 缺失 ${bugs.missingRole} · facts↔items 不一致 ${bugs.factsMismatch} · 窗口外条目 ${bugs.outOfWindow} · 名字残留数字 ${bugs.digitInName.length}`,
);
if (bugs.digitInName.length)
  console.warn(
    `  样例:${[...new Set(bugs.digitInName)].slice(0, 8).join(" · ")}`,
  );
console.warn("── 逐类型 ──");
for (const [t, s] of byType)
  console.warn(
    `  ${t.padEnd(22)} 候选 ${s.c} · 过门 ${s.c ? Math.round((100 * s.gated) / s.c) : 0}%`,
  );
