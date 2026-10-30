/**
 * [GRIP] (B-tier B17b-U8, user ruling 2026-10-06) — an enemy's Death Grip on
 * a player of our team. A grip is a displacement with no control aura, so it
 * was on no line at all: 7d1f14af 0:46 (the owner gripped), 2c6e85ec 1:51
 * (the healer gripped) — the prompt named Death Grip only in a legend. It
 * explains where the player suddenly stood; it is a fact line, nothing is
 * judged from it.
 *
 * `gripLineCount` is threaded like the other legend counters: the caller
 * passes its current value and assigns back the returned one (the [GRIP]
 * legend needs > 0).
 */
import { deathGripsOn } from "../../utils/forcedDisplacement";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitGripEntries(
  ctx: Pick<
    TimelineCtx,
    | "friends"
    | "enemies"
    | "matchStartMs"
    | "pid"
    | "actorLabel"
    | "addEntry"
    | "gripLineCount"
  >,
): Pick<TimelineCtx, "gripLineCount"> {
  const { friends, enemies, matchStartMs, pid, actorLabel, addEntry } = ctx;
  // threaded: read from ctx, returned to the caller (GH #116)
  let { gripLineCount } = ctx;

  // `deathGripsOn` — the reading the STAYED IN line's "you moved" shares
  const grips = friends.flatMap((victim) =>
    deathGripsOn(victim, enemies ?? []).map((g) => ({ victim, ...g })),
  );
  // in the order the casts were walked before: by caster, then by cast
  const casterOrder = new Map((enemies ?? []).map((e, i) => [e.id, i]));
  grips.sort(
    (a, b) =>
      casterOrder.get(a.caster.id)! - casterOrder.get(b.caster.id)! ||
      a.castMs - b.castMs,
  );
  for (const { victim, caster: dk, castMs, missType } of grips) {
    const at = (castMs - matchStartMs) / 1000;
    const tail = missType ? ` — did not land (${missType})` : "";
    if (
      addEntry(
        at,
        `${fmtTime(at)}  [GRIP]   ${pid(victim.name)} ← Death Grip (by ${actorLabel(dk.name, "enemy", dk.id)})${tail}`,
      )
    )
      gripLineCount++;
  }
  return { gripLineCount };
}
