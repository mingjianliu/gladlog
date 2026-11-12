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
import { sourcePressedAuraNear } from "@gladlog/analysis/src/data/castEffectAuras";
import {
  dropAuraRebroadcasts,
  supersededAuraBreaks,
} from "@gladlog/analysis/src/utils/auraIntervals";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
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
     * source logged a cast of it there — `sourcePressedAuraNear` — or it
     * came past the open run's official length: `buildAuraIntervals`'
     * split): the open run lost its REMOVED and is dropped, a run starts
     * (codex 85-tk-A-T18-2b #1, -2d #2). `anchorMs` is the builder's
     * duration anchor: the open run's APPLIED, moved by every REFRESH and
     * APPLIED_DOSE since (codex 85-tk-A-T18-2e #1) */
    isNewApplication?: (applied: IAuraRunRow, anchorMs: number) => boolean;
  } = {},
): ICleanAuraRun[] {
  const out: ICleanAuraRun[] = [];
  // insertion order = oldest open run first
  const open = new Map<string, { t: number; anchor: number; clean: boolean }>();
  const notTheEnd = supersededAuraBreaks(rows);
  for (const a of dropAuraRebroadcasts(rows)) {
    if (notTheEnd.has(a)) continue;
    const src = a.srcUnitId ?? "";
    const ev = a.logLine.event;
    const t = a.logLine.timestamp;
    if (ev === LogEvent.SPELL_AURA_APPLIED) {
      if (!open.has(src)) open.set(src, { t, anchor: t, clean: true });
      // replaced in place, as the builder's `Map.set` does: the run keeps
      // its place in the oldest-open fallback (codex 85-tk-A-T18-2c #2)
      else if (opts.isNewApplication?.(a, open.get(src)!.anchor))
        open.set(src, { t, anchor: t, clean: true });
    } else if (
      ev === LogEvent.SPELL_AURA_REFRESH ||
      ev === LogEvent.SPELL_AURA_APPLIED_DOSE
    ) {
      // the builder moves its duration anchor on both; a REFRESH (and, with
      // `doseUnclean`, a DOSE) leaves the lifetime no clean sample
      const o = open.get(src);
      if (!o) continue;
      o.anchor = t;
      if (ev === LogEvent.SPELL_AURA_REFRESH || opts.doseUnclean)
        o.clean = false;
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

/** `cleanAuraRuns`' `isNewApplication` as the builder splits a re-APPLIED:
 * its source pressed the aura there, or it came past the open copy's
 * official length (codex 85-tk-A-T18-2d #2). One definition for every scan
 * that reads clean runs (`buffDurationScan --per-app`, scan5/t48). */
export function builderNewApplication(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy parse objects
  units: Record<string, any>,
  spellId: string,
): (applied: IAuraRunRow, anchorMs: number) => boolean {
  return (a, anchorMs) => {
    const src = units[a.srcUnitId ?? ""];
    if (
      sourcePressedAuraNear(
        src?.spellCastEvents ?? [],
        spellId,
        a.logLine.timestamp,
      )
    )
      return true;
    const d = buffFullDurationForCaster(spellId, src, anchorMs);
    return d !== undefined && a.logLine.timestamp > anchorMs + d * 1000;
  };
}

/** The player behind an aura's source: the source itself, or its owner when
 * the source is a summon — a totem's or a demon's aura is its owner's cast
 * (T76, GH #123: Healing Stream 5672, the Dominion of Argus demons and
 * Lunar Beam read "0 cells" on every season rescan because their source has
 * no loadout). `talentDurationVerify.ts`'s `casterOf` reads the same owner. */
export function casterUnitOf<U extends { info?: unknown; ownerId?: string }>(
  units: Record<string, U>,
  srcUnitId: string | undefined,
): U | undefined {
  const src = units[srcUnitId ?? ""];
  if (src?.info) return src;
  return src?.ownerId ? units[src.ownerId] : src;
}
