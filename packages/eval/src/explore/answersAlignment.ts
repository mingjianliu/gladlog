/**
 * Human-labels ↔ machine-predicate alignment for the review workbench
 * (GH #18): joins a `ReviewSession`'s cards with the human reviewer's blind
 * `ReviewAnswers`, recovers the product-pipeline candidate type behind each
 * baseline card (via `parseCandidateEvidenceLine`, the exported inverse of
 * `candidateEvidence`'s line format), and aggregates the five human label
 * dimensions per source and per candidate type.
 *
 * This module is `answers.json`'s SECOND consumer — the first is the desktop
 * dev harness's unblinding table, which displays but never aggregates. The
 * grounding audit (`docs/coaching-grounding-audit.md` §B) recorded that the
 * stated design purpose "calibrate machine predicates against human judgment"
 * had never been executed; this is that execution path.
 *
 * Deliberately NOT imported here: the desktop `MISTAKE_RULES` severity table
 * (eval never imports `@gladlog/desktop`). This module reports the human side
 * per candidate type; comparing those numbers against the severity/
 * discrimination tables is the report reader's step, so the tool stays valid
 * when those tables move.
 */
import { parseCandidateEvidenceLine } from "./baselineFindings";
import type { ReviewAnswer, ReviewAnswers, ReviewSession } from "./reviewTypes";

/** One card joined with its human answer. `types` is empty for deep cards
 * (their evidence is raw query output, not candidate lines) and for baseline
 * cards whose evidence didn't parse. */
export interface AlignedRow {
  session: string;
  cardId: string;
  source: "deep" | "baseline";
  anchorT: number;
  types: string[];
  answer: ReviewAnswer;
}

/** Join one session's cards with its answers by `cardId`. Cards without an
 * answer are returned in `unanswered` (a partially-labelled session is data,
 * not an error); answers without a matching card are dropped silently — they
 * can only come from a stale answers file. */
export function joinAnswers(
  session: ReviewSession,
  answers: ReviewAnswers,
): { rows: AlignedRow[]; unanswered: string[] } {
  const byId = new Map(answers.answers.map((a) => [a.cardId, a]));
  const rows: AlignedRow[] = [];
  const unanswered: string[] = [];
  for (const card of session.cards) {
    const answer = byId.get(card.cardId);
    if (!answer) {
      unanswered.push(card.cardId);
      continue;
    }
    const evidenceTypes =
      card.source === "baseline"
        ? [
            ...new Set(
              card.evidence
                .map((e) => parseCandidateEvidenceLine(e.line)?.type)
                .filter((t): t is string => t !== undefined),
            ),
          ]
        : [];
    // Evidence-less baseline cards (bench candidates missed the app's id)
    // fall back to the finding's own eventIds types (2026-08-30, GH #18).
    const types =
      evidenceTypes.length > 0 ? evidenceTypes : (card.eventTypes ?? []);
    rows.push({
      session: session.name,
      cardId: card.cardId,
      source: card.source,
      anchorT: card.anchorT,
      types,
      answer,
    });
  }
  return { rows, unanswered };
}

/** Per-dimension label counts for one group of rows. Keys are the raw label
 * values (`"true"`, `"maybe"`, …); absent = zero. */
interface LabelCounts {
  n: number;
  truth: Record<string, number>;
  awareness: Record<string, number>;
  actionable: Record<string, number>;
  adopt: Record<string, number>;
  impact: Record<string, number>;
}

function emptyCounts(): LabelCounts {
  return {
    n: 0,
    truth: {},
    awareness: {},
    actionable: {},
    adopt: {},
    impact: {},
  };
}

function addRow(c: LabelCounts, a: ReviewAnswer): void {
  c.n += 1;
  c.truth[a.truth] = (c.truth[a.truth] ?? 0) + 1;
  c.awareness[a.awareness] = (c.awareness[a.awareness] ?? 0) + 1;
  c.actionable[a.actionable] = (c.actionable[a.actionable] ?? 0) + 1;
  c.adopt[a.adopt] = (c.adopt[a.adopt] ?? 0) + 1;
  c.impact[a.impact] = (c.impact[a.impact] ?? 0) + 1;
}

/** Aggregated alignment over any number of sessions' rows. `byType` counts a
 * multi-type card once under EACH of its types (types are not disjoint — the
 * report renderer says so), so `byType` ns can sum above `bySource.baseline.n`. */
interface AlignmentSummary {
  sessions: string[];
  bySource: Record<"deep" | "baseline", LabelCounts>;
  byType: Record<string, LabelCounts>;
}

export function summarizeAlignment(rows: AlignedRow[]): AlignmentSummary {
  const summary: AlignmentSummary = {
    sessions: [...new Set(rows.map((r) => r.session))],
    bySource: { deep: emptyCounts(), baseline: emptyCounts() },
    byType: {},
  };
  for (const row of rows) {
    addRow(summary.bySource[row.source], row.answer);
    for (const type of row.types) {
      summary.byType[type] ??= emptyCounts();
      addRow(summary.byType[type], row.answer);
    }
  }
  return summary;
}

const DIMENSIONS = [
  "truth",
  "awareness",
  "actionable",
  "adopt",
  "impact",
] as const;

function fmtCounts(c: LabelCounts): string[] {
  return DIMENSIONS.map((dim) => {
    const entries = Object.entries(c[dim])
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    return `  ${dim}: ${entries || "-"}`;
  });
}

/** Renders the summary as markdown-ish lines for the CLI / an `--out` file.
 * Always leads with the honest n — with today's corpus (15 answers, 1 match)
 * these are plumbing-proof numbers, not statistics. */
export function renderAlignmentReport(summary: AlignmentSummary): string[] {
  const lines: string[] = [];
  const total = summary.bySource.deep.n + summary.bySource.baseline.n;
  lines.push(`# answers ↔ machine-predicate alignment`);
  lines.push(
    `sessions: ${summary.sessions.length} (${summary.sessions.join(", ") || "-"}) · answered cards: ${total}`,
  );
  for (const source of ["baseline", "deep"] as const) {
    const c = summary.bySource[source];
    lines.push(``);
    lines.push(`## source: ${source} (n=${c.n})`);
    lines.push(...fmtCounts(c));
  }
  const types = Object.keys(summary.byType).sort();
  if (types.length > 0) {
    lines.push(``);
    lines.push(
      `## by candidate type (baseline cards only; a multi-type card counts under each of its types)`,
    );
    for (const type of types) {
      const c = summary.byType[type];
      lines.push(``);
      lines.push(`### ${type} (n=${c.n})`);
      lines.push(...fmtCounts(c));
    }
  }
  return lines;
}
