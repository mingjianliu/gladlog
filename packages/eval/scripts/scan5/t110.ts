/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t110.ts — ticket T110 (fact13 D10, ruling R42): a missed-sync-window
 * row's `enteredNextLock` named a later lock than the one the cooldown went
 * into. 36e987ca: Voidform at 5:27 went into the 5:28 Sin and Punishment on
 * the enemy healer (the prompt's own `[CC ON ENEMY]` / `[CONSEQ]` lines count
 * it), and the row said "Voidform at 327 in the 336–339 lock (Psychic
 * Scream)".
 *
 * The healer's locks are the producer's own selection (`enemyHealerCcWindows`
 * and `enemyHealerFactOnlyLocks` over the round's players; the locks a press
 * after a window can enter, `enteredLockCandidates` — never replayed here):
 *
 *  - `enteredNextSkipsLock`: an `enteredNextLock` entry "X at P in the A–B
 *    lock (…)" of a row, while a candidate lock on that healer begins after
 *    the row's own lock ended (its raw end: the merged lock on that healer
 *    whose floored start is the row's `t` — codex 85-tk-N-T110-1b #1) and
 *    before A, and the holder's first press of X after that end, printed at
 *    P, entered it by the producer's own test (`castEntersWindow` over the
 *    holder's `syncWindowCdFor` cooldown: lead, cast-bar start, active span
 *    — codex 85-tk-N-T110-1 #3, 1b #2).
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
  castEntersWindow,
  enemyHealerCcWindows,
  enemyHealerFactOnlyLocks,
  enteredLockCandidates,
  mergeHealerCcWindows,
  syncWindowCdFor,
} from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { extractMajorCooldowns } from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = [
  "enteredNextSkipsLock",
  "healerLockOmitted",
  "healerLockUnbacked",
] as const;

const ROW_RE = /\btype=missed-sync-window t=(\d+)s/;
const HEALER_RE = /\bhealer=([^,}]+)/;
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
  const side = ctx.players.filter(
    (u: any) => u.reaction === ctx.owner.reaction,
  );
  const enemies = ctx.players.filter(
    (u: any) => u.reaction !== ctx.owner.reaction,
  );
  let sync: ReturnType<typeof enemyHealerCcWindows> | undefined;
  let factOnly: ReturnType<typeof enemyHealerFactOnlyLocks> | undefined;
  const syncRaw = () => {
    if (sync) return sync;
    try {
      sync = enemyHealerCcWindows(side, enemies, ctx.legacy);
    } catch {
      sync = [];
    }
    return sync;
  };
  const factOnlyRaw = () => {
    if (factOnly) return factOnly;
    try {
      factOnly = enemyHealerFactOnlyLocks(side, enemies, ctx.legacy);
    } catch {
      factOnly = [];
    }
    return factOnly;
  };
  // the kill window's healer locks, unmerged (`healerLocked`'s own input)
  const rawLocks = () => [...syncRaw(), ...factOnlyRaw()];
  let rowLocks: ReturnType<typeof mergeHealerCcWindows> | undefined;
  let nextLocks: ReturnType<typeof enteredLockCandidates> | undefined;
  const merged = () => (rowLocks ??= mergeHealerCcWindows(syncRaw()));
  const candidates = () =>
    (nextLocks ??= enteredLockCandidates(syncRaw(), factOnlyRaw()));
  // our side's cooldowns of a button, as the producer builds them
  const enemyIds = new Set(enemies.map((e: any) => e.id as string));
  const cdsOf = new Map<string, any[]>();
  const cdsNamed = (name: string): any[] => {
    if (!cdsOf.has(name)) {
      const out: any[] = [];
      for (const u of side) {
        try {
          for (const cd of extractMajorCooldowns(u, ctx.legacy)) {
            if (nameOf(String(cd.spellId), cd.spellName ?? "") !== name)
              continue;
            out.push(
              syncWindowCdFor(
                cd,
                u,
                enemies,
                enemyIds,
                ctx.start,
                ctx.units,
                ctx.legacy,
              ),
            );
          }
        } catch {
          /* this unit's ledger not computable */
        }
      }
      cdsOf.set(name, out);
    }
    return cdsOf.get(name)!;
  };
  for (const line of ctx.lines) {
    const k = KW_RE.exec(line);
    if (!k || !KW_FACTS_RE.test(line)) continue;
    const F = secOfClock(k[2]!);
    const T = secOfClock(k[3]!);
    const says = line.includes(HEALER_LOCKED);
    const raw = rawLocks();
    const sure = raw.find((l) => l.fromSeconds <= T && l.toSeconds >= F + 1);
    const maybe = raw.some((l) => !(l.fromSeconds > T + 1 || l.toSeconds < F));
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
    const r = ROW_RE.exec(row);
    if (!r) continue;
    const next = NEXT_RE.exec(row)?.[1];
    if (!next) continue;
    const healer = HEALER_RE.exec(row)?.[1];
    if (!healer) continue;
    const rowT = Number(r[1]);
    // the row's own lock, raw: the merged lock on that healer it starts at
    const own = merged().filter(
      (l) => l.healerName === healer && Math.floor(l.fromSeconds) === rowT,
    );
    if (own.length !== 1) continue;
    const endS = own[0]!.toSeconds;
    for (const entry of next.split(/;\s*/)) {
      const e = ENTRY_RE.exec(entry.trim());
      if (!e) continue;
      const C = "enteredNextSkipsLock";
      ctx.bump(C);
      const pressS = Number(e[2]);
      const namedFrom = Number(e[3]);
      // the holder's first press after the lock, printed at P
      const firsts = cdsNamed(e[1]!).flatMap((cd) => {
        const first = [...cd.casts]
          .filter((c: any) => c.timeSeconds > endS)
          .sort((a: any, b: any) => a.timeSeconds - b.timeSeconds)[0];
        return first && Math.floor(first.timeSeconds) === pressS
          ? [{ cd, first }]
          : [];
      });
      const skipped =
        firsts.length === 0
          ? undefined
          : candidates().find(
              (l) =>
                l.healerName === healer &&
                l.fromSeconds > endS &&
                Math.floor(l.fromSeconds) < namedFrom &&
                firsts.every(({ cd, first }) => castEntersWindow(cd, first, l)),
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
