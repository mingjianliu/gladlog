import type { StoredMatchMeta } from "../../../main/matchStore";

export type DashPeriod = "today" | "week" | "all";

/**
 * Small-N floors for win-rate display (UI review 2026-08-21 #8). Below the
 * floor a percentage reads as authoritative when it is two or three games;
 * the UI leads with the raw counts instead and demotes the percentage.
 *
 * Two floors because the denominators have different units (agy review):
 * comp/zone rows count **matches** for 3v3 but **rounds** for shuffle
 * (`bumpComp`), and 20 matches against one exact enemy comp is rare in a
 * personal library — one floor of 20 would grey out nearly every row. The
 * 胜率 tile's `rateGames` is already round-granular for shuffle, where each
 * round carries roughly one match of rating weight, so it keeps 20.
 * Priors for the user to tune; both registered in docs/predicate-index.md.
 */
export const RATE_MIN_N_ROW = 5;
export const RATE_MIN_N_TOTAL = 20;

/** One formatter for every win-rate surface on the dashboard (tile, comp
 * rows, zone rows): above the floor the percentage is primary and the counts
 * secondary; below it the counts lead and the percentage is demoted. */
export function rateDisplay(
  wins: number,
  games: number,
  minN: number,
): { primary: string; secondary: string | null; belowFloor: boolean } {
  if (games <= 0) return { primary: "—", secondary: null, belowFloor: true };
  const pct = `${Math.round((100 * wins) / games)}%`;
  const counts = `${wins}-${games - wins}`;
  return games >= minN
    ? { primary: pct, secondary: counts, belowFloor: false }
    : { primary: counts, secondary: pct, belowFloor: true };
}

export interface RatingPoint {
  t: number; // startTime ms
  rating: number;
}
export interface RatingSeries {
  bracket: string;
  points: RatingPoint[];
}
export interface CompRow {
  /** Enemy comp signature: specIds ascending; rich rows only (those with
   * `teams`). */
  specIds: number[];
  games: number;
  wins: number;
}
export interface ZoneRow {
  zoneId: string;
  games: number;
  wins: number;
}

export interface Dashboard {
  games: number;
  wins: number;
  /** Win-rate denominator (1e): shuffle counts per round (roundStats),
   * regular matches count per match; old shuffle rows (no roundStats) fall
   * back to per-match. The match-count KPI still uses `games` (per match). */
  rateGames: number;
  rateWins: number;
  /** Median duration (seconds); old rows without durationS are excluded. */
  medianDurationS: number | null;
  ratingSeries: RatingSeries[];
  comps: CompRow[];
  zones: ZoneRow[];
  /** Number of old rows lacking a `teams` field (surfaced as the comp table's
   * coverage gap). */
  legacyRows: number;
  /** Recent matches (second round, P0, fourth card in the right column):
   * filtered by character but **not by period** -- "recent" means recent, and
   * switching to "today"/"7 days" with no games played should not make the
   * card disappear (filling the empty state is the whole point of P0).
   * Descending by time, first 8. */
  recent: StoredMatchMeta[];
}

const isWin = (m: StoredMatchMeta): boolean => m.result.toLowerCase() === "win";

export function periodStart(period: DashPeriod, now: number): number {
  if (period === "all") return 0;
  if (period === "week") return now - 7 * 24 * 3600_000;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Record-dashboard aggregation (pure function; data source = the full meta
 * index, zero extra IO). A shuffle row's `result` is the whole-lobby result
 * and is counted with the same weight as a regular match.
 */
export function deriveDashboard(
  metas: StoredMatchMeta[],
  period: DashPeriod,
  now = Date.now(),
  /** Character-name filter (undefined = all characters). */
  character?: string,
  /** Bracket filter (undefined = every bracket) — the character page shows
   * one bracket at a time. */
  bracket?: string,
): Dashboard {
  const from = periodStart(period, now);
  const byChar = metas.filter(
    (m) =>
      (!character || m.playerName === character) &&
      (!bracket || m.bracket === bracket),
  );
  const rows = byChar
    .filter((m) => m.startTime >= from)
    .sort((a, b) => a.startTime - b.startTime);

  const wins = rows.filter(isWin).length;

  // Win rate per round (1e): a shuffle lobby's 6 rounds count individually,
  // a regular match counts as 1
  let rateGames = 0;
  let rateWins = 0;
  for (const m of rows) {
    if (m.kind === "shuffle" && m.roundStats && m.roundStats.length > 0) {
      rateGames += m.roundStats.length;
      rateWins += m.roundStats.filter((r) => r.win).length;
    } else {
      rateGames++;
      if (isWin(m)) rateWins++;
    }
  }

  const durations = rows
    .map((m) => m.durationS)
    .filter((d): d is number => typeof d === "number")
    .sort((a, b) => a - b);
  const medianDurationS = durations.length
    ? durations[Math.floor(durations.length / 2)]!
    : null;

  const byBracket = new Map<string, RatingPoint[]>();
  for (const m of rows) {
    // The curve prefers the recorder's own rating (the team average jumps
    // around across multiple characters / premade groups); old rows fall back
    // to the team average
    const rating =
      typeof m.playerRating === "number" && m.playerRating > 0
        ? m.playerRating
        : m.avgRating;
    if (typeof rating !== "number" || rating <= 0) continue;
    const list = byBracket.get(m.bracket) ?? [];
    list.push({ t: m.startTime, rating });
    byBracket.set(m.bracket, list);
  }
  const ratingSeries = [...byBracket.entries()]
    .map(([bracket, points]) => ({ bracket, points }))
    .filter((s) => s.points.length >= 2)
    .sort((a, b) => b.points.length - a.points.length);

  const compMap = new Map<string, CompRow>();
  let legacyRows = 0;
  const bumpComp = (specIds: number[], win: boolean) => {
    const key = specIds.join("+");
    const row = compMap.get(key) ?? { specIds, games: 0, wins: 0 };
    row.games++;
    if (win) row.wins++;
    compMap.set(key, row);
  };
  for (const m of rows) {
    // Matchup dimension (1e): shuffle reshuffles sides every round, so the
    // enemy group is counted per round (and so is the win) -- meta.teams only
    // holds the R1 roster, and whole-lobby granularity is semantically wrong
    // for shuffle.
    if (m.kind === "shuffle" && m.roundStats && m.roundStats.length > 0) {
      let counted = false;
      for (const r of m.roundStats) {
        if (r.enemySpecIds.length === 0) continue; // degraded row (missing teamId)
        bumpComp(
          [...r.enemySpecIds].sort((a, b) => a - b),
          r.win,
        );
        counted = true;
      }
      if (!counted) legacyRows++;
      continue;
    }
    const foe = m.teams?.[1];
    if (!foe || foe.length === 0) {
      legacyRows++;
      continue;
    }
    bumpComp(
      foe.map((p) => p.specId).sort((a, b) => a - b),
      isWin(m),
    );
  }
  const comps = [...compMap.values()].sort(
    (a, b) => b.games - a.games || b.wins - a.wins,
  );

  const zoneMap = new Map<string, ZoneRow>();
  for (const m of rows) {
    const row = zoneMap.get(m.zoneId) ?? {
      zoneId: m.zoneId,
      games: 0,
      wins: 0,
    };
    // Shuffle per round, like the comp rows and the win-rate tile: the
    // lobby-level result says "Lose" on a 3-3 lobby.
    const r = rateOf(m);
    row.games += r.n;
    row.wins += r.w;
    zoneMap.set(m.zoneId, row);
  }
  const zones = [...zoneMap.values()].sort((a, b) => b.games - a.games);

  return {
    games: rows.length,
    wins,
    rateGames,
    rateWins,
    medianDurationS,
    ratingSeries,
    comps,
    zones,
    legacyRows,
    recent: [...byChar].sort((a, b) => b.startTime - a.startTime).slice(0, 8),
  };
}

/**
 * Rating delta: the difference between two adjacent matches sharing the same
 * bracket + character + rating source (personal CR and team-average MMR are
 * never compared against each other); the first match, or one with no rating,
 * yields null and shows no arrow. The app's match list and the record page's
 * "recent matches" card share this one implementation (single-source, so the
 * two can't drift apart computing it separately).
 */
export function deriveRatingDeltas(
  metas: StoredMatchMeta[],
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  const last = new Map<string, number>();
  for (const m of [...metas].sort((a, b) => a.startTime - b.startTime)) {
    const personal = typeof m.playerRating === "number" && m.playerRating > 0;
    const r = personal ? m.playerRating! : (m.avgRating ?? null);
    if (r == null) {
      map.set(m.id, null);
      continue;
    }
    const key = `${m.bracket}|${m.playerName ?? ""}|${personal ? "cr" : "mmr"}`;
    const prev = last.get(key);
    map.set(m.id, prev != null ? r - prev : null);
    last.set(key, r);
  }
  return map;
}

/** Character list (descending by match count); old rows without playerName
 * fall under undefined and never appear in the list. */
export function listCharacters(
  metas: StoredMatchMeta[],
): Array<{ name: string; games: number }> {
  const byName = new Map<string, number>();
  for (const m of metas) {
    if (!m.playerName) continue;
    byName.set(m.playerName, (byName.get(m.playerName) ?? 0) + 1);
  }
  return [...byName.entries()]
    .map(([name, games]) => ({ name, games }))
    .sort((a, b) => b.games - a.games);
}

const ratingOf = (m: StoredMatchMeta): number | null =>
  typeof m.playerRating === "number" && m.playerRating > 0
    ? m.playerRating
    : typeof m.avgRating === "number" && m.avgRating > 0
      ? m.avgRating
      : null;

export interface CurrentRating {
  bracket: string;
  rating: number;
  /** Difference against the nearest match (same bracket) before the start of
   * the period; no baseline -> null. */
  delta: number | null;
}

/** "Current rating and change" strip on the overview (1h): anchored on the
 * bracket of the most recent rated match. */
export function deriveCurrentRating(
  metas: StoredMatchMeta[],
  from: number,
  character?: string,
): CurrentRating | null {
  const rated = metas
    .filter((m) => !character || m.playerName === character)
    .filter((m) => ratingOf(m) != null)
    .sort((a, b) => b.startTime - a.startTime);
  const latest = rated[0];
  if (!latest) return null;
  const rating = ratingOf(latest)!;
  // The delta only means anything when `latest` falls inside the period; the
  // baseline excludes `latest` itself and compares like with like (personal
  // CR vs CR, team-average MMR vs MMR), never mixing the two.
  const personal = (m: StoredMatchMeta): boolean =>
    typeof m.playerRating === "number" && m.playerRating > 0;
  const baseline =
    latest.startTime >= from
      ? rated.find(
          (m) =>
            m !== latest &&
            m.bracket === latest.bracket &&
            m.startTime < from &&
            personal(m) === personal(latest),
        )
      : undefined;
  return {
    bracket: latest.bracket,
    rating,
    delta: baseline ? rating - ratingOf(baseline)! : null,
  };
}

// ---------------------------------------------------------------------------
// Per-character record (战绩页改版 2026-11): every character is a card, every
// bracket a line on it — rating, change over the period, record. Only the
// recorder's own rating (playerRating) is used: the team-average MMR jumps
// between characters and premades and is not "my rating".
// ---------------------------------------------------------------------------

/** Characters with fewer matches than this in the period are listed as chips
 * under the cards instead of getting a card of their own. */
export const CHAR_CARD_MIN_GAMES = 3;
/** A gap longer than this between two matches starts a new session. */
export const SESSION_GAP_MS = 60 * 60_000;

/** Display name of a bracket ("Rated Solo Shuffle" → "Solo Shuffle"). */
export function bracketLabel(bracket: string): string {
  return /solo shuffle/i.test(bracket) ? "Solo Shuffle" : bracket;
}

const personalRating = (m: StoredMatchMeta): number | null =>
  typeof m.playerRating === "number" && m.playerRating > 0
    ? m.playerRating
    : null;

/** Rounds for a shuffle lobby that has roundStats, the match otherwise — the
 * same unit as Dashboard.rateGames. */
function rateOf(m: StoredMatchMeta): { w: number; n: number; perRound: boolean } {
  if (m.kind === "shuffle" && m.roundStats && m.roundStats.length > 0) {
    return {
      w: m.roundStats.filter((r) => r.win).length,
      n: m.roundStats.length,
      perRound: true,
    };
  }
  return { w: isWin(m) ? 1 : 0, n: 1, perRound: false };
}

/** 1 / 0 / -1: won, even (a 3-3 lobby), lost. A shuffle lobby is judged by
 * its rounds, never by the lobby-level `result`. */
export function matchOutcome(m: StoredMatchMeta): 1 | 0 | -1 {
  const r = rateOf(m);
  if (!r.perRound) return r.w ? 1 : -1;
  const l = r.n - r.w;
  return r.w > l ? 1 : r.w < l ? -1 : 0;
}

export interface BracketLine {
  bracket: string;
  /** Matches (lobbies for shuffle) in the period. */
  games: number;
  rateWins: number;
  rateGames: number;
  /** rateGames counts rounds (shuffle) rather than matches. */
  perRound: boolean;
  /** Latest personal rating in the period; null when no match carried one. */
  rating: number | null;
  /** What `delta` is measured from: the latest rating before the period, else
   * the first one inside it. */
  baseline: number | null;
  /** rating − baseline; null with fewer than two readings. */
  delta: number | null;
  peak: number | null;
  /** Personal ratings in the period, oldest first. */
  points: RatingPoint[];
  lastPlayed: number;
}

export interface CharacterCard {
  name: string;
  games: number;
  lastPlayed: number;
  /** Most played bracket first. */
  lines: BracketLine[];
}

/** Bracket lines of one character in the period. */
export function deriveBracketLines(
  metas: StoredMatchMeta[],
  period: DashPeriod,
  now: number,
  character: string,
): BracketLine[] {
  const from = periodStart(period, now);
  const mine = metas
    .filter((m) => m.playerName === character)
    .sort((a, b) => a.startTime - b.startTime);
  const brackets = new Map<string, StoredMatchMeta[]>();
  for (const m of mine) {
    const list = brackets.get(m.bracket) ?? [];
    list.push(m);
    brackets.set(m.bracket, list);
  }
  const lines: BracketLine[] = [];
  for (const [bracket, all] of brackets) {
    const rows = all.filter((m) => m.startTime >= from);
    if (rows.length === 0) continue;
    let rateWins = 0;
    let rateGames = 0;
    let perRound = false;
    for (const m of rows) {
      const r = rateOf(m);
      rateWins += r.w;
      rateGames += r.n;
      perRound ||= r.perRound;
    }
    const points: RatingPoint[] = [];
    for (const m of rows) {
      const r = personalRating(m);
      if (r != null) points.push({ t: m.startTime, rating: r });
    }
    const before = all.filter(
      (m) => m.startTime < from && personalRating(m) != null,
    );
    const prior = before.length ? personalRating(before[before.length - 1]!) : null;
    const rating = points.length ? points[points.length - 1]!.rating : null;
    const baseline = prior ?? (points.length ? points[0]!.rating : null);
    const hasTwo = prior != null ? points.length >= 1 : points.length >= 2;
    lines.push({
      bracket,
      games: rows.length,
      rateWins,
      rateGames,
      perRound,
      rating,
      baseline,
      delta: hasTwo && rating != null && baseline != null ? rating - baseline : null,
      peak: points.length ? minMaxRating(points)[1] : null,
      points,
      lastPlayed: rows[rows.length - 1]!.startTime,
    });
  }
  return lines.sort((a, b) => b.games - a.games || b.lastPlayed - a.lastPlayed);
}

function minMaxRating(points: RatingPoint[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p.rating < lo) lo = p.rating;
    if (p.rating > hi) hi = p.rating;
  }
  return [lo, hi];
}

/** The overview: one card per character that played in the period, most
 * recently played first; characters under CHAR_CARD_MIN_GAMES go to `minor`.
 * `unnamed` counts legacy rows recorded before playerName existed. */
export function deriveCharacterCards(
  metas: StoredMatchMeta[],
  period: DashPeriod,
  now: number,
  bracket?: string,
): { cards: CharacterCard[]; minor: CharacterCard[]; unnamed: number } {
  const from = periodStart(period, now);
  const names = new Set<string>();
  let unnamed = 0;
  for (const m of metas) {
    if (m.startTime < from) continue;
    if (bracket && m.bracket !== bracket) continue;
    if (m.playerName) names.add(m.playerName);
    else unnamed++;
  }
  const all: CharacterCard[] = [];
  for (const name of names) {
    const lines = deriveBracketLines(metas, period, now, name).filter(
      (l) => !bracket || l.bracket === bracket,
    );
    if (lines.length === 0) continue;
    all.push({
      name,
      games: lines.reduce((a, l) => a + l.games, 0),
      lastPlayed: Math.max(...lines.map((l) => l.lastPlayed)),
      lines,
    });
  }
  all.sort((a, b) => b.lastPlayed - a.lastPlayed);
  return {
    cards: all.filter((c) => c.games >= CHAR_CARD_MIN_GAMES),
    minor: all.filter((c) => c.games < CHAR_CARD_MIN_GAMES),
    unnamed,
  };
}

export interface RatedSession {
  start: number;
  games: number;
  rateWins: number;
  rateGames: number;
  /** Personal rating going into the session's first rated match. */
  from: number | null;
  /** Rating going into the next match after the session (its result is
   * known), else the last reading inside it (`settled` false: the session's
   * last match has not been followed by another yet). */
  to: number | null;
  settled: boolean;
}

/** One character's matches in one bracket, as rated points and sessions.
 * Ratings are recorded at the start of each match, so a match's own change
 * is only known once the next match is in. */
export function deriveCharacterBracket(
  metas: StoredMatchMeta[],
  period: DashPeriod,
  now: number,
  character: string,
  bracket: string,
): {
  matches: Array<{ id: string; t: number; rating: number | null; outcome: 1 | 0 | -1; session: number }>;
  sessions: RatedSession[];
} {
  const from = periodStart(period, now);
  const all = metas
    .filter((m) => m.playerName === character && m.bracket === bracket)
    .sort((a, b) => a.startTime - b.startTime);
  const rows = all.filter((m) => m.startTime >= from);
  const matches: Array<{ id: string; t: number; rating: number | null; outcome: 1 | 0 | -1; session: number }> = [];
  const sessions: RatedSession[] = [];
  let prevEnd = -Infinity;
  for (const m of rows) {
    if (m.startTime - prevEnd > SESSION_GAP_MS || sessions.length === 0) {
      sessions.push({ start: m.startTime, games: 0, rateWins: 0, rateGames: 0, from: null, to: null, settled: false });
    }
    prevEnd = Math.max(m.endTime || m.startTime, m.startTime);
    const s = sessions[sessions.length - 1]!;
    const r = rateOf(m);
    s.games++;
    s.rateWins += r.w;
    s.rateGames += r.n;
    const pr = personalRating(m);
    if (pr != null) {
      if (s.from == null) s.from = pr;
      s.to = pr;
    }
    matches.push({ id: m.id, t: m.startTime, rating: pr, outcome: matchOutcome(m), session: sessions.length - 1 });
  }
  // Close each session on the rating the following match started at.
  for (let i = 0; i < sessions.length; i++) {
    const nextStart = sessions[i + 1]?.start ?? Infinity;
    const after = all.find(
      (m) => m.startTime >= nextStart && personalRating(m) != null,
    );
    if (after) {
      sessions[i]!.to = personalRating(after);
      sessions[i]!.settled = true;
    }
  }
  return { matches, sessions: sessions.reverse() };
}
