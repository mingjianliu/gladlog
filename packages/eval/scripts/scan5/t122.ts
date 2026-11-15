/* eslint-disable @typescript-eslint/no-explicit-any -- the checks walk the untyped legacy parse objects (auraEvents, spellCastEvents) */
/**
 * scan5/t122.ts — ticket T122: a press whose effect lands along its own
 * flight. Breath of Eons (442204) puts its flight aura on its caster for
 * 3.75 s and lays Temporal Wound 409560 on the players it crosses, the
 * first one 2.004 s after the press in 5e61152f; the burst ledger's span
 * read only effects that started within 2 s of the press and stopped at
 * the flight's end (`0:19–0:23`) while the wounds ran to 0:33.
 *
 *  - `effectAfterFlightStart`: a `Burst #N — a–b | …` head of the owner's
 *    burst ledger, and an owner press inside [a, b] of a spell the head
 *    names (with its own `m:ss–m:ss` in a multi-press head, its end b)
 *    whose own aura (its cast id) the owner put on itself with the press; while that aura was up — later than 2 s after the press — the
 *    owner put one of the press's effect auras (`castAndEffectIds`, a
 *    lookup) on another player, its first run on that player starting
 *    then. The run's end — the first REMOVED of that aura on that player
 *    after it, re-applications within 0.5 s continuing it — floored to the
 *    rendering grid must not be later than b. Kind = the spell's name.
 *    Capped at the round's end (`roundEndMs`), as the ledger's span is.
 *    Read from the log rows alone.
 */
import { castAndEffectIds } from "@gladlog/analysis/src/data/castEffectAuras";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["effectAfterFlightStart"] as const;

const BURST_HEAD = /^\s*Burst #\d+ — (\d+:\d\d)–(\d+:\d\d) \| (.+)$/;
/** the press's start window after the press, ms (EFFECT_START_AFTER_S) */
const START_AFTER_MS = 2000;
const START_BEFORE_MS = 500;
/** a re-application this close after a REMOVED continues the run */
const CHAIN_GAP_MS = 500;

/** `src`'s rows of `id` on `dest`, in time order — with the source-less
 * REMOVED rows (`0000000000000000`), which close `src`'s application as the
 * product's interval builder reads them (codex 85-tk-M-T122-1 #1) */
function rowsOn(dest: any, srcId: string, id: string): any[] {
  return ((dest.auraEvents ?? []) as any[])
    .filter(
      (a) =>
        String(a.spellId) === id &&
        a.destUnitId === dest.id &&
        (a.srcUnitId === srcId ||
          (ev(a) === REMOVED && (!a.srcUnitId || /^0+$/.test(a.srcUnitId)))),
    )
    .sort((x, y) => tsOf(x) - tsOf(y));
}

/** where the run that starts at `fromMs` ended: its first REMOVED, carried
 * on by an APPLIED within `CHAIN_GAP_MS` (a second REMOVED with no APPLIED
 * between is a duplicate row, codex 85-tk-M-T122-1 #2); undefined when no
 * REMOVED closes it */
function runEndMs(rows: any[], fromMs: number): number | undefined {
  let end: number | undefined;
  for (const r of rows) {
    const t = tsOf(r);
    if (t < fromMs) continue;
    if (ev(r) === REMOVED) end ??= t;
    else if (ev(r) === APPLIED && end !== undefined) {
      if (t - end > CHAIN_GAP_MS) break;
      end = undefined;
    }
  }
  return end;
}

export function run(ctx: IRoundCtx): void {
  const C = "effectAfterFlightStart";
  const owner = ctx.owner;
  if (!owner) return;
  const presses = successesOf(owner);
  // the ledger ends every span at the round's end (`roundEndMs`, a Solo
  // Shuffle round's deciding death): a wound running past it is not the
  // span's to print
  const endAt = roundEndMs(ctx.legacy);
  for (const line of ctx.lines) {
    const h = BURST_HEAD.exec(line);
    if (!h) continue;
    const a = secOf(h[1]!);
    const b0 = secOf(h[2]!);
    // `X` alone, or `X m:ss–m:ss + Y m:ss–m:ss` (each press's own span)
    const parts = h[3]!.split(" + ").map((x) => {
      const m = /^(.*?)(?: (\d+:\d\d)–(\d+:\d\d))?$/.exec(x.trim())!;
      return {
        name: m[1]!,
        from: m[2] === undefined ? undefined : secOf(m[2]),
        to: m[3] === undefined ? undefined : secOf(m[3]),
      };
    });
    for (const p of presses) {
      const id = String(p.spellId);
      const t = tsOf(p);
      const s = Math.floor((t - ctx.start) / 1000);
      if (s < a || s > b0) continue;
      const part = parts.find(
        (x) => x.name === nameOf(id) && (x.from === undefined || x.from === s),
      );
      if (!part) continue;
      const b = part.to ?? b0;
      // the press's own aura on its caster, applied with the press
      const own = rowsOn(owner, owner.id, id);
      const ownStart = own.find(
        (r) =>
          (ev(r) === APPLIED || ev(r) === REFRESH) &&
          tsOf(r) >= t - START_BEFORE_MS &&
          tsOf(r) <= t + START_AFTER_MS,
      );
      if (!ownStart) continue;
      const ownEnd = own.find(
        (r) => ev(r) === REMOVED && tsOf(r) > tsOf(ownStart),
      );
      if (!ownEnd) continue;
      const effects = [...castAndEffectIds(id)].filter((e) => e !== id);
      let counted = false;
      for (const dest of ctx.players) {
        if (dest.id === owner.id) continue;
        for (const e of effects) {
          const rows = rowsOn(dest, owner.id, e);
          const first = rows.find(
            (r) => ev(r) === APPLIED && tsOf(r) >= t - START_BEFORE_MS,
          );
          if (!first) continue;
          const f = tsOf(first);
          // a run that started in the start window is read already; one
          // after the flight is another press's
          if (f <= t + START_AFTER_MS || f > tsOf(ownEnd)) continue;
          if (!counted) {
            ctx.bump(C);
            counted = true;
          }
          const end = runEndMs(rows, f);
          if (end === undefined) continue;
          const endS = Math.floor((Math.min(end, endAt) - ctx.start) / 1000);
          if (endS > b)
            ctx.violate(
              C,
              nameOf(id),
              t,
              `${owner.id}#${id}#${t}#${dest.id}#${e}`,
              `${nameOf(id)} pressed ${fmtS((t - ctx.start) / 1000)}, its ${nameOf(e)} on ${dest.name} from ${fmtS((f - ctx.start) / 1000)} (+${((f - t) / 1000).toFixed(3)} s, inside the flight) to ${fmtS(endS)}; burst printed to ${fmtS(b)}`,
              line,
            );
        }
      }
    }
  }
}
