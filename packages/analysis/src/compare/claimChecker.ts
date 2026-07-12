const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Replace every {{key}} present in facts with its value; unknown keys stay literal. */
export function interpolate(
  text: string,
  facts: Record<string, string>,
): string {
  return text.replace(PLACEHOLDER, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(facts, key) ? facts[key] : m,
  );
}

// A "stat-like" bare number: a decimal (0.85 OR a leading-dot .85), or an integer
// tied to a stat context (% or "percentile"). Conversational integers ("2 minutes")
// are allowed. Runs AFTER placeholder spans are stripped, so no lookbehind needed.
const DECIMAL = /\d*\.\d+/;
const STAT_PCT = /\b\d+\s*(%|percent\b)/i; // digit + % OR the word "percent"
const PERCENTILE_NUM = /\b\d+(st|nd|rd|th)?\s*percentile/i;

export function claimChecker(
  rawText: string,
  facts: Record<string, string>,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  // 1. every {{key}} must resolve
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER.source, "g");
  while ((m = re.exec(rawText)) !== null) {
    if (!Object.prototype.hasOwnProperty.call(facts, m[1]))
      violations.push(`unknown placeholder {{${m[1]}}}`);
  }
  // 2. strip placeholder spans, then scan the prose for raw stat-like numbers
  const prose = rawText.replace(PLACEHOLDER, " ");
  for (const [label, rx] of [
    ["decimal", DECIMAL],
    ["percentage", STAT_PCT],
    ["percentile", PERCENTILE_NUM],
  ] as const) {
    const hit = prose.match(rx);
    if (hit)
      violations.push(`raw ${label} outside placeholder: "${hit[0].trim()}"`);
  }
  return { ok: violations.length === 0, violations };
}
