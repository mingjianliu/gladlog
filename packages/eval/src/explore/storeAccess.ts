/**
 * Read-only access to THIS MACHINE's local match library
 * (`~/Library/Application Support/gladlog/matches`) for the eval
 * match-exploration tooling — `_index.ndjson` load/filter, single-round
 * legacy conversion, team split, and a plain-text overview.
 *
 * Conventions ported verbatim from `packages/eval/scripts/momentDiveAb.ts`
 * (its own header comment explains the "why" — repeated only where the
 * behavior differs):
 * - `_index.ndjson` grows by append; a re-touched match appears twice with
 *   the same id — last occurrence wins (`loadIndex`'s dedupe-by-id map).
 * - Legacy conversion is eval's own convention (NOT desktop's `toLegacySafe`,
 *   which eval must never import): `toLegacyMatch({ ...roundData, rawLines:
 *   [] })`. Real library matches are complete records, so the missing-array
 *   padding that `toLegacySafe` exists for has no effect here anyway (see
 *   `legacySource.ts`'s own header comment).
 * - Player detection: a unit counts as a player iff it carries `info`
 *   (`CombatantInfo`, populated only for players) — the same test
 *   `findOwner` uses in momentDiveAb.ts.
 *
 * Per CLAUDE.md's shared-predicate rule, this module wraps existing
 * `@gladlog/analysis` exports (`fmtTime`, `renderedWindowSeconds`,
 * `isHealerSpec`) rather than re-deriving any of their logic, and per the
 * plan's global constraint, eval never imports `@gladlog/desktop`.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  fmtTime,
  isHealerSpec,
  renderedWindowSeconds,
} from "@gladlog/analysis";
import type { GladMatch } from "@gladlog/parser";
import {
  CombatUnitReaction,
  type ICombatUnit,
  toLegacyMatch,
} from "@gladlog/parser-compat";

/** Default local match library location — same path every other library
 * script in this repo hardcodes (`momentDiveAb.ts`, `slimLibrary.ts`, …);
 * kept identical rather than reinvented so all these tools point at the same
 * store by default. Honors `$GLADLOG_MATCH_DIR` first, same as
 * `packages/desktop/dev/review/reviewApi.ts`'s `defaultMatchesDir()` — a user
 * with the env var set must get sessions built off the same library the
 * desktop dev harness serves, not silently a different one. `--store`
 * still wins over both in the scripts that accept it (env < `--store`). */
export const DEFAULT_MATCH_DIR =
  process.env.GLADLOG_MATCH_DIR ||
  join(homedir(), "Library/Application Support/gladlog/matches");

/** One row of `_index.ndjson`. Real rows carry more fields (zoneId,
 * storedAt, …); only the ones this module's callers need are typed —
 * `kind`/`durationS` are absent on some older `match` rows in the wild, so
 * both stay optional and callers must not assume presence. */
interface StoredMetaRow {
  id: string;
  kind?: "match" | "shuffle";
  durationS?: number;
  playerName?: string;
  result?: string;
  startTime?: number;
  bracket?: string;
}

/** Reads and dedupes `_index.ndjson` (last occurrence per id wins — see
 * module header). Row order in the returned array is otherwise whatever
 * `Map` iteration gives (insertion order of first-seen id); callers that
 * need a specific order (recency, filtering) go through `pickRows`. */
export function loadIndex(matchesDir: string): StoredMetaRow[] {
  const text = readFileSync(join(matchesDir, "_index.ndjson"), "utf8").trim();
  const byId = new Map<string, StoredMetaRow>();
  if (text) {
    for (const line of text.split("\n")) {
      const row = JSON.parse(line) as StoredMetaRow;
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

/** Duration filter + newest-first sort. A row with no known `durationS`
 * cannot satisfy a minimum-duration filter (there is nothing to compare),
 * so it is dropped rather than guessed at; a row with no known `startTime`
 * sorts as if it were the oldest (`0`), pushing it to the end rather than
 * crashing the comparator. */
export function pickRows(
  rows: StoredMetaRow[],
  opts: { minDurationS: number },
): StoredMetaRow[] {
  return rows
    .filter(
      (r) => r.durationS !== undefined && r.durationS >= opts.minDurationS,
    )
    .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
}

/** `ReturnType<typeof toLegacyMatch>` — the legacy `IArenaMatch` shape every
 * `@gladlog/analysis` predicate consumes. */
export type LegacyRound = ReturnType<typeof toLegacyMatch>;

/** Loads one round from `<matchesDir>/<matchId>/match.json` and converts it
 * to the legacy shape. The on-disk envelope is `{ kind: "match" | "shuffle",
 * data }`: for a `match` doc `data` IS the round; for a `shuffle` doc `data`
 * has a `rounds` array and `roundSeq` (default `0`) indexes straight into it
 * — this mirrors the on-disk array position, not `sequenceNumber` (unlike
 * momentDiveAb.ts's anchor scan, which walks rounds looking for a death and
 * so keys off `sequenceNumber`; this function is a direct single-round
 * lookup by index instead). */
export function loadLegacyRound(
  matchesDir: string,
  matchId: string,
  roundSeq?: number,
): {
  legacy: LegacyRound;
  kind: "match" | "shuffle";
  roundSeq?: number;
  /** The id the app keys this round's analysis cache by: the round's own id
   * for a shuffle round (equals `matchId` only for round 0), `matchId`
   * otherwise. GH #18 bench fix, 2026-08-30. */
  analysisId: string;
} {
  const doc = JSON.parse(
    readFileSync(join(matchesDir, matchId, "match.json"), "utf8"),
  ) as { kind?: string; data?: unknown };
  const kind: "match" | "shuffle" =
    doc.kind === "shuffle" ? "shuffle" : "match";

  let roundData: unknown;
  let resolvedRoundSeq: number | undefined;
  if (kind === "shuffle") {
    const rounds =
      (doc.data as { rounds?: unknown[] } | undefined)?.rounds ?? [];
    const idx = roundSeq ?? 0;
    roundData = rounds[idx];
    resolvedRoundSeq = idx;
  } else {
    roundData = doc.data;
  }
  if (!roundData) {
    throw new Error(
      `loadLegacyRound: no round data for ${matchId}${
        resolvedRoundSeq !== undefined ? ` (roundSeq=${resolvedRoundSeq})` : ""
      } in ${matchesDir}`,
    );
  }

  const legacy = toLegacyMatch({
    ...(roundData as GladMatch),
    rawLines: [],
  } as GladMatch);
  const roundId = (roundData as { id?: unknown }).id;
  const analysisId =
    kind === "shuffle" && typeof roundId === "string" && roundId
      ? roundId
      : matchId;
  return { legacy, kind, roundSeq: resolvedRoundSeq, analysisId };
}

/**
 * Best-effort raw.txt read for `<matchesDir>/<matchId>/raw.txt` — the same
 * per-match directory `loadLegacyRound` resolves `match.json` under. `null`
 * covers every failure mode uniformly (file missing — old archive predates
 * raw.txt retention, or it was never written — permission error, …); every
 * caller must treat `null` exactly like `parseRawStreams(null, ...)`'s
 * `available:false`, never throw (Global Constraint,
 * docs/superpowers/plans/2026-08-15-raw-streams.md). Mirrors desktop's own
 * `packages/desktop/src/main/matchStore.ts`'s `readRawText` (same contract);
 * kept sync here, matching every other read in this module (`loadIndex`,
 * `loadLegacyRound`), unlike the desktop version which is async (Electron
 * main-process convention).
 */
export function readRawText(
  matchesDir: string,
  matchId: string,
): string | null {
  try {
    return readFileSync(join(matchesDir, matchId, "raw.txt"), "utf8");
  } catch {
    return null;
  }
}

/** Splits a round's player units into friendly/hostile teams, plus the
 * logging player's own unit ("owner"). Non-player units (pets, NPCs) are
 * excluded from both teams — same player test as `findOwner` in
 * momentDiveAb.ts: a unit counts as a player iff it carries `info`.
 * `owner` prefers the unit matching `legacy.playerId`, and degrades to the
 * first friendly healer when that lookup misses (same fallback order as
 * `findOwner`). */
export function splitTeams(legacy: LegacyRound): {
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  owner: ICombatUnit | undefined;
} {
  const players = Object.values(
    legacy.units as Record<string, ICombatUnit>,
  ).filter((u) => !!u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction === CombatUnitReaction.Hostile,
  );
  const owner =
    friends.find((u) => u.id === legacy.playerId) ??
    friends.find((u) => isHealerSpec(u.spec));
  return { friends, enemies, owner };
}

/** Plain-text overview: one line per player unit (`名字 阵营 [死亡: m:ss, …]`,
 * deaths read defensively off `unit.deathRecords ?? []`) followed by one
 * `时长 m:ss` line. Timestamps are shared-predicate: rendered through the
 * same `fmtTime`/`renderedWindowSeconds` the prompt/gate side uses, off the
 * same underlying instants (`deathRecord.timestamp - legacy.startTime`,
 * `legacy.endTime - legacy.startTime`), not a locally re-derived format.
 * `meta`, when given, prefixes an optional identifying header line (id /
 * bracket / result) — purely cosmetic, never consulted by any gate. */
export function overviewLines(
  legacy: LegacyRound,
  meta?: StoredMetaRow,
): string[] {
  const { friends, enemies } = splitTeams(legacy);
  const lines: string[] = [];

  if (meta) {
    const header = [meta.id, meta.bracket, meta.result]
      .filter((v): v is string => !!v)
      .join(" ");
    if (header) lines.push(header);
  }

  const unitLine = (u: ICombatUnit, side: string): string => {
    const deaths = (u.deathRecords ?? []) as Array<{ timestamp?: number }>;
    const times = deaths
      .map((d) => d.timestamp)
      .filter((t): t is number => typeof t === "number")
      .map((t) => fmtTime((t - legacy.startTime) / 1000));
    const deathPart = times.length ? ` [死亡: ${times.join(", ")}]` : "";
    return `${u.name} ${side}${deathPart}`;
  };
  for (const u of friends) lines.push(unitLine(u, "友方"));
  for (const u of enemies) lines.push(unitLine(u, "敌方"));

  const durS = renderedWindowSeconds(
    0,
    (legacy.endTime - legacy.startTime) / 1000,
  );
  lines.push(`时长 ${fmtTime(durS)}`);
  return lines;
}
