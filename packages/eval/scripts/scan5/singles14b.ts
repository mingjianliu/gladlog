/* eslint-disable @typescript-eslint/no-explicit-any -- the checks walk the untyped legacy parse objects and raw log rows */
/**
 * scan5/singles14b.ts — six single defects of the round-7 audit (fact7 class
 * 14, F21), each counted as its fact class. Truth comes from the round's rows
 * and advanced positions; tables are lookups (names, DB2, reach, roster).
 *
 *  - `feignStopAsCancel` (D31): a `[CAST STOPPED] … no control, silence or
 *    knockback landed on you then` whose Interrupted row sits within 0.3 s of
 *    an enemy hunter's Feign Death — the UNIT_DIED row with unconscious = 1,
 *    or its Survival Tactics 202748 APPLIED. A bar the enemy's target drop
 *    stopped is not a cast the player stopped.
 *  - `rotDotCount` (D32): `[ROT PRESSURE] … with K active DoTs` against the
 *    debuffs of the unit open at the printed second that ticked (a
 *    SPELL_PERIODIC_DAMAGE row of the id, or a SPELL_PERIODIC_MISSED one, from
 *    the same source) in the round, or that DB2 calls a DoT and whose run
 *    ended too soon for a tick. Kinds `undercount` / `overcount`.
 *  - `nextSpikeNotNearest` (D50): `next spike in Ns on X` against the nearest
 *    window of the whole walk (`selectPressureWindows` with its unlisted
 *    windows, read as a lookup: the audited fact is which of them the line
 *    searched). Kinds `later` (a nearer window existed) / `absent` (no note
 *    while one existed).
 *  - `intoDefenseLanded` (D52): `Spell ×n into X's Defense` against the round's
 *    presses whose own row fell inside the aura, each press taking the first
 *    unclaimed non-periodic row of the spell on the target within 1.5 s: a
 *    hit, a miss, or the caster's aura of it going on. One press under two
 *    ids in one instant is one press; a reflected one landed on nobody here;
 *    a wall re-applied inside its second is two intervals, the line one of
 *    them. The wall's span is its own aura rows (`wallRuns`), not the
 *    product's interval reader. Kinds `undercount` / `overcount`.
 *  - `avoidedWhileControlled` (D65): `[CC AVOIDED?] P: X (by C) did not land;
 *    Y …` for a control with no destination that landed on nobody and logged
 *    no miss, with a hard control on P through the second.
 *  - `dotTableForward` (D32, re-runnable forward check of `isDotAura`): a
 *    debuff that ticked on a player and is no DoT to the predicate; `report()`
 *    lists the DoTs of the predicate that never ticked.
 *  - `reachStatedWholeBuff` (D66): `no purger had range/line of sight — not
 *    actionable` on a window one of them reached on the 1 s grid (distance
 *    within their dispel reach, LoS not disproven) after its first 3 s; or a
 *    `… until m:ss` line with a second in reach before that one. Kinds `purge`
 *    / `cleanse` / `purgeUntilLate` / `cleanseUntilLate`.
 */
import { isDotAura } from "@gladlog/analysis/src/context/matchTimelineSections";
import {
  getEnglishSpellName,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { officialDurationS } from "@gladlog/analysis/src/utils/auraIntervals";
import { CAST_INTERRUPTED_REASONS } from "@gladlog/analysis/src/utils/castBarOutcomes";
import {
  COMPANION_CAST_ROW_MS,
  COPY_CAST_IDS,
} from "@gladlog/analysis/src/utils/castPress";
import { selectPressureWindows } from "@gladlog/analysis/src/utils/cooldowns";
import {
  canDefensiveCleanse,
  canOffensivePurge,
  dispelReachYards,
  getDispelType,
  isCdGatedPurger,
  PURGE_SPELLS_BY_SPEC,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import {
  distanceBetween,
  getUnitPositionAtTime,
  getUnitRawPositionAtTime,
  hasLineOfSight,
} from "@gladlog/analysis/src/utils/losAnalysis";
import { LOS_SWEEP_GAP_MS } from "@gladlog/analysis/src/utils/positionSampling";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import {
  ABSORBED,
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "feignStopAsCancel",
  "rotDotCount",
  "nextSpikeNotNearest",
  "intoDefenseLanded",
  "avoidedWhileControlled",
  "reachStatedWholeBuff",
  "dotTableForward",
] as const;

/** the raw rows' seconds-since-start clock */
const rawDate = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d{3})/;

function feignInstants(ctx: IRoundCtx, enemies: any[]): number[] {
  const ids = new Set(enemies.map((e: any) => e.id));
  const out: number[] = [];
  for (const u of enemies)
    for (const a of (u.auraEvents ?? []) as any[])
      if (a.spellId === "202748" && ev(a) === APPLIED) out.push(tsOf(a));
  // UNIT_DIED … ,1 — the parse keeps it apart; read it off the raw rows on
  // the clock of a row the parse did keep (start = the log's first line)
  const first = ctx.rawLines[0] ?? "";
  const m0 = rawDate.exec(first);
  if (m0) {
    const zero = Date.UTC(
      2000,
      +m0[1]! - 1,
      +m0[2]!,
      +m0[4]!,
      +m0[5]!,
      +m0[6]!,
      +m0[7]!,
    );
    const firstTs = (ctx.legacy.startTime as number) ?? ctx.start;
    for (const l of ctx.rawLines) {
      if (!l.includes("UNIT_DIED") || !/,1\r?$/.test(l)) continue;
      const g = l.split(",")[5];
      if (!g || !ids.has(g)) continue;
      const m = rawDate.exec(l);
      if (!m) continue;
      const t = Date.UTC(
        2000,
        +m[1]! - 1,
        +m[2]!,
        +m[4]!,
        +m[5]!,
        +m[6]!,
        +m[7]!,
      );
      out.push(firstTs + (t - zero));
    }
  }
  return out;
}

function checkFeign(ctx: IRoundCtx, enemies: any[]): void {
  const stops = ctx.lines.filter((l) => l.includes("[CAST STOPPED]"));
  if (stops.length === 0) return;
  const feigns = feignInstants(ctx, enemies);
  const failed = ctx
    .rawStreams()
    .castFailed.filter((f) => f.unitGuid === ctx.owner.id);
  for (const line of stops) {
    const m =
      /^\s*(\d+:\d\d)\s+\[CAST STOPPED\]\s+(.+?) — cast bar stopped after ([\d.]+)s; not kicked; no control/.exec(
        line,
      );
    if (!m) continue;
    ctx.bump("feignStopAsCancel");
    const startS = secOf(m[1]!);
    const atS = startS + Number(m[3]);
    const row = failed.find(
      (f) =>
        CAST_INTERRUPTED_REASONS.has(f.reason.trim()) &&
        getEnglishSpellName(String(f.spellId), f.spellName) === m[2] &&
        f.tSeconds >= atS - 0.1 &&
        f.tSeconds <= atS + 1.1,
    );
    if (!row) continue;
    const ms = ctx.start + row.tSeconds * 1000;
    const near = feigns.find((t) => Math.abs(t - ms) <= 300);
    if (near === undefined) continue;
    ctx.violate(
      "feignStopAsCancel",
      "stop",
      ms,
      `${m[2]}#${m[1]}`,
      `${m[2]}: stop +${Math.round(ms - ctx.start)}ms, feign +${Math.round(near - ctx.start)}ms`,
      line,
    );
  }
}

/** a run shorter than this can end before its first tick: the slowest DoT
 * cadence seen is 3 s */
const NO_TICK_RUN_MS = 3000;

/** `${src}|${dest}|${spellId}` of the round's SPELL_PERIODIC_MISSED rows */
const periodicMissedCache = new WeakMap<object, Set<string>>();
function periodicMissedRows(ctx: IRoundCtx): Set<string> {
  let out = periodicMissedCache.get(ctx.rawLines);
  if (out) return out;
  out = new Set<string>();
  for (const l of ctx.rawLines) {
    if (!l.includes("SPELL_PERIODIC_MISSED,")) continue;
    const f = l.split(",");
    out.add(`${f[1]}|${f[5]}|${f[9]}`);
  }
  periodicMissedCache.set(ctx.rawLines, out);
  return out;
}

function checkRotDots(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m =
      /^\s*(\d+:\d\d)\s+\[ROT PRESSURE\]\s+(.+?) at \d+% HP with (\d+) active DoTs/.exec(
        line,
      );
    if (!m) continue;
    ctx.bump("rotDotCount");
    const name = /^\d+\((?:[^)]*)\)/.test(m[2]!)
      ? ctx.unitOfPid(/^(\d+)/.exec(m[2]!)![1])
      : ctx.players.find((p: any) => p.name.startsWith(m[2]!.split(" ")[0]!));
    if (!name) continue;
    const unit = name;
    const atMs = ctx.start + secOf(m[1]!) * 1000;
    const open = new Map<string, number>();
    const debuffRows = ((unit.auraEvents ?? []) as any[]).filter(
      (a) => a.logLine?.parameters?.[11] !== "BUFF",
    );
    for (const a of debuffRows) {
      if (tsOf(a) > atMs) break;
      const key = `${a.spellId}|${a.srcUnitId}`;
      // the product's `floor(end)` counts a run through its last millisecond:
      // 3-6-36 r6, Shared Fate REMOVED at exactly 1:33.000, back at 1:33.335
      if (ev(a) === REMOVED && tsOf(a) === atMs) continue;
      if (ev(a) === REMOVED) {
        // a Mind-Controlled caster's DoT: APPLIED under the controlled unit,
        // its ticks and REMOVED under the controller
        const run = open.has(key)
          ? key
          : [...open.keys()].find((k) => k.startsWith(`${a.spellId}|`));
        if (run !== undefined) open.delete(run);
      } else if (ev(a) === APPLIED) open.set(key, tsOf(a));
    }
    const eaten = periodicMissedRows(ctx);
    const ticked = (id: string, src: string): boolean =>
      ((unit.damageIn ?? []) as any[]).some(
        (d) =>
          d.spellId === id &&
          d.srcUnitId === src &&
          (ev(d) as string).startsWith("SPELL_PERIODIC_DAMAGE"),
      ) ||
      // a tick eaten whole, or into an immunity, is a tick: its row is on the
      // attacker's side of the parse, so it is read off the raw rows
      eaten.has(`${src}|${unit.id}|${id}`);
    // a DB2 DoT gone before its first tick could land (a 1 s Moonfire, a 1.3 s
    // Cauterize) was on the unit at the second: only the table can say what it
    // is, and only for a run too short for the log to say
    const tooShortToTick = (id: string, from: number): boolean => {
      const end = debuffRows.find(
        (a) => a.spellId === id && ev(a) === REMOVED && tsOf(a) > from,
      );
      return (
        isDotAura(id) &&
        (end === undefined ? ctx.end : tsOf(end)) - from < NO_TICK_RUN_MS
      );
    };
    // fact8 D19: a run whose REMOVED the log lost ends at its official length,
    // not at the next REMOVED: no tick or refresh inside that length of the
    // second means it was gone (7-1-45: Shadow Word: Pain APPLIED 9.6, next row
    // APPLIED 38.4, no tick from 29.1 to 41.2 on any DoT, 7 "open" at 0:34)
    const lapsed = (id: string, src: string): boolean => {
      const from = open.get(`${id}|${src}`)!;
      const caster = ctx.players.find((p: any) => p.id === src);
      const d = officialDurationS(id, caster, atMs);
      if (d === null) return false;
      const rows = debuffRows.filter(
        (a) => a.spellId === id && a.srcUnitId === src,
      );
      // a REMOVED under a unit with no run of its own is this run's, the
      // Mind-Control shape the loop above pairs too
      const endsRun = (a: any): boolean =>
        ev(a) === REMOVED &&
        a.spellId === id &&
        (a.srcUnitId === src ||
          !debuffRows.some(
            (b) =>
              b.spellId === id &&
              b.srcUnitId === a.srcUnitId &&
              ev(b) === APPLIED &&
              tsOf(b) <= tsOf(a),
          ));
      const next = debuffRows.find(
        (a) =>
          tsOf(a) > atMs &&
          (endsRun(a) ||
            (ev(a) === APPLIED && a.spellId === id && a.srcUnitId === src)),
      );
      // its own REMOVED was logged: the run's end is known, not a guess
      if (next !== undefined && ev(next) === REMOVED) return false;
      const until = next === undefined ? ctx.end : tsOf(next);
      const tickedPast = ((unit.damageIn ?? []) as any[]).some(
        (t) =>
          t.spellId === id &&
          t.srcUnitId === src &&
          tsOf(t) >= atMs &&
          tsOf(t) < until,
      );
      if (tickedPast) return false;
      const anchor = Math.max(
        from,
        ...rows.filter((a) => tsOf(a) <= atMs).map((a) => tsOf(a)),
      );
      return anchor + d * 1000 < atMs;
    };
    const truth = [...open.keys()].filter((k) => {
      const [id, src] = k.split("|");
      return (
        (ticked(id!, src!) || tooShortToTick(id!, open.get(k)!)) &&
        !lapsed(id!, src!)
      );
    });
    const printed = Number(m[3]);
    if (printed === truth.length) continue;
    ctx.violate(
      "rotDotCount",
      printed < truth.length ? "undercount" : "overcount",
      atMs,
      `${unit.name}#${m[1]}`,
      `printed ${printed}, ticking ${truth.length}: ${truth.map((k) => nameOf(k.split("|")[0])).join(", ")}`,
      line,
    );
  }
}

function checkNextSpike(ctx: IRoundCtx, friends: any[]): void {
  const lines = ctx.lines.filter((l) => /\[YOU\] \[CD\]/.test(l));
  if (lines.length === 0) return;
  const { listed, notListed } = selectPressureWindows(
    friends as never,
    ctx.legacy as never,
    { notListedMinDamage: 300_000 },
  );
  const all = [...listed, ...notListed].filter(
    (w: any) => w.totalDamage >= 300_000,
  );
  for (const line of lines) {
    const m = /^\s*(\d+:\d\d)\s+\[YOU\] \[CD\]/.exec(line);
    if (!m) continue;
    const n = /next spike in (<1s|\d+s) on /.exec(line);
    // a control press and a proc carry no note at all, whatever comes next
    if (!n && !/ \| dampening: /.test(line)) continue;
    const s = secOf(m[1]!);
    // the press's own ms is not printed: within its second
    const nearest = all
      .filter((w: any) => w.fromSeconds >= s + 1)
      .reduce<number | undefined>(
        (b, w: any) =>
          b === undefined || w.fromSeconds < b ? w.fromSeconds : b,
        undefined,
      );
    if (nearest === undefined) continue;
    ctx.bump("nextSpikeNotNearest");
    if (!n) {
      ctx.violate(
        "nextSpikeNotNearest",
        "absent",
        ctx.start + s * 1000,
        m[1]!,
        `no note; nearest window from ${nearest.toFixed(1)}s`,
        line,
      );
      continue;
    }
    const printedAt = s + (n[1] === "<1s" ? 0 : parseInt(n[1]!, 10));
    if (printedAt <= nearest + 1.5) continue;
    ctx.violate(
      "nextSpikeNotNearest",
      "later",
      ctx.start + s * 1000,
      m[1]!,
      `printed ${n[1]} (≈${printedAt}s), nearest window from ${nearest.toFixed(1)}s`,
      line,
    );
  }
}

/** a REMOVED and an APPLIED this close, same spell and source, are the game
 * re-broadcasting one aura, not an end and a new wall */
const REBROADCAST_MS = 1;

interface IWallRun {
  key: string;
  fromMs: number;
  toMs: number;
}

/** A wall's runs on `target`, its own rows only: APPLIED → REMOVED per spell and
 * source; one the log lost the REMOVED of stops at DB2's length. */
function wallRuns(ctx: IRoundCtx, target: any, spell: string): IWallRun[] {
  const open = new Map<string, number>();
  const runs: IWallRun[] = [];
  const closeLostEnd = (key: string, fromMs: number) => {
    const d = spellEffectData[key.split("|")[0]!]?.durationSeconds ?? 0;
    runs.push({
      key,
      fromMs,
      toMs: d > 0 ? Math.min(fromMs + d * 1000, ctx.end) : ctx.end,
    });
  };
  for (const a of (target.auraEvents ?? []) as any[]) {
    if (getEnglishSpellName(a.spellId, a.spellName ?? "") !== spell) continue;
    const key = `${a.spellId}|${a.srcUnitId}`;
    if (ev(a) === APPLIED) {
      const prev = runs.findIndex(
        (r) =>
          r.key === key &&
          tsOf(a) >= r.toMs &&
          tsOf(a) - r.toMs <= REBROADCAST_MS,
      );
      if (prev >= 0) open.set(key, runs.splice(prev, 1)[0]!.fromMs);
      else if (!open.has(key)) open.set(key, tsOf(a));
    } else if (ev(a) === REMOVED) {
      const k = open.has(key)
        ? key
        : [...open.keys()].find((o) => o.startsWith(`${a.spellId}|`));
      if (k === undefined) continue;
      runs.push({ key: k, fromMs: open.get(k)!, toMs: tsOf(a) });
      open.delete(k);
    }
  }
  for (const [key, fromMs] of open) closeLostEnd(key, fromMs);
  return runs;
}

function checkIntoDefense(ctx: IRoundCtx): void {
  // the section reads the round's own casts: the ones after its ending death
  // are in the log's tail
  const roundEndAt = roundEndMs({ ...ctx.legacy, units: ctx.legacy.units });
  for (const line of ctx.lines) {
    const m =
      /^\s*\[(\d+:\d\d)\] (.+?) \((.+?)\): (.+) into (.+?)'s (.+)$/.exec(line);
    if (!m) continue;
    const caster = ctx.players.find((p: any) => p.name === m[3]);
    const target = ctx.byName.get(m[5]!);
    if (!caster || !target) continue;
    const startS = secOf(m[1]!);
    // a wall the log re-applied inside its printed second is two intervals of
    // that second, and the line is one of them
    const ivs = wallRuns(ctx, target, m[6]!).filter(
      (r) => Math.floor((r.fromMs - ctx.start) / 1000) === startS,
    );
    if (ivs.length === 0) continue;
    const printedOf = new Map<string, number>();
    for (const part of m[4]!.split(" + ")) {
      const p = /^(.+?)(?: ×(\d+))?$/.exec(part);
      if (p)
        printedOf.set(p[1]!, (printedOf.get(p[1]!) ?? 0) + Number(p[2] ?? 1));
    }
    ctx.bump("intoDefenseLanded", printedOf.size);
    const countsOf = (iv: (typeof ivs)[number]) => {
      const { fromMs, toMs } = iv;
      return [...printedOf].map(([spell, printed]) => {
        const same = (id: any, nm: any) =>
          !!id && getEnglishSpellName(String(id), nm ?? "") === spell;
        // one press of a spell the log writes under two ids in one instant
        // (Mutilate 1329 + 27576, Flame Shock 470411 + 188389) is one press
        const rowsOfSpell = successesOf(caster)
          .filter(
            (c: any) =>
              c.destUnitId === target.id &&
              tsOf(c) < roundEndAt &&
              same(c.spellId, c.spellName) &&
              !COPY_CAST_IDS.has(String(c.spellId)),
          )
          .sort((a: any, b: any) => tsOf(a) - tsOf(b));
        const presses = rowsOfSpell
          .filter(
            (c: any, i: number) =>
              !rowsOfSpell.some(
                (o: any, j: number) =>
                  j < i &&
                  o.spellId !== c.spellId &&
                  Math.abs(tsOf(o) - tsOf(c)) <= COMPANION_CAST_ROW_MS,
              ),
          )
          .map((c: any) => tsOf(c) as number);
        // one row per hit: a hit eaten whole writes SPELL_MISSED and
        // SPELL_ABSORBED; a DoT or a channel lands as its aura going on, and
        // its later ticks, eaten or not, are nobody's press
        const missed = ((caster.missesOut ?? []) as any[]).filter(
          (d) =>
            d.destUnitId === target.id &&
            !(ev(d) as string).startsWith("SPELL_PERIODIC") &&
            same(d.spellId, d.spellName),
        );
        const reflected = missed
          .filter((d) => d.missType === "REFLECT")
          .map((d) => tsOf(d) as number);
        const rows: number[] = [
          ...((caster.damageOut ?? []) as any[])
            .filter(
              (d) =>
                d.destUnitId === target.id &&
                ev(d) !== ABSORBED &&
                !(ev(d) as string).startsWith("SPELL_PERIODIC") &&
                same(d.spellId, d.spellName),
            )
            .map((d) => tsOf(d) as number),
          ...missed.map((d) => tsOf(d) as number),
          ...((target.auraEvents ?? []) as any[])
            .filter(
              (a) =>
                a.srcUnitId === caster.id &&
                (ev(a) === APPLIED || ev(a) === REFRESH) &&
                same(a.spellId, a.spellName),
            )
            .map((a) => tsOf(a) as number),
        ].sort((a, b) => a - b);
        let next = 0;
        let inside = 0;
        for (const t of presses) {
          while (next < rows.length && rows[next]! < t - 50) next++;
          const row = rows[next];
          const at = row !== undefined && row <= t + 1500 ? row : t;
          if (at === row) next++;
          // reflected: it went back at the caster and landed on nobody here
          if (reflected.some((r) => r >= t && r <= t + 1500)) continue;
          if (at >= fromMs && at <= toMs) inside++;
        }
        return { spell, printed, inside, iv };
      });
    };
    const perWindow = ivs.map(countsOf);
    const worst =
      perWindow.find((w) => w.every((c) => c.printed === c.inside)) ??
      perWindow[perWindow.length - 1]!;
    for (const { spell, printed, inside, iv } of worst) {
      if (inside === printed) continue;
      ctx.violate(
        "intoDefenseLanded",
        printed < inside ? "undercount" : "overcount",
        iv.fromMs,
        `${caster.name}#${spell}#${m[1]}#${m[6]}`,
        `${spell} printed ×${printed}, landed inside ${inside} (${m[6]} on ${((iv.fromMs - ctx.start) / 1000).toFixed(1)}–${((iv.toMs - ctx.start) / 1000).toFixed(1)})`,
        line,
      );
    }
  }
}

/**
 * D32's forward check, re-runnable: every debuff on a player that ticked
 * (SPELL_PERIODIC_DAMAGE rows of its id and source) must be a DoT to
 * `isDotAura`, and `report()` lists the `isDotAura` debuffs that never ticked
 * in the capture — a rule the DB2 table cannot state.
 */
let dotAuraNoTick = new Map<string, number>();
let dotAuraTicked = new Set<string>();
function checkDotTable(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.players) {
    const ticks = new Set<string>();
    for (const d of (u.damageIn ?? []) as any[])
      if (ev(d) === "SPELL_PERIODIC_DAMAGE") ticks.add(d.spellId);
    const seen = new Set<string>();
    for (const a of (u.auraEvents ?? []) as any[]) {
      if (a.logLine?.parameters?.[11] !== "DEBUFF" || ev(a) !== APPLIED)
        continue;
      if (seen.has(a.spellId)) continue;
      seen.add(a.spellId);
      ctx.bump("dotTableForward");
      if (ticks.has(a.spellId)) dotAuraTicked.add(a.spellId);
      else if (isDotAura(a.spellId))
        dotAuraNoTick.set(a.spellId, (dotAuraNoTick.get(a.spellId) ?? 0) + 1);
      if (ticks.has(a.spellId) && !isDotAura(a.spellId))
        ctx.violate(
          "dotTableForward",
          "uncovered",
          tsOf(a),
          a.spellId,
          `${nameOf(a.spellId)} ${a.spellId} ticks and is no DoT to isDotAura`,
        );
    }
  }
}

export function report(): string[] {
  const never = [...dotAuraNoTick]
    .filter(([id]) => !dotAuraTicked.has(id))
    .sort((a, b) => b[1] - a[1]);
  return [
    `dotTableForward: isDotAura debuffs that never ticked: ${never.length}`,
    ...never
      .slice(0, 30)
      .map(([id, n]) => `  ${id} ${nameOf(id)} — ${n} unit-rounds`),
  ];
}

function checkAvoided(ctx: IRoundCtx, enemies: any[]): void {
  for (const line of ctx.lines) {
    const m =
      /^\s*(\d+:\d\d)\s+\[CC AVOIDED\?\]\s+(\d+)\([^)]*\): (.+?) \(by .*?\) did not land; (.+?) (?:\(|active|up)/.exec(
        line,
      );
    if (!m) continue;
    ctx.bump("avoidedWhileControlled");
    const unit = ctx.unitOfPid(m[2]);
    if (!unit) continue;
    const s = secOf(m[1]!);
    const lo = ctx.start + s * 1000;
    const hi = lo + 999;
    const cast = enemies
      .flatMap((e: any) => [...successesOf(e), ...(e.petSpellCastEvents ?? [])])
      .find(
        (c: any) =>
          getEnglishSpellName(String(c.spellId), c.spellName ?? "") === m[3] &&
          tsOf(c) >= lo - 3000 &&
          tsOf(c) <= hi,
      );
    if (!cast) continue;
    const hasDest = cast.destUnitId && cast.destUnitId !== "0000000000000000";
    if (hasDest) continue;
    const up = new Map<string, number>();
    for (const a of (unit.auraEvents ?? []) as any[]) {
      if (tsOf(a) > lo) break;
      if (!ccSpellIds.has(a.spellId)) continue;
      if (ev(a) === REMOVED) up.delete(a.spellId);
      else if (ev(a) === APPLIED) up.set(a.spellId, tsOf(a));
    }
    // the run up at `lo` is over at its first REMOVED; a later one is another
    // run's. A credit pressed before the control, still inside its own DB2
    // length at the line, was already there to take it (51-1 0:07: the trap's
    // MISSED row is on the totem set 1 s before the fear)
    const lastCredit = Math.max(
      -Infinity,
      ...successesOf(unit)
        .filter((c: any) => {
          const s = spellEffectData[String(c.spellId)]?.durationSeconds ?? 0;
          return (
            getEnglishSpellName(String(c.spellId), c.spellName ?? "") ===
              m[4] &&
            tsOf(c) <= lo &&
            lo - tsOf(c) <= s * 1000
          );
        })
        .map(tsOf),
    );
    const through = [...up.keys()].find((id) => {
      const end = ((unit.auraEvents ?? []) as any[]).find(
        (a) => a.spellId === id && ev(a) === REMOVED && tsOf(a) >= lo,
      );
      const pressedBefore = lastCredit > -Infinity && lastCredit < up.get(id)!;
      return !!end && tsOf(end) > hi && !pressedBefore;
    });
    if (!through) continue;
    ctx.violate(
      "avoidedWhileControlled",
      m[4]!,
      lo,
      `${unit.name}#${m[3]}#${m[1]}`,
      `${unit.name}: ${m[3]} credited to ${m[4]} under ${nameOf(through)}`,
      line,
    );
  }
}

function checkReach(ctx: IRoundCtx, friends: any[]): void {
  const zone = (ctx.legacy.startInfo?.zoneId ?? ctx.legacy.zoneId) as
    string | undefined;
  const reached = (
    who: any[],
    target: any,
    fromMs: number,
    toMs: number,
    reachOf: (d: any) => number,
  ): { atMs: number; who: string } | undefined => {
    const t0 = ctx.start + Math.ceil((fromMs - ctx.start) / 1000) * 1000;
    for (let t = t0; t <= toMs; t += 1000) {
      const tp = getUnitPositionAtTime(target, t, LOS_SWEEP_GAP_MS);
      if (!tp) continue;
      for (const d of who) {
        const dp = getUnitPositionAtTime(d, t, LOS_SWEEP_GAP_MS);
        if (!dp || distanceBetween(dp, tp) > reachOf(d)) continue;
        const dr = zone
          ? getUnitRawPositionAtTime(d, t, LOS_SWEEP_GAP_MS)
          : null;
        const tr = zone
          ? getUnitRawPositionAtTime(target, t, LOS_SWEEP_GAP_MS)
          : null;
        if (zone && dr && tr && hasLineOfSight(zone, dr, tr) === false)
          continue;
        return { atMs: t, who: d.name };
      }
    }
    return undefined;
  };
  for (const line of ctx.lines) {
    const stated =
      /no (purger(?: without a cooldown)?|dispeller) had range\/line of sight(?: until (\d+:\d\d) \(\d+s of the (?:de)?buff left\))?/.exec(
        line,
      );
    if (!stated) continue;
    const purge = stated[1] !== "dispeller";
    // `until m:ss` claims no reach before that second; the plain line claims
    // none for the whole window
    const untilS = stated[2] === undefined ? undefined : secOf(stated[2]);
    const sweepEnd = (windowEndMs: number): number =>
      untilS === undefined ? windowEndMs : ctx.start + (untilS - 1) * 1000;
    ctx.bump("reachStatedWholeBuff");
    const m = /^\s*(\d+:\d\d)\s+\[/.exec(line);
    if (!m) continue;
    const s = secOf(m[1]!);
    if (purge) {
      const u = /\]\s+(\d+)\(/.exec(line);
      const spell =
        /: (.+?) \(purgeable;/.exec(line)?.[1] ??
        /\[MISSED PURGE OPPORTUNITY\]\s+(.+?) active on/.exec(line)?.[1];
      const target = ctx.unitOfPid(
        u?.[1] ?? / active on (\d+)\(/.exec(line)?.[1],
      );
      const len = /unpurged for (\d+)s/.exec(line);
      if (!target || !spell || !len) continue;
      const on = ((target.auraEvents ?? []) as any[]).find(
        (a) =>
          ev(a) === APPLIED &&
          getEnglishSpellName(a.spellId, a.spellName ?? "") === spell &&
          tsOf(a) >= ctx.start + s * 1000 &&
          tsOf(a) < ctx.start + (s + 1) * 1000,
      );
      if (!on) continue;
      const who = friends.filter(
        (f: any) =>
          canOffensivePurge(f, ctx.units) &&
          (stated[1] === "purger" || !isCdGatedPurger(f)),
      );
      const hit = reached(
        who,
        target,
        tsOf(on) + 3000,
        sweepEnd(tsOf(on) + Number(len[1]) * 1000),
        (d: any) => dispelReachYards(d, PURGE_SPELLS_BY_SPEC[d.spec as never]),
      );
      if (hit)
        ctx.violate(
          "reachStatedWholeBuff",
          untilS === undefined ? "purge" : "purgeUntilLate",
          tsOf(on),
          `${target.name}#${spell}#${m[1]}`,
          `${hit.who} in reach of ${target.name} at +${(hit.atMs - ctx.start) / 1000}s`,
          line,
        );
      continue;
    }
    const c = /\[UNCLEANSED DEBUFF\]\s+(.+?) on (\d+)\([^)]*\) \| (\d+)s/.exec(
      line,
    );
    const target = c ? ctx.unitOfPid(c[2]) : undefined;
    if (!c || !target) continue;
    const on = ((target.auraEvents ?? []) as any[]).find(
      (a) =>
        ev(a) === APPLIED &&
        getEnglishSpellName(a.spellId, a.spellName ?? "") === c[1] &&
        tsOf(a) >= ctx.start + s * 1000 &&
        tsOf(a) < ctx.start + (s + 1) * 1000,
    );
    if (!on) continue;
    const type = getDispelType(on.spellId);
    if (!type) continue;
    const who = friends.filter((f: any) =>
      canDefensiveCleanse(f, type as never),
    );
    const hit = reached(
      who,
      target,
      tsOf(on) + 3000,
      sweepEnd(tsOf(on) + Number(c[3]) * 1000),
      () => 40,
    );
    if (hit)
      ctx.violate(
        "reachStatedWholeBuff",
        untilS === undefined ? "cleanse" : "cleanseUntilLate",
        tsOf(on),
        `${target.name}#${c[1]}#${m[1]}`,
        `${hit.who} in reach of ${target.name} at +${(hit.atMs - ctx.start) / 1000}s`,
        line,
      );
  }
}

export function run(ctx: IRoundCtx): void {
  const friends = ctx.players.filter(
    (u: any) => u.info && u.reaction === ctx.owner?.reaction,
  );
  const enemies = ctx.players.filter((u: any) => !friends.includes(u));
  checkFeign(ctx, enemies);
  checkRotDots(ctx);
  checkNextSpike(ctx, friends);
  checkIntoDefense(ctx);
  checkAvoided(ctx, enemies);
  checkReach(ctx, friends);
  checkDotTable(ctx);
}

export const state = () => ({ dotAuraNoTick, dotAuraTicked });
export const load = (s: ReturnType<typeof state>): void => {
  ({ dotAuraNoTick, dotAuraTicked } = s);
};
