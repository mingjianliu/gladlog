/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t110.ts — ticket T110 (fact13 D10, ruling R42): a missed-sync-window
 * row's `enteredNextLock` named a later lock than the one the cooldown went
 * into. 36e987ca: Voidform at 5:27 went into the 5:28 Sin and Punishment on
 * the enemy healer (the prompt's own `[CC ON ENEMY]` / `[CONSEQ]` lines count
 * it), and the row said "Voidform at 327 in the 336–339 lock (Psychic
 * Scream)".
 *
 * The healer's locks are the producer's own selection
 * (`enemyHealerCcWindows` over the round's players, merged as
 * `mergeHealerCcWindows` merges them — never replayed here):
 *
 *  - `enteredNextSkipsLock`: an `enteredNextLock` entry "X at P in the A–B
 *    lock (…)" of a row whose lock ended at second E, while a producer lock on
 *    that healer begins after E and before A and the press at P lies inside
 *    it or in the 2 s before it (the entered test's lead, `SYNC_ENTER_LEAD_S`).
 *  - `healerLockOmitted` / `healerLockUnbacked`: a `[KILL WINDOW]` /
 *    `[VULNERABLE]` line's "enemy healer hard-CC'd in window" (the kill
 *    window's `healerLocked`, read off the same unmerged locks) against the
 *    producer's locks. The span prints floored seconds F–T, so a lock surely
 *    overlaps it when it begins by T and ends at F + 1 or later, and surely
 *    misses it when it begins after T + 1 or ends before F: omitted = no
 *    clause while one surely overlaps; unbacked = the clause while every lock
 *    surely misses.
 */
import {
  enemyHealerCcWindows,
  mergeHealerCcWindows,
  SYNC_ENTER_LEAD_S,
} from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";

import type { IRoundCtx } from "./ctx";

export const CHECKS = [
  "enteredNextSkipsLock",
  "healerLockOmitted",
  "healerLockUnbacked",
] as const;

const ROW_RE = /\btype=missed-sync-window t=(\d+)s/;
const HEALER_RE = /\bhealer=([^,}]+)/;
const END_RE = /\bwindowEndT=(\d+)/;
const NEXT_RE = /\benteredNextLock=([^,}]+)/;
const ENTRY_RE = /^(.+?) at (\d+) in the (\d+)–(\d+) lock \((.+)\)$/;
const KW_RE = /\[(KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d) on /;
const KW_FACTS_RE = /team offensive CDs ready|no team offensive CD ready/;
const HEALER_LOCKED = "enemy healer hard-CC'd in window";
const secOfClock = (mss: string): number => {
  const [m, ss] = mss.split(":");
  return Number(m) * 60 + Number(ss);
};

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  let raw: ReturnType<typeof enemyHealerCcWindows> | undefined;
  let merged: ReturnType<typeof mergeHealerCcWindows> | undefined;
  const rawLocks = () => {
    if (raw) return raw;
    const side = ctx.owner.reaction;
    const friends = ctx.players.filter((u: any) => u.reaction === side);
    const enemies = ctx.players.filter((u: any) => u.reaction !== side);
    try {
      raw = enemyHealerCcWindows(friends, enemies, ctx.legacy);
    } catch {
      raw = [];
    }
    return raw;
  };
  const locks = () => (merged ??= mergeHealerCcWindows(rawLocks()));
  for (const line of ctx.lines) {
    const k = KW_RE.exec(line);
    if (!k || !KW_FACTS_RE.test(line)) continue;
    const F = secOfClock(k[2]!);
    const T = secOfClock(k[3]!);
    const says = line.includes(HEALER_LOCKED);
    const sure = rawLocks().find(
      (l) => l.fromSeconds <= T && l.toSeconds >= F + 1,
    );
    const maybe = rawLocks().some(
      (l) => !(l.fromSeconds > T + 1 || l.toSeconds < F),
    );
    const C = says ? "healerLockUnbacked" : "healerLockOmitted";
    ctx.bump(C);
    if (!says && sure)
      ctx.violate(
        C,
        sure.spellName,
        ctx.start + F * 1000,
        `${k[1]}#${k[2]}#${k[3]}`,
        `${k[2]}–${k[3]} omits the healer lock ${Math.floor(sure.fromSeconds)}–${Math.floor(sure.toSeconds)} (${sure.spellName})`,
        line.trim().slice(0, 300),
      );
    if (says && !maybe)
      ctx.violate(
        C,
        k[1]!,
        ctx.start + F * 1000,
        `${k[1]}#${k[2]}#${k[3]}`,
        `${k[2]}–${k[3]} says the healer was locked; no producer lock is near it`,
        line.trim().slice(0, 300),
      );
  }
  for (const row of ctx.menu.split("\n")) {
    if (!ROW_RE.test(row)) continue;
    const next = NEXT_RE.exec(row)?.[1];
    if (!next) continue;
    const healer = HEALER_RE.exec(row)?.[1];
    const endS = Number(END_RE.exec(row)?.[1]);
    if (!healer || !Number.isFinite(endS)) continue;
    for (const entry of next.split(/;\s*/)) {
      const e = ENTRY_RE.exec(entry.trim());
      if (!e) continue;
      const C = "enteredNextSkipsLock";
      ctx.bump(C);
      const pressS = Number(e[2]);
      const namedFrom = Number(e[3]);
      // the press is printed floored: it lies in [P, P + 1)
      const skipped = locks().find(
        (l) =>
          l.healerName === healer &&
          l.fromSeconds > endS &&
          Math.floor(l.fromSeconds) < namedFrom &&
          pressS + 1 > l.fromSeconds - SYNC_ENTER_LEAD_S &&
          pressS <= l.toSeconds,
      );
      if (skipped)
        ctx.violate(
          C,
          skipped.spellName,
          ctx.start + pressS * 1000,
          `${healer}#${e[1]}#${pressS}`,
          `${e[1]} at ${pressS} went into the ${Math.floor(skipped.fromSeconds)}–${Math.floor(skipped.toSeconds)} lock (${skipped.spellName}); the row names the ${namedFrom}–${e[4]} lock (${e[5]})`,
          row.trim().slice(0, 300),
        );
    }
  }
}
