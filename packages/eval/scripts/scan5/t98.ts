/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/t98.ts — ticket T98 (fact13 D5 / D11): a wall's talent copy is no
 * press, and a press that refreshes the copy is one. The ledger check takes
 * the aura's interval and its presses from the producer's own selection;
 * the pet check reads the log rows.
 *
 *  - `ledgerCopyHoldsPress` (D5): a burst-ledger line `<Wall> active ON THE
 *    TARGET … (Zs after the burst opened [no press logged])` whose aura —
 *    the target's APPLIED of that wall nearest the burst start + Z (the head
 *    is printed floored: + 0–1 s) — opens a `buildAuraIntervals` interval
 *    (the producer's own selection, FIX-CONTRACT step 7) that holds a
 *    pressed `enemyDefensiveEvents` event of that wall by the interval's
 *    source on the target, after its start and before its end (a press at
 *    its end opens the next one) — and before the burst's end: the press is
 *    read by the producer's bounded selection, `pressReadingOf` (batch
 *    review 80-PIPE-75-B70b #2: a press after a T122-extended burst is not
 *    its). The burst's printed end is floored; a line whose reading differs
 *    at the two ends of that second is not checked. The press refreshed the copy; the
 *    interval is a pressed wall (1a2fabdb 1:25: Exhilaration's Survival of
 *    the Fittest copy at .265, the hunter's press at .528, 8.3 s read
 *    `[no press logged]`). Kind = the wall's name.
 *  - `petCopyReadAsPress` (D11): a `[YOU] [CD]` / `[TEAM] [CD]` press line of
 *    a cooldown with no SPELL_CAST_SUCCESS of it by its unit within 2 s of
 *    the line's second, while in that second the unit's own pet got the
 *    cooldown's aura from the unit in the same batch (≤ 5 ms) as the unit's
 *    own copy (47a03469 r0 2:04: Exhilaration's 3 s Survival of the Fittest
 *    on the hunter and its pet read as a press). A copy inside a batch that
 *    re-states the unit (`isResyncBatchAt`) is skipped: it can be a press
 *    lost while unseen. Kind = the cooldown's name.
 */
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import {
  pressReadingOf,
  wallDefensiveEventsOn,
} from "@gladlog/analysis/src/utils/burstLedger";
import {
  enemyDefensiveEvents,
  type IEnemyDefensiveEvent,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { isResyncBatchAt } from "@gladlog/analysis/src/utils/resyncBatch";
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["ledgerCopyHoldsPress", "petCopyReadAsPress"] as const;

const BURST_HEAD = /^\s+Burst #\d+ — (\d+:\d{2})(?:–(\d+:\d{2}))?/;
const BURST_TARGET = /^\s+Target: (.+?) (?:\d+% → |\| )/;
const BURST_COPY =
  /^\s+(?:Target had [^:]+|⚠ Target was IMMUNE): (.+?) active ON THE TARGET [\d.]+s of this burst \((<?[\d.]+)s after the burst opened \[no press logged\]\)/;
const CD_LINE =
  /^(\d+:\d{2})\s+\[(YOU|TEAM)\] \[CD\]\s+(?:(\d+)\([^)]*\) \([^)]*\): )?(.+?)(?= \(| →| \||$)/;

const PAIR_MS = 5;
/** one aura's start read on two clocks (row ms vs the builder's seconds) */
const SAME_AURA_S = 0.05;

function ledger(ctx: IRoundCtx): void {
  const C = "ledgerCopyHoldsPress";
  let head: number | undefined;
  let headEnd: number | undefined;
  let target: string | undefined;
  const defByTeam = new Map<string, IEnemyDefensiveEvent[]>();
  for (const l of ctx.lines) {
    const h = BURST_HEAD.exec(l);
    if (h) {
      head = secOf(h[1]!);
      headEnd = h[2] ? secOf(h[2]) : undefined;
      target = undefined;
      continue;
    }
    const t = BURST_TARGET.exec(l);
    if (t) {
      target = t[1];
      continue;
    }
    const p = BURST_COPY.exec(l);
    if (!p || head === undefined || target === undefined) continue;
    const named = ctx.units.filter((u) => u.name === target);
    if (named.length !== 1) continue;
    const holder = named[0];
    const wall = p[1]!;
    const z = Number(p[2]!.replace("<", ""));
    const lo = ctx.start + (head + z) * 1000 - 100;
    const hi = ctx.start + (head + 1 + z) * 1000 + 100;
    const rows = ((holder.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.destUnitId === holder.id && nameOf(a.spellId, a.spellName) === wall,
    );
    const app = rows
      .filter((a) => ev(a) === APPLIED && tsOf(a) >= lo && tsOf(a) <= hi)
      .sort((a, b) => tsOf(a) - tsOf(b))[0];
    if (!app) continue;
    // the copy's interval and the presses are the producer's own selection
    // (FIX-CONTRACT step 7): `buildAuraIntervals` (one interval per aura,
    // not cut at a REFRESH) and `enemyDefensiveEvents`' pressed events —
    // a hand replay of the builder diverged from it round after round
    // (codex 85-tk-K-T98-1c … 1h)
    const combat = ctx.legacy as AtomicArenaCombat;
    const appS = (tsOf(app) - combat.startTime) / 1000;
    const intervals = buildAuraIntervals(holder as ICombatUnit, combat);
    const iv = intervals.find(
      (x) =>
        x.spellId === String(app.spellId) &&
        x.srcUnitId === app.srcUnitId &&
        Math.abs(x.fromS - appS) <= SAME_AURA_S,
    );
    if (!iv || headEnd === undefined) continue;
    // the ledger's own reading: every event of the holder's team, the
    // holder's by recipient (an external sits on its caster's events)
    const team = ctx.players.filter(
      (u) => u.reaction === holder.reaction,
    ) as ICombatUnit[];
    const teamKey = String(holder.reaction);
    if (!defByTeam.has(teamKey))
      defByTeam.set(
        teamKey,
        team.flatMap((e) => enemyDefensiveEvents(e, team, combat)),
      );
    const defOn = wallDefensiveEventsOn(defByTeam.get(teamKey)!, holder);
    // the producer's bounded selection (`pressReadingOf`, the interval cut
    // at the burst's end — batch review 80-PIPE-75-B70b #2). The burst's end
    // is printed floored: read at both ends of that second, and a line the
    // two readings disagree on is not checked
    const ivEndMs = combat.startTime + iv.toS * 1000;
    const readAt = (endS: number) =>
      pressReadingOf(
        defOn,
        intervals,
        combat.startTime,
        iv.spellId,
        { name: iv.srcUnitName, id: iv.srcUnitId },
        combat.startTime + iv.fromS * 1000,
        Math.min(ivEndMs, ctx.start + endS * 1000),
      );
    const atLo = readAt(headEnd);
    const atHi = readAt(headEnd + 1);
    const pressMsOf = (r: ReturnType<typeof readAt>) =>
      r && "pressMs" in r ? r.pressMs : undefined;
    if (pressMsOf(atLo) === undefined && pressMsOf(atHi) !== undefined)
      continue;
    ctx.bump(C);
    const pressMs = pressMsOf(atLo);
    const press =
      pressMs === undefined
        ? undefined
        : {
            c: { logLine: { timestamp: pressMs } },
            u: ctx.units.find((u) => u.id === iv.srcUnitId) ?? holder,
          };
    if (!press) continue;
    ctx.violate(
      C,
      wall,
      tsOf(press.c),
      `${holder.id}#${wall}#${tsOf(app)}`,
      `the ledger tags ${wall} on ${target} [no press logged]; ${press.u.name} pressed it ${((tsOf(press.c) - tsOf(app)) / 1000).toFixed(2)}s into that aura`,
      l.trim().slice(0, 300),
    );
  }
}

function petCopy(ctx: IRoundCtx): void {
  const C = "petCopyReadAsPress";
  for (const l of ctx.lines) {
    const m = CD_LINE.exec(l);
    if (!m) continue;
    const unit = m[2] === "YOU" ? ctx.owner : ctx.unitOfPid(m[3]);
    if (!unit) continue;
    const cd = m[4]!;
    const sec = secOf(m[1]!);
    const from = ctx.start + sec * 1000;
    const pets = new Set(
      ctx.units.filter((u) => u.ownerId === unit.id).map((u) => u.id),
    );
    if (pets.size === 0) continue;
    const named = (a: any) => nameOf(a.spellId, a.spellName) === cd;
    const own = ((unit.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          (ev(a) === APPLIED || ev(a) === REFRESH) &&
          a.srcUnitId === unit.id &&
          a.destUnitId === unit.id &&
          named(a),
      )
      .map(tsOf);
    const petRow = ctx.units
      .filter((u) => pets.has(u.id) || u.id === unit.id)
      .flatMap((u) => (u.auraEvents ?? []) as any[])
      .find(
        (a) =>
          ev(a) === APPLIED &&
          pets.has(a.destUnitId) &&
          a.srcUnitId === unit.id &&
          named(a) &&
          tsOf(a) >= from &&
          tsOf(a) < from + 1000 &&
          own.some((t) => Math.abs(t - tsOf(a)) <= PAIR_MS),
      );
    if (!petRow) continue;
    // a copy inside a batch that re-states the unit can be a press the log
    // lost while the unit was unseen (`hiddenPressMs` reads it so): no
    // missing cast row tells the two apart (codex 85-tk-K-T98-1 #3)
    if (
      own.some(
        (t) =>
          Math.abs(t - tsOf(petRow)) <= PAIR_MS && isResyncBatchAt(unit, t),
      )
    )
      continue;
    ctx.bump(C);
    const pressed = successesOf(unit).some(
      (c) => named(c) && Math.abs(tsOf(c) - (from + 500)) <= 2500,
    );
    if (pressed) continue;
    ctx.violate(
      C,
      cd,
      tsOf(petRow),
      `${unit.id}#${cd}#${tsOf(petRow)}`,
      `${unit.name}'s ${cd} line is a press, but the log has no cast of it: its pet got the aura in the batch of the unit's own copy`,
      l.trim().slice(0, 300),
    );
  }
}

export function run(ctx: IRoundCtx): void {
  ledger(ctx);
  petCopy(ctx);
}
