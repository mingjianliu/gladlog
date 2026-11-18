 
/**
 * scan5/t171.ts — ticket T171 (round 14 D20): an `external-unused` row says
 * the owner held an external and was free to give it for `freeGapS` seconds
 * of the last `EXTERNAL_FREE_WINDOW_S` before a teammate's death. Free to
 * give it means in reach: the row may not rest on a stretch of the window
 * in which the external could not reach the victim.
 *
 *  - `externalUnusedOutOfReach`: an `external-unused` menu row whose longest
 *    in-reach stretch of the window — the window minus the producer's own
 *    `externalOutOfReachSpans` at `externalReachYd` — is shorter than
 *    `EXTERNAL_FREE_MIN_GAP_S` (kind `under the reaction allowance`: the row
 *    should not exist), or shorter than the row's `freeGapS` by more than
 *    the fact's rounding (kind `freeGapS over the in-reach stretch`). The
 *    external's id is the ally-castable defensive of that English name.
 *    Checked = every row whose units, external and reach are known.
 *    a036aff5 r1 0:30: `external=Darkness, freeGapS=5`, the owner 21–43 yd
 *    from the healer until the death's own sample (an 8 yd zone).
 */
import {
  EXTERNAL_FREE_MIN_GAP_S,
  EXTERNAL_FREE_WINDOW_S,
  externalOutOfReachSpans,
  externalReachYd,
} from "@gladlog/analysis/src/analysis/candidates/death";
import spellIdLists from "@gladlog/analysis/src/data/spellIdLists";
import {
  distanceBetween,
  getUnitPositionAtTime,
} from "@gladlog/analysis/src/utils/losAnalysis";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["externalUnusedOutOfReach"] as const;

const ROW =
  /type=external-unused t=([\d.]+)s units=\S+ facts=\{t=[^,]+, victim=([^,]+), owner=([^,]+), external=([^,]+), freeGapS=([\d.]+)\}/g;
const EXTERNALS = (
  spellIdLists as unknown as { externalDefensiveSpellIds: string[] }
).externalDefensiveSpellIds;

export function run(ctx: IRoundCtx): void {
  for (const m of ctx.menu.matchAll(ROW)) {
    const deathT = +m[1]!;
    const victim = ctx.byName.get(m[2]!);
    const owner = ctx.byName.get(m[3]!);
    if (!victim || !owner) continue;
    const ids = EXTERNALS.filter((id) => nameOf(id) === m[4]);
    // the longest reach among the ids of that name: the row's own claim is
    // judged against the most generous reading
    let reach: number | null = null;
    for (const id of ids) {
      const r = externalReachYd(owner, id);
      if (r !== null && (reach === null || r > reach)) reach = r;
    }
    if (reach === null) continue;
    ctx.bump("externalUnusedOutOfReach");
    const from = Math.max(0, deathT - EXTERNAL_FREE_WINDOW_S);
    const spans = externalOutOfReachSpans(deathT, reach, (t) => {
      const ms = ctx.start + t * 1000;
      const a = getUnitPositionAtTime(owner, ms, 2000);
      const b = getUnitPositionAtTime(victim, ms, 2000);
      return a && b ? distanceBetween(a, b) : null;
    });
    let cursor = from;
    let inReach = 0;
    for (const s of spans) {
      inReach = Math.max(inReach, s.atSeconds - cursor);
      cursor = Math.max(cursor, s.atSeconds + s.durationSeconds);
    }
    inReach = Math.max(inReach, deathT - cursor);
    const claimed = +m[5]!;
    const kind =
      inReach < EXTERNAL_FREE_MIN_GAP_S
        ? "under the reaction allowance"
        : claimed > inReach + 0.06
          ? "freeGapS over the in-reach stretch"
          : undefined;
    if (kind)
      ctx.violate(
        "externalUnusedOutOfReach",
        kind,
        ctx.start + deathT * 1000,
        `${ctx.roundKey}:${owner.id}:${victim.id}:${Math.round(deathT)}`,
        `${m[4]} reaches ${reach} yd; longest in-reach stretch of the window ${inReach.toFixed(2)} s, row says freeGapS=${m[5]}`,
        m[0].slice(0, 240),
      );
  }
}
