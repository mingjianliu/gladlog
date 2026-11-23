import type { MessageParams } from "../index";

// English dictionary for the `stats.*` namespace. Must mirror zh/stats.ts
// key-for-key (enforced by `satisfies Messages` in en/index.ts).
const plural = (n: unknown, one: string, many: string): string =>
  `${n} ${Number(n) === 1 ? one : many}`;

export const enStats = {
  "stats.title": "Record",
  "stats.allCharacters": "All characters",
  "stats.period.today": "Today",
  "stats.period.week": "7 days",
  "stats.period.all": "All",
  "stats.kpi.games": "Matches",
  "stats.kpi.winRate": "Win rate",
  "stats.kpi.byRound": " (by round)",
  "stats.kpi.smallSample": " · sample <{n}",
  "stats.kpi.currentRating": "Current rating",
  "stats.kpi.currentRatingBracket": "Current rating ({bracket})",
  "stats.kpi.sparkTitle": "Open the full rating curve",
  "stats.kpi.sparkAria": "Expand the rating curve",
  "stats.kpi.medianDuration": "Median duration",
  "stats.practice.title":
    "What to practise this week — mistakes notebook + long-term patterns",
  "stats.learning.consolidating": "Consolidating…",
  "stats.learning.consolidate": "Consolidate again",
  "stats.learning.backfill": "Backfilling past analyses… {scanned}/{total}",
  "stats.learning.ledger": (p: MessageParams) =>
    `Ledger: ${plural(p.n, "match", "matches")}`,
  "stats.learning.lastConsolidated": " · last consolidated {when}",
  "stats.learning.notConsolidated": " · not consolidated yet",
  "stats.learning.badLines": (p: MessageParams) =>
    ` · ${plural(p.n, "bad line", "bad lines")} skipped`,
  "stats.learning.distillFailed":
    " · AI distillation failed (only the text is missing): {error}",
  "stats.learning.consolidateFailed": " · Consolidation failed: {error}",
  "stats.rule.improvedTitle":
    "Clearly down recently — evidence of progress, keep it up",
  "stats.rule.activeTitle": "Still happening",
  "stats.rule.improved": "Fixed",
  "stats.rule.active": "Active",
  "stats.rule.vsSpec": " (vs spec {spec})",
  "stats.rule.onMap": " (map {zone})",
  "stats.rule.trendTitle": "Hits per {n} matches, old → new",
  "stats.rule.noDescription":
    "(description arrives with the next consolidation)",
  "stats.rule.viewExample": "View example",
  "stats.rule.empty":
    "No stable patterns yet — once more matches are analyzed (the same problem {hits}+ times within {window} matches) they show up here automatically.",
  "stats.result.win": "Win",
  "stats.result.loss": "Loss",
  "stats.notebook.markFixed": "Mark as fixed",
  "stats.notebook.markRecurring": "Mark as still doing it",
  "stats.notebook.openMatch": "Open match →",
  "stats.row.games": (p: MessageParams) =>
    ` · ${plural(p.n, "match", "matches")}`,
  "stats.comps.title": "Vs enemy comps",
  "stats.comps.noIndex": "No comp data — older matches have no comp index yet.",
  "stats.comps.empty": "No comp data.",
  "stats.comps.clickHint": "Click a row to filter the match list by this comp",
  "stats.comps.legacy": (p: MessageParams) =>
    ` · ${plural(p.n, "older match has", "older matches have")} no comp data `,
  "stats.rebuild.button": "Rebuild index to backfill",
  "stats.rebuild.running": "Rebuilding…",
  "stats.rebuild.runningLong":
    "Rebuilding… (re-parses every match in the library, may take a few minutes)",
  "stats.rebuild.done": (p: MessageParams) =>
    `Rebuilt: ${plural(p.updated, "match", "matches")} updated${p.failedPart}`,
  "stats.rebuild.doneFailed": ", {failed} failed",
  "stats.rebuild.failed":
    "Rebuild failed — you can retry it from the developer view",
  "stats.zones.title": "By map",
  "stats.zones.empty": "No map data.",
  "stats.zones.clickHint": "Click a row to filter the match list by this map",
  "stats.recent.title": "Recent matches",
  "stats.recent.open": "Open report",
  "stats.curve.title": "Rating curve",
  "stats.curve.headingCharacter": "Rating curve ({name})",
  "stats.curve.headingAll":
    "Rating curve (your rating; older matches fall back to the team average)",
  "stats.curve.notEnough":
    "Not enough rating data (needs at least 2 rated matches).",
  "stats.close": "Close",
};
