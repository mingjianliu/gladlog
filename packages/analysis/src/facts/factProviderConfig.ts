/**
 * Fact-provider configuration — GH #96 D6 (design
 * docs/superpowers/specs/2026-09-13-talent-integration-design.md).
 *
 * Talent integration changes FACTS (a defensive's strength, whether an
 * unlisted defensive press counts). To measure what that does to coaching
 * decisions, the same recorded inputs are replayed under two configurations
 * and every decision is compared (packages/eval/scripts/decisionDiff.ts).
 *
 * codex astra GH #96 R2 ruling 4: the flag itself does not break the
 * shared-predicate rule as long as ONE immutable configuration is selected per
 * process and analysis, rendering, gates and reference lookups all read that
 * same configuration — never per-consumer branches with their own defaults.
 * So:
 *  - `getFactConfig()` is the only reader; the first read LOCKS the value;
 *  - `configureFacts()` may run once before that; configuring a different
 *    value afterwards throws;
 *  - the process default comes from `GLADLOG_FACT_CONFIG` (JSON, merged over
 *    PRODUCTION_FACT_CONFIG) so a replay child process selects its side
 *    without touching code.
 *
 * Switches are added by the milestone that first READS them (no dormant
 * flags): M3b adds the talent-mitigation switch. Every switch starts at the
 * value that reproduces current product behaviour, and a switch's production
 * default only moves after its decisionDiff report is accepted (recorded in
 * docs/predicate-index.md's feature-flag ledger).
 */

export type FactProviderConfig = Readonly<Record<string, boolean>>;

export const PRODUCTION_FACT_CONFIG: FactProviderConfig = Object.freeze({
  /** M3b: talent value-modifiers on mitigation auras (mitigationComponents.ts) */
  talentMitigation: false,
});

let configured: FactProviderConfig | null = null;
let locked = false;

function validated(cfg: Record<string, unknown>, source: string) {
  for (const [k, v] of Object.entries(cfg)) {
    if (!(k in PRODUCTION_FACT_CONFIG))
      throw new Error(`${source}: unknown switch "${k}"`);
    if (typeof v !== "boolean")
      throw new Error(`${source}: switch "${k}" must be boolean`);
  }
  return Object.freeze({
    ...PRODUCTION_FACT_CONFIG,
    ...(cfg as Record<string, boolean>),
  });
}

function fromEnv(): FactProviderConfig {
  const raw =
    typeof process !== "undefined"
      ? process.env?.GLADLOG_FACT_CONFIG
      : undefined;
  if (!raw) return PRODUCTION_FACT_CONFIG;
  return validated(JSON.parse(raw), "GLADLOG_FACT_CONFIG");
}

/** Select the configuration for this process. Once only, before any read. */
export function configureFacts(cfg: Record<string, boolean>): void {
  const next = validated(cfg, "configureFacts");
  if (locked || configured) {
    const current = configured ?? fromEnv();
    if (JSON.stringify(current) !== JSON.stringify(next))
      throw new Error(
        "fact configuration is immutable once selected or read in this process",
      );
    return;
  }
  configured = next;
}

/** The one reader. Locks the configuration on first use. */
export function getFactConfig(): FactProviderConfig {
  if (!configured) configured = fromEnv();
  locked = true;
  return configured;
}

/** Test-only: reset between test cases. Never called by product code. */
export function __resetFactConfigForTests(): void {
  configured = null;
  locked = false;
}
