/**
 * burstMitigationOverlapProbe.ts — how long does the wall actually cover the
 * burst in burst-into-mitigation candidates? (GH #96, 2026-09-14)
 *
 * Why: reviewing real examples of the candidates the talentMitigation switch
 * adds, one Avatar + Recklessness burst (20 s) was accused of going "into"
 * a Barkskin that overlapped it for 0.7 s — the ledger keeps any defensive
 * overlapping ≥ MIN_DEFENSIVE_OVERLAP_S (0.5 s), and the candidate door only
 * checks the wall's strength. This probe measures, for every emitted
 * candidate, the overlap of the cited wall in seconds and as a share of the
 * burst span, so the user can rule on an overlap door with numbers.
 *
 * Usage (run once per switch value):
 *   [GLADLOG_FACT_CONFIG='{"talentMitigation":true}'] npx tsx packages/eval/scripts/burstMitigationOverlapProbe.ts \
 *     --manifest <manifest> [--every 30] --out <file.json>
 */
import {
  ensureAnalysisData,
  extractCandidateFindings,
} from "@gladlog/analysis";
import { getFactConfig } from "@gladlog/analysis/src/facts/factProviderConfig";
import { analyzeBurstLedger } from "@gladlog/analysis/src/utils/burstLedger";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";
import { arg } from "./lib/cli";

const manifest = arg("--manifest", "");
const every = Number(arg("--every", "30"));
const outPath = arg("--out", "");

await ensureAnalysisData();
const config = getFactConfig();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const rows: Array<{
  input: string;
  mitSpell: string;
  mitPct: string;
  overlapS: number;
  spanS: number;
  share: number;
  hpStart: number | null;
  hpEnd: number | null;
  died: boolean;
}> = [];
for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const [idx, m] of items.entries()) {
    let legacy: any;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    const { friends } = splitTeams(legacy);
    const players = (Object.values(legacy.units) as any[]).filter(
      (u) => u.info,
    );
    for (const owner of friends as any[]) {
      let cands: any[];
      try {
        cands = extractCandidateFindings(legacy, owner.id);
      } catch {
        continue;
      }
      const bim = cands.filter((c) => c.type === "burst-into-mitigation");
      if (!bim.length) continue;
      const allies = players.filter(
        (u) => u.reaction === owner.reaction && u.id !== owner.id,
      );
      const enemies = players.filter((u) => u.reaction !== owner.reaction);
      const ledger = analyzeBurstLedger(owner, allies, enemies, legacy);
      for (const c of bim) {
        const b = ledger.find((e) => Math.abs(e.fromSeconds - c.t) < 0.01);
        const hit = b?.dominantTarget?.defensivesHit
          .filter((d) => d.spellName === c.facts.mitSpell)
          .sort((x, y) => y.overlapSeconds - x.overlapSeconds)[0];
        if (!b || !hit) continue;
        const spanS = b.toSeconds - b.fromSeconds;
        rows.push({
          input: `${f}#${idx + 1}#${owner.id}`,
          mitSpell: c.facts.mitSpell,
          mitPct: c.facts.mitPct,
          overlapS: hit.overlapSeconds,
          spanS: Math.round(spanS * 10) / 10,
          share: Math.round((hit.overlapSeconds / spanS) * 100) / 100,
          hpStart: b.dominantTarget!.hpStartPct,
          hpEnd: b.dominantTarget!.hpEndPct,
          died: b.dominantTarget!.died,
        });
      }
    }
  }
}
writeFileSync(
  outPath,
  JSON.stringify({ config, files: files.length, rows }, null, 1),
);
const bins = [0.5, 1, 2, 3, 5, 8, Infinity];
const shareBins = [0.1, 0.25, 0.5, 0.75, Infinity];
const hist = (xs: number[], edges: number[]) =>
  edges.map((e, i) => {
    const lo = i ? edges[i - 1]! : 0;
    return `[${lo},${e === Infinity ? "∞" : e}) ${xs.filter((x) => x >= lo && x < e).length}`;
  });
console.log(`config ${JSON.stringify(config)} candidates ${rows.length}`);
console.log(
  "overlap seconds:",
  hist(
    rows.map((r) => r.overlapS),
    bins,
  ).join("  "),
);
console.log(
  "overlap share of burst:",
  hist(
    rows.map((r) => r.share),
    shareBins,
  ).join("  "),
);
console.log(
  "target died in burst:",
  rows.filter((r) => r.died).length,
  "| target HP rose or held:",
  rows.filter(
    (r) => r.hpEnd !== null && r.hpStart !== null && r.hpEnd >= r.hpStart,
  ).length,
);
