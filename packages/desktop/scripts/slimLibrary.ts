/**
 * Whole-library slimming migration (follow-up to the 2026-07-26 audit, called
 * by the user): apply the slim predicate (the very same slimStoredDoc already
 * used by the ingest path and the self-heal path) in bulk to archives that
 * have not been slimmed yet.
 *
 * Safety design:
 * - raw.txt is never touched (it is the byte-exact source; match.json can be
 *   rebuilt by the parser at any time);
 * - atomic per match: write match.json.slimtmp → read back and compare byte by
 *   byte → check structural invariants (kind/id/units key set/length of each
 *   event array/number of rounds) → rename over the original;
 * - interruptible and resumable: meta.slimmed=true means skip, so a re-run
 *   after Ctrl-C picks up where it left off;
 * - also writes meta.roundLinesTotal (shuffle) so rawLine can get line offsets
 *   without parsing.
 *
 * Usage: npx tsx packages/desktop/scripts/slimLibrary.ts [matchesDir]
 *   default matchesDir = ~/Library/Application Support/gladlog/matches
 *   GLADLOG_SLIM_LIMIT=N processes only the first N matches (for a trial run).
 */
import { readFileSync, renameSync, statSync,writeFileSync } from "fs";
import { existsSync,readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { slimStoredDoc } from "../src/shared/slimDoc";

const dir =
  process.argv[2] ??
  join(homedir(), "Library/Application Support/gladlog/matches");
const limit = Number(process.env.GLADLOG_SLIM_LIMIT ?? Infinity);

type Doc = {
  kind?: string;
  data?: {
    id?: string;
    kind?: string;
    units?: Record<string, Record<string, unknown>>;
    rounds?: Array<{
      sequenceNumber: number;
      linesTotal: number;
      units?: Record<string, Record<string, unknown>>;
    }>;
  };
};

/** Structural-invariant fingerprint: slimming only trims params slots and
 * materializes crit, so every item here must stay identical. */
function fingerprint(doc: Doc): string {
  const unitSig = (units?: Record<string, Record<string, unknown>>) =>
    Object.entries(units ?? {})
      .map(
        ([id, u]) =>
          `${id}:` +
          Object.entries(u)
            .filter(([, v]) => Array.isArray(v))
            .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
            .sort()
            .join(","),
      )
      .sort()
      .join(";");
  const d = doc.data ?? {};
  const rounds = Array.isArray(d.rounds)
    ? d.rounds.map((r) => `[${r.sequenceNumber}:${unitSig(r.units)}]`).join("")
    : unitSig(d.units);
  return `${doc.kind}|${d.id ?? ""}|${rounds}`;
}

async function main(): Promise<void> {
  const ids = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;
  const t0 = Date.now();

  for (const id of ids) {
    if (done + skipped >= limit) break;
    const matchPath = join(dir, id, "match.json");
    const metaPath = join(dir, id, "meta.json");
    if (!existsSync(matchPath) || !existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
        slimmed?: boolean;
        kind?: string;
        roundLinesTotal?: Array<{ seq: number; lines: number }> | number[];
      };
      const legacyForm =
        Array.isArray(meta.roundLinesTotal) &&
        typeof meta.roundLinesTotal[0] === "number";
      if (meta.slimmed && !legacyForm) {
        skipped++;
        continue;
      }
      // legacyForm: the first version of this script wrote a bare number[]
      // that lost seq; the doc is already slim, so we only re-read to fix meta
      const before = statSync(matchPath).size;
      const doc = JSON.parse(readFileSync(matchPath, "utf-8")) as Doc;
      const fpBefore = fingerprint(doc);
      const changed = slimStoredDoc(doc);

      if (changed) {
        const out = JSON.stringify(doc);
        // Structural invariant: the fingerprint after trimming must match
        // (unit key set, length of each event array)
        const fpAfter = fingerprint(doc);
        if (fpAfter !== fpBefore)
          throw new Error(`结构指纹变了,拒绝写入: ${id}`);
        const tmp = matchPath + ".slimtmp";
        writeFileSync(tmp, out);
        // Read back and compare byte by byte: guards partial writes / disk
        // errors
        const back = readFileSync(tmp, "utf-8");
        if (back !== out) throw new Error(`回读不一致,拒绝覆盖: ${id}`);
        renameSync(tmp, matchPath);
      }
      // Backfill meta (for shuffle, also write the line-offset table)
      meta.slimmed = true;
      if (Array.isArray(doc.data?.rounds)) {
        // Paired form {seq, lines}: rawLine's offset predicate is
        // sequenceNumber < roundSeq, and we must not assume round numbers are
        // contiguous from 0 — a bare array that loses seq is not enough.
        meta.roundLinesTotal = [...doc.data.rounds]
          .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
          .map((r) => ({ seq: r.sequenceNumber, lines: r.linesTotal }));
      }
      writeFileSync(metaPath + ".slimtmp", JSON.stringify(meta, null, 2));
      renameSync(metaPath + ".slimtmp", metaPath);

      const after = statSync(matchPath).size;
      bytesBefore += before;
      bytesAfter += after;
      done++;
      if (done % 25 === 0)
        console.log(
          `[slim] ${done} done (${skipped} skipped, ${failed} failed) ` +
            `${(bytesBefore / 1e9).toFixed(1)}GB→${(bytesAfter / 1e9).toFixed(1)}GB ` +
            `${Math.round((Date.now() - t0) / 1000)}s`,
        );
      // Yield: do not saturate the machine's IO
      await new Promise((r) => setImmediate(r));
    } catch (err) {
      failed++;
      console.error(`[slim] FAIL ${id}: ${String(err)}`);
    }
  }
  console.log(
    `[slim] 完成: ${done} 场瘦身, ${skipped} 已瘦跳过, ${failed} 失败; ` +
      `处理档 ${(bytesBefore / 1e9).toFixed(2)}GB → ${(bytesAfter / 1e9).toFixed(2)}GB ` +
      `(-${bytesBefore ? Math.round((1 - bytesAfter / bytesBefore) * 100) : 0}%), ` +
      `耗时 ${Math.round((Date.now() - t0) / 1000)}s`,
  );
}

void main();
