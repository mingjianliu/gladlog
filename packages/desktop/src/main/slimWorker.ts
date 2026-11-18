import { readFileSync, renameSync, writeFileSync } from "fs";
import { parentPort, workerData } from "worker_threads";

import { slimStoredDoc } from "../shared/slimDoc";
import {
  backfillStatedStart,
  openingInstantsOf,
} from "../shared/statedStartBackfill";

/**
 * One-shot self-healing worker (since doc bytes are passed through, main no
 * longer parses the doc): for old fat archives lacking the slimmed marker, do
 * read → parse → slim → atomic write-back, and report the shuffle line-offset
 * table; main receives only this small result object, with all the heavy work
 * kept off the main thread.
 * Single-source predicate: shares shared/slimDoc with production (compose) and
 * the whole-library migration (scripts/slimLibrary). Idempotent — an
 * already-slim archive yields changed=false and only fills in meta.
 *
 * The same pass heals a document stored before the parser kept
 * `statedStartTime` (pipeline T200): handed `rawPath`, it reads raw.txt's
 * opening lines and writes the field where it is missing
 * (shared/statedStartBackfill). One read, one parse, one write of match.json
 * for both heals. Not handed it, it leaves the field alone. `statedComplete`
 * = every match / round of the document carries the field now.
 */
try {
  const { filePath, rawPath } = workerData as {
    filePath: string;
    rawPath?: string;
  };
  const doc = JSON.parse(readFileSync(filePath, "utf8")) as {
    data?: { rounds?: Array<{ sequenceNumber: number; linesTotal: number }> };
  };
  const slimChanged = slimStoredDoc(doc);
  let stated = { changed: false, complete: false };
  if (rawPath !== undefined) {
    let openings: Array<number | null> | null = null;
    try {
      openings = openingInstantsOf(readFileSync(rawPath, "utf8"));
    } catch {
      /* no raw.txt: only report what the document already carries */
    }
    stated = backfillStatedStart(doc, openings);
  }
  const changed = slimChanged || stated.changed;
  if (changed) {
    const tmp = filePath + ".slim-tmp";
    writeFileSync(tmp, JSON.stringify(doc));
    renameSync(tmp, filePath);
  }
  const rounds = doc.data?.rounds;
  const roundLinesTotal = Array.isArray(rounds)
    ? [...rounds]
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
        .map((r) => ({ seq: r.sequenceNumber, lines: r.linesTotal }))
    : undefined;
  parentPort!.postMessage({
    ok: true,
    changed,
    statedComplete: stated.complete,
    roundLinesTotal,
  });
} catch {
  parentPort?.postMessage({ ok: false });
}
