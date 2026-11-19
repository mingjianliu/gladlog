/**
 * The span a kick-eaten menu row's `ourLow*` / `theirLow*` are read over,
 * found from the row's printed `t`: the producer's own interrupt instance of
 * that `t` (`fmtFactTime`, the row's rendering), handed to the producer's
 * own span (`kickPressureSpanMs`).
 *
 * The row prints `t` cut to 0.1 s and `lockout` rounded to 0.1 s, and not
 * the early end a successful press gives the lock (`lockEndedBySuccessS`),
 * so the span cannot be rebuilt from the row (pipeline B139 review of
 * `troughFactScan`: a rebuilt end read a sample 36 ms after the lock).
 */
import { fmtFactTime } from "@gladlog/analysis/src/analysis/factFormat";
import { kickPressureSpanMs } from "@gladlog/analysis/src/analysis/kickPressure";

export interface KickInstanceLike {
  atSeconds: number;
  lockoutDurationSeconds: number;
  lockEndedBySuccessS?: number | null;
}

/** `undefined` when no instance prints that `t`, or more than one does with
 * different spans (the row cannot say which). */
export function kickRowSpanMs(
  instances: readonly KickInstanceLike[],
  combat: { startTime: number; endTime: number },
  printedT: string,
): { fromMs: number; toMs: number } | undefined {
  const spans = instances
    .filter((k) => fmtFactTime(k.atSeconds) === printedT)
    .map((k) => kickPressureSpanMs(k, combat));
  const first = spans[0];
  if (!first) return undefined;
  return spans.every((s) => s.fromMs === first.fromMs && s.toMs === first.toMs)
    ? first
    : undefined;
}
