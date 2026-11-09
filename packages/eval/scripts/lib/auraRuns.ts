/**
 * Clean aura lifetimes read the way the product reads an aura (GH #175,
 * codex B25 #3): rows through `dropAuraRebroadcasts` (a REMOVED → APPLIED
 * re-broadcast is one run), then continuous runs per source in log order —
 * an APPLIED while that source's run is open is a duplicate row of it, a
 * REFRESH makes the run unclean, a REMOVED / BROKEN ends it. Only clean,
 * ended runs come back. `buffDurationScan --per-app` reads these.
 */
import { dropAuraRebroadcasts } from "@gladlog/analysis/src/utils/auraIntervals";
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
export function cleanAuraRuns(rows: readonly IAuraRunRow[]): ICleanAuraRun[] {
  const out: ICleanAuraRun[] = [];
  const open = new Map<string, { t: number; clean: boolean }>();
  for (const a of dropAuraRebroadcasts(rows)) {
    const src = a.srcUnitId ?? "";
    const ev = a.logLine.event;
    const t = a.logLine.timestamp;
    if (ev === LogEvent.SPELL_AURA_APPLIED) {
      if (!open.has(src)) open.set(src, { t, clean: true });
    } else if (ev === LogEvent.SPELL_AURA_REFRESH) {
      const o = open.get(src);
      if (o) o.clean = false;
    } else if (ENDS.has(ev)) {
      const o = open.get(src);
      open.delete(src);
      if (o?.clean) out.push({ srcUnitId: src, fromMs: o.t, toMs: t });
    }
  }
  return out;
}
