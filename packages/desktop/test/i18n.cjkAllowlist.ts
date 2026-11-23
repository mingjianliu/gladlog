// Permanent exceptions to §6.9 check 1 (test/i18n.noCjkLiterals.test.ts): a
// CJK literal that is never shown to the user. Each entry matches the hits in
// `file` whose literal text (a whole template, `${…}` included) contains
// `snippet`, and must say why it is not user-facing. Shrink-only; the test
// fails on an entry that no longer matches anything.
export const CJK_ALLOWLIST: ReadonlyArray<{
  file: string;
  snippet: string;
  reason: string;
}> = [
  {
    file: "packages/desktop/src/main/analysis.ts",
    snippet: "回退到 settings 默认后端",
    reason:
      "console.warn in the main process (deepen falls back from an unknown slot backend); developer log only, never rendered",
  },
];
