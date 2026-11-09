import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

// runtime-only use (inside buildAuraIntervals); drAnalysis → cooldowns →
// auraIntervals is a cycle, safe because no module-level code calls across it
import { castsOfEffectAura, isCastOrEffect } from "../data/castEffectAuras";
import { analysisDataReady } from "../data/ensure";
import { CC_DURATION_TALENT_MODIFIERS } from "../data/spellEffectData";
import { dropAuraRebroadcasts, supersededAuraBreaks } from "./auraRebroadcast";
import { buffFullDurationForCaster } from "./buffDuration";
import type { CastParamCaster } from "./castParam";
import { ccFullDurationForCaster } from "./ccDuration";
import { isResyncBatchAt, lowerBound } from "./hiddenPress";
import { TOUCH_OF_KARMA_ABSORB_ID, TOUCH_OF_KARMA_ID } from "./karmaFeed";

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
  srcUnitId?: string;
  fromS: number;
  toS: number;
  inferredStart: boolean;
  inferredEnd: boolean;
  /** The row that closed it (REMOVED / BROKEN), when one did: what was
   * logged in its millisecond BEFORE it happened under the aura (fact9 D2,
   * 03cba5ac 2:09: a Shadow Word: Madness tick under Time Dilation, logged
   * just before the removal). A removal that is the holder's death
   * teardown closes past the lethal hit (`auraCloseRow`).
   * `externalDamageForApplication` reads it. */
  toRow?: { ms: number; lineIndex: number };
}

/**
 * The closing row of an aura its `removed` row ends on `holder`: rows of
 * that millisecond logged before it happened under the aura (fact9 D2). One
 * exception, the death teardown (fact12 D31, f13566f0 r0 11:51:37.841): the
 * game strips the dying unit's auras FIRST and writes the hit that killed it
 * after them in the same millisecond — the Obsidian Scales copy's REMOVED,
 * twenty more removals, PARTY_KILL, then the Bladestorm SPELL_DAMAGE with
 * overkill. That blow landed under the aura, so a damage row on the holder
 * with overkill > 0 logged after the removal in its millisecond moves the
 * close past it. The one predicate of `buildAuraIntervals`' `toRow` and of
 * scan5 damageBasis's during-it windows.
 */
export function auraCloseRow(
  removed: { timestamp: number; lineIndex?: number },
  holder: {
    damageIn?: ReadonlyArray<{
      overkill?: number;
      logLine: { timestamp: number; lineIndex?: number };
    }>;
  },
): { ms: number; lineIndex: number } | undefined {
  const ix = removed.lineIndex;
  if (ix === undefined) return undefined;
  let close = ix;
  for (const d of holder.damageIn ?? []) {
    const li = d.logLine.lineIndex;
    if (
      (d.overkill ?? 0) > 0 &&
      d.logLine.timestamp === removed.timestamp &&
      li !== undefined &&
      li > close
    )
      close = li + 1;
  }
  return { ms: removed.timestamp, lineIndex: close };
}

/** `toRow` of an interval this row closes on `holder` */
function closeRowOf(
  a: { logLine: { timestamp: number; lineIndex?: number } },
  holder: Parameters<typeof auraCloseRow>[1],
): Pick<IAuraInterval, "toRow"> {
  const toRow = auraCloseRow(a.logLine, holder);
  return toRow ? { toRow } : {};
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
    | (Pick<ICombatUnit, "spec" | "info" | "spellCastEvents"> & CastParamCaster)
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
export {
  AURA_BREAK_TO_REMOVED_MS,
  AURA_REBROADCAST_GAP_MS,
  auraBreaksBeforeRemoved,
  dropAuraRebroadcasts,
  dropSupersededAuraBreaks,
  supersededAuraBreaks,
} from "./auraRebroadcast";

/** @internal The reading itself; exported for test/auraIntervalsMemo.test.ts,
 * which holds the memoised `buildAuraIntervals` to it. Product code calls
 * `buildAuraIntervals`. */
/** fact9 D19 / codex 20-F24-13 #1: how far an aura's REMOVED may sit from
 * its press + official length and still show it went up at that press. */
export const RESTATED_END_TOLERANCE_MS = 250;

type SpellRows = ReadonlyArray<{
  spellId?: string | null;
  logLine: { timestamp: number };
}>;
type AuraRows = NonNullable<ICombatUnit["auraEvents"]>;

/** Performance only (2026-11-03 first-paint regression, with
 * `isResyncBatchAt`): `restatedAuraWasUp` scanned the holder's whole
 * damage / heal / absorb / aura streams for every re-stated APPLIED. These
 * index them once per array (rebuilt when its length changes);
 * `test/restatedIndex.test.ts` holds the indexed reading to
 * the plain scan. */
const spellRowMsCache = new WeakMap<
  object,
  { len: number; bySpell: Map<string, number[]> }
>();
function spellRowMs(rows: SpellRows): Map<string, number[]> {
  const hit = spellRowMsCache.get(rows);
  if (hit && hit.len === rows.length) return hit.bySpell;
  const bySpell = new Map<string, number[]>();
  for (const x of rows) {
    if (!x.spellId || !Number.isFinite(x.logLine.timestamp)) continue;
    let at = bySpell.get(x.spellId);
    if (!at) bySpell.set(x.spellId, (at = []));
    at.push(x.logLine.timestamp);
  }
  for (const at of bySpell.values()) at.sort((a, b) => a - b);
  spellRowMsCache.set(rows, { len: rows.length, bySpell });
  return bySpell;
}
const removedRowsCache = new WeakMap<
  object,
  { len: number; bySpell: Map<string, AuraRows> }
>();
function removedRowsBySpell(rows: AuraRows): Map<string, AuraRows> {
  const hit = removedRowsCache.get(rows);
  if (hit && hit.len === rows.length) return hit.bySpell;
  const bySpell = new Map<string, AuraRows>();
  for (const x of rows) {
    if (!x.spellId || x.logLine.event !== LogEvent.SPELL_AURA_REMOVED) continue;
    let list = bySpell.get(x.spellId);
    if (!list) bySpell.set(x.spellId, (list = []));
    list.push(x);
  }
  removedRowsCache.set(rows, { len: rows.length, bySpell });
  return bySpell;
}

/**
 * Does the log show a re-stated aura up before its batch, from the press at
 * `pressMs`? Either a row of the aura's own spell on the holder between the
 * press and the batch — a hit its shield absorbed, a heal or a tick of it
 * (Life Cocoon absorbing a hit at 87.02 before the batch at 87.45) — or its
 * REMOVED at the press plus its official length (`d` s, within
 * `RESTATED_END_TOLERANCE_MS`: an Obsidian Scales copy re-stated 0.36 s
 * late, REMOVED 12.0 s after the press). A projectile's control lands after
 * its travel and shows neither.
 */
export function restatedAuraWasUp(
  unit: Pick<ICombatUnit, "absorbsIn" | "healIn" | "damageIn" | "auraEvents">,
  applied: { spellId?: string; srcUnitId: string; timestamp: number },
  pressMs: number,
  d: number,
): boolean {
  const id = applied.spellId;
  if (!id) return false;
  // a row of the spell in [pressMs, applied)
  const between = (ms: number) => ms >= pressMs && ms < applied.timestamp;
  // the index holds finite instants only, and between finite bounds no
  // other row can pass; non-finite bounds read the plain scan (codex
  // 20-F24-17 #2)
  const finite = Number.isFinite(pressMs) && Number.isFinite(applied.timestamp);
  const rowBetween = (rows: SpellRows | undefined) => {
    if (!rows) return false;
    if (!finite)
      return rows.some((x) => x.spellId === id && between(x.logLine.timestamp));
    const at = spellRowMs(rows).get(id);
    if (!at) return false;
    const i = lowerBound(at, pressMs);
    return i < at.length && between(at[i]!);
  };
  if (
    rowBetween(unit.absorbsIn) ||
    rowBetween(unit.healIn) ||
    rowBetween(unit.damageIn)
  )
    return true;
  // the first such REMOVED in stream order, as `find` read it
  const removed = (
    unit.auraEvents ? removedRowsBySpell(unit.auraEvents).get(id) : undefined
  )?.find(
    (x) =>
      x.srcUnitId === applied.srcUnitId &&
      x.logLine.timestamp > applied.timestamp,
  );
  return (
    !!removed &&
    Math.abs(removed.logLine.timestamp - pressMs - d * 1000) <=
      RESTATED_END_TOLERANCE_MS
  );
}

export function buildAuraIntervalsUncached(
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
  /** the holder's WHOLE aura stream, when `unit.auraEvents` is a filtered
   * one: the re-stating batch test (`isResyncBatchAt`) counts every APPLIED
   * on the holder (codex 20-F24-13 #2: an offensive-aura or DoT stream
   * holds too few rows to see a batch, and the two readers disagreed) */
  resyncRows?: ICombatUnit["auraEvents"],
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
    srcUnitId?: string;
  }
  const open = new Map<string, Open>();
  const keyOf = (spellId: string, srcUnitId: string) =>
    `${spellId}:${srcUnitId}`;
  const out: IAuraInterval[] = [];
  // BACKLOG #28: most recent emitted-CLOSE instant per spellId (any source),
  // whether from a real pairing or an earlier fallback — see module header.
  const lastCloseToSBySpellId = new Map<string, number>();

  /** fact9 D19: the round second of the press a re-stated APPLIED stands
   * for — its source's SUCCESS of the aura (or its cast) on this unit,
   * the latest before the batch, inside the aura's official length and
   * after the spell's last close on this unit — when the log shows the aura
   * was up before the batch (`restatedAuraWasUp`); undefined when the row
   * is no re-statement, no such press is logged, or nothing shows it up
   * then (a projectile's effect lands late — codex 20-F24-13 #1: Storm
   * Bolt's stun in a batch 0.8 s after the cast keeps its own instant). */
  const restatedPressS = (
    a: NonNullable<ICombatUnit["auraEvents"]>[number],
    t: number,
    lastCloseS: number | undefined,
  ): number | undefined => {
    const id = a.spellId!;
    const caster = casterOf(a.srcUnitId);
    if (
      !caster ||
      !isResyncBatchAt(
        { id: unit.id, auraEvents: resyncRows ?? unit.auraEvents },
        a.timestamp,
      )
    )
      return undefined;
    const d = officialDurationS(id, caster, a.timestamp);
    if (d === null) return undefined;
    let best: number | undefined;
    let bestMs = 0;
    for (const c of caster.spellCastEvents ?? []) {
      if (
        c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS ||
        c.destUnitId !== unit.id ||
        !c.spellId ||
        !isCastOrEffect(c.spellId, id)
      )
        continue;
      const s = rel(c.logLine.timestamp);
      if (
        c.logLine.timestamp < a.timestamp &&
        s >= t - d &&
        (lastCloseS === undefined || s >= lastCloseS) &&
        (best === undefined || s > best)
      ) {
        best = s;
        bestMs = c.logLine.timestamp;
      }
    }
    if (best === undefined) return undefined;
    return restatedAuraWasUp(unit, a, bestMs, d) ? best : undefined;
  };

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
          srcUnitId: existing.srcUnitId,
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
          srcUnitId: a.srcUnitId,
        });
      } else if (existing) {
        existing.lastSeenS = t; // DOSE 叠层:活动证据,只挪封顶锚
      } else {
        // fact9 D19 (5f992d25 1:26): an aura first shown inside a batch that
        // re-states its holder (`isResyncBatchAt` — the holder was unseen:
        // Vanish, stealth, out of range) went up at its source's logged
        // press of it ON this holder, not at the batch. Life Cocoon was cast
        // on a vanished rogue at 86.07, absorbed a hit at 87.02 and was
        // APPLIED in the rogue's re-stating batch at 87.45; its span read
        // 9.0 s from the batch and "pressed 4.3 s after the burst opened"
        // (2.9 s). The press is the latest one inside the aura's official
        // length before the batch and after this spell's last close here.
        const fromS =
          ev === LogEvent.SPELL_AURA_APPLIED
            ? restatedPressS(a, t, lastCloseToSBySpellId.get(id))
            : undefined;
        open.set(key, {
          fromS: fromS ?? t,
          lastSeenS: fromS ?? t,
          inferredStart: false,
          spellName: a.spellName ?? "",
          srcUnitName: a.srcUnitName,
          srcUnitId: a.srcUnitId,
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
          srcUnitId: a.srcUnitId,
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
          srcUnitId: o.srcUnitId,
          fromS: o.fromS,
          toS,
          inferredStart: o.inferredStart,
          inferredEnd: false,
          ...closeRowOf(a, unit),
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
            srcUnitId: a.srcUnitId,
            fromS: d === null ? 0 : Math.max(0, t - d),
            toS: t,
            inferredStart: true,
            inferredEnd: false,
            ...closeRowOf(a, unit),
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
      srcUnitId: o.srcUnitId,
      fromS: o.fromS,
      toS: d === null ? durationS : Math.min(durationS, o.lastSeenS + d),
      inferredStart: o.inferredStart,
      inferredEnd: true,
    });
  }

  out.sort((a, b) => a.fromS - b.fromS || a.spellId.localeCompare(b.spellId));
  // GH #136.3: a re-announced aura is one press for every reader
  const joined = joinReappliedIntervals(out, (_name, spellId, iv) => {
    const caster = casterOf(iv.srcUnitId);
    return caster
      ? pressSecondsOfAura(caster.spellCastEvents, spellId, combat.startTime)
      : undefined;
  });
  endKarmaAtItsShield(joined);
  return joined;
}

/** How close to an aura's start its cast is logged, either side. The same
 * pairing radius the external branch uses to tie a cast to its aura. */
export const SAVE_CAST_AURA_PAIR_S = 1.5;

/**
 * Enemy-def F-E12: a second `SPELL_AURA_APPLIED` of an aura that is still up,
 * with no `REMOVED` between, is the game re-announcing ONE press — not the
 * first one ending and a new one starting. `buildAuraIntervals` splits there
 * (its anti-artifact rule for a missed REMOVED followed by a real recast), so
 * the `[ENEMY DEF]` line read one Divine Shield as `(immune, 0.9s)` +
 * `(immune, 7.1s)` (f4eb8c87 2:47), one Guardian Spirit as `(1.6s)` +
 * `(10.4s — removed early)` (69546267 2:05), one Feign Death as three.
 *
 * Two back-to-back intervals of one spell from one source are the same press
 * unless the source logged a SECOND cast of that spell around them: a split
 * with at most one cast behind it (the one that opened the first interval,
 * or none for an aura that is never cast) is one press.
 *
 * GH #136.3: applied inside `buildAuraIntervals`, so every reader sees the
 * one press (it used to be joined only for `[ENEMY DEF]` and the burst
 * ledger's defensives-hit; the death-window mitigation audit,
 * `[STACKED DEFENSIVES]` and the other readers saw the two pieces). A split
 * whose source is not known (`castSecondsOf` returns undefined) stays split.
 */
export function joinReappliedIntervals(
  intervals: readonly IAuraInterval[],
  /** round seconds of the source's presses of `spellId`; undefined when the
   * source is unknown */
  castSecondsOf: (
    srcUnitName: string,
    spellId: string,
    iv: IAuraInterval,
  ) => readonly number[] | undefined,
): IAuraInterval[] {
  const out: IAuraInterval[] = [];
  const lastOf = new Map<string, IAuraInterval>();
  for (const iv of intervals) {
    const key = `${iv.spellId}:${iv.srcUnitName}`;
    const prev = lastOf.get(key);
    const casts =
      prev && prev.inferredEnd && Math.abs(prev.toS - iv.fromS) < 1e-6
        ? castSecondsOf(iv.srcUnitName, iv.spellId, iv)
        : undefined;
    const near = (t: number, at: number) =>
      Math.abs(t - at) <= SAVE_CAST_AURA_PAIR_S;
    if (
      prev &&
      casts !== undefined &&
      casts.filter(
        (t) =>
          t >= prev.fromS - SAVE_CAST_AURA_PAIR_S &&
          t <= iv.fromS + SAVE_CAST_AURA_PAIR_S,
      ).length <= 1 &&
      // the one cast is the press that opened the FIRST piece; one next to
      // the second APPLIED and not next to the first is a new press whose
      // REMOVED was missed (the first piece's cast unlogged)
      !casts.some((t) => near(t, iv.fromS) && !near(t, prev.fromS))
    ) {
      prev.toS = iv.toS;
      prev.inferredEnd = iv.inferredEnd;
      // the joined interval ends at the later one's closing row (codex
      // 20-F24-15 #3: fact9 D2's same-ms rows were lost on this path)
      if (iv.toRow) prev.toRow = iv.toRow;
      else delete prev.toRow;
      continue;
    }
    const copy = { ...iv };
    out.push(copy);
    lastOf.set(key, copy);
  }
  return out;
}

/** Two SUCCESS rows of one press under different ids of one aura — the
 * cast and its effect, logged together (Greater Invisibility: 110959 and
 * 110960 at the same ms or 1 ms apart). */
export const ALIAS_PRESS_TWIN_MS = 100;

/**
 * The round seconds of a source's presses of an aura: SUCCESS rows of the
 * aura's own id or of a cast whose effect it is (codex R6C-15 #2 / R6C-05
 * #1: Blur is cast as 198589 and runs as 212800 — its second press, a
 * same-ms REFRESH, was never split off the first), one per press: a row of
 * another of those ids within `ALIAS_PRESS_TWIN_MS` of a kept one is the
 * same press (F19 605 diff: Greater Invisibility's two rows read as two
 * casts kept `joinReappliedIntervals` from joining a re-announced aura —
 * two `[ENEMY DEF]` lines for one press).
 */
export function pressSecondsOfAura(
  casts: ICombatUnit["spellCastEvents"] | undefined,
  spellId: string,
  startTime: number,
): number[] {
  const ids = new Set([spellId, ...castsOfEffectAura(spellId)]);
  const rows = (casts ?? [])
    .filter(
      (c) =>
        c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        !!c.spellId &&
        ids.has(c.spellId),
    )
    .sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
  const out: number[] = [];
  let last: { ms: number; id: string } | null = null;
  for (const c of rows) {
    const ms = c.logLine.timestamp;
    if (last && c.spellId !== last.id && ms - last.ms <= ALIAS_PRESS_TWIN_MS)
      continue;
    out.push((ms - startTime) / 1000);
    last = { ms, id: c.spellId! };
  }
  return out;
}

/** How far from the Touch of Karma buff's APPLIED its shield aura may go up
 * and still be that press's — the log writes both in the cast's own ms. */
const KARMA_SHIELD_PAIR_S = 0.2;

/**
 * B2 (user 2026-10-24, 「全按建议」): Touch of Karma is up while its shield
 * is. The press puts two buffs on the monk — the cast id's 10 s marker
 * (`TOUCH_OF_KARMA_ID`), which stays its full length whatever happens to the
 * shield, and the absorb itself (`TOUCH_OF_KARMA_ABSORB_ID`), which leaves
 * when the shield does (2abc9185: eaten through 3.0 s in, the marker up to
 * 10.0 s). `[BUFF FADED]` already ended there (N4 F02a); every reader of the
 * intervals — `[STACKED DEFENSIVES]`, the burst ledger's "Target had a major
 * defensive up", the death block's mitigation audit — read the marker. Each
 * marker interval of the holder ends with the shield the same press put up,
 * when that ended first; a log with no shield aura keeps the marker's.
 */
function endKarmaAtItsShield(out: IAuraInterval[]): void {
  const shields = out.filter((iv) => iv.spellId === TOUCH_OF_KARMA_ABSORB_ID);
  if (shields.length === 0) return;
  for (const iv of out) {
    if (iv.spellId !== TOUCH_OF_KARMA_ID) continue;
    const shield = shields.find(
      (sh) =>
        sh.srcUnitName === iv.srcUnitName &&
        Math.abs(sh.fromS - iv.fromS) <= KARMA_SHIELD_PAIR_S,
    );
    if (!shield || shield.toS >= iv.toS) continue;
    iv.toS = shield.toS;
    iv.inferredEnd = shield.inferredEnd;
    if (shield.toRow) iv.toRow = shield.toRow;
    else delete iv.toRow;
  }
}

/**
 * One memo entry of `buildAuraIntervals`: the inputs the uncached reading
 * depends on, besides the aura stream the entry is keyed by. `castsFp` is
 * the casters' cast counts — a fixture that pushes a cast onto a caster
 * between two calls gets a fresh reading, not the first one.
 */
interface AuraIntervalsEntry {
  unitId: string;
  len: number;
  dmgLen: number;
  startTime: number;
  endTime: number;
  castsFp: number;
  result: IAuraInterval[];
}
const AURA_INTERVALS_ENTRIES_MAX = 8;
/** The casters key when a call has neither `castersById` nor `combat.units`. */
const NO_CASTERS: object = {};
/** aura stream → casters container → entries. A caller that builds a fresh
 * `castersById` every call (five do) gets its own short-lived list and
 * never pushes out another caller's entries (review of 698fc58). */
const auraIntervalsCache = new WeakMap<
  readonly unknown[],
  WeakMap<object, AuraIntervalsEntry[]>
>();

/**
 * `buildAuraIntervals`, memoised. Twenty call sites in nineteen files rebuild
 * the same unit's intervals inside one analysis (the timeline's control
 * lines, the kill windows, the crisis and burst engines, the kick audit …);
 * measured on the real-match fixture, the uncached reading plus
 * `dropAuraRebroadcasts` was about a third of the pipeline's CPU. The memo is
 * keyed by the unit's `auraEvents` array (the same object
 * `supersededAuraBreaks` keys its own cache by) and holds the other inputs the
 * reading depends on: the unit id, the stream's length, the combat window, the
 * casters container (`castersById`, else `combat.units`) and the casters'
 * cast counts. A call made before the analysis data is ready is never cached
 * (an official duration read then could differ from the one read after).
 * Callers get a fresh array each time; the interval objects are shared, and
 * no consumer writes to one (the call sites were read for that).
 *
 * The limit, as the 2026-10-17 review states it: a caster's `spec`, `info`
 * (talents), `empowerEnds` / `advancedActions` or the CONTENT of its
 * `spellCastEvents`, and an aura event's fields, are not in the key. No
 * product code writes them after the parse (checked by grep); a test that
 * changes one in place between two readings of the same stream gets the
 * first reading — build a new unit or a new `auraEvents` array instead.
 */
export function buildAuraIntervals(
  unit: ICombatUnit,
  combat: {
    startTime: number;
    endTime: number;
    units?: Readonly<Record<string, ICombatUnit>>;
  },
  castersById?: ReadonlyMap<
    string,
    Pick<ICombatUnit, "spec" | "info" | "spellCastEvents"> & CastParamCaster
  >,
  /** see `buildAuraIntervalsUncached`; a call that passes it is not cached
   * (its stream is a filtered copy, never the same array twice) */
  resyncRows?: ICombatUnit["auraEvents"],
): IAuraInterval[] {
  const events = unit.auraEvents;
  if (!events || !analysisDataReady() || resyncRows)
    return buildAuraIntervalsUncached(unit, combat, castersById, resyncRows);
  const casters: object = castersById ?? combat.units ?? NO_CASTERS;
  let castsFp = 0;
  if (castersById)
    for (const c of castersById.values())
      castsFp += c.spellCastEvents?.length ?? 0;
  else if (combat.units)
    for (const c of Object.values(combat.units))
      castsFp += c.spellCastEvents?.length ?? 0;
  let byCasters = auraIntervalsCache.get(events);
  if (!byCasters) {
    byCasters = new WeakMap();
    auraIntervalsCache.set(events, byCasters);
  }
  let entries = byCasters.get(casters);
  if (!entries) {
    entries = [];
    byCasters.set(casters, entries);
  }
  // the close rows read the holder's killing blows (`auraCloseRow`)
  const dmgLen = unit.damageIn?.length ?? -1;
  const hit = entries.find(
    (e) =>
      e.unitId === unit.id &&
      e.len === events.length &&
      e.dmgLen === dmgLen &&
      e.startTime === combat.startTime &&
      e.endTime === combat.endTime &&
      e.castsFp === castsFp,
  );
  if (hit) return hit.result.slice();
  const result = buildAuraIntervalsUncached(unit, combat, castersById);
  if (entries.length >= AURA_INTERVALS_ENTRIES_MAX) entries.shift();
  entries.push({
    unitId: unit.id,
    len: events.length,
    dmgLen,
    startTime: combat.startTime,
    endTime: combat.endTime,
    castsFp,
    result,
  });
  return result.slice();
}
