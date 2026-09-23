/* eslint-disable no-console */
/**
 * hpTieScan.ts — how often the `[STATE]` HP sampler has to choose between
 * equally near advanced samples that disagree (GH #100 field ledger,
 * 2026-09-23).
 *
 * `gridHpPct` → `getUnitHpAtTimestamp` → `binarySearchClosest` returns the
 * nearest sample, and among equal distances whichever index the bisection
 * visits first. A unit often has two samples in the same millisecond (the
 * snapshot is taken per event, before or after same-instant damage — see the
 * direction-2 section of docs/log-observability-audit.md), so the rendered HP
 * depends on array position: adding one unrelated sample anywhere in the list
 * can flip it. Found when the ENVIRONMENTAL_DAMAGE fix added a 0:03 sample and
 * a Holy Priest's 0:27 `[STATE]` tick went 90 → 88 (two samples at 26.87 s,
 * 848,005 and 864,290 of 962,260).
 *
 * Baseline (57-file slice with falling damage, 62 rounds, players only):
 * 1,563 / 51,578 grid readings (3.03 %) ambiguous; spread median 1 pp,
 * p90 4 pp, 112 readings ≥ 5 pp, max 48 pp.
 *
 * Ruled 2026-09-23 (user): the last line of the instant wins —
 * `binarySearchClosest` now resolves ties by rule. This scan still measures
 * the data property (how many readings HAVE a disagreeing twin), which the
 * rule does not change; it says how much the rule matters.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/hpTieScan.ts <manifest.txt>
 * Manifest lines are absolute paths to .txt or .txt.gz logs. One process,
 * one file in memory at a time.
 */
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import {
  gridHpPct,
  HP_SAMPLE_RADIUS_MS,
} from "@gladlog/analysis/src/utils/cooldowns";
import { getSortedAdvancedActions } from "@gladlog/analysis/src/utils/advancedActions";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";
const files = readFileSync(process.argv[2]!, "utf8")
  .split("\n")
  .filter(Boolean);
let grid = 0,
  ambiguous = 0,
  maxSpread = 0;
const spreads: number[] = [];
for (const f of files) {
  const bytes = readFileSync(f);
  const text = (f.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8");
  const p = new GladLogParser();
  const out: GladMatch[] = [];
  p.on("match", (m) => out.push(m));
  p.on("shuffle", (s) => out.push(...(s.rounds as never[])));
  for (const l of text.split("\n")) p.push(l);
  p.end();
  for (const m of out) {
    const L = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    const dur = Math.floor((L.endTime - L.startTime) / 1000);
    for (const u of Object.values(L.units)) {
      if (!(u as any).info) continue; // players only
      const acts = getSortedAdvancedActions(u);
      for (let s = 0; s <= dur; s++) {
        const t = L.startTime + s * 1000;
        const pct = gridHpPct(u, t);
        if (pct === null) continue;
        grid++;
        // nearest distance
        let best = Infinity;
        for (const a of acts)
          best = Math.min(best, Math.abs(a.logLine.timestamp - t));
        if (best > HP_SAMPLE_RADIUS_MS) continue;
        const cands = acts
          .filter(
            (a) =>
              Math.abs(a.logLine.timestamp - t) === best &&
              a.advancedActorMaxHp > 0,
          )
          .map((a) =>
            Math.min(
              100,
              Math.round(
                (a.advancedActorCurrentHp / a.advancedActorMaxHp) * 100,
              ),
            ),
          );
        const sp = Math.max(...cands) - Math.min(...cands);
        if (sp > 0) {
          ambiguous++;
          spreads.push(sp);
          maxSpread = Math.max(maxSpread, sp);
        }
      }
    }
  }
}
spreads.sort((a, b) => a - b);
console.log({
  gridReadings: grid,
  ambiguous,
  pct: ((100 * ambiguous) / grid).toFixed(2),
  medianSpread: spreads[Math.floor(spreads.length / 2)],
  p90: spreads[Math.floor(spreads.length * 0.9)],
  maxSpread,
  ge5: spreads.filter((x) => x >= 5).length,
});
