/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/t98.ts — ticket T98 (fact13 D5 / D11): a wall's talent copy is no
 * press, and a press that refreshes the copy is one. Truth is read off the
 * log rows; lookups only name things.
 *
 *  - `ledgerCopyHoldsPress` (D5): a burst-ledger line `<Wall> active ON THE
 *    TARGET … (Zs after the burst opened [no press logged])` whose aura —
 *    the target's APPLIED of that wall nearest the burst start + Z (the head
 *    is printed floored: + 0–1 s), up to its next REMOVED — holds a
 *    SPELL_CAST_SUCCESS of that wall by its holder or aimed at it. The press
 *    refreshed the copy; the interval is a pressed wall (1a2fabdb 1:25:
 *    Exhilaration's Survival of the Fittest copy at .265, the hunter's press
 *    at .528, 8.3 s read `[no press logged]`). Kind = the wall's name.
 *  - `petCopyReadAsPress` (D11): a `[YOU] [CD]` / `[TEAM] [CD]` press line of
 *    a cooldown with no SPELL_CAST_SUCCESS of it by its unit within 2 s of
 *    the line's second, while in that second the unit's own pet got the
 *    cooldown's aura from the unit in the same batch (≤ 5 ms) as the unit's
 *    own copy (47a03469 r0 2:04: Exhilaration's 3 s Survival of the Fittest
 *    on the hunter and its pet read as a press). Kind = the cooldown's name.
 */
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

export const CHECKS = ["ledgerCopyHoldsPress", "petCopyReadAsPress"] as const;

const BURST_HEAD = /^\s+Burst #\d+ — (\d+:\d{2})/;
const BURST_TARGET = /^\s+Target: (.+?) (?:\d+% → |\| )/;
const BURST_COPY =
  /^\s+(?:Target had [^:]+|⚠ Target was IMMUNE): (.+?) active ON THE TARGET [\d.]+s of this burst \((<?[\d.]+)s after the burst opened \[no press logged\]\)/;
const CD_LINE =
  /^(\d+:\d{2})\s+\[(YOU|TEAM)\] \[CD\]\s+(?:(\d+)\([^)]*\) \([^)]*\): )?(.+?)(?= \(| →| \||$)/;

const PAIR_MS = 5;

function ledger(ctx: IRoundCtx): void {
  const C = "ledgerCopyHoldsPress";
  let head: number | undefined;
  let target: string | undefined;
  for (const l of ctx.lines) {
    const h = BURST_HEAD.exec(l);
    if (h) {
      head = secOf(h[1]!);
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
    ctx.bump(C);
    const end =
      rows
        .filter((a) => ev(a) === REMOVED && tsOf(a) > tsOf(app))
        .map(tsOf)
        .sort((a, b) => a - b)[0] ?? ctx.end;
    const press = ctx.players
      .flatMap((u) => successesOf(u).map((c) => ({ c, u })))
      .find(
        ({ c, u }) =>
          (u.id === holder.id || c.destUnitId === holder.id) &&
          nameOf(c.spellId, c.spellName) === wall &&
          tsOf(c) > tsOf(app) &&
          tsOf(c) < end,
      );
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
