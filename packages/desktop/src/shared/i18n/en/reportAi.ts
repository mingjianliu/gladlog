import type { MessageParams } from "../index";

const plural = (n: string | number, one: string, many: string): string =>
  Number(n) === 1 ? one : many;

// English dictionary for the match report's components (`report.<card>.*`).
// Terms follow src/shared/i18n/glossary.ts.
export const enReportAi = {
  // ── FindingsList.tsx / KeyMomentAxis.tsx (glossary report.followup.*) ──
  "report.finding.habitTitle":
    "A stable pattern across matches (deterministic stats, not an AI judgement)",
  "report.finding.deepTag": "Deep dive",
  "report.finding.collapse": "Collapse ▴",
  "report.finding.expand": "Show full text ▾",
  "report.finding.jumpTo": "Jump to {t} in the replay",
  "report.finding.replayHere": "▶ Replay this moment",
  "report.finding.inspectTitle":
    "Show this moment's raw events in the events view",
  "report.finding.inspect": "⛏ Raw events",
  "report.finding.markDone": "Mark as fixed",
  "report.finding.done": "✓ Fixed",
  "report.finding.markRecurring": "Mark as still doing it",
  "report.finding.recurring": "↻ Still doing it",

  // ── KeyMomentAxis.tsx ──
  "report.axis.kind.death": "Death",
  "report.axis.kind.burst-band": "Burst",
  "report.axis.kind.defensive": "Defensive",
  "report.axis.kind.dispel": "Dispel",
  "report.axis.kind.cc": "CC",
  "report.axis.kind.heal-gap": "Healing gap",
  "report.axis.kind.position": "Positioning",
  "report.axis.gap": "⏱ {s}s without key events — folded",
  "report.axis.collapseMinor": "− Collapse minor moments",
  "report.axis.moreMinor": (p: MessageParams) =>
    `+${p.n} minor ${plural(p.n, "moment", "moments")}`,

  // ── CoachChatCard.tsx ──
  "report.chat.needsCli": "Chatting with the coach needs a local CLI backend",
  "report.chat.notReady": "Run an AI analysis first to chat",
  "report.chat.thinking": "Coach is thinking…",
  "report.chat.sendFailed": "Send failed · ",
  "report.chat.placeholder": "Ask the coach…",
  "report.chat.inputAria": "Ask the coach a question",
  "report.chat.stop": "Stop",
  "report.chat.send": "Send",
  "report.chat.disclaimer":
    "Answers are reasoned from the log and may be wrong",

  // ── WindowAnalysisCard.tsx ──
  "report.windowAi.title": "Span analysis {from}–{to}",
  "report.windowAi.cachedTitle": "This window's analysis came from the cache",
  "report.windowAi.cached": "(cached)",
  "report.windowAi.loading": "Analyzing… (about 10–30s)",
  "report.windowAi.none":
    "Nothing to coach in this span (no CC taken, defensive casts, enemy bursts, sharp HP drops, etc.).",
  "report.windowAi.auditEmpty": "The model's output did not pass the audit.",
  "report.windowAi.error": "Analysis failed (network or service error).",
  "report.windowAi.noClient":
    "AI is not set up (add an API key in Settings to use it).",
  "report.windowAi.busy":
    "This window's analysis is still running — press Retry in a moment to see the result.",

  // ── ProComparisonVerified.tsx (en values are the panel's previous inline English) ──
  "report.pro.noInput":
    "Cannot derive comparison metrics from this match (no owner found or metrics failed).",
  "report.pro.running": "Comparing…",
  "report.pro.again": "Compare again",
  "report.pro.run": "vs top players",
  "report.pro.heading": "vs your cohort",
  "report.pro.sameComp": "vs same comp ({comp}) · ",
  "report.pro.sampleN": "N={n}",
  "report.pro.durationMedian": " · median duration ",
  "report.pro.firstKill": " · {pct}% kill {spec} first",
  "report.pro.measuredOnly": "Showing measured numbers only",
  "report.pro.reason": "Reason: ",
  "report.pro.notEnough": "Not enough cohort data for this build and comp yet.",
  "report.pro.comparing": "Comparing against your cohort…",
  "report.pro.elapsed": "{t} elapsed",
  "report.pro.autoRan":
    "auto-run: this match had an analysis but no comparison",
  "report.pro.empty":
    "No cohort comparison for this match yet — run the AI analysis above, or compare on its own below.",
  "report.pro.healingGaps": "Healing gaps this match: {s}s over {n} gap(s)",

  // ── StructuredAnalysisPanel.tsx ──
  "report.ai.reanalyze": "Re-analyze",
  "report.ai.preparing": "Preparing analysis data…",
  "report.ai.pickModel": "Analyze with another model",
  "report.ai.default": " (default)",
  "report.ai.demoTitle":
    "See what an analysis looks like, using demo data (unrelated to this match)",
  "report.ai.demoBtn": "See a demo analysis",
  "report.ai.staleSlot": "Old-version slot · no usable result",
  "report.ai.cached": (p: MessageParams) =>
    `Cached · ${p.n} ${plural(p.n, "finding", "findings")}`,
  "report.ai.maxSeverity": " · highest severity {sev}",
  "report.ai.goals":
    "Goals for this match — issues you marked “still doing it”:",
  "report.ai.goalLast": " (last time: {title})",
  "report.ai.demoBanner":
    "Demo data · unrelated to this match · set up an API key or a local CLI in Settings → AI analysis to analyze this match",
  "report.ai.staleTag": "Old",
  "report.ai.staleNote":
    "This slot holds an old-version analysis (the prompt was upgraded, or the AI self-review setting changed); re-analyze to see it",
  "report.ai.wholeRound": "Whole-match observations",
  "report.ai.runningWith": "Analyzing with {model}",
  "report.ai.retrying":
    "The first reply could not be parsed, so it was retried once automatically (the total time doubles)",
  "report.ai.reviewing":
    "First results are in; running the AI self-review (one more AI call)",

  // ── StructuredAnalysisPanel.tsx (running status) ──
  "report.ai.running": "Analyzing",
};
