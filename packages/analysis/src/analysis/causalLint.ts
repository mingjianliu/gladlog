// Strong causal attribution the "avoid-causality-by-design" policy forbids. This
// checks causal LANGUAGE (enforcing the policy), not causal TRUTH (unverifiable).
const PATTERNS: Array<[string, RegExp]> = [
  ["because-death", /\b(died|death|lost|loss|wiped)\b[^.]*\bbecause\b/i],
  ["because-then-outcome", /\bbecause\b[^.]*\b(died|death|lost|loss|wiped)\b/i],
  ["cost-you", /\bcost (you|him|her|them|the team)\b/i],
  ["thats-why", /\b(that'?s|this is) why\b/i],
  [
    "led-to",
    /\b(led to|resulted in|caused)\b[^.]*\b(loss|death|wipe|defeat)\b/i,
  ],
];

export function causalLint(text: string): string[] {
  const v: string[] = [];
  for (const [label, rx] of PATTERNS)
    if (rx.test(text)) v.push(`strong causal claim (${label})`);
  return v;
}
