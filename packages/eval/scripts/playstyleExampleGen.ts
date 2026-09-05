/**
 * playstyleExampleGen.ts — value-gate artefact for GH #64 (BACKLOG #36 (f),
 * user direction 2026-09-05 「可以加在 compare」): the per-match playstyle
 * dimensions (`dispelsPerMin` / `kicksPerMin` / `castsPerMin` /
 * `overhealPct`, computed by the SAME `computeHealerMetrics` the compare page
 * feeds) for every healer round in an archive slice, per-spec p10/p50/p90,
 * and — for the first N rounds — the exact deviation sentence
 * `verifiedComparison` would render against that distribution.
 *
 * The production reference corpus (`reference_vectors.json`) is rebuilt from
 * the feed (hours); this script answers "what would the page say" from the
 * archive slice so the sentence can be approved or killed first.
 *
 *   tsx playstyleExampleGen.ts --manifest <file> [--every 30] [--examples 4]
 */
import { ensureAnalysisData, isHealerSpec, specToString } from "@gladlog/analysis";
import { computeHealerMetrics } from "@gladlog/analysis/src/utils/healerMetrics";
import { GladLogParser } from "@gladlog/parser";
import { CombatUnitReaction, toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const arg = (f: string, d?: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const KEYS = ["dispelsPerMin", "kicksPerMin", "castsPerMin", "overhealPct", "ccDensity"] as const;

const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : NaN; };

async function main() {
  await ensureAnalysisData();
  let files = readFileSync(arg("--manifest")!, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const every = Number(arg("--every", "30")); if (every > 1) files = files.filter((_, i) => i % every === 0);
  const nEx = Number(arg("--examples", "4"));
  const bySpec = new Map<string, Record<string, number[]>>();
  const examples: Array<{ spec: string; name: string; file: string; m: Record<string, number | null> }> = [];
  for (const path of files) {
    let text: string; try { text = gunzipSync(readFileSync(path)).toString("utf8"); } catch { continue; }
    const combats: any[] = [];
    try { const p = new GladLogParser(); p.on("match", (m: any) => combats.push(toLegacyMatch(m))); p.on("shuffle", (sh: any) => { for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r); }); for (const l of text.split("\n")) p.push(l); p.end(); } catch { continue; }
    for (const c of combats) {
      if ((c.endTime - c.startTime) / 1000 < 120) continue;
      for (const u of Object.values(c.units ?? {}) as any[]) {
        if (!u.info || !isHealerSpec(u.spec) || u.reaction !== CombatUnitReaction.Friendly) continue;
        let m: any; try { m = computeHealerMetrics(c, u.name); } catch { continue; }
        const spec = specToString(u.spec);
        const d = bySpec.get(spec) ?? bySpec.set(spec, Object.fromEntries(KEYS.map((k) => [k, []]))).get(spec)!;
        for (const k of KEYS) if (typeof m[k] === "number" && !Number.isNaN(m[k])) d[k]!.push(m[k]);
        if (examples.length < nEx) examples.push({ spec, name: u.name, file: path.split("/").pop()!, m });
      }
    }
  }
  console.log("| spec | n | dispels/min p10/p50/p90 | kicks/min | casts/min | overheal% | cc/min |");
  console.log("|---|---|---|---|---|---|---|");
  for (const [spec, d] of [...bySpec.entries()].sort()) {
    const f = (k: string, mul = 1, dec = 2) => `${(q(d[k]!, 10) * mul).toFixed(dec)} / ${(q(d[k]!, 50) * mul).toFixed(dec)} / ${(q(d[k]!, 90) * mul).toFixed(dec)}`;
    console.log(`| ${spec} | ${d.castsPerMin!.length} | ${f("dispelsPerMin")} | ${f("kicksPerMin")} | ${f("castsPerMin", 1, 1)} | ${f("overhealPct", 100, 0)} | ${f("ccDensity")} |`);
  }
  console.log("\n### the sentences the compare page would render (first rounds)");
  const verdict = (v: number, xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const r = s.filter((x) => x <= v).length / Math.max(1, s.length) * 100; return `${Math.round(r)}th percentile — ${r < 25 ? "lower than most of your cohort" : r > 75 ? "higher than most of your cohort" : "in line with your cohort"}`; };
  for (const e of examples) {
    const d = bySpec.get(e.spec)!;
    console.log(`\n${e.spec} · ${e.name} · ${e.file}`);
    for (const k of KEYS) { const v = e.m[k]; if (typeof v !== "number") continue; const mul = k === "overhealPct" ? 100 : 1; console.log(`  ${k}: yours ${(v * mul).toFixed(2)} vs cohort median ${(q(d[k]!, 50) * mul).toFixed(2)} (p10 ${(q(d[k]!, 10) * mul).toFixed(2)} / p90 ${(q(d[k]!, 90) * mul).toFixed(2)}) → ${verdict(v, d[k]!)}`); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
