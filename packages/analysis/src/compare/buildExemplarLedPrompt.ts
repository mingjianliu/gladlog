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
    `You are a World of Warcraft arena coach. Write 2-3 short paragraphs comparing this ${specName}'s play to their skill cohort (bracket ${cell.bracket}, comp ${cell.archetype}, build group ${cell.buildGroup}, N=${cell.sampleN}).`,
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
