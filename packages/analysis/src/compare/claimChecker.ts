/**
 * 占位符语法(单源)。interpolate / claimChecker / 深挖审计必须共用这一条 ——
 * 各写各的会漂:深挖审计曾自带 `/\{\{(p\d+)\.[^}]+\}\}/`,不容忍前导空格,
 * 于是模型写 `{{ p1.t }}` 时 claimChecker 认、裸数字检查也认,唯独审计抓不到
 * key → citedKeys 为空时整条被静默丢弃,不为空时 chips 退化成只认 citedKeys,
 * 把「chips 取 citedKeys ∪ usedKeys 防跳错时刻」那个修补悄悄废掉。
 */
export const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** 文本里实际用到的占位符键(如 `p1.t`),去重、保持出现顺序。 */
export function extractPlaceholderKeys(text: string): string[] {
  const re = new RegExp(PLACEHOLDER.source, "g");
  return [...new Set([...text.matchAll(re)].map((m) => m[1]!))];
}

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
