import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import { listAiDebug, type AiDebugEntry } from "./aiDebugLog";

/**
 * In-app bug reporting (user request, 2026-08-02): bundles three things — the
 * match's raw log (raw.txt), the prompt and raw response of AI calls (the
 * aiDebugLog ring buffer, the 10 most recent calls held in memory), and the
 * user's comment. It prefers to land in ~/gladlog-sync/bugreports: that is the
 * Drive sync folder (the same channel as the cross-machine log relay), so
 * writing there uploads automatically; without a sync folder it falls back to
 * userData/bugreports as a local record. settings is deliberately excluded (API
 * key risk; the cost of redacting outweighs the value); PII (player names) is
 * stored as-is, consistent with docs/DATA-COMPLIANCE.md.
 */

export interface BugReportInput {
  matchId: string | null;
  /** Shuffle round number (1-based); null for a regular match. */
  roundSeq: number | null;
  comment: string;
}

interface BugReportResult {
  dir: string;
  /** true = written into the Drive sync folder and will upload automatically. */
  synced: boolean;
}

export function resolveBugReportRoot(deps: {
  homeDir: string;
  userDataDir: string;
}): { root: string; synced: boolean } {
  const syncRoot = join(deps.homeDir, "gladlog-sync");
  if (existsSync(syncRoot)) {
    return { root: join(syncRoot, "bugreports"), synced: true };
  }
  return { root: join(deps.userDataDir, "bugreports"), synced: false };
}

export function createBugReport(deps: {
  input: BugReportInput;
  /** The userData/matches root (where raw.txt and meta live). */
  matchesDir: string;
  getMeta: (id: string) => unknown | null;
  appVersion: string;
  platform: string;
  homeDir: string;
  userDataDir: string;
  aiEntries?: AiDebugEntry[];
  now?: () => number;
}): BugReportResult {
  const now = deps.now ? deps.now() : Date.now();
  const { root, synced } = resolveBugReportRoot(deps);

  const d = new Date(now);
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("");
  const time = [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join("");
  const idPart = deps.input.matchId
    ? deps.input.matchId.slice(0, 8)
    : "no-match";
  const dir = join(root, `${stamp}-${time}-${idPart}`);
  mkdirSync(dir, { recursive: true });

  // AI evidence: prefer calls belonging to this match; with no matchId, take them
  // all (at most 10, from the in-memory ring)
  const all = deps.aiEntries ?? listAiDebug();
  const aiCalls = deps.input.matchId
    ? all.filter((e) => e.matchId === deps.input.matchId)
    : all;

  const meta = deps.input.matchId ? deps.getMeta(deps.input.matchId) : null;

  writeFileSync(
    join(dir, "report.json"),
    JSON.stringify(
      {
        createdAt: new Date(now).toISOString(),
        appVersion: deps.appVersion,
        platform: deps.platform,
        comment: deps.input.comment,
        matchId: deps.input.matchId,
        roundSeq: deps.input.roundSeq,
        matchMeta: meta,
        aiCalls,
      },
      null,
      2,
    ),
  );

  if (deps.input.matchId) {
    const raw = join(deps.matchesDir, deps.input.matchId, "raw.txt");
    if (existsSync(raw)) {
      try {
        copyFileSync(raw, join(dir, "match-raw.txt"));
      } catch {
        /* if raw cannot be copied (permissions / file in use), do not block the whole report */
      }
    }
  }

  return { dir, synced };
}
