/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t186.ts — ticket T186 (fact14 D13, 6df8aae6 0:13): a log-write stall
 * — the file holds no row for over a second, then a batch — falls between an
 * offensive cooldown's aura row and its press row, further apart than
 * `GENERIC_PRESS_AFTER_MS`, and the aura reader prints the one press as
 * `X (no press)` plus a separate press of X.
 *
 * THIS SCAN RE-RUNS THE PRODUCER: its numbers are the checkout's.
 *
 *  - `noPressBesideLatePress`: a `(no press)` occurrence of the generic
 *    branch (`auraOffensiveOccurrences`, every player, once per round) that
 *    a press of the same button by the same unit follows within
 *    `LATE_PRESS_MS` of the aura row. Kind = what the file holds between the
 *    two rows — nothing (the next row of the file after the aura row's
 *    millisecond is the batch the press is in) or rows — and the spell.
 *    Counted: every generic `(no press)` occurrence.
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  auraOffensiveOccurrences,
  NO_PRESS_SUFFIX,
} from "@gladlog/analysis/src/utils/offensiveAuraOccurrences";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import { type IRoundCtx, successesOf, tsOf } from "./ctx";

export const CHECKS = ["noPressBesideLatePress"] as const;

/** how far after the aura row a press of the button is looked for */
const LATE_PRESS_MS = 5000;

/** wall-clock of a raw line read naively (no zone) */
function naiveMs(line: string): number | undefined {
  const m = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m) return undefined;
  return (
    Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!, +m[4]!, +m[5]!, 0) + +m[6]! * 1000
  );
}

const rowMsCache = new WeakMap<object, number[]>();
/** every row of the round's file, as round-clock ms, in file order */
function rowMs(ctx: IRoundCtx): number[] {
  const hit = rowMsCache.get(ctx.rawLines);
  if (hit) return hit;
  let offset: number | undefined;
  outer: for (const u of ctx.units)
    for (const c of (u.spellCastEvents ?? []) as any[]) {
      const li = c.logLine?.lineIndex;
      if (li === undefined) continue;
      const n = naiveMs(ctx.rawLines[li] ?? "");
      if (n === undefined) continue;
      offset = c.logLine.timestamp - n;
      break outer;
    }
  const out: number[] = [];
  if (offset !== undefined)
    for (const line of ctx.rawLines) {
      const n = naiveMs(line);
      if (n !== undefined) out.push(Math.round(n + offset));
    }
  rowMsCache.set(ctx.rawLines, out);
  return out;
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const C = "noPressBesideLatePress";
  const bounds = { startTime: ctx.start, endTime: roundEndMs(ctx.legacy) };
  for (const u of ctx.players) {
    let occ: ReturnType<typeof auraOffensiveOccurrences>["occurrences"];
    try {
      occ = auraOffensiveOccurrences(u, bounds).occurrences;
    } catch {
      continue;
    }
    const casts = successesOf(u);
    for (const o of occ) {
      if (!o.generic || !o.spellName.endsWith(NO_PRESS_SUFFIX)) continue;
      ctx.bump(C);
      const name = o.spellName.slice(0, -NO_PRESS_SUFFIX.length);
      const press = casts
        .filter(
          (c) =>
            tsOf(c) > o.startMs &&
            tsOf(c) <= o.startMs + LATE_PRESS_MS &&
            getEnglishSpellName(String(c.spellId), c.spellName ?? "") === name,
        )
        .sort((a, b) => tsOf(a) - tsOf(b))[0];
      if (!press) continue;
      const pressMs = tsOf(press);
      const rows = rowMs(ctx);
      const between = rows.filter((t) => t > o.startMs && t < pressMs).length;
      // the first row of the file after the aura row's millisecond
      const next = rows.find((t) => t > o.startMs);
      const gapMs = next === undefined ? 0 : next - o.startMs;
      const lag = ((pressMs - o.startMs) / 1000).toFixed(2);
      const kind =
        between === 0
          ? `no row of the file between the aura and the press | ${name}`
          : gapMs >= 1000
            ? `a ${(gapMs / 1000).toFixed(1)} s hole after the aura row, then rows before the press | ${name}`
            : `rows between | ${name}`;
      ctx.violate(
        C,
        kind,
        o.startMs,
        `${ctx.roundKey}|${u.id}|${o.startMs}`,
        `${u.name} ${name}: aura row at ${((o.startMs - ctx.start) / 1000).toFixed(3)} s, press row ${lag} s later; ${between} rows of the file between; first later row ${gapMs} ms after the aura`,
      );
    }
  }
}
