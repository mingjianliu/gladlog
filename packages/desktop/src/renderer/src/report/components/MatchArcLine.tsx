import { fmtTime } from "@gladlog/analysis";
import type { IMatchArcPhase } from "@gladlog/analysis/src/context/matchNarrative";

const PHASE_ZH: Record<IMatchArcPhase["phase"], string> = {
  early: "早期",
  mid: "中期",
  late: "后期",
};


/**
 * Match-tempo header line (#10 T4). Consumes the structured phases from T1's
 * `buildMatchArcStructured` -- a pure render layer that never recomputes
 * phase boundaries. One compact line (scrolls horizontally, never wraps):
 * early/mid/late pills plus a clickable turning-point button (seeks the
 * replay, same contract as MatchReport's onSeek(tSeconds, unitNames)).
 *
 * Review-round fix: `phase.prose` is the sentence `buildMatchArc` feeds the
 * LLM (English only) and is not rendered here -- this product's UI is fully
 * localized while prose has no matching localized version, and building a
 * translation layer would spawn a second, unmaintained predicate (violating
 * "the gate's predicate is the spec"). `turningPoint.label` is likewise
 * English (spell/unit names; T1's structured output currently exposes only
 * {tS, label}, with no sub-fields from which a localized phrase could be
 * assembled) -- handled by the same principle: the button body shows only the
 * timestamp, the localized aria-label says "this is a turning point", and the
 * English label lives only in the title= tooltip (keeping spell names in
 * English is an established convention of this app, and a tooltip is an
 * acceptable place for it).
 */
export function MatchArcLine({
  phases,
  onSeek,
}: {
  phases: IMatchArcPhase[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  if (phases.length === 0) return null;
  return (
    <div className="rpt-arc-line" data-testid="match-arc-line">
      {phases.map((p, i) => (
        <span className="rpt-arc-phase" key={`${p.phase}-${p.fromS}`}>
          <span className="rpt-arc-phase-label">
            {PHASE_ZH[p.phase]} {fmtTime(p.fromS)}–{fmtTime(p.toS)}
          </span>
          {/* When onSeek is absent, don't render a dead button that looks
              clickable but does nothing -- if we can't seek, don't pretend. */}
          {p.turningPoint && onSeek && (
            <button
              type="button"
              className="rpt-arc-turning"
              aria-label={`跳转到转折点 ${fmtTime(p.turningPoint.tS)}`}
              title={p.turningPoint.label}
              onClick={() => onSeek(p.turningPoint!.tS, [])}
            >
              ⟶ {fmtTime(p.turningPoint.tS)}
            </button>
          )}
          {i < phases.length - 1 && <span className="rpt-arc-sep"> ｜ </span>}
        </span>
      ))}
    </div>
  );
}
