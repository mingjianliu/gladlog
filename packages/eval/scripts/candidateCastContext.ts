/**
 * candidateCastContext.ts — for every emitted candidate of one type, the
 * owner's own casts around it (with their targets), one TSV row per
 * candidate. The review sheet for "is this accusation right?".
 *
 * Born 2026-09-24 as a session probe for reliability audit A2 step 2 (the
 * recipient test): all 21 cd-hoarded additions turned out to be a save the
 * owner had just pressed on ANOTHER teammate — visible in one column of this
 * sheet, invisible in the candidate counts. Promoted 2026-09-25 (also the
 * review sheet for C2's Barkskin / Frenzied Regeneration additions).
 *
 * Row: findings-file key (same `${fileNo}-${roundIdx}-${ownerNo}.txt` naming
 * as acceptanceCapture --findings-dir), candidate id, owner spec, the
 * candidate's facts (JSON), and the owner's casts in [t - before, t + after]
 * as "+0.8s Ironbark→Target".
 *
 * Usage:
 *   npx tsx packages/eval/scripts/candidateCastContext.ts --manifest <file> \
 *     --out <file.tsv> [--every 30] [--type cd-hoarded] [--before 1.5] \
 *     [--after 5] [--raw-streams] [--ids <file of candidate ids>]
 */
import { extractCandidateFindings } from "@gladlog/analysis/src/analysis/candidateFindings";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { parseRawStreams } from "@gladlog/analysis/src/utils/rawStreams";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const manifest = flag("--manifest");
const outPath = flag("--out");
if (!manifest || !outPath) {
  console.error(
    "usage: candidateCastContext.ts --manifest <file> --out <file.tsv> [--every N] [--type T] [--before S] [--after S] [--raw-streams] [--ids <file>]",
  );
  process.exit(1);
}
const every = Number(flag("--every") ?? 30);
const type = flag("--type") ?? "cd-hoarded";
const before = Number(flag("--before") ?? 1.5);
const after = Number(flag("--after") ?? 5);
const useRaw = argv.includes("--raw-streams");
const idsPath = flag("--ids");
const onlyIds = idsPath
  ? new Set(
      readFileSync(idsPath, "utf8")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);
const rows: string[] = [];
let fileNo = 0;
let owners = 0;
for (const f of files) {
  fileNo++;
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
  let idx = 0;
  for (const m of items) {
    idx++;
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    const streams = useRaw
      ? parseRawStreams(
          text,
          legacy.startTime ?? 0,
          ((legacy.endTime ?? 0) - (legacy.startTime ?? 0)) / 1000,
        )
      : undefined;
    const { friends } = splitTeams(legacy);
    for (const owner of friends) {
      owners++;
      let cands: ReturnType<typeof extractCandidateFindings> = [];
      try {
        cands = extractCandidateFindings(legacy, owner.id, streams);
      } catch {
        continue;
      }
      for (const c of cands) {
        if (c.type !== type) continue;
        if (onlyIds && !onlyIds.has(c.id)) continue;
        const t = c.t;
        const casts = ((owner as any).spellCastEvents ?? [])
          .filter((e: any) => e.logLine?.event === "SPELL_CAST_SUCCESS")
          .map((e: any) => ({
            s: (e.logLine.timestamp - legacy.startTime) / 1000,
            n: e.spellName,
            d: e.destUnitName,
          }))
          .filter((x: any) => x.s >= t - before && x.s <= t + after)
          .map(
            (x: any) =>
              `${x.s - t >= 0 ? "+" : ""}${(x.s - t).toFixed(1)}s ${x.n}→${x.d && x.d !== "nil" ? x.d : "-"}`,
          );
        rows.push(
          [
            `${fileNo}-${idx}-${owners}.txt`,
            c.id,
            String((owner as any).spec),
            JSON.stringify(c.facts),
            casts.join(" | "),
          ].join("\t"),
        );
      }
    }
  }
}
writeFileSync(outPath, rows.join("\n") + "\n");
console.log(
  `files=${files.length} owners=${owners} rows=${rows.length} → ${outPath}`,
);
