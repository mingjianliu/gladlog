import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { CC_DURATION_TALENT_MODIFIERS } from "../data/spellEffectData";
import { buffFullDurationForCaster } from "./buffDuration";
import type { CastParamCaster } from "./castParam";
import { ccFullDurationForCaster } from "./ccDuration";
// runtime-only use (inside buildAuraIntervals); drAnalysis → cooldowns →
// auraIntervals is a cycle, safe because no module-level code calls across it
import { CC_CAST_EFFECT_AURA } from "./drAnalysis";


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
function officialDurationS(
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
 * An aura the game RE-BROADCASTS — `SPELL_AURA_REMOVED` and `SPELL_AURA_APPLIED`
 * of the same spell, source and target in the same millisecond (a Dracthyr
 * visage swap, leaving stealth) — is one continuous aura, not an end and a new
 * press. Reliability rounds 2–3 (W2e / N6: d78f a second CC, 3306 "Obsidian
 * Scales ended early", ba44 one Ironbark rendered as two). Returns the events
 * with every such REMOVED/APPLIED pair dropped, order preserved. The one
 * predicate every aura consumer filters through.
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
    `${a.spellId}|${a.srcUnitId ?? ""}|${a.destUnitId ?? ""}|${a.timestamp}`;
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
      const r = pendingRemoved.get(k)?.shift();
      if (r) {
        drop.add(r);
        drop.add(a);
      }
    }
  }
  return drop.size === 0 ? [...events] : events.filter((a) => !drop.has(a));
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

  const events = dropAuraRebroadcasts(unit.auraEvents)
    .filter((a) => a.destUnitId === unit.id && a.spellId)
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
            (c.spellId === id ||
              (c.spellId !== undefined &&
                CC_CAST_EFFECT_AURA[c.spellId] === id)) &&
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
