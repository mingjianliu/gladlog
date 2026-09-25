// Per-spec signal breakdown (diagnosing why gate pass rates differ): for each
// owner spec's death packs, the occurrence rate of each of the three teachable
// signals plus "does the pack contain any defensive event at all" — this
// distinguishes "the defensive wasn't tracked / has no timing" (a data gap)
// from "the defensive was rated Optimal so it isn't a signal" (they genuinely
// played well). No model calls.
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
  ensureAnalysisData,
} from "@gladlog/analysis";

// Prompt builders read the background-loaded talent / spell-name tables
// (data/ensure.ts contract) — without this the first combats are degraded.
await ensureAnalysisData();

const dirs = process.argv.slice(2);
let files: string[] = [];
for (const d of dirs)
  for (const f of readdirSync(d).filter((f) => f.endsWith(".txt")))
    files.push(join(d, f));
files = [...new Map(files.map((f) => [f.split("/").pop(), f])).values()];

interface SpecStat {
  anchors: number;
  pass: number;
  hasDefensive: number; // pack has ≥1 defensive event (regardless of timing)
  defEarlyLate: number; // signal 1: defensive Early/Late
  defOptimalOnly: number; // has defensives but all Optimal/unlabeled (played well, not a gap)
  ccUnused: number; // signal 2: ≥3s hard CC where the trinket should have been used but wasn't
  dispelWaste: number; // signal 3
  ownerIsVictim: number; // the owner themselves died (vs a teammate)
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
    parser.on("shuffle", (sh) => {
      for (const r of sh.rounds) items.push(r as never);
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
      else if (defs.length > 0) st.defOptimalOnly++; // has defensives, but none mistimed
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
