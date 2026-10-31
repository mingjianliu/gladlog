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
 *    SPELL_PERIODIC_DAMAGE row of the id, or an absorbed tick, from the same
 *    source) in the round. Kinds `undercount` / `overcount`.
 *  - `nextSpikeNotNearest` (D50): `next spike in Ns on X` against the nearest
 *    window of the whole walk (`selectPressureWindows` with its unlisted
 *    windows, read as a lookup: the audited fact is which of them the line
 *    searched). Kinds `later` (a nearer window existed) / `absent` (no note
 *    while one existed).
 *  - `intoDefenseLanded` (D52): `Spell ×n into X's Defense` against the presses
 *    whose own hit row fell inside the aura, each press taking the first
 *    unclaimed non-periodic row of the spell on the target within 1.5 s.
 *    Kinds `undercount` / `overcount`.
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
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { CAST_INTERRUPTED_REASONS } from "@gladlog/analysis/src/utils/castBarOutcomes";
import { selectPressureWindows } from "@gladlog/analysis/src/utils/cooldowns";
import {
  canDefensiveCleanse,
  canOffensivePurge,
  dispelReachYards,
  getDispelType,
  PURGE_SPELLS_BY_SPEC,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import {
  distanceBetween,
  getUnitPositionAtTime,
  getUnitRawPositionAtTime,
  hasLineOfSight,
} from "@gladlog/analysis/src/utils/losAnalysis";
import { LOS_SWEEP_GAP_MS } from "@gladlog/analysis/src/utils/positionSampling";

import {
  ABSORBED,
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
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
    for (const a of (unit.auraEvents ?? []) as any[]) {
      if (tsOf(a) > atMs) break;
      if (a.logLine?.parameters?.[11] === "BUFF") continue;
      const key = `${a.spellId}|${a.srcUnitId}`;
      if (ev(a) === REMOVED) open.delete(key);
      else if (ev(a) === APPLIED) open.set(key, tsOf(a));
    }
    const ticked = (id: string, src: string): boolean =>
      ((unit.damageIn ?? []) as any[]).some(
        (d) =>
          d.spellId === id &&
          d.srcUnitId === src &&
          (ev(d) as string).startsWith("SPELL_PERIODIC_DAMAGE"),
      ) ||
      ((unit.absorbsIn ?? []) as any[]).some(
        (d) =>
          d.attackSpellId === id && (d.attackerUnitId ?? d.srcUnitId) === src,
      );
    const truth = [...open.keys()].filter((k) => {
      const [id, src] = k.split("|");
      return ticked(id!, src!);
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

function checkIntoDefense(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m =
      /^\s*\[(\d+:\d\d)\] (.+?) \((.+?)\): (.+) into (.+?)'s (.+)$/.exec(line);
    if (!m) continue;
    const caster = ctx.players.find((p: any) => p.name === m[3]);
    const target = ctx.byName.get(m[5]!);
    if (!caster || !target) continue;
    const startS = secOf(m[1]!);
    const iv = buildAuraIntervals(target, ctx.legacy).find(
      (i) =>
        getEnglishSpellName(i.spellId, i.spellId) === m[6] &&
        Math.floor(i.fromS) === startS,
    );
    if (!iv) continue;
    const printedOf = new Map<string, number>();
    for (const part of m[4]!.split(" + ")) {
      const p = /^(.+?)(?: ×(\d+))?$/.exec(part);
      if (p)
        printedOf.set(p[1]!, (printedOf.get(p[1]!) ?? 0) + Number(p[2] ?? 1));
    }
    const fromMs = ctx.start + iv.fromS * 1000;
    const toMs = ctx.start + iv.toS * 1000;
    for (const [spell, printed] of printedOf) {
      ctx.bump("intoDefenseLanded");
      const same = (id: any, nm: any) =>
        !!id && getEnglishSpellName(String(id), nm ?? "") === spell;
      const presses = successesOf(caster)
        .filter(
          (c: any) =>
            c.destUnitId === target.id && same(c.spellId, c.spellName),
        )
        .map((c: any) => tsOf(c) as number)
        .sort((a: number, b: number) => a - b);
      // one row per hit: a hit eaten whole writes SPELL_MISSED and SPELL_ABSORBED
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
        ...((caster.missesOut ?? []) as any[])
          .filter(
            (d) => d.destUnitId === target.id && same(d.spellId, d.spellName),
          )
          .map((d) => tsOf(d) as number),
      ].sort((a, b) => a - b);
      let next = 0;
      let inside = 0;
      for (const t of presses) {
        while (next < rows.length && rows[next]! < t - 50) next++;
        const row = rows[next];
        const at = row !== undefined && row <= t + 1500 ? row : t;
        if (at === row) next++;
        if (at >= fromMs && at <= toMs) inside++;
      }
      if (inside === printed) continue;
      ctx.violate(
        "intoDefenseLanded",
        printed < inside ? "undercount" : "overcount",
        fromMs,
        `${caster.name}#${spell}#${m[1]}#${m[6]}`,
        `${spell} printed ×${printed}, landed inside ${inside} (${m[6]} on ${iv.fromS.toFixed(1)}–${iv.toS.toFixed(1)})`,
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
const dotAuraNoTick = new Map<string, number>();
const dotAuraTicked = new Set<string>();
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
    const through = [...up.keys()].find((id) =>
      ((unit.auraEvents ?? []) as any[]).some(
        (a) =>
          a.spellId === id &&
          ev(a) === REMOVED &&
          tsOf(a) >= lo &&
          tsOf(a) > hi,
      ),
    );
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
      /no (purger|dispeller) had range\/line of sight(?: until (\d+:\d\d) \(\d+s of the (?:de)?buff left\))?/.exec(
        line,
      );
    if (!stated) continue;
    const purge = stated[1] === "purger";
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
      const who = friends.filter((f: any) => canOffensivePurge(f, ctx.units));
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
