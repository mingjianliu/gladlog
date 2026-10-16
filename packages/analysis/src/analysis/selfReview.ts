/**
 * AI self-review (user 2026-10-15, opt-in setting, default off): after the
 * first round's findings pass auditFindings, one more call on the same
 * backend/model re-reads them against the very prompt that produced them and
 * keeps / corrects / weakens / deletes each statement — never adds one.
 *
 * Evidence: gladlog-eval-private runs/s61-selfcheck-2026-10-15 (51 PV395
 * outputs, same-run blind audit: WRONG 48 → 15, accuracy +4.7 pp
 * [+3.5, +6.1], findings 144 → 144). The instructions below are that run's
 * `method/selfcheck-brief.md`, ported. One deliberate difference: there the
 * checker was an agent reading three files; here the prompt and the findings
 * are inlined into one message and the coach system prompt is the call's
 * system prompt.
 *
 * The reply is checked by applySelfReview, not by auditFindings: the reviewer
 * sees (and rewrites) the interpolated text the player reads, so the first
 * round's "every number is a {{placeholder}}" rule cannot apply verbatim —
 * re-auditing would drop every finding that prints a number, and would apply
 * the intent-guard severity downgrade a second time. Its numeric rule is the
 * same fact stated on rendered text: every number must be a value of a cited
 * event's facts (or already in the finding as shown). User ruling 2026-10-15.
 */
import { BRACKET_TERM } from "./auditFindings";
import { causalLint } from "./causalLint";
import { normalizeFindingCategory } from "./findingCategories";
import { citableEvents } from "./findingsCount";
import { rosterClassViolations } from "./rosterLint";
import { repairSpellNameZh } from "./spellNameZhLint";
import type { CandidateEvent, Finding, RawFinding } from "./types";

/** Bump whenever the text built by buildSelfReviewPrompt changes. Part of the
 * analysis cache identity (desktop analysis.ts), independent of
 * PROMPT_VERSION: changing only this prompt invalidates only reviewed
 * results. */
export const SELF_REVIEW_PROMPT_VERSION = 1;

export const SELF_REVIEW_ACTIONS = [
  "corrected",
  "weakened",
  "deleted",
  "dropped",
] as const;
export type SelfReviewAction = (typeof SELF_REVIEW_ACTIONS)[number];

/** One line of the reviewer's change log, as the model reported it (kept for
 * debugging and a possible "show changes" view; not verified). `finding` is
 * the 1-based index into the reviewed (original) findings. */
export interface SelfReviewChange {
  finding: number;
  action: SelfReviewAction;
  old: string;
  new: string | null;
}

const SEVERITIES: readonly RawFinding["severity"][] = ["high", "med", "low"];
const SEVERITY_RANK: Record<RawFinding["severity"], number> = {
  high: 0,
  med: 1,
  low: 2,
};

/** The fields the reviewer sees and may rewrite — exactly the first-round
 * JSON schema (no deepDive, nothing derived). */
function reviewView(f: Finding): RawFinding {
  return {
    eventIds: f.eventIds,
    severity: f.severity,
    category: f.category,
    title: f.title,
    explanation: f.explanation,
  };
}

export function buildSelfReviewPrompt(
  firstRoundPrompt: string,
  findings: readonly Finding[],
): string {
  const reply = JSON.stringify({ findings: findings.map(reviewView) }, null, 1);
  return `# Self-check of a coaching reply against its own prompt

You are checking a World of Warcraft arena coaching reply before it is shown to the player. Below:

- PROMPT — the full prompt the coach was given (the match facts: timeline, menu of events with \`facts={…}\`, legends, rules). **This is the only source of truth.** You have no other data about the match.
- Your system instructions are the coach's system instructions (language and naming rules — keep obeying them).
- REPLY — the coach's reply: \`{"findings": [{eventIds, severity, category, title, explanation}, …]}\`. F1 is its first finding, F2 the second, and so on.

## What to do

For every finding, split \`title\` and \`explanation\` into individual statements (a time, a number, who did what, a state such as "could not cast", a cause, a comparison, a piece of advice and the premise it rests on). For each statement:

1. Find the prompt line(s) that support it. Use the prompt's own definitions (legends) to read fields; times are mm:ss or seconds from the round start as the prompt prints them.
2. **Supported** → keep it as written.
3. **Contradicted** by a prompt line → rewrite it to what the prompt says, or delete it.
4. **Not supported** (no prompt line states it, it goes further than the line, e.g. "fully", "the whole time", "because", an intention, a position / line-of-sight / range claim the prompt does not print) → weaken it to exactly what the prompt supports, or delete it.
5. **Advice** stays only if every fact its premise needs is in the prompt (e.g. "move behind a pillar" needs a printed position / line-of-sight fact; "kick X" needs X's cast and your kick being ready). Otherwise delete the advice, or replace it with advice whose premise is printed.

Rules:

- **Never add a new fact, event or finding.** Only keep, correct, weaken or delete.
- Keep \`eventIds\`, \`category\` and the finding order. Lower \`severity\` only if a deleted statement was what made it high. Keep the title consistent with what remains.
- If nothing supported is left in a finding, drop the finding.
- Keep the reply's language and the system instructions' rules (output language; spell names exactly as written).
- Keep the style: a coach talking to the player, not a list of citations.

## Output

Output ONLY one JSON object, no prose around it:

\`\`\`
{"findings": [...], "changes": [...]}
\`\`\`

- \`findings\` — the checked reply, same schema as REPLY's \`findings\`, in the same order, without the dropped ones.
- \`changes\` — one entry per changed, deleted or dropped statement: \`{"finding": <n of F<n>>, "action": "corrected" | "weakened" | "deleted" | "dropped", "old": "<old statement>", "new": "<new statement, or null when deleted / dropped>"}\`. Kept statements are not listed.

=== PROMPT ===
${firstRoundPrompt}
=== END PROMPT ===

=== REPLY ===
${reply}
=== END REPLY ===`;
}

const NUMBER = /\d+(?:[.:]\d+)*/g;

/** Every number printed in `text` (times like 1:23 and decimals stay whole). */
export function numbersIn(text: string): Set<string> {
  return new Set(text.replace(BRACKET_TERM, " ").match(NUMBER) ?? []);
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length &&
  [...a].sort().every((id, i) => id === [...b].sort()[i]);

export type SelfReviewOutcome =
  | {
      ok: true;
      findings: Finding[];
      changes: SelfReviewChange[];
      /** 0-based indexes (into the original findings) of reviewed findings
       * that failed a per-finding check and were put back as they were. */
      reverted: Array<{ index: number; reason: string }>;
    }
  | { ok: false; reason: string };

function sanitizeChanges(raw: unknown): SelfReviewChange[] {
  if (!Array.isArray(raw)) return [];
  const out: SelfReviewChange[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    if (
      typeof r.finding !== "number" ||
      !Number.isInteger(r.finding) ||
      !(SELF_REVIEW_ACTIONS as readonly unknown[]).includes(r.action) ||
      typeof r.old !== "string"
    )
      continue;
    out.push({
      finding: r.finding,
      action: r.action as SelfReviewAction,
      old: r.old,
      new: typeof r.new === "string" ? r.new : null,
    });
  }
  return out;
}

/**
 * Check the reviewer's reply against the original findings and build the
 * findings to show.
 *
 * Whole-reply contract (any breach → `ok: false`, the caller shows the
 * original findings unreviewed): `findings` is an array; every entry is one
 * of the original findings (same category and eventIds), none twice, in the
 * original order; at least one is left.
 *
 * Per-finding checks (a breach puts that one finding back as it was, listed in
 * `reverted`): title and explanation are non-empty strings; every number is a
 * value of a cited event's facts or already in the original finding; no
 * causal-language or roster violation (the same lints auditFindings runs);
 * zh spell names repaired the same way. Severity may only go down — a raise
 * is ignored. eventIds and category always come from the original.
 */
export function applySelfReview(
  original: readonly Finding[],
  reply: Record<string, unknown> | null,
  candidates: readonly CandidateEvent[],
  options: { rosterSpecs?: readonly string[] } = {},
): SelfReviewOutcome {
  if (!reply || !Array.isArray(reply.findings))
    return { ok: false, reason: "schema: no findings array" };
  const reviewed = reply.findings as unknown[];
  if (reviewed.length === 0 && original.length > 0)
    return { ok: false, reason: "empty: every finding dropped" };

  const byId = citableEvents(candidates);
  const findings: Finding[] = [];
  const reverted: Array<{ index: number; reason: string }> = [];
  let last = -1;
  for (const item of reviewed) {
    const r = (item ?? {}) as Partial<Record<keyof RawFinding, unknown>>;
    const ids = Array.isArray(r.eventIds)
      ? r.eventIds.filter((x): x is string => typeof x === "string")
      : [];
    const category =
      typeof r.category === "string"
        ? normalizeFindingCategory(r.category)
        : "";
    const index = original.findIndex(
      (o) =>
        normalizeFindingCategory(o.category) === category &&
        sameIds(o.eventIds, ids),
    );
    if (index === -1)
      return { ok: false, reason: "contract: a finding not in the original" };
    if (index <= last)
      return { ok: false, reason: "contract: findings reordered or repeated" };
    last = index;
    const orig = original[index]!;

    const revert = (reason: string) => {
      reverted.push({ index, reason });
      findings.push(orig);
    };
    if (
      typeof r.title !== "string" ||
      typeof r.explanation !== "string" ||
      !r.title.trim() ||
      !r.explanation.trim()
    ) {
      revert("schema: missing / empty title or explanation");
      continue;
    }
    const allowed = numbersIn(`${orig.title}\n${orig.explanation}`);
    for (const id of orig.eventIds)
      for (const v of Object.values(byId.get(id)?.facts ?? {}))
        for (const n of numbersIn(String(v))) allowed.add(n);
    const extra = [...numbersIn(`${r.title}\n${r.explanation}`)].filter(
      (n) => !allowed.has(n),
    );
    if (extra.length > 0) {
      revert(`numeric: ${extra.join(", ")} not in the cited facts`);
      continue;
    }
    const { text: explanation } = repairSpellNameZh(r.explanation);
    const causal = causalLint(explanation);
    if (causal.length > 0) {
      revert(`causal: ${causal.join("; ")}`);
      continue;
    }
    if (options.rosterSpecs) {
      const rv = rosterClassViolations(
        `${r.title}\n${explanation}`,
        options.rosterSpecs,
      );
      if (rv.length > 0) {
        revert(`roster: names ${rv.join(", ")} — not on the roster`);
        continue;
      }
    }
    const severity =
      SEVERITIES.includes(r.severity as RawFinding["severity"]) &&
      SEVERITY_RANK[r.severity as RawFinding["severity"]] >=
        SEVERITY_RANK[orig.severity]
        ? (r.severity as RawFinding["severity"])
        : orig.severity;
    findings.push({ ...orig, severity, title: r.title, explanation });
  }
  return {
    ok: true,
    findings,
    changes: sanitizeChanges(reply.changes),
    reverted,
  };
}
