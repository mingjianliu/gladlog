// packages/analysis/src/compare/buildExemplarLedPrompt.ts
import type { VerifiedComparison } from "./verifiedComparison";
import type { ReferenceCell } from "./corpusTypes";

export function buildExemplarLedPrompt(
  vc: VerifiedComparison,
  cell: ReferenceCell,
  specName: string,
): string {
  const keyLines = Object.keys(vc.facts)
    .map((k) => `  {{${k}}}`)
    .join("\n");
  const exemplars = cell.exemplarCrises
    .flat()
    .slice(0, 8)
    .map((c) => `  - ${c}`)
    .join("\n");
  return [
    `You are a World of Warcraft arena coach. Compare this ${specName}'s play to their skill cohort (bracket ${cell.bracket}, comp ${cell.archetype}, build group ${cell.buildGroup}, N=${cell.sampleN}).`,
    ``,
    `STRUCTURE (make it genuinely instructive, not a number dump):`,
    `1. One opening sentence: overall read of where this player sits vs the cohort.`,
    `2. For each dimension where the player is meaningfully BELOW the cohort (per its verdict placeholder): a short paragraph that (a) explains in plain language what that metric measures and why it wins games, (b) states the gap using the value/median placeholders, (c) gives ONE concrete, actionable adjustment for the next session.`,
    `3. One short paragraph acknowledging the strongest dimension (what to keep doing).`,
    `4. Close with a single priority: if they fix only one thing, which and why.`,
    ``,
    `HARD RULES:`,
    `- Refer to EVERY number and every performance judgement ONLY through the placeholders below. Never write a raw statistic, percentage, or percentile yourself — write the placeholder and it will be substituted.`,
    `- Do not invent spells, numbers, or cohort facts. Use only what is provided.`,
    ``,
    `Available placeholders (use verbatim, in double braces):`,
    keyLines,
    ``,
    `How strong players in this cohort handled crisis moments (for qualitative guidance only):`,
    exemplars || "  (none available)",
    ``,
    `Write the coaching narrative now, using the placeholders.`,
  ].join("\n");
}
