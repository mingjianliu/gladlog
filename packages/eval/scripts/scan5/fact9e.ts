/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/fact9e.ts — the round-9 audit's class-4 checks (fact9 F24: where an
 * aura's span starts and ends). Truth is read off the log rows; lookups only
 * name things.
 *
 *  - `restatedAuraStart` (D19): an aura first shown on its holder inside a
 *    re-stating batch (≥ 6 APPLIED rows on the unit within 5 ms — the log
 *    showing an unseen unit again), with no row of it on the holder since
 *    another unit's logged press of it ON that holder. The aura went up at
 *    the press; the batch only showed it. An `[ENEMY DEF]` line of it whose
 *    length is the batch's (aura end − batch) and not the press's, or a burst
 *    ledger `pressed Zs after the burst opened` that places the press at the
 *    batch, reads the late row (5f992d25 1:26: Life Cocoon 9.0 s, 10.4 s up).
 *  - `peelUsableUnseen` (D20): a `[PEEL OPTION]` span that counts a second
 *    the target was out of sight (Vanish, Mass Invisibility, Phase Shift,
 *    Burrow, Greater Invisibility: from its APPLIED to its REMOVED, else to
 *    the holder's first own press, hit or aura on another unit after it) or
 *    a second the CC's owner was
 *    dead at any instant of (5f992d25 1:47–1:49 Blind, Vanish 1:48.23,
 *    owner dead 1:49.02).
 *  - `resWindowAfterChannel` (D26): a `[RES]` `enemy:` window of a
 *    channelled cooldown still running at a row whose second starts after
 *    the channel was over — its caster's same-named aura on itself REMOVED,
 *    else (no such row) its next on-GCD press of another spell (a7e95468 r0 1:23: Ray of
 *    Frost 79.05, Ice Lance 80.64, its buff gone 81.98, `1s left`). A
 *    periodic-trigger aura's last trigger row just after its REMOVED is
 *    still the effect (fact10 D29, the producer's reading).
 */
import { specToString } from "@gladlog/analysis";
import { isResRowLine } from "@gladlog/analysis/src/context/resRow";
import { CHANNELED_SPELL_IDS } from "@gladlog/analysis/src/data/channeledGenerated";
import { OFF_GCD_SPELL_IDS } from "@gladlog/analysis/src/data/offGcdGenerated";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import { RESTATED_END_TOLERANCE_MS } from "@gladlog/analysis/src/utils/auraIntervals";
import { isNoPressRow } from "@gladlog/analysis/src/utils/castPress";
import { lastPeriodicTriggerEndS } from "@gladlog/analysis/src/utils/enemyCDs";

import {
  APPLIED,
  type IRoundCtx,
  nameOf,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "restatedAuraStart",
  "peelUsableUnseen",
  "resWindowAfterChannel",
] as const;

const RESYNC_MIN = 6;
const RESYNC_SPAN_MS = 5;
const lineOf = (e: any): number => e.logLine?.lineIndex ?? 0;

const appliedOn = (u: any): any[] =>
  ((u.auraEvents ?? []) as any[]).filter(
    (a) => a.destUnitId === u.id && a.logLine?.event === APPLIED,
  );
const inBatch = (u: any, ms: number): boolean =>
  appliedOn(u).filter((a) => Math.abs(tsOf(a) - ms) <= RESYNC_SPAN_MS).length >=
  RESYNC_MIN;

/** another unit's SUCCESS of `name` on `holder`, the latest before `ms` */
function pressOn(ctx: IRoundCtx, holder: any, name: string, ms: number) {
  let best: { ms: number; by: any } | undefined;
  for (const p of ctx.players) {
    if (p.id === holder.id) continue;
    for (const c of successesOf(p))
      if (
        c.destUnitId === holder.id &&
        tsOf(c) < ms - 150 &&
        tsOf(c) >= ms - 10_000 &&
        nameOf(c.spellId, c.spellName) === name &&
        (!best || tsOf(c) > best.ms)
      )
        best = { ms: tsOf(c), by: p };
  }
  return best;
}

const ENEMY_DEF_LEN =
  /^(\d+:\d{2}) {2}\[ENEMY DEF\] {3}\d+\([^)]*\) \([^)]*\): (.+?) (?:→ |\+ \d+% copy → )(\d+)\([^)]*\) \((\d+\.\d)s/;
const BURST_PRESSED =
  /^\s+Target had a major defensive up: (.+?) active ON THE TARGET [\d.]+s of this burst \(pressed ([\d.]+)s after the burst opened\)/;
const BURST_HEAD = /^\s+Burst #\d+ — (\d+:\d{2})/;

function restated(ctx: IRoundCtx): void {
  // the late-shown auras of the round: holder, name, batch ms, press, end
  const late: Array<{
    holder: any;
    name: string;
    batch: number;
    press: number;
    end: number | undefined;
  }> = [];
  for (const u of ctx.players) {
    const rows = (u.auraEvents ?? []) as any[];
    for (const a of appliedOn(u)) {
      if (!inBatch(u, tsOf(a))) continue;
      const name = nameOf(a.spellId, a.spellName);
      const press = pressOn(ctx, u, name, tsOf(a));
      if (!press || a.srcUnitId !== press.by.id) continue;
      // no row of it on the holder between the press and the batch
      if (
        rows.some(
          (r) =>
            r !== a &&
            r.spellId === a.spellId &&
            tsOf(r) > press.ms - 150 &&
            (tsOf(r) < tsOf(a) ||
              (tsOf(r) === tsOf(a) && lineOf(r) < lineOf(a))) &&
            r.logLine?.event !== "SPELL_ABSORBED",
        )
      )
        continue;
      const end = rows
        .filter(
          (r) =>
            r.spellId === a.spellId &&
            r.logLine?.event === REMOVED &&
            tsOf(r) > tsOf(a),
        )
        .map(tsOf)
        .sort((x, y) => x - y)[0];
      // the log shows it up before the batch (codex 20-F24-13 #1: a
      // projectile's control lands after its travel): a row of its spell on
      // the holder since the press, or its REMOVED at the press + its
      // official length
      const between = (x: any) =>
        x.spellId === a.spellId && tsOf(x) >= press.ms && tsOf(x) < tsOf(a);
      const officialMs =
        (spellEffectData[String(a.spellId)]?.durationSeconds ?? NaN) * 1000;
      const wasUp =
        ((u.absorbsIn ?? []) as any[]).some(between) ||
        ((u.healIn ?? []) as any[]).some(between) ||
        ((u.damageIn ?? []) as any[]).some(between) ||
        (end !== undefined &&
          Math.abs(end - press.ms - officialMs) <= RESTATED_END_TOLERANCE_MS);
      if (!wasUp) continue;
      late.push({ holder: u, name, batch: tsOf(a), press: press.ms, end });
    }
  }
  if (late.length === 0) return;
  let burstFrom: number | undefined;
  for (const line of ctx.lines) {
    const head = BURST_HEAD.exec(line);
    if (head) burstFrom = ctx.start + secOf(head[1]!) * 1000;
    const d = ENEMY_DEF_LEN.exec(line);
    if (d) {
      const printed = +d[4]!;
      for (const x of late) {
        if (x.name !== d[2] || x.end === undefined) continue;
        if (x.holder.name === undefined) continue;
        const sec = Math.floor((x.press - ctx.start) / 1000);
        if (secOf(d[1]!) !== sec) continue;
        ctx.bump("restatedAuraStart");
        const fromBatch = (x.end - x.batch) / 1000;
        const fromPress = (x.end - x.press) / 1000;
        if (
          Math.abs(printed - fromBatch) <= 0.06 &&
          Math.abs(printed - fromPress) > 0.15
        )
          ctx.violate(
            "restatedAuraStart",
            "enemyDefLength",
            x.press,
            `${x.holder.name}#${x.name}@${d[1]}`,
            `${x.name} on ${x.holder.name}: ${printed}s = from the re-stated row, ${fromPress.toFixed(1)}s from the press`,
            line.slice(0, 300),
          );
      }
    }
    const b = BURST_PRESSED.exec(line);
    if (b && burstFrom !== undefined) {
      const z = +b[2]!;
      for (const x of late) {
        if (x.name !== b[1]) continue;
        // the burst opened inside its printed second: place the press
        const atBatch = x.batch - z * 1000;
        const atPress = x.press - z * 1000;
        const inSecond = (ms: number) =>
          ms >= burstFrom! - 50 && ms < burstFrom! + 1050;
        if (!inSecond(atBatch) && !inSecond(atPress)) continue;
        ctx.bump("restatedAuraStart");
        if (inSecond(atBatch) && !inSecond(atPress))
          ctx.violate(
            "restatedAuraStart",
            "burstPressed",
            x.press,
            `${x.holder.name}#${x.name}@burst`,
            `${x.name}: pressed ${z}s after the burst opened = the re-stated row`,
            line.slice(0, 300),
          );
      }
    }
  }
}

const UNSEEN_AURAS = new Set([
  "11327", // Vanish
  "414664", // Mass Invisibility
  "408558", // Phase Shift
  "409293", // Burrow
  "110960", // Greater Invisibility
]);

/** [fromMs, toMs) the unit was out of sight: APPLIED to REMOVED, else to
 * its first own press after the APPLIED */
function unseenSpans(u: any, endMs: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const rows = ((u.auraEvents ?? []) as any[])
    .filter((a) => UNSEEN_AURAS.has(a.spellId) && a.destUnitId === u.id)
    .sort((a, b) => tsOf(a) - tsOf(b));
  for (const a of rows) {
    if (a.logLine?.event !== APPLIED) continue;
    const rem = rows.find(
      (r) =>
        r.spellId === a.spellId &&
        r.logLine?.event === REMOVED &&
        tsOf(r) >= tsOf(a),
    );
    // its first own action: a press, a hit, or an aura it put on another
    // unit (a Cheap Shot from stealth logs no SUCCESS, only its stun)
    const act = [
      ...successesOf(u),
      ...((u.damageOut ?? []) as any[]),
      ...((u.auraEvents ?? []) as any[]).filter(
        (x) =>
          x.srcUnitId === u.id &&
          x.destUnitId !== u.id &&
          x.logLine?.event === APPLIED,
      ),
    ]
      .map(tsOf)
      .filter((t) => t > tsOf(a) + 100)
      .sort((x, y) => x - y)[0];
    out.push([tsOf(a), rem ? tsOf(rem) : (act ?? endMs)]);
  }
  return out;
}

const PEEL =
  /^(\d+:\d{2})(?:–(\d+:\d{2}))? {2}\[PEEL OPTION\] {2}(\d+)\([^)]*\) (.+?) → (\d+)\([^)]*\).*?: usable (\d+) s/;

function peel(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = PEEL.exec(line);
    if (!m) continue;
    const owner = ctx.unitOfPid(m[3]);
    const target = ctx.unitOfPid(m[5]);
    if (!owner || !target) continue;
    ctx.bump("peelUsableUnseen");
    const a = secOf(m[1]!);
    const b = m[2] ? secOf(m[2]) : a;
    const n = +m[6]!;
    // the span's end seconds are counted; every second is when it is whole
    const counted =
      n === b - a + 1
        ? Array.from({ length: n }, (_, i) => a + i)
        : [...new Set([a, b])];
    const deadMs = Math.min(
      ...((owner.deathRecords ?? []) as any[]).map(
        (d) => d.timestamp ?? tsOf(d),
      ),
      Infinity,
    );
    const spans = unseenSpans(target, ctx.start + 1e9);
    const bad = counted.filter((s) => {
      const from = ctx.start + s * 1000;
      const to = from + 1000;
      return deadMs < to || spans.some(([f, t]) => f < to && from < t);
    });
    if (bad.length === 0) continue;
    ctx.violate(
      "peelUsableUnseen",
      deadMs < ctx.start + (b + 1) * 1000 &&
        bad.every((s) => deadMs < ctx.start + (s + 1) * 1000)
        ? "ownerDead"
        : "unseen",
      ctx.start + bad[0]! * 1000,
      `${m[3]}#${m[4]}→${m[5]}@${m[1]}`,
      `${m[4]} → ${target.name}: counted ${bad.join(",")} (target unseen or owner dead)`,
      line.slice(0, 300),
    );
  }
}

const TIMED = /^(\d+):(\d\d) {2}\[/;

function resChannel(ctx: IRoundCtx): void {
  let s: number | undefined;
  for (const l of ctx.lines) {
    const t = TIMED.exec(l);
    if (t) {
      s = Number(t[1]) * 60 + Number(t[2]);
      continue;
    }
    if (!isResRowLine(l) || s === undefined) continue;
    const f = / {2}enemy:(.*?)(?= {2}focus:| {2}cc:| \| Atonements|$)/.exec(l);
    if (!f) continue;
    for (const e of f[1]!.split(/(?<=s left\)),/)) {
      const x = /^(.*)\/([^/(]+)\((\d+)s left\)$/.exec(e.trim());
      if (!x) continue;
      const rowMs = ctx.start + s * 1000;
      for (const u of ctx.players) {
        if (specToString(u.spec) !== x[2]) continue;
        const press = successesOf(u)
          .filter(
            (c) =>
              CHANNELED_SPELL_IDS.has(c.spellId) &&
              nameOf(c.spellId, c.spellName) === x[1] &&
              tsOf(c) <= rowMs + 999,
          )
          .sort((a, b) => tsOf(b) - tsOf(a))[0];
        if (!press) continue;
        const p = tsOf(press);
        // the window is this press's only when the press can reach the row
        // (a window an aura-only occurrence opened later is another's)
        const full = spellEffectData[press.spellId]?.durationSeconds;
        if (typeof full !== "number" || rowMs - p > (full + 1) * 1000) continue;
        ctx.bump("resWindowAfterChannel");
        const removedRow = ((u.auraEvents ?? []) as any[])
          .filter(
            (a) =>
              a.srcUnitId === u.id &&
              a.destUnitId === u.id &&
              a.logLine?.event === REMOVED &&
              nameOf(a.spellId, a.spellName) === x[1] &&
              tsOf(a) > p,
          )
          .sort((a, b) => tsOf(a) - tsOf(b))[0];
        // fact10 D29: a periodic-trigger aura's last trigger row logged
        // just after its REMOVED is the effect's own — the effect ends there
        // (605 8-1 r1 1:29: Dark Harvest REMOVED 88.984 s, its 1257065 heal
        // 89.001 s, `1s left` at 89 s). The producer's own end predicate
        // (`lastPeriodicTriggerEndS`: DB2 triggers and the scripted ones,
        // within the slack, not past the combat's end — codex 20-F25-06 #2)
        const removed: number | undefined =
          removedRow === undefined
            ? undefined
            : ctx.start +
              lastPeriodicTriggerEndS(
                u,
                String(removedRow.spellId),
                (tsOf(removedRow) - ctx.start) / 1000,
                ctx.legacy,
              ) *
                1000;
        // a triggered row is no press (`isNoPressRow`, the producer's
        // reading): Snowdrift's per-target pulses 389823 / 390171 are logged
        // as the mage's casts on every unit they hit, end nothing, and read
        // as the next press they cut 16 Ray of Frost windows on the 605
        // (GH #191)
        const rows = (u.spellCastEvents ?? []) as any[];
        const next = successesOf(u)
          .filter(
            (c) =>
              tsOf(c) > p &&
              nameOf(c.spellId, c.spellName) !== x[1] &&
              !OFF_GCD_SPELL_IDS.has(c.spellId) &&
              !isNoPressRow(c, rows),
          )
          .map(tsOf)
          .sort((a, b) => a - b)[0];
        // the channel's own aura end when logged; a press stands in only
        // without one (a cast-while-channelling press — Snowdrift 0.15 s
        // into a Ray of Frost that ran on to 2.38 s — ends nothing)
        const end = removed ?? next ?? Infinity;
        if (!(end < rowMs)) continue;
        ctx.violate(
          "resWindowAfterChannel",
          removed !== undefined && removed < rowMs
            ? "auraRemoved"
            : "nextPress",
          rowMs,
          `${u.name}#${x[1]}@${s}`,
          `${x[1]} (${u.name}) ${x[3]}s left at ${s}s; channel over at ${((end - ctx.start) / 1000).toFixed(2)}s`,
          l.slice(0, 300),
        );
      }
    }
  }
}

export function run(ctx: IRoundCtx): void {
  restated(ctx);
  peel(ctx);
  resChannel(ctx);
}
