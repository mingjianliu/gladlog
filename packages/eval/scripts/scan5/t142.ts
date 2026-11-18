/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t142.ts — ticket T142 (round-14 D27): `[BUFF FADED] X (expired,
 * estimated)` printed for an owner buff the log never shows ending.
 * bd6d44c1: Recklessness up at 4:24.9, no REMOVED before the round's end at
 * 4:47.9, the line at 4:42 (press + the 18 s table length) — every other
 * run of it that round lasted 24 s or more.
 *
 *  - `fadedEstimatedNeverRemoved`: every `(expired, estimated)` fade line of
 *    the owner's context; the owner's own aura of that name (applied by the
 *    owner on itself) whose last APPLIED / REFRESH at or before the line's
 *    second has no REMOVED after it up to the round's end of play
 *    (`roundEndAt`) and none in the log's rows after that either: the log
 *    shows it up when the round ended. Kind = the spell. Inventory kind (out
 *    of the total) `<spell> | removed after the round` when the only
 *    REMOVED is logged after the round's end. Checked = the estimated fade
 *    lines whose spell has such an aura on the owner at all.
 */
import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["fadedEstimatedNeverRemoved"] as const;

const LINE = /^(\d+:\d{2})\s+\[BUFF FADED\]\s+(.+?) \(expired, estimated\)\s*$/;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner as any;
  if (!owner) return;
  for (const l of ctx.text.split("\n")) {
    const m = LINE.exec(l);
    if (!m) continue;
    const atMs = ctx.start + (secOf(m[1]!) + 1) * 1000;
    const name = m[2]!;
    const rows = ((owner.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          a.srcUnitId === owner.id &&
          a.destUnitId === owner.id &&
          nameOf(String(a.spellId), a.spellName) === name,
      )
      .sort((x, y) => tsOf(x) - tsOf(y));
    const last = rows
      .filter(
        (a) => (ev(a) === APPLIED || ev(a) === REFRESH) && tsOf(a) <= atMs,
      )
      .pop();
    if (!last) continue;
    ctx.bump("fadedEstimatedNeverRemoved");
    const removed = rows.find(
      (a) =>
        ev(a) === REMOVED &&
        String(a.spellId) === String(last.spellId) &&
        tsOf(a) >= tsOf(last),
    );
    if (removed && tsOf(removed) <= ctx.roundEndAt) continue;
    const rel = (ms: number) => ((ms - ctx.start) / 1000).toFixed(1);
    ctx.violate(
      "fadedEstimatedNeverRemoved",
      removed ? `${name} | removed after the round` : name,
      ctx.start + secOf(m[1]!) * 1000,
      `${ctx.roundKey}|${owner.id}|${name}|${m[1]}`,
      `${name}: applied ${rel(tsOf(last))}s, ${removed ? `REMOVED ${rel(tsOf(removed))}s` : "no REMOVED"}, round end ${rel(ctx.roundEndAt)}s; the line says it expired at ${m[1]}`,
      l.trim().slice(0, 200),
    );
  }
}
