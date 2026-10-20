import { readFileSync, renameSync, statSync,writeFileSync } from "fs";
import { parentPort, workerData } from "worker_threads";

import { buildShellText,scanRoundOffsets } from "../shared/roundOffsets";

/**
 * One-shot sidecar builder (perf-1): byte-scan match.json for the per-round
 * offsets and write rounds.idx.json next to it, so subsequent opens read +
 * parse only the shell and the active round. Runs off the main thread (the
 * scan is a full pass over up-to-277MB files, ~seconds).
 *
 * Validation before writing (fail-open: no sidecar is just the slow path):
 * the assembled shell and every round range must each JSON.parse on their own,
 * and the stat taken BEFORE reading must still match after — a concurrent
 * rewrite (slim self-heal) between read and write would otherwise persist
 * offsets into bytes that no longer exist.
 */
try {
  const { filePath, outPath } = workerData as {
    filePath: string;
    outPath: string;
  };
  const before = statSync(filePath);
  const buf = readFileSync(filePath);
  const off = scanRoundOffsets(buf);
  if (!off || off.rounds.length === 0) {
    parentPort!.postMessage({ ok: false });
  } else {
    JSON.parse(buildShellText(buf, off));
    for (const [s, e] of off.rounds)
      JSON.parse(buf.subarray(s, e).toString("utf-8"));
    const after = statSync(filePath);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      parentPort!.postMessage({ ok: false });
    } else {
      const idx = {
        v: 1,
        fileSize: before.size,
        mtimeMs: before.mtimeMs,
        arrayOpenEnd: off.arrayOpenEnd,
        arrayClose: off.arrayClose,
        rounds: off.rounds,
      };
      const tmp = outPath + ".tmp";
      writeFileSync(tmp, JSON.stringify(idx));
      renameSync(tmp, outPath);
      parentPort!.postMessage({ ok: true, roundCount: off.rounds.length });
    }
  }
} catch {
  parentPort?.postMessage({ ok: false });
}
