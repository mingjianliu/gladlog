// Corpus evidence (a permanent tool): run extractCandidateFindings over the
// public DPS corpus and break the candidates down by type × match phase (first/
// middle/last third). Run it after changing candidate extraction or the prompt
// guidance to compare phase coverage. 2026-07-19 baseline: 88% of death
// candidates land in the last third; after death-setup shipped, the menu went
// from avg 5.7 to 6.3 per match (38 chain candidates over 60 matches:
// healer-locked 25 / trinket-early 8 / defensive-early 5).
import {
  extractCandidateFindings,
  isHealerSpec,
  ensureAnalysisData,
} from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { CombatUnitReaction, toLegacyMatch } from "@gladlog/parser-compat";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { resolveEvalHome } from "../src/evalHome";

// Prompt builders read the background-loaded talent / spell-name tables
// (data/ensure.ts contract) — without this the first combats are degraded.
await ensureAnalysisData();

// With --manifest <file>, read the logs listed in that manifest instead (e.g.
// the A3 coverage manifest → a healer-perspective corpus); the default is
// still the public DPS corpus directory, resolved from $GLADLOG_EVAL_HOME
// (never a hardcoded absolute path) and overridable with --corpus <dir>.
const argv = process.argv.slice(2);
const mIdx = argv.indexOf("--manifest");
const cIdx = argv.indexOf("--corpus");
const dir =
  cIdx >= 0 ? argv[cIdx + 1]! : join(resolveEvalHome(), "corpus", "public-dps");
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
const perMatch: number[] = []; // menu size per match (lower-tail diagnosis)
const phaseCover: number[] = []; // phases covered per match (each of first/middle/last counts 1 if it has a timestamped candidate)

for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m: GladMatch) => items.push(m));
  for (const line of readFileSync(f, "utf8").split("\n")) parser.push(line);
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
      /* skip broken matches */
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
