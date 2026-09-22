/**
 * `max_tokens` budgets for the Anthropic API backend (GH #92, 2026-09-22).
 *
 * Single source: every `client.stream({ max_tokens })` call in main imports
 * from here; `aiBudgets.test.ts` fails on any numeric `max_tokens:` literal
 * left in `src/main`, so a call site cannot quietly regress to a small value.
 *
 * Why these are large. Since 2026-09-12 the default API model is
 * claude-opus-5, which thinks adaptively by default, and its thinking tokens
 * count against `max_tokens`. A budget that only covers the visible answer
 * truncates mid-thought: the answer arrives as `bad-json` → one retry → the
 * deterministic fallback, i.e. an API-key user silently loses the AI
 * analysis. The previous values (8192 / 4096 / 2048 / 1500) were sized for
 * pre-thinking models against the visible answer alone.
 *
 * Every call goes through `client.messages.stream`, so a large budget does
 * not touch HTTP timeouts, and billing is by tokens actually generated, not
 * by the budget. 64k is the SDK guidance's streaming default; 128k is the
 * model's output cap.
 *
 * Measured 2026-09-22 (local `claude` CLI, claude-opus-5, effort high = the
 * API default when `output_config.effort` is not sent; product prompts with
 * the coach system prompt prepended; `usage.output_tokens` from the CLI JSON
 * envelope; `packages/eval/scripts/outputTokenBudgetProbe.ts`):
 *
 *   call site     n  min    p50    max     thinking share  old budget
 *   first-round   8  5,184  7,908  12,069  74 %            8,192 → 3/8 over
 *   deep-dive     4  1,601  1,760   2,547  77 %            4,096
 *
 * Three of eight first-round prompts already exceed the old 8,192 on the
 * API path. coachChat / learning / compare were not measured (their prompts
 * need a live product session); their answers are shorter than a deep dive
 * and the thinking part is what dominates, so they take the same floor.
 * The CLI backends ignore `max_tokens` entirely.
 */
export const API_MAX_TOKENS = {
  /** First-round findings (4–8 findings + explanations, JSON). */
  findings: 64_000,
  /** Deep-dive rounds and their audit-repair retry. */
  deepDive: 32_000,
  /** Window analysis (one pack) and its audit-repair retry. */
  window: 32_000,
  /** Coach chat seeding reply. */
  coachChat: 32_000,
  /** Self-learning rule distillation. */
  learning: 32_000,
  /** Compare commentary (exemplar-led). */
  compare: 32_000,
} as const;

/** Floor pinned by the unit test: no budget may drop below this again. */
export const API_MAX_TOKENS_FLOOR = 32_000;
