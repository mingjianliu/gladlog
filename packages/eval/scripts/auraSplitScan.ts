/**
 * FT-T08 scan: is one aura application still split in two?
 *
 * The game re-broadcasts some auras: SPELL_AURA_REMOVED and SPELL_AURA_APPLIED
 * of the same spell, source and target back to back, with no new cast — one
 * continuous aura (`dropAuraRebroadcasts`). The log's timestamps carry four
 * decimals, so the two lines of one re-broadcast can sit on either side of a
 * millisecond boundary (f4da82c5: one Sleep Walk cast, REMOVED 10.1853 and
 * APPLIED 10.1863, rendered as two `(0s)` CC lines).
 *
 * Per match / shuffle round, over the player units' `buildAuraIntervals`:
 *   SPLIT   two intervals of one spell from one source (by GUID) on one unit,
 *           the second starting within the re-broadcast gap after the first
 *           ended (both ends logged, not inferred)             → must be 0
 * and the gap histogram up to 50 ms, CC auras apart, so the bound can be
 * re-read on a new corpus.
 *
 * Usage: npx tsx packages/eval/scripts/auraSplitScan.ts [--show] <raw.txt | dir>...
 * Exit code 1 when SPLIT is non-zero.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { ensureAnalysisData } from "@gladlog/analysis";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import * as auraIntervals from "@gladlog/analysis/src/utils/auraIntervals";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";

await ensureAnalysisData();

// The literal is only a stand-in so the scan can print the BEFORE number on a
// commit that predates the constant; from FT-T08 on it is the export.
const GAP_MS: number =
  (auraIntervals as { AURA_REBROADCAST_GAP_MS?: number })
    .AURA_REBROADCAST_GAP_MS ?? 1;
const EDGES = [0, 1, 2, 5, 10, 50];

function rawFiles(arg: string): string[] {
  if (!statSync(arg).isDirectory()) return [arg];
  const out: string[] = [];
  for (const entry of readdirSync(arg).sort()) {
    const p = path.join(arg, entry);
    if (statSync(p).isDirectory()) out.push(...rawFiles(p));
    else if (entry === "raw.txt") out.push(p);
  }
  return out;
}

const SHOW = process.argv.includes("--show");
const args = process.argv.slice(2).filter((a) => a !== "--show");
if (args.length === 0) {
  console.error("usage: auraSplitScan.ts [--show] <raw.txt | dir>...");
  process.exit(2);
}

let files = 0;
let rounds = 0;
let intervals = 0;
let split = 0;
let splitCc = 0;
let otherSource = 0;
let ambiguous = 0;
const hist = EDGES.map(() => 0);
const histCc = EDGES.map(() => 0);
const bySpell = new Map<string, number>();

for (const file of args.flatMap(rawFiles)) {
  const items: GladMatch[] = [];
  const p = new GladLogParser();
  p.on("match", (m: GladMatch) => items.push(m));
  p.on("shuffle", (sh) => {
    for (const r of sh.rounds) items.push(r as never);
  });
  for (const line of readFileSync(file, "utf8").split("\n")) p.push(line);
  p.end();
  files++;
  let fileSplit = 0;
  for (const m of items) {
    let legacy;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    for (const u of Object.values(legacy.units)) {
      if (!u.info) continue;
      const last = new Map<string, auraIntervals.IAuraInterval>();
      // An interval names its source by NAME only; two pets called "Beast"
      // handing Mortal Wounds to each other are two sources. The source GUIDs
      // of the REMOVED that closed one interval and the APPLIED that opened
      // the next are read off the events themselves.
      const sourcesAt = (spellId: string, event: string, atS: number) =>
        new Set(
          (u.auraEvents ?? [])
            .filter(
              (e) =>
                e.spellId === spellId &&
                (e.logLine.event as string) === event &&
                Math.abs((e.timestamp - legacy.startTime) / 1000 - atS) < 5e-4,
            )
            .map((e) => e.srcUnitId),
        );
      for (const iv of auraIntervals.buildAuraIntervals(u, legacy)) {
        intervals++;
        const key = `${iv.spellId}|${iv.srcUnitName}`;
        const prev = last.get(key);
        last.set(key, iv);
        if (!prev || prev.inferredEnd || iv.inferredStart) continue;
        // events past the round's end are clamped onto it: a zero-length
        // interval sitting on the clamp is no second application
        if (iv.fromS === iv.toS && prev.toS === iv.fromS) continue;
        const gap = Math.round((iv.fromS - prev.toS) * 1000);
        if (gap < 0 || gap > EDGES[EDGES.length - 1]!) continue;
        const cc = ccSpellIds.has(iv.spellId);
        const b = EDGES.findIndex((e) => gap <= e);
        hist[b]!++;
        if (cc) histCc[b]!++;
        if (gap > GAP_MS) continue;
        const closedBy = sourcesAt(iv.spellId, "SPELL_AURA_REMOVED", prev.toS);
        const openedBy = sourcesAt(iv.spellId, "SPELL_AURA_APPLIED", iv.fromS);
        if (![...closedBy].some((id) => openedBy.has(id))) {
          otherSource++;
          continue;
        }
        // several sources of one name closing and opening in the same ms:
        // which REMOVED belongs to which interval cannot be read back
        if (closedBy.size !== 1 || openedBy.size !== 1) {
          ambiguous++;
          continue;
        }
        split++;
        fileSplit++;
        if (cc) splitCc++;
        const name = `${getEnglishSpellName(iv.spellId, iv.spellName)} (${iv.spellId}${cc ? ", CC" : ""})`;
        bySpell.set(name, (bySpell.get(name) ?? 0) + 1);
        if (SHOW)
          console.log(
            `  SPLIT ${m.id} ${u.name} ${name} ${prev.fromS.toFixed(3)}–${prev.toS.toFixed(3)} | ${iv.fromS.toFixed(3)}–${iv.toS.toFixed(3)}`,
          );
      }
    }
  }
  if (fileSplit > 0)
    console.log(`${path.basename(path.dirname(file))} SPLIT=${fileSplit}`);
}

console.log(
  `\n=== ${files} files, ${rounds} matches / rounds, ${intervals} aura intervals on players; re-broadcast gap ≤ ${GAP_MS} ms ===`,
);
console.log(
  "interval → next interval of the same aura, gap ≤ms: " +
    EDGES.map((e, i) => `${e}:${hist[i]}`).join("  "),
);
console.log(
  "  of which CC auras: " + EDGES.map((e, i) => `${e}:${histCc[i]}`).join("  "),
);
console.log(
  `SPLIT ${split} (CC auras ${splitCc}); back-to-back intervals from two different sources of one name, not counted: ${otherSource}; several sources in the same ms, not counted: ${ambiguous}`,
);
for (const [name, n] of [...bySpell.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20))
  console.log(`  ${n}  ${name}`);
process.exit(split > 0 ? 1 : 0);
