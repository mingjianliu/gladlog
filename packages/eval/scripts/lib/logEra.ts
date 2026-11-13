/**
 * The game version a log was recorded under, for a scan that pools rounds
 * across a patch (GH #160 item 3): one cooldown number per spell cannot be
 * right on both sides of a patch that changed it, so a pooled "impossible
 * recast" count or recast-ratio floor mixes two games. Named through the
 * product's own dated-rule question (`logIsFrom`) and go-live instants — a
 * round is on the side of a cutover the product's dated rules put it on.
 */
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import {
  logDatedAt,
  logInstantOf,
  logIsFrom,
  PATCH_1215_ZONE_BAND_TAKES,
} from "@gladlog/analysis/src/utils/logEra";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/talents";

export const LOG_ERAS = ["pre-12.1", "12.1.0", "12.1.5"] as const;
export type LogEra = (typeof LOG_ERAS)[number];

/**
 * The era of a round, asked as the product asks it: `match` is the converted
 * match (it carries the clock offset its lines state), `parsedEpochMs` its
 * start. The 12.1.5 side is the product's dated reading (`logDatedAt` on
 * `logInstantOf`, with the go-live's own band side,
 * `PATCH_1215_ZONE_BAND_TAKES` — what `talentsOf` asks); the 12.1 side is
 * `logIsFrom` on the parsed epoch, as `drResetMsAt` asks it. The bare
 * `startTime` alone put a round parsed 6 h past its stated instant on the
 * wrong side of the go-live (codex 80-PIPE-50-B50-v1; T90 measured 125
 * such match-cutover pairs on 605 + wide).
 */
export function logEraOf(
  match: object | null | undefined,
  parsedEpochMs: number,
): LogEra {
  if (
    logDatedAt(
      {
        cutoverEpochMs: PATCH_1215_GOLIVE_EPOCH_MS,
        before: false,
        since: true,
        zoneBandTakes: PATCH_1215_ZONE_BAND_TAKES,
      },
      logInstantOf(match, parsedEpochMs),
    )
  )
    return "12.1.5";
  if (logIsFrom(parsedEpochMs, PATCH_121_GOLIVE_EPOCH_MS)) return "12.1.0";
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
