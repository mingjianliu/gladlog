/**
 * Deterministic sieve (spec §2): ledger match view -> stable patterns.
 *
 * The predicate is the spec: the constants and predicates here are the only
 * authority -- retirement (learning.ts), badges (matchRules.ts), and the
 * report page all import this file; do not copy the numbers.
 */
import type {
  GroupStats,
  LedgerFinding,
  LedgerMatch,
  PatternCondition,
  StablePattern,
} from "./types";

export const PATTERN_WINDOW_MATCHES = 20;
export const PATTERN_MIN_HITS = 5;
export const RULE_RETIRE_MAX_HITS = 2;
export const TREND_BUCKET_MATCHES = 5;
/** Conditional slice significance (spec §2): the subset has >=4 hits and a
 * hit rate >= 2x that of the full set. */
const SLICE_MIN_HITS = 4;
const SLICE_RATE_FACTOR = 2;

export function patternId(
  category: string,
  eventTypes: string[],
  cond: PatternCondition | null,
): string {
  let id = `cat:${category}`;
  for (const t of [...eventTypes].sort()) id += `|type:${t}`;
  if (cond?.enemySpec !== undefined) id += `|spec:${cond.enemySpec}`;
  if (cond?.zoneId !== undefined) id += `|zone:${cond.zoneId}`;
  return id;
}

/** A finding hits a group when the category matches and every type of the
 * group is referenced. */
export function findingMatchesGroup(
  f: LedgerFinding,
  category: string,
  eventTypes: string[],
): boolean {
  if (f.category !== category) return false;
  return eventTypes.every((t) => f.eventTypes.includes(t));
}

/** Whether a match satisfies the condition -- the **same** predicate shared by
 * the sieve and by application (badges).
 * When a condition field is unknown on the match side (e.g. the renderer has
 * no zoneId) -> conservatively judged as not satisfied. */
export function matchInCondition(
  m: { zoneId?: string; enemySpecs: number[] },
  cond: PatternCondition | null,
): boolean {
  if (!cond) return true;
  if (cond.enemySpec !== undefined && !m.enemySpecs.includes(cond.enemySpec))
    return false;
  if (cond.zoneId !== undefined && m.zoneId !== cond.zoneId) return false;
  return true;
}

const hitsIn = (m: LedgerMatch, category: string, eventTypes: string[]) =>
  m.findings.some((f) => findingMatchesGroup(f, category, eventTypes));

export function measureGroup(
  all: LedgerMatch[],
  category: string,
  eventTypes: string[],
  condition: PatternCondition | null,
): GroupStats {
  const eligible = all
    .filter((m) => matchInCondition(m, condition))
    .sort((a, b) => b.startTime - a.startTime); // newest -> oldest
  const window = eligible.slice(0, PATTERN_WINDOW_MATCHES);
  const hitFlags = window.map((m) => hitsIn(m, category, eventTypes));
  const hits = hitFlags.filter(Boolean).length;

  const half = Math.floor(window.length / 2);
  const newerHits = hitFlags.slice(0, half).some(Boolean);
  const olderHits = hitFlags.slice(half).some(Boolean);

  // trend buckets run oldest -> newest
  const oldFirst = [...window].reverse();
  const trend: number[] = [];
  for (let i = 0; i < oldFirst.length; i += TREND_BUCKET_MATCHES) {
    trend.push(
      oldFirst
        .slice(i, i + TREND_BUCKET_MATCHES)
        .filter((m) => hitsIn(m, category, eventTypes)).length,
    );
  }

  const allHits = eligible.filter((m) => hitsIn(m, category, eventTypes));
  return {
    windowMatches: window.length,
    hits,
    firstSeen: allHits.length
      ? Math.min(...allHits.map((m) => m.startTime))
      : 0,
    lastSeen: allHits.length ? Math.max(...allHits.map((m) => m.startTime)) : 0,
    trend,
    exampleMatchIds: window
      .filter((_, i) => hitFlags[i])
      .slice(0, 3)
      .map((m) => m.matchId),
    spansBothHalves: newerHits && olderHits,
  };
}

/** Retirement/revival (spec §5): hysteresis -- the gap between thresholds
 * keeps the status quo, preventing flapping at the boundary. */
export function nextRuleStatus(
  prev: "active" | "improved",
  hits: number,
): "active" | "improved" {
  if (hits <= RULE_RETIRE_MAX_HITS) return "improved";
  if (hits >= PATTERN_MIN_HITS) return "active";
  return prev;
}

const qualifies = (g: GroupStats) =>
  g.hits >= PATTERN_MIN_HITS && g.spansBothHalves;

export function scanPatterns(all: LedgerMatch[]): StablePattern[] {
  if (all.length === 0) return [];
  const window = [...all]
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, PATTERN_WINDOW_MATCHES);

  // Candidate grouping space: the categories and category+type combinations
  // seen inside the window
  const cats = new Set<string>();
  const typesByCat = new Map<string, Set<string>>();
  for (const m of window)
    for (const f of m.findings) {
      cats.add(f.category);
      const s = typesByCat.get(f.category) ?? new Set<string>();
      for (const t of f.eventTypes) s.add(t);
      typesByCat.set(f.category, s);
    }

  const out: StablePattern[] = [];
  const emit = (
    category: string,
    eventTypes: string[],
    condition: PatternCondition | null,
    g: GroupStats,
  ) =>
    out.push({
      patternId: patternId(category, eventTypes, condition),
      category,
      eventTypes,
      condition,
      windowMatches: g.windowMatches,
      hits: g.hits,
      firstSeen: g.firstSeen,
      lastSeen: g.lastSeen,
      trend: g.trend,
      exampleMatchIds: g.exampleMatchIds,
    });

  // Conditional slice space: the enemy specs / zoneIds seen inside the window
  const specs = new Set<number>();
  const zones = new Set<string>();
  for (const m of window) {
    for (const s of m.enemySpecs) specs.add(s);
    if (m.zoneId) zones.add(m.zoneId);
  }
  const emitSlices = (
    category: string,
    eventTypes: string[],
    base: GroupStats,
  ) => {
    const baseRate = base.windowMatches ? base.hits / base.windowMatches : 0;
    const conds: PatternCondition[] = [
      ...[...specs].map((s) => ({ enemySpec: s })),
      ...[...zones].map((z) => ({ zoneId: z })),
    ];
    for (const cond of conds) {
      const g = measureGroup(all, category, eventTypes, cond);
      const rate = g.windowMatches ? g.hits / g.windowMatches : 0;
      if (
        g.hits >= SLICE_MIN_HITS &&
        g.spansBothHalves &&
        rate >= SLICE_RATE_FACTOR * baseRate
      )
        emit(category, eventTypes, cond, g);
    }
  };

  for (const cat of cats) {
    const catStats = measureGroup(all, cat, [], null);
    const typeStats = [...(typesByCat.get(cat) ?? [])].map((t) => ({
      t,
      g: measureGroup(all, cat, [t], null),
    }));
    const qualifyingTypes = typeStats.filter(({ g }) => qualifies(g));
    for (const { t, g } of qualifyingTypes) {
      emit(cat, [t], null, g);
      emitSlices(cat, [t], g);
    }
    // The category-level pattern is only emitted when it carries more
    // information than the best type-level one (more hits), to avoid a
    // duplicate rule pair like "survival" and "survival+death" overlapping
    // 100%.
    const bestType = Math.max(0, ...qualifyingTypes.map(({ g }) => g.hits));
    if (qualifies(catStats) && catStats.hits > bestType) {
      emit(cat, [], null, catStats);
      emitSlices(cat, [], catStats);
    } else if (!qualifyingTypes.length) {
      // When the category level does not qualify but there is no type-level
      // pattern either, still try the conditional slices
      emitSlices(cat, [], catStats);
    }
  }
  return out.sort((a, b) => b.hits - a.hits);
}
