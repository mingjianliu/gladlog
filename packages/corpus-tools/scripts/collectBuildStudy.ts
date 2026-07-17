/**
 * Exploratory (not shipped): collect per-round healer records enriched with
 * talent loadout, for the talent-build → metric-variance study. Dumps raw rows
 * to a JSON the analysis pass reads, so clustering/tests iterate without
 * re-parsing. Solo Shuffle only (richest healer sample).
 */
import {
  computeHealerMetrics,
  enemyCompArchetype,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import { GladLogParser } from "@gladlog/parser";
import { CombatUnitReaction,toLegacyShuffle } from "@gladlog/parser-compat";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

import { downloadLogText,fetchMatchStubs } from "../src/feedClient";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const N = Number(process.env.STUDY_LOGS ?? 600);
const OUT =
  process.env.STUDY_OUT ??
  path.join(__dirname, "../../../.study-build-rows.json");

interface Row {
  session: string;
  player: string;
  spec: string;
  archetype: string;
  talents: number[]; // sorted talent node id1 list = build signature
  offensiveIndex: number;
  ccDensity: number;
  defensiveOverlapRatio: number;
}

async function main() {
  const stubs = await fetchMatchStubs({
    bracket: "Rated Solo Shuffle",
    minRating: 2300,
    limit: N,
  });
  console.log(`${stubs.length} SS stubs`);
  const rows: Row[] = [];
  let done = 0;
  for (const stub of stubs) {
    try {
      const text = await downloadLogText(stub);
      const parser = new GladLogParser();
      const rounds: any[] = [];
      parser.on("shuffle", (sh: any) =>
        (toLegacyShuffle(sh).rounds ?? []).forEach((r: any) => rounds.push(r)),
      );
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
      for (const r of rounds) {
        const players = (Object.values(r.units) as any[]).filter((u) => u.info);
        const healers = players.filter(
          (u) =>
            isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
        );
        for (const h of healers) {
          const talents = (h.info?.talents ?? [])
            .map((t: any) => t.id1)
            .filter(Boolean)
            .sort((a: number, b: number) => a - b);
          if (talents.length === 0) continue;
          const enemies = players.filter((u) => u.reaction !== h.reaction);
          let m;
          try {
            m = computeHealerMetrics(r, h.name);
          } catch {
            continue;
          }
          rows.push({
            session: stub.id,
            player: h.id,
            spec: specToString(h.spec),
            archetype: enemyCompArchetype(enemies),
            talents,
            offensiveIndex: m.offensiveIndex,
            ccDensity: m.ccDensity,
            defensiveOverlapRatio: m.defensiveOverlapRatio,
          });
        }
      }
    } catch {
      // transient/parse errors are tolerable in a study sample
    }
    if (++done % 100 === 0)
      console.log(`  ${done}/${stubs.length}, ${rows.length} rows`);
  }
  await fs.writeJson(OUT, rows, { spaces: 0 });
  console.log(`wrote ${rows.length} rows → ${OUT}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
