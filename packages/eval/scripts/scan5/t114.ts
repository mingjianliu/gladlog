/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/t114.ts — ticket T114 (fact13 D22): the burst ledger's `pressed Zs
 * after the burst opened` names the press — the cast row — not the instant
 * the wall's aura settled on the target. Truth is read off the log rows;
 * lookups only name things.
 *
 *  - `ledgerPressedNotAtPress`: a burst-ledger line `<Wall> active ON THE
 *    TARGET … (pressed Zs after the burst opened)`. The burst opens at the
 *    owner's first SUCCESS / APPLIED of the head's first cooldown in the
 *    head's second; the wall's aura is the target's APPLIED of that wall
 *    nearest the opening + Z; its press is the latest SUCCESS of that wall's
 *    name by the aura's source — for a summon (a totem), by its owner only:
 *    the totem's own SUCCESS rows are its pulse — at most
 *    `PRESS_LOOKBACK_MS` before that APPLIED (or a moment after it). A
 *    violation when Z is more than one rounding step off press − opening
 *    (e2047b8b r0 2:43: Spirit Link Totem pressed 4.95 s in, its aura
 *    flickered and settled at 6.0 s, the line read `pressed 6.0s`).
 *    Kind = the wall's name.
 */
import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["ledgerPressedNotAtPress"] as const;

const BURST_HEAD =
  /^\s+Burst #\d+ — (\d+:\d{2})–\d+:\d{2} \| (.+?)(?: \d+:\d{2}–| \+ |$)/;
const BURST_TARGET = /^\s+Target: (.+?) (?:\d+% → |\| )/;
const BURST_PRESSED =
  /^\s+(?:Target had [^:]+|⚠ Target was IMMUNE): (.+?) active ON THE TARGET [\d.]+s of this burst \(pressed (<?[\d.]+)s after the burst opened\)/;

/** how far before its aura a press is looked for (a totem's aura can
 * flicker on and off before it settles) */
const PRESS_LOOKBACK_MS = 3000;
/** a press's cast row can be logged just after its aura */
const PRESS_AFTER_AURA_MS = 200;
/** one rounding step of the printed tenth, and a little */
const TOLERANCE_S = 0.15;

export function run(ctx: IRoundCtx): void {
  const C = "ledgerPressedNotAtPress";
  let openMs: number | undefined;
  let target: string | undefined;
  for (const l of ctx.lines) {
    const h = BURST_HEAD.exec(l);
    if (h) {
      target = undefined;
      const sec = secOf(h[1]!);
      const cd = h[2]!.trim();
      const lo = ctx.start + sec * 1000;
      const rows = [
        ...successesOf(ctx.owner),
        ...((ctx.owner.auraEvents ?? []) as any[]).filter(
          (a) => ev(a) === APPLIED && a.srcUnitId === ctx.owner.id,
        ),
      ]
        .filter(
          (r) =>
            nameOf(r.spellId, r.spellName) === cd &&
            tsOf(r) >= lo &&
            tsOf(r) < lo + 1000,
        )
        .map(tsOf)
        .sort((a, b) => a - b);
      openMs = rows[0];
      continue;
    }
    const t = BURST_TARGET.exec(l);
    if (t) {
      target = t[1];
      continue;
    }
    const p = BURST_PRESSED.exec(l);
    if (!p || openMs === undefined || target === undefined) continue;
    const named = ctx.units.filter((u) => u.name === target);
    if (named.length !== 1) continue;
    const holder = named[0];
    const wall = p[1]!;
    const z = Number(p[2]!.replace("<", ""));
    const want = openMs + z * 1000;
    const app = ((holder.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          ev(a) === APPLIED &&
          a.destUnitId === holder.id &&
          nameOf(a.spellId, a.spellName) === wall &&
          Math.abs(tsOf(a) - want) <= 300,
      )
      .sort((a, b) => Math.abs(tsOf(a) - want) - Math.abs(tsOf(b) - want))[0];
    if (!app) continue;
    const src = ctx.units.find((u) => u.id === app.srcUnitId);
    if (!src) continue;
    // a summon's aura is its owner's press: the totem's own SUCCESS rows
    // (its pulse) are not the button (e2047b8b: one 10 ms before the aura)
    const owner = ctx.units.find(
      (u) => u.id === src.ownerId && u.id !== src.id,
    );
    const pressers = owner ? [owner] : [src];
    const press = pressers
      .flatMap((u) => successesOf(u).map((c) => ({ c, u })))
      .filter(
        ({ c }) =>
          nameOf(c.spellId, c.spellName) === wall &&
          tsOf(c) <= tsOf(app) + PRESS_AFTER_AURA_MS &&
          tsOf(c) >= tsOf(app) - PRESS_LOOKBACK_MS,
      )
      .sort((a, b) => tsOf(b.c) - tsOf(a.c))[0];
    if (!press || tsOf(press.c) < openMs) continue;
    ctx.bump(C);
    const truth = (tsOf(press.c) - openMs) / 1000;
    if (Math.abs(truth - z) <= TOLERANCE_S) continue;
    ctx.violate(
      C,
      wall,
      tsOf(press.c),
      `${holder.id}#${wall}#${tsOf(app)}`,
      `the ledger says ${wall} was pressed ${z.toFixed(1)}s after the burst opened; ${press.u.name}'s press is ${truth.toFixed(2)}s after it (the aura went up ${((tsOf(app) - openMs) / 1000).toFixed(2)}s after)`,
      l.trim().slice(0, 300),
    );
  }
}
