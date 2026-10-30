// packages/analysis/src/compare/buildExemplarLedPrompt.ts
import { scrubExemplar } from "./claimChecker";
import type { ReferenceCell } from "./corpusTypes";
import type { VerifiedComparison } from "./verifiedComparison";

/**
 * Cache key for the cohort-comparison cache (desktop's `compare.json`) — the
 * version of *this file's* prompt. Unrelated to the findings prompt version in
 * `shared/promptVersion.ts`.
 *
 * Single-source predicate: bump it here when buildExemplarLedPrompt's output
 * changes, or when verifiedComparison's set of dimensions changes. The writer
 * (compare.ts `finish`) and the reader (`getCached`) share this one constant.
 *
 * Why it has to be its own constant (2026-08-02): compare.json used to key off
 * the analysis PROMPT_VERSION, which has no causal relation to it — so every
 * findings-prompt bump (13→14→15 within two days, 2026-08-01/02) silently voided
 * every stored cohort comparison in the library, and the "vs your cohort" panel
 * simply vanished with no explanation. v1 is the decoupling point; older
 * compare.json files store the analysis version (3/14/15…), which will not equal
 * 1 and is therefore treated as stale. That is intended — the old predicate had
 * already invalidated them — so there is no migration.
 *
 * v2 (2026-08-12): exemplars scrubbed of gate contraband + verdict values
 * exposed + no-invented-numbers rule (probe: 27/36 narrations were being
 * killed by claimChecker under v1).
 *
 * v3 (2026-08-25, #37 缺口一/三): the "how this cohort actually plays" section
 * rendered from cell.rotationSummary — deliberately DIGIT-FREE (shares become
 * the words standard/common/occasional) so the model can never echo a raw
 * number claimChecker would kill.
 */
export const COMPARE_PROMPT_VERSION = 3;

export function buildExemplarLedPrompt(
  vc: VerifiedComparison,
  cell: ReferenceCell,
  specName: string,
): string {
  const keyLines = Object.keys(vc.facts)
    .map((k) => `  {{${k}}}`)
    .join("\n");
  // Verdict values are exposed directly (they are digit-free prose by
  // construction — verdictFor's three fixed strings): STRUCTURE step 2 asks
  // the model to write about the dimensions where the player is BELOW the
  // cohort, which it cannot know from bare placeholder keys. Being blind here
  // both broke the structure and fed the temptation to invent
  // concrete-sounding numbers (2026-08-12 probe).
  const verdictLines = Object.entries(vc.facts)
    .filter(([k]) => k.endsWith(".verdict"))
    .map(([k, v]) => `  ${k.slice(0, -".verdict".length)}: ${v}`)
    .join("\n");
  // Exemplars are scrubbed with the claim-gate's own predicate: raw crisis
  // strings carry timestamps + HP percentages, and models quoting them was the
  // top killer of narrations under prompt v1 (see scrubExemplar's doc).
  const exemplars = cell.exemplarCrises
    .flat()
    .slice(0, 8)
    .map((c) => `  - ${scrubExemplar(c)}`)
    .join("\n");
  // #37 缺口三 (user ruling: 输出写成文字): qualitative share buckets, digits
  // stay out of the prompt so the model cannot echo one.
  const shareWord = (x: number) =>
    x >= 0.5 ? "the standard" : x >= 0.25 ? "a common" : "an occasional";
  const rot = cell.rotationSummary;
  const rotationLines = rot
    ? [
        ...rot.openers
          .slice(0, 2)
          .map((o) => `  - ${shareWord(o.share)} opener in this cohort: ${o.seq}`),
        ...rot.sequences
          .slice(0, 3)
          .map((q) => `  - ${shareWord(q.share)} chain: ${q.seq}`),
      ].join("\n")
    : "";
  return [
    `You are a World of Warcraft arena coach. Compare this ${specName}'s play to their skill cohort (bracket ${cell.bracket}, comp ${cell.archetype}, build group ${cell.buildGroup}, N=${cell.sampleN}).`,
    ``,
    `STRUCTURE (make it genuinely instructive, not a number dump):`,
    `1. One opening sentence: overall read of where this player sits vs the cohort.`,
    `2. For each dimension where the player is meaningfully BELOW the cohort (see the verdicts below): a short paragraph that (a) explains in plain language what that metric measures and why it wins games, (b) states the gap using the value/median placeholders, (c) gives ONE concrete, actionable adjustment for the next session.`,
    `3. One short paragraph acknowledging the strongest dimension (what to keep doing).`,
    `4. Close with a single priority: if they fix only one thing, which and why.`,
    ``,
    `HARD RULES:`,
    `- Refer to EVERY number and every performance judgement ONLY through the placeholders below. Never write a raw statistic, percentage, or percentile yourself — write the placeholder and it will be substituted.`,
    `- Do not invent spells, numbers, or cohort facts. Use only what is provided.`,
    `- Do not write illustrative numbers of your own either — no invented HP thresholds, reaction times, or percentages. Express urgency and thresholds in words ("critically low", "a beat late"), never in digits.`,
    ``,
    `Available placeholders (use verbatim, in double braces):`,
    keyLines,
    ``,
    `Where this player stands per dimension (verified; cite via the corresponding {{key.verdict}} placeholder):`,
    verdictLines || "  (none)",
    ``,
    `How strong players in this cohort handled crisis moments (for qualitative guidance only):`,
    exemplars || "  (none available)",
    ``,
    `How this cohort actually plays (qualitative — never quote numbers about it):`,
    rotationLines || "  (no rotation data in this corpus build)",
    ``,
    `Write the coaching narrative now, using the placeholders.`,
  ].join("\n");
}

/**
 * One-shot repair prompt after a claimChecker rejection (single source: the
 * product retry in desktop/compare.ts and the eval probe must build the exact
 * same second attempt). The 2026-08-12 probe showed a residual violation class
 * that exemplar scrubbing cannot reach — numbers the model authors itself
 * ("0.5s late", "above 80%"), heaviest on deepseek (12/12 first-attempt
 * failures) — so the retry feeds the violations back verbatim.
 */
export function buildRetryPrompt(
  prompt: string,
  rejectedDraft: string,
  violations: string[],
): string {
  return [
    prompt,
    ``,
    `Your previous draft was REJECTED by an automated checker. Violations:`,
    ...violations.map((v) => `  - ${v}`),
    ``,
    `Rejected draft:`,
    rejectedDraft,
    ``,
    `Rewrite the full coaching narrative from scratch, fixing every violation: replace every raw number with its placeholder if one exists, otherwise remove the number and express the idea in words. Use only placeholders listed above, spelled exactly.`,
  ].join("\n");
}
