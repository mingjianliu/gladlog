/**
 * Forward check for the offensive-purger roster (`canOffensivePurge`:
 * OFFENSIVE_PURGERS + the DH / Hunter talent gates + the PvP-talent path;
 * CLAUDE.md Curated-List Completeness Rule; triage 2026-09-29 missed-cleanse
 * F-P5). Ground truth: every player who removed an enemy buff (our side's
 * `ourPurges`, the enemy side's `hostilePurges`, pet dispels folded to the
 * owner) — a spec that did it but `canOffensivePurge` rejects is a roster gap
 * (the Devourer DH and every Hunter spec before 2026-09-30). Expected: 0 rows,
 * except players whose talent gate genuinely failed (reported with their
 * dispel spell so a stale gate id shows).
 *
 *   npx tsx packages/eval/scripts/purgerRosterScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt --every 30
 */
import { ensureAnalysisData, specToString } from "@gladlog/analysis";
import {
  canOffensivePurge,
  reconstructDispelSummary,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { type ICombatUnit, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const manifest = arg("--manifest");
if (!manifest) {
  console.error("usage: purgerRosterScan.ts --manifest <path> [--every N]");
  process.exit(1);
}
const every = Number(arg("--every") ?? "1");
await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const bySpec = new Map<
  string,
  { players: number; rejected: number; spells: Map<string, number> }
>();
for (const f of files) {
  let text: string;
  try {
    const raw = readFileSync(f);
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    const { friends, enemies } = splitTeams(legacy);
    const units = Object.values(legacy.units);
    const fIds = new Set(friends.map((u) => u.id));
    const eIds = new Set(enemies.map((u) => u.id));
    let ds: ReturnType<typeof reconstructDispelSummary>;
    try {
      ds = reconstructDispelSummary(
        friends,
        enemies,
        legacy,
        units.filter((u) => u.ownerId && fIds.has(u.ownerId)),
        units.filter((u) => u.ownerId && eIds.has(u.ownerId)),
      );
    } catch {
      continue;
    }
    const byName = new Map<string, ICombatUnit>(
      [...friends, ...enemies].map((u) => [u.name, u]),
    );
    const seen = new Set<string>();
    for (const p of [...ds.ourPurges, ...ds.hostilePurges]) {
      const u = byName.get(p.sourceName);
      if (!u || seen.has(u.id)) continue;
      seen.add(u.id);
      const k = `${u.spec} ${specToString(u.spec)}`;
      const e = bySpec.get(k) ?? {
        players: 0,
        rejected: 0,
        spells: new Map<string, number>(),
      };
      e.players++;
      if (!canOffensivePurge(u)) {
        e.rejected++;
        const sk = `${p.dispelSpellId} ${p.dispelSpellName}`;
        e.spells.set(sk, (e.spells.get(sk) ?? 0) + 1);
      }
      bySpec.set(k, e);
    }
  }
}
console.log(`files=${files.length}`);
console.log(
  "spec\tpurging players\trejected by canOffensivePurge\trejected players' purge spells",
);
for (const [k, e] of [...bySpec].sort((a, b) => b[1].rejected - a[1].rejected))
  console.log(
    `${k}\t${e.players}\t${e.rejected}\t${[...e.spells].map(([s, n]) => `${s}×${n}`).join("; ")}`,
  );
