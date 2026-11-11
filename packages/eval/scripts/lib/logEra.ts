/**
 * The game version a log was recorded under, for a scan that pools rounds
 * across a patch (GH #160 item 3): one cooldown number per spell cannot be
 * right on both sides of a patch that changed it, so a pooled "impossible
 * recast" count or recast-ratio floor mixes two games. Named through the
 * product's own dated-rule question (`logIsFrom`) and go-live instants — a
 * round is on the side of a cutover the product's dated rules put it on.
 */
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { logIsFrom } from "@gladlog/analysis/src/utils/logEra";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/talents";

export const LOG_ERAS = ["pre-12.1", "12.1.0", "12.1.5"] as const;
export type LogEra = (typeof LOG_ERAS)[number];

/** the era of a round, asked with its start (`startTime`, epoch ms) */
export function logEraOf(logEpochMs: number): LogEra {
  if (logIsFrom(logEpochMs, PATCH_1215_GOLIVE_EPOCH_MS)) return "12.1.5";
  if (logIsFrom(logEpochMs, PATCH_121_GOLIVE_EPOCH_MS)) return "12.1.0";
  return "pre-12.1";
}

/** `counts[era][field] += n`, creating what is missing */
export function bumpEra<F extends string>(
  counts: Partial<Record<LogEra, Record<F, number>>>,
  era: LogEra,
  add: Record<F, number>,
): void {
  const row = (counts[era] ??= { ...add, ...zeroOf(add) });
  for (const k of Object.keys(add) as F[]) row[k] += add[k];
}
function zeroOf<F extends string>(add: Record<F, number>): Record<F, number> {
  return Object.fromEntries(Object.keys(add).map((k) => [k, 0])) as Record<
    F,
    number
  >;
}
