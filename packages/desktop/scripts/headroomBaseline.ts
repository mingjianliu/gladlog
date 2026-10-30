/**
 * KEPT baseline script for design doc §9.1's acceptance number -- NOT a
 * throwaway probe (CLAUDE.md: "don't leave a one-off script, it vanishes with
 * the session; stage 2's close-out needs the identical predicate to produce a
 * before/after pair"). Prints headroomS's median and distribution across
 * every recorded, match-claimed chunk in this machine's recordings.ndjson.
 *
 * headroomS is computed through the SAME single-source arithmetic the
 * renderer uses (shared/videoTime.ts -> computeVideoWindow), never a
 * hand-rolled recomputation -- shared-predicate rule, CLAUDE.md. Design doc
 * §9.1: `headroomMs = source.startTime - chunk.startedAt`; phase 1's baseline
 * is expected all-negative (recording starts after the match, i.e. the
 * opening is missing); phase 2's real-machine target is "mostly positive,
 * exceptions explicit" (§5.5).
 *
 * Usage:
 *   npm run recorder:headroom --workspace=packages/desktop
 *   npx tsx packages/desktop/scripts/headroomBaseline.ts [--user-data <dir>]
 */
import {
  medianFinite,
  toSortedFinite,
} from "@gladlog/analysis/src/utils/stats";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { MatchStore, type StoredMatchMeta } from "../src/main/matchStore";
import { RecordingsStore } from "../src/main/recordingsStore";
import { computeVideoWindow } from "../src/shared/videoTime";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Same platform switch as backfillMatches.ts's defaultStoreDir(), minus the
 * "matches" suffix -- this script needs the userData ROOT (parent of both
 * "matches" and "recordings"), not one store alone. */
function defaultUserDataDir(): string {
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "gladlog");
  if (process.platform === "win32")
    return join(process.env.APPDATA ?? homedir(), "gladlog");
  return join(homedir(), ".config", "gladlog");
}

/** Nearest-rank percentile over an already-sorted, already-finite pool --
 * same indexing rule as the eval package's toPercentiles (order-statistics
 * predicate, docs/predicate-index.md). */
function pct(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function reportEmpty(reason: string): void {
  console.log(`无一期录像数据,基线为空(${reason})`);
}

function main(): void {
  const userDataDir = argValue("--user-data") ?? defaultUserDataDir();
  const recordingsDir = join(userDataDir, "recordings");
  const ndjsonPath = join(recordingsDir, "recordings.ndjson");

  if (!existsSync(ndjsonPath)) {
    reportEmpty(`未找到 ${ndjsonPath}`);
    return;
  }

  const entries = new RecordingsStore(recordingsDir).list();
  // Orphan rows (empty matchIds) carry no meta.startTime to join against --
  // skip them rather than treat "no match claimed yet" as headroom 0.
  const claimed = entries.filter((e) => e.matchIds.length > 0);
  if (claimed.length === 0) {
    reportEmpty(`${entries.length} 条录像索引全是孤儿行,零 matchIds`);
    return;
  }

  const metaById = new Map<string, StoredMatchMeta>(
    new MatchStore(join(userDataDir, "matches")).init().map((m) => [m.id, m]),
  );

  const headroomS: number[] = [];
  let unresolved = 0;
  for (const e of claimed) {
    for (const matchId of e.matchIds) {
      const meta = metaById.get(matchId);
      if (!meta) {
        unresolved++;
        continue;
      }
      headroomS.push(
        computeVideoWindow({
          matchStartMs: meta.startTime,
          matchEndMs: meta.endTime,
          recordingStartedAtMs: e.startedAt,
          durationS: 0,
        }).headroomS,
      );
    }
  }

  if (headroomS.length === 0) {
    reportEmpty(
      `${claimed.length} 条录像携带 matchIds,但没有一个能在对局库里解析到 meta` +
        `(${unresolved} 个 matchId 未命中)`,
    );
    return;
  }

  const sorted = toSortedFinite(headroomS);
  const negative = sorted.filter((s) => s < 0).length;

  console.log(
    `headroomS 基线 —— ${sorted.length} 条样本` +
      `(公式 matchStart − recordingStartedAt,单源 shared/videoTime.ts → computeVideoWindow)`,
  );
  if (unresolved > 0) {
    console.log(`  跳过 ${unresolved} 个未命中对局库的 matchId`);
  }
  console.log(`  median  ${medianFinite(sorted).toFixed(2)}s`);
  console.log(`  p10     ${pct(sorted, 0.1)!.toFixed(2)}s`);
  console.log(`  p25     ${pct(sorted, 0.25)!.toFixed(2)}s`);
  console.log(`  p75     ${pct(sorted, 0.75)!.toFixed(2)}s`);
  console.log(`  p90     ${pct(sorted, 0.9)!.toFixed(2)}s`);
  console.log(`  min     ${sorted[0]!.toFixed(2)}s`);
  console.log(`  max     ${sorted[sorted.length - 1]!.toFixed(2)}s`);
  console.log(
    `  负值(录像晚于对局开场,即"缺头")${negative}/${sorted.length}` +
      `(${((negative / sorted.length) * 100).toFixed(1)}%) —— 一期基线应恒为负;` +
      `二期真机验收看这个数是否翻正(设计文档 §9.1/§5.5)`,
  );
}

main();
