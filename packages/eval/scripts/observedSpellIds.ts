/**
 * The corpus-observed spell id set (permanent, companion to update-wow-data):
 * every spellId that appeared in casts / auraEvents / actionsOut across the full
 * corpus (ids only, safe to publish).
 * genSpellIcons uses it to shrink the icon universe from the whole SpellMisc
 * table (408k entries, 13.8MB, blowing the first-render budget) down to the set
 * actually seen in play, with no loss of coverage.
 * Usage: tsx observedSpellIds.ts --manifest <file> [--store <matches dir>]
 *   > .../observedSpellIdsGenerated.json
 * --store reads the stored match.json directly (covering matches from new game
 * patches, with no re-parsing).
 * Manifest entries ending in `.gz` are gunzipped in memory (the PvP log archive
 * stores raw gzip bytes; ~11x smaller, never materialised as .txt). A file that
 * fails to read/parse is counted and skipped, not fatal — one corrupt upload
 * must not abort a 10k-match pass.
 */
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const mIdx = argv.indexOf("--manifest");
if (mIdx < 0) {
  console.error("Usage: observedSpellIds --manifest <file>");
  process.exit(1);
}
const ids = new Set<number>();
const files = readFileSync(argv[mIdx + 1]!, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
let nFiles = 0;
let nFailed = 0;
let nItems = 0;
for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  try {
    const raw = readFileSync(f);
    const text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    for (const line of text.split("\n")) parser.push(line);
    parser.end();
  } catch (e) {
    nFailed++;
    console.error(`skip ${f}: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  nFiles++;
  nItems += items.length;
  if (nFiles % 200 === 0) console.error(`… ${nFiles}/${files.length} files, ${nItems} rounds, ${ids.size} ids`);
  for (const m of items)
    for (const u of Object.values(m.units))
      for (const arr of [u.casts, u.castStarts, u.petCasts, u.auraEvents, u.actionsOut, u.damageOut, u.healOut] as const)
        for (const e of arr) if (e.spellId) ids.add(Number(e.spellId));
}
const sIdx = argv.indexOf("--store");
if (sIdx >= 0) {
  const dir = argv[sIdx + 1]!;
  for (const id of readdirSync(dir)) {
    const p2 = join(dir, id, "match.json");
    if (!existsSync(p2)) continue;
    try {
      const doc = JSON.parse(readFileSync(p2, "utf8"));
      const sources = doc.data?.rounds ?? [doc.data];
      for (const src of sources)
        for (const u of Object.values(src?.units ?? {}) as {
          [k: string]: { spellId?: number | string }[];
        }[])
          for (const arr of ["casts", "castStarts", "petCasts", "auraEvents", "actionsOut", "damageOut", "healOut"])
            for (const e of (u[arr] ?? []) as { spellId?: number | string }[])
              if (e.spellId) ids.add(Number(e.spellId));
    } catch {
      /* skip */
    }
  }
}
process.stdout.write(JSON.stringify([...ids].sort((a, b) => a - b)));
console.error(`observed spell ids: ${ids.size} (manifest: ${nFiles} files / ${nItems} rounds parsed, ${nFailed} skipped)`);
