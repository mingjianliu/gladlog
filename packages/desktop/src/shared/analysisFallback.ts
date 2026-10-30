/**
 * Why a finished analysis carries no narration (`hadNarration: false`,
 * `findings: []`). The main process sets it (`main/analysis.ts`), the panel
 * picks its sentence from it (`derive/zeroFindingText.ts`); the result crosses
 * the IPC as `unknown`, so this is the one definition both sides hold.
 *
 *  - `no-candidates`: the round has nothing to coach — the model was not
 *    called;
 *  - `no-client`: no AI is configured — the model was not called;
 *  - `bad-json`: the model was called and its reply could not be parsed,
 *    twice;
 *  - `empty-reply`: the model was called and its reply parsed as an empty
 *    array — it read the menu and wrote no finding. Reachable since the
 *    findings prompt asks for "up to N" on a small menu.
 *
 * A zero-finding result with none of them and nothing dropped by the audit is
 * a cache written before the field existed (or, for `empty-reply`, before
 * that value did).
 */
export type AnalysisFallbackReason =
  "no-candidates" | "no-client" | "bad-json" | "empty-reply";
