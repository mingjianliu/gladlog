/**
 * mitigationStackScan.ts — does the un-modelled stacking between mitigation
 * entries matter? (BACKLOG #41 (6), 2026-09-04; the feasibility probe before
 * porting TrinityCore's stacking rule into counterfactual.ts.)
 *
 * counterfactual.ts shape A backs out each active percentage mitigation
 * INDEPENDENTLY: blocked = observed × pct / (100 − pct) per entry. When two
 * entries overlap in time, the observed damage in the overlap is already the
 * result of BOTH, so the two back-outs each claim the whole reduction and the
 * sum over-states what was blocked. The multiplicative truth (TrinityCore
 * `GetTotalAuraMultiplier`: different auras multiply, same SpellGroup takes
 * the max) for damage D taken under pcts a, b is D / ((1−a)(1−b)) − D.
 *
 * This scan walks every player death in the manifest, takes EXACTLY the
 * intervals shape A iterates (`whitelistedIntervalsInDeathWindow`), keeps the
 * arithmetic entries (MITIGATION_TABLE, pct < 100, not positional), and
 * reports: how many deaths had ≥ 2 arithmetic entries active at the same
 * instant, for how long, how much damage was taken under the overlap, and the
 * over-count of the current independent model vs the multiplicative one, in
 * % of the victim's max HP (windowNetDamageAndMaxHp's maxHp is private; the
 * victim's max HP is taken from the same HP events counterfactual uses).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/mitigationStackScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt [--every 30] [--md <out.md>]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { MITIGATION_TABLE } from "@gladlog/analysis/src/data/mitigationData";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  whitelistedIntervalsInDeathWindow,
  windowDamage,
} from "@gladlog/analysis/src/utils/counterfactual";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { type ICombatUnit, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { manifest: "", every: 1, archiveDir: process.cwd(), md: "" };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--archive-dir") out.archiveDir = a[++i] ?? "";
    else if (a[i] === "--md") out.md = a[++i] ?? "";
  }
  if (!out.manifest || !Number.isFinite(out.every) || out.every < 1) {
    console.error(
      "usage: mitigationStackScan.ts --manifest <path> [--every N] [--archive-dir <dir>] [--md <file>]",
    );
    process.exit(1);
  }
  return out;
}

interface ArithIv {
  spellId: string;
  name: string;
  pct: number;
  schoolMask: number;
  from: number;
  to: number;
}

/** Max HP from the unit's own advanced samples — the same field
 * counterfactual's absHpAt reads (advancedActorMaxHp, own-actor rows only). */
function maxHpOf(u: ICombatUnit): number | null {
  let max = 0;
  for (const a of u.advancedActions) {
    if (a.advancedActorId !== u.id) continue;
    if (a.advancedActorMaxHp > max) max = a.advancedActorMaxHp;
  }
  return max > 0 ? max : null;
}

const pct = (n: number, d: number) =>
  d > 0 ? ((100 * n) / d).toFixed(1) : "—";
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

const args = parseArgs();
await ensureAnalysisData();
const files = readFileSync(args.manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % args.every === 0);

let rounds = 0;
let deaths = 0;
let deathsWithArith = 0;
let deathsWithOverlap = 0;
let deathsWith3 = 0;
const overlapSeconds: number[] = [];
const overcountPctMaxHp: number[] = [];
const pairCounts = new Map<string, number>();
let overlapDamage = 0;

for (const f of files) {
  const p = f.startsWith("/") ? f : resolve(args.archiveDir, f);
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(p);
    text = (p.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const combat = {
      startTime: legacy.startTime,
      endTime: legacy.endTime,
      units: legacy.units as Record<string, ICombatUnit>,
    };
    // Players only (splitTeams = the same team split acceptanceCapture and the
    // product use); pets / totems / NPC deaths are not counterfactual subjects.
    const { friends, enemies } = splitTeams(legacy);
    for (const u of [...friends, ...enemies]) {
      if (!u.deathRecords?.length) continue;
      for (const d of u.deathRecords) {
        const deathS = (d.timestamp - combat.startTime) / 1000;
        if (!(deathS > 0)) continue;
        deaths++;
        const arith: ArithIv[] = [];
        for (const iv of whitelistedIntervalsInDeathWindow(u, combat, deathS)) {
          const e = MITIGATION_TABLE[iv.spellId];
          if (!e || e.pct >= 100 || e.positional) continue;
          arith.push({
            spellId: iv.spellId,
            name: getEnglishSpellName(iv.spellId, iv.spellName),
            pct: e.pct,
            schoolMask: e.schoolMask,
            from: iv.overlapFrom,
            to: iv.overlapTo,
          });
        }
        if (!arith.length) continue;
        deathsWithArith++;
        if (arith.length < 2) continue;
        // Sweep the union of endpoints; on each elementary segment count the
        // active entries and, when ≥ 2, compare the two accounting models on
        // the damage actually taken in that segment (school = intersection of
        // the active masks; entries of disjoint schools do not interact).
        const cuts = [...new Set(arith.flatMap((x) => [x.from, x.to]))].sort(
          (a, b) => a - b,
        );
        let overlapS = 0;
        let over = 0;
        let maxActive = 0;
        const seenPairs = new Set<string>();
        for (let i = 0; i + 1 < cuts.length; i++) {
          const a = cuts[i]!;
          const b = cuts[i + 1]!;
          const active = arith.filter((x) => x.from <= a && x.to >= b);
          if (active.length < 2) continue;
          maxActive = Math.max(maxActive, active.length);
          overlapS += b - a;
          const mask = active.reduce((acc, x) => acc & x.schoolMask, 0x7f);
          if (mask === 0) continue;
          const D = windowDamage(u, a, b, mask, combat.startTime);
          overlapDamage += D;
          const independent = active.reduce(
            (s, x) => s + (D * x.pct) / (100 - x.pct),
            0,
          );
          const keep = active.reduce((k, x) => k * (1 - x.pct / 100), 1);
          const multiplicative = D / keep - D;
          over += independent - multiplicative;
          const names = active.map((x) => x.name).sort();
          for (let j = 0; j < names.length; j++)
            for (let k = j + 1; k < names.length; k++)
              seenPairs.add(`${names[j]} + ${names[k]}`);
        }
        if (overlapS <= 0) continue;
        deathsWithOverlap++;
        if (maxActive >= 3) deathsWith3++;
        overlapSeconds.push(overlapS);
        const mhp = maxHpOf(u);
        if (mhp) overcountPctMaxHp.push((100 * over) / mhp);
        for (const pr of seenPairs)
          pairCounts.set(pr, (pairCounts.get(pr) ?? 0) + 1);
      }
    }
  }
}

const lines: string[] = [];
lines.push(`files=${files.length} rounds=${rounds} player deaths=${deaths}`);
lines.push(
  `deaths with ≥1 arithmetic mitigation active in the 10 s window: ${deathsWithArith} (${pct(deathsWithArith, deaths)}% of deaths)`,
);
lines.push(
  `deaths with ≥2 active at the same instant (the un-modelled case): ${deathsWithOverlap} (${pct(deathsWithOverlap, deaths)}% of deaths, ${pct(deathsWithOverlap, deathsWithArith)}% of mitigated deaths); ≥3 at once: ${deathsWith3}`,
);
lines.push(
  `overlap seconds per such death: p50 ${quantile(overlapSeconds, 0.5).toFixed(1)}  p90 ${quantile(overlapSeconds, 0.9).toFixed(1)}  max ${quantile(overlapSeconds, 1).toFixed(1)}`,
);
lines.push(
  `independent − multiplicative (negative = the current model UNDER-states the blocked total), % of victim max HP: min ${quantile(overcountPctMaxHp, 0).toFixed(2)}  p10 ${quantile(overcountPctMaxHp, 0.1).toFixed(2)}  p50 ${quantile(overcountPctMaxHp, 0.5).toFixed(2)}  p90 ${quantile(overcountPctMaxHp, 0.9).toFixed(2)}  (|Δ| ≥ 15 pp = the decisive-tier margin: ${overcountPctMaxHp.filter((x) => Math.abs(x) >= 15).length} deaths; |Δ| ≥ 5 pp: ${overcountPctMaxHp.filter((x) => Math.abs(x) >= 5).length})`,
);
lines.push(`damage taken under overlap, total: ${Math.round(overlapDamage)}`);
lines.push("top overlapping pairs:");
for (const [k, v] of [...pairCounts].sort((a, b) => b[1] - a[1]).slice(0, 15))
  lines.push(`  ${v}\t${k}`);
const report = lines.join("\n");
console.log(report);
if (args.md)
  writeFileSync(
    args.md,
    `# mitigationStackScan ${new Date().toISOString()}\n\n\`\`\`\n${report}\n\`\`\`\n`,
  );
