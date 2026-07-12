// Strong causal attribution the "avoid-causality-by-design" policy forbids. This
// checks causal LANGUAGE (enforcing the policy), not causal TRUTH (unverifiable).
// Regex-only by design (semantic/LLM-judge causal audit is deferred to SP-A.1);
// covers the common connectives incl. present-tense outcomes.
const OUTCOME =
  "(died|death|dies|die|lost|loss|lose|loses|wiped|wipe|killed|defeat)";
const PATTERNS: Array<[string, RegExp]> = [
  ["outcome-because", new RegExp(`\\b${OUTCOME}\\b[^.]*\\bbecause\\b`, "i")],
  ["because-outcome", new RegExp(`\\bbecause\\b[^.]*\\b${OUTCOME}\\b`, "i")],
  ["cost", /\bcost (you|him|her|them|the team|the round|the game)\b/i],
  ["got-killed", /\bgot (you|him|her|them|the team) killed\b/i],
  ["thats-why", /\b(that'?s|this is|which is) why\b/i],
  [
    "led-to",
    new RegExp(`\\b(led to|resulted in|caused)\\b[^.]*\\b${OUTCOME}\\b`, "i"),
  ],
];

export function causalLint(text: string): string[] {
  const v: string[] = [];
  for (const [label, rx] of PATTERNS)
    if (rx.test(text)) v.push(`strong causal claim (${label})`);
  return v;
}
