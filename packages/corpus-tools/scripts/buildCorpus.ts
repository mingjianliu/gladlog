import { gunzipSync, gzipSync } from "node:zlib";

import { ensureHeroTalents, REFERENCE_CELL_N_FLOOR } from "@gladlog/analysis";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

import { downloadLogText, fetchMatchStubs } from "../src/feedClient";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { aggregateCells } from "../src/cellAggregator";
import { loadGateTable } from "../src/keystoneGates";
import { buildPerMatchRecords } from "../src/perMatchRecord";
import { validateCorpus } from "../src/validateCorpus";

/**
 * Brackets to build, comma-separated. The point of the override is memory: the
 * builder holds every per-match record of the whole run before aggregating, and
 * a full three-bracket 2100-floor pass was killed twice by the OS on a 64GB
 * laptop (Solo Shuffle logs run ~30MB each). Cells are keyed BY bracket and
 * never interact across brackets, so building one bracket per process and
 * concatenating the `cells` arrays is equivalent to one big run — that is what
 * `mergeCorpora.ts` does.
 */
const BRACKETS = (process.env.BRACKETS ?? "Rated Solo Shuffle,2v2,3v3")
  .split(",")
  .map((b) => b.trim())
  .filter(Boolean);
const MIN_RATING = Number(process.env.MIN_RATING ?? 2300);
const PER_BRACKET = Number(process.env.PER_BRACKET ?? 1200); // enough for mainstream archetypes to clear N_floor
// The floor is the read side's predicate (cellLookup.ts) — imported, not copied.
const N_FLOOR = REFERENCE_CELL_N_FLOOR;
const PATCH = process.env.WOW_PATCH ?? "unknown";
const OUT =
  process.env.OUT ?? path.join(__dirname, "../data/reference_vectors.json");
// Raw log cache (optional): weekly rebuilds and the eval corpus share the same
// downloads, avoiding repeated pulls from the bucket
const CACHE = process.env.LOG_CACHE_DIR ?? "";
const GATES = path.join(__dirname, "../data/keystoneGates.json");
/**
 * Local-archive mode (2026-09-11). The upstream discontinued match search on
 * 2026-09-08 — `latestMatches` answers every query with `SEARCH_DISABLED` and
 * the user's ruling that day was to stop asking (docs/DATA-COMPLIANCE.md §"What
 * we actually took"). The feed path above therefore cannot rebuild anything
 * any more, and silently returns zero stubs rather than failing loudly.
 *
 * Our own archive is the remaining source: 63,309 matches already downloaded,
 * with `playerTeamRating` / `bracket` per match in the ledger, which is exactly
 * the filter the feed used to apply server-side. Set both vars to use it:
 *   ARCHIVE_LEDGER  dir of ledger *.jsonl (id last-wins dedupe)
 *   ARCHIVE_ROOT    dir holding <id>.txt.gz, nested by date
 * Defaults stay on the feed, so nothing changes for a caller that has one.
 *
 * ⚠ The archive cannot reproduce the 2026-08-25 production corpus at its own
 * floor: at MIN_RATING=2300 it holds 518 Solo Shuffle / 50 3v3 / 550 2v2
 * matches, and 50 3v3 games put every 3v3 cell under N_FLOOR. Lowering
 * MIN_RATING changes what "the reference cohort" means, which is a user call —
 * measure both and compare cell counts before replacing production data.
 */
const ARCHIVE_LEDGER = process.env.ARCHIVE_LEDGER ?? "";
const ARCHIVE_ROOT = process.env.ARCHIVE_ROOT ?? "";

interface ArchiveEntry {
  id: string;
  bracket: string;
  rating: number;
  file: string;
}

/** Ledger -> per-bracket, rating-filtered, newest-first match list. */
async function readArchiveIndex(): Promise<Map<string, ArchiveEntry[]>> {
  const byId = new Map<string, { bracket: string; rating: number; start: number }>();
  for (const f of (await fs.readdir(ARCHIVE_LEDGER)).filter((n) => n.endsWith(".jsonl"))) {
    const text = await fs.readFile(path.join(ARCHIVE_LEDGER, f), "utf-8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        // last-wins by id: the ledger appends two lines per match
        byId.set(r.id, {
          bracket: r.bracket,
          rating: Number(r.playerTeamRating ?? 0),
          start: Number(r.startTime ?? 0),
        });
      } catch {
        /* a truncated tail line is not a reason to abandon the ledger */
      }
    }
  }
  // index the gz files once — the archive nests them by date
  const files = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const child = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(child);
      else if (ent.name.endsWith(".txt.gz"))
        files.set(ent.name.replace(/\.txt\.gz$/, ""), child);
    }
  };
  await walk(ARCHIVE_ROOT);

  const out = new Map<string, ArchiveEntry[]>();
  for (const [id, meta] of byId) {
    if (meta.rating < MIN_RATING) continue;
    const file = files.get(id);
    if (!file) continue; // in the ledger but never downloaded
    const list = out.get(meta.bracket) ?? [];
    list.push({ id, bracket: meta.bracket, rating: meta.rating, file });
    out.set(meta.bracket, list);
  }
  for (const [, list] of out) list.sort((a, b) => b.rating - a.rating);
  return out;
}

async function main() {
  const gateTable = await loadGateTable(GATES);
  // #37: hero-group fallback needs the talent map loaded before any record.
  await ensureHeroTalents();
  const recs = [];
  if (ARCHIVE_LEDGER && ARCHIVE_ROOT) {
    const index = await readArchiveIndex();
    for (const bracket of BRACKETS) {
      const list = (index.get(bracket) ?? []).slice(0, PER_BRACKET);
      console.log(`${bracket}: ${list.length} archived matches >= ${MIN_RATING}`);
      let i = 0;
      for (const entry of list) {
        try {
          const text = gunzipSync(await fs.readFile(entry.file)).toString("utf-8");
          recs.push(...buildPerMatchRecords(text, gateTable.gates));
        } catch (e) {
          console.warn(`skip ${entry.id}: ${e}`);
        }
        if (++i % 100 === 0)
          console.log(`  ${bracket}: ${i}/${list.length} logs, ${recs.length} records`);
      }
    }
    return finish(recs, gateTable);
  }
  for (const bracket of BRACKETS) {
    const stubs = await fetchMatchStubs({
      bracket,
      minRating: MIN_RATING,
      limit: PER_BRACKET,
    });
    console.log(`${bracket}: ${stubs.length} stubs`);
    let i = 0;
    for (const stub of stubs) {
      try {
        let text: string;
        // Cache is gz-compressed (~10:1 on combat logs): the 2026-08-25 regen
        // filled the disk at 23MB/log raw (3600 logs ≈ 84G vs 29G free).
        const cached = CACHE ? path.join(CACHE, `${stub.id}.txt.gz`) : "";
        if (cached && (await fs.pathExists(cached))) {
          text = gunzipSync(await fs.readFile(cached)).toString("utf-8");
        } else {
          text = await downloadLogText(stub);
          if (cached) {
            await fs.ensureDir(CACHE);
            await fs.writeFile(cached, gzipSync(text));
          }
        }
        recs.push(...buildPerMatchRecords(text, gateTable.gates));
      } catch (e) {
        console.warn(`skip ${stub.id}: ${e}`);
      }
      if (++i % 100 === 0)
        console.log(
          `  ${bracket}: ${i}/${stubs.length} logs, ${recs.length} records`,
        );
    }
  }
  return finish(recs, gateTable);
}

async function finish(
  recs: Awaited<ReturnType<typeof buildPerMatchRecords>>,
  gateTable: Awaited<ReturnType<typeof loadGateTable>>,
): Promise<void> {
  const corpus = aggregateCells(
    recs,
    N_FLOOR,
    { wowPatchVersion: PATCH, sourceFloor: MIN_RATING },
    gateTable.gates,
  );
  const violations = validateCorpus(corpus, N_FLOOR);
  if (violations.length > 0) {
    console.error(`VALIDATION FAILED (${violations.length}):`);
    violations.slice(0, 40).forEach((v) => console.error("  " + v));
    process.exit(1);
  }
  await fs.ensureDir(path.dirname(OUT));
  await fs.writeJson(OUT, corpus, { spaces: 0 });
  const sizeMB = (fs.statSync(OUT).size / 1e6).toFixed(2);
  console.log(
    `wrote ${corpus.cells.length} cells (${sizeMB}MB), buildGroups: ${Object.keys(corpus.buildGroups).join(", ") || "none"} → ${OUT}`,
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
