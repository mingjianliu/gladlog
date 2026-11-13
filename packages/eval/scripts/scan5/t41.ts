/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t41.ts — pipeline T41: a `[RES]` row's `enemy:` entry
 * `X/<spec>(Ns left)` whose N is the log's end minus the row's second, not
 * the effect's own end. 52a97230 r0 0:33: `Metamorphosis/Havoc Demon
 * Hunter(3s left)` — the aura went up at 0:32.885 and its REMOVED was logged
 * at 0:39.48, after the analysed slice ended at 0:35.744; its length is 24 s.
 *
 * Check `resEnemyLeftPastLogEnd`. Counted: every `enemy:` entry (the
 * holder's spec unique on the enemy roster) with an aura of the entry's
 * name (English name, `(no press)` stripped) that the holder put on a player
 * at or before the row's second + 1 and that is still up when the log
 * slice ends — the rows the scan reads itself, not the interval builder
 * (which clamps a later REMOVED onto the slice's end). A violation is such
 * an entry of a pressed effect whose own length — `buffFullDurationForCaster`
 * of the aura from its last APPLIED / REFRESH, a lookup — runs past the
 * slice's end and more than `LEFT_SLACK_S` past the printed time left:
 *  - `removed after the log end` — the aura's REMOVED is logged after the
 *    slice's end, later than row + N + slack too: the effect was seen up
 *    longer than the line says it had left;
 *  - `never removed` — no REMOVED at all.
 * Out of the total (the log cannot give the line a better number):
 *  - `outran its length` — an aura still up at the slice's end past its own
 *    length, or of no known length (Void Metamorphosis), removed after it:
 *    the line's end is the slice's, the least the log shows;
 *  - `no press` — a `(no press)` entry: a proc's length is not the aura's.
 */
import {
  parseResRow,
  splitResList,
} from "@gladlog/analysis/src/context/resRow";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";

import {
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

export const CHECKS = ["resEnemyLeftPastLogEnd"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "resEnemyLeftPastLogEnd|outran its length",
  "resEnemyLeftPastLogEnd|no press",
]);

/** `Math.round` of the time left (0.5) + the row's own second (1) */
export const LEFT_SLACK_S = 1.5;
/** an aura this close to a cast of its name is that press's */
export const PRESS_PAIR_MS = 1500;

const ROSTER =
  /<unit\s+id="(\d+)"\s+name="[^"]+"\s+spec="([^"]+)"\s+role="enemy"/;
const ENTRY = /^(.*)\/([^/]+?)\((\d+)s left\)$/;

export interface IOpenAura {
  /** last APPLIED / REFRESH at or before the slice's end */
  lastSeenMs: number;
  appliedMs: number;
  /** its REMOVED, logged after the slice's end */
  removedMs?: number;
  spellId: string;
}

/** `holder`'s auras named `name`, on any player, still up at `endMs` */
export function aurasUpAtLogEnd(
  units: readonly any[],
  holder: any,
  name: string,
  endMs: number,
): IOpenAura[] {
  const out: IOpenAura[] = [];
  for (const u of units) {
    // player wearers only (the product's own span reading, FT F13): a copy
    // on a pet or a summoned beast is applied late and loses its REMOVED
    // (Bestial Wrath's 1235388 on a beast summoned 6 s into it: 268 rows)
    if (!String(u.id).startsWith("Player-")) continue;
    const open = new Map<string, IOpenAura>();
    for (const a of (u.auraEvents ?? []) as any[]) {
      const e = ev(a);
      // a REMOVED the log wrote with no source closes the open run too, as
      // the product's interval builder pairs it (codex 85-tk-G-T41-1 #3)
      const sourceless = !a.srcUnitId || /^0+$/.test(String(a.srcUnitId));
      if (a.srcUnitId !== holder.id && !(e === REMOVED && sourceless)) continue;
      const id = String(a.spellId);
      if (nameOf(id, a.spellName) !== name) continue;
      const t = tsOf(a);
      if (e === APPLIED || e === REFRESH) {
        if (t > endMs) continue;
        const o = open.get(id);
        // a REFRESH moves the open run's length; an APPLIED on an open run
        // (its REMOVED lost) starts a run
        if (o && e === REFRESH) o.lastSeenMs = t;
        else open.set(id, { appliedMs: t, lastSeenMs: t, spellId: id });
      } else if (e === REMOVED) {
        const o = open.get(id);
        if (!o) continue;
        if (t <= endMs) open.delete(id);
        else o.removedMs ??= t;
      }
    }
    out.push(...open.values());
  }
  return out;
}

export function run(ctx: IRoundCtx): void {
  const lines = ctx.text.split("\n");
  const pidsOfSpec = new Map<string, string[]>();
  for (const l of lines) {
    const r = ROSTER.exec(l);
    if (r) pidsOfSpec.set(r[2]!, [...(pidsOfSpec.get(r[2]!) ?? []), r[1]!]);
  }
  let atS = 0;
  for (const l of lines) {
    const t = /^(\d+:\d{2})\s/.exec(l);
    if (t) atS = secOf(t[1]!);
    const enemy = parseResRow(l)?.enemy;
    if (!enemy) continue;
    for (const entry of splitResList(enemy)) {
      const e = ENTRY.exec(entry.trim());
      if (!e) continue;
      const pids = pidsOfSpec.get(e[2]!) ?? [];
      if (pids.length !== 1) continue;
      const holder = ctx.unitOfPid(pids[0]);
      if (!holder) continue;
      const name = e[1]!.replace(/ \(no press\)$/, "");
      const left = Number(e[3]);
      const rowMs = ctx.start + atS * 1000;
      // the press's own application: an aura that went up beside a cast of
      // that name, or any when the holder logged no cast of the name (a
      // Havoc Metamorphosis) — a same-named aura applied apart from the
      // press (Kingsbane's stacking buff 394095) has another length
      const pressesMs = successesOf(holder)
        .filter((c: any) => nameOf(c.spellId, c.spellName) === name)
        .map(tsOf);
      const up = aurasUpAtLogEnd(
        ctx.units as any[],
        holder,
        name,
        ctx.end,
      ).filter(
        (o) =>
          o.appliedMs <= rowMs + 1000 &&
          (pressesMs.length === 0 ||
            pressesMs.some((t) => Math.abs(t - o.appliedMs) <= PRESS_PAIR_MS)),
      );
      if (up.length === 0) continue;
      ctx.bump("resEnemyLeftPastLogEnd");
      const dueMs = rowMs + (left + LEFT_SLACK_S) * 1000;
      const rel = (ms: number) => ((ms - ctx.start) / 1000).toFixed(1);
      const noPress = e[1]!.endsWith(" (no press)");
      const judged = up
        .map((o) => {
          const full = buffFullDurationForCaster(o.spellId, holder);
          return {
            o,
            ownEndMs:
              full === undefined ? undefined : o.lastSeenMs + full * 1000,
          };
        })
        // seen, or due, later than the line says
        .filter(
          ({ o, ownEndMs }) =>
            (o.removedMs ?? ownEndMs ?? -Infinity) > dueMs &&
            (o.removedMs !== undefined || (ownEndMs ?? -Infinity) > ctx.end),
        )
        .sort(
          (a, b) =>
            (b.o.removedMs ?? b.ownEndMs ?? 0) -
            (a.o.removedMs ?? a.ownEndMs ?? 0),
        )[0];
      if (!judged) continue;
      const { o, ownEndMs } = judged;
      // the line prints the effect's own end, past the slice's: right, a
      // REMOVED logged later still (a talent's extension) notwithstanding
      if (ownEndMs !== undefined && ownEndMs > ctx.end && ownEndMs <= dueMs)
        continue;
      const ownPastLine =
        ownEndMs !== undefined && ownEndMs > ctx.end && ownEndMs > dueMs;
      ctx.violate(
        "resEnemyLeftPastLogEnd",
        noPress
          ? "no press"
          : !ownPastLine
            ? "outran its length"
            : o.removedMs !== undefined
              ? "removed after the log end"
              : "never removed",
        rowMs,
        `${holder.id}|${name}|${o.appliedMs}`,
        `${name}: applied ${rel(o.lastSeenMs)}s, ${o.removedMs === undefined ? "no REMOVED" : `REMOVED ${rel(o.removedMs)}s`}, own end ${ownEndMs === undefined ? "unknown" : `${rel(ownEndMs)}s`}, log end ${rel(ctx.end)}s; the ${atS}s row prints ${left}s left`,
        l.trim().slice(0, 220),
      );
    }
  }
}
