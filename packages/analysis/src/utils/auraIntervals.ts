import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { CC_DURATION_TALENT_MODIFIERS } from "../data/spellEffectData";
import { buffFullDurationForCaster } from "./buffDuration";
import type { CastParamCaster } from "./castParam";
import { ccFullDurationForCaster } from "./ccDuration";
// runtime-only use (inside buildAuraIntervals); drAnalysis → cooldowns →
// auraIntervals is a cycle, safe because no module-level code calls across it
import { isCastOrEffect } from "../data/castEffectAuras";


/**
 * auraIntervals.ts -- aura interval sets (phase 4 item 4, the WoWAnalyzer Auras
 * pattern).
 *
 * Pairs the aura event stream on a unit (applied/dose/refresh/removed/broken)
 * into intervals, for every consumer that asks "when was this buff up" --
 * uptime bars, point-in-time queries, and so on. Single-source predicate: the
 * pairing logic exists only here.
 *
 * 2026-07-25 production fix (user reported "dashed lines starting at 0s and
 * lasting several minutes"):
 *  1) Opens are keyed by spellId+srcUnitId -- with a single key, the second
 *     APPLIED of the same spell from two sources (two priests' shields /
 *     multiple rune instances) was swallowed and its REMOVED found no open
 *     segment, producing a phantom 0->removeT dashed line (user measured 2802
 *     orphaned REMOVEDs over 10 matches: 萦绕符文 x876, Frostbolt x190).
 *     Closing tries the exact key first, then falls back to any key of the same
 *     spell.
 *  2) SPELL_AURA_APPLIED_DOSE also opens a segment (the first event of a
 *     stacking aura can be a DOSE).
 *  3) Inferred boundaries are **capped by the official duration**
 *     (spellEffectData.durationSeconds, official data): inferredStart backs up
 *     at most D seconds and inferredEnd extends at most D seconds -- Frostbolt
 *     (8s) can be dashed for at most 8 seconds, while the "already up before
 *     the pull" semantics of long buffs like Power Word: Fortitude / arena
 *     preparation are unaffected. No official duration -> previous behavior.
 *
 * Normalization trace: the inferredStart / inferredEnd flags are unchanged; the
 * renderer draws them as dashed.
 *
 * BACKLOG #28 fix (2026-08-15, double-close race): a CLOSE event
 * (REMOVED/BROKEN/BROKEN_SPELL) that finds no open interval for its spellId
 * used to be read unconditionally as "already up before the pull, this match
 * only saw it fall off" and backdated a phantom interval by the official
 * duration. WoW's combat log frequently reports the SAME real aura drop
 * through more than one of these three events in immediate succession (e.g.
 * BROKEN_SPELL then REMOVED 1ms later, with an unrelated/inconsistent src on
 * the second one) — the first CLOSE correctly consumes the real open
 * interval, and the second then hit the fallback branch and fabricated a
 * second interval overlapping the real one (confirmed repro: match
 * 76ea5f90, Freezing Trap/3355, real [168.075, 173.421] vs phantom
 * [167.422, 173.422], both covering t=170). Fix: a CLOSE event that would
 * hit the fallback branch is instead treated as a redundant re-report of a
 * real drop (dropped, no interval emitted) when the same spellId had ANY
 * emitted CLOSE (real pairing or an earlier fallback) within
 * `DUPLICATE_CLOSE_WINDOW_S` of the current event — see
 * `lastCloseToSBySpellId` below. Threshold chosen from a corpus-wide gap
 * histogram (`auraDoubleCloseScan.ts`): true duplicate-report gaps cluster
 * far below 1s (log-adjacent events), while genuine independent falls of
 * the same spellId are seconds to minutes apart, so 1s has wide margin on
 * both sides without needing to be shaved closer to the observed cluster.
 */

export interface IAuraInterval {
  spellId: string;
  /** Consumers resolve the English name via getEnglishSpellName; this stores
   * the raw log text. */
  spellName: string;
  srcUnitName: string;
  fromS: number;
  toS: number;
  inferredStart: boolean;
  inferredEnd: boolean;
}

const CLOSE_EVENTS = new Set<string>([
  LogEvent.SPELL_AURA_REMOVED,
  LogEvent.SPELL_AURA_BROKEN,
  LogEvent.SPELL_AURA_BROKEN_SPELL,
]);

const OPEN_EVENTS = new Set<string>([
  LogEvent.SPELL_AURA_APPLIED,
  "SPELL_AURA_APPLIED_DOSE",
]);

/**
 * Official aura duration in seconds AS CAST BY `caster`; no data -> null (no
 * cap). Single predicate (`buffFullDurationForCaster`, 2026-09-06) so the
 * override layer and the caster's talent ranks reach this cap too.
 *
 * This cap is not a rare path: measured over the 227-file log archive, **11.0 %
 * of all applications of the currently-registered ids never produce a
 * SPELL_AURA_REMOVED** (91,045 applications, 9,986 unclosed) — Shadow Word:
 * Pain 13.7 %, Deep Wounds 11.3 %, Tiger's Fury 16.9 %. Every one of those
 * intervals is closed by this number, so a caster whose talents lengthen the
 * aura had it truncated (SW:P capped at 16 s instead of 20 s on 4,162
 * intervals). Passing no `castersById` keeps the previous no-caster answer.
 */
export function officialDurationS(
  spellId: string,
  caster:
    | (Pick<ICombatUnit, "spec" | "info" | "spellCastEvents"> &
        CastParamCaster)
    | undefined,
  /** The cap's anchor time — lets a cast-parameter aura (empower level, combo
   * points; GH #65 item 1) be priced by the cast that produced it. */
  atMs?: number,
): number | null {
  // A CC aura is priced by the CC predicate (its talent table —
  // Boneshaker, Resonant Voice, Tar-Coated Bindings — lives there, and the
  // buff predicate never reads it); talent impact audit 2026-09-26.
  const d = CC_DURATION_TALENT_MODIFIERS[spellId]
    ? ccFullDurationForCaster(spellId, caster)
    : buffFullDurationForCaster(spellId, caster, atMs);
  return typeof d === "number" && d > 0 ? d : null;
}

/** BACKLOG #28: a CLOSE event for a spellId with no open interval, arriving
 * within this many seconds of the most recently emitted CLOSE for the same
 * spellId (any source), is a redundant re-report of that same real drop, not
 * a second occurrence — see the module header for the corpus-measured
 * justification. */
export const DUPLICATE_CLOSE_WINDOW_S = 1;

/**
 * Interval set for every aura on this unit (dest = this unit), sorted by
 * ascending fromS.
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
>(events: readonly T[]): T[] {
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
      const at = pending.findIndex((r) => a.timestamp >= r.timestamp);
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
  const pairing: AuraBreakPairing = { superseded: new Set(), before: new Map() };
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

export function buildAuraIntervals(
  unit: ICombatUnit,
  combat: {
    startTime: number;
    endTime: number;
    /** When the combat carries its units (every AtomicArenaCombat does) and
     * no `castersById` is passed, the aura's source is looked up here. */
    units?: Readonly<Record<string, ICombatUnit>>;
  },
  /**
   * Optional unitId → unit lookup for the aura's SOURCE, used only to price
   * talent-lengthened durations at the cap above. Omitted, it is built from
   * `combat.units` (talent impact audit 2026-09-26: 13 callers passed none,
   * so Ironbark capped at 12 s instead of 16, Overpowered Barrier at 60
   * instead of 4); with neither, every cap is the no-caster duration.
   */
  castersById?: ReadonlyMap<
    string,
    Pick<ICombatUnit, "spec" | "info" | "spellCastEvents"> & CastParamCaster
  >,
): IAuraInterval[] {
  const casters =
    castersById ??
    (combat.units
      ? new Map(Object.values(combat.units).map((u) => [u.id, u]))
      : undefined);
  const casterOf = (srcUnitId: string | undefined) =>
    srcUnitId ? casters?.get(srcUnitId) : undefined;
  const durationS = (combat.endTime - combat.startTime) / 1000;
  const rel = (ts: number) =>
    Math.min(durationS, Math.max(0, (ts - combat.startTime) / 1000));

  interface Open {
    fromS: number;
    /** 最后一次 APPLIED/REFRESH/DOSE 的时刻 —— 官方时长封顶的锚点(2026-08-21
     * 防伪规则上移,见下)。 */
    lastSeenS: number;
    inferredStart: boolean;
    spellName: string;
    srcUnitName: string;
  }
  const open = new Map<string, Open>();
  const keyOf = (spellId: string, srcUnitId: string) =>
    `${spellId}:${srcUnitId}`;
  const out: IAuraInterval[] = [];
  // BACKLOG #28: most recent emitted-CLOSE instant per spellId (any source),
  // whether from a real pairing or an earlier fallback — see module header.
  const lastCloseToSBySpellId = new Map<string, number>();

  // a BROKEN line its aura's own REMOVED follows is not the end (FT-T08)
  const notTheEnd = supersededAuraBreaks(unit.auraEvents);
  const events = dropAuraRebroadcasts(unit.auraEvents)
    .filter((a) => a.destUnitId === unit.id && a.spellId && !notTheEnd.has(a))
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const a of events) {
    const id = a.spellId!;
    const key = keyOf(id, a.srcUnitId ?? "");
    const ev = a.logLine.event as string;
    if (OPEN_EVENTS.has(ev)) {
      const existing = open.get(key);
      const t = rel(a.timestamp);
      // A second APPLIED while open, with NO cast of the spell by its source
      // around it and still inside the first application's official
      // duration, is the aura re-broadcast on leaving stealth (be83: Cloak
      // re-applied after Vanish with no REMOVED between) — the same aura,
      // not a new press. Undecidable without the caster's casts or an
      // official duration: then the anti-artifact split below stands.
      const caster = casterOf(a.srcUnitId);
      const dOpen = existing
        ? officialDurationS(
            id,
            caster,
            combat.startTime + existing.lastSeenS * 1000,
          )
        : null;
      const rebroadcast =
        existing !== undefined &&
        ev === LogEvent.SPELL_AURA_APPLIED &&
        caster !== undefined &&
        dOpen !== null &&
        t <= existing.lastSeenS + dOpen &&
        !(caster.spellCastEvents ?? []).some(
          (c) =>
            // Fear casts 5782 and applies 118699 (codex review of batch 9:
            // a real second Fear was swallowed as a rebroadcast)
            c.spellId !== undefined &&
            isCastOrEffect(c.spellId, id) &&
            Math.abs(c.logLine.timestamp - a.timestamp) <= 1000,
        );
      if (rebroadcast) {
        // keep the interval open; its duration cap stays anchored where it was
      } else if (existing && ev === LogEvent.SPELL_AURA_APPLIED) {
        // 2026-08-21 防伪规则(自 utils.buildFilteredAuraIntervals 上移,
        // GH #17 burst-into-immunity 伪影追查):同 key 再次 **APPLIED** =
        // 上一段已无声掉落(REMOVED 缺失)→ 按官方时长封顶关旧、另开新。
        // 修复前后来的 REMOVED 会配给最初的 APPLIED —— 实测一个 REMOVED
        // 缺失 + 重新施放的 5s 暗影斗篷被拼成 130s 区间。DOSE 是叠层、
        // REFRESH 是续时,都不重开 —— 只挪封顶锚(lastSeenS)。
        const d = officialDurationS(
          id,
          casterOf(a.srcUnitId),
          combat.startTime + existing.lastSeenS * 1000,
        );
        out.push({
          spellId: id,
          spellName: existing.spellName,
          srcUnitName: existing.srcUnitName,
          fromS: existing.fromS,
          toS: d === null ? t : Math.min(t, existing.lastSeenS + d),
          inferredStart: existing.inferredStart,
          inferredEnd: true,
        });
        open.set(key, {
          fromS: t,
          lastSeenS: t,
          inferredStart: false,
          spellName: a.spellName ?? existing.spellName,
          srcUnitName: a.srcUnitName,
        });
      } else if (existing) {
        existing.lastSeenS = t; // DOSE 叠层:活动证据,只挪封顶锚
      } else {
        open.set(key, {
          fromS: t,
          lastSeenS: t,
          inferredStart: false,
          spellName: a.spellName ?? "",
          srcUnitName: a.srcUnitName,
        });
      }
    } else if (ev === LogEvent.SPELL_AURA_REFRESH) {
      const existing = open.get(key);
      const t = rel(a.timestamp);
      if (existing) {
        existing.lastSeenS = t; // 续时:同段延长,挪封顶锚
      } else {
        // Already up but no APPLIED was seen: back up by at most the official
        // duration
        const d = officialDurationS(id, casterOf(a.srcUnitId));
        open.set(key, {
          fromS: d === null ? 0 : Math.max(0, t - d),
          lastSeenS: t,
          inferredStart: true,
          spellName: a.spellName ?? "",
          srcUnitName: a.srcUnitName,
        });
      }
    } else if (CLOSE_EVENTS.has(ev)) {
      // Closing: exact key first, then fall back to any source of the same
      // spell (a REMOVED's src is often inconsistent with / missing from the
      // APPLIED, which must not be read as "already up before the pull")
      let hitKey: string | null = open.has(key) ? key : null;
      if (hitKey === null) {
        for (const k of open.keys())
          if (k.startsWith(`${id}:`)) {
            hitKey = k;
            break;
          }
      }
      const o = hitKey === null ? undefined : open.get(hitKey);
      if (o && hitKey !== null) {
        open.delete(hitKey);
        const toS = rel(a.timestamp);
        out.push({
          spellId: id,
          spellName: o.spellName,
          srcUnitName: o.srcUnitName,
          fromS: o.fromS,
          toS,
          inferredStart: o.inferredStart,
          inferredEnd: false,
        });
        lastCloseToSBySpellId.set(id, toS);
      } else {
        // No open interval for this spellId. Two readings compete here:
        // (a) genuinely "already up before the pull, this match only saw it
        //     fall off once" -- back up by at most the official duration; or
        // (b) a redundant re-report of a real drop this loop JUST closed
        //     (BACKLOG #28: WoW's log often fires more than one of
        //     REMOVED/BROKEN/BROKEN_SPELL for the same drop, sometimes with
        //     an inconsistent src on the later one) -- discard, no interval.
        // Distinguish by recency: (b) arrives within DUPLICATE_CLOSE_WINDOW_S
        // of the last CLOSE this spellId emitted; (a) has no prior CLOSE at
        // all, or one far enough back that it must be a separate occurrence.
        const t = rel(a.timestamp);
        const priorCloseToS = lastCloseToSBySpellId.get(id);
        const isDuplicateReport =
          priorCloseToS !== undefined &&
          t - priorCloseToS <= DUPLICATE_CLOSE_WINDOW_S;
        if (!isDuplicateReport) {
          const d = officialDurationS(id, casterOf(a.srcUnitId));
          out.push({
            spellId: id,
            spellName: a.spellName ?? "",
            srcUnitName: a.srcUnitName,
            fromS: d === null ? 0 : Math.max(0, t - d),
            toS: t,
            inferredStart: true,
            inferredEnd: false,
          });
        }
        lastCloseToSBySpellId.set(id, t);
      }
    }
  }

  for (const [key, o] of open) {
    const id = key.slice(0, key.indexOf(":"));
    const srcUnitId = key.slice(key.indexOf(":") + 1);
    // No REMOVED seen: extend by at most the official duration (short auras no
    // longer stay dashed all the way to the end of the match). 封顶锚在
    // lastSeenS(REFRESH/DOSE 续时后从最后一次活动起算,2026-08-21)。
    const d = officialDurationS(
      id,
      casterOf(srcUnitId),
      combat.startTime + o.lastSeenS * 1000,
    );
    out.push({
      spellId: id,
      spellName: o.spellName,
      srcUnitName: o.srcUnitName,
      fromS: o.fromS,
      toS: d === null ? durationS : Math.min(durationS, o.lastSeenS + d),
      inferredStart: o.inferredStart,
      inferredEnd: true,
    });
  }

  return out.sort(
    (a, b) => a.fromS - b.fromS || a.spellId.localeCompare(b.spellId),
  );
}
