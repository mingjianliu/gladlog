/**
 * Deterministic quoting metric for free-text coach responses (GH #103 class
 * C, user ruling 2026-09-23: "make it an eval deterministic metric" — track,
 * do not block).
 *
 * The responder's QUOTING DISCIPLINE (docs/commands/eval-baseline.md) says a
 * range is written only when the prompt prints that exact range on one line.
 * This measures how often a response instead RE-CUTS a printed window — keeps
 * one endpoint and moves the other ("3:05–3:16" quoted as "3:05–3:15"), the
 * C1 shape of the 2026-09-23 error ledger. A range sharing no endpoint with
 * any printed range is counted separately as free-form: often a legitimate
 * self-defined stretch, so it is reported, not scored.
 *
 * HP quotes ("58% (1:36)", "58% at 1:36", "low 32% @1:39") count as supported
 * when a prompt line stamped with that second carries the value, or the
 * prompt prints the same `low X% @M:SS` verbatim (a DMG SPIKE line is stamped
 * with its window start, not its trough). First measurement (Opus 5.5
 * baseline, 50 responses): ranges 316 = verbatim 228 / re-cut 43 / free-form
 * 45; HP quotes 1/432 unsupported, itself a parse artefact of a
 * "72% -> 43% (0:29 / 0:32)" series.
 */
const T = String.raw`\d{1,2}:\d{2}`;
const RANGE_IN_PROMPT = new RegExp(`(${T})–(${T})`, "g");
const RANGE_IN_RESPONSE = new RegExp(`(${T})\\s*[–\\-—]\\s*(${T})`, "g");
const HP_AT_TIME = new RegExp(
  String.raw`(\d{1,3})%\s*(?:\(|at |@ ?)(${T})\)?`,
  "g",
);
const LINE_TIME = new RegExp(String.raw`^\s*(${T})\b`);

export interface RecutRange {
  range: string;
  /** printed ranges sharing an endpoint with the quoted one */
  printed: string[];
}

export interface ResponseQuoteResult {
  verbatimRanges: number;
  recutRanges: RecutRange[];
  freeFormRanges: number;
  hpQuotes: number;
  unsupportedHp: string[];
}

export function checkResponseQuotes(
  response: string,
  prompt: string,
): ResponseQuoteResult {
  const printed = new Set<string>();
  const byStart = new Map<string, Set<string>>();
  const byEnd = new Map<string, Set<string>>();
  for (const m of prompt.matchAll(RANGE_IN_PROMPT)) {
    const [a, b] = [m[1]!, m[2]!];
    printed.add(`${a}–${b}`);
    (byStart.get(a) ?? byStart.set(a, new Set()).get(a)!).add(`${a}–${b}`);
    (byEnd.get(b) ?? byEnd.set(b, new Set()).get(b)!).add(`${a}–${b}`);
  }
  const linesAt = new Map<string, string[]>();
  for (const line of prompt.split("\n")) {
    const m = line.match(LINE_TIME);
    if (m)
      (linesAt.get(m[1]!) ?? linesAt.set(m[1]!, []).get(m[1]!)!).push(line);
  }

  const result: ResponseQuoteResult = {
    verbatimRanges: 0,
    recutRanges: [],
    freeFormRanges: 0,
    hpQuotes: 0,
    unsupportedHp: [],
  };
  for (const m of response.matchAll(RANGE_IN_RESPONSE)) {
    const range = `${m[1]}–${m[2]}`;
    if (printed.has(range)) {
      result.verbatimRanges++;
      continue;
    }
    const near = new Set([
      ...(byStart.get(m[1]!) ?? []),
      ...(byEnd.get(m[2]!) ?? []),
    ]);
    if (near.size > 0)
      result.recutRanges.push({ range, printed: [...near].sort() });
    else result.freeFormRanges++;
  }
  for (const m of response.matchAll(HP_AT_TIME)) {
    result.hpQuotes++;
    const [v, ts] = [m[1]!, m[2]!];
    if (prompt.includes(`low ${v}% @${ts}`)) continue;
    const value = new RegExp(String.raw`(?<![\d.])${v}(?:%|\b)`);
    if (!(linesAt.get(ts) ?? []).some((l) => value.test(l)))
      result.unsupportedHp.push(`${v}%@${ts}`);
  }
  return result;
}
