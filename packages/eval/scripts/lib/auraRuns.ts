/**
 * Clean aura lifetimes read the way the product reads an aura (GH #175,
 * codex B25 #3; `buildAuraIntervals`): a BROKEN line its aura's own REMOVED
 * follows is not the end (`supersededAuraBreaks` — codex 85-tk-A-T18-2 #3),
 * rows through `dropAuraRebroadcasts` (a REMOVED → APPLIED re-broadcast is
 * one run), then continuous runs per source in log order —
 * an APPLIED while that source's run is open is a duplicate row of it, a
 * REFRESH makes the run unclean (with `doseUnclean`, an APPLIED_DOSE too: a
 * stacking aura's lifetime is not its duration — codex 85-tk-A-T18-2 #2), a
 * REMOVED / BROKEN ends it (its own source's run, else the oldest open
 * one). Only clean, ended runs come back. `buffDurationScan --per-app` reads these.
 */
import {
  dropAuraRebroadcasts,
  supersededAuraBreaks,
} from "@gladlog/analysis/src/utils/auraIntervals";
import { LogEvent } from "@gladlog/parser-compat";

export interface IAuraRunRow {
  spellId?: string | null;
  srcUnitId?: string;
  destUnitId?: string;
  timestamp: number;
  logLine: { event: string; timestamp: number };
}

export interface ICleanAuraRun {
  srcUnitId: string;
  fromMs: number;
  toMs: number;
}

const ENDS = new Set<string>([
  LogEvent.SPELL_AURA_REMOVED,
  LogEvent.SPELL_AURA_BROKEN,
  LogEvent.SPELL_AURA_BROKEN_SPELL,
]);

/** The clean, ended runs of one aura's rows on one unit (log order). */
export function cleanAuraRuns(
  rows: readonly IAuraRunRow[],
  opts: {
    doseUnclean?: boolean;
    /** an APPLIED while its source's run is open is a new press (the
     * source logged a cast of it there — `sourcePressedAuraNear`): the
     * open run lost its REMOVED and is dropped, a run starts (codex
     * 85-tk-A-T18-2b #1) */
    isNewApplication?: (applied: IAuraRunRow) => boolean;
  } = {},
): ICleanAuraRun[] {
  const out: ICleanAuraRun[] = [];
  // insertion order = oldest open run first
  const open = new Map<string, { t: number; clean: boolean }>();
  const notTheEnd = supersededAuraBreaks(rows);
  for (const a of dropAuraRebroadcasts(rows)) {
    if (notTheEnd.has(a)) continue;
    const src = a.srcUnitId ?? "";
    const ev = a.logLine.event;
    const t = a.logLine.timestamp;
    if (ev === LogEvent.SPELL_AURA_APPLIED) {
      if (!open.has(src)) open.set(src, { t, clean: true });
      else if (opts.isNewApplication?.(a)) {
        open.delete(src);
        open.set(src, { t, clean: true });
      }
    } else if (
      ev === LogEvent.SPELL_AURA_REFRESH ||
      (opts.doseUnclean && ev === LogEvent.SPELL_AURA_APPLIED_DOSE)
    ) {
      const o = open.get(src);
      if (o) o.clean = false;
    } else if (ENDS.has(ev)) {
      // the builder's close: the row's own source first, else the oldest
      // open run of any source (a closing row's source is often not the
      // caster's — codex 85-tk-A-T18-2b #3); the run keeps its source
      const key = open.has(src) ? src : open.keys().next().value;
      if (key === undefined) continue;
      const o = open.get(key)!;
      open.delete(key);
      if (o.clean) out.push({ srcUnitId: key, fromMs: o.t, toMs: t });
    }
  }
  return out;
}
