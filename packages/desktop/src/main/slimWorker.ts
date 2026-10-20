import { readFileSync, renameSync,writeFileSync } from "fs";
import { parentPort, workerData } from "worker_threads";

import { slimStoredDoc } from "../shared/slimDoc";

/**
 * One-shot self-healing worker (since doc bytes are passed through, main no
 * longer parses the doc): for old fat archives lacking the slimmed marker, do
 * read → parse → slim → atomic write-back, and report the shuffle line-offset
 * table; main receives only this small result object, with all the heavy work
 * kept off the main thread.
 * Single-source predicate: shares shared/slimDoc with production (compose) and
 * the whole-library migration (scripts/slimLibrary). Idempotent — an
 * already-slim archive yields changed=false and only fills in meta.
 */
try {
  const { filePath } = workerData as { filePath: string };
  const doc = JSON.parse(readFileSync(filePath, "utf8")) as {
    data?: { rounds?: Array<{ sequenceNumber: number; linesTotal: number }> };
  };
  const changed = slimStoredDoc(doc);
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
  parentPort!.postMessage({ ok: true, changed, roundLinesTotal });
} catch {
  parentPort?.postMessage({ ok: false });
}
