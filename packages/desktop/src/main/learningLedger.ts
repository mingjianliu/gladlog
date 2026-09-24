/**
 * Learning ledger (spec §1): append-only NDJSON, one line = one analysis run
 * (with that match's findings embedded). Re-analyzing a match appends a new
 * line, and reads take the line with the largest createdAt per matchId --
 * last-run-wins whole-match replacement, so an old finding dropped by a newer
 * run does not linger forever.
 *
 * promptVersion is recorded but never invalidates anything: the ledger's
 * memory is not hostage to the analysis cache invalidation policy, which is
 * the core reason it exists separately from analysis-v2.*.json.
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { join } from "path";

import type {
  LedgerMatch,
  LedgerRun,
} from "@gladlog/analysis/src/learning/types";

/** Only rewrite when the line count exceeds 1.2x the merged match count
 * (>20% redundancy) -- spec §6. */
const COMPACT_REDUNDANCY_FACTOR = 1.2;

export function createLearningLedger(learningDir: string) {
  const file = join(learningDir, "ledger.ndjson");

  const readMerged = (): {
    byMatch: Map<string, LedgerRun>;
    badLines: number;
    totalLines: number;
  } => {
    const byMatch = new Map<string, LedgerRun>();
    let badLines = 0;
    let totalLines = 0;
    let raw = "";
    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      return { byMatch, badLines, totalLines };
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      totalLines++;
      try {
        const r = JSON.parse(line) as LedgerRun;
        if (r.v !== 1 || typeof r.matchId !== "string")
          throw new Error("shape");
        const prev = byMatch.get(r.matchId);
        if (!prev || r.createdAt >= prev.createdAt) byMatch.set(r.matchId, r);
      } catch {
        badLines++; // Bad lines are skipped but not silently: the count is surfaced through getState
      }
    }
    return { byMatch, badLines, totalLines };
  };

  return {
    file,
    append(runs: LedgerRun[]): void {
      if (runs.length === 0) return;
      mkdirSync(learningDir, { recursive: true });
      appendFileSync(
        file,
        runs.map((r) => JSON.stringify(r)).join("\n") + "\n",
        "utf-8",
      );
    },
    read(): { matches: LedgerMatch[]; badLines: number; totalLines: number } {
      const { byMatch, badLines, totalLines } = readMerged();
      const matches = [...byMatch.values()].map(
        ({ v: _v, promptVersion: _p, createdAt: _c, ...m }) => m,
      );
      return { matches, badLines, totalLines };
    },
    /** When redundancy exceeds the threshold, rewrite as the merged view
     * (atomic tmp+rename, the same approach as the analysis cache). */
    compact(): void {
      const { byMatch, totalLines } = readMerged();
      if (totalLines <= byMatch.size * COMPACT_REDUNDANCY_FACTOR) return;
      const tmp = `${file}.tmp`;
      writeFileSync(
        tmp,
        [...byMatch.values()].map((r) => JSON.stringify(r)).join("\n") + "\n",
        "utf-8",
      );
      renameSync(tmp, file);
    },
  };
}
