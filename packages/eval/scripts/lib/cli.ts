/**
 * Shared CLI flag helpers for the eval scripts.
 *
 * Extracted 2026-09-26 from byte-identical copies: `arg` lived in 22 scripts,
 * `argOf` in 11. Semantics are unchanged — scripts whose helper differed
 * (a `parseArgs()` object, a string-returning `arg(name)` without a default,
 * …) keep their own and are not migrated.
 */

const argv = process.argv.slice(2);

/** `--flag value` lookup with a default: the flag is matched as an exact
 * token, and a flag with no following token falls back to `d`. */
export const arg = (k: string, d: string): string => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

/** Positive-number flag with a default: absent, non-numeric or ≤ 0 → `dflt`. */
export function argOf(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
