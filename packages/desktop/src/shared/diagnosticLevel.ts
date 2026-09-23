/**
 * Diagnostic code → display level (badge filtering in the developer page's
 * diagnostics section).
 *
 * `DiagnosticEntry` (preload/api.ts) only has code/detail/fileKey, no level;
 * leveling can only go off the code. This is a **whitelist**: any code not in
 * the table is error —— when upstream adds a real error and forgets to register
 * it here, the consequence is "one extra noisy alert" rather than "buried in
 * warn where nobody sees it".
 *
 * Two upstream sources of codes:
 * - `packages/parser/src/invariants.ts` (kebab-case, data invariant violation
 *   = warn)
 * - `packages/parser/src/api.ts` / `src/worker/runtime.ts` (UPPER_SNAKE,
 *   pipeline failure = error)
 *
 * `test/diagnosticLevel.test.ts` reads the literals out of invariants.ts and
 * reconciles them against this table; an upstream rename/addition that is not
 * followed here turns CI red.
 */

export type DiagnosticLevel = "warn" | "error";

export const DIAGNOSTIC_LEVEL: Record<string, DiagnosticLevel> = {
  // ── parser invariants (data is flawed, match still usable) ──
  "start-before-end": "warn",
  monotonic: "warn",
  "time-bounds": "warn",
  "hp-range": "warn",
  "hp-amount-finite": "warn",
  "pet-owner-resolves": "warn",
  "line-resolves": "warn",
  "death-has-damage": "warn",
  // ── pipeline failures ──
  BUILD_FAILED: "error",
  LOGS_DIR_UNREADABLE: "error",
};

export function diagnosticLevel(code: string): DiagnosticLevel {
  return DIAGNOSTIC_LEVEL[code] ?? "error";
}
