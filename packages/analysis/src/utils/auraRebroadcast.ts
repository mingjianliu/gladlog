import { LogEvent } from "@gladlog/parser-compat";

/**
 * auraRebroadcast.ts -- the two row-level readings every aura consumer
 * filters through before pairing APPLIED / REMOVED: a re-broadcast pair is
 * one aura (`dropAuraRebroadcasts`), and a BROKEN line its REMOVED follows is
 * not the aura's end (`supersededAuraBreaks`). A leaf module (imports only
 * parser-compat) so `buffDuration.ts` can read them without the
 * buffDuration ↔ auraIntervals import cycle; `auraIntervals.ts` re-exports
 * them for its existing importers.
 */

/**
 * How far apart the REMOVED and the APPLIED of one re-broadcast can sit, in
 * the parsed (whole-millisecond) timestamps. The log writes four decimals, so
 * the two lines of one re-broadcast straddle a millisecond boundary about one
 * time in ten (f4da82c5: one Sleep Walk cast, REMOVED 10.1853 / APPLIED
 * 10.1863 — two `(0s)` CC lines and an extra DR step). Measured on the 60 raw
 * logs of the 2026-10-08 re-eval, REMOVED → APPLIED of one aura with no cast of
 * it in between, on players: 7,032 at 0 ms, 666 at 1 ms, 72 at 2–5 ms, then
 * 2,541 at 6–50 ms. Every CC among them is at 0 or 1 ms (Sleep Walk, Chaos
 * Nova, Void Nova, Oppressing Roar, Mighty Bash); the 2–5 ms band is poisons
 * and proc stacks re-applying, the band beyond it ground effects pulsing
 * (Consecration) — real ends and re-applications.
 */
export const AURA_REBROADCAST_GAP_MS = 1;

/**
 * An aura the game RE-BROADCASTS — `SPELL_AURA_REMOVED` and then
 * `SPELL_AURA_APPLIED` of the same spell, source and target within
 * `AURA_REBROADCAST_GAP_MS` (a Dracthyr visage swap, leaving stealth, Sleep
 * Walk's two phases) — is one continuous aura, not an end and a new press.
 * Reliability rounds 2–3 (W2e / N6: d78f a second CC, 3306 "Obsidian Scales
 * ended early", ba44 one Ironbark rendered as two); FT-T08 widened "the same
 * millisecond" to the gap above. Returns the events with every such
 * REMOVED/APPLIED pair dropped, order preserved. The one predicate every aura
 * consumer filters through.
 */
export function dropAuraRebroadcasts<
  T extends {
    spellId?: string | null;
    srcUnitId?: string;
    destUnitId?: string;
    timestamp: number;
    logLine: { event: string };
  },
>(
  events: readonly T[],
  /** a REMOVED → APPLIED pair this says is a NEW application is kept (the
   * control path: a recast its source logged — fact1215 112-1) */
  isNewApplication?: (removed: T, applied: T) => boolean,
): T[] {
  const key = (a: T) =>
    `${a.spellId}|${a.srcUnitId ?? ""}|${a.destUnitId ?? ""}`;
  // A rebroadcast is a REMOVED FOLLOWED BY an APPLIED (log order). An APPLIED
  // then a REMOVED at the same ms is a duplicate application and then the
  // real end — codex review of batch 9: Ironbark applied at 10 s, a duplicate
  // APPLIED and its actual REMOVED at 14 s read as [10, 22].
  const pendingRemoved = new Map<string, T[]>();
  const drop = new Set<T>();
  for (const a of events) {
    if (!a.spellId) continue;
    const k = key(a);
    if (a.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
      pendingRemoved.set(k, [...(pendingRemoved.get(k) ?? []), a]);
    } else if (a.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      // only a REMOVED no older than the gap is this APPLIED's other half.
      // One stamped AFTER this APPLIED (the log's timestamps step back now
      // and then) is not its half, but stays pending for the APPLIED that
      // follows it — codex post-hoc review of FT-T08 step 1.
      const pending = (pendingRemoved.get(k) ?? []).filter(
        (r) => a.timestamp - r.timestamp <= AURA_REBROADCAST_GAP_MS,
      );
      const at = pending.findIndex(
        (r) =>
          a.timestamp >= r.timestamp && !(isNewApplication?.(r, a) ?? false),
      );
      if (at >= 0) {
        drop.add(pending[at]!);
        drop.add(a);
        pending.splice(at, 1);
      }
      pendingRemoved.set(k, pending);
    }
  }
  return drop.size === 0 ? [...events] : events.filter((a) => !drop.has(a));
}

/**
 * How long after a `SPELL_AURA_BROKEN[_SPELL]` line the aura's own
 * `SPELL_AURA_REMOVED` can follow and still be that application's end.
 * Measured on the 60 raw logs of the 2026-10-08 re-eval, auras on players,
 * first BROKEN → REMOVED of the same aura (2,233 applications with a BROKEN
 * line): 1,597 within 1 ms and 313 more within 50 ms (a CC breaking — the
 * BROKEN line is the end, to within a frame), 27 within 250 ms, 296 between
 * 250 ms and 617 ms, none later. The late ones are three roots — Frost Nova
 * 122, Ice Nova 157997, the Water Elemental's Freeze 33395 — which log a
 * BROKEN_SPELL for each damaging hit (2.6 lines per application) and stay on
 * the target about half a second longer. 23 applications had a BROKEN and no
 * REMOVED before the aura's next APPLIED.
 */
export const AURA_BREAK_TO_REMOVED_MS = 1_000;

interface AuraBreakPairing {
  superseded: Set<unknown>;
  /** each REMOVED event → the BROKEN lines it superseded, in log order */
  before: Map<unknown, unknown[]>;
}
const auraBreakPairingCache = new WeakMap<object, AuraBreakPairing>();

function auraBreakPairing<
  T extends {
    spellId?: string | null;
    destUnitId?: string;
    timestamp: number;
    logLine: { event: string };
  },
>(events: readonly T[]): AuraBreakPairing {
  const cached = auraBreakPairingCache.get(events);
  if (cached) return cached;
  const pending = new Map<string, T[]>();
  const pairing: AuraBreakPairing = {
    superseded: new Set(),
    before: new Map(),
  };
  for (const a of events) {
    if (!a.spellId) continue;
    const ev = a.logLine.event;
    const k = `${a.spellId}|${a.destUnitId ?? ""}`;
    if (
      ev === LogEvent.SPELL_AURA_BROKEN ||
      ev === LogEvent.SPELL_AURA_BROKEN_SPELL
    ) {
      pending.set(k, [...(pending.get(k) ?? []), a]);
    } else if (ev === LogEvent.SPELL_AURA_REMOVED) {
      const mine = (pending.get(k) ?? []).filter((b) => {
        const gap = a.timestamp - b.timestamp;
        return gap >= 0 && gap <= AURA_BREAK_TO_REMOVED_MS;
      });
      for (const b of mine) pairing.superseded.add(b);
      if (mine.length > 0) pairing.before.set(a, mine);
      pending.delete(k);
    } else if (ev === LogEvent.SPELL_AURA_APPLIED) {
      pending.delete(k);
    }
  }
  auraBreakPairingCache.set(events, pairing);
  return pairing;
}

/**
 * The BROKEN / BROKEN_SPELL events that are NOT their aura's end: the aura's
 * own REMOVED follows on the same unit within `AURA_BREAK_TO_REMOVED_MS`, with
 * no APPLIED of it in between. An aura ends at its REMOVED; a BROKEN line says
 * what broke it (FT-T08 step 2). A BROKEN with no REMOVED after it stays the
 * end — the log lost the REMOVED line.
 *
 * Keyed by spell and target only: a BROKEN line's source is the breaker, not
 * the aura's caster. Memoised on the events array (callers pass a unit's own
 * `auraEvents`, some once per window).
 */
export function supersededAuraBreaks<
  T extends {
    spellId?: string | null;
    destUnitId?: string;
    timestamp: number;
    logLine: { event: string };
  },
>(events: readonly T[]): ReadonlySet<T> {
  return auraBreakPairing(events).superseded as ReadonlySet<T>;
}

/**
 * For a REMOVED event, the BROKEN / BROKEN_SPELL lines of the same aura on
 * the same unit that it superseded (`supersededAuraBreaks`), in log order —
 * what hit the aura before it ended. Empty when the aura simply ended. Tied
 * to that one REMOVED event: a reader that carries "this removal was a
 * break" over from the skipped BROKEN line reads it here, never from a flag
 * of its own (a per-spell flag leaks into the next application when a filter
 * drops the REMOVED it was meant for).
 */
export function auraBreaksBeforeRemoved<
  T extends {
    spellId?: string | null;
    destUnitId?: string;
    timestamp: number;
    logLine: { event: string };
  },
>(events: readonly T[], removed: T): readonly T[] {
  return (auraBreakPairing(events).before.get(removed) ?? []) as T[];
}

/** `events` without the BROKEN lines that are not their aura's end
 * (`supersededAuraBreaks`) — for a reader that closes an aura on REMOVED /
 * BROKEN / BROKEN_SPELL. A reader that wants to know WHAT broke an aura
 * reads the unfiltered events. */
export function dropSupersededAuraBreaks<
  T extends {
    spellId?: string | null;
    destUnitId?: string;
    timestamp: number;
    logLine: { event: string };
  },
>(events: readonly T[]): T[] {
  const superseded = supersededAuraBreaks(events);
  return superseded.size === 0
    ? [...events]
    : events.filter((a) => !superseded.has(a));
}
